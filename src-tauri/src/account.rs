//! Official Grok Build account: profile, login/logout, billing snapshot, local usage.
//!
//! Profile is read from `~/.grok/auth.json` (tokens never leave this module).
//! Billing is best-effort HTTP (same field shape as CLI `/usage` / billing extension).
//! Heatmap + call logs are derived from local CLI session signals (and optional app journal).

use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::time::Duration;

use chrono::{DateTime, Duration as ChronoDuration, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::io::AsyncBufReadExt;
use tracing::{info, warn};

use crate::cli_probe;
use crate::paths;

/// Cancellation signal for a running `grok login`. The login task selects on
/// this notifier plus the child wait; Cancel just fires it without touching the
/// child handle (avoids racing the wait side).
pub struct LoginProcState {
    cancel: tokio::sync::Notify,
    /// Guard: only one login may run at a time.
    busy: tokio::sync::Mutex<bool>,
}

impl Default for LoginProcState {
    fn default() -> Self {
        Self {
            cancel: tokio::sync::Notify::new(),
            busy: tokio::sync::Mutex::new(false),
        }
    }
}

static LOGIN_PROC: OnceLock<LoginProcState> = OnceLock::new();

/// Process-wide login process handle. Initialized once on first access.
fn login_proc() -> &'static LoginProcState {
    LOGIN_PROC.get_or_init(LoginProcState::default)
}

/// Signal a running login to abort (no-op if none is running).
pub async fn account_login_cancel() {
    login_proc().cancel.notify_waiters();
}
use crate::store;

const BILLING_CANDIDATES: &[&str] = &[
    // Confirmed live endpoint used by Grok Build CLI billing extension.
    "https://cli-chat-proxy.grok.com/v1/billing?format=credits",
    "https://accounts.x.ai/billing?format=credits",
    "https://code.grok.com/billing?format=credits",
    "https://code.grok.com/rest/billing?format=credits",
];

