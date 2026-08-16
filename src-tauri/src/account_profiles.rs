//! Multi Grok account switcher: snapshot/switch official CLI auth.json profiles.
//!
//! Layout under app data root:
//!   accounts/index.json
//!   accounts/<id>/auth.json
//!
//! Switching copies the selected auth into `~/.grok/auth.json` and agent-home.

use std::fs;
use std::path::PathBuf;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tracing::{info, warn};
use uuid::Uuid;

use crate::account::{self, AccountProfile};
use crate::paths;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedAccount {
    pub id: String,
    pub email: Option<String>,
    pub display_name: Option<String>,
    /// User-editable label (defaults to email / display name).
    pub label: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AccountsIndex {
    #[serde(default)]
    active_id: Option<String>,
    #[serde(default)]
    profiles: Vec<SavedAccount>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountsListResult {
    pub profiles: Vec<SavedAccount>,
    pub active_id: Option<String>,
}

fn accounts_root() -> PathBuf {
    paths::app_data_root().join("accounts")
}

fn index_path() -> PathBuf {
    accounts_root().join("index.json")
}

fn profile_auth_path(id: &str) -> PathBuf {
    accounts_root().join(id).join("auth.json")
}

fn load_index() -> AccountsIndex {
    let p = index_path();
    if !p.is_file() {
        return AccountsIndex::default();
    }
    match fs::read_to_string(&p) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => AccountsIndex::default(),
    }
}

fn save_index(idx: &AccountsIndex) -> Result<(), String> {
    let root = accounts_root();
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let raw = serde_json::to_string_pretty(idx).map_err(|e| e.to_string())?;
    fs::write(index_path(), raw).map_err(|e| e.to_string())
}

fn label_from_profile(p: &AccountProfile) -> String {
    p.email
        .clone()
        .or_else(|| p.display_name.clone())
        .unwrap_or_else(|| "Grok account".into())
}

/// List saved account snapshots + active id.
pub fn list_accounts() -> AccountsListResult {
    let idx = load_index();
    AccountsListResult {
        profiles: idx.profiles,
        active_id: idx.active_id,
    }
}

/// Path to a saved account's auth.json snapshot (if any).
pub fn auth_path_for_account(id: &str) -> PathBuf {
    profile_auth_path(id.trim())
}

/// OAuth token for a saved multi-account snapshot. Never log the return value.
pub fn access_token_for_account(id: &str) -> Option<String> {
    account::read_access_token_from_path(&auth_path_for_account(id))
}

/// Resolve a menu pick (`1`, `2`, … or exact id / label / email) to a saved account id.
pub fn resolve_account_pick(query: &str, profiles: &[SavedAccount]) -> Result<String, String> {
    let q = query.trim();
    if q.is_empty() {
        return Err("empty pick".into());
    }
    if profiles.is_empty() {
        return Err("no saved accounts".into());
    }
    // 1-based index
    if let Ok(n) = q.parse::<usize>() {
        if n >= 1 && n <= profiles.len() {
            return Ok(profiles[n - 1].id.clone());
        }
        return Err(format!("index out of range (1–{})", profiles.len()));
    }
    // Exact id
    if let Some(p) = profiles.iter().find(|p| p.id == q) {
        return Ok(p.id.clone());
    }
    // Label / email (case-insensitive, unique match preferred)
    let lower = q.to_ascii_lowercase();
    let matches: Vec<&SavedAccount> = profiles
        .iter()
        .filter(|p| {
            p.label.to_ascii_lowercase() == lower
                || p.email
                    .as_ref()
                    .map(|e| e.to_ascii_lowercase() == lower)
                    .unwrap_or(false)
                || p.display_name
                    .as_ref()
                    .map(|d| d.to_ascii_lowercase() == lower)
                    .unwrap_or(false)
        })
        .collect();
    if matches.len() == 1 {
        return Ok(matches[0].id.clone());
    }
    if matches.len() > 1 {
        return Err("ambiguous account name".into());
    }
    // Substring label match
    let soft: Vec<&SavedAccount> = profiles
        .iter()
        .filter(|p| {
            p.label.to_ascii_lowercase().contains(&lower)
                || p.email
                    .as_ref()
                    .map(|e| e.to_ascii_lowercase().contains(&lower))
                    .unwrap_or(false)
        })
        .collect();
    if soft.len() == 1 {
        return Ok(soft[0].id.clone());
    }
    Err(format!("account not found: {q}"))
}

/// Snapshot current official CLI auth into the multi-account store.
/// If already signed in as a known email, update that slot; else create new.
pub fn save_current_account(label: Option<String>) -> Result<SavedAccount, String> {
    let src = current_auth_source()?;
    let profile = account::read_auth_profile();
    if !profile.signed_in {
        return Err("Not signed in — log in first, then save the account.".into());
    }

    let mut idx = load_index();
    let email = profile.email.clone();
    let now = Utc::now().to_rfc3339();

    // Prefer update by matching email
    if let Some(existing) = idx
        .profiles
        .iter_mut()
        .find(|a| email.is_some() && a.email.as_ref() == email.as_ref())
    {
        let id = existing.id.clone();
        let dest = profile_auth_path(&id);
        fs::create_dir_all(dest.parent().unwrap()).map_err(|e| e.to_string())?;
        fs::copy(&src, &dest).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&dest, fs::Permissions::from_mode(0o600));
        }
        existing.email = profile.email.clone();
        existing.display_name = profile.display_name.clone();
        if let Some(l) = label.filter(|s| !s.trim().is_empty()) {
            existing.label = l.trim().to_string();
        } else if existing.label.is_empty() {
            existing.label = label_from_profile(&profile);
        }
        existing.updated_at = now;
        idx.active_id = Some(id.clone());
        let out = existing.clone();
        save_index(&idx)?;
        info!("account_profiles: updated snapshot id={id}");
        return Ok(out);
    }

    let id = Uuid::new_v4().to_string();
    let dest = profile_auth_path(&id);
    fs::create_dir_all(dest.parent().unwrap()).map_err(|e| e.to_string())?;
    fs::copy(&src, &dest).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&dest, fs::Permissions::from_mode(0o600));
    }

    let saved = SavedAccount {
        id: id.clone(),
        email: profile.email.clone(),
        display_name: profile.display_name.clone(),
        label: label
            .filter(|s| !s.trim().is_empty())
            .map(|s| s.trim().to_string())
            .unwrap_or_else(|| label_from_profile(&profile)),
        updated_at: now,
    };
    idx.profiles.push(saved.clone());
    idx.active_id = Some(id);
    save_index(&idx)?;
    info!("account_profiles: saved new snapshot id={}", saved.id);
    Ok(saved)
}

