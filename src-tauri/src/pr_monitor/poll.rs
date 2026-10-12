//! Polling: the `gh` call a watch makes, the fingerprint that decides whether
//! anything moved, and the reading of what actually changed.

use std::collections::HashMap;
use std::time::Duration;

use crate::git_pr_hub::{self, GitPrCheckEntry};
use crate::session_api::TurnStatus;

use super::text::{clamp_text, redact};
use super::types::{FailedCheck, PolledPr, PrChange, PrCommentBrief, PrSnapshot, WakeOutcome};
use super::{
    CHECK_DESC_CAP, CHECK_ROWS_CAP, COMMENT_BODY_CAP, DEFAULT_INTERVAL_SECS, FIELD_CAP,
    MAX_INTERVAL_SECS, MAX_WATCHES_PER_SESSION, MIN_INTERVAL_SECS, SNAPSHOT_COMMENTS,
    TERMINAL_STATES,
};

pub fn pr_view_json_fields() -> String {
    format!("{},comments,reviews", git_pr_hub::VIEW_JSON_FIELDS)
}

/// `gh` argv for one poll of `pr_number` (never interpolates user text).
pub fn gh_view_args(pr_number: u64) -> Vec<String> {
    vec![
        "pr".into(),
        "view".into(),
        pr_number.to_string(),
        "--json".into(),
        pr_view_json_fields(),
    ]
}

/// Clamp a caller-supplied interval into the supported range.
pub fn clamp_interval_secs(raw: Option<u64>) -> u64 {
    match raw {
        None => DEFAULT_INTERVAL_SECS,
        Some(v) => v.clamp(MIN_INTERVAL_SECS, MAX_INTERVAL_SECS),
    }
}

/// True when a watch is due for another poll.
pub fn is_due(elapsed_since_poll: Option<Duration>, interval_secs: u64) -> bool {
    match elapsed_since_poll {
        None => true,
        Some(e) => e.as_secs() >= interval_secs,
    }
}

/// True when one more watch fits: a re-mount of a PR already watched always does.
pub fn accepts_mount(mounted: usize, already_watched: bool) -> bool {
    already_watched || mounted < MAX_WATCHES_PER_SESSION
}

/// Length-prefixed field so a `|` inside a title cannot fake a fingerprint match.
fn fp_field(raw: &str) -> String {
    format!("{}:{}", raw.len(), raw)
}

/// Normalize a snapshot to a stable string. Revisions the session cares about
/// (title, state, mergeable, checks counts, comment set, updatedAt) all move it.
pub fn snapshot_fingerprint(s: &PrSnapshot) -> String {
    let mut ids: Vec<&str> = s.comments.iter().map(|c| c.id.as_str()).collect();
    ids.sort_unstable();
    let mut parts = vec![
        s.number.to_string(),
        fp_field(&s.title),
        fp_field(&s.state),
        s.is_draft.to_string(),
        fp_field(&s.mergeable),
        fp_field(&s.updated_at),
        fp_field(&s.head_ref_name),
        fp_field(&s.base_ref_name),
        format!(
            "{}/{}/{}/{}/{}",
            s.checks.pass, s.checks.fail, s.checks.pending, s.checks.total, s.checks.overall
        ),
    ];
    parts.push(fp_field(&ids.join(",")));
    parts.join("|")
}

/// True once gh reports the PR merged or closed.
pub fn is_terminal_state(state: &str) -> bool {
    let s = state.trim().to_ascii_uppercase();
    TERMINAL_STATES.contains(&s.as_str())
}

