//! Unit tests: the `gh` call, the fingerprint, the reading of a change, the
//! wake a chat gets, and the per-session registry.

use crate::pr_monitor_i18n::{self as text, MessageKey};
use crate::session_api::TurnStatus;

use super::poll::*;
use super::prompt::*;
use super::text::*;
use super::types::*;
use super::*;

/// Shape of `gh pr view <n> --json …` output (trimmed but faithful).
fn sample_view(title: &str, state: &str, fail: u32, comment_id: &str) -> String {
    format!(
        r#"{{
  "number": 1316,
  "title": "{title}",
  "state": "{state}",
  "isDraft": false,
  "mergeable": "MERGEABLE",
  "headRefName": "feat/subagent-live-monitor",
  "baseRefName": "main",
  "updatedAt": "2026-10-10T09:00:00Z",
  "url": "https://github.com/RongleCat/grok-app/pull/1316",
  "statusCheckRollup": [
    {{"name": "frontend", "status": "COMPLETED", "conclusion": "SUCCESS", "workflowName": "ci"}},
    {{"name": "rust", "status": "COMPLETED", "conclusion": "{}", "description": "3 tests failed"}}
  ],
  "comments": [
    {{"id": "{comment_id}", "author": {{"login": "RongleCat"}}, "body": "Please rebase.\n\nThe token is sk-abcdefghijklmno and must not leak.", "createdAt": "{comment_id}", "url": "https://github.com/RongleCat/grok-app/pull/1316#issuecomment-1"}}
  ],
  "reviews": []
}}"#,
        if fail > 0 { "FAILURE" } else { "SUCCESS" }
    )
}

fn polled(title: &str, state: &str, fail: u32, comment_id: &str) -> PolledPr {
    polled_from_gh_json(&sample_view(title, state, fail, comment_id)).expect("parse poll")
}

fn snapshot(title: &str, state: &str, fail: u32, comment_id: &str) -> PrSnapshot {
    polled(title, state, fail, comment_id).snapshot
}

fn bare_watch() -> Watch {
    Watch {
        project_path: "/tmp/repo".into(),
        pr_number: 1316,
        interval_secs: 60,
        mounted_at: "t0".into(),
        last_poll: None,
        last_poll_at: None,
        last_update_at: None,
        last_error: None,
        baseline: WatchBaseline::default(),
        pending: None,
        last_change: None,
        polls: 0,
        updates: 0,
    }
}

#[test]
fn a_poll_failure_is_published_once_and_a_quiet_success_clears_it() {
    let mut watch = bare_watch();
    let first = watch.apply_poll(Err("gh: authentication failed".into()), "t1".into());
    assert!(first.publish);
    assert!(!first.queued_wake);
    assert_eq!(
        watch.last_error.as_deref(),
        Some("gh: authentication failed")
    );
    assert_eq!(watch.polls, 1);

    let same = watch.apply_poll(Err("gh: authentication failed".into()), "t2".into());
    assert!(!same.publish, "the same failure must not push again");
    assert_eq!(watch.polls, 2);

    let changed = watch.apply_poll(Err("gh: timed out".into()), "t3".into());
    assert!(changed.publish);
    assert_eq!(watch.last_error.as_deref(), Some("gh: timed out"));

    let cleared = watch.apply_poll(Ok(polled("Live monitor", "OPEN", 0, "c1")), "t4".into());
    assert!(cleared.publish, "clearing the error must reach the menu");
    assert!(
        !cleared.queued_wake,
        "the first good poll only seeds the baseline"
    );
    assert!(watch.last_error.is_none());
    assert!(watch.pending.is_none());

    let quiet = watch.apply_poll(Ok(polled("Live monitor", "OPEN", 0, "c1")), "t5".into());
    assert!(!quiet.publish);
    assert!(!quiet.queued_wake);
}

