//! Project-level GitHub PR hub via `gh pr list|view|checks` + comments (argv, no shell).
//!
//! Soft-fails when `gh` / `git` is missing or the path is not a git work tree.
//! Pure JSON parsers are unit-tested; host commands use enriched PATH (incl. `~/.grok/bin`).
//! Comments load from `gh pr view --json comments,reviews,url,number`.

use std::path::{Path, PathBuf};
use std::process::Output;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::process_util;

const GH_PR_TIMEOUT_SECS: u64 = 45;
const LIST_CAP: usize = 100;
const BODY_CAP: usize = 20_000;
const CHECKS_CAP: usize = 200;
const COMMENTS_CAP: usize = 50;
const EXCERPT_CAP: usize = 200;

const LIST_JSON_FIELDS: &str = "number,title,author,url,mergeable,state,headRefName,baseRefName,isDraft,statusCheckRollup,createdAt,updatedAt";
/// PR fields shared by `pr list` and `pr view`; PR monitors extend it with
/// `comments,reviews` so one call covers a whole poll.
pub const VIEW_JSON_FIELDS: &str = "number,title,author,url,mergeable,state,headRefName,baseRefName,isDraft,statusCheckRollup,createdAt,updatedAt,body";
const CHECKS_JSON_FIELDS: &str = "name,state,bucket,link,description,workflow";
const COMMENTS_JSON_FIELDS: &str = "number,url,comments,reviews";

