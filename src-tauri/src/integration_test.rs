//! Integration-style tests on shipped Host helpers (no GUI).
//! Covers probe + project store + independent data root — the path the UI uses.

#[cfg(test)]
mod integration {
    use crate::cli_probe::{cli_auth_json_present, probe_cli};
    use crate::paths::{app_data_root, ensure_app_dirs};
    use crate::store::{
        add_project, load_projects, load_settings, relocate_project, remove_project, save_settings,
        trust_project, AppSettings,
    };
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_dir() -> std::path::PathBuf {
        let n = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("grok-app-itest-{n}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn probe_cli_shape_and_local_install() {
        let r = probe_cli(None);
        assert!(
            !r.candidates_tried.is_empty(),
            "should try common paths"
        );
        // Auth flag always populated
        let _ = r.cli_auth_present;
        if std::path::Path::new(&format!(
            "{}/.grok/bin/grok",
            std::env::var("HOME").unwrap_or_default()
        ))
        .is_file()
            || which::which("grok").is_ok()
        {
            assert!(r.found);
            assert!(r.path.is_some());
            assert!(r.version.is_some());
        }
    }

    #[test]
    fn project_add_trust_remove_roundtrip() {
        let dir = unique_dir();
        let path = dir.display().to_string();
        let p = add_project(path.clone(), false).expect("add");
        assert!(!p.trusted);
        assert_eq!(p.path, path);
        assert!(p.path_ok);
        let trusted = trust_project(&p.id).expect("trust");
        assert!(trusted.trusted);
        let list = load_projects();
        assert!(list.iter().any(|x| x.id == p.id && x.trusted));
        remove_project(&p.id).expect("remove");
        let list2 = load_projects();
        assert!(!list2.iter().any(|x| x.id == p.id));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn project_relocate_updates_path_and_path_ok() {
        let old_dir = unique_dir();
        let new_dir = unique_dir();
        let old_path = old_dir.display().to_string();
        let new_path = new_dir.display().to_string();
        let p = add_project(old_path.clone(), true).expect("add");
        assert_eq!(p.path, old_path);
        assert!(p.path_ok);

        // Simulate deleted folder: list re-check marks path_ok false.
        let _ = fs::remove_dir_all(&old_dir);
        let listed = load_projects();
        let stale = listed.iter().find(|x| x.id == p.id).expect("still listed");
        assert!(!stale.path_ok);

        let moved = relocate_project(&p.id, new_path.clone()).expect("relocate");
        assert_eq!(moved.path, new_path);
        assert!(moved.path_ok);

        let listed2 = load_projects();
        let again = listed2.iter().find(|x| x.id == p.id).expect("listed");
        assert_eq!(again.path, new_path);
        assert!(again.path_ok);

        assert!(relocate_project(&p.id, "/no/such/dir-xyz".into()).is_err());
        remove_project(&p.id).expect("remove");
        let _ = fs::remove_dir_all(&new_dir);
    }

    #[test]
    fn settings_default_factory_and_disk_roundtrip() {
        let _ = ensure_app_dirs();
        // Factory defaults (not necessarily what's already on disk)
        let factory = AppSettings::default();
        assert_eq!(factory.session_data_mode, "independent");
        assert_eq!(factory.permission_policy, "ask");
        // Disk load + save same content must not corrupt
        let s = load_settings();
        save_settings(&s).expect("save");
        let s2 = load_settings();
        assert_eq!(s2.session_data_mode, s.session_data_mode);
        assert_eq!(s2.permission_policy, s.permission_policy);
        let root = app_data_root();
        assert!(!root.as_os_str().is_empty());
    }

    #[test]
    fn cli_auth_detection_is_boolean() {
        // Just ensure helper runs; value depends on machine
        let _ = cli_auth_json_present();
    }
}
