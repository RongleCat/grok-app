//! Pure control-plane transitions for Remote IM (/p /r / bind / resume).
//! Network-free and unit-tested against production functions.

use super::context::{ContextCompactSnapshot, ContextUsageSnapshot};
use super::types::TrustedProject;
use serde::{Deserialize, Serialize};

/// How the next agent turn should open.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum PendingMode {
    /// After /p: next speak starts a new agent session.
    #[default]
    New,
    /// After /r pick: next speak must resume agent_session_id.
    Resume,
    /// Ongoing multi-turn conversation (keep agent_session_id).
    Continue,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopeBinding {
    pub project_id: Option<String>,
    pub work_dir: String,
    pub local_session_id: String,
    /// Grok/App agent session id used with --resume / ACP.
    pub agent_session_id: Option<String>,
    pub pending_mode: PendingMode,
    pub turn_count: u32,
    /// Last agent-reported context usage. Older persisted bindings omit it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_usage: Option<ContextUsageSnapshot>,
    /// Last manual/automatic compaction observed for this agent session.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_compact: Option<ContextCompactSnapshot>,
}

impl ScopeBinding {
    pub fn fresh(work_dir: &str) -> Self {
        Self {
            project_id: None,
            work_dir: work_dir.to_string(),
            local_session_id: uuid::Uuid::new_v4().to_string(),
            agent_session_id: None,
            pending_mode: PendingMode::New,
            turn_count: 0,
            context_usage: None,
            last_compact: None,
        }
    }
}

/// App session row used by /r (from sessions_index or fixtures).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSessionEntry {
    pub id: String,
    pub project_id: Option<String>,
    pub title: String,
    pub agent_session_id: Option<String>,
    /// ISO or display time string (optional).
    pub updated_at: String,
}

/// Effective agent session id for resume (prefer agent_session_id, else app id).
pub fn effective_agent_session_id(s: &AppSessionEntry) -> String {
    s.agent_session_id
        .as_ref()
        .map(|x| x.trim().to_string())
        .filter(|x| !x.is_empty())
        .unwrap_or_else(|| s.id.clone())
}

/// After the App UI moves a chat to another project (or orphan).
/// Only bindings that already point at this App session are rewritten.
pub fn binding_after_app_session_move(
    prev: &ScopeBinding,
    app_session_id: &str,
    project_id: Option<String>,
    work_dir: &str,
) -> Option<ScopeBinding> {
    if prev.local_session_id != app_session_id {
        return None;
    }
    let mut next = prev.clone();
    next.project_id = project_id.filter(|s| !s.trim().is_empty());
    next.work_dir = work_dir.to_string();
    next.agent_session_id = None;
    next.pending_mode = PendingMode::New;
    Some(next)
}

/// After project select: bind path, clear agent session, next speak is new.
pub fn binding_after_project_select(
    _prev: &ScopeBinding,
    project: &TrustedProject,
) -> ScopeBinding {
    ScopeBinding {
        project_id: Some(project.id.clone()),
        work_dir: project.path.clone(),
        local_session_id: uuid::Uuid::new_v4().to_string(),
        agent_session_id: None,
        pending_mode: PendingMode::New,
        turn_count: 0,
        context_usage: None,
        last_compact: None,
    }
}

/// After resume select: set agent_session_id and pendingMode=Resume.
pub fn binding_after_session_resume(
    prev: &ScopeBinding,
    session: &AppSessionEntry,
) -> ScopeBinding {
    let mut next = prev.clone();
    if let Some(pid) = &session.project_id {
        next.project_id = Some(pid.clone());
    }
    next.agent_session_id = Some(effective_agent_session_id(session));
    next.pending_mode = PendingMode::Resume;
    next.local_session_id = session.id.clone();
    // Usage belongs to the previously bound agent session. `/context` can
    // hydrate compact markers or estimate the newly selected App journal.
    next.context_usage = None;
    next.last_compact = None;
    next
}

/// Resolve whether the next agent turn should pass a resume id.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TurnIntent {
    /// New agent session (do not pass resume).
    NewSession { work_dir: String },
    /// Resume existing agent session.
    ResumeSession {
        work_dir: String,
        agent_session_id: String,
    },
}

pub fn resolve_turn_intent(binding: &ScopeBinding) -> TurnIntent {
    match binding.pending_mode {
        PendingMode::New => TurnIntent::NewSession {
            work_dir: binding.work_dir.clone(),
        },
        PendingMode::Resume | PendingMode::Continue => {
            if let Some(sid) = binding
                .agent_session_id
                .as_ref()
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
            {
                TurnIntent::ResumeSession {
                    work_dir: binding.work_dir.clone(),
                    agent_session_id: sid.to_string(),
                }
            } else {
                TurnIntent::NewSession {
                    work_dir: binding.work_dir.clone(),
                }
            }
        }
    }
}

/// After a successful agent turn, keep resume id and mark Continue.
pub fn binding_after_agent_turn(
    prev: &ScopeBinding,
    returned_session_id: Option<&str>,
) -> ScopeBinding {
    let mut next = prev.clone();
    if let Some(sid) = returned_session_id
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    {
        next.agent_session_id = Some(sid.to_string());
    }
    next.pending_mode = PendingMode::Continue;
    next.turn_count = next.turn_count.saturating_add(1);
    next
}

/// Filter sessions for a project (non-archived preferred).
pub fn list_sessions_for_project(
    all: &[AppSessionEntry],
    project_id: Option<&str>,
) -> Vec<AppSessionEntry> {
    let Some(pid) = project_id.filter(|p| !p.is_empty()) else {
        return Vec::new();
    };
    all.iter()
        .filter(|s| s.project_id.as_deref() == Some(pid))
        .cloned()
        .collect()
}