// ── Types ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct PrChecksSummary {
    pub pass: u32,
    pub fail: u32,
    pub pending: u32,
    pub skipping: u32,
    pub cancel: u32,
    pub total: u32,
    /// pass | fail | pending | mixed | none | unknown
    pub overall: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitPrHubEntry {
    pub number: u64,
    pub title: String,
    pub url: String,
    pub author: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author_login: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
    #[serde(default)]
    pub is_draft: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mergeable: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub head_ref_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_ref_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checks: Option<PrChecksSummary>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitPrCheckEntry {
    pub name: String,
    pub state: String,
    /// pass | fail | pending | skipping | cancel
    pub bucket: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub link: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workflow: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPrHubListResult {
    pub available: bool,
    pub prs: Vec<GitPrHubEntry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub gh_found: bool,
    #[serde(default)]
    pub git_found: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPrHubViewResult {
    pub available: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pr: Option<GitPrHubEntry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub gh_found: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPrChecksResult {
    pub available: bool,
    pub checks: Vec<GitPrCheckEntry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<PrChecksSummary>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub gh_found: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pr_number: Option<u64>,
}

/// Issue comment or review body on a PR conversation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitPrCommentEntry {
    pub id: String,
    pub author: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author_login: Option<String>,
    pub body: String,
    pub excerpt: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    /// comment | review
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPrCommentsResult {
    pub available: bool,
    pub comments: Vec<GitPrCommentEntry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub gh_found: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pr_number: Option<u64>,
    /// PR conversation URL.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

// ── Pure helpers ────────────────────────────────────────────────────────────

fn empty_summary() -> PrChecksSummary {
    PrChecksSummary {
        pass: 0,
        fail: 0,
        pending: 0,
        skipping: 0,
        cancel: 0,
        total: 0,
        overall: "none".into(),
    }
}

fn json_str(item: &serde_json::Value, keys: &[&str]) -> Option<String> {
    for k in keys {
        if let Some(s) = item.get(*k).and_then(|v| v.as_str()) {
            let t = s.trim();
            if !t.is_empty() {
                return Some(t.to_string());
            }
        }
    }
    None
}

fn json_u64(item: &serde_json::Value, keys: &[&str]) -> Option<u64> {
    for k in keys {
        if let Some(n) = item.get(*k).and_then(|v| v.as_u64()) {
            return Some(n);
        }
        if let Some(n) = item.get(*k).and_then(|v| v.as_i64()) {
            if n > 0 {
                return Some(n as u64);
            }
        }
        if let Some(s) = item.get(*k).and_then(|v| v.as_str()) {
            if let Ok(n) = s.trim().parse::<u64>() {
                if n > 0 {
                    return Some(n);
                }
            }
        }
    }
    None
}

fn json_bool(item: &serde_json::Value, keys: &[&str]) -> bool {
    for k in keys {
        if let Some(b) = item.get(*k).and_then(|v| v.as_bool()) {
            return b;
        }
    }
    false
}

/// Map check conclusion / state / bucket into a coarse bucket.
pub fn bucket_from_check_fields(
    bucket: Option<&str>,
    state: Option<&str>,
    conclusion: Option<&str>,
    status: Option<&str>,
) -> String {
    let b = bucket.unwrap_or("").trim().to_ascii_lowercase();
    if matches!(
        b.as_str(),
        "pass" | "fail" | "pending" | "skipping" | "cancel"
    ) {
        return b;
    }

    let conclusion = conclusion.unwrap_or("").trim().to_ascii_uppercase();
    let state = state.unwrap_or("").trim().to_ascii_uppercase();
    let status = status.unwrap_or("").trim().to_ascii_uppercase();

    let terminal = if !conclusion.is_empty() {
        conclusion.as_str()
    } else if !state.is_empty()
        && !matches!(
            state.as_str(),
            "PENDING" | "QUEUED" | "IN_PROGRESS" | "WAITING" | "REQUESTED" | "EXPECTED"
        )
    {
        state.as_str()
    } else {
        ""
    };

    match terminal {
        "SUCCESS" | "NEUTRAL" | "PASS" | "PASSED" => return "pass".into(),
        "FAILURE" | "FAILED" | "ERROR" | "TIMED_OUT" | "ACTION_REQUIRED" | "STARTUP_FAILURE" => {
            return "fail".into()
        }
        "CANCELLED" | "CANCELED" => return "cancel".into(),
        "SKIPPED" | "STALE" => return "skipping".into(),
        _ => {}
    }

    if matches!(
        status.as_str(),
        "IN_PROGRESS" | "QUEUED" | "PENDING" | "WAITING" | "REQUESTED" | "EXPECTED"
    ) || matches!(state.as_str(), "PENDING" | "QUEUED" | "IN_PROGRESS")
    {
        return "pending".into();
    }

    if terminal.is_empty() && status.is_empty() && state.is_empty() {
        return "pending".into();
    }
    "unknown".into()
}

pub fn overall_from_counts(s: &PrChecksSummary) -> String {
    if s.total == 0 {
        return "none".into();
    }
    if s.fail > 0 {
        return "fail".into();
    }
    if s.pending > 0 {
        return "pending".into();
    }
    if s.cancel > 0 && s.pass == 0 {
        return "mixed".into();
    }
    if s.pass > 0 {
        return "pass".into();
    }
    "mixed".into()
}

pub fn summarize_buckets(buckets: impl IntoIterator<Item = String>) -> PrChecksSummary {
    let mut s = empty_summary();
    for b in buckets {
        let key = b.to_ascii_lowercase();
        match key.as_str() {
            "pass" => s.pass += 1,
            "fail" => s.fail += 1,
            "pending" => s.pending += 1,
            "skipping" => s.skipping += 1,
            "cancel" => s.cancel += 1,
            _ => s.pending += 1,
        }
        s.total += 1;
    }
    s.overall = overall_from_counts(&s);
    s
}

/// Summarize GraphQL `statusCheckRollup` array from `gh pr list/view --json`.
pub fn summarize_status_check_rollup(rollup: &serde_json::Value) -> PrChecksSummary {
    let Some(arr) = rollup.as_array() else {
        return empty_summary();
    };
    if arr.is_empty() {
        return empty_summary();
    }
    let buckets: Vec<String> = arr
        .iter()
        .filter(|row| row.is_object())
        .map(|row| {
            bucket_from_check_fields(
                row.get("bucket").and_then(|v| v.as_str()),
                row.get("state").and_then(|v| v.as_str()),
                row.get("conclusion").and_then(|v| v.as_str()),
                row.get("status").and_then(|v| v.as_str()),
            )
        })
        .collect();
    summarize_buckets(buckets)
}

fn author_from_value(raw: Option<&serde_json::Value>) -> (String, Option<String>) {
    let Some(raw) = raw else {
        return (String::new(), None);
    };
    if let Some(s) = raw.as_str() {
        let t = s.trim();
        if t.is_empty() {
            return (String::new(), None);
        }
        return (t.to_string(), Some(t.to_string()));
    }
    if raw.is_object() {
        let login = json_str(raw, &["login", "name", "id"]);
        return (login.clone().unwrap_or_default(), login);
    }
    (String::new(), None)
}

/// Parse one PR object from gh JSON.
pub fn parse_gh_pr_object(raw: &serde_json::Value) -> Option<GitPrHubEntry> {
    if !raw.is_object() {
        return None;
    }
    let number = json_u64(raw, &["number", "Number"])?;
    if number == 0 {
        return None;
    }
    let title = json_str(raw, &["title", "Title"]).unwrap_or_default();
    let url =
        json_str(raw, &["url", "URL", "htmlUrl", "html_url", "permalink"]).unwrap_or_default();
    let (author, author_login) = author_from_value(raw.get("author"));
    let state = json_str(raw, &["state", "State"]);
    let is_draft = json_bool(raw, &["isDraft", "is_draft", "draft"]);
    let mergeable = json_str(raw, &["mergeable", "mergeableState", "mergeable_state"]);
    let head_ref_name = json_str(raw, &["headRefName", "head_ref_name", "headBranch", "head"]);
    let base_ref_name = json_str(raw, &["baseRefName", "base_ref_name", "baseBranch", "base"]);
    let created_at = json_str(raw, &["createdAt", "created_at"]);
    let updated_at = json_str(raw, &["updatedAt", "updated_at"]);
    let mut body = json_str(raw, &["body", "Body"]);
    if let Some(ref mut b) = body {
        if b.chars().count() > BODY_CAP {
            *b = b.chars().take(BODY_CAP).collect();
        }
    }
    let rollup = raw
        .get("statusCheckRollup")
        .or_else(|| raw.get("status_check_rollup"))
        .or_else(|| raw.get("checks"));
    let checks = rollup
        .filter(|v| v.is_array())
        .map(summarize_status_check_rollup);

    Some(GitPrHubEntry {
        number,
        title,
        url,
        author,
        author_login,
        state,
        is_draft,
        mergeable,
        head_ref_name,
        base_ref_name,
        created_at,
        updated_at,
        checks,
        body,
    })
}

fn parse_json_value(stdout: &str) -> Result<serde_json::Value, String> {
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return Err("empty JSON".into());
    }
    let start = trimmed
        .find(['[', '{'])
        .ok_or_else(|| "no JSON object/array".to_string())?;
    serde_json::from_str(&trimmed[start..]).map_err(|e| format!("invalid JSON: {e}"))
}

/// Pure parse for `gh pr list --json` stdout.
pub fn parse_gh_pr_list_json(stdout: &str) -> Result<Vec<GitPrHubEntry>, String> {
    let value = match parse_json_value(stdout) {
        Ok(v) => v,
        Err(_) if stdout.trim().is_empty() => return Ok(Vec::new()),
        Err(e) => return Err(e),
    };
    let items: Vec<serde_json::Value> = if let Some(arr) = value.as_array() {
        arr.clone()
    } else if let Some(arr) = value
        .get("pullRequests")
        .or_else(|| value.get("prs"))
        .or_else(|| value.get("items"))
        .or_else(|| value.get("data"))
        .and_then(|v| v.as_array())
    {
        arr.clone()
    } else {
        return Ok(Vec::new());
    };

    let mut out = Vec::with_capacity(items.len().min(LIST_CAP));
    for item in items {
        if let Some(pr) = parse_gh_pr_object(&item) {
            out.push(pr);
            if out.len() >= LIST_CAP {
                break;
            }
        }
    }
    Ok(out)
}

/// Pure parse for `gh pr view --json` stdout.
pub fn parse_gh_pr_view_json(stdout: &str) -> Result<Option<GitPrHubEntry>, String> {
    if stdout.trim().is_empty() {
        return Ok(None);
    }
    let value = parse_json_value(stdout)?;
    if let Some(arr) = value.as_array() {
        return Ok(arr.first().and_then(parse_gh_pr_object));
    }
    Ok(parse_gh_pr_object(&value))
}

/// Pure parse for one check row.
pub fn parse_gh_pr_check_object(raw: &serde_json::Value) -> Option<GitPrCheckEntry> {
    if !raw.is_object() {
        return None;
    }
    let name = json_str(raw, &["name", "Name", "context"])?;
    let state = json_str(raw, &["state", "State", "conclusion"]).unwrap_or_default();
    let bucket = bucket_from_check_fields(
        json_str(raw, &["bucket", "Bucket"]).as_deref(),
        Some(&state),
        json_str(raw, &["conclusion", "Conclusion"]).as_deref(),
        json_str(raw, &["status", "Status"]).as_deref(),
    );
    let link = json_str(raw, &["link", "Link", "detailsUrl", "details_url", "url"]);
    let description = json_str(raw, &["description", "Description"]);
    let workflow = json_str(raw, &["workflow", "Workflow", "workflowName"]);
    Some(GitPrCheckEntry {
        name,
        state: if state.is_empty() {
            bucket.clone()
        } else {
            state
        },
        bucket,
        link,
        description,
        workflow,
    })
}

/// Pure parse for `gh pr checks --json` stdout.
pub fn parse_gh_pr_checks_json(stdout: &str) -> Result<Vec<GitPrCheckEntry>, String> {
    if stdout.trim().is_empty() {
        return Ok(Vec::new());
    }
    let value = parse_json_value(stdout)?;
    let items: Vec<serde_json::Value> = if let Some(arr) = value.as_array() {
        arr.clone()
    } else if let Some(arr) = value
        .get("checks")
        .or_else(|| value.get("items"))
        .or_else(|| value.get("data"))
        .and_then(|v| v.as_array())
    {
        arr.clone()
    } else {
        return Ok(Vec::new());
    };
    let mut out = Vec::with_capacity(items.len().min(CHECKS_CAP));
    for item in items {
        if let Some(c) = parse_gh_pr_check_object(&item) {
            out.push(c);
            if out.len() >= CHECKS_CAP {
                break;
            }
        }
    }
    Ok(out)
}

pub fn summarize_checks(checks: &[GitPrCheckEntry]) -> PrChecksSummary {
    if checks.is_empty() {
        return empty_summary();
    }
    summarize_buckets(checks.iter().map(|c| c.bucket.clone()))
}

/// Collapse body to a single-line excerpt for list rows.
pub fn excerpt_comment_body(body: &str, max: usize) -> String {
    let flat: String = body
        .replace("\r\n", "\n")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let flat = flat.trim();
    if flat.is_empty() {
        return String::new();
    }
    if flat.chars().count() <= max {
        return flat.to_string();
    }
    let take = max.saturating_sub(1).max(1);
    let mut out: String = flat.chars().take(take).collect();
    while out.ends_with(char::is_whitespace) {
        out.pop();
    }
    out.push('…');
    out
}

fn id_from_value(raw: Option<&serde_json::Value>) -> Option<String> {
    let raw = raw?;
    if let Some(s) = raw.as_str() {
        let t = s.trim();
        if !t.is_empty() {
            return Some(t.to_string());
        }
    }
    if let Some(n) = raw.as_u64() {
        return Some(n.to_string());
    }
    if let Some(n) = raw.as_i64() {
        return Some(n.to_string());
    }
    None
}

fn cap_body(mut body: String) -> String {
    if body.chars().count() > BODY_CAP {
        body = body.chars().take(BODY_CAP).collect();
    }
    body
}

/// Parse one issue comment from `gh pr view --json comments`.
pub fn parse_gh_pr_comment_object(raw: &serde_json::Value) -> Option<GitPrCommentEntry> {
    if !raw.is_object() {
        return None;
    }
    let body_raw = json_str(raw, &["body", "Body", "bodyText"]).unwrap_or_default();
    let (author, author_login) = author_from_value(raw.get("author").or_else(|| raw.get("user")));
    if body_raw.trim().is_empty() && author.is_empty() {
        return None;
    }
    let created_at = json_str(raw, &["createdAt", "created_at", "publishedAt"]);
    let id = id_from_value(raw.get("id"))
        .or_else(|| id_from_value(raw.get("databaseId")))
        .or_else(|| id_from_value(raw.get("node_id")))
        .unwrap_or_else(|| format!("comment:{}:{}", author, created_at.as_deref().unwrap_or("")));
    let body = cap_body(body_raw);
    let excerpt = excerpt_comment_body(&body, EXCERPT_CAP);
    let url = json_str(raw, &["url", "URL", "htmlUrl", "html_url", "permalink"]);
    Some(GitPrCommentEntry {
        id,
        author,
        author_login,
        body,
        excerpt,
        url,
        created_at,
        kind: "comment".into(),
        state: None,
    })
}

/// Parse one review from `gh pr view --json reviews`.
pub fn parse_gh_pr_review_object(raw: &serde_json::Value) -> Option<GitPrCommentEntry> {
    if !raw.is_object() {
        return None;
    }
    let body_raw = json_str(raw, &["body", "Body", "bodyText"]).unwrap_or_default();
    let state = json_str(raw, &["state", "State"]);
    let (author, author_login) = author_from_value(raw.get("author").or_else(|| raw.get("user")));
    if body_raw.trim().is_empty() && state.is_none() && author.is_empty() {
        return None;
    }
    if body_raw.trim().is_empty() {
        if let Some(ref st) = state {
            if st.eq_ignore_ascii_case("PENDING") {
                return None;
            }
        }
    }
    let created_at = json_str(
        raw,
        &[
            "submittedAt",
            "submitted_at",
            "createdAt",
            "created_at",
            "publishedAt",
        ],
    );
    let id = id_from_value(raw.get("id"))
        .or_else(|| id_from_value(raw.get("databaseId")))
        .or_else(|| id_from_value(raw.get("node_id")))
        .unwrap_or_else(|| format!("review:{}:{}", author, created_at.as_deref().unwrap_or("")));
    let body = cap_body(body_raw);
    let mut excerpt = excerpt_comment_body(&body, EXCERPT_CAP);
    if excerpt.is_empty() {
        if let Some(ref st) = state {
            excerpt = st.trim().to_string();
        }
    }
    let url = json_str(raw, &["url", "URL", "htmlUrl", "html_url", "permalink"]);
    Some(GitPrCommentEntry {
        id,
        author,
        author_login,
        body,
        excerpt,
        url,
        created_at,
        kind: "review".into(),
        state,
    })
}

/// Merge issue comments + reviews, newest first, capped; dedupe by id.
/// ISO-8601 timestamps (gh default) sort correctly via lexicographic compare.
pub fn merge_pr_comments(
    comments: Vec<GitPrCommentEntry>,
    reviews: Vec<GitPrCommentEntry>,
    cap: usize,
) -> Vec<GitPrCommentEntry> {
    let mut seen = std::collections::HashSet::new();
    let mut merged = Vec::new();
    for c in comments.into_iter().chain(reviews) {
        if c.id.is_empty() || !seen.insert(c.id.clone()) {
            continue;
        }
        merged.push(c);
    }
    merged.sort_by(|a, b| {
        let ba = b.created_at.as_deref().unwrap_or("");
        let aa = a.created_at.as_deref().unwrap_or("");
        ba.cmp(aa)
    });
    if merged.len() > cap {
        merged.truncate(cap);
    }
    merged
}

/// Pure parse for `gh pr view --json comments,reviews,url,number`.
#[allow(clippy::type_complexity)]
pub fn parse_gh_pr_comments_json(
    stdout: &str,
) -> Result<(Vec<GitPrCommentEntry>, Option<String>, Option<u64>), String> {
    if stdout.trim().is_empty() {
        return Ok((Vec::new(), None, None));
    }
    let value = parse_json_value(stdout)?;
    if let Some(arr) = value.as_array() {
        let mut comments = Vec::new();
        for item in arr {
            if let Some(c) = parse_gh_pr_comment_object(item) {
                comments.push(c);
                if comments.len() >= COMMENTS_CAP {
                    break;
                }
            }
        }
        return Ok((comments, None, None));
    }
    if !value.is_object() {
        return Ok((Vec::new(), None, None));
    }
    let url = json_str(&value, &["url", "URL", "htmlUrl", "html_url"]);
    let number = json_u64(&value, &["number", "Number"]);

    let mut comments = Vec::new();
    if let Some(arr) = value
        .get("comments")
        .or_else(|| value.get("issueComments"))
        .and_then(|v| v.as_array())
    {
        for item in arr {
            if let Some(c) = parse_gh_pr_comment_object(item) {
                comments.push(c);
            }
        }
    }
    let mut reviews = Vec::new();
    if let Some(arr) = value
        .get("reviews")
        .or_else(|| value.get("latestReviews"))
        .and_then(|v| v.as_array())
    {
        for item in arr {
            if let Some(r) = parse_gh_pr_review_object(item) {
                reviews.push(r);
            }
        }
    }
    Ok((
        merge_pr_comments(comments, reviews, COMMENTS_CAP),
        url,
        number,
    ))
}

// ── Host probe / run ────────────────────────────────────────────────────────

fn normalize_project_path(project_path: &str) -> String {
    let mut p = project_path.trim().replace('\\', "/");
    while p.len() > 1 && p.ends_with('/') {
        p.pop();
    }
    p
}

fn truncate_reason(s: &str, max: usize) -> String {
    let t = s.trim();
    if t.chars().count() <= max {
        t.to_string()
    } else {
        t.chars().take(max).collect()
    }
}

fn probe_git_work_tree(project: &str) -> Result<(), String> {
    let mut git_ver = process_util::command("git");
    if let Some(path_env) = process_util::enriched_path_env() {
        git_ver.env("PATH", &path_env);
    }
    let git_ok = git_ver
        .arg("--version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    if !git_ok {
        return Err("git not available".into());
    }
    let mut inside = process_util::command("git");
    if let Some(path_env) = process_util::enriched_path_env() {
        inside.env("PATH", path_env);
    }
    let out = inside
        .args(["-C", project, "rev-parse", "--is-inside-work-tree"])
        .output();
    let inside_ok = out
        .as_ref()
        .map(|o| o.status.success() && String::from_utf8_lossy(&o.stdout).trim() == "true")
        .unwrap_or(false);
    if !inside_ok {
        return Err("not a git repository".into());
    }
    Ok(())
}

fn probe_gh() -> bool {
    let mut cmd = process_util::command("gh");
    if let Some(path_env) = process_util::enriched_path_env() {
        cmd.env("PATH", path_env);
    }
    cmd.arg("--version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

pub(crate) fn run_gh_in_project(project: &str, args: &[&str]) -> Result<Output, String> {
    let mut cmd = process_util::command("gh");
    if let Some(path_env) = process_util::enriched_path_env() {
        cmd.env("PATH", path_env);
    }
    cmd.current_dir(Path::new(project));
    cmd.args(args);
    // Avoid interactive auth prompts hanging the host.
    cmd.env("GH_PROMPT_DISABLED", "1");
    cmd.env("GIT_TERMINAL_PROMPT", "0");
    // `--json` stdout is parsed: a colored terminal must not wrap it in ANSI.
    process_util::apply_no_color_env_std(&mut cmd);

    // Best-effort timeout via spawn + wait (sync path for Tauri command).
    let mut child = cmd
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to spawn gh: {e}"))?;

    let timeout = Duration::from_secs(GH_PR_TIMEOUT_SECS);
    let start = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {
                if start.elapsed() > timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!("gh timed out after {}s", GH_PR_TIMEOUT_SECS));
                }
                std::thread::sleep(Duration::from_millis(40));
            }
            Err(e) => return Err(format!("gh wait failed: {e}")),
        }
    }
    child
        .wait_with_output()
        .map_err(|e| format!("gh output failed: {e}"))
}

fn soft_fail_list(
    reason: impl Into<String>,
    gh_found: bool,
    git_found: bool,
) -> GitPrHubListResult {
    GitPrHubListResult {
        available: false,
        prs: vec![],
        reason: Some(reason.into()),
        gh_found,
        git_found,
        repo: None,
    }
}

fn soft_fail_view(reason: impl Into<String>, gh_found: bool) -> GitPrHubViewResult {
    GitPrHubViewResult {
        available: false,
        pr: None,
        reason: Some(reason.into()),
        gh_found,
    }
}

fn soft_fail_checks(
    reason: impl Into<String>,
    gh_found: bool,
    pr_number: Option<u64>,
) -> GitPrChecksResult {
    GitPrChecksResult {
        available: false,
        checks: vec![],
        summary: None,
        reason: Some(reason.into()),
        gh_found,
        pr_number,
    }
}

fn soft_fail_comments(
    reason: impl Into<String>,
    gh_found: bool,
    pr_number: Option<u64>,
) -> GitPrCommentsResult {
    GitPrCommentsResult {
        available: false,
        comments: vec![],
        reason: Some(reason.into()),
        gh_found,
        pr_number,
        url: None,
    }
}

/// Normalize + probe a project folder for GitHub PR reads (also used by the
/// PR monitor, which needs the same "is this a usable repo with gh" gate).
pub(crate) fn prepare_project(project_path: &str) -> Result<String, (String, bool, bool)> {
    let project = normalize_project_path(project_path);
    if project.is_empty() {
        return Err(("empty path".into(), false, false));
    }
    let proj = PathBuf::from(&project);
    if !proj.is_dir() {
        return Err(("project not a directory".into(), false, false));
    }
    if let Err(reason) = probe_git_work_tree(&project) {
        let git_found = !reason.contains("git not available");
        return Err((reason, false, git_found));
    }
    if !probe_gh() {
        return Err(("gh not available".into(), false, true));
    }
    Ok(project)
}

// ── Tauri commands ──────────────────────────────────────────────────────────

/// List pull requests for the git project at `project_path` (`gh pr list --json`).
/// Soft-fails when gh/git missing or path is not a repo.
#[tauri::command]
pub async fn git_pr_list(
    project_path: String,
    limit: Option<u32>,
    state: Option<String>,
) -> Result<GitPrHubListResult, String> {
    let project = match prepare_project(&project_path) {
        Ok(p) => p,
        Err((reason, gh_found, git_found)) => {
            return Ok(soft_fail_list(reason, gh_found, git_found));
        }
    };

    let lim = limit.unwrap_or(30).clamp(1, LIST_CAP as u32);
    let st = state
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("open");
    // Only allow known states (avoid flag injection via state string).
    let st = match st.to_ascii_lowercase().as_str() {
        "open" | "closed" | "merged" | "all" => st.to_ascii_lowercase(),
        _ => "open".into(),
    };

    let lim_s = lim.to_string();
    let out = match run_gh_in_project(
        &project,
        &[
            "pr",
            "list",
            "--state",
            &st,
            "--limit",
            &lim_s,
            "--json",
            LIST_JSON_FIELDS,
        ],
    ) {
        Ok(o) => o,
        Err(e) => return Ok(soft_fail_list(e, true, true)),
    };

    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        let msg = if err.trim().is_empty() {
            String::from_utf8_lossy(&out.stdout).to_string()
        } else {
            err.to_string()
        };
        return Ok(soft_fail_list(
            truncate_reason(
                if msg.trim().is_empty() {
                    "gh pr list failed"
                } else {
                    msg.trim()
                },
                240,
            ),
            true,
            true,
        ));
    }

    let raw = String::from_utf8_lossy(&out.stdout);
    let prs = parse_gh_pr_list_json(&raw).unwrap_or_default();
    Ok(GitPrHubListResult {
        available: true,
        prs,
        reason: None,
        gh_found: true,
        git_found: true,
        repo: None,
    })
}

/// View a single pull request (`gh pr view <n> --json`).
#[tauri::command]
pub async fn git_pr_view(project_path: String, number: u64) -> Result<GitPrHubViewResult, String> {
    if number == 0 {
        return Ok(soft_fail_view("invalid PR number", false));
    }
    let project = match prepare_project(&project_path) {
        Ok(p) => p,
        Err((reason, gh_found, _)) => {
            return Ok(soft_fail_view(reason, gh_found));
        }
    };

    let num_s = number.to_string();
    let out = match run_gh_in_project(
        &project,
        &["pr", "view", &num_s, "--json", VIEW_JSON_FIELDS],
    ) {
        Ok(o) => o,
        Err(e) => return Ok(soft_fail_view(e, true)),
    };

    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        let msg = if err.trim().is_empty() {
            String::from_utf8_lossy(&out.stdout).to_string()
        } else {
            err.to_string()
        };
        return Ok(soft_fail_view(
            truncate_reason(
                if msg.trim().is_empty() {
                    "gh pr view failed"
                } else {
                    msg.trim()
                },
                240,
            ),
            true,
        ));
    }

    let raw = String::from_utf8_lossy(&out.stdout);
    match parse_gh_pr_view_json(&raw) {
        Ok(Some(pr)) => Ok(GitPrHubViewResult {
            available: true,
            pr: Some(pr),
            reason: None,
            gh_found: true,
        }),
        Ok(None) => Ok(soft_fail_view("PR not found", true)),
        Err(e) => Ok(soft_fail_view(e, true)),
    }
}