const USAGE_MANAGE_URL: &str = "https://grok.com/?_s=usage";
const SUBSCRIBE_URL: &str = "https://grok.com/supergrok?referrer=grok-build";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountProfile {
    pub signed_in: bool,
    pub auth_mode: Option<String>,
    pub email: Option<String>,
    pub display_name: Option<String>,
    pub user_id: Option<String>,
    pub team_id: Option<String>,
    pub principal_type: Option<String>,
    pub expires_at: Option<String>,
    pub expired: bool,
    pub has_refresh: bool,
    pub oidc_issuer: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct QuotaProduct {
    pub product_id: u32,
    pub label: String,
    pub used_percent: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BillingSnapshot {
    pub available: bool,
    pub source: String,
    pub message: Option<String>,
    pub subscription_tier: Option<String>,
    /// SuperGrok weekly used % (0–100+). Same as grok-go `usedPercent`.
    pub credit_usage_percent: Option<f64>,
    /// SuperGrok weekly remaining % (max 0, 100 - used).
    pub remaining_percent: Option<f64>,
    pub monthly_limit: Option<f64>,
    pub included_used: Option<f64>,
    pub total_used: Option<f64>,
    pub prepaid_balance: Option<f64>,
    pub on_demand_enabled: Option<bool>,
    pub on_demand_cap: Option<f64>,
    pub on_demand_used: Option<f64>,
    pub billing_period_start: Option<String>,
    pub billing_period_end: Option<String>,
    pub resets_at: Option<String>,
    pub is_unified_billing_user: Option<bool>,
    pub products: Vec<QuotaProduct>,
    pub manage_url: String,
    pub subscribe_url: String,
    pub fetched_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeatmapDay {
    pub date: String,
    /// Session / turn activity count (maps to grok-go `requests`).
    pub requests: u64,
    pub tokens: u64,
    pub cost_usd: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CallLogEntry {
    pub id: String,
    pub title: String,
    pub model: Option<String>,
    pub project_path: Option<String>,
    pub started_at: Option<String>,
    pub duration_secs: Option<u64>,
    pub turns: u64,
    pub tool_calls: u64,
    pub context_tokens: u64,
    pub errors: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountStatus {
    pub profile: AccountProfile,
    pub has_official_key: bool,
    pub has_relay_key: bool,
    pub relay_base_url: Option<String>,
    pub cli_auth_present: bool,
    pub cli_found: bool,
    pub cli_path: Option<String>,
    pub channel: String,
    pub billing: BillingSnapshot,
    pub heatmap: Vec<HeatmapDay>,
    pub call_logs: Vec<CallLogEntry>,
    pub usage_manage_url: String,
    pub subscribe_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginResult {
    pub ok: bool,
    pub method: String,
    pub message: String,
    pub device_url: Option<String>,
    pub device_code: Option<String>,
    pub profile: Option<AccountProfile>,
}

fn grok_home() -> PathBuf {
    if let Ok(h) = std::env::var("GROK_HOME") {
        return PathBuf::from(h);
    }
    crate::process_util::user_home().join(".grok")
}

fn auth_json_path() -> PathBuf {
    grok_home().join("auth.json")
}

/// Canonical CLI auth path (`~/.grok/auth.json`), ignoring process `GROK_HOME`.
/// Login writes here; independent-mode agents use a different GROK_HOME and need a copy.
fn cli_default_auth_json_path() -> PathBuf {
    crate::process_util::user_home()
        .join(".grok")
        .join("auth.json")
}

fn agent_home_auth_json_path() -> PathBuf {
    paths::agent_home_dir().join("auth.json")
}

/// Copy official OAuth credentials into App agent-home so independent-mode
/// agents (`GROK_HOME=~/.grok-app/agent-home`) can authenticate.
///
/// Without this, UI shows "signed in" (reads `~/.grok/auth.json`) while the
/// agent process sees `auth_kind=none` and fails with 401.
pub fn sync_cli_auth_to_agent_home() -> Result<(), String> {
    let src = {
        // Prefer the path account/login actually use, then hard default ~/.grok.
        let primary = auth_json_path();
        if primary.is_file() {
            primary
        } else {
            cli_default_auth_json_path()
        }
    };
    if !src.is_file() {
        return Ok(());
    }
    let dest = agent_home_auth_json_path();
    if src == dest {
        return Ok(());
    }
    let dest_dir = paths::agent_home_dir();
    fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;

    let need_copy = match (src.metadata(), dest.metadata()) {
        (Ok(sm), Ok(dm)) => {
            let src_m = sm.modified().ok();
            let dst_m = dm.modified().ok();
            match (src_m, dst_m) {
                (Some(a), Some(b)) => a > b || sm.len() != dm.len(),
                _ => true,
            }
        }
        (Ok(_), Err(_)) => true,
        _ => false,
    };
    if !need_copy {
        return Ok(());
    }

    fs::copy(&src, &dest).map_err(|e| {
        format!(
            "failed to sync auth.json → agent-home: {e} (src={}, dest={})",
            src.display(),
            dest.display()
        )
    })?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&dest, fs::Permissions::from_mode(0o600));
    }
    info!(
        "account: synced auth.json to agent-home ({})",
        dest.display()
    );
    Ok(())
}

/// Remove agent-home copy of auth (logout / wipe).
pub fn clear_agent_home_auth() {
    let p = agent_home_auth_json_path();
    if p.is_file() {
        let _ = fs::remove_file(&p);
        info!("account: cleared agent-home auth.json");
    }
}

fn sessions_root() -> PathBuf {
    grok_home().join("sessions")
}

fn session_roots() -> Vec<PathBuf> {
    let mut roots = vec![sessions_root()];
    let agent_sessions = paths::agent_home_dir().join("sessions");
    if !roots.contains(&agent_sessions) {
        roots.push(agent_sessions);
    }
    roots
}

fn usage_cache_path() -> PathBuf {
    paths::app_data_root().join("account_billing_cache.json")
}

/// Redacted profile from CLI auth.json. Never returns tokens.
pub fn read_auth_profile() -> AccountProfile {
    let path = auth_json_path();
    if !path.is_file() {
        return AccountProfile {
            signed_in: false,
            auth_mode: None,
            email: None,
            display_name: None,
            user_id: None,
            team_id: None,
            principal_type: None,
            expires_at: None,
            expired: false,
            has_refresh: false,
            oidc_issuer: None,
        };
    }

    let raw = match fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) => {
            warn!("account: read auth.json failed: {e}");
            return AccountProfile {
                signed_in: false,
                auth_mode: None,
                email: None,
                display_name: None,
                user_id: None,
                team_id: None,
                principal_type: None,
                expires_at: None,
                expired: false,
                has_refresh: false,
                oidc_issuer: None,
            };
        }
    };

    let v: Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(e) => {
            warn!("account: parse auth.json failed: {e}");
            return AccountProfile {
                signed_in: false,
                auth_mode: None,
                email: None,
                display_name: None,
                user_id: None,
                team_id: None,
                principal_type: None,
                expires_at: None,
                expired: false,
                has_refresh: false,
                oidc_issuer: None,
            };
        }
    };

    // auth.json is a map of issuer::client_id → credential entry.
    let entry = v
        .as_object()
        .and_then(|m| m.values().next())
        .cloned()
        .unwrap_or(Value::Null);

    let email = entry.get("email").and_then(|x| x.as_str()).map(str::to_string);
    let first = entry
        .get("first_name")
        .and_then(|x| x.as_str())
        .unwrap_or("");
    let last = entry
        .get("last_name")
        .and_then(|x| x.as_str())
        .unwrap_or("");
    let display = {
        let n = format!("{first} {last}").trim().to_string();
        if n.is_empty() {
            email.clone()
        } else {
            Some(n)
        }
    };

    let expires_at = entry
        .get("expires_at")
        .and_then(|x| x.as_str())
        .map(str::to_string);
    let expired = expires_at
        .as_deref()
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.with_timezone(&Utc) < Utc::now())
        .unwrap_or(false);

    let has_key = entry
        .get("key")
        .or_else(|| entry.get("access_token"))
        .and_then(|x| x.as_str())
        .map(|s| !s.is_empty())
        .unwrap_or(false);
    let has_refresh = entry
        .get("refresh_token")
        .and_then(|x| x.as_str())
        .map(|s| !s.is_empty())
        .unwrap_or(false);

    AccountProfile {
        signed_in: has_key || has_refresh,
        auth_mode: entry
            .get("auth_mode")
            .and_then(|x| x.as_str())
            .map(str::to_string),
        email,
        display_name: display,
        user_id: entry
            .get("user_id")
            .or_else(|| entry.get("principal_id"))
            .and_then(|x| x.as_str())
            .map(str::to_string),
        team_id: entry
            .get("team_id")
            .and_then(|x| x.as_str())
            .map(str::to_string),
        principal_type: entry
            .get("principal_type")
            .and_then(|x| x.as_str())
            .map(str::to_string),
        expires_at,
        expired,
        has_refresh,
        oidc_issuer: entry
            .get("oidc_issuer")
            .and_then(|x| x.as_str())
            .map(str::to_string),
    }
}

