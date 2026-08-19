//! Message engine: ACL, slash commands, Grok turns, project/session bind.

#![allow(dead_code)] // residual-clippy: ephemeral engine API
use super::app_sessions;
use super::context::{
    estimate_visible_tokens, format_tokens, latest_compact_from_messages, ContextCompactSnapshot,
    ContextUsageSnapshot,
};
use super::control_plane::{
    self, apply_project_pick, apply_session_pick, binding_after_agent_turn,
    channel_uses_cards_with_options, format_project_menu, format_session_menu,
    list_sessions_for_project, parse_card_action, resolve_turn_intent, AppSessionEntry, CardAction,
    PendingMode, ScopeBinding, TurnIntent,
};
use super::grok_agent;
use super::i18n::{self, MessageKey};
use super::outbound::{self, OutboundRouter};
use super::projects;
use super::resilience::{
    agent_error_user_message, classify_rim_error, rate_limit_user_message, InboundRateLimiter,
};
use super::session::SessionStore;
use super::slash::{self, BuiltinCommand};
use super::types::{ChannelInstance, IncomingMessage, TrustedProject};
use crate::account_profiles::{self, SavedAccount};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tauri::{Emitter, Manager};
use tokio::sync::oneshot;
use tokio::task::JoinHandle;

#[derive(Clone)]
struct PendingPick {
    kind: PickKind,
    /// For session pick: listed App sessions at menu time.
    sessions: Vec<AppSessionEntry>,
    /// For account pick: saved multi-account snapshots at menu time (order = menu numbers).
    accounts: Vec<SavedAccount>,
}

#[derive(Clone, Copy)]
enum PickKind {
    Project,
    Session,
    Account,
}

#[derive(Clone)]
struct AccountQuotaLine {
    account: SavedAccount,
    is_active: bool,
    remaining_percent: Option<f64>,
    used_percent: Option<f64>,
    subscription_tier: Option<String>,
    quota_note: Option<String>,
}

type ActiveTurnSenders = Arc<Mutex<HashMap<String, HashMap<u64, oneshot::Sender<()>>>>>;
type RegisteredTurn = (ActiveTurnRegistration, oneshot::Receiver<()>);

struct ActiveTurnRegistration {
    turns: ActiveTurnSenders,
    scope: String,
    id: u64,
}

impl Drop for ActiveTurnRegistration {
    fn drop(&mut self) {
        self.remove();
    }
}

impl ActiveTurnRegistration {
    /// Atomically mark this turn complete. If `/stop` removed it first, the
    /// completed CLI result must not be persisted or sent.
    fn complete(&mut self) -> bool {
        self.remove()
    }

    fn remove(&mut self) -> bool {
        let mut turns = self.turns.lock();
        let Some(scope_turns) = turns.get_mut(&self.scope) else {
            return false;
        };
        let removed = scope_turns.remove(&self.id).is_some();
        if scope_turns.is_empty() {
            turns.remove(&self.scope);
        }
        removed
    }
}

pub struct Engine {
    store: SessionStore,
    outbound: OutboundRouter,
    instances: Arc<Mutex<HashMap<String, ChannelInstance>>>,
    pending: Arc<Mutex<HashMap<String, PendingPick>>>,
    active_turns: ActiveTurnSenders,
    next_turn_id: AtomicU64,
    /// Soft inbound rate limit (agent turns only; slash/control exempt).
    rate_limiter: Mutex<InboundRateLimiter>,
    /// Cached catalog id (`en` / `zh` / `zh-TW`), refreshed per inbound message.
    reply_lang: Mutex<String>,
    allow_remote_yolo: bool,
}

impl Engine {
    pub fn new(outbound: OutboundRouter, allow_remote_yolo: bool) -> Self {
        let store = SessionStore::open_default();
        store.register_live();
        Self {
            store,
            outbound,
            instances: Arc::new(Mutex::new(HashMap::new())),
            pending: Arc::new(Mutex::new(HashMap::new())),
            active_turns: Arc::new(Mutex::new(HashMap::new())),
            next_turn_id: AtomicU64::new(1),
            rate_limiter: Mutex::new(InboundRateLimiter::default()),
            reply_lang: Mutex::new(i18n::resolve_engine_lang()),
            allow_remote_yolo,
        }
    }

    /// Test helper: ephemeral store.
    pub fn new_ephemeral(outbound: OutboundRouter, allow_remote_yolo: bool) -> Self {
        Self {
            store: SessionStore::ephemeral(),
            outbound,
            instances: Arc::new(Mutex::new(HashMap::new())),
            pending: Arc::new(Mutex::new(HashMap::new())),
            active_turns: Arc::new(Mutex::new(HashMap::new())),
            next_turn_id: AtomicU64::new(1),
            rate_limiter: Mutex::new(InboundRateLimiter::default()),
            reply_lang: Mutex::new(i18n::resolve_engine_lang()),
            allow_remote_yolo,
        }
    }

    fn refresh_lang(&self) {
        *self.reply_lang.lock() = i18n::resolve_engine_lang();
    }

    fn lang(&self) -> String {
        self.reply_lang.lock().clone()
    }

    pub fn upsert_instance(&self, inst: ChannelInstance) {
        self.instances.lock().insert(inst.id.clone(), inst);
    }

    pub fn remove_instance(&self, id: &str) {
        self.instances.lock().remove(id);
    }

    fn register_active_turn(&self, scope: &str) -> RegisteredTurn {
        let id = self.next_turn_id.fetch_add(1, Ordering::Relaxed);
        let (cancel_tx, cancel_rx) = oneshot::channel();
        self.active_turns
            .lock()
            .entry(scope.to_string())
            .or_default()
            .insert(id, cancel_tx);
        (
            ActiveTurnRegistration {
                turns: self.active_turns.clone(),
                scope: scope.to_string(),
                id,
            },
            cancel_rx,
        )
    }

    fn cancel_active_turns(&self, scope: &str) -> usize {
        let senders = self.active_turns.lock().remove(scope).unwrap_or_default();
        let count = senders.len();
        for (_, cancel_tx) in senders {
            let _ = cancel_tx.send(());
        }
        count
    }

    fn agent_error_message(&self, error: &str) -> String {
        agent_error_user_message(&self.lang(), classify_rim_error(error), error)
    }

    fn thread_isolation_for(&self, instance_id: &str) -> bool {
        self.instances
            .lock()
            .get(instance_id)
            .map(|i| {
                i.options
                    .get("thread_isolation")
                    .and_then(|x| x.as_bool())
                    .unwrap_or(false)
                    || i.options.get("thread_isolation").and_then(|x| x.as_str()) == Some("true")
            })
            .unwrap_or(false)
    }

    fn scope_for(&self, msg: &IncomingMessage) -> String {
        SessionStore::scope_key_for(msg, self.thread_isolation_for(&msg.instance_id))
    }

    fn channel_prefers_cards(&self, msg: &IncomingMessage) -> bool {
        let opts = self
            .instances
            .lock()
            .get(&msg.instance_id)
            .map(|i| i.options.clone());
        channel_uses_cards_with_options(&msg.channel, opts.as_ref())
    }

    /// Trusted projects limited by instance project_scope (GUI whitelist or all).
    fn scoped_projects_for(&self, instance_id: &str) -> Vec<TrustedProject> {
        let scope = self
            .instances
            .lock()
            .get(instance_id)
            .map(|i| i.project_scope.clone())
            .unwrap_or_else(|| serde_json::json!("all_trusted"));
        projects::load_scoped_projects(&scope)
    }

    pub async fn handle(&self, msg: IncomingMessage) {
        self.handle_inner(msg, None).await;
    }

    /// Register before spawning so a following `/stop` cannot overtake an
    /// inbound free-form message that Tokio has not polled yet.
    pub(super) fn spawn_cancellable(self: &Arc<Self>, msg: IncomingMessage) -> JoinHandle<()> {
        let scope = self.scope_for(&msg);
        let registered = self.register_active_turn(&scope);
        let engine = self.clone();
        tokio::spawn(async move {
            engine.handle_inner(msg, Some(registered)).await;
        })
    }