/// List CI checks for a PR (`gh pr checks <n> --json`).
#[tauri::command]
pub async fn git_pr_checks(project_path: String, number: u64) -> Result<GitPrChecksResult, String> {
    if number == 0 {
        return Ok(soft_fail_checks("invalid PR number", false, None));
    }
    let project = match prepare_project(&project_path) {
        Ok(p) => p,
        Err((reason, gh_found, _)) => {
            return Ok(soft_fail_checks(reason, gh_found, Some(number)));
        }
    };

    let num_s = number.to_string();
    let out = match run_gh_in_project(
        &project,
        &["pr", "checks", &num_s, "--json", CHECKS_JSON_FIELDS],
    ) {
        Ok(o) => o,
        Err(e) => return Ok(soft_fail_checks(e, true, Some(number))),
    };

    // `gh pr checks` exits non-zero when checks are failing/pending — still parse JSON.
    let raw_out = String::from_utf8_lossy(&out.stdout);
    let raw_err = String::from_utf8_lossy(&out.stderr);
    let raw = if raw_out.trim().starts_with('[') || raw_out.trim().starts_with('{') {
        raw_out.to_string()
    } else if raw_err.trim().starts_with('[') || raw_err.trim().starts_with('{') {
        raw_err.to_string()
    } else {
        raw_out.to_string()
    };

    if raw.trim().is_empty() && !out.status.success() {
        let msg = raw_err.trim();
        return Ok(soft_fail_checks(
            truncate_reason(
                if msg.is_empty() {
                    "gh pr checks failed"
                } else {
                    msg
                },
                240,
            ),
            true,
            Some(number),
        ));
    }

    match parse_gh_pr_checks_json(&raw) {
        Ok(checks) => {
            let summary = summarize_checks(&checks);
            Ok(GitPrChecksResult {
                available: true,
                checks,
                summary: Some(summary),
                reason: None,
                gh_found: true,
                pr_number: Some(number),
            })
        }
        Err(e) => Ok(soft_fail_checks(e, true, Some(number))),
    }
}

