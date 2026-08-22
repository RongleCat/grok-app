//! App secrets backend: OS keychain (preferred) with file fallback.
//!
//! Callers use [`crate::store::load_secrets`] / [`crate::store::save_secrets`] only —
//! this module owns where `official_api_key` / `relay_api_key` actually live.
//!
//! - macOS: Keychain via `keyring` (`apple-native`)
//! - Windows: Credential Manager (`windows-native`)
//! - Linux: FreeDesktop Secret Service when available (`sync-secret-service`)
//! - Fallback: `secrets.json` with mode `0600` when the OS store is unavailable
//!
//! Non-secret metadata (`relay_base_url`, `default_model`, `keychain_has_*`) always
//! stays in `secrets.json`.
//!
//! **Startup UX:** never write a probe entry or unlock keychain just to paint
//! "has key" flags. Presence uses disk flags / plaintext leftovers; real key
//! material is loaded lazily when a caller needs the value.

use std::fs;
use std::path::Path;
use std::sync::OnceLock;

use parking_lot::Mutex;

use crate::paths::{ensure_app_dirs, secrets_file};
use crate::store::SecretsFile;

/// Reverse-DNS service id shared with app data layout (`com.grokapp.grok-app`).
const KEYRING_SERVICE: &str = "com.grokapp.grok-app";

const KEY_OFFICIAL: &str = "official_api_key";
const KEY_RELAY: &str = "relay_api_key";
const KEY_STT_CUSTOM: &str = "stt_custom_api_key";

/// Where sensitive fields were last successfully written (for diagnostics only).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SecretsBackendKind {
    Keychain,
    File,
}

static KEYCHAIN_USABLE: OnceLock<bool> = OnceLock::new();

/// Process-lifetime cache after first full unlock — avoids re-prompting Keychain
/// on every `load_secrets()` within the same app session.
static SESSION_CACHE: Mutex<Option<SecretsFile>> = Mutex::new(None);

/// Soft probe: ask the OS store about a never-written account.
///
/// **Does not** call `set_password` — writing a throwaway entry is what made
/// macOS ask for Keychain password on every cold start.
fn probe_keychain() -> bool {
    let probe_user = "__grok_app_keychain_probe__";
    let entry = match keyring::Entry::new(KEYRING_SERVICE, probe_user) {
        Ok(e) => e,
        Err(e) => {
            tracing::info!(
                target: "grok_app::secrets",
                error = %e,
                "OS keychain unavailable; using secrets.json fallback"
            );
            return false;
        }
    };
    match entry.get_password() {
        // NoEntry = store is reachable and nothing stored (normal).
        Err(keyring::Error::NoEntry) => {
            tracing::info!(
                target: "grok_app::secrets",
                "OS keychain available for app secrets (soft probe)"
            );
            true
        }
        // Leftover probe from older builds — still means keychain works.
        Ok(_) => {
            let _ = entry.delete_credential();
            tracing::info!(
                target: "grok_app::secrets",
                "OS keychain available for app secrets"
            );
            true
        }
        Err(e) => {
            tracing::info!(
                target: "grok_app::secrets",
                error = %e,
                "OS keychain probe failed; using secrets.json fallback"
            );
            false
        }
    }
}

/// Soft probe once and cache. Never logs secret values.
fn keychain_platform_ok() -> bool {
    *KEYCHAIN_USABLE.get_or_init(probe_keychain)
}

/// User opted into OS keychain via settings (default false → file).
fn prefer_keychain_storage() -> bool {
    crate::store::load_settings().store_api_keys_in_keychain
}

/// Actually use keychain for read/write of API keys.
fn use_keychain_backend() -> bool {
    prefer_keychain_storage() && keychain_platform_ok()
}

fn keyring_entry(account: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, account).map_err(|e| e.to_string())
}

fn keychain_get(account: &str) -> Option<String> {
    let entry = keyring_entry(account).ok()?;
    match entry.get_password() {
        Ok(s) if !s.is_empty() => Some(s),
        Ok(_) => None,
        Err(keyring::Error::NoEntry) => None,
        Err(e) => {
            tracing::warn!(
                target: "grok_app::secrets",
                account,
                error = %e,
                "failed to read secret from OS keychain"
            );
            None
        }
    }
}

fn keychain_set(account: &str, value: &str) -> Result<(), String> {
    if value.is_empty() {
        return keychain_delete(account);
    }
    let entry = keyring_entry(account)?;
    entry.set_password(value).map_err(|e| e.to_string())
}

