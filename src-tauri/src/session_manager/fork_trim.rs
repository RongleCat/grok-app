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
}