/// List recent conversation comments + reviews for a PR
/// (`gh pr view <n> --json comments,reviews,url,number`). Soft-fails when gh/git missing.
#[tauri::command]
pub async fn git_pr_comments(
    project_path: String,
    number: u64,
) -> Result<GitPrCommentsResult, String> {
    if number == 0 {
        return Ok(soft_fail_comments("invalid PR number", false, None));
    }
    let project = match prepare_project(&project_path) {
        Ok(p) => p,
        Err((reason, gh_found, _)) => {
            return Ok(soft_fail_comments(reason, gh_found, Some(number)));
        }
    };

    let num_s = number.to_string();
    let out = match run_gh_in_project(
        &project,
        &["pr", "view", &num_s, "--json", COMMENTS_JSON_FIELDS],
    ) {
        Ok(o) => o,
        Err(e) => return Ok(soft_fail_comments(e, true, Some(number))),
    };

    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        let msg = if err.trim().is_empty() {
            String::from_utf8_lossy(&out.stdout).to_string()
        } else {
            err.to_string()
        };
        return Ok(soft_fail_comments(
            truncate_reason(
                if msg.trim().is_empty() {
                    "gh pr view comments failed"
                } else {
                    msg.trim()
                },
                240,
            ),
            true,
            Some(number),
        ));
    }

    let raw = String::from_utf8_lossy(&out.stdout);
    match parse_gh_pr_comments_json(&raw) {
        Ok((comments, url, parsed_number)) => Ok(GitPrCommentsResult {
            available: true,
            comments,
            reason: None,
            gh_found: true,
            pr_number: parsed_number.or(Some(number)),
            url,
        }),
        Err(e) => Ok(soft_fail_comments(e, true, Some(number))),
    }
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_LIST: &str = r#"[
      {
        "number": 359,
        "title": "feat(settings): CLI partial messages",
        "url": "https://github.com/RongleCat/grok-app/pull/359",
        "author": { "login": "sonnemusk", "name": "sonnemusk", "is_bot": false },
        "baseRefName": "main",
        "headRefName": "feat/partial-stream",
        "isDraft": false,
        "mergeable": "UNKNOWN",
        "state": "OPEN",
        "statusCheckRollup": [
          { "name": "frontend", "status": "COMPLETED", "conclusion": "SUCCESS" },
          { "name": "Rust", "status": "IN_PROGRESS", "conclusion": null }
        ]
      },
      {
        "number": 1,
        "title": "Draft",
        "url": "https://example.com/1",
        "author": { "login": "alice" },
        "isDraft": true,
        "mergeable": "CONFLICTING",
        "state": "OPEN",
        "statusCheckRollup": [
          { "conclusion": "FAILURE", "status": "COMPLETED" }
        ]
      }
    ]"#;

    #[test]
    fn parse_list_array() {
        let list = parse_gh_pr_list_json(SAMPLE_LIST).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].number, 359);
        assert_eq!(list[0].author, "sonnemusk");
        assert_eq!(
            list[0].head_ref_name.as_deref(),
            Some("feat/partial-stream")
        );
        let s = list[0].checks.as_ref().unwrap();
        assert_eq!(s.pass, 1);
        assert_eq!(s.pending, 1);
        assert_eq!(s.overall, "pending");
        assert!(list[1].is_draft);
        assert_eq!(list[1].checks.as_ref().unwrap().overall, "fail");
    }

    #[test]
    fn parse_list_wrapped() {
        let raw = r#"{"pullRequests":[{"number":7,"title":"x","url":"u","author":"a"}]}"#;
        let list = parse_gh_pr_list_json(raw).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].number, 7);
        assert_eq!(list[0].author, "a");
    }

    #[test]
    fn parse_list_empty_invalid() {
        assert!(parse_gh_pr_list_json("").unwrap().is_empty());
        assert!(parse_gh_pr_list_json("[]").unwrap().is_empty());
        // Leading noise without JSON → error
        assert!(parse_gh_pr_list_json("not json").is_err());
    }

    #[test]
    fn parse_view_body() {
        let raw = r#"{
          "number": 344,
          "title": "feat",
          "url": "https://x",
          "author": { "login": "bob" },
          "isDraft": false,
          "mergeable": "MERGEABLE",
          "body": "Summary body text",
          "statusCheckRollup": []
        }"#;
        let pr = parse_gh_pr_view_json(raw).unwrap().unwrap();
        assert_eq!(pr.number, 344);
        assert_eq!(pr.body.as_deref(), Some("Summary body text"));
        assert_eq!(pr.checks.as_ref().unwrap().overall, "none");
    }

    #[test]
    fn parse_checks() {
        let raw = r#"[
          {"bucket":"pass","name":"frontend","state":"SUCCESS","workflow":"ci"},
          {"bucket":"fail","name":"win","state":"FAILURE"},
          {"name":"linux","state":"PENDING"}
        ]"#;
        let checks = parse_gh_pr_checks_json(raw).unwrap();
        assert_eq!(checks.len(), 3);
        assert_eq!(checks[0].bucket, "pass");
        assert_eq!(checks[1].bucket, "fail");
        assert_eq!(checks[2].bucket, "pending");
        let s = summarize_checks(&checks);
        assert_eq!(s.overall, "fail");
        assert_eq!(s.pass, 1);
        assert_eq!(s.fail, 1);
        assert_eq!(s.pending, 1);
    }

    #[test]
    fn bucket_maps() {
        assert_eq!(
            bucket_from_check_fields(Some("pass"), Some("FAILURE"), None, None),
            "pass"
        );
        assert_eq!(
            bucket_from_check_fields(None, None, Some("TIMED_OUT"), None),
            "fail"
        );
        assert_eq!(
            bucket_from_check_fields(None, None, None, Some("IN_PROGRESS")),
            "pending"
        );
    }

    #[test]
    fn tolerates_leading_noise() {
        let raw = "loading…\n[{\"number\":3,\"title\":\"t\",\"url\":\"u\",\"author\":\"a\"}]";
        let list = parse_gh_pr_list_json(raw).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].number, 3);
    }

    #[test]
    fn parse_comments_and_reviews() {
        let raw = r#"{
          "number": 344,
          "url": "https://github.com/RongleCat/grok-app/pull/344",
          "comments": [
            {
              "id": "IC_1",
              "author": { "login": "RongleCat" },
              "body": "Thanks — integrated on main.",
              "createdAt": "2026-07-31T02:53:02Z",
              "url": "https://github.com/RongleCat/grok-app/pull/344#issuecomment-1"
            }
          ],
          "reviews": [
            {
              "id": "PRR_1",
              "author": { "login": "alice" },
              "body": "LGTM with a nit on naming.",
              "state": "APPROVED",
              "submittedAt": "2026-07-31T03:00:00Z",
              "url": "https://github.com/RongleCat/grok-app/pull/344#pullrequestreview-1"
            },
            {
              "id": "PRR_pending",
              "author": { "login": "bob" },
              "body": "",
              "state": "PENDING"
            }
          ]
        }"#;
        let (comments, url, number) = parse_gh_pr_comments_json(raw).unwrap();
        assert_eq!(number, Some(344));
        assert_eq!(
            url.as_deref(),
            Some("https://github.com/RongleCat/grok-app/pull/344")
        );
        // PENDING empty review dropped; 1 comment + 1 review.
        assert_eq!(comments.len(), 2);
        // Newest first (review submitted after comment).
        assert_eq!(comments[0].kind, "review");
        assert_eq!(comments[0].author, "alice");
        assert_eq!(comments[0].state.as_deref(), Some("APPROVED"));
        assert!(comments[0].excerpt.contains("LGTM"));
        assert_eq!(comments[1].kind, "comment");
        assert_eq!(comments[1].author, "RongleCat");
    }

    #[test]
    fn excerpt_collapses_whitespace() {
        let e = excerpt_comment_body("hello\n\n  world\t!", 200);
        assert_eq!(e, "hello world !");
        let short = excerpt_comment_body("abcdefghij", 6);
        assert!(short.ends_with('…'));
        assert!(short.chars().count() <= 6);
    }

    #[test]
    fn parse_comments_empty() {
        let (c, url, n) = parse_gh_pr_comments_json("").unwrap();
        assert!(c.is_empty());
        assert!(url.is_none());
        assert!(n.is_none());
        let (c2, _, _) =
            parse_gh_pr_comments_json(r#"{"number":1,"url":"u","comments":[],"reviews":[]}"#)
                .unwrap();
        assert!(c2.is_empty());
    }
}