#[test]
fn a_real_change_still_queues_one_wake() {
    let mut watch = bare_watch();
    let seed = watch.apply_poll(Ok(polled("Live monitor", "OPEN", 0, "c1")), "t1".into());
    assert!(!seed.publish);
    assert!(!seed.queued_wake);

    let woke = watch.apply_poll(Ok(polled("Live monitor", "OPEN", 0, "c2")), "t2".into());
    assert!(woke.publish);
    assert!(woke.queued_wake);
    assert!(watch.pending.is_some());
    assert_eq!(watch.updates, 1);
}

#[test]
fn gh_argv_targets_one_pr_and_covers_comments() {
    let args = gh_view_args(1316);
    assert_eq!(args[0], "pr");
    assert_eq!(args[1], "view");
    assert_eq!(args[2], "1316");
    assert_eq!(args[3], "--json");
    let fields = &args[4];
    for needle in [
        "number",
        "title",
        "mergeable",
        "state",
        "headRefName",
        "statusCheckRollup",
        "comments",
        "reviews",
    ] {
        assert!(fields.contains(needle), "missing {needle} in {fields}");
    }
}

#[test]
fn parse_keeps_the_rollup_without_bucket() {
    // gh often omits `bucket`; the parser must classify from status/conclusion.
    let polled = polled("Live monitor", "OPEN", 1, "c1");
    let snap = &polled.snapshot;
    assert_eq!(snap.number, 1316);
    assert_eq!(snap.title, "Live monitor");
    assert_eq!(snap.state, "OPEN");
    assert_eq!(snap.head_ref_name, "feat/subagent-live-monitor");
    assert_eq!(snap.checks.total, 2);
    assert_eq!(snap.checks.fail, 1);
    assert_eq!(snap.checks.pass, 1);
    assert_eq!(snap.comments.len(), 1);
    assert_eq!(snap.comments[0].id, "c1");
    assert_eq!(snap.comments[0].author, "RongleCat");
    assert_eq!(snap.comments[0].kind, "comment");
    assert!(snap.url.ends_with("/pull/1316"));
    // The prompt material rides along with the same single call.
    assert!(polled.comment_bodies["c1"].contains("Please rebase."));
    assert!(polled.comment_bodies["c1"].contains("[REDACTED]"));
    assert!(!polled.comment_bodies["c1"].contains("sk-abcdefghijklmno"));
    assert_eq!(polled.check_rows.len(), 2);
}

#[test]
fn parse_rejects_unrelated_json() {
    assert!(polled_from_gh_json("[]").is_err());
    assert!(polled_from_gh_json("not json").is_err());
}

#[test]
fn redact_covers_the_credential_shapes() {
    assert!(redact("sk-abcdefghijklmno").contains("[REDACTED]"));
    assert!(redact("xai-abcdefghijklmno").contains("[REDACTED]"));
    assert!(redact("Authorization: Bearer abc123def456").contains("[REDACTED]"));
    // Short or plain text stays readable, and the sentence survives.
    assert_eq!(redact("sk-short stays"), "sk-short stays");
    assert_eq!(redact("A normal comment."), "A normal comment.");
    assert!(redact("见 sk-abcdefghijklmno 结束").contains("结束"));
}

#[test]
fn fingerprint_is_stable_and_moves_on_real_changes() {
    let base = sample_view("Live monitor", "OPEN", 0, "c1");
    let a = polled_from_gh_json(&base).unwrap().snapshot;
    let b = polled_from_gh_json(&base).unwrap().snapshot;
    assert_eq!(snapshot_fingerprint(&a), snapshot_fingerprint(&b));

    // New comment → different fingerprint.
    let c = snapshot("Live monitor", "OPEN", 0, "c2");
    assert_ne!(snapshot_fingerprint(&a), snapshot_fingerprint(&c));

    // CI pending → fail (same comment set) → different fingerprint.
    let d = snapshot("Live monitor", "OPEN", 1, "c1");
    assert_ne!(snapshot_fingerprint(&a), snapshot_fingerprint(&d));

    // Title change alone → different fingerprint.
    let e = snapshot("Renamed", "OPEN", 0, "c1");
    assert_ne!(snapshot_fingerprint(&a), snapshot_fingerprint(&e));

    // Merged state → different fingerprint.
    let f = snapshot("Live monitor", "MERGED", 0, "c1");
    assert_ne!(snapshot_fingerprint(&a), snapshot_fingerprint(&f));
}