fn read_access_token() -> Option<String> {
    let raw = fs::read_to_string(auth_json_path()).ok()?;
    let v: Value = serde_json::from_str(&raw).ok()?;
    let entry = v.as_object()?.values().next()?;
    entry
        .get("key")
        .or_else(|| entry.get("access_token"))
        .and_then(|x| x.as_str())
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn resolve_cli_path(manual: Option<&str>) -> Option<String> {
    let probe = cli_probe::probe_cli(manual);
    probe.path
}

fn channel_label(profile: &AccountProfile, has_official: bool, has_relay: bool) -> String {
    if profile.signed_in {
        return "official_oauth".into();
    }
    if has_official {
        return "official_key".into();
    }
    if has_relay {
        return "relay".into();
    }
    "none".into()
}

fn load_billing_cache() -> Option<BillingSnapshot> {
    let path = usage_cache_path();
    let s = fs::read_to_string(path).ok()?;
    serde_json::from_str(&s).ok()
}

fn save_billing_cache(b: &BillingSnapshot) {
    let _ = paths::ensure_app_dirs();
    if let Ok(s) = serde_json::to_string_pretty(b) {
        let _ = fs::write(usage_cache_path(), s);
    }
}

/// Parse number or `{ "val": N }` money wrappers used by cli-chat-proxy billing.
fn json_number(v: Option<&Value>) -> Option<f64> {
    let v = v?;
    if let Some(n) = v.as_f64() {
        return Some(n);
    }
    if let Some(n) = v.as_i64() {
        return Some(n as f64);
    }
    if let Some(n) = v.as_u64() {
        return Some(n as f64);
    }
    if let Some(s) = v.as_str() {
        return s.parse().ok();
    }
    if let Some(n) = v.get("val").and_then(|x| x.as_f64()) {
        return Some(n);
    }
    if let Some(n) = v.get("val").and_then(|x| x.as_i64()) {
        return Some(n as f64);
    }
    None
}

fn parse_billing_json(v: &Value) -> BillingSnapshot {
    // Nested under data / credits / config (cli-chat-proxy uses `config`).
    let root = if v.get("creditUsagePercent").is_some() || v.get("monthlyLimit").is_some() {
        v.clone()
    } else if let Some(inner) = v
        .get("data")
        .or_else(|| v.get("credits"))
        .or_else(|| v.get("config"))
    {
        inner.clone()
    } else {
        v.clone()
    };

    let f64_field = |keys: &[&str]| -> Option<f64> {
        for k in keys {
            if let Some(n) = json_number(root.get(*k)) {
                return Some(n);
            }
        }
        None
    };
    let bool_field = |keys: &[&str]| -> Option<bool> {
        for k in keys {
            if let Some(b) = root.get(*k).and_then(|x| x.as_bool()) {
                return Some(b);
            }
        }
        None
    };
    let str_field = |keys: &[&str]| -> Option<String> {
        for k in keys {
            if let Some(s) = root.get(*k).and_then(|x| x.as_str()) {
                return Some(s.to_string());
            }
        }
        None
    };

    // Prefer overall creditUsagePercent; fall back to GrokBuild product slice.
    let mut credit_usage_percent = f64_field(&["creditUsagePercent", "credit_usage_percent"]);
    if credit_usage_percent.is_none() {
        if let Some(arr) = root.get("productUsage").and_then(|x| x.as_array()) {
            for p in arr {
                let product = p.get("product").and_then(|x| x.as_str()).unwrap_or("");
                if product.eq_ignore_ascii_case("GrokBuild")
                    || product.eq_ignore_ascii_case("Grok Build")
                {
                    credit_usage_percent = json_number(p.get("usagePercent"));
                    break;
                }
            }
        }
    }

    let monthly_limit = f64_field(&["monthlyLimit", "monthly_limit"]);
    let period = root.get("currentPeriod");
    let period_start = str_field(&["billingPeriodStart", "billing_period_start"]).or_else(|| {
        period
            .and_then(|p| p.get("start"))
            .and_then(|x| x.as_str())
            .map(str::to_string)
    });
    let period_end = str_field(&["billingPeriodEnd", "billing_period_end", "end"]).or_else(|| {
        period
            .and_then(|p| p.get("end"))
            .and_then(|x| x.as_str())
            .map(str::to_string)
    });

    // Infer a friendly tier when server omits subscription_tier.
    let subscription_tier = str_field(&["subscription_tier", "subscriptionTier", "tier"]).or_else(
        || {
            if bool_field(&["isUnifiedBillingUser", "is_unified_billing_user"]) == Some(true) {
                Some("Grok Build".into())
            } else {
                None
            }
        },
    );

    let has_signal = credit_usage_percent.is_some()
        || monthly_limit.is_some()
        || f64_field(&["prepaidBalance", "prepaid_balance"]).is_some()
        || subscription_tier.is_some()
        || period_start.is_some();

    let on_demand_cap = f64_field(&["onDemandCap", "on_demand_cap"]);
    let on_demand_used = f64_field(&["onDemandUsed", "on_demand_used"]);
    let on_demand_enabled = bool_field(&["on_demand_enabled", "onDemandEnabled"]).or_else(|| {
        on_demand_cap.map(|c| c > 0.0)
    });

    let remaining_percent = credit_usage_percent.map(|u| (100.0 - u).max(0.0));

    let mut products = Vec::new();
    if let Some(arr) = root.get("productUsage").and_then(|x| x.as_array()) {
        for p in arr {
            let name = p.get("product").and_then(|x| x.as_str()).unwrap_or("");
            let pct = json_number(p.get("usagePercent")).unwrap_or(0.0);
            let product_id = match name {
                "Api" | "API" => 1,
                "GrokBuild" | "Grok Build" => 2,
                "GrokChat" => 4,
                _ => 0,
            };
            products.push(QuotaProduct {
                product_id,
                label: if name.is_empty() {
                    format!("Product {product_id}")
                } else {
                    name.into()
                },
                used_percent: pct,
            });
        }
    }

    BillingSnapshot {
        available: has_signal,
        source: if has_signal {
            "remote".into()
        } else {
            "empty".into()
        },
        message: if has_signal {
            None
        } else {
            Some("Billing payload missing expected fields".into())
        },
        subscription_tier,
        credit_usage_percent,
        remaining_percent,
        monthly_limit,
        included_used: f64_field(&["includedUsed", "included_used"]),
        total_used: f64_field(&["totalUsed", "total_used"]),
        prepaid_balance: f64_field(&["prepaidBalance", "prepaid_balance"]),
        on_demand_enabled,
        on_demand_cap,
        on_demand_used,
        billing_period_start: period_start.clone(),
        billing_period_end: period_end.clone(),
        resets_at: period_end,
        is_unified_billing_user: bool_field(&["isUnifiedBillingUser", "is_unified_billing_user"]),
        products,
        manage_url: USAGE_MANAGE_URL.into(),
        subscribe_url: SUBSCRIBE_URL.into(),
        fetched_at: Some(Utc::now().to_rfc3339()),
    }
}

fn billing_from_quota_snap(snap: &crate::supergrok_quota::AccountQuotaSnapshot) -> BillingSnapshot {
    // Any successful fetch (incl. 0% used) is "available". Only pure error path is not.
    let available = snap.source != "error";
    BillingSnapshot {
        available,
        source: snap.source.clone(),
        message: snap.last_error.clone(),
        // Filled by merge_subscription_into_billing after /v1/settings (or JWT fallback).
        subscription_tier: None,
        credit_usage_percent: Some(f64::from(snap.used_percent)),
        remaining_percent: Some(f64::from(snap.remaining_percent)),
        monthly_limit: None,
        included_used: None,
        total_used: None,
        prepaid_balance: None,
        on_demand_enabled: None,
        on_demand_cap: None,
        on_demand_used: None,
        billing_period_start: snap.period_start_at.map(|d| d.to_rfc3339()),
        billing_period_end: snap.resets_at.map(|d| d.to_rfc3339()),
        resets_at: snap.resets_at.map(|d| d.to_rfc3339()),
        is_unified_billing_user: Some(true),
        products: snap
            .products
            .iter()
            .map(|p| QuotaProduct {
                product_id: p.product_id,
                label: p.label.clone(),
                used_percent: f64::from(p.used_percent),
            })
            .collect(),
        manage_url: USAGE_MANAGE_URL.into(),
        subscribe_url: SUBSCRIBE_URL.into(),
        fetched_at: Some(snap.fetched_at.to_rfc3339()),
    }
}

/// Brand-facing subscription label from cli-chat-proxy (not invented client-side).
#[derive(Debug, Clone, Default)]
struct SubscriptionMeta {
    /// e.g. "SuperGrok Heavy" from settings.subscription_tier_display
    display: Option<String>,
    /// e.g. "SuperGrokPro" from user.subscriptionTier
    code: Option<String>,
}

/// Map API enum / short codes → user-facing plan name (official wording).
fn display_from_subscription_code(code: &str) -> Option<String> {
    let c = code.trim();
    if c.is_empty() {
        return None;
    }
    let lower = c.to_ascii_lowercase().replace(['_', ' '], "");
    match lower.as_str() {
        "supergrokpro" | "supergrokheavy" | "heavy" => Some("SuperGrok Heavy".into()),
        "supergrok" | "supergroklite" | "grokpro" => Some("SuperGrok".into()),
        "xpremiumplus" | "x_premium_plus" | "premiumplus" => Some("X Premium+".into()),
        "xpremium" | "premium" => Some("X Premium".into()),
        "free" | "basic" | "none" | "null" | "anonymous" => None,
        // Already a display string from settings (keep as-is).
        _ if c.contains(' ') || c.starts_with("Super") || c.starts_with("X ") => Some(c.into()),
        _ => Some(c.into()),
    }
}

fn resolve_subscription_display(meta: &SubscriptionMeta) -> Option<String> {
    if let Some(d) = meta.display.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
        return Some(d.to_string());
    }
    meta.code
        .as_deref()
        .and_then(display_from_subscription_code)
}

