//! The payloads a watch carries: the PR as polled, the change set waiting
//! for its chat, and what the UI is pushed.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::git_pr_hub::{GitPrCheckEntry, PrChecksSummary};
use crate::pr_monitor_i18n::{self as text, MessageKey};

use super::UNKNOWN_AUTHOR;

// ── Types ───────────────────────────────────────────────────────────────────

/// One conversation entry (issue comment or review) in a snapshot.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrCommentBrief {
    pub id: String,
    pub author: String,
    /// comment | review
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    pub excerpt: String,
}

/// Everything the UI shows about a watched PR, and nothing else.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrSnapshot {
    pub number: u64,
    pub title: String,
    pub url: String,
    /// OPEN | MERGED | CLOSED ("" when gh did not report one).
    pub state: String,
    pub is_draft: bool,
    /// MERGEABLE | CONFLICTING | UNKNOWN ("" when unknown).
    pub mergeable: String,
    pub head_ref_name: String,
    pub base_ref_name: String,
    pub updated_at: String,
    pub checks: PrChecksSummary,
    /// Newest first, capped at [`SNAPSHOT_COMMENTS`].
    pub comments: Vec<PrCommentBrief>,
}

/// One poll: the snapshot, plus the prompt material that would not fit in it
/// (a comment's full body, the CI rows a fix-CI block names).
#[derive(Debug, Clone)]
pub struct PolledPr {
    pub snapshot: PrSnapshot,
    /// Comment id → full body (redacted, capped).
    pub comment_bodies: HashMap<String, String>,
    pub check_rows: Vec<GitPrCheckEntry>,
}

/// The PR as a watch row shows it. The conversation is left out: only the diff
/// needs it, so a pushed row stays small.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrSnapshotView {
    pub number: u64,
    pub title: String,
    pub url: String,
    pub state: String,
    pub is_draft: bool,
    pub mergeable: String,
    pub head_ref_name: String,
    pub base_ref_name: String,
    pub updated_at: String,
    pub checks: PrChecksSummary,
}

impl From<&PrSnapshot> for PrSnapshotView {
    fn from(s: &PrSnapshot) -> Self {
        Self {
            number: s.number,
            title: s.title.clone(),
            url: s.url.clone(),
            state: s.state.clone(),
            is_draft: s.is_draft,
            mergeable: s.mergeable.clone(),
            head_ref_name: s.head_ref_name.clone(),
            base_ref_name: s.base_ref_name.clone(),
            updated_at: s.updated_at.clone(),
            checks: s.checks.clone(),
        }
    }
}

/// One failing CI row, as a prompt names it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FailedCheck {
    pub name: String,
    pub state: String,
    pub description: Option<String>,
}

/// A change worth waking a session for. Each change owns a `slot`, so the
/// newest observation of the same thing replaces the older one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PrChange {
    Comment {
        kind: String,
        comment_id: String,
        author: String,
        excerpt: String,
        state: Option<String>,
        created_at: Option<String>,
        body: Option<String>,
    },
    Checks {
        pass: u32,
        fail: u32,
        total: u32,
        failed: Vec<FailedCheck>,
        /// Failing rows past [`CHECK_ROWS_CAP`], counted but not listed.
        omitted: usize,
    },
    State {
        from: String,
        to: String,
    },
    Mergeable {
        from: String,
        to: String,
    },
    Title {
        from: String,
        to: String,
    },
}

impl PrChange {
    /// The one thing this change is about; a newer change takes its place.
    fn slot(&self) -> String {
        match self {
            PrChange::Comment {
                kind, comment_id, ..
            } => format!("{kind}:{comment_id}"),
            PrChange::Checks { .. } => "checks".into(),
            PrChange::State { .. } => "state".into(),
            PrChange::Mergeable { .. } => "mergeable".into(),
            PrChange::Title { .. } => "title".into(),
        }
    }

    /// Localized one-line description for the session and the watch row.
    fn describe(&self, lang: &str) -> String {
        match self {
            PrChange::Comment {
                kind,
                author,
                excerpt,
                state,
                ..
            } => {
                let author = if author.trim().is_empty() {
                    UNKNOWN_AUTHOR
                } else {
                    author.trim()
                };
                let state = state.as_deref().map(str::trim).filter(|s| !s.is_empty());
                match (kind.as_str(), state) {
                    ("review", Some(state)) => text::render(
                        lang,
                        MessageKey::UpdateReviewState,
                        &[("author", author), ("state", state), ("excerpt", excerpt)],
                    ),
                    ("review", None) => text::render(
                        lang,
                        MessageKey::UpdateReview,
                        &[("author", author), ("excerpt", excerpt)],
                    ),
                    _ => text::render(
                        lang,
                        MessageKey::UpdateComment,
                        &[("author", author), ("excerpt", excerpt)],
                    ),
                }
            }
            PrChange::Checks {
                pass, fail, total, ..
            } => {
                if *fail > 0 {
                    text::render(
                        lang,
                        MessageKey::UpdateChecksFailed,
                        &[("count", &fail.to_string())],
                    )
                } else {
                    text::render(
                        lang,
                        MessageKey::UpdateChecksPassed,
                        &[("passed", &pass.to_string()), ("total", &total.to_string())],
                    )
                }
            }
            PrChange::State { from, to } => {
                text::render(lang, MessageKey::UpdateState, &[("from", from), ("to", to)])
            }
            PrChange::Mergeable { from, to } => text::render(
                lang,
                MessageKey::UpdateMergeable,
                &[("from", from), ("to", to)],
            ),
            PrChange::Title { from, to } => {
                text::render(lang, MessageKey::UpdateTitle, &[("from", from), ("to", to)])
            }
        }
    }