    async fn handle_inner(&self, msg: IncomingMessage, mut registered: Option<RegisteredTurn>) {
        self.refresh_lang();
        tracing::info!(
            channel = %msg.channel,
            instance = %msg.instance_id,
            content_len = msg.content.len(),
            "remote_im: handle begin"
        );
        // Card actions must never fall through to text-pick (that produced「无效选择」).
        if msg.content.trim().starts_with("__card_action__:") {
            if let Some(action) = extract_card_action(&msg) {
                self.handle_card_action(action, &msg).await;
            } else {
                tracing::warn!(
                    content = %msg.content.chars().take(200).collect::<String>(),
                    "remote_im: unparseable card action payload"
                );
                let t = if self.lang() == "en" {
                    "Could not read that card button. Send /p again, or reply with the number."
                } else {
                    "无法识别卡片按钮。请重新发送 /p，或直接回复序号（如 2）。"
                };
                let _ = self.reply_msg(&msg, t).await;
            }
            return;
        }
        if let Some(action) = extract_card_action(&msg) {
            self.handle_card_action(action, &msg).await;
            return;
        }

        let inst = {
            let g = self.instances.lock();
            match g.get(&msg.instance_id) {
                Some(i) => i.clone(),
                None => {
                    tracing::warn!(
                        instance = %msg.instance_id,
                        channel = %msg.channel,
                        "remote_im: drop message — instance not registered in engine"
                    );
                    return;
                }
            }
        };

        let content = msg.content.trim().to_string();
        if content.is_empty() {
            return;
        }

        if msg.chat_type == "group"
            && outbound::require_mention(&inst.options, &inst.acl)
            && !msg.mentioned_bot
        {
            return;
        }

        if !outbound::sender_allowed(&inst.acl, &msg.sender_id) {
            let text = if self.lang() == "en" {
                "You are not on the allow_from list."
            } else {
                "你不在 allow_from 白名单中。请管理员把你的 open_id 加入配置。"
            };
            let _ = self.reply_msg(&msg, text).await;
            return;
        }

        let scope = self.scope_for(&msg);
        let alt_scope = SessionStore::scope_key(
            &msg.channel,
            &msg.instance_id,
            &msg.sender_id,
            &msg.sender_id,
        );
        let default_wd = projects::default_work_dir(&inst.project_scope).unwrap_or_default();

        // Single lock scope — never nest pending.lock() (parking_lot is not reentrant;
        // or_else(|| self.pending.lock()...) deadlocked every first message after start).
        let pending = {
            let g = self.pending.lock();
            g.get(&scope)
                .cloned()
                .or_else(|| g.get(&alt_scope).cloned())
        };
        // Slash commands always win over number-pick mode (e.g. `/account 2` while listing).
        if let Some(cmd) = slash::parse_slash(&content) {
            if pending.is_some() {
                let mut g = self.pending.lock();
                g.remove(&scope);
                g.remove(&alt_scope);
            }
            tracing::info!(?cmd, "remote_im: slash command");
            self.handle_slash(cmd, &msg, &scope, &default_wd, registered.take())
                .await;
            tracing::info!("remote_im: slash done");
            return;
        }

        if let Some(pending) = pending {
            if content == "0" || content.eq_ignore_ascii_case("cancel") {
                {
                    let mut g = self.pending.lock();
                    g.remove(&scope);
                    g.remove(&alt_scope);
                }
                let t = if self.lang() == "en" {
                    "Cancelled."
                } else {
                    "已取消。"
                };
                let _ = self.reply_msg(&msg, t).await;
                return;
            }
            self.handle_text_pick(&pending, &content, &scope, &msg, &default_wd)
                .await;
            return;
        }

        // Soft inbound rate limit — honest reply, never silent drop.
        // Drop parking_lot guard before any `.await` (Send + no hold across await).
        let rate_block = {
            // Per chat (not per sender) — matches UI copy "8 / chat / 60s".
            let chat_scope = format!("{}:{}:{}", msg.channel, msg.instance_id, msg.chat_id);
            let mut lim = self.rate_limiter.lock();
            lim.prune_if_large(4096);
            lim.try_acquire(&chat_scope).err()
        };
        if let Some(retry_after) = rate_block {
            let t = rate_limit_user_message(&self.lang(), retry_after);
            tracing::warn!(
                scope = %scope,
                retry_secs = retry_after.as_secs(),
                "remote_im: inbound rate limited (honest reply)"
            );
            let _ = self.reply_msg(&msg, &t).await;
            return;
        }
        tracing::info!("remote_im: agent turn");
        self.run_agent_turn(&msg, &scope, &default_wd, &content, registered.take())
            .await;
        tracing::info!("remote_im: agent turn done");
    }

    async fn handle_card_action(&self, action: CardAction, msg: &IncomingMessage) {
        let inst = {
            let instances = self.instances.lock();
            match instances.get(&msg.instance_id) {
                Some(instance) => instance.clone(),
                None => return,
            }
        };
        // Interactive callback payloads are user-controlled too. Apply the same ACL
        // gate as ordinary messages before binding projects/sessions or switching auth.
        if !outbound::sender_allowed(&inst.acl, &msg.sender_id) {
            let text = if self.lang() == "en" {
                "You are not on the allow_from list."
            } else {
                "你不在 allow_from 白名单中。"
            };
            let _ = self.reply_msg(msg, text).await;
            return;
        }
        let scope = self.scope_for(msg);
        // Also clear pending under sender-only scopes (chat_id may differ on card callback).
        let alt_scope = SessionStore::scope_key(
            &msg.channel,
            &msg.instance_id,
            &msg.sender_id,
            &msg.sender_id,
        );
        let default_wd = projects::default_work_dir(&inst.project_scope).unwrap_or_default();
        // Prefer existing binding from either scope key
        let binding = self
            .store
            .get(&scope)
            .or_else(|| self.store.get(&alt_scope))
            .unwrap_or_else(|| self.store.get_or_create(&scope, &default_wd));
        let keep_pending = matches!(&action, CardAction::Page { .. });
        if !keep_pending {
            self.pending.lock().remove(&scope);
            self.pending.lock().remove(&alt_scope);
        }

        match action {
            CardAction::Cancel => {
                let t = if self.lang() == "en" {
                    "Cancelled."
                } else {
                    "已取消。"
                };
                let _ = self.reply_msg(msg, t).await;
            }
            CardAction::Project { id } => {
                let projects = self.scoped_projects_for(&msg.instance_id);
                match apply_project_pick(&binding, &projects, &id) {
                    Ok(next) => {
                        // Persist under both chat and sender scopes so next IM messages find it.
                        self.store.set(&scope, next.clone());
                        self.store.set(&alt_scope, next.clone());
                        let name = projects
                            .iter()
                            .find(|p| Some(p.id.as_str()) == next.project_id.as_deref())
                            .map(|p| p.name.as_str())
                            .unwrap_or(next.project_id.as_deref().unwrap_or(""));
                        let t = if self.lang() == "en" {
                            format!(
                                "Bound **{name}**\n`{}`\nNext message starts a **new** session.",
                                next.work_dir
                            )
                        } else {
                            format!(
                                "已绑定 **{name}**\n`{}`\n下一条消息将开启**新**会话。",
                                next.work_dir
                            )
                        };
                        let _ = self.reply_msg(msg, &t).await;
                    }
                    Err(_) => {
                        let t = if self.lang() == "en" {
                            "Project not found. Send /p again."
                        } else {
                            "未找到项目。请重新发送 /p。"
                        };
                        let _ = self.reply_msg(msg, t).await;
                    }
                }
            }
            CardAction::Session { id } => {
                let sessions = app_sessions::sessions_for_project(binding.project_id.as_deref());
                match apply_session_pick(&binding, &sessions, &id) {
                    Ok(next) => {
                        let aid = next.agent_session_id.clone().unwrap_or_default();
                        self.store.set(&scope, next);
                        let t = if self.lang() == "en" {
                            format!("Resumed session `{aid}`. Continue chatting.")
                        } else {
                            format!("已恢复会话 `{aid}`。继续对话即可。")
                        };
                        let _ = self.reply_msg(msg, &t).await;
                    }
                    Err(_) => {
                        let t = if self.lang() == "en" {
                            "Session not found. Send /r again."
                        } else {
                            "未找到会话。请重新发送 /r。"
                        };
                        let _ = self.reply_msg(msg, t).await;
                    }
                }
            }
            CardAction::Account { id } => {
                // Callback data is user-controlled. Resolve only ids present in the
                // persisted account index before any auth snapshot path is touched.
                let listed = account_profiles::list_accounts();
                if listed.profiles.iter().any(|account| account.id == id) {
                    self.do_switch_account(&id, msg).await;
                } else {
                    let t = if self.lang() == "en" {
                        "Account not found. Send /account again."
                    } else {
                        "未找到账号。请重新发送 /account。"
                    };
                    let _ = self.reply_msg(msg, t).await;
                }
            }
            CardAction::Page { menu, page } => {
                self.handle_telegram_page(&menu, page, &binding, &scope, msg)
                    .await;
            }
        }
    }

