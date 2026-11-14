use super::*;

fn reconcile_test_message(id: &str, role: &str, content: &str) -> ChatMessageStored {
    ChatMessageStored {
        id: id.into(),
        role: role.into(),
        content: content.into(),
        thought: None,
        created_at: Utc::now(),
        is_error: false,
        attachments: None,
        marker: None,
    }
}

fn reconcile_test_rows(rows: &[(&str, &str)]) -> Vec<(String, String, Option<String>)> {
    rows.iter()
        .map(|(role, body)| (role.to_string(), body.to_string(), None))
        .collect()
}

#[test]
fn reconcile_disk_history_after_rewind_preserves_new_answer() {
    reconcile_disk_rewind_scenario(false, false);
}

#[test]
fn reconcile_disk_rewind_same_prompt_blocks_old_answer_and_tools_after_restart() {
    reconcile_disk_rewind_scenario(true, false);
}

#[test]
fn reconcile_disk_rewind_corrupt_history_fails_closed() {
    reconcile_disk_rewind_scenario(true, true);
}

fn reconcile_disk_rewind_scenario(same_prompt: bool, corrupt_history: bool) {
    let _guard = crate::paths::APP_HOME_ENV_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let app_home = std::env::temp_dir().join(format!("grok-rewind-test-{}", Uuid::new_v4()));
    fs::create_dir_all(&app_home).unwrap();
    std::env::set_var("GROK_APP_HOME", &app_home);
    crate::paths::ensure_app_dirs().unwrap();
    let agent_id = "rewind-reconcile-disk";
    let dir = crate::paths::agent_home_dir()
        .join("sessions")
        .join("rewind-fixture")
        .join(agent_id);
    fs::create_dir_all(&dir).unwrap();
    let mut session = store::create_session(None, Some("rewind regression".into()), false).unwrap();
    session.agent_session_id = Some(agent_id.into());
    store::update_session_meta(&session).unwrap();
    let mut settings = store::load_settings();
    settings.session_data_mode = "independent".into();
    store::save_settings(&settings).unwrap();
    let old = vec![
        reconcile_test_message("u1", "user", "keep"),
        reconcile_test_message("a1", "assistant", "kept answer"),
        reconcile_test_message("u2", "user", "removed"),
        reconcile_test_message("a2", "assistant", "obsolete answer"),
    ];
    let stale_history = old.iter()
        .map(|m| serde_json::json!({"type":m.role,"content":m.content}).to_string())
        .chain(std::iter::once(serde_json::json!({"type":"tool_result","content":"old tool output","tool_call_id":"old-tool"}).to_string()))
        .collect::<Vec<_>>().join("\n");
    fs::write(
        dir.join("chat_history.jsonl"),
        if corrupt_history {
            "invalid json"
        } else {
            &stale_history
        },
    )
    .unwrap();
    store::replace_messages(&session.id, &old).unwrap();
    let kept = store::truncate_through_user_prompt(&old, 0).unwrap();
    let fence = rewind_fence::RewindFence::capture(&session.id, 1);
    fence.replace_journal(&session.id, &kept).unwrap();
    // Repeated rewind unions the same exclusions and remains idempotent.
    rewind_fence::RewindFence::capture(&session.id, 1)
        .replace_journal(&session.id, &kept)
        .unwrap();
    store::append_message(
        &session.id,
        reconcile_test_message(
            "new-u",
            "user",
            if same_prompt {
                "removed"
            } else {
                "replacement"
            },
        ),
    )
    .unwrap();
    store::append_message(
        &session.id,
        reconcile_test_message("new-a", "assistant", "fresh answer"),
    )
    .unwrap();
    // Disk flush becomes valid again after capture; fence is loaded fresh
    // from disk by reconcile, as it would be after an App restart.
    fs::write(dir.join("chat_history.jsonl"), stale_history).unwrap();
    assert_eq!(
        reconcile_journal_from_chat_history(&session.id, agent_id, None, "independent").unwrap(),
        0
    );
    let after = store::load_messages(&session.id);
    assert_eq!(after.len(), 4);
    assert_eq!(after[3].content, "fresh answer");
    if !same_prompt && !corrupt_history {
        // A genuinely new branch still gets missing-answer recovery.
        store::replace_messages(&session.id, &after[..3]).unwrap();
        fs::write(dir.join("chat_history.jsonl"),
            "{\"type\":\"user\",\"content\":\"keep\"}\n{\"type\":\"assistant\",\"content\":\"kept answer\"}\n{\"type\":\"user\",\"content\":\"replacement\"}\n{\"type\":\"assistant\",\"content\":\"recovered fresh answer\"}\n"
        ).unwrap();
        assert_eq!(
            reconcile_journal_from_chat_history(&session.id, agent_id, None, "independent")
                .unwrap(),
            1
        );
        assert_eq!(
            store::load_messages(&session.id)[3].content,
            "recovered fresh answer"
        );
    }
    std::env::remove_var("GROK_APP_HOME");
    fs::remove_dir_all(&app_home).unwrap();
}