/// Build a poll result from one `gh pr view --json` payload.
pub fn polled_from_gh_json(raw: &str) -> Result<PolledPr, String> {
    let (entry, check_rows) = git_pr_hub::parse_gh_pr_view_with_checks(raw)?
        .ok_or_else(|| "gh pr view returned no pull request".to_string())?;
    let (comments, url, _number) = git_pr_hub::parse_gh_pr_comments_json(raw)?;
    let mut comment_bodies: HashMap<String, String> = HashMap::new();
    let briefs = comments
        .into_iter()
        .take(SNAPSHOT_COMMENTS)
        .map(|c| {
            let body = clamp_text(&redact(&c.body), COMMENT_BODY_CAP);
            if !body.is_empty() {
                comment_bodies.insert(c.id.clone(), body);
            }
            PrCommentBrief {
                id: c.id,
                // Prefer the login so diffs stay stable across display-name edits.
                author: c
                    .author_login
                    .clone()
                    .unwrap_or(c.author)
                    .trim()
                    .to_string(),
                kind: c.kind,
                state: c.state,
                created_at: c.created_at,
                excerpt: c.excerpt,
            }
        })
        .collect();
    let entry_url = entry.url.trim().to_string();
    Ok(PolledPr {
        snapshot: PrSnapshot {
            number: entry.number,
            title: entry.title.trim().to_string(),
            url: if entry_url.is_empty() {
                url.unwrap_or_default()
            } else {
                entry_url
            },
            state: entry.state.unwrap_or_default().trim().to_string(),
            is_draft: entry.is_draft,
            mergeable: entry.mergeable.unwrap_or_default().trim().to_string(),
            head_ref_name: entry.head_ref_name.unwrap_or_default().trim().to_string(),
            base_ref_name: entry.base_ref_name.unwrap_or_default().trim().to_string(),
            updated_at: entry.updated_at.unwrap_or_default().trim().to_string(),
            checks: entry.checks.unwrap_or_default(),
            comments: briefs,
        },
        comment_bodies,
        check_rows,
    })
}

/// Validate a mount request without touching the network.
pub fn validate_watch(session_id: &str, project_path: &str, pr_number: u64) -> Result<(), String> {
    if session_id.trim().is_empty() {
        return Err("empty session id".into());
    }
    if project_path.trim().is_empty() {
        return Err("empty project path".into());
    }
    if pr_number == 0 {
        return Err("invalid PR number".into());
    }
    Ok(())
}

/// Last observed state of one watch (the non-IO half of a watch).
#[derive(Debug, Clone, Default)]
pub struct WatchBaseline {
    fingerprint: Option<String>,
    pub(super) snapshot: Option<PrSnapshot>,
}

/// Fold a fresh poll into the baseline.
///
/// Returns the changes exactly once per real revision: the baseline advances in
/// every case, so a repeated fingerprint never fires twice, the first poll only
/// seeds the baseline, and a revision the session does not care about (an
/// `updatedAt` bump, a draft toggle) yields no changes at all.
pub fn advance_baseline(baseline: &mut WatchBaseline, polled: &PolledPr) -> Option<Vec<PrChange>> {
    let fingerprint = snapshot_fingerprint(&polled.snapshot);
    let changed = match (baseline.fingerprint.take(), baseline.snapshot.take()) {
        (Some(prev_fp), Some(prev_snapshot)) if prev_fp != fingerprint => {
            let changes = diff_snapshots(&prev_snapshot, polled);
            if changes.is_empty() {
                None
            } else {
                Some(changes)
            }
        }
        _ => None,
    };
    baseline.fingerprint = Some(fingerprint);
    baseline.snapshot = Some(polled.snapshot.clone());
    changed
}