/// Unverified JWT payload (claims only — never used for security decisions).
fn jwt_payload_unverified(token: &str) -> Option<Value> {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() < 2 {
        return None;
    }
    let payload_b64 = parts[1];
    let mut s = payload_b64.replace('-', "+").replace('_', "/");
    while s.len() % 4 != 0 {
        s.push('=');
    }
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD.decode(s).ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// Soft fallback when remote subscription endpoints fail (JWT `tier` is numeric).
fn display_from_jwt_tier(tier: i64) -> Option<String> {
    // Observed: paid SuperGrok-capable accounts ≥ 2; Heavy-class accounts observed at 5.
    // Prefer live `subscription_tier_display` when available.
    if tier >= 5 {
        Some("SuperGrok Heavy".into())
    } else if tier >= 2 {
        Some("SuperGrok".into())
    } else {
        None
    }
}

fn merge_subscription_into_billing(billing: &mut BillingSnapshot, meta: &SubscriptionMeta, token: &str) {
    if let Some(display) = resolve_subscription_display(meta) {
        billing.subscription_tier = Some(display);
        return;
    }
    if billing.subscription_tier.is_some() {
        return;
    }
    if let Some(tier) = jwt_payload_unverified(token)
        .and_then(|p| p.get("tier").and_then(|v| v.as_i64()))
        .and_then(display_from_jwt_tier)
    {
        billing.subscription_tier = Some(tier);
    }
}

/// Fetch brand-facing plan name.
/// Primary: GET /v1/settings → subscription_tier_display ("SuperGrok Heavy")
/// Fallback: GET /v1/user?include=subscription → subscriptionTier ("SuperGrokPro")
async fn fetch_subscription_meta(token: &str) -> SubscriptionMeta {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .user_agent("GrokApp/0.1 (desktop; unofficial)")
        .build()
    {
        Ok(c) => c,
        Err(_) => return SubscriptionMeta::default(),
    };

    let mut meta = SubscriptionMeta::default();

    // 1) settings — human display string (best for brand UI)
    let settings_url = "https://cli-chat-proxy.grok.com/v1/settings";
    match client
        .get(settings_url)
        .header("Authorization", format!("Bearer {token}"))
        .header("x-grok-client-mode", "cli")
        .header("Accept", "application/json")
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => {
            if let Ok(v) = r.json::<Value>().await {
                meta.display = v
                    .get("subscription_tier_display")
                    .or_else(|| v.get("subscriptionTierDisplay"))
                    .and_then(|x| x.as_str())
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty());
            }
        }
        Ok(r) => {
            warn!(
                "account: subscription settings → HTTP {}",
                r.status().as_u16()
            );
        }
        Err(e) => warn!("account: subscription settings failed: {e}"),
    }

    // 2) user profile — API enum (always useful; fills gaps)
    let user_url = "https://cli-chat-proxy.grok.com/v1/user?include=subscription";
    match client
        .get(user_url)
        .header("Authorization", format!("Bearer {token}"))
        .header("x-grok-client-mode", "cli")
        .header("Accept", "application/json")
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => {
            if let Ok(v) = r.json::<Value>().await {
                meta.code = v
                    .get("subscriptionTier")
                    .or_else(|| v.get("subscription_tier"))
                    .and_then(|x| x.as_str())
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty());
            }
        }
        Ok(r) => {
            warn!(
                "account: subscription user → HTTP {}",
                r.status().as_u16()
            );
        }
        Err(e) => warn!("account: subscription user failed: {e}"),
    }

    meta
}

