use super::*;

#[test]
fn reset_keeps_secrets_when_requested() {
    let _g = crate::paths::APP_HOME_ENV_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let tmp = std::env::temp_dir().join(format!(
        "grok-app-reset-test-{}-{}",
        std::process::id(),
        uuid::Uuid::new_v4()
    ));
    let _ = fs::remove_dir_all(&tmp);
    fs::create_dir_all(tmp.join("sessions")).unwrap();
    fs::write(tmp.join("sessions_index.json"), "[]").unwrap();
    fs::write(tmp.join("secrets.json"), r#"{"officialApiKey":"sk-test"}"#).unwrap();
    fs::write(tmp.join("settings.json"), "{}").unwrap();

    std::env::set_var("GROK_APP_HOME", &tmp);
    let result = reset_app_data(true).expect("reset");
    assert!(result["ok"].as_bool().unwrap());
    assert!(tmp.join("secrets.json").is_file());
    assert!(!tmp.join("sessions_index.json").is_file());
    assert!(tmp.join("sessions").is_dir()); // recreated empty
    std::env::remove_var("GROK_APP_HOME");
    let _ = fs::remove_dir_all(&tmp);
}

#[test]
fn reset_removes_skin_dirs_keeps_wallpaper_library() {
    let _g = crate::paths::APP_HOME_ENV_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let tmp = std::env::temp_dir().join(format!(
        "grok-app-reset-skin-{}-{}",
        std::process::id(),
        uuid::Uuid::new_v4()
    ));
    let _ = fs::remove_dir_all(&tmp);
    fs::create_dir_all(tmp.join("skin-presets").join("abc")).unwrap();
    fs::create_dir_all(tmp.join("skin-catalog-cache").join("official")).unwrap();
    fs::create_dir_all(tmp.join("wallpapers").join("library")).unwrap();
    fs::write(
        tmp.join("wallpapers").join("library").join("keep.jpg"),
        b"x",
    )
    .unwrap();
    std::env::set_var("GROK_APP_HOME", &tmp);
    let result = reset_app_data(true).expect("reset");
    assert!(result["ok"].as_bool().unwrap());
    assert!(!tmp.join("skin-presets").join("abc").exists());
    assert!(!tmp.join("skin-catalog-cache").join("official").exists());
    assert!(tmp
        .join("wallpapers")
        .join("library")
        .join("keep.jpg")
        .is_file());
    std::env::remove_var("GROK_APP_HOME");
    let _ = fs::remove_dir_all(&tmp);
}

#[test]
fn support_bundle_creates_zip_without_secrets() {
    let _g = crate::paths::APP_HOME_ENV_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let tmp = std::env::temp_dir().join(format!("grok-app-bundle-test-{}", std::process::id()));
    let _ = fs::remove_dir_all(&tmp);
    fs::create_dir_all(tmp.join("logs")).unwrap();
    fs::write(
        tmp.join("logs").join("app.log"),
        "hello sk-thisisalongfaketoken123456 and ok",
    )
    .unwrap();
    fs::write(tmp.join("settings.json"), r#"{"locale":"en"}"#).unwrap();
    fs::write(
        tmp.join("secrets.json"),
        r#"{"officialApiKey":"sk-secret"}"#,
    )
    .unwrap();

    std::env::set_var("GROK_APP_HOME", &tmp);
    let zip_path = write_support_bundle(r#"{"summary":{"ok":1}}"#, None).expect("bundle");
    assert!(zip_path.is_file());
    let bytes = fs::read(&zip_path).unwrap();
    // secrets.json must not appear as a zip entry name / content
    let as_str = String::from_utf8_lossy(&bytes);
    assert!(!as_str.contains("secrets.json"));
    assert!(!as_str.contains("sk-secret"));
    assert!(!as_str.contains("stall-timeline.json"));

    // meta.json always present with appVersion + cli probe object (honest empty ok).
    let file = fs::File::open(&zip_path).unwrap();
    let mut archive = zip::ZipArchive::new(file).expect("open zip");
    let mut meta_entry = archive.by_name("meta.json").expect("meta.json entry");
    let mut meta_body = String::new();
    meta_entry
        .read_to_string(&mut meta_body)
        .expect("read meta");
    assert!(
        meta_body.contains("appVersion"),
        "meta must include appVersion"
    );
    assert!(
        meta_body.contains("\"cli\""),
        "meta must include cli probe object: {meta_body}"
    );
    assert!(!meta_body.contains("sk-secret"));

    let _ = fs::remove_file(&zip_path);
    std::env::remove_var("GROK_APP_HOME");
    let _ = fs::remove_dir_all(&tmp);
}

#[test]
fn redact_text_scrubs_api_keys_from_doctor_payload() {
    // Prove support-bundle redaction path for doctor JSON (no secrets leak).
    let raw = r#"{"msg":"token sk-doctor-secret-value-long","ok":true}"#;
    let scrubbed = store::redact_text(raw);
    assert!(
        !scrubbed.contains("sk-doctor-secret-value-long"),
        "api key must be redacted: {scrubbed}"
    );
    assert!(scrubbed.contains("[REDACTED]") || !scrubbed.contains("sk-doctor"));
}

#[test]
fn support_bundle_includes_redacted_stall_timeline() {
    let _g = crate::paths::APP_HOME_ENV_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let tmp = std::env::temp_dir().join(format!("grok-app-bundle-stall-{}", std::process::id()));
    let _ = fs::remove_dir_all(&tmp);
    fs::create_dir_all(&tmp).unwrap();
    fs::write(tmp.join("settings.json"), r#"{"locale":"en"}"#).unwrap();
    // Present so redact_text can scrub known key material if it leaks into the snapshot.
    fs::write(
        tmp.join("secrets.json"),
        r#"{"officialApiKey":"sk-stall-secret-key-value"}"#,
    )
    .unwrap();

    std::env::set_var("GROK_APP_HOME", &tmp);
    let timeline = r#"{
  "kind": "stall_timeline",
  "source": "reliability_center",
  "count": 1,
  "signals": [{
"id": "evt:hard_end:s1:1",
"sessionId": "s1",
"title": "Long run",
"kind": "hard_end",
"stallSeconds": 90,
"tier": "hard",
"reason": "stall sk-stall-secret-key-value",
"at": 1
  }]
}"#;
    let zip_path = write_support_bundle(r#"{"summary":{"ok":1}}"#, Some(timeline)).expect("bundle");
    assert!(zip_path.is_file());
    let bytes = fs::read(&zip_path).unwrap();
    let as_str = String::from_utf8_lossy(&bytes);
    // Entry name lives in the central directory (uncompressed).
    assert!(as_str.contains("stall-timeline.json"));
    assert!(!as_str.contains("secrets.json"));

    // Deflated payload: open the archive and read the entry.
    let file = fs::File::open(&zip_path).unwrap();
    let mut archive = zip::ZipArchive::new(file).expect("open zip");
    let mut entry = archive
        .by_name("stall-timeline.json")
        .expect("stall-timeline entry");
    let mut body = String::new();
    entry.read_to_string(&mut body).expect("read timeline");
    assert!(body.contains("stall_timeline") || body.contains("hard_end"));
    assert!(body.contains("Long run"));
    assert!(
        !body.contains("sk-stall-secret-key-value"),
        "secret must be redacted from stall timeline: {body}"
    );
    assert!(body.contains("[REDACTED]") || !body.contains("sk-stall"));

    let _ = fs::remove_file(&zip_path);
    std::env::remove_var("GROK_APP_HOME");
    let _ = fs::remove_dir_all(&tmp);
}

#[test]
fn session_bundle_includes_messages_without_secrets() {
    let _g = crate::paths::APP_HOME_ENV_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let tmp = std::env::temp_dir().join(format!(
        "grok-app-session-bundle-test-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&tmp);
    fs::create_dir_all(tmp.join("sessions")).unwrap();
    fs::create_dir_all(tmp.join("logs")).unwrap();
    fs::write(
        tmp.join("settings.json"),
        r#"{"locale":"en","sessionDataMode":"independent"}"#,
    )
    .unwrap();
    fs::write(
        tmp.join("secrets.json"),
        r#"{"officialApiKey":"sk-session-secret-value"}"#,
    )
    .unwrap();
    fs::write(
        tmp.join("logs").join("app.log"),
        "log sk-session-secret-value end",
    )
    .unwrap();

    std::env::set_var("GROK_APP_HOME", &tmp);
    let session =
        store::create_session(None, Some("Export test".into()), false).expect("create session");
    store::append_message(
        &session.id,
        store::ChatMessageStored {
            id: "m1".into(),
            role: "user".into(),
            content: "hello with sk-session-secret-value".into(),
            thought: None,
            created_at: chrono::Utc::now(),
            is_error: false,
            attachments: None,
            marker: None,
        },
    )
    .expect("append");

    crate::turn_lease::begin_active(&session.id, Some("agent-1"), Some("turn-1"));
    fs::write(
        tmp.join("logs").join("host_runtime.json"),
        r#"{"schema":1,"pid":1,"startedAt":"t","heartbeatAt":"t","shutdown":false,"appVersion":"0","os":"test"}"#,
    )
    .unwrap();
    fs::write(tmp.join("logs").join("last_crash.txt"), "code=0xC0000005\n").unwrap();

    let zip_path = write_session_bundle(
        &session.id,
        Some(serde_json::json!({ "slot": "live", "state": "Ready" })),
    )
    .expect("session bundle");
    assert!(zip_path.is_file());
    let bytes = fs::read(&zip_path).unwrap();
    let as_str = String::from_utf8_lossy(&bytes);
    assert!(!as_str.contains("sk-session-secret-value"));
    assert!(!as_str.contains("secrets.json"));
    // Zip central directory should list expected entries
    assert!(as_str.contains("host/messages.json") || as_str.contains("messages.json"));
    assert!(as_str.contains("README.txt") || as_str.contains("meta.json"));
    assert!(
        as_str.contains("host/turn_lease.json"),
        "bundle must include turn lease"
    );
    assert!(
        as_str.contains("host_runtime.json") || as_str.contains("last_crash.txt"),
        "bundle must include host forensic logs"
    );
    let _ = fs::remove_file(&zip_path);
    std::env::remove_var("GROK_APP_HOME");
    let _ = fs::remove_dir_all(&tmp);
}
