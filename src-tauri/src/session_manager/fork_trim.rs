//! Policy for trimming a forked child agent so its memory matches a cut journal.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChildTrimPlan {
    /// Full fork or journal-only: nothing to rewind.
    Skip,
    /// session/fork returned resumed=true and a cut index is armed.
    RewindChild { prompt_index: u32 },
    /// Fork fell through to session/new; journal already truncated → bootstrap.
    Bootstrap,
}

pub fn child_trim_plan(rewind_index: Option<u32>, open_resumed: bool) -> ChildTrimPlan {
    match rewind_index {
        Some(prompt_index) if open_resumed => ChildTrimPlan::RewindChild { prompt_index },
        Some(_) => ChildTrimPlan::Bootstrap,
        None => ChildTrimPlan::Skip,
    }
}

/// Result of the rewind-fail journal fail-safe.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ChildRewindFailSafe {
    pub before_len: usize,
    pub after_len: usize,
    pub persisted: bool,
    pub need_bootstrap: bool,
}

/// After a successful re-cut, bootstrap the truncated journal into session/new.
/// Callers skip bootstrap only when the helper itself fails.
pub fn need_bootstrap_after_rewind_fail(after_len: usize) -> bool {
    after_len > 0
}

/// Re-cut an inflated child journal after rewind fails, then decide bootstrap.
pub fn apply_child_rewind_fail_safe(
    session_id: &str,
    through_user_prompt_index: u32,
) -> Result<ChildRewindFailSafe, String> {
    let (before_len, after_len, persisted) =
        crate::store::retruncate_child_journal_to_cut(session_id, through_user_prompt_index)?;
    Ok(ChildRewindFailSafe {
        before_len,
        after_len,
        persisted,
        need_bootstrap: need_bootstrap_after_rewind_fail(after_len),
    })
}

/// After a failed child rewind, do not keep the untrimmed forked agent id.
#[cfg(test)]
pub fn child_trim_after_rewind_error(rewind_ok: bool) -> ChildTrimPlan {
    if rewind_ok {
        ChildTrimPlan::Skip
    } else {
        ChildTrimPlan::Bootstrap
    }
}

/// Host `session://fork_trimmed` outcome. `None` means do not emit (uncut fork).
pub fn fork_trimmed_outcome(plan: ChildTrimPlan, rewind_ok: Option<bool>) -> Option<&'static str> {
    match plan {
        ChildTrimPlan::Skip => None,
        ChildTrimPlan::Bootstrap => Some("bootstrap"),
        ChildTrimPlan::RewindChild { .. } => match rewind_ok {
            Some(true) => Some("rewound"),
            _ => Some("bootstrap"),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::{
        create_session, fork_session, load_messages, replace_messages, save_messages,
        update_session_meta, ChatMessageStored,
    };
    use chrono::Utc;
    use std::fs;
    use uuid::Uuid;

    #[test]
    fn trim_plan_rewinds_only_resumed_partial() {
        assert_eq!(
            child_trim_plan(Some(2), true),
            ChildTrimPlan::RewindChild { prompt_index: 2 }
        );
        assert_eq!(child_trim_plan(Some(2), false), ChildTrimPlan::Bootstrap);
        assert_eq!(child_trim_plan(None, true), ChildTrimPlan::Skip);
        assert_eq!(child_trim_plan(None, false), ChildTrimPlan::Skip);
    }

    #[test]
    fn rewind_error_forces_bootstrap() {
        assert_eq!(child_trim_after_rewind_error(true), ChildTrimPlan::Skip);
        assert_eq!(
            child_trim_after_rewind_error(false),
            ChildTrimPlan::Bootstrap
        );
    }

    #[test]
    fn cut_journal_bootstraps_after_rewind_fail() {
        assert!(need_bootstrap_after_rewind_fail(10));
        assert!(!need_bootstrap_after_rewind_fail(0));
    }

    #[test]
    fn trimmed_outcome_is_silent_on_uncut_and_honest_on_bootstrap() {
        assert_eq!(fork_trimmed_outcome(ChildTrimPlan::Skip, None), None);
        assert_eq!(
            fork_trimmed_outcome(ChildTrimPlan::Bootstrap, None),
            Some("bootstrap")
        );
        assert_eq!(
            fork_trimmed_outcome(ChildTrimPlan::RewindChild { prompt_index: 0 }, Some(true)),
            Some("rewound")
        );
        assert_eq!(
            fork_trimmed_outcome(ChildTrimPlan::RewindChild { prompt_index: 0 }, Some(false)),
            Some("bootstrap")
        );
        assert_eq!(
            fork_trimmed_outcome(ChildTrimPlan::RewindChild { prompt_index: 0 }, None),
            Some("bootstrap")
        );
    }

    fn stored_msg(id: &str, role: &str, content: &str) -> ChatMessageStored {
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

    #[test]
    fn rewind_fail_inflated_child_bootstraps_cut_and_keeps_ten_turns() {
        let _g = crate::paths::APP_HOME_ENV_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let tmp = std::env::temp_dir().join(format!(
            "grok-app-rewind-fail-safe-{}-{}",
            std::process::id(),
            Uuid::new_v4()
        ));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).expect("tmp home");
        std::env::set_var("GROK_APP_HOME", &tmp);
        let _ = crate::paths::ensure_app_dirs();

        let mut src = create_session(None, Some("src".into()), false).expect("create");
        src.agent_session_id = Some("agent-parent".into());
        update_session_meta(&src).expect("meta");
        let parent_msgs: Vec<_> = (1u32..=8)
            .flat_map(|i| {
                [
                    stored_msg(&format!("u{i}"), "user", &format!("q{i}")),
                    stored_msg(&format!("a{i}"), "assistant", &format!("a{i}")),
                ]
            })
            .collect();
        save_messages(&src.id, &parent_msgs).expect("msgs");
        let child = fork_session(&src.id, Some(4), None, true).expect("partial");
        replace_messages(&child.id, &parent_msgs).expect("inflate");
        assert_eq!(load_messages(&child.id).len(), 16);

        let fs = apply_child_rewind_fail_safe(&child.id, 4).expect("fail-safe");
        assert_eq!(fs.before_len, 16);
        assert_eq!(fs.after_len, 10);
        assert!(fs.persisted);
        assert!(
            fs.need_bootstrap,
            "cut journal must bootstrap after rewind fail"
        );
        let kept = load_messages(&child.id);
        assert_eq!(kept.len(), 10);
        assert_eq!(kept.last().map(|m| m.content.as_str()), Some("a5"));

        std::env::remove_var("GROK_APP_HOME");
        let _ = fs::remove_dir_all(&tmp);
    }
}
