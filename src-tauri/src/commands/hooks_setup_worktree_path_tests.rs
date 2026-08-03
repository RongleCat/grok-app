mod worktree_path_tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn layout_defaults_to_cli() {
        assert_eq!(normalize_worktree_layout(None), "cli");
        assert_eq!(normalize_worktree_layout(Some("")), "cli");
        assert_eq!(normalize_worktree_layout(Some("CLI")), "cli");
        assert_eq!(normalize_worktree_layout(Some("sibling")), "sibling");
    }

    #[test]
    fn sibling_path_next_to_main() {
        assert_eq!(
            build_worktree_sibling_path("/Users/me/repo", "feat").unwrap(),
            "/Users/me/repo-feat"
        );
    }

    #[test]
    fn cli_path_under_grok_worktrees() {
        let home = Path::new("/Users/me/.grok");
        assert_eq!(
            build_worktree_cli_path("/Users/me/Code/oss-grok-app", "feat", home).unwrap(),
            "/Users/me/.grok/worktrees/oss-grok-app/feat"
        );
        assert_eq!(
            worktree_repo_slug("/Users/me/Code/oss-grok-app").unwrap(),
            "oss-grok-app"
        );
    }

    #[test]
    fn sanitize_ref_rejects_flags() {
        assert!(sanitize_worktree_ref(Some("-b")).is_err());
        assert_eq!(
            sanitize_worktree_ref(Some("  origin/main  ")).unwrap().as_deref(),
            Some("origin/main")
        );
        assert_eq!(sanitize_worktree_ref(None).unwrap(), None);
    }
}