/// Normalize user/card text pick: strip leading "2. " / "2．" button labels from Feishu cards.
pub fn normalize_pick_query(query: &str) -> String {
    let q = query.trim();
    // "2. cc-workspace" or "2．塔家军" (full-width dot)
    if let Some((num, rest)) = q
        .split_once(". ")
        .or_else(|| q.split_once("．"))
        .or_else(|| q.split_once('.'))
    {
        if num.trim().chars().all(|c| c.is_ascii_digit()) {
            let rest = rest.trim();
            if !rest.is_empty() {
                // Prefer the name/path part for matching; number also usable alone
                return rest.to_string();
            }
            return num.trim().to_string();
        }
    }
    q.to_string()
}

/// Pick project by 1-based index or name/id substring.
pub fn pick_project<'a>(projects: &'a [TrustedProject], query: &str) -> Option<&'a TrustedProject> {
    // Strip zero-width / BOM noise from IM clients pasting button labels.
    let q_raw: String = query
        .trim()
        .chars()
        .filter(|c| {
            !matches!(
                c,
                '\u{200b}' | '\u{200c}' | '\u{200d}' | '\u{feff}' | '\u{00a0}'
            )
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if q_raw.is_empty() {
        return None;
    }
    // Exact number first (including "2. name" / "2．name" / "2、name" → try index)
    for sep in [".", "．", "、", "。", ") ", ")"] {
        if let Some((num, rest)) = q_raw.split_once(sep) {
            if let Ok(n) = num.trim().parse::<usize>() {
                if n >= 1 && n <= projects.len() {
                    return Some(&projects[n - 1]);
                }
            }
            // If index OOB, fall through to name match on rest
            let _ = rest;
        }
    }
    if let Some((num, _)) = q_raw.split_once(['.', '．', '、']) {
        if let Ok(n) = num.trim().parse::<usize>() {
            if n >= 1 && n <= projects.len() {
                return Some(&projects[n - 1]);
            }
        }
    }
    if let Ok(n) = q_raw.parse::<usize>() {
        if n >= 1 && n <= projects.len() {
            return Some(&projects[n - 1]);
        }
    }
    let q = normalize_pick_query(&q_raw);
    let lower = q.to_ascii_lowercase();
    projects.iter().find(|p| {
        p.id == q
            || p.id == q_raw
            || p.name.eq_ignore_ascii_case(&q)
            || p.name.eq_ignore_ascii_case(&q_raw)
            || p.name.to_ascii_lowercase().contains(&lower)
            || p.path.contains(&q)
            || p.path.contains(&q_raw)
    })
}

/// Pick session by 1-based index or id / agent_session_id.
pub fn pick_session<'a>(
    sessions: &'a [AppSessionEntry],
    query: &str,
) -> Option<&'a AppSessionEntry> {
    let q = query.trim();
    if q.is_empty() {
        return None;
    }
    if let Ok(n) = q.parse::<usize>() {
        if n >= 1 && n <= sessions.len() {
            return Some(&sessions[n - 1]);
        }
    }
    sessions.iter().find(|s| {
        s.id == q || s.agent_session_id.as_deref() == Some(q) || s.title.eq_ignore_ascii_case(q)
    })
}

/// Format text project menu (non-card channels).
pub fn format_project_menu(projects: &[TrustedProject], lang: &str) -> String {
    if projects.is_empty() {
        return if lang == "en" {
            "No trusted projects. Trust a folder in Grok App first.".into()
        } else {
            "没有已信任项目。请先在 Grok App 中信任项目目录。".into()
        };
    }
    let mut lines = vec![if lang == "en" {
        "**Trusted projects** — reply with number or name:".into()
    } else {
        "**已信任项目** — 回复序号或名称：".into()
    }];
    for (i, p) in projects.iter().enumerate() {
        lines.push(format!("{}. {} — `{}`", i + 1, p.name, p.path));
    }
    lines.push(if lang == "en" {
        "0 — cancel".into()
    } else {
        "0 — 取消".into()
    });
    lines.join("\n")
}

/// Format text session menu (non-card channels).
pub fn format_session_menu(sessions: &[AppSessionEntry], lang: &str) -> String {
    if sessions.is_empty() {
        return if lang == "en" {
            "No sessions in this project. Send a message to start a new one.".into()
        } else {
            "该项目下没有可恢复会话。直接发送消息将开启新会话。".into()
        };
    }
    let mut lines = vec![if lang == "en" {
        "**Sessions** — reply with number:".into()
    } else {
        "**会话** — 回复序号：".into()
    }];
    for (i, s) in sessions.iter().enumerate() {
        let aid = effective_agent_session_id(s);
        lines.push(format!(
            "{}. {} · `{}`{}",
            i + 1,
            s.title,
            aid,
            if s.updated_at.is_empty() {
                String::new()
            } else {
                format!(" · {}", s.updated_at)
            }
        ));
    }
    lines.push(if lang == "en" {
        "0 — cancel".into()
    } else {
        "0 — 取消".into()
    });
    lines.join("\n")
}

/// Whether this channel should use interactive cards for /p /r.
/// Instance `presenter` / `enable_card` override the channel default.
#[allow(dead_code)]
pub fn channel_uses_cards(channel: &str) -> bool {
    channel_uses_cards_with_options(channel, None)
}

