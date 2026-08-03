//! Live **model** catalog from Grok CLI cache only.
//!
//! Providers / relays are **channels** managed on the Providers settings page —
//! they must never appear as selectable model chips.

use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::PathBuf;
use std::sync::{LazyLock, Mutex};

use serde::{Deserialize, Serialize};

use crate::paths::resolve_agent_grok_home;
use crate::store;

/// Live per-model context windows reported by the agent during `initialize`
/// (ClaudeCode `_meta.modelState.availableModels[].totalContextTokens`).
/// Merged on top of cache-derived windows at read time. Grok CLI does not
/// populate this yet (soft-fail → empty).
static LIVE_CONTEXT_WINDOWS: LazyLock<Mutex<BTreeMap<String, u64>>> =
    LazyLock::new(|| Mutex::new(BTreeMap::new()));

/// Merge live context windows discovered during `initialize`.
/// Called from `acp_client` after the handshake. Idempotent; latest wins.
pub fn merge_live_context_windows(windows: HashMap<String, u64>) {
    let mut guard = LIVE_CONTEXT_WINDOWS
        .lock()
        .expect("LIVE_CONTEXT_WINDOWS poisoned");
    for (id, tokens) in windows {
        guard.insert(id, tokens);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReasoningEffort {
    pub id: String,
    pub value: String,
    pub label: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableModel {
    pub id: String,
    pub label: String,
    /// Always "official" for catalog entries (providers are not models).
    pub source: String,
    #[serde(default)]
    pub is_default: bool,
    /// Per-model reasoning efforts from CLI `info.reasoning_efforts` (may be empty).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub reasoning_efforts: Vec<ReasoningEffort>,
    /// Model context window in tokens (live-merged from `initialize` first,
    /// then cache `info.totalContextTokens` / `info.context_window`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_window: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableModelsResult {
    pub models: Vec<AvailableModel>,
    pub default_model_id: String,
    pub origin: Option<String>,
    pub fetched_at: Option<String>,
}

struct ParsedCacheModel {
    label: String,
    reasoning_efforts: Vec<ReasoningEffort>,
    context_window: Option<u64>,
}

fn user_grok_home() -> PathBuf {
    crate::process_util::user_home().join(".grok")
}

/// Parse `/info/reasoning_efforts` from a models_cache entry body.
fn parse_reasoning_efforts(body: &serde_json::Value) -> Vec<ReasoningEffort> {
    let Some(arr) = body
        .pointer("/info/reasoning_efforts")
        .and_then(|x| x.as_array())
    else {
        return Vec::new();
    };
    arr.iter()
        .filter_map(|item| {
            let id = item.get("id")?.as_str()?.trim();
            if id.is_empty() {
                return None;
            }
            let value = item
                .get("value")
                .and_then(|x| x.as_str())
                .filter(|s| !s.is_empty())
                .unwrap_or(id)
                .to_string();
            let label = item
                .get("label")
                .and_then(|x| x.as_str())
                .filter(|s| !s.is_empty())
                .unwrap_or(id)
                .to_string();
            let description = item
                .get("description")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string();
            // CLI cache uses `"default": true`; host API exposes `isDefault`.
            let is_default = item
                .get("default")
                .and_then(|x| x.as_bool())
                .or_else(|| item.get("isDefault").and_then(|x| x.as_bool()))
                .or_else(|| item.get("is_default").and_then(|x| x.as_bool()))
                .unwrap_or(false);
            Some(ReasoningEffort {
                id: id.to_string(),
                value,
                label,
                description,
                is_default,
            })
        })
        .collect()
}

#[allow(clippy::type_complexity)]
fn read_models_cache(
    path: &PathBuf,
) -> Option<(
    BTreeMap<String, ParsedCacheModel>,
    Option<String>,
    Option<String>,
)> {
    let raw = fs::read_to_string(path).ok()?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let models_obj = v.get("models")?.as_object()?;
    let mut map = BTreeMap::new();
    for (id, body) in models_obj {
        if id.trim().is_empty() {
            continue;
        }
        let hidden = body
            .pointer("/info/hidden")
            .and_then(|x| x.as_bool())
            .unwrap_or(false);
        if hidden {
            continue;
        }
        // Skip entries that look like provider routes (have a custom base_url override
        // without being the official chat-proxy catalog shape). Official cache entries
        // expose info.model / info.name from cli-chat-proxy.
        let label = body
            .pointer("/info/name")
            .and_then(|x| x.as_str())
            .filter(|s| !s.is_empty())
            .unwrap_or(id)
            .to_string();
        let reasoning_efforts = parse_reasoning_efforts(body);
        let context_window = body
            .pointer("/info/totalContextTokens")
            .and_then(|v| v.as_u64())
            .or_else(|| {
                body.pointer("/info/context_window")
                    .and_then(|v| v.as_u64())
            });
        map.insert(
            id.clone(),
            ParsedCacheModel {
                label,
                reasoning_efforts,
                context_window,
            },
        );
    }
    let origin = v
        .get("origin")
        .and_then(|x| x.as_str())
        .map(|s| s.to_string());
    let fetched_at = v
        .get("fetched_at")
        .and_then(|x| x.as_str())
        .map(|s| s.to_string());
    Some((map, origin, fetched_at))
}

/// Models the user can select in the composer.
///
/// **Only** official Grok Build catalog IDs from `models_cache.json`.
/// Custom providers (`[model.*]` in config.toml) are channels — switch them under
/// Settings → Account → Providers, not here.
pub fn list_available_models() -> AvailableModelsResult {
    let settings = store::load_settings();
    let agent_home = resolve_agent_grok_home(&settings.session_data_mode);

    let mut by_id: BTreeMap<String, AvailableModel> = BTreeMap::new();
    let mut origin = None;
    let mut fetched_at = None;

    // Prefer agent-home cache (GROK_HOME for independent mode), then ~/.grok.
    // Do NOT merge agent config.toml [model.*] provider routes into this list.
    for cache in [
        agent_home.join("models_cache.json"),
        user_grok_home().join("models_cache.json"),
    ] {
        if let Some((map, o, f)) = read_models_cache(&cache) {
            if origin.is_none() {
                origin = o;
            }
            if fetched_at.is_none() {
                fetched_at = f;
            }
            for (id, parsed) in map {
                by_id.entry(id.clone()).or_insert(AvailableModel {
                    id,
                    label: parsed.label,
                    source: "official".into(),
                    is_default: false,
                    reasoning_efforts: parsed.reasoning_efforts,
                    context_window: parsed.context_window,
                });
            }
            if !by_id.is_empty() {
                break;
            }
        }
    }

    // Hard fallback — known-good official default when cache is empty / offline.
    if by_id.is_empty() {
        by_id.insert(
            "grok-4.5".into(),
            AvailableModel {
                id: "grok-4.5".into(),
                label: "Grok 4.5".into(),
                source: "official".into(),
                is_default: true,
                reasoning_efforts: Vec::new(),
                context_window: None,
            },
        );
    }

    // Overlay live windows discovered during `initialize` (ClaudeCode).
    // Live values win over cache-derived windows; absent entries stay as-is.
    {
        let live = LIVE_CONTEXT_WINDOWS
            .lock()
            .expect("LIVE_CONTEXT_WINDOWS poisoned");
        for (id, tokens) in live.iter() {
            if let Some(m) = by_id.get_mut(id) {
                m.context_window = Some(*tokens);
            }
        }
    }

    // Prefer catalog default over a stale settings.model_id that might be a
    // provider route id (e.g. "yunyi") from an older build.
    let preferred = by_id
        .keys()
        .find(|k| k.as_str() == "grok-4.5")
        .cloned()
        .or_else(|| settings.model_id.clone().filter(|s| by_id.contains_key(s)))
        .unwrap_or_else(|| {
            by_id
                .keys()
                .next()
                .cloned()
                .unwrap_or_else(|| "grok-4.5".into())
        });

    let mut models: Vec<AvailableModel> = by_id.into_values().collect();
    models.sort_by(|a, b| a.id.cmp(&b.id));
    for m in &mut models {
        m.is_default = m.id == preferred;
    }

    AvailableModelsResult {
        models,
        default_model_id: preferred,
        origin,
        fetched_at,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_cache_parses_official_entry() {
        let dir = std::env::temp_dir().join(format!("grok-app-models-test-{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        let path = dir.join("models_cache.json");
        fs::write(
            &path,
            r#"{
              "fetched_at": "2026-07-23T00:00:00Z",
              "origin": "https://cli-chat-proxy.grok.com/v1/models",
              "models": {
                "grok-4.5": {
                  "info": { "id": "grok-4.5", "name": "Grok 4.5", "hidden": false }
                }
              }
            }"#,
        )
        .unwrap();
        let (map, origin, _) = read_models_cache(&path).expect("cache");
        assert_eq!(
            map.get("grok-4.5").map(|m| m.label.as_str()),
            Some("Grok 4.5")
        );
        assert!(map
            .get("grok-4.5")
            .map(|m| m.reasoning_efforts.is_empty())
            .unwrap_or(false));
        assert!(origin.unwrap().contains("cli-chat-proxy"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn parse_reasoning_efforts_from_cache_pointer() {
        let body: serde_json::Value = serde_json::from_str(
            r#"{
              "info": {
                "reasoning_efforts": [
                  {
                    "id": "high",
                    "value": "high",
                    "label": "High Effort",
                    "description": "Highest quality",
                    "default": true
                  },
                  {
                    "id": "medium",
                    "value": "medium",
                    "label": "Medium Effort",
                    "description": "Balanced",
                    "default": false
                  },
                  {
                    "id": "low",
                    "value": "low",
                    "label": "Low Effort",
                    "description": "Quick",
                    "default": false
                  }
                ]
              }
            }"#,
        )
        .unwrap();
        let efforts = parse_reasoning_efforts(&body);
        assert_eq!(efforts.len(), 3);
        assert_eq!(efforts[0].id, "high");
        assert_eq!(efforts[0].value, "high");
        assert_eq!(efforts[0].label, "High Effort");
        assert_eq!(efforts[0].description, "Highest quality");
        assert!(efforts[0].is_default);
        assert!(!efforts[1].is_default);
        assert_eq!(efforts[2].id, "low");
    }

    #[test]
    fn parse_reasoning_efforts_skips_empty_id() {
        let body: serde_json::Value = serde_json::from_str(
            r#"{
              "info": {
                "reasoning_efforts": [
                  { "id": "", "value": "x", "label": "X" },
                  { "id": "medium", "label": "Med" }
                ]
              }
            }"#,
        )
        .unwrap();
        let efforts = parse_reasoning_efforts(&body);
        assert_eq!(efforts.len(), 1);
        assert_eq!(efforts[0].id, "medium");
        assert_eq!(efforts[0].value, "medium");
        assert_eq!(efforts[0].label, "Med");
    }

    #[test]
    fn read_cache_includes_reasoning_efforts() {
        let dir =
            std::env::temp_dir().join(format!("grok-app-models-efforts-{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        let path = dir.join("models_cache.json");
        fs::write(
            &path,
            r#"{
              "fetched_at": "2026-07-25T00:00:00Z",
              "origin": "https://cli-chat-proxy.grok.com/v1/models",
              "models": {
                "grok-4.5": {
                  "info": {
                    "id": "grok-4.5",
                    "name": "Grok 4.5",
                    "hidden": false,
                    "reasoning_efforts": [
                      {
                        "id": "high",
                        "value": "high",
                        "label": "High Effort",
                        "description": "Deep",
                        "default": true
                      }
                    ]
                  }
                }
              }
            }"#,
        )
        .unwrap();
        let (map, _, _) = read_models_cache(&path).expect("cache");
        let m = map.get("grok-4.5").expect("model");
        assert_eq!(m.reasoning_efforts.len(), 1);
        assert_eq!(m.reasoning_efforts[0].id, "high");
        assert!(m.reasoning_efforts[0].is_default);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_cache_parses_context_window_total_tokens() {
        let dir = std::env::temp_dir().join(format!(
            "grok-app-models-cw-total-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = fs::create_dir_all(&dir);
        let path = dir.join("models_cache.json");
        fs::write(
            &path,
            r#"{
              "models": {
                "grok-4.5": {
                  "info": { "name": "Grok 4.5", "totalContextTokens": 256000 }
                },
                "grok-4": {
                  "info": { "name": "Grok 4", "context_window": 128000 }
                },
                "grok-mini": {
                  "info": { "name": "Grok Mini" }
                }
              }
            }"#,
        )
        .unwrap();
        let (map, _, _) = read_models_cache(&path).expect("cache");
        assert_eq!(
            map.get("grok-4.5").and_then(|m| m.context_window),
            Some(256000)
        );
        assert_eq!(
            map.get("grok-4").and_then(|m| m.context_window),
            Some(128000)
        );
        assert_eq!(map.get("grok-mini").and_then(|m| m.context_window), None);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn merge_live_context_windows_inserts_without_panic() {
        // Use a unique id to avoid interfering with other tests / list_available_models.
        let unique = format!(
            "test-merge-live-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let mut windows = HashMap::new();
        windows.insert(unique.clone(), 999999);
        merge_live_context_windows(windows);

        let guard = LIVE_CONTEXT_WINDOWS.lock().expect("not poisoned");
        assert_eq!(guard.get(&unique), Some(&999999));
    }
}