#[test]
fn fingerprint_cannot_be_faked_by_a_delimiter_in_the_title() {
    let a = snapshot("a|1:x", "OPEN", 0, "c1");
    let b = snapshot("a", "1:x", 0, "c1");
    assert_ne!(snapshot_fingerprint(&a), snapshot_fingerprint(&b));
}

#[test]
fn terminal_states_are_recognized() {
    assert!(is_terminal_state("MERGED"));
    assert!(is_terminal_state("closed"));
    assert!(!is_terminal_state("OPEN"));
    assert!(!is_terminal_state(""));
}

#[test]
fn interval_is_clamped_into_range() {
    assert_eq!(clamp_interval_secs(None), DEFAULT_INTERVAL_SECS);
    assert_eq!(clamp_interval_secs(Some(1)), MIN_INTERVAL_SECS);
    assert_eq!(clamp_interval_secs(Some(90)), 90);
    assert_eq!(clamp_interval_secs(Some(100_000)), MAX_INTERVAL_SECS);
}

#[test]
fn due_waits_a_full_interval_and_polls_first_time() {
    assert!(is_due(None, 60));
    assert!(!is_due(Some(Duration::from_secs(59)), 60));
    assert!(is_due(Some(Duration::from_secs(60)), 60));
}

#[test]
fn the_watch_cap_is_per_session() {
    assert!(accepts_mount(0, false));
    assert!(accepts_mount(MAX_WATCHES_PER_SESSION - 1, false));
    assert!(!accepts_mount(MAX_WATCHES_PER_SESSION, false));
    // Re-mounting a PR already in the list never counts as a new watch.
    assert!(accepts_mount(MAX_WATCHES_PER_SESSION, true));
}

#[test]
fn validate_rejects_incomplete_mounts() {
    assert!(validate_watch("s1", "/tmp", 1).is_ok());
    assert!(validate_watch("", "/tmp", 1).is_err());
    assert!(validate_watch("s1", "  ", 1).is_err());
    assert!(validate_watch("s1", "/tmp", 0).is_err());
}

#[test]
fn first_poll_seeds_the_baseline_without_a_wake() {
    let mut baseline = WatchBaseline::default();
    let poll = polled("Live monitor", "OPEN", 0, "c1");
    assert!(advance_baseline(&mut baseline, &poll).is_none());
    assert!(baseline.snapshot.is_some());
    // Same revision again (unchanged poll) → still no wake.
    assert!(advance_baseline(&mut baseline, &poll).is_none());
}

#[test]
fn a_real_change_fires_exactly_once() {
    let mut baseline = WatchBaseline::default();
    assert!(advance_baseline(&mut baseline, &polled("Live monitor", "OPEN", 0, "c1")).is_none());

    let after = polled("Live monitor", "OPEN", 0, "c2");
    let changes = advance_baseline(&mut baseline, &after).expect("one wake");
    assert!(matches!(
        changes.as_slice(),
        [PrChange::Comment { comment_id, .. }] if comment_id == "c2"
    ));

    // Polling the same payload again must not fire a second wake.
    assert!(advance_baseline(&mut baseline, &after).is_none());
    assert!(advance_baseline(&mut baseline, &after).is_none());

    // A later change still gets through.
    let later = polled("Live monitor", "OPEN", 1, "c2");
    assert!(advance_baseline(&mut baseline, &later).is_some());
    assert!(advance_baseline(&mut baseline, &later).is_none());
}

#[test]
fn a_revision_the_session_does_not_care_about_does_not_wake() {
    let mut baseline = WatchBaseline::default();
    let first = polled("Live monitor", "OPEN", 0, "c1");
    assert!(advance_baseline(&mut baseline, &first).is_none());

    // Same content, new updatedAt (a re-poll of the same revision).
    let mut touched = polled("Live monitor", "OPEN", 0, "c1");
    touched.snapshot.updated_at = "2026-10-10T10:00:00Z".into();
    assert_ne!(
        snapshot_fingerprint(&first.snapshot),
        snapshot_fingerprint(&touched.snapshot)
    );
    assert!(advance_baseline(&mut baseline, &touched).is_none());

    // A draft toggle is not worth a follow-up either.
    let mut draft = polled("Live monitor", "OPEN", 0, "c1");
    draft.snapshot.is_draft = true;
    assert!(advance_baseline(&mut baseline, &draft).is_none());
}