    async fn handle_telegram_page(
        &self,
        menu: &str,
        page: usize,
        binding: &ScopeBinding,
        scope: &str,
        msg: &IncomingMessage,
    ) {
        if msg.channel != "telegram" {
            return;
        }
        let card = match menu {
            "project" => {
                let projects = self.scoped_projects_for(&msg.instance_id);
                if projects.is_empty() {
                    let _ = self
                        .reply_msg(msg, &format_project_menu(&projects, &self.lang()))
                        .await;
                    return;
                }
                self.insert_pending(
                    scope,
                    msg,
                    PendingPick {
                        kind: PickKind::Project,
                        sessions: vec![],
                        accounts: vec![],
                    },
                );
                control_plane::build_telegram_project_card(&projects, &self.lang(), page)
            }
            "session" => {
                let sessions = app_sessions::sessions_for_project(binding.project_id.as_deref());
                if sessions.is_empty() {
                    let _ = self
                        .reply_msg(msg, &format_session_menu(&sessions, &self.lang()))
                        .await;
                    return;
                }
                self.insert_pending(
                    scope,
                    msg,
                    PendingPick {
                        kind: PickKind::Session,
                        sessions: sessions.clone(),
                        accounts: vec![],
                    },
                );
                control_plane::build_telegram_session_card(&sessions, &self.lang(), page)
            }
            "account" => {
                let listed = account_profiles::list_accounts();
                let active_id = listed.active_id;
                let profiles = listed.profiles;
                if profiles.is_empty() {
                    let t = if self.lang() == "en" {
                        "No saved accounts yet. Add accounts in Grok App first."
                    } else {
                        "尚无已保存账号。请先在 Grok App 中添加账号。"
                    };
                    let _ = self.reply_msg(msg, t).await;
                    return;
                }
                let lines = self
                    .load_account_quota_lines(&profiles, active_id.as_deref())
                    .await;
                let text = format_account_menu(&lines, &self.lang());
                let choices: Vec<(String, String)> = profiles
                    .iter()
                    .map(|account| (account.id.clone(), account.label.clone()))
                    .collect();
                self.insert_pending(
                    scope,
                    msg,
                    PendingPick {
                        kind: PickKind::Account,
                        sessions: vec![],
                        accounts: profiles,
                    },
                );
                control_plane::build_telegram_account_card(&text, &choices, &self.lang(), page)
            }
            _ => return,
        };

        if self
            .outbound
            .edit_card(
                &msg.instance_id,
                &msg.chat_id,
                &msg.message_id,
                &card,
                msg.thread_id(),
            )
            .await
            .is_err()
        {
            let _ = self
                .outbound
                .reply_card(&msg.instance_id, &msg.chat_id, None, &card, msg.thread_id())
                .await;
        }
    }

    async fn handle_text_pick(
        &self,
        pending: &PendingPick,
        content: &str,
        scope: &str,
        msg: &IncomingMessage,
        default_wd: &str,
    ) {
        let binding = self.store.get_or_create(scope, default_wd);
        match pending.kind {
            PickKind::Project => {
                let projects = self.scoped_projects_for(&msg.instance_id);
                match apply_project_pick(&binding, &projects, content) {
                    Ok(next) => {
                        self.pending.lock().remove(scope);
                        let alt = SessionStore::scope_key(
                            &msg.channel,
                            &msg.instance_id,
                            &msg.sender_id,
                            &msg.sender_id,
                        );
                        self.pending.lock().remove(&alt);
                        self.store.set(scope, next.clone());
                        self.store.set(&alt, next.clone());
                        let name = projects
                            .iter()
                            .find(|p| Some(p.id.as_str()) == next.project_id.as_deref())
                            .map(|p| p.name.as_str())
                            .unwrap_or(next.project_id.as_deref().unwrap_or(""));
                        let t = if self.lang() == "en" {
                            format!(
                                "Bound **{name}**\n`{}`\nNext message starts a **new** session.",
                                next.work_dir
                            )
                        } else {
                            format!(
                                "已绑定 **{name}**\n`{}`\n下一条消息将开启**新**会话。",
                                next.work_dir
                            )
                        };
                        let _ = self.reply_msg(msg, &t).await;
                    }
                    Err(e) => {
                        tracing::warn!(
                            pick = %content,
                            err = %e,
                            n_projects = projects.len(),
                            "remote_im: project text pick failed"
                        );
                        let t = if self.lang() == "en" {
                            format!(
                                "Invalid pick `{content}`. Send number (1–{}) or name, or 0 to cancel.",
                                projects.len()
                            )
                        } else {
                            format!(
                                "无效选择 `{}`。请发送序号（1–{}）或名称，或 0 取消。",
                                content.chars().take(40).collect::<String>(),
                                projects.len()
                            )
                        };
                        let _ = self.reply_msg(msg, &t).await;
                    }
                }
            }
            PickKind::Session => match apply_session_pick(&binding, &pending.sessions, content) {
                Ok(next) => {
                    self.pending.lock().remove(scope);
                    let aid = next
                        .agent_session_id
                        .clone()
                        .unwrap_or_else(|| next.local_session_id.clone());
                    self.store.set(scope, next);
                    let t = if self.lang() == "en" {
                        format!("Resumed session `{aid}`. Continue chatting.")
                    } else {
                        format!("已恢复会话 `{aid}`。继续对话即可。")
                    };
                    let _ = self.reply_msg(msg, &t).await;
                }
                Err(_) => {
                    let t = if self.lang() == "en" {
                        "Invalid pick. Send number, or 0 to cancel. (No session was bound.)"
                    } else {
                        "无效选择。请发送序号，或 0 取消。（未绑定任何会话）"
                    };
                    let _ = self.reply_msg(msg, t).await;
                }
            },
            PickKind::Account => {
                match account_profiles::resolve_account_pick(content, &pending.accounts) {
                    Ok(id) => {
                        self.clear_pending(scope, msg);
                        self.do_switch_account(&id, msg).await;
                    }
                    Err(_) => {
                        let t = if self.lang() == "en" {
                            format!(
                                "Invalid pick `{content}`. Send number (1–{}) or label, or 0 to cancel.",
                                pending.accounts.len()
                            )
                        } else {
                            format!(
                                "无效选择 `{}`。请发送序号（1–{}）或标签，或 0 取消。",
                                content.chars().take(40).collect::<String>(),
                                pending.accounts.len()
                            )
                        };
                        let _ = self.reply_msg(msg, &t).await;
                    }
                }
            }
        }
    }

    fn clear_pending(&self, scope: &str, msg: &IncomingMessage) {
        let alt = SessionStore::scope_key(
            &msg.channel,
            &msg.instance_id,
            &msg.sender_id,
            &msg.sender_id,
        );
        let mut g = self.pending.lock();
        g.remove(scope);
        g.remove(&alt);
    }

    async fn handle_account(&self, query: Option<&str>, scope: &str, msg: &IncomingMessage) {
        let listed = account_profiles::list_accounts();
        let profiles = listed.profiles.clone();

        if let Some(q) = query {
            if profiles.is_empty() {
                let t = if self.lang() == "en" {
                    "No saved accounts yet. Sign in / add accounts in Grok App → Settings → Account, then try again."
                } else {
                    "尚无已保存账号。请先在 Grok App「设置 → 账号」登录或添加账号后再试。"
                };
                let _ = self.reply_msg(msg, t).await;
                return;
            }
            match account_profiles::resolve_account_pick(q, &profiles) {
                Ok(id) => {
                    self.clear_pending(scope, msg);
                    self.do_switch_account(&id, msg).await;
                }
                Err(_) => {
                    let t = if self.lang() == "en" {
                        format!("Account not found: `{q}`. Send `/account` to list.")
                    } else {
                        format!("未找到账号：`{q}`。发送 `/account` 查看列表。")
                    };
                    let _ = self.reply_msg(msg, &t).await;
                }
            }
            return;
        }

        // List + quota (best-effort network per snapshot).
        let thinking = if self.lang() == "en" {
            "Loading accounts & quota…"
        } else {
            "正在拉取账号与额度…"
        };
        let _ = self.reply_msg(msg, thinking).await;

        let lines = self
            .load_account_quota_lines(&profiles, listed.active_id.as_deref())
            .await;
        let text = format_account_menu(&lines, &self.lang());
        if !profiles.is_empty() {
            self.insert_pending(
                scope,
                msg,
                PendingPick {
                    kind: PickKind::Account,
                    sessions: vec![],
                    accounts: profiles.clone(),
                },
            );
        }
        if msg.channel == "telegram" && !profiles.is_empty() {
            let choices: Vec<(String, String)> = profiles
                .iter()
                .map(|account| (account.id.clone(), account.label.clone()))
                .collect();
            let card = control_plane::build_telegram_account_card(&text, &choices, &self.lang(), 0);
            let _ = self
                .outbound
                .reply_card(
                    &msg.instance_id,
                    &msg.chat_id,
                    Some(&msg.message_id),
                    &card,
                    msg.thread_id(),
                )
                .await;
        } else {
            let _ = self.reply_msg(msg, &text).await;
        }
    }