/// What actually changed between two polls, newest-relevant first.
///
/// Deliberately narrow: only changes worth waking a session for.
/// - comments / reviews that are new since `prev`;
/// - CI starting to fail, or turning green (a partial recovery does not wake);
/// - PR state, mergeability or title moving.
pub fn diff_snapshots(prev: &PrSnapshot, next: &PolledPr) -> Vec<PrChange> {
    let mut out: Vec<PrChange> = Vec::new();

    let seen: Vec<&str> = prev.comments.iter().map(|c| c.id.as_str()).collect();
    let mut added: Vec<&PrCommentBrief> = next
        .snapshot
        .comments
        .iter()
        .filter(|c| !c.id.is_empty() && !seen.contains(&c.id.as_str()))
        .collect();
    added.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    for brief in added {
        out.push(PrChange::Comment {
            kind: if brief.kind == "review" {
                "review".into()
            } else {
                "comment".into()
            },
            comment_id: brief.id.clone(),
            author: brief.author.trim().to_string(),
            excerpt: clamp_text(&brief.excerpt, FIELD_CAP),
            state: brief.state.clone(),
            created_at: brief.created_at.clone(),
            body: next.comment_bodies.get(&brief.id).cloned(),
        });
    }

    let prev_checks = &prev.checks;
    let next_checks = &next.snapshot.checks;
    let was_green = prev_checks.fail == 0 && prev_checks.pending == 0 && prev_checks.total > 0;
    let is_green = next_checks.fail == 0 && next_checks.pending == 0 && next_checks.total > 0;
    if next_checks.fail > 0 && prev_checks.fail == 0 {
        out.push(PrChange::Checks {
            pass: next_checks.pass,
            fail: next_checks.fail,
            total: next_checks.total,
            failed: failing_rows(&next.check_rows),
            omitted: failing_rows_omitted(&next.check_rows),
        });
    } else if is_green && !was_green {
        out.push(PrChange::Checks {
            pass: next_checks.pass,
            fail: next_checks.fail,
            total: next_checks.total,
            failed: Vec::new(),
            omitted: 0,
        });
    }

    let prev_state = prev.state.trim();
    let next_state = next.snapshot.state.trim();
    if !next_state.is_empty() && !prev_state.is_empty() && next_state != prev_state {
        out.push(PrChange::State {
            from: prev_state.to_string(),
            to: next_state.to_string(),
        });
    }
    let prev_merge = prev.mergeable.trim();
    let next_merge = next.snapshot.mergeable.trim();
    if !next_merge.is_empty() && !prev_merge.is_empty() && next_merge != prev_merge {
        out.push(PrChange::Mergeable {
            from: prev_merge.to_string(),
            to: next_merge.to_string(),
        });
    }
    let prev_title = prev.title.trim();
    let next_title = next.snapshot.title.trim();
    if !next_title.is_empty() && !prev_title.is_empty() && next_title != prev_title {
        out.push(PrChange::Title {
            from: clamp_text(prev_title, FIELD_CAP),
            to: clamp_text(next_title, FIELD_CAP),
        });
    }

    out
}

fn failing_rows_of(rows: &[GitPrCheckEntry]) -> Vec<&GitPrCheckEntry> {
    rows.iter()
        .filter(|c| c.bucket.eq_ignore_ascii_case("fail"))
        .collect()
}

/// Failing rows of a poll, in the shape a fix-CI block names them.
fn failing_rows(rows: &[GitPrCheckEntry]) -> Vec<FailedCheck> {
    failing_rows_of(rows)
        .into_iter()
        .take(CHECK_ROWS_CAP)
        .map(|c| FailedCheck {
            name: clamp_text(&c.name, FIELD_CAP),
            state: clamp_text(&c.state, FIELD_CAP),
            description: {
                let d = clamp_text(
                    &redact(c.description.as_deref().unwrap_or_default()),
                    CHECK_DESC_CAP,
                );
                if d.is_empty() {
                    None
                } else {
                    Some(d)
                }
            },
        })
        .collect()
}

fn failing_rows_omitted(rows: &[GitPrCheckEntry]) -> usize {
    failing_rows_of(rows).len().saturating_sub(CHECK_ROWS_CAP)
}

/// What the monitor does with a wake, given the shipped turn path's answer.
pub fn wake_outcome(status: TurnStatus, message: Option<&str>) -> WakeOutcome {
    match status {
        TurnStatus::TurnStarted => WakeOutcome::Delivered,
        TurnStatus::Queued => WakeOutcome::Queued,
        TurnStatus::RetryLater | TurnStatus::AppNotRunning => WakeOutcome::Retry,
        other => WakeOutcome::Failed(
            message
                .map(str::trim)
                .filter(|m| !m.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| format!("{other:?}")),
        ),
    }
}
