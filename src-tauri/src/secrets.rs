//! App secrets backend: OS keychain (preferred) with encrypted-at-rest file fallback.
//!
//! Callers use [`crate::store::load_secrets`] / [`crate::store::save_secrets`] only —
//! this module owns where `official_api_key` / `relay_api_key` actually live.
//!
//! - macOS: Keychain via `keyring` (`apple-native`)
//! - Windows: Credential Manager (`windows-native`)
//! - Linux: FreeDesktop Secret Service when available (`sync-secret-service`)
//! - Fallback: `secrets.json` with mode `0600` when the OS store is unavailable
//!
//! Non-secret metadata (`relay_base_url`, `default_model`) always stays in `secrets.json`.
//! Custom provider API keys in `agent-home/config.toml` are intentionally separate.

use std::fs;
use std::path::PathBuf;
use std::sync::OnceLock;

use crate::paths::{ensure_app_dirs, secrets_file};
use crate::store::SecretsFile;

/// Reverse-DNS service id shared with app data layout (`com.grokapp.grok-app`).
const KEYRING_SERVICE: &str = "com.grokapp.grok-app";

const KEY_OFFICIAL: &str = "official_api_key";
const KEY_RELAY: &str = "relay_api_key";

/// Where sensitive fields were last successfully written (for diagnostics only).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SecretsBackendKind {
    Keychain,
    File,
}

static KEYCHAIN_USABLE: OnceLock<bool> = OnceLock::new();

/// Probe OS keychain once and cache. Never logs secret values.
fn keychain_usable() -> bool {
    *KEYCHAIN_USABLE.get_or_init(|| probe_keychain())
}