    async fn load_account_quota_lines(
        &self,
        profiles: &[SavedAccount],
        active_id: Option<&str>,
    ) -> Vec<AccountQuotaLine> {
        if profiles.is_empty() {
            // Fall back to current CLI auth only (no multi-account snapshots).
            let profile = crate::account::read_auth_profile();
            if !profile.signed_in {
                return Vec::new();
            }
            let mut line = AccountQuotaLine {
                account: SavedAccount {
                    id: "_current".into(),
                    email: profile.email.clone(),
                    display_name: profile.display_name.clone(),
                    label: profile
                        .email
                        .clone()
                        .or(profile.display_name.clone())
                        .unwrap_or_else(|| "Current".into()),
                    updated_at: String::new(),
                },
                is_active: true,
                remaining_percent: None,
                used_percent: None,
                subscription_tier: None,
                quota_note: None,
            };
            if let Some(token) = crate::account::speech_access_token() {
                let snap = crate::supergrok_quota::fetch_quota_best_effort(&token).await;
                if snap.source != "error" {
                    line.used_percent = Some(f64::from(snap.used_percent));
                    line.remaining_percent = Some(f64::from(snap.remaining_percent));
                } else {
                    line.quota_note = snap.last_error.or_else(|| Some("quota unavailable".into()));
                }
                let status = crate::account::account_status(None, true).await;
                line.subscription_tier = status.billing.subscription_tier;
                if line.remaining_percent.is_none() {
                    line.remaining_percent = status.billing.remaining_percent;
                    line.used_percent = status.billing.credit_usage_percent;
                }
            } else {
                line.quota_note = Some(
                    if self.lang() == "en" {
                        "not signed in / no token"
                    } else {
                        "未登录或无 token"
                    }
                    .into(),
                );
            }
            return vec![line];
        }

        // Parallel quota fetch — each snapshot uses its own token (order preserved).
        let lang_en = self.lang() == "en";
        let futs: Vec<_> = profiles
            .iter()
            .map(|p| {
                let p = p.clone();
                let is_active = active_id == Some(p.id.as_str());
                async move {
                    let mut line = AccountQuotaLine {
                        account: p.clone(),
                        is_active,
                        remaining_percent: None,
                        used_percent: None,
                        subscription_tier: None,
                        quota_note: None,
                    };
                    match account_profiles::access_token_for_account(&p.id) {
                        Some(token) => {
                            let snap =
                                crate::supergrok_quota::fetch_quota_best_effort(&token).await;
                            if snap.source != "error" {
                                line.used_percent = Some(f64::from(snap.used_percent));
                                line.remaining_percent = Some(f64::from(snap.remaining_percent));
                            } else {
                                line.quota_note =
                                    snap.last_error.or_else(|| Some("quota unavailable".into()));
                            }
                        }
                        None => {
                            line.quota_note = Some(
                                if lang_en {
                                    "snapshot missing token"
                                } else {
                                    "快照无 token"
                                }
                                .into(),
                            );
                        }
                    }
                    line
                }
            })
            .collect();
        futures_util::future::join_all(futs).await
    }

    async fn do_switch_account(&self, id: &str, msg: &IncomingMessage) {
        match account_profiles::switch_account(id) {
            Ok(profile) => {
                // Soft-drop desktop ACP so next App chat uses new credentials too.
                soft_disconnect_desktop_after_account_switch().await;

                let label = profile
                    .email
                    .clone()
                    .or(profile.display_name.clone())
                    .unwrap_or_else(|| id.to_string());

                // Refresh quota for the newly active account (also warms billing cache).
                let status = crate::account::account_status(None, true).await;
                let quota_line = format_quota_brief(&status.billing, &self.lang());
                let t = if self.lang() == "en" {
                    format!(
                        "Switched to **{label}**\n{quota_line}\nNext Remote IM / App turns use this account."
                    )
                } else {
                    format!(
                        "已切换到 **{label}**\n{quota_line}\n后续 Remote IM / App 对话将使用此账号。"
                    )
                };
                let _ = self.reply_msg(msg, &t).await;
            }
            Err(e) => {
                let t = if self.lang() == "en" {
                    format!("Switch failed: {e}")
                } else {
                    format!("切换失败：{e}")
                };
                let _ = self.reply_msg(msg, &t).await;
            }
        }
    }

    async fn handle_slash(
        &self,
        cmd: BuiltinCommand,
        msg: &IncomingMessage,
        scope: &str,
        default_wd: &str,
        registered: Option<RegisteredTurn>,
    ) {
        match cmd {
            BuiltinCommand::Help => {
                let _ = self.reply_msg(msg, &slash::help_text(&self.lang())).await;
            }
            BuiltinCommand::Whoami => {
                let text = format!(
                    "**身份**\n- sender: `{}`\n- chat: `{}`\n- type: `{}`",
                    msg.sender_id, msg.chat_id, msg.chat_type
                );
                let _ = self.reply_msg(msg, &text).await;
            }
            BuiltinCommand::New => {
                let cur = self.store.get_or_create(scope, default_wd);
                let wd = cur.work_dir.clone();
                let mut s = ScopeBinding::fresh(&wd);
                s.project_id = cur.project_id;
                self.store.set(scope, s.clone());
                let t = if self.lang() == "en" {
                    format!("New session: `{}`", s.local_session_id)
                } else {
                    format!("已开启新会话：`{}`", s.local_session_id)
                };
                let _ = self.reply_msg(msg, &t).await;
            }
            BuiltinCommand::Status => {
                let s = self.store.get_or_create(scope, default_wd);
                let binary = grok_agent::resolve_grok_binary();
                let text = format!(
                    "**Status**\n- project: `{}`\n- work_dir: `{}`\n- agent_session: `{}`\n- mode: {:?}\n- turns: {}\n- grok: `{}`\n- channel: `{}`",
                    s.project_id.as_deref().unwrap_or("-"),
                    s.work_dir,
                    s.agent_session_id.as_deref().unwrap_or("-"),
                    s.pending_mode,
                    s.turn_count,
                    binary.display(),
                    msg.channel
                );
                let _ = self.reply_msg(msg, &text).await;
            }
            BuiltinCommand::Context => {
                self.handle_context(scope, msg, default_wd).await;
            }
            BuiltinCommand::Compact { note } => {
                self.handle_compact(note.as_deref(), scope, msg, default_wd, registered)
                    .await;
            }
            BuiltinCommand::Stop => {
                let cancelled = self.cancel_active_turns(scope);
                let key = if cancelled > 0 {
                    MessageKey::StopSignalSent
                } else {
                    MessageKey::NoInFlightTurn
                };
                let _ = self.reply_msg(msg, i18n::t(&self.lang(), key)).await;
            }
            BuiltinCommand::Project { query } => {
                self.handle_project(query.as_deref(), scope, msg, default_wd)
                    .await;
            }
            BuiltinCommand::Resume { query } => {
                self.handle_resume(query.as_deref(), scope, msg, default_wd)
                    .await;
            }
            BuiltinCommand::Account { query } => {
                self.handle_account(query.as_deref(), scope, msg).await;
            }
            BuiltinCommand::Unknown { raw } => {
                let t = if self.lang() == "en" {
                    format!("Unknown command `/{raw}`. Send `/help`.")
                } else {
                    format!("未知命令 `/{raw}`。发送 `/help` 查看。")
                };
                let _ = self.reply_msg(msg, &t).await;
            }
        }
    }

    async fn handle_context(&self, scope: &str, msg: &IncomingMessage, default_wd: &str) {
        let binding = self.store.get_or_create(scope, default_wd);
        let messages = crate::store::load_messages(&binding.local_session_id);
        let text = format_context_report(&binding, &messages, &self.lang());
        let _ = self.reply_msg(msg, &text).await;
    }