fn keychain_delete(account: &str) -> Result<(), String> {
    let entry = match keyring_entry(account) {
        Ok(e) => e,
        Err(_) => return Ok(()),
    };
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

fn non_empty(s: &Option<String>) -> bool {
    s.as_ref().map(|v| !v.is_empty()).unwrap_or(false)
}

/// Any non-empty per-provider custom STT key (or the legacy single key).
fn stt_keys_non_empty(s: &SecretsFile) -> bool {
    non_empty(&s.stt_custom_api_key) || s.stt_custom_api_keys.values().any(|k| !k.is_empty())
}

/// ADR-0001 migration: fold the legacy single custom STT key into the
/// per-provider map under the `custom` slot at load time.
fn migrate_legacy_stt_key(s: &mut SecretsFile) {
    if non_empty(&s.stt_custom_api_key) {
        if !s.stt_custom_api_keys.contains_key("custom") {
            let legacy = s.stt_custom_api_key.clone().unwrap_or_default();
            s.stt_custom_api_keys.insert("custom".into(), legacy);
        }
        s.stt_custom_api_key = None;
    }
}

/// Resolve the custom STT key for a provider preset id: exact slot first, the
/// `custom` slot as the ADR-0001 migration fallback.
pub fn stt_custom_key_for(s: &SecretsFile, provider: &str) -> Option<String> {
    let p = provider.trim();
    if !p.is_empty() {
        if let Some(k) = s.stt_custom_api_keys.get(p).filter(|k| !k.is_empty()) {
            return Some(k.clone());
        }
    }
    s.stt_custom_api_keys
        .get("custom")
        .filter(|k| !k.is_empty())
        .cloned()
}

/// Presence flags for every known provider slot (disk only — no keychain
/// unlock). Used by the settings UI for key-field placeholders. Persisted
/// non-secret flags are the source of truth; plaintext leftovers count too.
pub fn stt_custom_key_presence(disk: &SecretsFile) -> std::collections::HashMap<String, bool> {
    let mut m = disk.stt_custom_key_presence.clone();
    for id in ["local", "groq", "openai", "mistral", "custom"] {
        let has_plain = disk
            .stt_custom_api_keys
            .get(id)
            .map(|k| !k.is_empty())
            .unwrap_or(false);
        m.insert(
            id.to_string(),
            has_plain || m.get(id).copied().unwrap_or(false),
        );
    }
    // Legacy single key counts as present for the `custom` slot.
    if non_empty(&disk.stt_custom_api_key) {
        m.insert("custom".into(), true);
    }
    m
}

/// Recompute per-provider presence flags from the actual key map. Call before
/// persisting so the flags survive keychain-mode saves (which strip values).
pub fn sync_stt_presence(s: &mut SecretsFile) {
    for id in ["local", "groq", "openai", "mistral", "custom"] {
        let has = s
            .stt_custom_api_keys
            .get(id)
            .map(|k| !k.is_empty())
            .unwrap_or(false);
        s.stt_custom_key_presence.insert(id.to_string(), has);
    }
}

/// True when the on-disk payload still holds plaintext API keys that should migrate.
pub fn disk_has_plaintext_keys(disk: &SecretsFile) -> bool {
    non_empty(&disk.official_api_key) || non_empty(&disk.relay_api_key) || stt_keys_non_empty(disk)
}

/// Whether UI / setup should treat an official key as configured.
/// Uses plaintext on disk **or** keychain presence flag — never unlocks Keychain.
pub fn has_official_key_configured(disk: &SecretsFile) -> bool {
    non_empty(&disk.official_api_key) || disk.keychain_has_official
}

/// Whether a relay key is configured (disk plaintext or keychain flag).
pub fn has_relay_key_configured(disk: &SecretsFile) -> bool {
    non_empty(&disk.relay_api_key) || disk.keychain_has_relay
}

/// Whether a custom STT key is configured (disk plaintext or keychain flag).
pub fn has_stt_custom_key_configured(disk: &SecretsFile) -> bool {
    stt_keys_non_empty(disk) || disk.keychain_has_stt_custom
}

/// Disk payload with sensitive key fields stripped (metadata + presence flags kept).
pub fn strip_keys_for_disk(s: &SecretsFile) -> SecretsFile {
    SecretsFile {
        official_api_key: None,
        relay_api_key: None,
        stt_custom_api_key: None,
        stt_custom_api_keys: std::collections::HashMap::new(),
        stt_custom_key_presence: s.stt_custom_key_presence.clone(),
        relay_base_url: s.relay_base_url.clone(),
        default_model: s.default_model.clone(),
        keychain_has_official: s.keychain_has_official,
        keychain_has_relay: s.keychain_has_relay,
        keychain_has_stt_custom: s.keychain_has_stt_custom,
    }
}

/// Merge keychain (preferred) over disk for sensitive fields; metadata from disk.
pub fn merge_secrets(disk: SecretsFile, from_keychain: SecretsFile) -> SecretsFile {
    let official = from_keychain
        .official_api_key
        .filter(|k| !k.is_empty())
        .or(disk.official_api_key.filter(|k| !k.is_empty()));
    let relay = from_keychain
        .relay_api_key
        .filter(|k| !k.is_empty())
        .or(disk.relay_api_key.filter(|k| !k.is_empty()));
    // Per-provider: keychain wins per key; disk map supplies the rest.
    let mut stt_custom_keys = disk.stt_custom_api_keys;
    for (k, v) in from_keychain.stt_custom_api_keys {
        if !v.is_empty() {
            stt_custom_keys.insert(k, v);
        }
    }
    let stt_custom = from_keychain
        .stt_custom_api_key
        .filter(|k| !k.is_empty())
        .or(disk.stt_custom_api_key.filter(|k| !k.is_empty()));
    let mut stt_presence = disk.stt_custom_key_presence;
    for (k, v) in from_keychain.stt_custom_key_presence {
        if v {
            stt_presence.insert(k, true);
        }
    }
    let stt_present = stt_custom_keys.values().any(|k| !k.is_empty())
        || non_empty(&stt_custom)
        || stt_presence.values().any(|v| *v);
    SecretsFile {
        // Presence flags: true if we have a value or disk said keychain holds it.
        keychain_has_official: non_empty(&official)
            || disk.keychain_has_official
            || from_keychain.keychain_has_official,
        keychain_has_relay: non_empty(&relay)
            || disk.keychain_has_relay
            || from_keychain.keychain_has_relay,
        keychain_has_stt_custom: stt_present
            || disk.keychain_has_stt_custom
            || from_keychain.keychain_has_stt_custom,
        official_api_key: official,
        relay_api_key: relay,
        stt_custom_api_key: stt_custom,
        stt_custom_api_keys: stt_custom_keys,
        stt_custom_key_presence: stt_presence,
        relay_base_url: disk.relay_base_url,
        default_model: disk.default_model,
    }
}

fn read_disk_secrets(path: &Path) -> SecretsFile {
    match fs::read_to_string(path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => SecretsFile::default(),
    }
}

fn write_disk_secrets(path: &Path, value: &SecretsFile) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let s = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    // Same exclusive-lock + temp-rename path as the session store.
    crate::store_lock::write_bytes_atomic(path, s.as_bytes())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        // write_bytes_atomic creates the final file; ensure mode is private.
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

fn invalidate_session_cache() {
    *SESSION_CACHE.lock() = None;
}

/// Read `secrets.json` only — no Keychain unlock. Safe for cold-start UI.
pub fn load_secrets_disk_only() -> SecretsFile {
    let _ = ensure_app_dirs();
    read_disk_secrets(&secrets_file())
}

/// One-shot migration: import plaintext keys from `secrets.json` into the OS keychain
/// and clear those fields from disk. Safe to call repeatedly.
///
/// Only runs when the user has enabled keychain storage.
/// Returns how many key fields were migrated (0–2). Does not log secret values.
pub fn migrate_plaintext_keys_to_keychain(disk: &mut SecretsFile) -> usize {
    if !use_keychain_backend() {
        return 0;
    }
    if !disk_has_plaintext_keys(disk) {
        return 0;
    }

    let mut migrated = 0usize;
    let mut failed = false;

    if non_empty(&disk.official_api_key) {
        let key = disk.official_api_key.as_deref().unwrap();
        match keychain_set(KEY_OFFICIAL, key) {
            Ok(()) => {
                disk.official_api_key = None;
                disk.keychain_has_official = true;
                migrated += 1;
            }
            Err(e) => {
                failed = true;
                tracing::warn!(
                    target: "grok_app::secrets",
                    field = KEY_OFFICIAL,
                    error = %e,
                    "failed to migrate secret field to OS keychain; leaving on disk"
                );
            }
        }
    }

    if non_empty(&disk.relay_api_key) {
        let key = disk.relay_api_key.as_deref().unwrap();
        match keychain_set(KEY_RELAY, key) {
            Ok(()) => {
                disk.relay_api_key = None;
                disk.keychain_has_relay = true;
                migrated += 1;
            }
            Err(e) => {
                failed = true;
                tracing::warn!(
                    target: "grok_app::secrets",
                    field = KEY_RELAY,
                    error = %e,
                    "failed to migrate secret field to OS keychain; leaving on disk"
                );
            }
        }
    }

    // Fold legacy single key into the map first (ADR-0001), then store the
    // whole per-provider map as one keychain entry (JSON).
    migrate_legacy_stt_key(disk);
    if !disk.stt_custom_api_keys.is_empty() {
        match serde_json::to_string(&disk.stt_custom_api_keys) {
            Ok(json) => match keychain_set(KEY_STT_CUSTOM, &json) {
                Ok(()) => {
                    disk.stt_custom_api_keys.clear();
                    disk.keychain_has_stt_custom = true;
                    migrated += 1;
                }
                Err(e) => {
                    failed = true;
                    tracing::warn!(
                        target: "grok_app::secrets",
                        field = KEY_STT_CUSTOM,
                        error = %e,
                        "failed to migrate secret field to OS keychain; leaving on disk"
                    );
                }
            },
            Err(e) => {
                failed = true;
                tracing::warn!(
                    target: "grok_app::secrets",
                    error = %e,
                    "failed to serialize custom STT keys for keychain migration"
                );
            }
        }
    }

    if migrated > 0 {
        let path = secrets_file();
        if let Err(e) = write_disk_secrets(&path, disk) {
            tracing::warn!(
                target: "grok_app::secrets",
                error = %e,
                "migrated secrets to keychain but failed to rewrite secrets.json"
            );
        } else {
            tracing::info!(
                target: "grok_app::secrets",
                migrated_fields = migrated,
                partial_failure = failed,
                "migrated plaintext secrets from secrets.json to OS keychain"
            );
        }
        invalidate_session_cache();
    }

    migrated
}

/// Load secrets with values.
///
/// - File mode (default): disk only, never touches Keychain.
/// - Keychain mode: may unlock OS store once per process (then cached).
///
/// Use [`load_secrets_disk_only`] when you only need presence / metadata.
pub fn load_secrets() -> SecretsFile {
    {
        let cache = SESSION_CACHE.lock();
        if let Some(ref s) = *cache {
            return s.clone();
        }
    }

    let _ = ensure_app_dirs();
    let path = secrets_file();
    let mut disk = read_disk_secrets(&path);

    if !use_keychain_backend() {
        migrate_legacy_stt_key(&mut disk);
        *SESSION_CACHE.lock() = Some(disk.clone());
        return disk;
    }

    let _ = migrate_plaintext_keys_to_keychain(&mut disk);
    migrate_legacy_stt_key(&mut disk);

    let official = if disk.keychain_has_official || non_empty(&disk.official_api_key) {
        keychain_get(KEY_OFFICIAL)
    } else {
        None
    };
    let relay = if disk.keychain_has_relay || non_empty(&disk.relay_api_key) {
        keychain_get(KEY_RELAY)
    } else {
        None
    };
    // Keychain holds the per-provider map as JSON. Older entries stored the
    // raw single key — parse failure folds that into the `custom` slot.
    let stt_keys: std::collections::HashMap<String, String> =
        if disk.keychain_has_stt_custom || !disk.stt_custom_api_keys.is_empty() {
            match keychain_get(KEY_STT_CUSTOM) {
                Some(json) => serde_json::from_str(&json).unwrap_or_else(|_| {
                    std::collections::HashMap::from([("custom".to_string(), json)])
                }),
                None => std::collections::HashMap::new(),
            }
        } else {
            std::collections::HashMap::new()
        };
    let from_kc = SecretsFile {
        official_api_key: official,
        relay_api_key: relay,
        stt_custom_api_key: None,
        stt_custom_api_keys: stt_keys,
        stt_custom_key_presence: disk.stt_custom_key_presence.clone(),
        keychain_has_official: disk.keychain_has_official,
        keychain_has_relay: disk.keychain_has_relay,
        keychain_has_stt_custom: disk.keychain_has_stt_custom,
        relay_base_url: None,
        default_model: None,
    };
    let merged = merge_secrets(disk, from_kc);
    *SESSION_CACHE.lock() = Some(merged.clone());
    merged
}

/// Save secrets. Keychain only when the user setting is on and the platform works.
pub fn save_secrets(s: &SecretsFile) -> Result<(), String> {
    let _ = ensure_app_dirs();
    let path = secrets_file();
    invalidate_session_cache();
    // Per-provider presence is derived from the key map on every save so it
    // survives keychain-mode writes (which strip key values from disk).
    let mut s = s.clone();
    sync_stt_presence(&mut s);

    if use_keychain_backend() {
        let mut disk = strip_keys_for_disk(&s);

        match &s.official_api_key {
            Some(k) if !k.is_empty() => {
                keychain_set(KEY_OFFICIAL, k)?;
                disk.keychain_has_official = true;
            }
            _ => {
                if s.keychain_has_official || non_empty(&s.official_api_key) {
                    keychain_delete(KEY_OFFICIAL)?;
                }
                disk.keychain_has_official = false;
            }
        }
        match &s.relay_api_key {
            Some(k) if !k.is_empty() => {
                keychain_set(KEY_RELAY, k)?;
                disk.keychain_has_relay = true;
            }
            _ => {
                if s.keychain_has_relay || non_empty(&s.relay_api_key) {
                    keychain_delete(KEY_RELAY)?;
                }
                disk.keychain_has_relay = false;
            }
        }
        match &s.stt_custom_api_keys {
            m if !m.values().any(|k| !k.is_empty()) => {
                if s.keychain_has_stt_custom || stt_keys_non_empty(&s) {
                    keychain_delete(KEY_STT_CUSTOM)?;
                }
                disk.keychain_has_stt_custom = false;
            }
            m => {
                let json = serde_json::to_string(m).map_err(|e| e.to_string())?;
                keychain_set(KEY_STT_CUSTOM, &json)?;
                disk.keychain_has_stt_custom = true;
            }
        }

        write_disk_secrets(&path, &disk)?;
        let cached = SecretsFile {
            official_api_key: s.official_api_key.clone(),
            relay_api_key: s.relay_api_key.clone(),
            stt_custom_api_key: None,
            stt_custom_api_keys: s.stt_custom_api_keys.clone(),
            stt_custom_key_presence: disk.stt_custom_key_presence.clone(),
            relay_base_url: disk.relay_base_url.clone(),
            default_model: disk.default_model.clone(),
            keychain_has_official: disk.keychain_has_official,
            keychain_has_relay: disk.keychain_has_relay,
            keychain_has_stt_custom: disk.keychain_has_stt_custom,
        };
        *SESSION_CACHE.lock() = Some(cached);
        Ok(())
    } else {
        // File mode: write full payload; drop any leftover keychain entries best-effort.
        let mut file = s.clone();
        sync_stt_presence(&mut file);
        migrate_legacy_stt_key(&mut file);
        if file.keychain_has_official || file.keychain_has_relay || file.keychain_has_stt_custom {
            // Pull values if caller only had flags (shouldn't happen after load).
            if !non_empty(&file.official_api_key) && file.keychain_has_official {
                file.official_api_key = keychain_get(KEY_OFFICIAL);
            }
            if !non_empty(&file.relay_api_key) && file.keychain_has_relay {
                file.relay_api_key = keychain_get(KEY_RELAY);
            }
            if file.stt_custom_api_keys.is_empty() && file.keychain_has_stt_custom {
                file.stt_custom_api_keys = keychain_get(KEY_STT_CUSTOM)
                    .and_then(|json| serde_json::from_str(&json).ok())
                    .unwrap_or_default();
            }
            if keychain_platform_ok() {
                let _ = keychain_delete(KEY_OFFICIAL);
                let _ = keychain_delete(KEY_RELAY);
                let _ = keychain_delete(KEY_STT_CUSTOM);
            }
        }
        file.keychain_has_official = false;
        file.keychain_has_relay = false;
        file.keychain_has_stt_custom = false;
        write_disk_secrets(&path, &file)?;
        *SESSION_CACHE.lock() = Some(file);
        Ok(())
    }
}

/// Backend according to **user setting** (not a live probe). Safe for cold-start UI.
pub fn configured_backend() -> SecretsBackendKind {
    if prefer_keychain_storage() {
        SecretsBackendKind::Keychain
    } else {
        SecretsBackendKind::File
    }
}

/// Live backend that would be used for the next save/load of key material.
pub fn active_backend() -> SecretsBackendKind {
    if use_keychain_backend() {
        SecretsBackendKind::Keychain
    } else {
        SecretsBackendKind::File
    }
}

/// Apply settings toggle. Call after `store_api_keys_in_keychain` is saved.
///
/// - on → move disk keys into Keychain (may prompt once)
/// - off → pull keys to disk, clear Keychain (may unlock once)
pub fn apply_keychain_preference(enabled: bool) -> Result<(), String> {
    invalidate_session_cache();
    let path = secrets_file();
    let mut disk = read_disk_secrets(&path);

    if enabled {
        if !keychain_platform_ok() {
            return Err("OS keychain is not available; keys stay in secrets.json".into());
        }
        // Re-read any values already in keychain so we don't drop them.
        if disk.keychain_has_official && !non_empty(&disk.official_api_key) {
            disk.official_api_key = keychain_get(KEY_OFFICIAL);
        }
        if disk.keychain_has_relay && !non_empty(&disk.relay_api_key) {
            disk.relay_api_key = keychain_get(KEY_RELAY);
        }
        if disk.keychain_has_stt_custom && disk.stt_custom_api_keys.is_empty() {
            disk.stt_custom_api_keys = keychain_get(KEY_STT_CUSTOM)
                .and_then(|json| serde_json::from_str(&json).ok())
                .unwrap_or_default();
        }
        sync_stt_presence(&mut disk);
        migrate_legacy_stt_key(&mut disk);

        let mut meta = strip_keys_for_disk(&disk);
        let mut official = disk.official_api_key.clone();
        let mut relay = disk.relay_api_key.clone();
        let mut stt_keys = disk.stt_custom_api_keys.clone();

        if non_empty(&official) {
            keychain_set(KEY_OFFICIAL, official.as_deref().unwrap())?;
            meta.keychain_has_official = true;
        }
        if non_empty(&relay) {
            keychain_set(KEY_RELAY, relay.as_deref().unwrap())?;
            meta.keychain_has_relay = true;
        }
        if !stt_keys.is_empty() {
            let json = serde_json::to_string(&stt_keys).map_err(|e| e.to_string())?;
            keychain_set(KEY_STT_CUSTOM, &json)?;
            meta.keychain_has_stt_custom = true;
        }

        write_disk_secrets(&path, &meta)?;
        *SESSION_CACHE.lock() = Some(SecretsFile {
            official_api_key: official.take(),
            relay_api_key: relay.take(),
            stt_custom_api_key: None,
            stt_custom_api_keys: std::mem::take(&mut stt_keys),
            stt_custom_key_presence: meta.stt_custom_key_presence.clone(),
            relay_base_url: meta.relay_base_url,
            default_model: meta.default_model,
            keychain_has_official: meta.keychain_has_official,
            keychain_has_relay: meta.keychain_has_relay,
            keychain_has_stt_custom: meta.keychain_has_stt_custom,
        });
        tracing::info!(target: "grok_app::secrets", "API keys storage: OS keychain");
        Ok(())
    } else {
        if keychain_platform_ok() {
            if disk.keychain_has_official || non_empty(&disk.official_api_key) {
                if let Some(k) = keychain_get(KEY_OFFICIAL) {
                    disk.official_api_key = Some(k);
                }
            }
            if disk.keychain_has_relay || non_empty(&disk.relay_api_key) {
                if let Some(k) = keychain_get(KEY_RELAY) {
                    disk.relay_api_key = Some(k);
                }
            }
            if disk.keychain_has_stt_custom || !disk.stt_custom_api_keys.is_empty() {
                if let Some(json) = keychain_get(KEY_STT_CUSTOM) {
                    disk.stt_custom_api_keys = serde_json::from_str(&json).unwrap_or_else(|_| {
                        std::collections::HashMap::from([("custom".to_string(), json)])
                    });
                }
            }
            let _ = keychain_delete(KEY_OFFICIAL);
            let _ = keychain_delete(KEY_RELAY);
            let _ = keychain_delete(KEY_STT_CUSTOM);
        }
        sync_stt_presence(&mut disk);
        migrate_legacy_stt_key(&mut disk);
        disk.keychain_has_official = false;
        disk.keychain_has_relay = false;
        disk.keychain_has_stt_custom = false;
        write_disk_secrets(&path, &disk)?;
        *SESSION_CACHE.lock() = Some(disk);
        tracing::info!(target: "grok_app::secrets", "API keys storage: secrets.json");
        Ok(())
    }
}

/// Remove OS keychain entries for app secrets. Safe if entries are missing.
pub fn clear_keychain_secrets() {
    invalidate_session_cache();
    if keychain_platform_ok() {
        for account in [KEY_OFFICIAL, KEY_RELAY, KEY_STT_CUSTOM] {
            if let Err(e) = keychain_delete(account) {
                tracing::warn!(
                    target: "grok_app::secrets",
                    account,
                    error = %e,
                    "failed to delete secret from OS keychain"
                );
            }
        }
    }
    let path = secrets_file();
    if path.is_file() {
        let mut disk = read_disk_secrets(&path);
        disk.keychain_has_official = false;
        disk.keychain_has_relay = false;
        disk.keychain_has_stt_custom = false;
        disk.official_api_key = None;
        disk.relay_api_key = None;
        disk.stt_custom_api_key = None;
        disk.stt_custom_api_keys.clear();
        let _ = write_disk_secrets(&path, &disk);
    }
    tracing::info!(
        target: "grok_app::secrets",
        "cleared app secrets from OS keychain"
    );
}

/// Full wipe of app secrets (keychain + disk file). Used by reset_app_data.
pub fn wipe_all_secrets() -> Result<(), String> {
    clear_keychain_secrets();
    let path = secrets_file();
    if path.is_file() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    invalidate_session_cache();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn disk_has_plaintext_keys_detects_present() {
        let empty = SecretsFile::default();
        assert!(!disk_has_plaintext_keys(&empty));

        let blank = SecretsFile {
            official_api_key: Some(String::new()),
            relay_api_key: Some("".into()),
            ..Default::default()
        };
        assert!(!disk_has_plaintext_keys(&blank));

        let only_official = SecretsFile {
            official_api_key: Some("sk-test-key-value".into()),
            ..Default::default()
        };
        assert!(disk_has_plaintext_keys(&only_official));

        let only_relay = SecretsFile {
            relay_api_key: Some("rk-test".into()),
            ..Default::default()
        };
        assert!(disk_has_plaintext_keys(&only_relay));
    }

    #[test]
    fn presence_uses_keychain_flags_without_values() {
        let disk = SecretsFile {
            keychain_has_official: true,
            keychain_has_relay: false,
            ..Default::default()
        };
        assert!(has_official_key_configured(&disk));
        assert!(!has_relay_key_configured(&disk));
        assert!(!disk_has_plaintext_keys(&disk));
    }

    #[test]
    fn strip_keys_for_disk_keeps_metadata_and_flags() {
        let s = SecretsFile {
            official_api_key: Some("sk-secret".into()),
            relay_api_key: Some("rk-secret".into()),
            relay_base_url: Some("https://relay.example".into()),
            default_model: Some("grok-4".into()),
            keychain_has_official: true,
            keychain_has_relay: true,
            stt_custom_api_key: None,
            stt_custom_api_keys: HashMap::new(),
            stt_custom_key_presence: HashMap::new(),
            keychain_has_stt_custom: false,
        };
        let disk = strip_keys_for_disk(&s);
        assert!(disk.official_api_key.is_none());
        assert!(disk.relay_api_key.is_none());
        assert_eq!(
            disk.relay_base_url.as_deref(),
            Some("https://relay.example")
        );
        assert_eq!(disk.default_model.as_deref(), Some("grok-4"));
        assert!(disk.keychain_has_official);
        assert!(disk.keychain_has_relay);
    }

    #[test]
    fn merge_prefers_keychain_over_disk() {
        let disk = SecretsFile {
            official_api_key: Some("disk-old".into()),
            relay_api_key: None,
            relay_base_url: Some("https://example.com".into()),
            default_model: Some("m1".into()),
            keychain_has_official: false,
            keychain_has_relay: false,
            stt_custom_api_key: None,
            stt_custom_api_keys: HashMap::new(),
            stt_custom_key_presence: HashMap::new(),
            keychain_has_stt_custom: false,
        };
        let kc = SecretsFile {
            official_api_key: Some("kc-new".into()),
            relay_api_key: Some("kc-relay".into()),
            ..Default::default()
        };
        let m = merge_secrets(disk, kc);
        assert_eq!(m.official_api_key.as_deref(), Some("kc-new"));
        assert_eq!(m.relay_api_key.as_deref(), Some("kc-relay"));
        assert_eq!(m.relay_base_url.as_deref(), Some("https://example.com"));
        assert_eq!(m.default_model.as_deref(), Some("m1"));
        assert!(m.keychain_has_official);
        assert!(m.keychain_has_relay);
    }

    #[test]
    fn merge_falls_back_to_disk_when_keychain_empty() {
        let disk = SecretsFile {
            official_api_key: Some("disk-key".into()),
            relay_api_key: Some("disk-relay".into()),
            relay_base_url: Some("https://x".into()),
            default_model: None,
            ..Default::default()
        };
        let kc = SecretsFile::default();
        let m = merge_secrets(disk, kc);
        assert_eq!(m.official_api_key.as_deref(), Some("disk-key"));
        assert_eq!(m.relay_api_key.as_deref(), Some("disk-relay"));
    }

    #[test]
    fn strip_roundtrip_json_has_no_keys() {
        let s = SecretsFile {
            official_api_key: Some("sk-should-not-serialize".into()),
            relay_api_key: Some("rk-nope".into()),
            relay_base_url: Some("https://relay.example".into()),
            default_model: Some("g".into()),
            keychain_has_official: true,
            keychain_has_relay: false,
            stt_custom_api_key: None,
            stt_custom_api_keys: HashMap::new(),
            stt_custom_key_presence: HashMap::new(),
            keychain_has_stt_custom: false,
        };
        let disk = strip_keys_for_disk(&s);
        let json = serde_json::to_string(&disk).unwrap();
        assert!(!json.contains("sk-should-not-serialize"));
        assert!(!json.contains("rk-nope"));
        assert!(json.contains("relay.example") || json.contains("relayBaseUrl"));
        assert!(json.contains("keychainHasOfficial") || json.contains("true"));
    }

    #[test]
    fn keychain_roundtrip_when_available() {
        if !probe_keychain() {
            return;
        }
        let account = format!("test_roundtrip_{}", std::process::id());
        let entry = keyring::Entry::new(KEYRING_SERVICE, &account).expect("entry");
        let _ = entry.delete_credential();
        entry.set_password("unit-test-secret").expect("set");
        assert_eq!(entry.get_password().unwrap(), "unit-test-secret");
        entry.delete_credential().expect("delete");
        assert!(matches!(entry.get_password(), Err(keyring::Error::NoEntry)));
    }

    #[test]
    fn soft_probe_does_not_require_write() {
        // Soft probe must not create credentials; leftover probe accounts should stay absent.
        let _ = probe_keychain();
        if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, "__grok_app_keychain_probe__") {
            // After soft probe, either NoEntry or we cleaned a legacy probe write.
            match entry.get_password() {
                Err(keyring::Error::NoEntry) => {}
                Ok(_) => {
                    // Legacy leftover is OK; soft probe deletes it when seen.
                    let _ = entry.delete_credential();
                }
                Err(_) => {}
            }
        }
    }

    #[test]
    fn presence_helpers_do_not_need_key_material() {
        let s = SecretsFile {
            keychain_has_official: true,
            keychain_has_relay: true,
            official_api_key: None,
            relay_api_key: None,
            ..Default::default()
        };
        assert!(has_official_key_configured(&s));
        assert!(has_relay_key_configured(&s));
        assert!(!disk_has_plaintext_keys(&s));
    }

    #[test]
    fn stt_custom_key_presence_and_strip() {
        let s = SecretsFile {
            stt_custom_api_key: Some("stt-secret".into()),
            keychain_has_stt_custom: true,
            ..Default::default()
        };
        assert!(has_stt_custom_key_configured(&s));
        assert!(disk_has_plaintext_keys(&s));

        let disk = strip_keys_for_disk(&s);
        assert!(disk.stt_custom_api_key.is_none());
        assert!(disk.keychain_has_stt_custom);
        let json = serde_json::to_string(&disk).unwrap();
        assert!(!json.contains("stt-secret"));
    }

    #[test]
    fn merge_keeps_stt_custom_key() {
        let disk = SecretsFile {
            stt_custom_api_key: Some("disk-stt".into()),
            keychain_has_stt_custom: false,
            ..Default::default()
        };
        let kc = SecretsFile {
            stt_custom_api_key: Some("kc-stt".into()),
            keychain_has_stt_custom: true,
            ..Default::default()
        };
        let m = merge_secrets(disk, kc);
        assert_eq!(m.stt_custom_api_key.as_deref(), Some("kc-stt"));
        assert!(m.keychain_has_stt_custom);
    }

    #[test]
    fn presence_flags_survive_strip_and_sync() {
        let mut s = SecretsFile {
            stt_custom_api_keys: HashMap::from([
                ("groq".to_string(), "g".into()),
                ("openai".to_string(), String::new()),
            ]),
            ..Default::default()
        };
        sync_stt_presence(&mut s);
        assert!(s
            .stt_custom_key_presence
            .get("groq")
            .copied()
            .unwrap_or(false));
        assert!(!s
            .stt_custom_key_presence
            .get("openai")
            .copied()
            .unwrap_or(true));

        // Keychain-mode strip must keep the non-secret presence flags.
        let disk = strip_keys_for_disk(&s);
        assert!(disk.stt_custom_api_keys.is_empty());
        assert!(disk
            .stt_custom_key_presence
            .get("groq")
            .copied()
            .unwrap_or(false));
        let p = stt_custom_key_presence(&disk);
        assert!(p.get("groq").copied().unwrap_or(false));
        assert!(!p.get("openai").copied().unwrap_or(true));
    }

    #[test]
    fn merge_stt_present_flag_not_inverted() {
        let disk = SecretsFile {
            stt_custom_api_keys: HashMap::from([("groq".to_string(), "g".into())]),
            stt_custom_key_presence: HashMap::from([("groq".to_string(), true)]),
            ..Default::default()
        };
        let m = merge_secrets(disk, SecretsFile::default());
        assert!(
            m.keychain_has_stt_custom,
            "stored key must count as present"
        );
        // Empty key map + no flags → not present.
        let m2 = merge_secrets(SecretsFile::default(), SecretsFile::default());
        assert!(!m2.keychain_has_stt_custom);
    }

    #[test]
    fn default_settings_prefer_file_not_keychain() {
        let s = crate::store::AppSettings::default();
        assert!(!s.store_api_keys_in_keychain);
    }

    #[test]
    fn file_write_preserves_keys_when_using_full_payload() {
        let tmp =
            std::env::temp_dir().join(format!("grok-app-secrets-file-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        let path = tmp.join("secrets.json");
        let s = SecretsFile {
            official_api_key: Some("sk-file-only".into()),
            relay_api_key: Some("rk-file".into()),
            relay_base_url: Some("https://f".into()),
            default_model: Some("m".into()),
            ..Default::default()
        };
        write_disk_secrets(&path, &s).unwrap();
        let back = read_disk_secrets(&path);
        assert_eq!(back.official_api_key.as_deref(), Some("sk-file-only"));
        assert_eq!(back.relay_api_key.as_deref(), Some("rk-file"));
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn stt_custom_key_for_prefers_exact_slot_then_custom_fallback() {
        let s = SecretsFile {
            stt_custom_api_keys: HashMap::from([
                ("groq".to_string(), "groq-key".into()),
                ("custom".to_string(), "custom-key".into()),
            ]),
            ..Default::default()
        };
        assert_eq!(stt_custom_key_for(&s, "groq").as_deref(), Some("groq-key"));
        // Provider without its own slot falls back to the `custom` slot.
        assert_eq!(
            stt_custom_key_for(&s, "openai").as_deref(),
            Some("custom-key")
        );
        // No slots → None.
        let empty = SecretsFile::default();
        assert_eq!(stt_custom_key_for(&empty, "groq"), None);
    }

    #[test]
    fn migrate_legacy_stt_key_folds_into_custom_slot() {
        let mut s = SecretsFile {
            stt_custom_api_key: Some("legacy-key".into()),
            ..Default::default()
        };
        migrate_legacy_stt_key(&mut s);
        assert!(s.stt_custom_api_key.is_none());
        assert_eq!(
            s.stt_custom_api_keys.get("custom").map(String::as_str),
            Some("legacy-key")
        );
        // Existing custom slot wins; legacy is dropped.
        let mut s2 = SecretsFile {
            stt_custom_api_key: Some("legacy".into()),
            stt_custom_api_keys: HashMap::from([("custom".to_string(), "kept".into())]),
            ..Default::default()
        };
        migrate_legacy_stt_key(&mut s2);
        assert_eq!(
            s2.stt_custom_api_keys.get("custom").map(String::as_str),
            Some("kept")
        );
    }

    #[test]
    fn stt_custom_key_presence_reports_per_slot() {
        let s = SecretsFile {
            stt_custom_api_keys: HashMap::from([
                ("groq".to_string(), "g".into()),
                ("openai".to_string(), String::new()),
            ]),
            stt_custom_api_key: Some("legacy".into()),
            ..Default::default()
        };
        let p = stt_custom_key_presence(&s);
        assert!(p.get("groq").copied().unwrap_or(false));
        assert!(!p.get("openai").copied().unwrap_or(true));
        assert!(p.get("custom").copied().unwrap_or(false)); // legacy folded presence
    }
}