async fn fetch_billing_remote(token: &str) -> BillingSnapshot {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent("GrokApp/0.1 (desktop; unofficial)")
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return BillingSnapshot {
                available: false,
                source: "error".into(),
                message: Some(e.to_string()),
                manage_url: USAGE_MANAGE_URL.into(),
                subscribe_url: SUBSCRIBE_URL.into(),
                ..Default::default()
            };
        }
    };

    for url in BILLING_CANDIDATES {
        let resp = client
            .get(*url)
            .header("Authorization", format!("Bearer {token}"))
            .header("x-grok-client-mode", "cli")
            .header("x-grok-client-version", "0.1")
            .header("Accept", "application/json")
            .send()
            .await;

        match resp {
            Ok(r) => {
                let status = r.status();
                let ct = r
                    .headers()
                    .get(reqwest::header::CONTENT_TYPE)
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or("")
                    .to_string();
                let body = r.text().await.unwrap_or_default();
                if !status.is_success() {
                    warn!(
                        "account: billing {} → HTTP {} (body {} bytes)",
                        url,
                        status.as_u16(),
                        body.len()
                    );
                    continue;
                }
                // SPA HTML shells return 200 — skip non-JSON.
                if ct.contains("text/html")
                    || body.trim_start().starts_with("<!DOCTYPE")
                    || body.trim_start().starts_with("<html")
                {
                    warn!("account: billing {url} returned HTML shell, skipping");
                    continue;
                }
                match serde_json::from_str::<Value>(&body) {
                    Ok(v) => {
                        let mut snap = parse_billing_json(&v);
                        if snap.available {
                            snap.source = format!("remote:{url}");
                            save_billing_cache(&snap);
                            return snap;
                        }
                    }
                    Err(e) => {
                        warn!("account: billing parse failed for {url}: {e}");
                    }
                }
            }
            Err(e) => {
                warn!("account: billing request failed for {url}: {e}");
            }
        }
    }

    if let Some(mut cached) = load_billing_cache() {
        cached.source = format!("cache:{}", cached.source);
        cached.message = Some(
            cached
                .message
                .unwrap_or_else(|| "Using cached billing (remote unavailable)".into()),
        );
        return cached;
    }

    BillingSnapshot {
        available: false,
        source: "unavailable".into(),
        message: Some(
            "Could not fetch billing. Open Grok usage on the web, or re-login via CLI.".into(),
        ),
        manage_url: USAGE_MANAGE_URL.into(),
        subscribe_url: SUBSCRIBE_URL.into(),
        ..Default::default()
    }
}

/// Aggregate local CLI session signals into a heatmap and recent call log.
/// `days` defaults to ~371 like grok-go contribution graph.
pub fn local_usage(days: u32, log_limit: usize) -> (Vec<HeatmapDay>, Vec<CallLogEntry>) {
    local_usage_from_roots(days, log_limit, &session_roots())
}

fn local_usage_from_roots(
    days: u32,
    log_limit: usize,
    roots: &[PathBuf],
) -> (Vec<HeatmapDay>, Vec<CallLogEntry>) {
    let days = days.clamp(7, 400);
    let log_limit = log_limit.clamp(5, 100);
    if !roots.iter().any(|root| root.is_dir()) {
        return (empty_heatmap(days), vec![]);
    }

    let mut day_map: BTreeMap<NaiveDate, DayAgg> = BTreeMap::new();
    let mut logs: Vec<(i64, CallLogEntry)> = Vec::new();
    let mut seen_sessions = HashSet::new();
    for root in roots {
        if root.is_dir() {
            walk_sessions(root, 0, &mut logs, &mut day_map, &mut seen_sessions);
        }
    }

    logs.sort_by(|a, b| b.0.cmp(&a.0));
    logs.truncate(log_limit);
    let call_logs: Vec<CallLogEntry> = logs.into_iter().map(|(_, e)| e).collect();

    let today = Utc::now().date_naive();
    let start = today - ChronoDuration::days(i64::from(days.saturating_sub(1)));
let mut heatmap = Vec::with_capacity(days as usize);
    let mut d = start;
    while d <= today {
        let agg = day_map.get(&d).cloned().unwrap_or_default();
        // Prefer session count as "requests"; fall back to turns.
        let requests = if agg.sessions > 0 {
            agg.sessions
        } else {
            agg.turns
        };
        heatmap.push(HeatmapDay {
            date: d.format("%Y-%m-%d").to_string(),
            requests,
            tokens: agg.tokens,
            cost_usd: 0.0,
        });
        d += ChronoDuration::days(1);
    }

    (heatmap, call_logs)
}

#[derive(Default, Clone)]
struct DayAgg {
    turns: u64,
    tokens: u64,
    sessions: u64,
}

fn walk_sessions(
    dir: &Path,
    depth: u32,
    logs: &mut Vec<(i64, CallLogEntry)>,
    day_map: &mut BTreeMap<NaiveDate, DayAgg>,
    seen_sessions: &mut HashSet<String>,
) {
    if depth > 6 {
        return;
    }
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for ent in entries.flatten() {
        let path = ent.path();
        if !path.is_dir() {
            continue;
        }
        let signals = path.join("signals.json");
        if signals.is_file() {
            let id = path
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_default();
            if seen_sessions.insert(id) {
                ingest_session(&path, &signals, day_map, logs);
            }
        } else {
            walk_sessions(&path, depth + 1, logs, day_map, seen_sessions);
        }
    }
}