#[test]
fn diff_names_the_new_comment_and_the_failing_rows() {
    let before = snapshot("Live monitor", "OPEN", 0, "c1");
    let after = polled("Live monitor", "OPEN", 1, "c2");
    let changes = diff_snapshots(&before, &after);
    assert_eq!(changes.len(), 2, "{changes:?}");
    match &changes[0] {
        PrChange::Comment {
            kind,
            comment_id,
            body,
            ..
        } => {
            assert_eq!(kind, "comment");
            assert_eq!(comment_id, "c2");
            assert!(body
                .as_deref()
                .unwrap_or_default()
                .contains("Please rebase."));
        }
        other => panic!("expected the new comment first, got {other:?}"),
    }
    match &changes[1] {
        PrChange::Checks {
            fail,
            failed,
            omitted,
            ..
        } => {
            assert_eq!(*fail, 1);
            assert_eq!(failed.len(), 1);
            assert_eq!(failed[0].name, "rust");
            assert_eq!(failed[0].description.as_deref(), Some("3 tests failed"));
            assert_eq!(*omitted, 0);
        }
        other => panic!("expected the CI change second, got {other:?}"),
    }
}

#[test]
fn a_partial_ci_recovery_is_not_a_wake() {
    let before = snapshot("Live monitor", "OPEN", 2, "c1");
    let after = polled("Live monitor", "OPEN", 1, "c1");
    let changes = diff_snapshots(&before, &after);
    assert!(changes.is_empty(), "{changes:?}");
}

fn wake_with(changes: Vec<PrChange>) -> PendingWake {
    let snap = snapshot("Live monitor", "OPEN", 1, "c2");
    PendingWake::new(snap, changes, "t0".into())
}

fn comment_change(id: &str, author: &str) -> PrChange {
    PrChange::Comment {
        kind: "comment".into(),
        comment_id: id.into(),
        author: author.into(),
        excerpt: "…".into(),
        state: None,
        created_at: Some(id.into()),
        body: Some("Please rebase.".into()),
    }
}

#[test]
fn one_pr_carries_one_wake_and_newer_changes_join_it() {
    let mut waiting = wake_with(vec![comment_change("c2", "alice")]);
    let mut newer = wake_with(vec![comment_change("c3", "bob")]);
    newer.last_at = "t1".into();
    waiting.fold(newer);
    assert_eq!(waiting.changes.len(), 2, "{:?}", waiting.changes);
    assert_eq!(waiting.last_at, "t1");
    assert_eq!(waiting.first_at, "t0");
    // Newest comment first in the summary.
    let lines = waiting.summary_lines("en");
    assert!(lines[0].contains("bob"), "{lines:?}");
}

#[test]
fn the_same_slot_keeps_where_it_started_and_takes_where_it_went() {
    let mut waiting = wake_with(vec![PrChange::State {
        from: "OPEN".into(),
        to: "MERGED".into(),
    }]);
    let mut newer = wake_with(vec![PrChange::State {
        from: "MERGED".into(),
        to: "CLOSED".into(),
    }]);
    newer.next.state = "CLOSED".into();
    waiting.fold(newer);
    assert_eq!(waiting.changes.len(), 1, "{:?}", waiting.changes);
    assert_eq!(
        waiting.changes[0],
        PrChange::State {
            from: "OPEN".into(),
            to: "CLOSED".into()
        }
    );
    assert_eq!(waiting.summary("en"), "PR state: OPEN → CLOSED");
}