    async fn handle_compact(
        &self,
        note: Option<&str>,
        scope: &str,
        msg: &IncomingMessage,
        default_wd: &str,
        registered: Option<RegisteredTurn>,
    ) {
        let scoped = self.scoped_projects_for(&msg.instance_id);
        if scope_blocks_agent_io(default_wd, &scoped, self.store.get(scope).as_ref()) {
            if self.store.get(scope).is_some() {
                self.store.remove(scope);
            }
            let _ = self
                .reply_msg(msg, i18n::t(&self.lang(), MessageKey::NoAvailableProject))
                .await;
            return;
        }
        let Some(binding) = self.store.get(scope) else {
            let text = if self.lang() == "en" {
                "No active agent session. Send a message or use /r first."
            } else {
                "当前没有可压缩的 agent 会话。请先发送一条消息，或使用 /r 恢复会话。"
            };
            let _ = self.reply_msg(msg, &text).await;
            return;
        };
        let Some(agent_session_id) = binding
            .agent_session_id
            .as_deref()
            .map(str::trim)
            .filter(|id| !id.is_empty())
            .map(str::to_string)
        else {
            let text = if self.lang() == "en" {
                "No active agent session. Send a message or use /r first."
            } else {
                "当前没有可压缩的 agent 会话。请先发送一条消息，或使用 /r 恢复会话。"
            };
            let _ = self.reply_msg(msg, text).await;
            return;
        };
        let compact_prompt = match note.map(str::trim).filter(|note| !note.is_empty()) {
            Some(note) => format!("/compact {note}"),
            None => "/compact".to_string(),
        };

        let (mut active_turn, mut cancel_rx) =
            registered.unwrap_or_else(|| self.register_active_turn(scope));
        if grok_agent::cancellation_signaled(&mut cancel_rx) {
            return;
        }

        let working = if self.lang() == "en" {
            "Compacting current session…"
        } else {
            "正在压缩当前会话…"
        };
        let _ = self.reply_msg(msg, working).await;

        let before = binding
            .context_usage
            .as_ref()
            .and_then(|usage| usage.total_tokens)
            .or_else(|| {
                binding
                    .last_compact
                    .as_ref()
                    .and_then(|item| item.tokens_after)
            });
        let result = grok_agent::run_turn(
            &PathBuf::from(&binding.work_dir),
            &compact_prompt,
            Some(&agent_session_id),
            self.allow_remote_yolo,
            Some(cancel_rx),
            None,
        )
        .await;
        if result.cancelled || !active_turn.complete() {
            tracing::info!(scope = %scope, "remote_im: compact turn cancelled");
            return;
        }
        if let Some(error) = result.error.as_deref() {
            let text = self.agent_error_message(error);
            let _ = self.reply_msg(msg, &text).await;
            return;
        }

        let event_confirmed = result.compact.is_some();
        let mut compact = result.compact.unwrap_or_else(|| ContextCompactSnapshot {
            trigger: "manual".into(),
            tokens_before: before,
            tokens_after: result.usage.as_ref().and_then(|usage| usage.total_tokens),
            summary_preview: None,
            note: note
                .map(str::trim)
                .filter(|note| !note.is_empty())
                .map(str::to_string),
        });
        if compact.tokens_before.is_none() {
            compact.tokens_before = before;
        }
        if compact.tokens_after.is_none() {
            compact.tokens_after = result.usage.as_ref().and_then(|usage| usage.total_tokens);
        }
        if compact.note.is_none() {
            compact.note = note
                .map(str::trim)
                .filter(|note| !note.is_empty())
                .map(str::to_string);
        }

        let mut next = binding_after_agent_turn(
            &binding,
            result
                .session_id
                .as_deref()
                .or(Some(agent_session_id.as_str())),
        );
        next.last_compact = Some(compact.clone());
        next.context_usage = result.usage.or_else(|| {
            compact.tokens_after.map(|tokens| ContextUsageSnapshot {
                total_tokens: Some(tokens),
                input_tokens: None,
                output_tokens: None,
                system_tokens: None,
                tools_tokens: None,
                history_tokens: None,
                source: "compact".into(),
            })
        });
        self.store.set(scope, next.clone());
        app_sessions::sync_compact_to_app(&next, &compact);

        let span = format_compact_span(compact.tokens_before, compact.tokens_after);
        let text = if self.lang() == "en" {
            if event_confirmed {
                format!("Compaction completed.{span}\nUse /context to inspect the current size.")
            } else {
                format!("/compact was sent.{span}\nThis CLI did not emit a compaction event; use /context to inspect the latest available size.")
            }
        } else if event_confirmed {
            format!("会话压缩完成。{span}\n可发送 /context 查看当前大小。")
        } else {
            format!("已发送 /compact。{span}\n当前 CLI 未返回压缩事件，可发送 /context 查看最新可用大小。")
        };
        let _ = self.reply_msg(msg, &text).await;
    }

    async fn handle_project(
        &self,
        query: Option<&str>,
        scope: &str,
        msg: &IncomingMessage,
        default_wd: &str,
    ) {
        let projects = self.scoped_projects_for(&msg.instance_id);
        if projects.is_empty() {
            let t = if self.lang() == "en" {
                "No trusted projects in scope. Trust a folder in Grok App, or widen project scope in Remote control settings."
            } else {
                "当前范围内没有已信任项目。请先在 Grok App 中信任项目，或在远程控制设置中放宽项目范围。"
            };
            let _ = self.reply_msg(msg, t).await;
            return;
        }

        if let Some(q) = query {
            let binding = self.store.get_or_create(scope, default_wd);
            match apply_project_pick(&binding, &projects, q) {
                Ok(next) => {
                    self.store.set(scope, next.clone());
                    let t = if self.lang() == "en" {
                        format!(
                            "Bound **{}**\n`{}`\nNext message starts a **new** session.",
                            next.project_id.as_deref().unwrap_or(""),
                            next.work_dir
                        )
                    } else {
                        format!(
                            "已绑定 **{}**\n`{}`\n下一条消息将开启**新**会话。",
                            next.project_id.as_deref().unwrap_or(""),
                            next.work_dir
                        )
                    };
                    let _ = self.reply_msg(msg, &t).await;
                }
                Err(_) => {
                    let t = if self.lang() == "en" {
                        format!("Not found: {q}. Send /p again.")
                    } else {
                        format!("未找到：{q}。请重新发送 /p。")
                    };
                    let _ = self.reply_msg(msg, &t).await;
                }
            }
            return;
        }

        // Menu: native cards/buttons where supported, text otherwise.
        if self.channel_prefers_cards(msg) {
            let card = match msg.channel.as_str() {
                "dingtalk" => control_plane::build_dingtalk_project_card(&projects, &self.lang()),
                "telegram" => {
                    control_plane::build_telegram_project_card(&projects, &self.lang(), 0)
                }
                _ => control_plane::build_feishu_project_card(&projects, &self.lang()),
            };
            let _ = self
                .outbound
                .reply_card(
                    &msg.instance_id,
                    &msg.chat_id,
                    Some(&msg.message_id),
                    &card,
                    msg.thread_id(),
                )
                .await;
            // Still allow text pick as fallback (number / name). Mirror under sender scope
            // so card callbacks with different chat_id still clear the same pending.
            let pick = PendingPick {
                kind: PickKind::Project,
                sessions: vec![],
                accounts: vec![],
            };
            self.insert_pending(scope, msg, pick);
        } else {
            let text = format_project_menu(&projects, &self.lang());
            self.insert_pending(
                scope,
                msg,
                PendingPick {
                    kind: PickKind::Project,
                    sessions: vec![],
                    accounts: vec![],
                },
            );
            let _ = self.reply_msg(msg, &text).await;
        }
    }

    fn insert_pending(&self, scope: &str, msg: &IncomingMessage, pick: PendingPick) {
        let alt = SessionStore::scope_key(
            &msg.channel,
            &msg.instance_id,
            &msg.sender_id,
            &msg.sender_id,
        );
        let mut g = self.pending.lock();
        g.insert(scope.to_string(), pick.clone());
        g.insert(alt, pick);
    }

    async fn handle_resume(
        &self,
        query: Option<&str>,
        scope: &str,
        msg: &IncomingMessage,
        default_wd: &str,
    ) {
        let scoped = self.scoped_projects_for(&msg.instance_id);
        if scope_blocks_agent_io(default_wd, &scoped, self.store.get(scope).as_ref()) {
            if self.store.get(scope).is_some() {
                self.store.remove(scope);
            }
            let _ = self
                .reply_msg(msg, i18n::t(&self.lang(), MessageKey::NoAvailableProject))
                .await;
            return;
        }
        let binding = self.store.get_or_create(scope, default_wd);
        if binding.project_id.is_none() {
            // Try match work_dir to a scoped trusted project
            let projects = self.scoped_projects_for(&msg.instance_id);
            if let Some(p) = projects.iter().find(|p| p.path == binding.work_dir) {
                let mut b = binding.clone();
                b.project_id = Some(p.id.clone());
                self.store.set(scope, b.clone());
            } else {
                let t = if self.lang() == "en" {
                    "No project bound. Send /p first."
                } else {
                    "尚未绑定项目。请先发送 /p 选择项目。"
                };
                let _ = self.reply_msg(msg, t).await;
                return;
            }
        }
        let binding = self.store.get_or_create(scope, default_wd);
        let sessions = app_sessions::sessions_for_project(binding.project_id.as_deref());

        if let Some(q) = query {
            match apply_session_pick(&binding, &sessions, q) {
                Ok(next) => {
                    let aid = next.agent_session_id.clone().unwrap_or_default();
                    self.store.set(scope, next);
                    let t = if self.lang() == "en" {
                        format!("Resumed session `{aid}`. Continue chatting.")
                    } else {
                        format!("已恢复会话 `{aid}`。继续对话即可。")
                    };
                    let _ = self.reply_msg(msg, &t).await;
                }
                Err(_) => {
                    let t = if self.lang() == "en" {
                        format!("Not found: {q}. Send /r again. (No session was bound.)")
                    } else {
                        format!("未找到：{q}。请重新发送 /r。（未绑定任何会话）")
                    };
                    let _ = self.reply_msg(msg, &t).await;
                }
            }
            return;
        }

        if sessions.is_empty() {
            let t = format_session_menu(&sessions, &self.lang());
            let _ = self.reply_msg(msg, &t).await;
            return;
        }

        if self.channel_prefers_cards(msg) {
            let card = match msg.channel.as_str() {
                "dingtalk" => control_plane::build_dingtalk_session_card(&sessions, &self.lang()),
                "telegram" => {
                    control_plane::build_telegram_session_card(&sessions, &self.lang(), 0)
                }
                _ => control_plane::build_feishu_session_card(&sessions, &self.lang()),
            };
            let _ = self
                .outbound
                .reply_card(
                    &msg.instance_id,
                    &msg.chat_id,
                    Some(&msg.message_id),
                    &card,
                    msg.thread_id(),
                )
                .await;
            self.insert_pending(
                scope,
                msg,
                PendingPick {
                    kind: PickKind::Session,
                    sessions: sessions.clone(),
                    accounts: vec![],
                },
            );
        } else {
            let text = format_session_menu(&sessions, &self.lang());
            self.insert_pending(
                scope,
                msg,
                PendingPick {
                    kind: PickKind::Session,
                    sessions,
                    accounts: vec![],
                },
            );
            let _ = self.reply_msg(msg, &text).await;
        }
    }