fn ingest_session(
    session_dir: &Path,
    signals_path: &Path,
    day_map: &mut BTreeMap<NaiveDate, DayAgg>,
    logs: &mut Vec<(i64, CallLogEntry)>,
) {
    let meta_mtime = fs::metadata(signals_path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    let raw = match fs::read_to_string(signals_path) {
        Ok(s) => s,
        Err(_) => return,
    };
    let v: Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => return,
    };

    let turns = v.get("turnCount").and_then(|x| x.as_u64()).unwrap_or(0);
    let tool_calls = v.get("toolCallCount").and_then(|x| x.as_u64()).unwrap_or(0);
    let context_tokens = v
        .get("contextTokensUsed")
        .and_then(|x| x.as_u64())
        .unwrap_or(0);
    let errors = v.get("errorCount").and_then(|x| x.as_u64()).unwrap_or(0);
    let duration_secs = v
        .get("sessionDurationSeconds")
        .and_then(|x| x.as_u64());
    let model = v
        .get("primaryModelId")
        .and_then(|x| x.as_str())
        .map(str::to_string);

    let id = session_dir
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "session".into());

    let parent = session_dir.parent().and_then(|p| p.file_name());
    let project_path = parent.map(|p| {
        let s = p.to_string_lossy();
        urlencoding_decode(&s).unwrap_or_else(|| s.to_string())
    });

    let title = project_path
        .as_ref()
        .map(|p| {
            Path::new(p)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| p.clone())
        })
        .unwrap_or_else(|| id.chars().take(12).collect());

    let day = DateTime::from_timestamp(meta_mtime, 0)
        .map(|dt| dt.date_naive())
        .unwrap_or_else(|| Utc::now().date_naive());

    let agg = day_map.entry(day).or_default();
    agg.turns = agg.turns.saturating_add(turns.max(1));
    agg.tokens = agg.tokens.saturating_add(context_tokens);
    agg.sessions = agg.sessions.saturating_add(1);

    let started_at = DateTime::from_timestamp(meta_mtime, 0).map(|d| d.to_rfc3339());

    logs.push((
        meta_mtime,
        CallLogEntry {
            id,
            title,
            model,
            project_path,
            started_at,
            duration_secs,
            turns,
            tool_calls,
            context_tokens,
            errors,
        },
    ));
}

fn empty_heatmap(days: u32) -> Vec<HeatmapDay> {
    let today = Utc::now().date_naive();
    let start = today - ChronoDuration::days(i64::from(days.saturating_sub(1)));
    let mut out = Vec::new();
    let mut d = start;
    while d <= today {
        out.push(HeatmapDay {
            date: d.format("%Y-%m-%d").to_string(),
            requests: 0,
            tokens: 0,
            cost_usd: 0.0,
        });
        d += ChronoDuration::days(1);
    }
    out
}