pub fn channel_uses_cards_with_options(channel: &str, options: Option<&serde_json::Value>) -> bool {
    if let Some(opts) = options {
        if let Some(p) = opts.get("presenter").and_then(|v| v.as_str()) {
            let p = p.trim().to_ascii_lowercase();
            if p == "card" || p == "cards" {
                return true;
            }
            if p == "text" || p == "plain" {
                return false;
            }
        }
        if let Some(b) = opts.get("enable_card").and_then(|v| v.as_bool()) {
            return b;
        }
    }
    matches!(channel, "feishu" | "lark" | "dingtalk" | "telegram")
}

/// Card action payload values (encoded in button value).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CardAction {
    #[serde(rename = "project")]
    Project { id: String },
    #[serde(rename = "session")]
    Session { id: String },
    #[serde(rename = "account")]
    Account { id: String },
    #[serde(rename = "page")]
    Page { menu: String, page: usize },
    #[serde(rename = "cancel")]
    Cancel,
}

pub fn encode_card_action(action: &CardAction) -> String {
    serde_json::to_string(action).unwrap_or_else(|_| r#"{"kind":"cancel"}"#.into())
}

/// Compact action value for Telegram's 64-byte `callback_data` limit.
/// Project/session/account ids are UUIDs in the App store, so the prefixed form fits.
pub fn encode_compact_card_action(action: &CardAction) -> String {
    match action {
        CardAction::Project { id } => format!("project:{id}"),
        CardAction::Session { id } => format!("session:{id}"),
        CardAction::Account { id } => format!("account:{id}"),
        CardAction::Page { menu, page } => format!("page:{menu}:{page}"),
        CardAction::Cancel => "cancel".into(),
    }
}

pub fn parse_card_action(raw: &str) -> Option<CardAction> {
    let t = raw.trim();
    if t.is_empty() {
        return None;
    }
    // JSON button value (tagged enum or flat object)
    if let Ok(a) = serde_json::from_str::<CardAction>(t) {
        return Some(a);
    }
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(t) {
        return parse_card_action_value(&v);
    }
    // prefix forms: project:<id> | session:<id>
    if let Some(rest) = t.strip_prefix("project:") {
        return Some(CardAction::Project {
            id: rest.to_string(),
        });
    }
    if let Some(rest) = t.strip_prefix("session:") {
        return Some(CardAction::Session {
            id: rest.to_string(),
        });
    }
    if let Some(rest) = t.strip_prefix("account:") {
        return Some(CardAction::Account {
            id: rest.to_string(),
        });
    }
    if let Some(rest) = t.strip_prefix("page:") {
        let (menu, page) = rest.split_once(':')?;
        if !matches!(menu, "project" | "session" | "account") {
            return None;
        }
        return Some(CardAction::Page {
            menu: menu.to_string(),
            page: page.parse().ok()?,
        });
    }
    if t == "cancel" || t == "0" {
        return Some(CardAction::Cancel);
    }
    None
}

/// Parse Feishu/DingTalk button value object or nested envelopes.
///
/// Feishu reliably returns button `value` as a **string-keyed map**. cc-connect uses
/// only `{"action":"project:<id>"}` — we accept that first, then kind/id forms.
pub fn parse_card_action_value(v: &serde_json::Value) -> Option<CardAction> {
    // Nested: { "value": "..." } or { "value": { ... } }
    if let Some(inner) = v.get("value") {
        if let Some(s) = inner.as_str() {
            if let Some(a) = parse_card_action(s) {
                return Some(a);
            }
        } else if let Some(a) = parse_card_action_value(inner) {
            return Some(a);
        }
    }
    // Prefer cc-connect style: { "action": "project:<id>" | "session:<id>" | "cancel" }
    if let Some(s) = v.get("action").and_then(|x| x.as_str()) {
        if let Some(a) = parse_card_action(s) {
            return Some(a);
        }
    }
    // Flat tagged enum: { "kind": "project", "id": "..." }
    if let Ok(a) = serde_json::from_value::<CardAction>(v.clone()) {
        return Some(a);
    }
    let kind = v.get("kind").and_then(|x| x.as_str()).unwrap_or("");
    let id = v
        .get("id")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    if kind == "project" && !id.is_empty() {
        return Some(CardAction::Project { id });
    }
    if kind == "session" && !id.is_empty() {
        return Some(CardAction::Session { id });
    }
    if kind == "account" && !id.is_empty() {
        return Some(CardAction::Account { id });
    }
    if kind == "cancel" || kind == "0" {
        return Some(CardAction::Cancel);
    }
    // kind itself may be "project:uuid"
    if let Some(rest) = kind.strip_prefix("project:") {
        return Some(CardAction::Project {
            id: rest.to_string(),
        });
    }
    if let Some(rest) = kind.strip_prefix("session:") {
        return Some(CardAction::Session {
            id: rest.to_string(),
        });
    }
    if let Some(rest) = kind.strip_prefix("account:") {
        return Some(CardAction::Account {
            id: rest.to_string(),
        });
    }
    if kind.starts_with("page:") {
        return parse_card_action(kind);
    }
    None
}

/// Apply card or text pick for project; returns new binding or error message key.
pub fn apply_project_pick(
    binding: &ScopeBinding,
    projects: &[TrustedProject],
    query_or_id: &str,
) -> Result<ScopeBinding, String> {
    let q = query_or_id.trim();
    // Prefer exact id match first (card value.kind=project id)
    if let Some(p) = projects.iter().find(|p| p.id == q) {
        return Ok(binding_after_project_select(binding, p));
    }
    // Card may pass project:<uuid>
    if let Some(rest) = q.strip_prefix("project:") {
        if let Some(p) = projects.iter().find(|p| p.id == rest) {
            return Ok(binding_after_project_select(binding, p));
        }
    }
    match pick_project(projects, q) {
        Some(p) => Ok(binding_after_project_select(binding, p)),
        None => Err(format!("project_not_found:{query_or_id}")),
    }
}

pub fn apply_session_pick(
    binding: &ScopeBinding,
    sessions: &[AppSessionEntry],
    query_or_id: &str,
) -> Result<ScopeBinding, String> {
    if let Some(s) = sessions
        .iter()
        .find(|s| s.id == query_or_id || s.agent_session_id.as_deref() == Some(query_or_id))
    {
        return Ok(binding_after_session_resume(binding, s));
    }
    match pick_session(sessions, query_or_id) {
        Some(s) => Ok(binding_after_session_resume(binding, s)),
        None => Err(format!("session_not_found:{query_or_id}")),
    }
}

/// Build Feishu interactive card JSON for project pick (simplified schema).
pub fn build_feishu_project_card(projects: &[TrustedProject], lang: &str) -> serde_json::Value {
    let title = if lang == "en" {
        "Select trusted project"
    } else {
        "选择已信任项目"
    };
    let mut elements = vec![serde_json::json!({
        "tag": "div",
        "text": { "tag": "lark_md", "content": title }
    })];
    let mut actions = Vec::new();
    for (i, p) in projects.iter().enumerate() {
        let label = format!("{}. {}", i + 1, p.name);
        // Feishu requires button value to be an **object** (string map).
        // Match cc-connect: only `action` key — other keys are often dropped or stringified oddly.
        actions.push(serde_json::json!({
            "tag": "button",
            "text": { "tag": "plain_text", "content": label },
            "type": "primary",
            "value": {
                "action": format!("project:{}", p.id),
            },
        }));
    }
    actions.push(serde_json::json!({
        "tag": "button",
        "text": { "tag": "plain_text", "content": if lang == "en" { "Cancel" } else { "取消" } },
        "type": "default",
        "value": {
            "action": "cancel",
        },
    }));
    elements.push(serde_json::json!({
        "tag": "action",
        "actions": actions
    }));
    serde_json::json!({
        "config": { "wide_screen_mode": true },
        "header": {
            "title": { "tag": "plain_text", "content": "Grok Remote IM · /p" }
        },
        "elements": elements
    })
}

pub fn build_feishu_session_card(sessions: &[AppSessionEntry], lang: &str) -> serde_json::Value {
    let title = if lang == "en" {
        "Resume a session"
    } else {
        "恢复会话"
    };
    let mut elements = vec![serde_json::json!({
        "tag": "div",
        "text": { "tag": "lark_md", "content": title }
    })];
    let mut actions = Vec::new();
    for (i, s) in sessions.iter().take(20).enumerate() {
        let label = format!(
            "{}. {}",
            i + 1,
            s.title.chars().take(40).collect::<String>()
        );
        actions.push(serde_json::json!({
            "tag": "button",
            "text": { "tag": "plain_text", "content": label },
            "type": "primary",
            "value": {
                "action": format!("session:{}", s.id),
            },
        }));
    }
    actions.push(serde_json::json!({
        "tag": "button",
        "text": { "tag": "plain_text", "content": if lang == "en" { "Cancel" } else { "取消" } },
        "type": "default",
        "value": {
            "action": "cancel",
        },
    }));
    elements.push(serde_json::json!({
        "tag": "action",
        "actions": actions
    }));
    serde_json::json!({
        "config": { "wide_screen_mode": true },
        "header": {
            "title": { "tag": "plain_text", "content": "Grok Remote IM · /r" }
        },
        "elements": elements
    })
}

const TELEGRAM_SELECTION_LIMIT: usize = 20;

fn truncate_chars(value: &str, max: usize) -> String {
    let mut out: String = value.chars().take(max).collect();
    if value.chars().count() > max {
        out.push('…');
    }
    out
}

/// Telegram-native selection payload consumed by `telegram::send_card`.
/// One button per row keeps long project/session/account labels readable on mobile.
fn build_telegram_selection_card(
    text: String,
    choices: Vec<(String, CardAction)>,
    lang: &str,
    menu: &str,
    requested_page: usize,
) -> serde_json::Value {
    let page_count = choices.len().max(1).div_ceil(TELEGRAM_SELECTION_LIMIT);
    let page = requested_page.min(page_count.saturating_sub(1));
    let mut rows: Vec<serde_json::Value> = choices
        .into_iter()
        .skip(page * TELEGRAM_SELECTION_LIMIT)
        .take(TELEGRAM_SELECTION_LIMIT)
        .filter_map(|(label, action)| {
            let callback_data = encode_compact_card_action(&action);
            // Telegram rejects the whole message if any callback_data exceeds 64 bytes.
            if callback_data.len() > 64 {
                return None;
            }
            Some(serde_json::json!([{
                "text": truncate_chars(&label, 52),
                "callback_data": callback_data,
            }]))
        })
        .collect();
    if page_count > 1 {
        let mut navigation = Vec::new();
        if page > 0 {
            navigation.push(serde_json::json!({
                "text": if lang == "en" { "← Previous" } else { "← 上一页" },
                "callback_data": encode_compact_card_action(&CardAction::Page {
                    menu: menu.to_string(),
                    page: page - 1,
                }),
            }));
        }
        if page + 1 < page_count {
            navigation.push(serde_json::json!({
                "text": if lang == "en" { "Next →" } else { "下一页 →" },
                "callback_data": encode_compact_card_action(&CardAction::Page {
                    menu: menu.to_string(),
                    page: page + 1,
                }),
            }));
        }
        if !navigation.is_empty() {
            rows.push(serde_json::Value::Array(navigation));
        }
    }
    rows.push(serde_json::json!([{
        "text": if lang == "en" { "Cancel" } else { "取消" },
        "callback_data": encode_compact_card_action(&CardAction::Cancel),
    }]));

    let page_label = if lang == "en" {
        format!("Page {} / {}", page + 1, page_count)
    } else {
        format!("第 {} / {} 页", page + 1, page_count)
    };

    serde_json::json!({
        "text": truncate_chars(&format!("{text}\n\n_{page_label}_"), 3500),
        "reply_markup": { "inline_keyboard": rows },
    })
}

pub fn build_telegram_project_card(
    projects: &[TrustedProject],
    lang: &str,
    page: usize,
) -> serde_json::Value {
    let text = if lang == "en" {
        "**Trusted projects**\nChoose below, or send `/p <name>`."
    } else {
        "**已信任项目**\n点击下方按钮选择，也可发送 `/p <名称>`。"
    };
    let choices = projects
        .iter()
        .enumerate()
        .map(|(i, project)| {
            (
                format!("{}. {}", i + 1, project.name),
                CardAction::Project {
                    id: project.id.clone(),
                },
            )
        })
        .collect();
    build_telegram_selection_card(text.into(), choices, lang, "project", page)
}

pub fn build_telegram_session_card(
    sessions: &[AppSessionEntry],
    lang: &str,
    page: usize,
) -> serde_json::Value {
    let text = if lang == "en" {
        "**Sessions**\nChoose a session to resume, or send `/r <number>`."
    } else {
        "**会话**\n点击下方按钮恢复，也可发送 `/r <序号>`。"
    };
    let choices = sessions
        .iter()
        .enumerate()
        .map(|(i, session)| {
            (
                format!("{}. {}", i + 1, session.title),
                CardAction::Session {
                    id: session.id.clone(),
                },
            )
        })
        .collect();
    build_telegram_selection_card(text.into(), choices, lang, "session", page)
}

/// `accounts` entries are `(id, display label)`; quota details stay in `text`.
pub fn build_telegram_account_card(
    text: &str,
    accounts: &[(String, String)],
    lang: &str,
    page: usize,
) -> serde_json::Value {
    let choices = accounts
        .iter()
        .enumerate()
        .map(|(i, (id, label))| {
            (
                format!("{}. {}", i + 1, label),
                CardAction::Account { id: id.clone() },
            )
        })
        .collect();
    build_telegram_selection_card(text.to_string(), choices, lang, "account", page)
}

/// DingTalk interactive card content (markdown + action buttons payload for Stream).
pub fn build_dingtalk_project_card(projects: &[TrustedProject], lang: &str) -> serde_json::Value {
    let title = if lang == "en" {
        "Select trusted project"
    } else {
        "选择已信任项目"
    };
    let mut btn = Vec::new();
    for (i, p) in projects.iter().enumerate() {
        btn.push(serde_json::json!({
            "title": format!("{}. {}", i + 1, p.name),
            "actionType": "action",
            "actionId": encode_card_action(&CardAction::Project { id: p.id.clone() }),
            "status": "normal",
        }));
    }
    btn.push(serde_json::json!({
        "title": if lang == "en" { "Cancel" } else { "取消" },
        "actionType": "action",
        "actionId": encode_card_action(&CardAction::Cancel),
        "status": "normal",
    }));
    serde_json::json!({
        "config": { "autoLayout": true },
        "header": { "title": { "type": "text", "text": "Grok · /p" } },
        "contents": [
            { "type": "markdown", "text": title },
            { "type": "action", "actions": btn }
        ]
    })
}

pub fn build_dingtalk_session_card(sessions: &[AppSessionEntry], lang: &str) -> serde_json::Value {
    let title = if lang == "en" {
        "Resume a session"
    } else {
        "恢复会话"
    };
    let mut btn = Vec::new();
    for (i, s) in sessions.iter().take(20).enumerate() {
        btn.push(serde_json::json!({
            "title": format!("{}. {}", i + 1, s.title.chars().take(36).collect::<String>()),
            "actionType": "action",
            "actionId": encode_card_action(&CardAction::Session { id: s.id.clone() }),
            "status": "normal",
        }));
    }
    btn.push(serde_json::json!({
        "title": if lang == "en" { "Cancel" } else { "取消" },
        "actionType": "action",
        "actionId": encode_card_action(&CardAction::Cancel),
        "status": "normal",
    }));
    serde_json::json!({
        "config": { "autoLayout": true },
        "header": { "title": { "type": "text", "text": "Grok · /r" } },
        "contents": [
            { "type": "markdown", "text": title },
            { "type": "action", "actions": btn }
        ]
    })
}

/// CLI args for resume-capable grok turn (shipped helper used by grok_agent + tests).
/// Default format is `streaming-json` (no partial stream events).
#[allow(dead_code)]
pub fn grok_turn_cli_args(
    prompt: &str,
    session_id: Option<&str>,
    always_approve: bool,
) -> Vec<String> {
    grok_turn_cli_args_with_bg_wait(prompt, session_id, always_approve, &[])
}

/// Headless `-p` argv builder with optional background-wait flags (CLI 0.2.117+).
#[allow(dead_code)]
pub fn grok_turn_cli_args_with_bg_wait(
    prompt: &str,
    session_id: Option<&str>,
    always_approve: bool,
    bg_wait_flags: &[String],
) -> Vec<String> {
    grok_turn_cli_args_full(
        prompt,
        session_id,
        always_approve,
        "streaming-json",
        &[],
        bg_wait_flags,
    )
}

/// Headless `-p` argv with explicit output format + optional partial-stream flags
/// (`--include-partial-messages` only when format is `streaming-messages-json`).
#[allow(dead_code)]
pub fn grok_turn_cli_args_with_stream(
    prompt: &str,
    session_id: Option<&str>,
    always_approve: bool,
    output_format: &str,
    partial_flags: &[&str],
) -> Vec<String> {
    grok_turn_cli_args_full(
        prompt,
        session_id,
        always_approve,
        output_format,
        partial_flags,
        &[],
    )
}

/// Full headless `-p` argv: format, optional partial-stream flags, resume, bg-wait.
pub fn grok_turn_cli_args_full(
    prompt: &str,
    session_id: Option<&str>,
    always_approve: bool,
    output_format: &str,
    partial_flags: &[&str],
    bg_wait_flags: &[String],
) -> Vec<String> {
    let mut args = vec!["-p".into(), prompt.to_string()];
    if always_approve {
        args.push("--always-approve".into());
    }
    // Grok Build CLI: plain | json | streaming-json | streaming-messages-json.
    let fmt = output_format.trim();
    let fmt = if fmt.is_empty() {
        "streaming-json"
    } else {
        fmt
    };
    args.push("--output-format".into());
    args.push(fmt.into());
    // Soft-gated partial stream events (CLI 0.2.117+; only valid with
    // streaming-messages-json — pure helper already enforces that).
    for f in partial_flags {
        let t = f.trim();
        if !t.is_empty() {
            args.push(t.into());
        }
    }
    if let Some(sid) = session_id.map(|s| s.trim()).filter(|s| !s.is_empty()) {
        args.push("--resume".into());
        args.push(sid.to_string());
    }
    // Top-level headless flags: wait for background bash/monitor/subagents.
    for f in bg_wait_flags {
        args.push(f.clone());
    }
    args
}

#[cfg(test)]
mod tests {
    use super::*;

    fn proj(id: &str, name: &str, path: &str) -> TrustedProject {
        TrustedProject {
            id: id.into(),
            name: name.into(),
            path: path.into(),
        }
    }

    fn sess(id: &str, project_id: &str, title: &str, agent: Option<&str>) -> AppSessionEntry {
        AppSessionEntry {
            id: id.into(),
            project_id: Some(project_id.into()),
            title: title.into(),
            agent_session_id: agent.map(|s| s.into()),
            updated_at: "2026-01-01T00:00:00Z".into(),
        }
    }

    #[test]
    fn app_session_move_retargets_matching_binding() {
        let mut b = ScopeBinding::fresh("/tmp/old");
        b.local_session_id = "app-1".into();
        b.project_id = Some("old".into());
        b.agent_session_id = Some("agent-old".into());
        b.pending_mode = PendingMode::Continue;
        b.turn_count = 4;
        let next = binding_after_app_session_move(&b, "app-1", Some("new".into()), "/tmp/new")
            .expect("match");
        assert_eq!(next.project_id.as_deref(), Some("new"));
        assert_eq!(next.work_dir, "/tmp/new");
        assert!(next.agent_session_id.is_none());
        assert_eq!(next.pending_mode, PendingMode::New);
        assert!(
            binding_after_app_session_move(&b, "other", Some("new".into()), "/tmp/new").is_none()
        );
    }

    #[test]
    fn project_bind_clears_agent_session_next_is_new() {
        let mut b = ScopeBinding::fresh("/tmp/old");
        b.agent_session_id = Some("old-agent".into());
        b.pending_mode = PendingMode::Continue;
        b.turn_count = 3;
        let p = proj("p1", "Demo", "/Users/me/demo");
        let next = binding_after_project_select(&b, &p);
        assert_eq!(next.project_id.as_deref(), Some("p1"));
        assert_eq!(next.work_dir, "/Users/me/demo");
        assert!(next.agent_session_id.is_none());
        assert_eq!(next.pending_mode, PendingMode::New);
        assert_eq!(next.turn_count, 0);
        match resolve_turn_intent(&next) {
            TurnIntent::NewSession { work_dir } => assert_eq!(work_dir, "/Users/me/demo"),
            other => panic!("expected NewSession, got {other:?}"),
        }
    }

    #[test]
    fn resume_pick_sets_agent_session_and_intent() {
        let b = ScopeBinding {
            project_id: Some("p1".into()),
            work_dir: "/Users/me/demo".into(),
            local_session_id: "local".into(),
            agent_session_id: None,
            pending_mode: PendingMode::New,
            turn_count: 0,
            context_usage: None,
            last_compact: None,
        };
        let s = sess("app-sess-1", "p1", "Prior chat", Some("grok-agent-99"));
        let next = binding_after_session_resume(&b, &s);
        assert_eq!(next.agent_session_id.as_deref(), Some("grok-agent-99"));
        assert_eq!(next.pending_mode, PendingMode::Resume);
        match resolve_turn_intent(&next) {
            TurnIntent::ResumeSession {
                agent_session_id,
                work_dir,
            } => {
                assert_eq!(agent_session_id, "grok-agent-99");
                assert_eq!(work_dir, "/Users/me/demo");
            }
            other => panic!("expected ResumeSession, got {other:?}"),
        }
        // After turn, continuity
        let cont = binding_after_agent_turn(&next, Some("grok-agent-99"));
        assert_eq!(cont.pending_mode, PendingMode::Continue);
        assert_eq!(cont.turn_count, 1);
        assert!(matches!(
            resolve_turn_intent(&cont),
            TurnIntent::ResumeSession { .. }
        ));
    }

    #[test]
    fn list_and_pick_from_sessions_index_fixture() {
        let all = vec![
            sess("s1", "p1", "Alpha", Some("a1")),
            sess("s2", "p2", "Other", None),
            sess("s3", "p1", "Beta", Some("a3")),
        ];
        let listed = list_sessions_for_project(&all, Some("p1"));
        assert_eq!(listed.len(), 2);
        assert_eq!(
            pick_session(&listed, "2").map(|s| s.id.as_str()),
            Some("s3")
        );
        assert_eq!(
            pick_session(&listed, "a1").map(|s| s.id.as_str()),
            Some("s1")
        );
        let projects = vec![proj("p1", "One", "/a"), proj("p2", "Two", "/b")];
        assert_eq!(
            pick_project(&projects, "2").map(|p| p.id.as_str()),
            Some("p2")
        );
        let b = ScopeBinding::fresh("/tmp");
        let bound = apply_session_pick(&b, &listed, "1").unwrap();
        assert_eq!(bound.agent_session_id.as_deref(), Some("a1"));
        assert_eq!(bound.pending_mode, PendingMode::Resume);
    }

    #[test]
    fn invalid_session_pick_errors_not_fake_keep() {
        let b = ScopeBinding::fresh("/tmp");
        let sessions = vec![sess("s1", "p1", "Only", Some("a1"))];
        let err = apply_session_pick(&b, &sessions, "99").unwrap_err();
        assert!(err.contains("session_not_found"));
        // binding unchanged if caller keeps old
        assert!(b.agent_session_id.is_none());
    }

    #[test]
    fn card_action_roundtrip_project_session_and_account() {
        let a = CardAction::Project { id: "p1".into() };
        let enc = encode_card_action(&a);
        assert_eq!(parse_card_action(&enc), Some(a));
        let b = CardAction::Session { id: "s9".into() };
        assert_eq!(parse_card_action(&encode_card_action(&b)), Some(b));
        assert_eq!(
            parse_card_action(r#"{"value":"{\"kind\":\"project\",\"id\":\"px\"}"}"#),
            Some(CardAction::Project { id: "px".into() })
        );
        assert_eq!(
            parse_card_action("project:abc"),
            Some(CardAction::Project { id: "abc".into() })
        );
        assert_eq!(
            parse_card_action("account:user-1"),
            Some(CardAction::Account {
                id: "user-1".into()
            })
        );
        assert_eq!(
            parse_card_action("page:session:3"),
            Some(CardAction::Page {
                menu: "session".into(),
                page: 3,
            })
        );
    }

    #[test]
    fn interactive_channels_use_cards_weixin_does_not() {
        assert!(channel_uses_cards("feishu"));
        assert!(channel_uses_cards("lark"));
        assert!(channel_uses_cards("dingtalk"));
        assert!(channel_uses_cards("telegram"));
        assert!(!channel_uses_cards("weixin"));
        assert!(channel_uses_cards_with_options(
            "weixin",
            Some(&serde_json::json!({ "enable_card": true })),
        ));
        assert!(!channel_uses_cards_with_options(
            "feishu",
            Some(&serde_json::json!({ "presenter": "text" })),
        ));
    }

    #[test]
    fn card_builders_emit_button_values_that_parse() {
        let projects = vec![proj("p1", "Demo", "/d")];
        let card = build_feishu_project_card(&projects, "zh");
        let actions = &card["elements"][1]["actions"];
        // Feishu value is object with action key (cc-connect style)
        let val = &actions[0]["value"];
        assert!(val.is_object(), "feishu button value must be object: {val}");
        assert_eq!(
            val.get("action").and_then(|x| x.as_str()),
            Some("project:p1")
        );
        assert_eq!(
            parse_card_action_value(val),
            Some(CardAction::Project { id: "p1".into() })
        );
        // Simulated Feishu callback envelope
        let envelope = serde_json::json!({
            "header": { "event_type": "card.action.trigger" },
            "event": { "action": { "value": val.clone() } }
        });
        let content = crate::remote_im::channels::feishu::card_action_to_content(&envelope)
            .expect("card action content");
        assert!(content.starts_with("__card_action__:"));
        let rest = content.strip_prefix("__card_action__:").unwrap();
        assert_eq!(
            parse_card_action(rest),
            Some(CardAction::Project { id: "p1".into() })
        );

        let sessions = vec![sess("s1", "p1", "T", Some("ag"))];
        let sc = build_feishu_session_card(&sessions, "zh");
        let val2 = &sc["elements"][1]["actions"][0]["value"];
        assert_eq!(
            parse_card_action_value(val2),
            Some(CardAction::Session { id: "s1".into() })
        );
        let dc = build_dingtalk_project_card(&projects, "zh");
        let aid = dc["contents"][1]["actions"][0]["actionId"]
            .as_str()
            .unwrap();
        assert_eq!(
            parse_card_action(aid),
            Some(CardAction::Project { id: "p1".into() })
        );

        let tc = build_telegram_project_card(&projects, "zh", 0);
        let callback = tc["reply_markup"]["inline_keyboard"][0][0]["callback_data"]
            .as_str()
            .unwrap();
        assert_eq!(callback, "project:p1");
        assert!(callback.len() <= 64);
    }

    #[test]
    fn telegram_project_card_paginates_and_keeps_global_actions() {
        let projects: Vec<TrustedProject> = (1..=25)
            .map(|i| proj(&format!("p{i}"), &format!("Project {i}"), "/tmp"))
            .collect();
        let card = build_telegram_project_card(&projects, "en", 1);
        let keyboard = card["reply_markup"]["inline_keyboard"].as_array().unwrap();
        assert_eq!(
            keyboard[0][0]["callback_data"].as_str(),
            Some("project:p21")
        );
        assert!(keyboard.iter().any(|row| {
            row[0]["callback_data"]
                .as_str()
                .map(|value| value == "page:project:0")
                .unwrap_or(false)
        }));
        assert!(card["text"].as_str().unwrap().contains("Page 2 / 2"));
    }

    #[test]
    fn pick_project_accepts_feishu_button_label() {
        let projects = vec![proj("p1", "塔家军", "/a"), proj("p2", "cc-workspace", "/b")];
        assert_eq!(
            pick_project(&projects, "2. cc-workspace").map(|p| p.id.as_str()),
            Some("p2")
        );
        assert_eq!(
            pick_project(&projects, "2").map(|p| p.id.as_str()),
            Some("p2")
        );
        assert_eq!(
            apply_project_pick(&ScopeBinding::fresh("/tmp"), &projects, "2. cc-workspace")
                .unwrap()
                .project_id
                .as_deref(),
            Some("p2")
        );
    }

    #[test]
    fn card_action_applies_same_as_text_pick() {
        let projects = vec![proj("p1", "A", "/a"), proj("p2", "B", "/b")];
        let b = ScopeBinding::fresh("/tmp");
        let via_text = apply_project_pick(&b, &projects, "2").unwrap();
        let via_card = apply_project_pick(&b, &projects, "p2").unwrap();
        assert_eq!(via_text.work_dir, via_card.work_dir);
        assert_eq!(via_text.project_id, via_card.project_id);
        assert_eq!(via_text.pending_mode, PendingMode::New);

        let sessions = vec![
            sess("s1", "p2", "One", Some("ag1")),
            sess("s2", "p2", "Two", Some("ag2")),
        ];
        let t = apply_session_pick(&via_text, &sessions, "1").unwrap();
        let c = apply_session_pick(&via_text, &sessions, "s1").unwrap();
        assert_eq!(t.agent_session_id, c.agent_session_id);
        assert_eq!(t.pending_mode, PendingMode::Resume);
    }

    #[test]
    fn grok_cli_args_include_resume_when_set() {
        let with = grok_turn_cli_args("hi", Some("sess-1"), true);
        assert!(with
            .windows(2)
            .any(|w| w[0] == "--resume" && w[1] == "sess-1"));
        let without = grok_turn_cli_args("hi", None, false);
        assert!(!without.iter().any(|a| a == "--resume"));
    }

    #[test]
    fn grok_cli_args_default_streaming_json() {
        let args = grok_turn_cli_args("hi", None, false);
        assert!(args
            .windows(2)
            .any(|w| { w[0] == "--output-format" && w[1] == "streaming-json" }));
        assert!(!args.iter().any(|a| a == "--include-partial-messages"));
    }

    #[test]
    fn grok_cli_args_partial_with_messages_format() {
        let args = grok_turn_cli_args_with_stream(
            "hi",
            None,
            false,
            "streaming-messages-json",
            &["--include-partial-messages"],
        );
        assert!(args
            .windows(2)
            .any(|w| { w[0] == "--output-format" && w[1] == "streaming-messages-json" }));
        assert!(args.iter().any(|a| a == "--include-partial-messages"));
    }

    #[test]
    fn multi_turn_resume_id_propagates() {
        // Simulates: resume pick → turn1 returns sid → turn2 still resumes
        let b0 = ScopeBinding {
            project_id: Some("p1".into()),
            work_dir: "/w".into(),
            local_session_id: "l".into(),
            agent_session_id: None,
            pending_mode: PendingMode::New,
            turn_count: 0,
            context_usage: None,
            last_compact: None,
        };
        let s = sess("app1", "p1", "Chat", Some("agent-xyz"));
        let b1 = binding_after_session_resume(&b0, &s);
        let intent1 = resolve_turn_intent(&b1);
        assert!(matches!(
            intent1,
            TurnIntent::ResumeSession {
                agent_session_id: ref id,
                ..
            } if id == "agent-xyz"
        ));
        let b2 = binding_after_agent_turn(&b1, Some("agent-xyz"));
        let intent2 = resolve_turn_intent(&b2);
        match intent2 {
            TurnIntent::ResumeSession {
                agent_session_id, ..
            } => assert_eq!(agent_session_id, "agent-xyz"),
            _ => panic!("second turn must resume"),
        }
        // CLI path for turn 2
        let args = grok_turn_cli_args("follow up", Some("agent-xyz"), false);
        assert!(args.contains(&"--resume".into()));
    }

    #[test]
    fn old_scope_binding_json_defaults_context_fields() {
        let binding: ScopeBinding = serde_json::from_value(serde_json::json!({
            "projectId": "p1",
            "workDir": "/tmp/project",
            "localSessionId": "local-1",
            "agentSessionId": "agent-1",
            "pendingMode": "continue",
            "turnCount": 2
        }))
        .expect("old persisted binding should still deserialize");
        assert!(binding.context_usage.is_none());
        assert!(binding.last_compact.is_none());
    }
}
