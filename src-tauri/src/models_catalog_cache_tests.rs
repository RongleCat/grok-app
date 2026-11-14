use super::*;

struct CacheFiles(PathBuf);

impl CacheFiles {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!(
            "grok-models-freshness-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        Self(dir)
    }

    fn write(&self, name: &str, content: serde_json::Value) -> PathBuf {
        let path = self.0.join(name);
        fs::write(&path, serde_json::to_vec(&content).unwrap()).unwrap();
        path
    }
}

impl Drop for CacheFiles {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn snapshot(time: Option<&str>, models: serde_json::Value) -> serde_json::Value {
    serde_json::json!({"fetched_at": time, "origin": time, "models": models})
}

fn ids(result: &AvailableModelsResult) -> Vec<&str> {
    result.models.iter().map(|m| m.id.as_str()).collect()
}

#[test]
fn newest_snapshot_wins_in_either_home_order_and_keeps_its_metadata() {
    let files = CacheFiles::new();
    let old = files.write(
        "agent-home.json",
        snapshot(
            Some("2026-10-01T00:00:00Z"),
            serde_json::json!({
                "grok-4.5": {"info": {"name": "old", "context_window": 128000}}
            }),
        ),
    );
    let new = files.write(
        "terminal-home.json",
        snapshot(
            Some("2026-11-01T00:00:00Z"),
            serde_json::json!({
                "grok-4.5": {"info": {"name": "fresh", "context_window": 256000}},
                "grok-4.7": {"info": {"name": "Grok 4.7", "context_window": 500000}}
            }),
        ),
    );
    for paths in [[old.clone(), new.clone()], [new.clone(), old.clone()]] {
        let result = list_available_models_from_caches(&paths, None);
        assert_eq!(ids(&result), ["grok-4.5", "grok-4.7"]);
        assert_eq!(result.origin.as_deref(), Some("2026-11-01T00:00:00Z"));
        assert_eq!(result.fetched_at.as_deref(), result.origin.as_deref());
        assert_eq!(result.models[0].label, "fresh");
        assert_eq!(result.models[0].context_window, Some(256000));
        assert_eq!(result.default_model_id, "grok-4.7");
        assert!(result.models[1].is_default);
        let saved = list_available_models_from_caches(&paths, Some("grok-4.5"));
        assert_eq!(saved.default_model_id, "grok-4.5");
        assert!(saved.models[0].is_default);
    }
}

#[test]
fn newer_catalog_does_not_resurrect_hidden_or_removed_models() {
    let files = CacheFiles::new();
    let old = files.write(
        "old",
        snapshot(
            Some("2026-10-01T00:00:00Z"),
            serde_json::json!({"grok-4.5": {}, "grok-4.6": {}, "grok-4.7": {}}),
        ),
    );
    let new = files.write(
        "new",
        snapshot(
            Some("2026-11-01T00:00:00Z"),
            serde_json::json!({"grok-4.7": {"info": {"hidden": true}}, "grok-4.6": {}}),
        ),
    );
    let result = list_available_models_from_caches(&[old, new], Some("grok-4.7"));
    assert_eq!(ids(&result), ["grok-4.6"]);
    assert_eq!(result.default_model_id, "grok-4.6");
    assert!(result.models[0].is_default);
}

#[test]
fn latest_all_hidden_snapshot_stays_empty_instead_of_using_old_or_static_models() {
    let files = CacheFiles::new();
    let old = files.write(
        "old",
        snapshot(
            Some("2026-10-01T00:00:00Z"),
            serde_json::json!({"grok-4.5": {}}),
        ),
    );
    let new = files.write(
        "new",
        snapshot(
            Some("2026-11-01T00:00:00Z"),
            serde_json::json!({"grok-4.7": {"info": {"hidden": true}}}),
        ),
    );
    assert!(list_available_models_from_caches(&[old, new], None)
        .models
        .is_empty());
}

#[test]
fn missing_and_invalid_times_keep_path_priority_but_valid_times_win() {
    let files = CacheFiles::new();
    let missing = files.write(
        "missing",
        snapshot(None, serde_json::json!({"grok-4.5": {}})),
    );
    let invalid = files.write(
        "invalid",
        snapshot(Some("not a date"), serde_json::json!({"grok-4.6": {}})),
    );
    let valid = files.write(
        "valid",
        snapshot(
            Some("2026-11-01T00:00:00Z"),
            serde_json::json!({"grok-4.7": {}}),
        ),
    );
    assert_eq!(
        ids(&list_available_models_from_caches(
            &[missing.clone(), invalid.clone()],
            None
        )),
        ["grok-4.5"]
    );
    assert_eq!(
        ids(&list_available_models_from_caches(
            &[invalid.clone(), missing.clone()],
            None
        )),
        ["grok-4.6"]
    );
    for paths in [[invalid, valid.clone()], [valid.clone(), missing]] {
        assert_eq!(
            ids(&list_available_models_from_caches(&paths, None)),
            ["grok-4.7"]
        );
    }
}

#[test]
fn timestamps_compare_instants_and_equal_instants_keep_path_priority() {
    let files = CacheFiles::new();
    let first = files.write(
        "first",
        snapshot(
            Some("2026-11-01T01:00:00+01:00"),
            serde_json::json!({"grok-4.5": {}}),
        ),
    );
    let equal = files.write(
        "equal",
        snapshot(
            Some("2026-11-01T00:00:00Z"),
            serde_json::json!({"grok-4.6": {}}),
        ),
    );
    let later = files.write(
        "later",
        snapshot(
            Some("2026-11-01T00:30:00Z"),
            serde_json::json!({"grok-4.7": {}}),
        ),
    );
    assert_eq!(
        ids(&list_available_models_from_caches(
            &[first.clone(), equal],
            None
        )),
        ["grok-4.5"]
    );
    assert_eq!(
        ids(&list_available_models_from_caches(&[first, later], None)),
        ["grok-4.7"]
    );
}

#[test]
fn missing_corrupt_and_empty_caches_fall_back_without_mixing_metadata() {
    let files = CacheFiles::new();
    let empty = files.write(
        "empty",
        snapshot(Some("2026-12-01T00:00:00Z"), serde_json::json!({})),
    );
    let corrupt = files.0.join("corrupt");
    fs::write(&corrupt, "{").unwrap();
    let paths = [files.0.join("absent"), empty, corrupt];
    let fallback = list_available_models_from_caches(&paths, None);
    assert_eq!(fallback.models.len(), 4);
    assert!(fallback.origin.is_none());
    assert!(fallback.fetched_at.is_none());
    let good = files.write(
        "good",
        snapshot(
            Some("2026-11-01T00:00:00Z"),
            serde_json::json!({"grok-4.7": {}}),
        ),
    );
    let result = list_available_models_from_caches(&[paths.to_vec(), vec![good]].concat(), None);
    assert_eq!(ids(&result), ["grok-4.7"]);
    assert_eq!(result.origin.as_deref(), Some("2026-11-01T00:00:00Z"));
}

#[test]
fn newer_corrupt_model_entries_do_not_mask_an_older_usable_snapshot() {
    let files = CacheFiles::new();
    let good = files.write(
        "good",
        snapshot(
            Some("2026-11-01T00:00:00Z"),
            serde_json::json!({"grok-4.7": {"info": {"name": "Grok 4.7"}}}),
        ),
    );
    let corrupt = files.write("corrupt-entries", snapshot(Some("2026-12-01T00:00:00Z"),
        serde_json::json!({"null-model": null, "string-model": "bad", "array-model": [], "bad-info": {"info": false}})));
    for paths in [[corrupt.clone(), good.clone()], [good, corrupt]] {
        let result = list_available_models_from_caches(&paths, None);
        assert_eq!(ids(&result), ["grok-4.7"]);
        assert_eq!(result.fetched_at.as_deref(), Some("2026-11-01T00:00:00Z"));
    }
}