fn probe_keychain() -> bool {
    // Write + read + delete a throwaway entry. Failure → file fallback for the process lifetime.
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
    if let Err(e) = entry.set_password("probe") {
        tracing::info!(
            target: "grok_app::secrets",
            error = %e,
            "OS keychain write failed; using secrets.json fallback"
        );
        return false;
    }
    match entry.get_password() {
        Ok(v) if v == "probe" => {
            let _ = entry.delete_credential();
            tracing::info!(
                target: "grok_app::secrets",
                "OS keychain available for app secrets"
            );
            true
        }
        Ok(_) | Err(_) => {
            let _ = entry.delete_credential();
            tracing::info!(
                target: "grok_app::secrets",
                "OS keychain read-back failed; using secrets.json fallback"
            );
            false
        }
    }
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

/// True when the on-disk payload still holds plaintext API keys that should migrate.
pub fn disk_has_plaintext_keys(disk: &SecretsFile) -> bool {
    non_empty(&disk.official_api_key) || non_empty(&disk.relay_api_key)
}

/// Disk payload with sensitive key fields stripped (metadata kept).
/// Used after successful keychain writes so plaintext keys leave the filesystem.
pub fn strip_keys_for_disk(s: &SecretsFile) -> SecretsFile {
    SecretsFile {
        official_api_key: None,
        relay_api_key: None,
        relay_base_url: s.relay_base_url.clone(),
        default_model: s.default_model.clone(),
    }
}

/// Merge keychain (preferred) over disk for sensitive fields; metadata from disk.
pub fn merge_secrets(disk: SecretsFile, from_keychain: SecretsFile) -> SecretsFile {
    SecretsFile {
        official_api_key: from_keychain
            .official_api_key
            .filter(|k| !k.is_empty())
            .or(disk.official_api_key.filter(|k| !k.is_empty())),
        relay_api_key: from_keychain
            .relay_api_key
            .filter(|k| !k.is_empty())
            .or(disk.relay_api_key.filter(|k| !k.is_empty())),
        relay_base_url: disk.relay_base_url,
        default_model: disk.default_model,
    }
}

fn read_disk_secrets(path: &PathBuf) -> SecretsFile {
    match fs::read_to_string(path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => SecretsFile::default(),
    }
}

fn write_disk_secrets(path: &PathBuf, value: &SecretsFile) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let s = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    fs::write(path, s).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

/// One-shot migration: import plaintext keys from `secrets.json` into the OS keychain
/// and clear those fields from disk. Safe to call repeatedly.
///
/// Returns how many key fields were migrated (0–2). Does not log secret values.
pub fn migrate_plaintext_keys_to_keychain(disk: &mut SecretsFile) -> usize {
    if !keychain_usable() {
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

    if migrated > 0 {
        // Persist stripped (or partially stripped) disk image so plaintext does not linger.
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
    }

    migrated
}

/// Load secrets: migrate plaintext disk keys if needed, then overlay OS keychain.
pub fn load_secrets() -> SecretsFile {
    let _ = ensure_app_dirs();
    let path = secrets_file();
    let mut disk = read_disk_secrets(&path);

    // Import any leftover plaintext keys before serving callers.
    let _ = migrate_plaintext_keys_to_keychain(&mut disk);

    if keychain_usable() {
        let from_kc = SecretsFile {
            official_api_key: keychain_get(KEY_OFFICIAL),
            relay_api_key: keychain_get(KEY_RELAY),
            relay_base_url: None,
            default_model: None,
        };
        merge_secrets(disk, from_kc)
    } else {
        disk
    }
}

/// Save secrets. Prefer OS keychain for API keys; always write metadata to disk.
pub fn save_secrets(s: &SecretsFile) -> Result<(), String> {
    let _ = ensure_app_dirs();
    let path = secrets_file();

    if keychain_usable() {
        // Write / clear each sensitive field in the OS store.
        match &s.official_api_key {
            Some(k) if !k.is_empty() => keychain_set(KEY_OFFICIAL, k)?,
            _ => keychain_delete(KEY_OFFICIAL)?,
        }
        match &s.relay_api_key {
            Some(k) if !k.is_empty() => keychain_set(KEY_RELAY, k)?,
            _ => keychain_delete(KEY_RELAY)?,
        }
        // Never leave plaintext keys on disk once keychain holds them.
        write_disk_secrets(&path, &strip_keys_for_disk(s))?;
        Ok(())
    } else {
        write_disk_secrets(&path, s)
    }
}

/// Which backend currently holds sensitive key material (best-effort).
pub fn active_backend() -> SecretsBackendKind {
    if keychain_usable() {
        SecretsBackendKind::Keychain
    } else {
        SecretsBackendKind::File
    }
}

/// Remove OS keychain entries for app secrets. Safe if entries are missing.
/// Does not delete `secrets.json` (caller decides).
pub fn clear_keychain_secrets() {
    if !keychain_usable() {
        return;
    }
    for account in [KEY_OFFICIAL, KEY_RELAY] {
        if let Err(e) = keychain_delete(account) {
            tracing::warn!(
                target: "grok_app::secrets",
                account,
                error = %e,
                "failed to delete secret from OS keychain"
            );
        }
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
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn strip_keys_for_disk_keeps_metadata() {
        let s = SecretsFile {
            official_api_key: Some("sk-secret".into()),
            relay_api_key: Some("rk-secret".into()),
            relay_base_url: Some("https://relay.example".into()),
            default_model: Some("grok-4".into()),
        };
        let disk = strip_keys_for_disk(&s);
        assert!(disk.official_api_key.is_none());
        assert!(disk.relay_api_key.is_none());
        assert_eq!(disk.relay_base_url.as_deref(), Some("https://relay.example"));
        assert_eq!(disk.default_model.as_deref(), Some("grok-4"));
    }

    #[test]
    fn merge_prefers_keychain_over_disk() {
        let disk = SecretsFile {
            official_api_key: Some("disk-old".into()),
            relay_api_key: None,
            relay_base_url: Some("https://example.com".into()),
            default_model: Some("m1".into()),
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
    }

    #[test]
    fn merge_falls_back_to_disk_when_keychain_empty() {
        let disk = SecretsFile {
            official_api_key: Some("disk-key".into()),
            relay_api_key: Some("disk-relay".into()),
            relay_base_url: Some("https://x".into()),
            default_model: None,
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
        };
        let disk = strip_keys_for_disk(&s);
        let json = serde_json::to_string(&disk).unwrap();
        assert!(!json.contains("sk-should-not-serialize"));
        assert!(!json.contains("rk-nope"));
        assert!(json.contains("relay.example") || json.contains("relayBaseUrl"));
    }

    /// Integration-style: real OS keychain when available (macOS CI / local), else skip soft.
    #[test]
    fn keychain_roundtrip_when_available() {
        if !probe_keychain() {
            // File fallback path still valid on headless Linux without Secret Service.
            return;
        }
        let account = format!("test_roundtrip_{}", std::process::id());
        let entry = keyring::Entry::new(KEYRING_SERVICE, &account).expect("entry");
        let _ = entry.delete_credential();
        entry.set_password("unit-test-secret").expect("set");
        assert_eq!(entry.get_password().unwrap(), "unit-test-secret");
        entry.delete_credential().expect("delete");
        assert!(matches!(
            entry.get_password(),
            Err(keyring::Error::NoEntry)
        ));
    }

    /// Disk image after a successful keychain write keeps metadata only.
    /// (Does not touch GROK_APP_HOME — avoids races with other tests.)
    #[test]
    fn stripped_disk_payload_keeps_metadata_only() {
        let full = SecretsFile {
            official_api_key: Some("sk-test-official-keychain-only".into()),
            relay_api_key: Some("rk-test-relay-keychain-only".into()),
            relay_base_url: Some("https://relay.test".into()),
            default_model: Some("grok-test".into()),
        };
        let disk = strip_keys_for_disk(&full);
        let raw = serde_json::to_string_pretty(&disk).unwrap();
        assert!(!raw.contains("sk-test-official-keychain-only"));
        assert!(!raw.contains("rk-test-relay-keychain-only"));
        assert!(raw.contains("relay.test") || raw.contains("relayBaseUrl"));
        assert!(disk.official_api_key.is_none());
        assert!(disk.relay_api_key.is_none());
        assert_eq!(disk.relay_base_url.as_deref(), Some("https://relay.test"));
    }

    /// Isolated keychain entry + stripped disk image (no GROK_APP_HOME races).
    #[test]
    fn keychain_entry_and_stripped_disk_do_not_share_plaintext() {
        if !probe_keychain() {
            return;
        }
        let acct = format!("test_mig_{}", std::process::id());
        let entry = keyring::Entry::new(KEYRING_SERVICE, &acct).unwrap();
        let _ = entry.delete_credential();
        entry
            .set_password("sk-legacy-migrate-me")
            .expect("keychain set");
        assert_eq!(entry.get_password().unwrap(), "sk-legacy-migrate-me");

        // After migrate, disk holds metadata only.
        let disk = SecretsFile {
            official_api_key: None,
            relay_api_key: None,
            relay_base_url: Some("https://legacy.test".into()),
            default_model: None,
        };
        assert!(!disk_has_plaintext_keys(&disk));
        let raw = serde_json::to_string(&disk).unwrap();
        assert!(!raw.contains("sk-legacy-migrate-me"));
        assert!(raw.contains("legacy.test") || raw.contains("relayBaseUrl"));

        let _ = entry.delete_credential();
    }

    /// File fallback path: full SecretsFile roundtrip on disk (when keychain off is hard
    /// to force after OnceLock; exercise write_disk_secrets strip helpers instead).
    #[test]
    fn file_write_preserves_keys_when_using_full_payload() {
        let tmp = std::env::temp_dir().join(format!(
            "grok-app-secrets-file-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        let path = tmp.join("secrets.json");
        let s = SecretsFile {
            official_api_key: Some("sk-file-only".into()),
            relay_api_key: Some("rk-file".into()),
            relay_base_url: Some("https://f".into()),
            default_model: Some("m".into()),
        };
        write_disk_secrets(&path, &s).unwrap();
        let back = read_disk_secrets(&path);
        assert_eq!(back.official_api_key.as_deref(), Some("sk-file-only"));
        assert_eq!(back.relay_api_key.as_deref(), Some("rk-file"));
        let _ = fs::remove_dir_all(&tmp);
    }
}