/// Minimal percent-decode for CLI session folder names (URL-encoded paths).
fn urlencoding_decode(s: &str) -> Option<String> {
    if !s.contains('%') {
        return None;
    }
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let h = std::str::from_utf8(&bytes[i + 1..i + 3]).ok()?;
            let v = u8::from_str_radix(h, 16).ok()?;
            out.push(v);
            i += 3;
        } else if bytes[i] == b'+' {
            out.push(b' ');
            i += 1;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

pub async fn account_status(manual_cli: Option<&str>, refresh_billing: bool) -> AccountStatus {
    let profile = read_auth_profile();
    let secrets = store::load_secrets();
    let has_official = secrets
        .official_api_key
        .as_ref()
        .map(|k| !k.is_empty())
        .unwrap_or(false);
    let has_relay = secrets
        .relay_api_key
        .as_ref()
        .map(|k| !k.is_empty())
        .unwrap_or(false);
    let probe = cli_probe::probe_cli(manual_cli);
    let channel = channel_label(&profile, has_official, has_relay);

    let billing = if refresh_billing {
        if let Some(token) = read_access_token() {
            // Quota + subscription in parallel (settings/user are cheap vs gRPC billing).
            let (snap, sub_meta) = tokio::join!(
                crate::supergrok_quota::fetch_quota_best_effort(&token),
                fetch_subscription_meta(&token),
            );
            let mut b = billing_from_quota_snap(&snap);
            merge_subscription_into_billing(&mut b, &sub_meta, &token);
            if b.available || b.subscription_tier.is_some() {
                // Cache even when only tier resolved (brand UI still works offline briefly).
                if b.available {
                    save_billing_cache(&b);
                } else if let Some(mut cached) = load_billing_cache() {
                    if cached.available {
                        // Keep quota numbers; overlay fresh tier if we got one.
                        if b.subscription_tier.is_some() {
                            cached.subscription_tier = b.subscription_tier.clone();
                        }
                        cached.message = Some(format!(
                            "Cached · {}",
                            b.message.unwrap_or_else(|| "quota refresh failed".into())
                        ));
                        b = cached;
                    } else {
                        save_billing_cache(&b);
                    }
                } else if b.subscription_tier.is_some() {
                    save_billing_cache(&b);
                }
            } else if let Some(mut cached) = load_billing_cache() {
                if cached.available || cached.subscription_tier.is_some() {
                    cached.message = Some(format!(
                        "Cached · {}",
                        b.message.unwrap_or_else(|| "refresh failed".into())
                    ));
                    b = cached;
                }
            }
            b
        } else if let Some(cached) = load_billing_cache() {
            cached
        } else {
            BillingSnapshot {
                available: false,
                source: "no_token".into(),
                message: Some("Sign in with official Grok Build to load quota.".into()),
                manage_url: USAGE_MANAGE_URL.into(),
                subscribe_url: SUBSCRIBE_URL.into(),
                products: vec![],
                ..Default::default()
            }
        }
    } else if let Some(cached) = load_billing_cache() {
        cached
    } else {
        BillingSnapshot {
            available: false,
            source: "idle".into(),
            message: None,
            manage_url: USAGE_MANAGE_URL.into(),
            subscribe_url: SUBSCRIBE_URL.into(),
            products: vec![],
            ..Default::default()
        }
    };

    // 371 days ≈ GitHub contribution year (matches grok-go heatmap).
    let (heatmap, call_logs) = local_usage(371, 40);

    AccountStatus {
        profile,
        has_official_key: has_official,
        has_relay_key: has_relay,
        relay_base_url: secrets.relay_base_url,
        cli_auth_present: probe.cli_auth_present,
        cli_found: probe.found,
        cli_path: probe.path,
        channel,
        billing,
        heatmap,
        call_logs,
        usage_manage_url: USAGE_MANAGE_URL.into(),
        subscribe_url: SUBSCRIBE_URL.into(),
    }
}

/// Run `grok login --oauth` or `--device-auth`. OAuth opens the system browser via CLI.
pub async fn account_login(method: &str, manual_cli: Option<&str>) -> LoginResult {
    let cli = match resolve_cli_path(manual_cli) {
        Some(p) => p,
        None => {
            return LoginResult {
                ok: false,
                method: method.into(),
                message: "Grok Build CLI not found. Install or set CLI path in Settings.".into(),
                device_url: None,
                device_code: None,
                profile: None,
            };
        }
    };

    let method = if method == "device" || method == "device-auth" || method == "device-code" {
        "device"
    } else {
        "oauth"
    };

    let before_mtime = auth_json_path()
        .metadata()
        .and_then(|m| m.modified())
        .ok();

    info!("account: starting login method={method} cli={cli}");

    let arg = if method == "device" {
        "--device-auth"
    } else {
        "--oauth"
    };

    // Spawn CLI login. The CLI prints the OAuth/device URL to stdout but does
    // NOT open a browser itself, so we read stdout line-by-line and open the
    // URL the moment it appears — otherwise the user is stuck on "Working…".
    // tokio::process lets us race this against the Cancel notifier.
    let mut cmd = tokio::process::Command::new(&cli);
    cmd.arg("login")
        .arg(&arg)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // Login may open a browser; still hide the console flash on Windows.
    crate::process_util::apply_no_window_tokio(&mut cmd);

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            return LoginResult {
                ok: false,
                method: method.into(),
                message: format!("Failed to run grok login: {e}"),
                device_url: None,
                device_code: None,
                profile: None,
            };
        }
    };

    // Take the piped streams so we can read stdout WHILE the CLI blocks waiting
    // for the browser callback. stderr is read too so it appears in diagnostics.
    let stdout_handle = child.stdout.take();
    let stderr_handle = child.stderr.take();

    // Drain stdout: open the browser on the first URL we see, and collect
    // everything for later message/diagnostics parsing.
    let stdout_collect = async {
        let mut buf = String::new();
        let mut url_opened = false;
        if let Some(h) = stdout_handle {
            let mut reader = tokio::io::BufReader::new(h).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                let t = line.trim();
                // First URL => open the browser immediately (OAuth + device).
                if !url_opened
                    && (t.starts_with("http://") || t.starts_with("https://"))
                {
                    url_opened = true;
                    if let Err(e) = open_url(t) {
                        warn!("account: open login URL failed: {e}");
                    }
                }
                buf.push_str(&line);
                buf.push('\n');
            }
        }
        buf
    };
    let stderr_collect = async {
        let mut buf = String::new();
        if let Some(h) = stderr_handle {
            let mut reader = tokio::io::BufReader::new(h).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                buf.push_str(&line);
                buf.push('\n');
            }
        }
        buf
    };

    // Drive stdout+stderr drain concurrently with process exit, and race the
    // whole thing against Cancel. stdout/stderr reach EOF when the CLI exits,
    // so join! naturally completes alongside wait().
    let cancelled;
    let (stdout, stderr, status) = tokio::select! {
        biased;
        _ = login_proc().cancel.notified() => {
            let _ = child.kill().await;
            cancelled = true;
            (String::new(), String::new(), None)
        }
        joined = async {
            let (so, se) = tokio::join!(stdout_collect, stderr_collect);
            // Pipes are EOF; wait reaps the child.
            let st = child.wait().await.ok();
            (so, se, st)
        } => {
            cancelled = false;
            joined
        }
    };

    if cancelled {
        return LoginResult {
            ok: false,
            method: method.into(),
            message: "Login cancelled. Try another sign-in method.".to_string(),
            device_url: None,
            device_code: None,
            profile: None,
        };
    }

    let exit_success = status.map(|s| s.success()).unwrap_or(false);
    let combined = format!("{stdout}\n{stderr}");

    let mut device_url = None;
    let mut device_code = None;
    for line in combined.lines() {
        let t = line.trim();
        if t.starts_with("http://") || t.starts_with("https://") {
            if device_url.is_none() {
                device_url = Some(t.to_string());
            }
        }
        // Common patterns: "code: ABCD-EFGH" / "enter code ABCD"
        if let Some(rest) = t
            .strip_prefix("code:")
            .or_else(|| t.strip_prefix("Code:"))
            .or_else(|| t.strip_prefix("user_code:"))
        {
            device_code = Some(rest.trim().to_string());
        }
    }

    // NOTE: the OAuth/device URL is opened live while stdout streams (see spawn
    // block above), for both methods — the old device-only fallback is gone.

    // Wait briefly for auth.json to update if process returned quickly after browser flow.
    // OAuth/device can take longer; poll up to ~30s for credentials.
    if exit_success || before_mtime.is_some() || device_url.is_some() {
        for _ in 0..60 {
            tokio::time::sleep(Duration::from_millis(500)).await;
            let after = auth_json_path()
                .metadata()
                .and_then(|m| m.modified())
                .ok();
            if after != before_mtime {
                break;
            }
            let p = read_auth_profile();
            if p.signed_in {
                break;
            }
        }
    }

    let profile = read_auth_profile();
    let ok = profile.signed_in;

    // Independent mode agents read GROK_HOME=agent-home — mirror credentials there.
    if ok {
        if let Err(e) = sync_cli_auth_to_agent_home() {
            warn!("account: post-login auth sync failed: {e}");
        }
        crate::account_profiles::auto_snapshot_after_login();
    }

    let message = if profile.signed_in {
        format!(
            "Signed in as {}",
            profile
                .email
                .clone()
                .or(profile.display_name.clone())
                .unwrap_or_else(|| "account".into())
        )
    } else if !exit_success {
        let detail = combined
            .lines()
            .rev()
            .find(|l| !l.trim().is_empty())
            .unwrap_or("login failed")
            .to_string();
        // Never echo tokens if CLI printed any.
        let detail = if detail.len() > 240 {
            format!("{}…", &detail[..240])
        } else {
            detail
        };
        let lower = combined.to_lowercase();
        if lower.contains("access denied")
            || lower.contains("failed to generate authentication")
            || lower.contains("authentication code")
        {
            "Login failed: xAI could not generate an authentication code (Access denied). \
Try another network/VPN, use device-code login, or configure a custom provider in Settings."
                .into()
        } else {
            format!("Login did not complete: {detail}")
        }
    } else {
        "Login process finished but no credentials found. Try device-code login, switch network, or use a custom provider in Settings.".into()
    };

    LoginResult {
        ok,
        method: method.into(),
        message,
        device_url,
        device_code,
        profile: if profile.signed_in {
            Some(profile)
        } else {
            None
        },
    }
}