#[test]
fn ci_keeps_only_the_newest_observation() {
    let mut waiting = wake_with(vec![PrChange::Checks {
        pass: 3,
        fail: 1,
        total: 4,
        failed: vec![FailedCheck {
            name: "rust".into(),
            state: "FAILURE".into(),
            description: None,
        }],
        omitted: 0,
    }]);
    let newer = wake_with(vec![PrChange::Checks {
        pass: 4,
        fail: 0,
        total: 4,
        failed: Vec::new(),
        omitted: 0,
    }]);
    waiting.fold(newer);
    assert_eq!(waiting.changes.len(), 1, "{:?}", waiting.changes);
    assert_eq!(waiting.summary("en"), "CI is green (4/4 passed)");
}

#[test]
fn the_wake_prompt_carries_the_change_the_comment_and_the_task() {
    let mut wake = wake_with(vec![
        comment_change("c2", "RongleCat"),
        PrChange::Checks {
            pass: 1,
            fail: 1,
            total: 2,
            failed: vec![FailedCheck {
                name: "rust".into(),
                state: "FAILURE".into(),
                description: Some("3 tests failed".into()),
            }],
            omitted: 0,
        },
    ]);
    wake.next.url = "https://github.com/RongleCat/grok-app/pull/1316".into();
    let prompt = build_wake_prompt("en", &wake);

    assert!(
        prompt.starts_with("[PR update] #1316 Live monitor — https://github.com"),
        "{prompt}"
    );
    assert!(prompt.contains("What changed:"));
    assert!(prompt.contains("- New comment from RongleCat: …"));
    assert!(prompt.contains("- CI is failing (1 checks)"));
    assert!(prompt.contains("Please help address this comment on pull request #1316"));
    assert!(prompt.contains("### Body"));
    assert!(prompt.contains("Please help fix the failing CI checks on pull request #1316"));
    assert!(prompt.contains("- **rust** — FAILURE: 3 tests failed"));
    assert!(prompt.contains("- Branch: feat/subagent-live-monitor → main"));
    assert!(prompt.ends_with(text::t("en", MessageKey::PromptTask)));
}

#[test]
fn the_wake_prompt_asks_for_investigation_when_no_check_row_is_known() {
    let wake = wake_with(vec![PrChange::Checks {
        pass: 0,
        fail: 2,
        total: 2,
        failed: Vec::new(),
        omitted: 0,
    }]);
    let prompt = build_wake_prompt("en", &wake);
    assert!(prompt.contains(NO_CHECK_ROWS), "{prompt}");
    // A green CI is not a fix-CI prompt.
    let green = wake_with(vec![PrChange::Checks {
        pass: 2,
        fail: 0,
        total: 2,
        failed: Vec::new(),
        omitted: 0,
    }]);
    assert!(!build_wake_prompt("en", &green).contains("Failed checks"));
}

#[test]
fn the_wake_prompt_speaks_the_app_language() {
    let wake = wake_with(vec![PrChange::Title {
        from: "Old".into(),
        to: "New".into(),
    }]);
    let zh = build_wake_prompt("zh", &wake);
    assert!(zh.starts_with("[PR 更新] #1316"), "{zh}");
    assert!(zh.contains("变更内容："), "{zh}");
    assert!(zh.contains("标题变更：Old → New"), "{zh}");
    assert!(!zh.contains("What changed:"));
}

#[test]
fn the_wake_prompt_stays_within_its_budget() {
    let mut comment = comment_change("c2", "alice");
    if let PrChange::Comment { body, .. } = &mut comment {
        *body = Some("y".repeat(COMMENT_BODY_CAP));
    }
    let wake = wake_with(vec![
        comment,
        PrChange::Checks {
            pass: 0,
            fail: 40,
            total: 40,
            failed: (0..CHECK_ROWS_CAP)
                .map(|i| FailedCheck {
                    name: format!("check-{i}"),
                    state: "FAILURE".into(),
                    description: Some("x".repeat(CHECK_DESC_CAP)),
                })
                .collect(),
            omitted: 15,
        },
    ]);
    let prompt = build_wake_prompt("en", &wake);
    assert!(
        prompt.chars().count() <= PROMPT_CAP,
        "{}",
        prompt.chars().count()
    );
}