    async fn run_agent_turn(
        &self,
        msg: &IncomingMessage,
        scope: &str,
        default_wd: &str,
        prompt: &str,
        registered: Option<RegisteredTurn>,
    ) {
        let scoped = self.scoped_projects_for(&msg.instance_id);
        let existing = self.store.get(scope);
        let binding = match existing {
            Some(b) => b,
            None if default_wd.is_empty() || scoped.is_empty() => {
                let _ = self
                    .reply_msg(msg, i18n::t(&self.lang(), MessageKey::NoAvailableProject))
                    .await;
                return;
            }
            None => self.store.get_or_create(scope, default_wd),
        };
        if !projects::binding_allowed_in_scope(
            binding.project_id.as_deref(),
            &binding.work_dir,
            &scoped,
        ) {
            self.store.remove(scope);
            let _ = self
                .reply_msg(msg, i18n::t(&self.lang(), MessageKey::NoAvailableProject))
                .await;
            return;
        }

        let (mut active_turn, mut cancel_rx) =
            registered.unwrap_or_else(|| self.register_active_turn(scope));
        if grok_agent::cancellation_signaled(&mut cancel_rx) {
            return;
        }

        let thinking = if self.lang() == "en" {
            "Working…"
        } else {
            "处理中…"
        };
        let _ = self.reply_msg(msg, thinking).await;

        let intent = resolve_turn_intent(&binding);
        let (wd, resume_id) = match &intent {
            TurnIntent::NewSession { work_dir } => (work_dir.clone(), None),
            TurnIntent::ResumeSession {
                work_dir,
                agent_session_id,
            } => (work_dir.clone(), Some(agent_session_id.clone())),
        };

        let result = grok_agent::run_turn(
            &PathBuf::from(&wd),
            prompt,
            resume_id.as_deref(),
            self.allow_remote_yolo,
            Some(cancel_rx),
            None,
        )
        .await;

        if result.cancelled || !active_turn.complete() {
            tracing::info!(scope = %scope, "remote_im: grok turn cancelled");
            return;
        }

        let usage = result.usage.clone();
        let compact = result.compact.clone();

        let mut next = binding_after_agent_turn(
            &binding,
            result.session_id.as_deref().or(resume_id.as_deref()),
        );
        // If we started new and got no session id back, still Continue with local bookkeeping
        if next.agent_session_id.is_none() {
            if let Some(r) = resume_id {
                next.agent_session_id = Some(r);
            }
        }
        if next.pending_mode == PendingMode::New {
            next.pending_mode = PendingMode::Continue;
        }
        // Do not carry a previous turn's count forward as if it were current.
        // `/context` can still estimate growth from the last compact baseline.
        next.context_usage = usage;
        if let Some(compact) = compact.as_ref() {
            next.last_compact = Some(compact.clone());
            // A compact event invalidates stale pre-compact usage. Keep a known
            // post-compact base only when the agent actually reported one.
            if compact.tokens_after.is_some() && next.context_usage.is_none() {
                next.context_usage = compact.tokens_after.map(|tokens| ContextUsageSnapshot {
                    total_tokens: Some(tokens),
                    input_tokens: None,
                    output_tokens: None,
                    system_tokens: None,
                    tools_tokens: None,
                    history_tokens: None,
                    source: "compact".into(),
                });
            } else if compact.tokens_after.is_none() {
                next.context_usage = None;
            }
        }

        let had_error = result.error.is_some();
        let text = if let Some(err) = result.error {
            if result.text.is_empty() {
                self.agent_error_message(&err)
            } else {
                // Prefer model text when present; still honest if it looks like a rate limit.
                let kind = classify_rim_error(&err);
                if matches!(kind, super::resilience::RimErrorKind::RateLimit) {
                    agent_error_user_message(&self.lang(), kind, &err)
                } else {
                    result.text
                }
            }
        } else if result.text.is_empty() {
            if self.lang() == "en" {
                "(empty reply)".into()
            } else {
                "（空回复）".into()
            }
        } else {
            result.text
        };

        let is_error = had_error || text.starts_with("Error:");
        // Sync into App sessions_index + messages.json so sidebar /r and App UI share state.
        next = app_sessions::sync_turn_to_app(&next, prompt, &text, is_error, &msg.channel);
        if let Some(compact) = compact.as_ref() {
            app_sessions::sync_compact_to_app(&next, compact);
        }
        self.store.set(scope, next);

        for chunk in chunk_text(&text, 3500) {
            let _ = self.reply_msg(msg, &chunk).await;
        }
    }

    async fn reply_msg(&self, msg: &IncomingMessage, text: &str) -> Result<(), String> {
        tracing::info!(
            instance = %msg.instance_id,
            chat = %msg.chat_id,
            text_len = text.len(),
            "remote_im: reply attempt"
        );
        match self
            .outbound
            .reply(
                &msg.instance_id,
                &msg.chat_id,
                Some(&msg.message_id),
                text,
                msg.thread_id(),
            )
            .await
        {
            Ok(()) => {
                tracing::info!(
                    instance = %msg.instance_id,
                    chat = %msg.chat_id,
                    text_len = text.len(),
                    "remote_im: reply ok"
                );
                Ok(())
            }
            Err(e) => {
                // Fallback: some card callbacks only have open_id, not chat_id.
                if !msg.sender_id.is_empty() && msg.sender_id != msg.chat_id {
                    match self
                        .outbound
                        .reply(
                            &msg.instance_id,
                            &msg.sender_id,
                            None,
                            text,
                            msg.thread_id(),
                        )
                        .await
                    {
                        Ok(()) => {
                            tracing::info!(
                                instance = %msg.instance_id,
                                sender = %msg.sender_id,
                                "remote_im: reply ok via sender_id fallback"
                            );
                            return Ok(());
                        }
                        Err(e2) => {
                            tracing::error!(
                                instance = %msg.instance_id,
                                chat = %msg.chat_id,
                                sender = %msg.sender_id,
                                err = %e,
                                err2 = %e2,
                                "remote_im: outbound reply failed"
                            );
                            return Err(e2);
                        }
                    }
                }
                tracing::error!(
                    instance = %msg.instance_id,
                    chat = %msg.chat_id,
                    err = %e,
                    "remote_im: outbound reply failed"
                );
                Err(e)
            }
        }
    }
}

/// Empty / narrowed project scope must not start a compact or resume turn
/// (and leftover out-of-scope bindings are treated as blocked).
fn scope_blocks_agent_io(
    default_wd: &str,
    scoped: &[TrustedProject],
    binding: Option<&ScopeBinding>,
) -> bool {
    if default_wd.trim().is_empty() || scoped.is_empty() {
        return true;
    }
    match binding {
        Some(b) => {
            !projects::binding_allowed_in_scope(b.project_id.as_deref(), &b.work_dir, scoped)
        }
        None => false,
    }
}

fn extract_card_action(msg: &IncomingMessage) -> Option<CardAction> {
    let c = msg.content.trim();
    // Engine-internal prefix for connectors
    if let Some(rest) = c.strip_prefix("__card_action__:") {
        return parse_card_action(rest);
    }
    // Structured payloads only (never steal normal chat)
    if c.starts_with('{')
        || c.starts_with("project:")
        || c.starts_with("session:")
        || c.starts_with("account:")
        || c == "cancel"
    {
        return parse_card_action(c);
    }
    None
}