#[test]
fn reconcile_rejects_cut_turn_even_after_new_prompt_restores_user_count() {
    let mut journal = vec![
        reconcile_test_message("u1", "user", "keep"),
        reconcile_test_message("a1", "assistant", "kept answer"),
        reconcile_test_message("u-new", "user", "replacement"),
        reconcile_test_message("a-new", "assistant", "new answer"),
    ];
    let rows = reconcile_test_rows(&[
        ("user", "keep"),
        ("assistant", "kept answer"),
        ("user", "removed"),
        ("assistant", "obsolete answer"),
    ]);
    assert_eq!(
        reconcile_history_rows(
            &mut journal,
            &rows,
            &HashMap::new(),
            &rewind_fence::RewindFence::default()
        ),
        0
    );
    assert_eq!(journal.len(), 4);
    assert_eq!(journal[3].content, "new answer");
}

#[test]
fn reconcile_does_not_match_old_prompt_as_prefix_of_replacement() {
    let mut journal = vec![reconcile_test_message("new", "user", "do more")];
    let rows = reconcile_test_rows(&[("user", "do"), ("assistant", "obsolete")]);
    assert_eq!(
        reconcile_history_rows(
            &mut journal,
            &rows,
            &HashMap::new(),
            &rewind_fence::RewindFence::default()
        ),
        0
    );
    assert_eq!(journal.len(), 1);
}

#[test]
fn reconcile_inserts_answer_in_its_turn_and_does_not_extend_another_turn() {
    let mut journal = vec![
        reconcile_test_message("u1", "user", "first"),
        reconcile_test_message("a1", "assistant", "same"),
        reconcile_test_message("u2", "user", "second"),
        reconcile_test_message("u3", "user", "third"),
    ];
    let rows = reconcile_test_rows(&[
        ("user", "first"),
        ("assistant", "same"),
        ("user", "second"),
        ("assistant", "same extended"),
        ("user", "third"),
        ("assistant", "same"),
    ]);
    assert_eq!(
        reconcile_history_rows(
            &mut journal,
            &rows,
            &HashMap::new(),
            &rewind_fence::RewindFence::default()
        ),
        2
    );
    assert_eq!(
        journal
            .iter()
            .map(|m| m.content.as_str())
            .collect::<Vec<_>>(),
        vec!["first", "same", "second", "same extended", "third", "same"]
    );
    assert_eq!(
        reconcile_history_rows(
            &mut journal,
            &rows,
            &HashMap::new(),
            &rewind_fence::RewindFence::default()
        ),
        0
    );
}

#[test]
fn reconcile_accepts_bootstrapped_suffix_and_skips_stale_branch_tools() {
    let mut journal = vec![
        reconcile_test_message("u1", "user", "older bootstrap context"),
        reconcile_test_message("u2", "user", "current"),
    ];
    let mut rows = reconcile_test_rows(&[("user", "removed"), ("assistant", "stale")]);
    rows.push((
        "tool".into(),
        "stale output".into(),
        Some("stale-call".into()),
    ));
    rows.extend(reconcile_test_rows(&[
        ("user", "current"),
        ("assistant", "fresh"),
    ]));
    assert_eq!(
        reconcile_history_rows(
            &mut journal,
            &rows,
            &HashMap::new(),
            &rewind_fence::RewindFence::default()
        ),
        1
    );
    assert_eq!(journal.len(), 3);
    assert_eq!(journal[2].content, "fresh");
}