#[test]
fn wake_outcome_maps_the_shipped_turn_status() {
    assert_eq!(
        wake_outcome(TurnStatus::TurnStarted, None),
        WakeOutcome::Delivered
    );
    assert_eq!(wake_outcome(TurnStatus::Queued, None), WakeOutcome::Queued);
    assert_eq!(
        wake_outcome(TurnStatus::RetryLater, None),
        WakeOutcome::Retry
    );
    assert_eq!(
        wake_outcome(TurnStatus::AppNotRunning, None),
        WakeOutcome::Retry
    );
    assert_eq!(
        wake_outcome(TurnStatus::Error, Some(" connect failed ")),
        WakeOutcome::Failed("connect failed".into())
    );
    assert_eq!(
        wake_outcome(TurnStatus::NotFound, None),
        WakeOutcome::Failed("NotFound".into())
    );
}

/// Live mount round trip on a real checkout with an authenticated `gh`:
///
/// `cargo test live_watch_round_trip -- --ignored --nocapture`
#[test]
#[ignore = "live gh: needs a real repo and authenticated gh"]
fn live_watch_round_trip() {
    let project = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("repo root")
        .to_string_lossy()
        .to_string();
    let session = "live-session";

    mount(session, &project, 4242, Some(5)).expect("mount");
    let state = session_state(session);
    assert_eq!(state.watches.len(), 1);
    assert_eq!(state.watches[0].pr_number, 4242);
    assert_eq!(state.watches[0].interval_secs, MIN_INTERVAL_SECS);
    assert_eq!(state.watches[0].polls, 0);
    assert!(!state.watches[0].pending);

    // A second session's watches never show up in the first one's state.
    mount("live-session-2", &project, 4243, None).expect("mount other");
    assert_eq!(session_state(session).watches.len(), 1);

    assert!(unmount(session, 4242));
    assert!(!unmount(session, 4242));
    assert!(session_state(session).watches.is_empty());
    assert_eq!(session_state("live-session-2").watches.len(), 1);
    assert!(unmount("live-session-2", 4243));
}

/// Live `gh` round trip through the shipped poll path: argv, runner, parse,
/// fingerprint and the prompt material. Needs network plus an authenticated
/// `gh`, so it stays ignored unless asked for and CI remains hermetic:
///
/// `PR_MONITOR_LIVE_PR=1316 cargo test live_gh_round_trip -- --ignored --nocapture`
#[test]
#[ignore = "live gh: needs network + authenticated gh"]
fn live_gh_round_trip() {
    let Ok(number) =
        std::env::var("PR_MONITOR_LIVE_PR").map(|v| v.trim().parse::<u64>().unwrap_or(0))
    else {
        eprintln!("skipped: set PR_MONITOR_LIVE_PR=<number>");
        return;
    };
    if number == 0 {
        eprintln!("skipped: set PR_MONITOR_LIVE_PR=<number>");
        return;
    }
    // Run in the repo this test lives in (a real checkout with remotes).
    let project = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("repo root")
        .to_string_lossy()
        .to_string();

    let args = gh_view_args(number);
    let argv: Vec<&str> = args.iter().map(String::as_str).collect();
    let out = git_pr_hub::run_gh_in_project(&project, &argv).expect("spawn gh");
    assert!(
        out.status.success(),
        "gh pr view failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );

    let polled = polled_from_gh_json(&String::from_utf8_lossy(&out.stdout)).expect("parse");
    let snap = &polled.snapshot;
    println!(
            "LIVE ok number=#{} state={} checks={} pass/fail/pending={}/{}/{} comments={} rows={} fp={}",
            snap.number,
            snap.state,
            snap.checks.total,
            snap.checks.pass,
            snap.checks.fail,
            snap.checks.pending,
            snap.comments.len(),
            polled.check_rows.len(),
            snapshot_fingerprint(snap)
        );
    assert_eq!(snap.number, number);
    assert!(!snap.title.trim().is_empty());
    assert!(snap.url.contains(&format!("/pull/{number}")));
}