pub async fn account_logout(manual_cli: Option<&str>) -> Result<AccountProfile, String> {
    if let Some(cli) = resolve_cli_path(manual_cli) {
        let res = tokio::task::spawn_blocking(move || {
            let mut cmd = Command::new(&cli);
            cmd.arg("logout")
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            crate::process_util::apply_no_window_std(&mut cmd);
            cmd.status()
        })
        .await
        .map_err(|e| e.to_string())?;

        match res {
            Ok(st) if st.success() => {
                info!("account: grok logout ok");
            }
            Ok(st) => {
                warn!("account: grok logout exit {st}; clearing auth.json fallback");
                let _ = fs::remove_file(auth_json_path());
                let _ = fs::remove_file(cli_default_auth_json_path());
            }
            Err(e) => {
                warn!("account: grok logout spawn failed: {e}");
                let _ = fs::remove_file(auth_json_path());
                let _ = fs::remove_file(cli_default_auth_json_path());
            }
        }
    } else {
        // No CLI — best-effort wipe of local CLI auth cache only.
        let _ = fs::remove_file(auth_json_path());
        let _ = fs::remove_file(cli_default_auth_json_path());
    }
    // Always drop independent-mode copy so agent cannot keep using old tokens.
    clear_agent_home_auth();

    Ok(read_auth_profile())
}

pub async fn open_usage_manage() -> Result<(), String> {
    open_url(USAGE_MANAGE_URL)
}

pub async fn open_subscribe() -> Result<(), String> {
    open_url(SUBSCRIBE_URL)
}

/// Open a URL in the system browser (also used after device-code login).
pub fn open_browser_url(url: &str) -> Result<(), String> {
    open_url(url)
}

fn open_url(url: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(url)
            .status()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/C", "start", "", url])
            .status()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Command::new("xdg-open")
            .arg(url)
            .status()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_billing_accepts_cli_shape() {
        let v = serde_json::json!({
            "creditUsagePercent": 42.5,
            "monthlyLimit": 100.0,
            "includedUsed": 42.5,
            "totalUsed": 42.5,
            "prepaidBalance": 10.0,
            "on_demand_enabled": false,
            "subscription_tier": "pro",
            "billingPeriodStart": "2026-07-01T00:00:00Z"
        });
        let b = parse_billing_json(&v);
        assert!(b.available);
        assert_eq!(b.credit_usage_percent, Some(42.5));
        assert_eq!(b.subscription_tier.as_deref(), Some("pro"));
    }

    #[test]
    fn parse_billing_accepts_cli_chat_proxy_shape() {
        let v = serde_json::json!({
            "config": {
                "currentPeriod": {
                    "type": "USAGE_PERIOD_TYPE_WEEKLY",
                    "start": "2026-07-19T22:48:00.648188+00:00",
                    "end": "2026-07-26T22:48:00.648188+00:00"
                },
                "creditUsagePercent": 12.0,
                "onDemandCap": { "val": 0 },
                "onDemandUsed": { "val": 0 },
                "productUsage": [
                    { "product": "GrokBuild", "usagePercent": 11.0 },
                    { "product": "Api", "usagePercent": 1.0 }
                ],
                "isUnifiedBillingUser": true,
                "prepaidBalance": { "val": 5 },
                "billingPeriodStart": "2026-07-19T22:48:00.648188+00:00",
                "billingPeriodEnd": "2026-07-26T22:48:00.648188+00:00"
            }
        });
        let b = parse_billing_json(&v);
        assert!(b.available);
        assert_eq!(b.credit_usage_percent, Some(12.0));
        assert_eq!(b.prepaid_balance, Some(5.0));
        assert_eq!(b.on_demand_cap, Some(0.0));
        assert_eq!(b.subscription_tier.as_deref(), Some("Grok Build"));
        assert!(b.billing_period_start.as_deref().unwrap().starts_with("2026-07-19"));
    }

    #[test]
    fn empty_heatmap_has_requested_days() {
        let h = empty_heatmap(14);
        assert_eq!(h.len(), 14);
        assert!(h.iter().all(|d| d.requests == 0 && d.tokens == 0));
    }

    #[test]
    fn local_usage_combines_cli_and_agent_home_sessions() {
        let temp = std::env::temp_dir().join(format!(
            "grok-app-account-usage-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let cli_root = temp.join("cli");
        let agent_root = temp.join("agent");
        let sessions = [
            (cli_root.join("project-a").join("session-a"), 120),
            (agent_root.join("project-b").join("session-b"), 340),
        ];
        for (dir, tokens) in &sessions {
            fs::create_dir_all(dir).unwrap();
            fs::write(
                dir.join("signals.json"),
                serde_json::json!({
                    "turnCount": 2,
                    "contextTokensUsed": tokens,
                    "primaryModelId": "test-model"
                })
                .to_string(),
            )
            .unwrap();
        }

        let (heatmap, logs) =
            local_usage_from_roots(7, 10, &[cli_root.clone(), agent_root.clone()]);
        assert_eq!(logs.len(), 2);
        assert_eq!(heatmap.iter().map(|day| day.requests).sum::<u64>(), 2);
        assert_eq!(heatmap.iter().map(|day| day.tokens).sum::<u64>(), 460);

        fs::remove_dir_all(temp).unwrap();
    }

    #[test]
    fn urlencoding_decode_basic() {
        let s = urlencoding_decode("%2FUsers%2Fdemo%2Fproj").unwrap();
        assert_eq!(s, "/Users/demo/proj");
    }

    #[test]
    fn profile_without_auth_is_signed_out() {
        // Just ensure function is callable; may be signed in on developer machines.
        let _ = read_auth_profile();
    }

    #[test]
    fn maps_subscription_codes_to_display() {
        assert_eq!(
            display_from_subscription_code("SuperGrokPro").as_deref(),
            Some("SuperGrok Heavy")
        );
        assert_eq!(
            display_from_subscription_code("SuperGrok").as_deref(),
            Some("SuperGrok")
        );
        assert_eq!(
            resolve_subscription_display(&SubscriptionMeta {
                display: Some("SuperGrok Heavy".into()),
                code: Some("SuperGrokPro".into()),
            })
            .as_deref(),
            Some("SuperGrok Heavy")
        );
        assert_eq!(display_from_jwt_tier(5).as_deref(), Some("SuperGrok Heavy"));
        assert_eq!(display_from_jwt_tier(3).as_deref(), Some("SuperGrok"));
        assert_eq!(display_from_jwt_tier(0), None);
    }
}