fn chunk_text(s: &str, max: usize) -> Vec<String> {
    if s.chars().count() <= max {
        return vec![s.to_string()];
    }
    let mut out = Vec::new();
    let mut cur = String::new();
    for ch in s.chars() {
        cur.push(ch);
        if cur.chars().count() >= max {
            out.push(std::mem::take(&mut cur));
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

fn format_quota_brief(billing: &crate::account::BillingSnapshot, lang: &str) -> String {
    let rem = billing.remaining_percent.map(|p| format!("{p:.0}%"));
    let used = billing.credit_usage_percent.map(|p| format!("{p:.0}%"));
    let tier = billing
        .subscription_tier
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or("-");
    if lang == "en" {
        match (rem.as_deref(), used.as_deref()) {
            (Some(r), Some(u)) => format!("Quota: **{r} remaining** · used {u} · plan {tier}"),
            (Some(r), None) => format!("Quota: **{r} remaining** · plan {tier}"),
            _ if billing.available => format!("Quota loaded · plan {tier}"),
            _ => format!(
                "Quota: unavailable ({})",
                billing.message.as_deref().unwrap_or("no data")
            ),
        }
    } else {
        match (rem.as_deref(), used.as_deref()) {
            (Some(r), Some(u)) => format!("额度：**剩余 {r}** · 已用 {u} · 套餐 {tier}"),
            (Some(r), None) => format!("额度：**剩余 {r}** · 套餐 {tier}"),
            _ if billing.available => format!("额度已加载 · 套餐 {tier}"),
            _ => format!(
                "额度：暂不可用（{}）",
                billing.message.as_deref().unwrap_or("无数据")
            ),
        }
    }
}

fn format_account_menu(lines: &[AccountQuotaLine], lang: &str) -> String {
    if lines.is_empty() {
        return if lang == "en" {
            "No Grok account signed in, and no saved multi-account snapshots.\n\
Sign in in Grok App → Settings → Account, then use **Add account** to save snapshots for switching."
                .into()
        } else {
            "当前未登录，且没有已保存的多账号快照。\n\
请先在 Grok App「设置 → 账号」登录，并用「添加账号」保存快照后再切换。"
                .into()
        };
    }

    let only_current = lines.len() == 1 && lines[0].account.id == "_current";
    let mut out: Vec<String> = Vec::new();
    if lang == "en" {
        out.push("**Grok accounts & SuperGrok quota**".into());
        out.push("".into());
    } else {
        out.push("**Grok 账号与 SuperGrok 额度**".into());
        out.push("".into());
    }

    for (i, line) in lines.iter().enumerate() {
        let n = i + 1;
        let star = if line.is_active { "★ " } else { "" };
        let label = line.account.label.trim();
        let email = line
            .account
            .email
            .as_deref()
            .filter(|e| !e.is_empty() && *e != label)
            .unwrap_or("");
        let who = if email.is_empty() {
            label.to_string()
        } else {
            format!("{label} · {email}")
        };
        let quota = if let Some(r) = line.remaining_percent {
            let used = line
                .used_percent
                .map(|u| {
                    if lang == "en" {
                        format!(" · used {u:.0}%")
                    } else {
                        format!(" · 已用 {u:.0}%")
                    }
                })
                .unwrap_or_default();
            if lang == "en" {
                format!("remaining **{r:.0}%**{used}")
            } else {
                format!("剩余 **{r:.0}%**{used}")
            }
        } else if let Some(note) = &line.quota_note {
            note.clone()
        } else if lang == "en" {
            "quota unknown".into()
        } else {
            "额度未知".into()
        };
        let tier = line
            .subscription_tier
            .as_deref()
            .filter(|s| !s.is_empty())
            .map(|s| format!(" · {s}"))
            .unwrap_or_default();
        out.push(format!("{n}. {star}{who} — {quota}{tier}"));
    }

    out.push("".into());
    if only_current {
        if lang == "en" {
            out.push(
                "Only the current CLI session is shown (no multi-account snapshots).\n\
Add more accounts in Grok App → Settings → Account to enable `/account n` switching."
                    .into(),
            );
        } else {
            out.push(
                "当前仅显示 CLI 登录账号（尚无多账号快照）。\n\
在 Grok App「设置 → 账号」添加账号后，可用 `/account 序号` 切换。"
                    .into(),
            );
        }
    } else if lang == "en" {
        out.push("Reply with a number to switch · `0` cancel · or `/account <n>`".into());
    } else {
        out.push("回复序号切换 · `0` 取消 · 或 `/account <序号>`".into());
    }
    out.join("\n")
}

fn format_compact_span(before: Option<u64>, after: Option<u64>) -> String {
    match (before, after) {
        (Some(before), Some(after)) => format!(
            "\n- context: {} → {} tokens",
            format_tokens(before),
            format_tokens(after)
        ),
        (Some(before), None) => format!("\n- before: {} tokens", format_tokens(before)),
        (None, Some(after)) => format!("\n- after: {} tokens", format_tokens(after)),
        (None, None) => String::new(),
    }
}

fn format_context_report(
    binding: &ScopeBinding,
    messages: &[crate::store::ChatMessageStored],
    lang: &str,
) -> String {
    let journal_compact = latest_compact_from_messages(messages);
    let last_compact = binding
        .last_compact
        .clone()
        .or_else(|| journal_compact.as_ref().map(|(_, compact)| compact.clone()));
    let mut lines = if lang == "en" {
        vec!["**Current session context**".to_string()]
    } else {
        vec!["**当前会话上下文**".to_string()]
    };
    if binding.agent_session_id.is_none() && messages.is_empty() {
        lines.push(if lang == "en" {
            "- size: unavailable (no active agent session)".into()
        } else {
            "- 大小：暂无（当前没有 agent 会话）".into()
        });
    } else if let Some(usage) = binding.context_usage.as_ref() {
        if let Some(total) = usage.total_tokens {
            lines.push(if lang == "en" {
                format!(
                    "- used: **{} tokens** (agent-reported)",
                    format_tokens(total)
                )
            } else {
                format!("- 已用：**{} tokens**（agent 上报）", format_tokens(total))
            });
        } else {
            lines.push(if lang == "en" {
                "- used: total unavailable (partial agent report)".into()
            } else {
                "- 已用：总量暂无（agent 仅上报了部分指标）".into()
            });
        }
        if usage.input_tokens.is_some() || usage.output_tokens.is_some() {
            lines.push(format!(
                "- input / output: {} / {}",
                usage
                    .input_tokens
                    .map(format_tokens)
                    .unwrap_or_else(|| "-".into()),
                usage
                    .output_tokens
                    .map(format_tokens)
                    .unwrap_or_else(|| "-".into())
            ));
        }
    } else if last_compact
        .as_ref()
        .is_some_and(|compact| compact.tokens_after.is_none())
    {
        lines.push(if lang == "en" {
            "- used: unavailable — the last compact event did not report token counts".into()
        } else {
            "- 已用：暂无——最近一次压缩事件没有上报 token 数".into()
        });
    } else if let Some((marker_index, compact)) = journal_compact
        .as_ref()
        .filter(|(_, compact)| compact.tokens_after.is_some())
    {
        let base = compact.tokens_after.unwrap_or(0);
        let delta = estimate_visible_tokens(&messages[marker_index + 1..]);
        let estimate = base.saturating_add(delta);
        lines.push(if lang == "en" {
            format!(
                "- used: **~{} tokens** (reported post-compact base + visible-message estimate)",
                format_tokens(estimate)
            )
        } else {
            format!(
                "- 已用：**~{} tokens**（压缩后上报基线 + 后续可见消息估算）",
                format_tokens(estimate)
            )
        });
    } else if let Some(after) = last_compact
        .as_ref()
        .and_then(|compact| compact.tokens_after)
    {
        lines.push(if lang == "en" {
            format!(
                "- last known: **{} tokens** after compact (current growth unavailable)",
                format_tokens(after)
            )
        } else {
            format!(
                "- 最近已知：压缩后 **{} tokens**（当前增量暂无）",
                format_tokens(after)
            )
        });
    } else if messages.is_empty() {
        lines.push(if lang == "en" {
            "- used: unavailable (send a message, then retry)".into()
        } else {
            "- 已用：暂无（发送一条消息后再试）".into()
        });
    } else {
        let estimate = estimate_visible_tokens(messages);
        lines.push(if lang == "en" {
            format!(
                "- used: **~{} tokens** (visible-message estimate, not model tokenizer output)",
                format_tokens(estimate)
            )
        } else {
            format!(
                "- 已用：**~{} tokens**（按可见消息估算，并非模型 tokenizer 精确值）",
                format_tokens(estimate)
            )
        });
    }

    if let Some(compact) = last_compact.as_ref() {
        let span = match (compact.tokens_before, compact.tokens_after) {
            (Some(before), Some(after)) => {
                format!(
                    "{} → {} tokens",
                    format_tokens(before),
                    format_tokens(after)
                )
            }
            (Some(before), None) => format!("before {} tokens", format_tokens(before)),
            (None, Some(after)) => format!("after {} tokens", format_tokens(after)),
            (None, None) => if lang == "en" {
                "counts unavailable"
            } else {
                "未上报数值"
            }
            .into(),
        };
        lines.push(if lang == "en" {
            format!("- last compact: {} ({span})", compact.trigger)
        } else {
            format!("- 最近压缩：{}（{span}）", compact.trigger)
        });
    }
    if let Some(session_id) = binding.agent_session_id.as_deref() {
        lines.push(format!("- agent session: `{session_id}`"));
    }
    lines.join("\n")
}

/// After Remote IM switches auth.json, recycle desktop warm agents + notify UI.
/// Must kill prewarm/parked too — disconnect alone parks and leaves stale OIDC.
async fn soft_disconnect_desktop_after_account_switch() {
    let Some(app) = app_sessions::try_app_handle() else {
        return;
    };
    if let Some(mgr) = app.try_state::<Arc<crate::session_manager::SessionManager>>() {
        let mgr = mgr.inner().clone();
        mgr.recycle_all_agents(&app, "account_auth").await;
    }
    let _ = app.emit(
        "account://changed",
        serde_json::json!({ "source": "remote_im" }),
    );
}

// silence unused import warning for list_sessions_for_project in non-test
#[allow(dead_code)]
fn _use_list() {
    let _ = list_sessions_for_project;
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[tokio::test]
    async fn stop_cancels_all_active_turns_in_the_scope_only() {
        let engine = Engine::new_ephemeral(OutboundRouter::new(), false);
        let (_first, first_rx) = engine.register_active_turn("scope-a");
        let (_second, second_rx) = engine.register_active_turn("scope-a");
        let (_other, mut other_rx) = engine.register_active_turn("scope-b");

        let stop_message = IncomingMessage {
            channel: "test".into(),
            instance_id: "test-instance".into(),
            message_id: "stop-message".into(),
            chat_id: "chat".into(),
            chat_type: "p2p".into(),
            sender_id: "sender".into(),
            content: "/stop".into(),
            mentioned_bot: true,
            thread_id: None,
        };
        engine
            .handle_slash(BuiltinCommand::Stop, &stop_message, "scope-a", "", None)
            .await;

        first_rx.await.expect("first turn was not cancelled");
        second_rx.await.expect("second turn was not cancelled");
        assert!(matches!(
            other_rx.try_recv(),
            Err(oneshot::error::TryRecvError::Empty)
        ));
        assert_eq!(engine.cancel_active_turns("scope-a"), 0);
        assert_eq!(engine.cancel_active_turns("scope-b"), 1);
        other_rx
            .await
            .expect("other scope did not remain cancellable");
    }

    #[test]
    fn stop_marks_registered_turn_so_thinking_reply_is_skipped() {
        let engine = Engine::new_ephemeral(OutboundRouter::new(), false);
        let (_turn, mut cancel_rx) = engine.register_active_turn("scope-stop");
        assert!(!grok_agent::cancellation_signaled(&mut cancel_rx));
        assert_eq!(engine.cancel_active_turns("scope-stop"), 1);
        assert!(grok_agent::cancellation_signaled(&mut cancel_rx));
    }

    #[test]
    fn empty_scope_and_narrowed_binding_do_not_spawn() {
        assert!(projects::default_work_dir(&json!({ "allow": [] })).is_none());
        assert!(!projects::binding_allowed_in_scope(
            None,
            "/Users/whoever",
            &[]
        ));
        let scoped = vec![TrustedProject {
            id: "p1".into(),
            name: "One".into(),
            path: "/tmp/one".into(),
        }];
        assert!(!projects::binding_allowed_in_scope(
            Some("retired"),
            "/tmp/retired",
            &scoped
        ));
        assert!(projects::binding_allowed_in_scope(
            Some("p1"),
            "/tmp/one",
            &scoped
        ));
        assert!(scope_blocks_agent_io("", &[], None));
        assert!(scope_blocks_agent_io("/tmp/one", &[], None));
        let mut leftover = ScopeBinding::fresh("/tmp/retired");
        leftover.project_id = Some("retired".into());
        leftover.agent_session_id = Some("agent-stale".into());
        assert!(scope_blocks_agent_io("/tmp/one", &scoped, Some(&leftover)));
        let mut ok = ScopeBinding::fresh("/tmp/one");
        ok.project_id = Some("p1".into());
        assert!(!scope_blocks_agent_io("/tmp/one", &scoped, Some(&ok)));
        assert!(!scope_blocks_agent_io("/tmp/one", &scoped, None));
    }

    #[test]
    fn engine_lang_follows_product_locale_not_hardcoded_zh() {
        let _home = crate::paths::APP_HOME_ENV_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let engine = Engine::new_ephemeral(OutboundRouter::new(), false);
        let lang = engine.lang();
        // Any shipped catalog id is correct here — the point of the test is that
        // the engine follows the product locale instead of a hard-coded zh.
        // Naming three ids made this fail on a machine whose OS language is one
        // of the others, which an English CI runner never reaches.
        assert!(
            crate::tray_i18n::ALL.iter().any(|l| l.as_tag() == lang),
            "unexpected catalog id {lang}"
        );
        assert_eq!(lang, i18n::resolve_engine_lang());
    }

    #[test]
    fn completion_and_stop_have_a_single_atomic_winner() {
        let engine = Engine::new_ephemeral(OutboundRouter::new(), false);

        let (mut completed_first, completed_rx) = engine.register_active_turn("completed-first");
        drop(completed_rx);
        assert!(completed_first.complete());
        assert_eq!(engine.cancel_active_turns("completed-first"), 0);

        let (mut stopped_first, stopped_rx) = engine.register_active_turn("stopped-first");
        drop(stopped_rx);
        assert_eq!(engine.cancel_active_turns("stopped-first"), 1);
        assert!(!stopped_first.complete());
    }

    use std::time::Duration;

    #[test]
    fn format_account_menu_empty_zh() {
        let t = format_account_menu(&[], "zh");
        assert!(t.contains("未登录") || t.contains("账号"));
    }

    #[test]
    fn format_account_menu_lists_remaining() {
        let lines = vec![AccountQuotaLine {
            account: SavedAccount {
                id: "a1".into(),
                email: Some("a@x.ai".into()),
                display_name: None,
                label: "work".into(),
                updated_at: String::new(),
            },
            is_active: true,
            remaining_percent: Some(62.0),
            used_percent: Some(38.0),
            subscription_tier: Some("SuperGrok".into()),
            quota_note: None,
        }];
        let t = format_account_menu(&lines, "zh");
        assert!(t.contains("work"));
        assert!(t.contains("62%"));
        assert!(t.contains("★"));
        assert!(t.contains("序号") || t.contains("/account"));
    }

    #[test]
    fn resolve_account_pick_by_index_and_label() {
        let profiles = vec![
            SavedAccount {
                id: "id-1".into(),
                email: Some("a@x.ai".into()),
                display_name: None,
                label: "work".into(),
                updated_at: String::new(),
            },
            SavedAccount {
                id: "id-2".into(),
                email: Some("b@x.ai".into()),
                display_name: None,
                label: "home".into(),
                updated_at: String::new(),
            },
        ];
        assert_eq!(
            account_profiles::resolve_account_pick("2", &profiles).unwrap(),
            "id-2"
        );
        assert_eq!(
            account_profiles::resolve_account_pick("work", &profiles).unwrap(),
            "id-1"
        );
        assert!(account_profiles::resolve_account_pick("9", &profiles).is_err());
    }

    #[tokio::test]
    async fn handle_slash_p_does_not_deadlock_on_pending_lookup() {
        let outbound = OutboundRouter::new();
        let engine = Engine::new_ephemeral(outbound.clone(), false);
        let mut secrets = HashMap::new();
        secrets.insert("token".into(), "t".into());
        secrets.insert("_instance_id".into(), "weixin-default".into());
        outbound.register("weixin-default", "weixin", secrets.clone(), json!({}));
        engine.upsert_instance(ChannelInstance {
            id: "weixin-default".into(),
            channel: "weixin".into(),
            name: "w".into(),
            enabled: true,
            secrets,
            options: json!({}),
            acl: json!({ "allowFrom": "*" }),
            project_scope: json!("all_trusted"),
        });
        let msg = IncomingMessage {
            channel: "weixin".into(),
            instance_id: "weixin-default".into(),
            message_id: "m1".into(),
            chat_id: "peer@im.wechat".into(),
            chat_type: "p2p".into(),
            sender_id: "peer@im.wechat".into(),
            content: "/p".into(),
            mentioned_bot: true,
            thread_id: None,
        };
        // Pre-fix: nested pending.lock() in or_else deadlocked forever here.
        tokio::time::timeout(Duration::from_secs(3), engine.handle(msg))
            .await
            .expect("handle(/p) deadlocked on pending mutex re-entry");
    }
}
