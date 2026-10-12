//! The follow-up turn the host writes into a chat when a watch moved: the same
//! shape the PR hub's own buttons use, carrying the content the poll already
//! fetched.

use crate::pr_monitor_i18n::{self as text, MessageKey};

use super::text::clamp_text;
use super::types::{FailedCheck, PendingWake, PrChange, PrSnapshot};
use super::{FIELD_CAP, NO_CHECK_ROWS, NO_TITLE, PROMPT_CAP, UNKNOWN_AUTHOR};

///
/// Reuses the shipped PR prompt structure: the header and the change lines are
/// localized, and the actionable blocks (a new comment, a failing CI) carry the
/// content the poll already fetched — no second `gh` call.
pub(super) fn build_wake_prompt(lang: &str, wake: &PendingWake) -> String {
    let number = wake.next.number;
    if number == 0 || wake.changes.is_empty() {
        return String::new();
    }
    let title = clamp_text(
        if wake.next.title.trim().is_empty() {
            NO_TITLE
        } else {
            wake.next.title.trim()
        },
        FIELD_CAP,
    );
    let url = clamp_text(&wake.next.url, 500);
    let header = if url.is_empty() {
        text::render(
            lang,
            MessageKey::PromptHeader,
            &[("number", &number.to_string()), ("title", &title)],
        )
    } else {
        text::render(
            lang,
            MessageKey::PromptHeaderUrl,
            &[
                ("number", &number.to_string()),
                ("title", &title),
                ("url", &url),
            ],
        )
    };

    let mut lines = vec![
        header,
        String::new(),
        text::t(lang, MessageKey::PromptUpdates).to_string(),
    ];
    for line in wake.summary_lines(lang) {
        lines.push(format!("- {line}"));
    }

    if let Some(PrChange::Comment {
        kind,
        author,
        body: Some(body),
        state,
        ..
    }) = wake.newest_comment()
    {
        if !body.trim().is_empty() {
            lines.push(String::new());
            lines.extend(comment_block(
                number,
                &title,
                if author.trim().is_empty() {
                    UNKNOWN_AUTHOR
                } else {
                    author.trim()
                },
                kind,
                state.as_deref(),
                None,
                body,
            ));
        }
    }

    if let Some(PrChange::Checks {
        fail: _,
        failed,
        omitted,
        ..
    }) = wake
        .changes
        .iter()
        .find(|c| matches!(c, PrChange::Checks { fail, .. } if *fail > 0))
    {
        lines.push(String::new());
        lines.extend(fix_ci_block(
            number, &title, &url, &wake.next, failed, *omitted,
        ));
    }

    lines.push(String::new());
    lines.push(text::t(lang, MessageKey::PromptTask).to_string());
    clamp_text(&lines.join("\n"), PROMPT_CAP)
}

/// The shipped fix-CI block (`src/lib/prReviewWorkbench.ts`), host side.
fn fix_ci_block(
    number: u64,
    title: &str,
    url: &str,
    snapshot: &PrSnapshot,
    failed: &[FailedCheck],
    omitted: usize,
) -> Vec<String> {
    let mut lines = vec![
        format!("Please help fix the failing CI checks on pull request #{number}: {title}"),
        String::new(),
        "## PR context".into(),
        format!("- Number: #{number}"),
        format!("- Title: {title}"),
    ];
    if !url.is_empty() {
        lines.push(format!("- URL: {url}"));
    }
    let head = snapshot.head_ref_name.trim();
    let base = snapshot.base_ref_name.trim();
    if !head.is_empty() || !base.is_empty() {
        let branch = match (head.is_empty(), base.is_empty()) {
            (false, false) => format!("{head} → {base}"),
            (false, true) => head.to_string(),
            _ => base.to_string(),
        };
        lines.push(format!("- Branch: {branch}"));
    }
    lines.push(String::new());
    lines.push("## Failed checks".into());
    if failed.is_empty() {
        lines.push(NO_CHECK_ROWS.into());
    } else {
        for row in failed {
            let name = if row.name.trim().is_empty() {
                "(unnamed check)"
            } else {
                row.name.trim()
            };
            let state = if row.state.trim().is_empty() {
                "fail"
            } else {
                row.state.trim()
            };
            match row
                .description
                .as_deref()
                .map(str::trim)
                .filter(|d| !d.is_empty())
            {
                Some(desc) => lines.push(format!("- **{name}** — {state}: {desc}")),
                None => lines.push(format!("- **{name}** — {state}")),
            }
        }
        if omitted > 0 {
            lines.push(format!("…and {omitted} more failed check(s) omitted."));
        }
    }
    lines.push(String::new());
    lines.push("## Task".into());
    lines.push("Diagnose the failures from the project workspace (read logs / failing tests / related files).".into());
    lines.push("Propose and apply minimal fixes so CI can pass. Explain what you changed and how to re-run checks. Do not invent CI results you have not observed.".into());
    lines
}

/// The shipped comment block (`src/lib/prReviewWorkbench.ts`), host side.
fn comment_block(
    number: u64,
    title: &str,
    author: &str,
    kind: &str,
    state: Option<&str>,
    url: Option<&str>,
    body: &str,
) -> Vec<String> {
    let kind = kind.trim().to_ascii_lowercase();
    let kind = match kind.as_str() {
        "review" => "review",
        other if !other.is_empty() => other,
        _ => "comment",
    };
    let mut lines = vec![
        format!("Please help address this {kind} on pull request #{number}: {title}"),
        String::new(),
        "## PR context".into(),
        format!("- Number: #{number}"),
        format!("- Title: {title}"),
        String::new(),
        "## Comment".into(),
        format!("- Author: {author}"),
        format!("- Kind: {kind}"),
    ];
    if let Some(state) = state.map(str::trim).filter(|s| !s.is_empty()) {
        lines.push(format!("- Review state: {state}"));
    }
    if let Some(url) = url.map(str::trim).filter(|s| !s.is_empty()) {
        lines.push(format!("- URL: {url}"));
    }
    lines.push(String::new());
    lines.push("### Body".into());
    lines.push(body.trim().to_string());
    lines.push(String::new());
    lines.push("## Task".into());
    lines.push("Understand the feedback, inspect the relevant code in the project workspace, and implement or propose concrete changes that address it.".into());
    lines.push("If the comment is a question, answer it from the codebase. If it requests changes, make minimal focused edits. Do not invent review history beyond what is shown above.".into());
    lines
}