/// Activate a saved account: write auth into CLI home + agent-home.
pub fn switch_account(id: &str) -> Result<AccountProfile, String> {
    let id = id.trim();
    if id.is_empty() {
        return Err("empty account id".into());
    }
    let src = profile_auth_path(id);
    if !src.is_file() {
        return Err(format!("account snapshot not found: {id}"));
    }

    // Write to both default CLI auth and agent-home
    let cli_auth = crate::process_util::user_home()
        .join(".grok")
        .join("auth.json");
    if let Some(parent) = cli_auth.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::copy(&src, &cli_auth).map_err(|e| format!("write ~/.grok/auth.json: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&cli_auth, fs::Permissions::from_mode(0o600));
    }

    if let Err(e) = account::sync_cli_auth_to_agent_home() {
        warn!("account_profiles: agent-home sync after switch: {e}");
    }

    let mut idx = load_index();
    idx.active_id = Some(id.to_string());
    let _ = save_index(&idx);

    let profile = account::read_auth_profile();
    if !profile.signed_in {
        return Err(
            "Switched auth file but profile still unsigned-in. Snapshot may be corrupt.".into(),
        );
    }
    info!("account_profiles: switched to id={id}");
    Ok(profile)
}

pub fn remove_account(id: &str) -> Result<(), String> {
    let id = id.trim();
    let mut idx = load_index();
    let before = idx.profiles.len();
    idx.profiles.retain(|p| p.id != id);
    if idx.profiles.len() == before {
        return Err(format!("account not found: {id}"));
    }
    if idx.active_id.as_deref() == Some(id) {
        idx.active_id = idx.profiles.first().map(|p| p.id.clone());
    }
    save_index(&idx)?;
    let dir = accounts_root().join(id);
    if dir.is_dir() {
        let _ = fs::remove_dir_all(&dir);
    }
    Ok(())
}

pub fn rename_account(id: &str, label: &str) -> Result<SavedAccount, String> {
    let label = label.trim();
    if label.is_empty() {
        return Err("label empty".into());
    }
    let mut idx = load_index();
    let slot = idx
        .profiles
        .iter_mut()
        .find(|p| p.id == id)
        .ok_or_else(|| format!("account not found: {id}"))?;
    slot.label = label.to_string();
    slot.updated_at = Utc::now().to_rfc3339();
    let out = slot.clone();
    save_index(&idx)?;
    Ok(out)
}

fn current_auth_source() -> Result<PathBuf, String> {
    let primary = crate::process_util::user_home()
        .join(".grok")
        .join("auth.json");
    if primary.is_file() {
        return Ok(primary);
    }
    let agent = paths::agent_home_dir().join("auth.json");
    if agent.is_file() {
        return Ok(agent);
    }
    Err("No auth.json found. Sign in first.".into())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountQuotaItem {
    pub id: String,
    pub remaining_percent: Option<f64>,
    pub used_percent: Option<f64>,
    pub subscription_tier: Option<String>,
    pub resets_at: Option<String>,
    pub available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AccountsQuotaResult {
    #[serde(default)]
    pub items: Vec<AccountQuotaItem>,
    #[serde(default)]
    pub fetched_at: String,
}

fn quota_probe_failed(snap: &crate::supergrok_quota::AccountQuotaSnapshot) -> bool {
    snap.last_error.is_some() || snap.source == "error" || snap.source == "empty"
}

fn quota_item_from_snapshot(
    id: String,
    snap: crate::supergrok_quota::AccountQuotaSnapshot,
) -> AccountQuotaItem {
    // Never invent 0% / 100% when the SuperGrok probe failed.
    if quota_probe_failed(&snap) {
        return AccountQuotaItem {
            id,
            remaining_percent: None,
            used_percent: None,
            subscription_tier: None,
            resets_at: None,
            available: false,
        };
    }
    AccountQuotaItem {
        id,
        remaining_percent: Some(f64::from(snap.remaining_percent)),
        used_percent: Some(f64::from(snap.used_percent)),
        subscription_tier: None,
        resets_at: snap.resets_at.map(|d| d.to_rfc3339()),
        available: true,
    }
}

fn unavailable_quota_item(id: String) -> AccountQuotaItem {
    AccountQuotaItem {
        id,
        remaining_percent: None,
        used_percent: None,
        subscription_tier: None,
        resets_at: None,
        available: false,
    }
}

/// Live SuperGrok remaining % for every saved snapshot (best-effort, parallel).
/// Reuses `fetch_quota_best_effort` — same probe as the active `account_status`.
pub async fn fetch_accounts_quota() -> AccountsQuotaResult {
    let idx = load_index();
    let futs = idx.profiles.into_iter().map(|p| {
        let id = p.id;
        async move {
            let Some(token) = access_token_for_account(&id) else {
                return unavailable_quota_item(id);
            };
            let snap = crate::supergrok_quota::fetch_quota_best_effort(&token).await;
            quota_item_from_snapshot(id, snap)
        }
    });
    let items = futures_util::future::join_all(futs).await;
    AccountsQuotaResult {
        items,
        fetched_at: Utc::now().to_rfc3339(),
    }
}

/// After a successful login, auto-snapshot so multi-account list stays current.
pub fn auto_snapshot_after_login() {
    match save_current_account(None) {
        Ok(s) => info!("account_profiles: auto-snapshot after login id={}", s.id),
        Err(e) => warn!("account_profiles: auto-snapshot skipped: {e}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn label_fallback() {
        let p = AccountProfile {
            signed_in: true,
            auth_mode: None,
            email: Some("a@b.com".into()),
            display_name: Some("A".into()),
            user_id: None,
            team_id: None,
            principal_type: None,
            expires_at: None,
            expired: false,
            has_refresh: false,
            oidc_issuer: None,
        };
        assert_eq!(label_from_profile(&p), "a@b.com");
    }

    #[test]
    fn resolve_pick_index_and_label() {
        let profiles = vec![
            SavedAccount {
                id: "u1".into(),
                email: Some("one@x.ai".into()),
                display_name: None,
                label: "Work".into(),
                updated_at: "t".into(),
            },
            SavedAccount {
                id: "u2".into(),
                email: Some("two@x.ai".into()),
                display_name: None,
                label: "Home".into(),
                updated_at: "t".into(),
            },
        ];
        assert_eq!(resolve_account_pick("1", &profiles).unwrap(), "u1");
        assert_eq!(resolve_account_pick("home", &profiles).unwrap(), "u2");
        assert_eq!(resolve_account_pick("one@x.ai", &profiles).unwrap(), "u1");
        assert!(resolve_account_pick("0", &profiles).is_err());
        assert!(resolve_account_pick("missing", &profiles).is_err());
    }

    #[test]
    fn quota_item_hides_percent_when_probe_failed() {
        let mut snap = crate::supergrok_quota::default_unused_quota_snapshot();
        snap.source = "error".into();
        snap.last_error = Some("network".into());
        let item = quota_item_from_snapshot("u1".into(), snap);
        assert!(!item.available);
        assert!(item.remaining_percent.is_none());
        assert!(item.used_percent.is_none());
    }

    #[test]
    fn quota_item_hides_empty_placeholder_snapshot() {
        let snap = crate::supergrok_quota::default_unused_quota_snapshot();
        let item = quota_item_from_snapshot("u1".into(), snap);
        assert_eq!(item.available, false);
        assert!(item.remaining_percent.is_none());
    }

    #[test]
    fn quota_item_keeps_real_zero_remaining() {
        let snap = crate::supergrok_quota::AccountQuotaSnapshot::from_used(
            100.0,
            None,
            None,
            Vec::new(),
            "grpc-web",
        );
        let item = quota_item_from_snapshot("u1".into(), snap);
        assert!(item.available);
        assert_eq!(item.remaining_percent, Some(0.0));
        assert_eq!(item.used_percent, Some(100.0));
    }
}