    /// Where a `from → to` change started, kept while newer values replace it.
    fn start_of(&self) -> Option<&str> {
        match self {
            PrChange::State { from, .. }
            | PrChange::Mergeable { from, .. }
            | PrChange::Title { from, .. } => Some(from),
            _ => None,
        }
    }

    fn set_from(&mut self, from: String) {
        match self {
            PrChange::State { from: slot, .. }
            | PrChange::Mergeable { from: slot, .. }
            | PrChange::Title { from: slot, .. } => *slot = from,
            _ => {}
        }
    }
}

/// One change set waiting to be delivered into its session.
#[derive(Debug, Clone)]
pub struct PendingWake {
    pub(super) changes: Vec<PrChange>,
    /// Newest snapshot (the follow-up is written against this one).
    pub(super) next: PrSnapshot,
    /// When the first undelivered change arrived.
    pub(super) first_at: String,
    /// When the last change joined.
    pub(super) last_at: String,
    pub(super) attempts: u32,
    /// The "will follow up when this chat is free" notice was already sent.
    pub(super) reported_waiting: bool,
}

impl PendingWake {
    pub(super) fn new(next: PrSnapshot, changes: Vec<PrChange>, at: String) -> Self {
        Self {
            changes,
            next,
            first_at: at.clone(),
            last_at: at,
            attempts: 0,
            reported_waiting: false,
        }
    }

    /// Fold newer observations in: one entry per slot, the newest wins, and a
    /// `from → to` pair keeps the value it started from.
    pub(super) fn fold(&mut self, newer: PendingWake) {
        for change in newer.changes {
            match self.changes.iter_mut().find(|c| c.slot() == change.slot()) {
                Some(existing) => {
                    let from = existing.start_of().map(str::to_string);
                    *existing = change;
                    if let Some(from) = from {
                        existing.set_from(from);
                    }
                }
                None => self.changes.push(change),
            }
        }
        self.next = newer.next;
        self.last_at = newer.last_at;
    }

    /// Changes in the order a reader expects: newest comment first, then CI,
    /// state, mergeability and title.
    pub(super) fn ordered(&self) -> Vec<&PrChange> {
        let mut comments: Vec<&PrChange> = self
            .changes
            .iter()
            .filter(|c| matches!(c, PrChange::Comment { .. }))
            .collect();
        comments.sort_by_key(|c| std::cmp::Reverse(comment_sort_key(c)));
        let mut out = comments;
        for slot in ["checks", "state", "mergeable", "title"] {
            out.extend(self.changes.iter().filter(|c| c.slot() == slot));
        }
        out
    }

    pub(super) fn summary_lines(&self, lang: &str) -> Vec<String> {
        self.ordered().iter().map(|c| c.describe(lang)).collect()
    }

    /// One line for the whole pending change set (watch rows and toasts).
    pub(super) fn summary(&self, lang: &str) -> String {
        self.ordered()
            .first()
            .map(|c| c.describe(lang))
            .unwrap_or_default()
    }

    pub(super) fn newest_comment(&self) -> Option<&PrChange> {
        self.changes
            .iter()
            .filter(|c| matches!(c, PrChange::Comment { .. }))
            .max_by_key(|c| comment_sort_key(c))
    }
}

fn comment_sort_key(change: &PrChange) -> (String, String) {
    match change {
        PrChange::Comment {
            created_at,
            comment_id,
            ..
        } => (created_at.clone().unwrap_or_default(), comment_id.clone()),
        _ => (String::new(), String::new()),
    }
}

/// Serializable view of one watch (the host is the source of truth for mounts).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrWatchInfo {
    pub session_id: String,
    pub project_path: String,
    pub pr_number: u64,
    pub interval_secs: u64,
    pub mounted_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_poll_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_update_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    pub polls: u64,
    pub updates: u64,
    /// TERMINAL once the PR merged or closed — the watch is then dropped.
    pub terminal: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub snapshot: Option<PrSnapshotView>,
    /// Localized summary of the last delivered change ("" until one lands).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_change: Option<String>,
    /// A wake for this PR is waiting for its session.
    pub pending: bool,
}

/// Every watch one session holds (pushed after any change to them).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrMonitorState {
    pub session_id: String,
    pub watches: Vec<PrWatchInfo>,
}

/// One wake's outcome, pushed to the UI.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrMonitorWake {
    pub session_id: String,
    pub pr_number: u64,
    /// queued | delivered | settled | failed
    pub status: String,
    /// Localized summary of what woke the session.
    pub summary: String,
    /// The PR state this wake was written against (OPEN | MERGED | CLOSED).
    pub pr_state: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// A wake is still waiting for this PR.
    pub pending: bool,
    pub at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrMonitorWatchResult {
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrMonitorUnwatchResult {
    pub ok: bool,
    pub removed: bool,
}

/// What the monitor does with a wake once the shipped turn path answered.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WakeOutcome {
    /// The session took the turn.
    Delivered,
    /// The session was mid-turn; the shipped queue holds the turn now.
    Queued,
    /// The host was wedged — keep the wake and try again on the next tick.
    Retry,
    /// The wake cannot be delivered; report why and drop it.
    Failed(String),
}
