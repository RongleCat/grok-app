mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::path::PathBuf;

    fn parse(text: &str) -> Vec<SshHostDto> {
        parse_ssh_config(text, Path::new("/tmp"), &|_| None)
    }

    #[test]
    fn alias_rejects_patterns_and_flags() {
        assert!(is_safe_ssh_alias("devbox"));
        assert!(is_safe_ssh_alias("gw-01"));
        assert!(is_safe_ssh_alias("a.b_c-1"));
        assert!(!is_safe_ssh_alias(""));
        assert!(!is_safe_ssh_alias("*"));
        assert!(!is_safe_ssh_alias("*.example.com"));
        assert!(!is_safe_ssh_alias("-o"));
        assert!(!is_safe_ssh_alias("host;rm"));
        assert!(!is_safe_ssh_alias("host alias"));
        assert!(!is_safe_ssh_alias(".."));
    }

    #[test]
    fn skip_local_acp_only_for_real_ssh_aliases() {
        assert!(should_skip_local_acp_spawn(Some("uts")));
        assert!(should_skip_local_acp_spawn(Some("  gw-01  ")));
        assert!(!should_skip_local_acp_spawn(None));
        assert!(!should_skip_local_acp_spawn(Some("")));
        assert!(!should_skip_local_acp_spawn(Some("   ")));
        assert!(!should_skip_local_acp_spawn(Some("*")));
        assert!(!should_skip_local_acp_spawn(Some("host;rm")));
    }

    #[test]
    fn pick_ssh_alias_prefers_explicit_then_bound_then_path() {
        assert_eq!(
            pick_ssh_alias(Some("UTS"), Some("other"), Some("path")),
            Some("UTS".into())
        );
        assert_eq!(
            pick_ssh_alias(Some("  "), Some("gw-01"), Some("UTS")),
            Some("gw-01".into())
        );
        assert_eq!(pick_ssh_alias(None, None, Some("UTS")), Some("UTS".into()));
        assert_eq!(pick_ssh_alias(Some("*"), Some("host;rm"), None), None);
        assert_eq!(pick_ssh_alias(None, None, None), None);
    }

    #[test]
    fn local_acp_cwd_ok_rejects_ssh_and_missing_dirs() {
        assert!(!local_acp_cwd_ok(Some("UTS"), "/tmp"));
        assert!(!local_acp_cwd_ok(
            None,
            "/this/path/does/not/exist/grok-app-ssh"
        ));
        assert!(!local_acp_cwd_ok(None, ""));
        let here = std::env::temp_dir();
        assert!(local_acp_cwd_ok(None, here.to_string_lossy().as_ref()));
    }

    #[test]
    fn acp_session_cwd_ok_skips_local_isdir_for_ssh() {
        assert!(acp_session_cwd_ok(
            Some("UTS"),
            "/data/pengqlu/code/2026-07-25-ICLR",
        ));
        assert!(!acp_session_cwd_ok(
            None,
            "/data/pengqlu/code/2026-07-25-ICLR",
        ));
        assert!(!acp_session_cwd_ok(Some("UTS"), ""));
        assert!(!acp_session_cwd_ok(Some("UTS"), "/tmp\0x"));
        let here = std::env::temp_dir();
        assert!(acp_session_cwd_ok(None, here.to_string_lossy().as_ref()));
    }

    #[test]
    fn listable_matches_grok_resume_not_raw_dirs() {
        assert!(remote_session_is_listable(
            None,
            "R-Lens幻觉读出RRQ资格审查与初筛证伪",
            true
        ));
        assert!(remote_session_is_listable(Some(""), "数学题", true));
        assert!(remote_session_is_listable(None, "", true));
        assert!(!remote_session_is_listable(None, "", false));
        assert!(!remote_session_is_listable(
            Some("subagent"),
            "Freeze Qwen",
            true
        ));
        assert!(!remote_session_is_listable(
            Some("subagent_resume"),
            "overnight inspect",
            true
        ));
        assert!(!remote_session_is_listable(Some("SUBAGENT"), "", true));
    }

    #[test]
    fn remote_sess_script_skips_subagent_and_empty_shells() {
        let s = remote_sess_script(0, 20);
        assert!(s.contains("session_kind"));
        assert!(s.contains("startswith(\"subagent\")"));
        assert!(s.contains("updates.jsonl"));
        assert!(s.contains("not has_up and not title"));
    }

    #[test]
    fn skips_glob_only_hosts() {
        let hosts = parse(
            r#"
Host *
  ServerAliveInterval 60
Host *.internal
  User nobody
"#,
        );
        assert!(hosts.is_empty());
    }

    #[test]
    fn parses_concrete_host() {
        let hosts = parse(
            r#"
# comment
Host devbox
  HostName 10.0.0.8
  User deploy
  Port 2222
  IdentityFile ~/.ssh/id_ed25519
Host *
  User ignoreme
"#,
        );
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].alias, "devbox");
        assert_eq!(hosts[0].hostname.as_deref(), Some("10.0.0.8"));
        assert_eq!(hosts[0].user.as_deref(), Some("deploy"));
        assert_eq!(hosts[0].port, Some(2222));
        assert_eq!(hosts[0].identity_file.as_deref(), Some("~/.ssh/id_ed25519"));
    }

    #[test]
    fn host_line_with_equals_and_quotes() {
        let hosts = parse(
            r#"
Host "build-server"
  HostName="box.example.com"
  User = 'ci'
"#,
        );
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].alias, "build-server");
        assert_eq!(hosts[0].hostname.as_deref(), Some("box.example.com"));
        assert_eq!(hosts[0].user.as_deref(), Some("ci"));
    }

    #[test]
    fn multiple_aliases_on_one_host_line() {
        let hosts = parse("Host alpha bravo\n  User me\n");
        assert_eq!(hosts.len(), 2);
        assert_eq!(hosts[0].alias, "alpha");
        assert_eq!(hosts[1].alias, "bravo");
        assert_eq!(hosts[0].user.as_deref(), Some("me"));
        assert_eq!(hosts[1].user.as_deref(), Some("me"));
    }

    #[test]
    fn first_hostname_wins_inside_block() {
        let hosts = parse("Host x\n  HostName one\n  HostName two\n");
        assert_eq!(hosts[0].hostname.as_deref(), Some("one"));
    }

    #[test]
    fn match_ends_host_block() {
        let hosts = parse("Host x\n  User a\nMatch host y\n  User b\nHost z\n  User c\n");
        assert_eq!(hosts.len(), 2);
        assert_eq!(hosts[0].alias, "x");
        assert_eq!(hosts[0].user.as_deref(), Some("a"));
        assert_eq!(hosts[1].alias, "z");
        assert_eq!(hosts[1].user.as_deref(), Some("c"));
    }

    #[test]
    fn include_via_reader() {
        let mut files: HashMap<PathBuf, String> = HashMap::new();
        files.insert(
            PathBuf::from("/tmp/extra"),
            "Host extra\n  HostName extra.example\n".into(),
        );
        let hosts = parse_ssh_config(
            "Include extra\nHost main\n  User me\n",
            Path::new("/tmp"),
            &|p| files.get(p).cloned(),
        );
        let aliases: Vec<_> = hosts.iter().map(|h| h.alias.as_str()).collect();
        assert!(aliases.contains(&"extra"));
        assert!(aliases.contains(&"main"));
    }

    #[test]
    fn duplicate_alias_keeps_first() {
        let hosts = parse("Host x\n  User a\nHost x\n  User b\n");
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].user.as_deref(), Some("a"));
    }

    #[test]
    fn comment_not_inside_quotes() {
        let hosts = parse("Host x\n  User \"a#b\"\n");
        assert_eq!(hosts[0].user.as_deref(), Some("a#b"));
    }

    #[test]
    fn probe_stdout_ok() {
        let raw =
            "noise\nGROK_APP_PROBE\nCLI_OK\nAUTH_OK\n/home/u/.grok/bin/grok\ngrok 1.0.5 (abc)\n";
        let p = parse_probe_stdout(raw).unwrap();
        assert_eq!(p.cli, "ok");
        assert_eq!(p.auth, "ok");
        assert_eq!(p.path.as_deref(), Some("/home/u/.grok/bin/grok"));
        assert_eq!(p.version.as_deref(), Some("grok 1.0.5 (abc)"));
    }

    #[test]
    fn probe_stdout_missing_cli() {
        let raw = "GROK_APP_PROBE\nCLI_MISSING\nAUTH_MISSING\n\n\n";
        let p = parse_probe_stdout(raw).unwrap();
        assert_eq!(p.cli, "missing");
        assert_eq!(p.auth, "missing");
        assert!(p.path.is_none());
    }

    #[test]
    fn probe_stdout_rejects_garbage() {
        assert!(parse_probe_stdout("hello").is_none());
        assert!(parse_probe_stdout("GROK_APP_PROBE\nNOPE\nAUTH_OK\n\n\n").is_none());
    }

    #[test]
    fn commands_quote_alias_as_argv_word() {
        let (install, login, ir, lr) = commands_for_alias("devbox");
        assert_eq!(
            install,
            "ssh devbox 'curl -fsSL https://x.ai/cli/install.sh | bash'"
        );
        assert_eq!(login, "ssh -t devbox 'grok login --device-auth'");
        assert_eq!(ir, INSTALL_REMOTE);
        assert_eq!(lr, LOGIN_REMOTE);
    }

    #[test]
    fn classify_host_key() {
        let (code, _) = classify_ssh_stderr("Host key verification failed.\n");
        assert_eq!(code, "host_key");
    }

    #[test]
    fn posix_single_quote_escapes() {
        assert_eq!(posix_single_quote("abc"), "'abc'");
        assert_eq!(posix_single_quote("a'b"), "'a'\\''b'");
    }

    #[test]
    fn percent_decode_cwd() {
        assert_eq!(percent_decode_path("%2Fhome%2Fme%2Fproj"), "/home/me/proj");
        assert_eq!(percent_decode_path("/plain"), "/plain");
    }

    #[test]
    fn join_remote_rel_rejects_escape() {
        assert_eq!(
            join_remote_rel("/data/pengqlu/code", "README.md").unwrap(),
            "/data/pengqlu/code/README.md"
        );
        assert_eq!(
            join_remote_rel("/data/pengqlu/code/", "docs/a.md").unwrap(),
            "/data/pengqlu/code/docs/a.md"
        );
        assert!(join_remote_rel("/data/pengqlu/code", "../etc/passwd").is_err());
        assert!(join_remote_rel("relative", "a.md").is_err());
    }

    #[test]
    fn parse_ls_stdout_ok_and_not_a_dir() {
        let ok = parse_ls_stdout("banner\nGROK_APP_LS\n/data/proj\nREADME.md\nsrc/\n");
        match ok {
            RemoteLsParse::Ok { path, entries } => {
                assert_eq!(path, "/data/proj");
                assert_eq!(entries.len(), 2);
                assert!(!entries[0].is_dir);
                assert!(entries[1].is_dir);
            }
            other => panic!("expected ok, got {other:?}"),
        }
        assert!(matches!(
            parse_ls_stdout("GROK_APP_LS_ERR\nnot_a_dir\n"),
            RemoteLsParse::NotADir
        ));
        assert!(matches!(
            parse_ls_stdout("GROK_APP_LS_ERR\ncd_fail\n"),
            RemoteLsParse::CdFail
        ));
        assert!(matches!(
            parse_ls_stdout("no marker here\n"),
            RemoteLsParse::Unparseable
        ));
    }

    #[test]
    fn parse_marked_json_reads_header_line() {
        let raw = "noise\nGROK_APP_READ\n{\"ok\":true,\"size\":4,\"text\":\"hi\"}\n";
        let v = parse_marked_json(raw, "GROK_APP_READ").unwrap();
        assert_eq!(v.get("ok").and_then(|x| x.as_bool()), Some(true));
        assert_eq!(v.get("text").and_then(|x| x.as_str()), Some("hi"));
    }

    #[test]
    fn remote_sess_script_embeds_page_bounds() {
        let s = remote_sess_script(20, 20);
        assert!(s.contains("OFFSET=20"));
        assert!(s.contains("LIMIT=20"));
        assert!(!s.contains("OFFSET={"));
    }

    #[test]
    fn parse_hist_stdout_splits_kind_and_body() {
        let raw = "GROK_APP_HIST\nKIND\tchat_history\n{\"type\":\"user\",\"content\":\"hi\"}\nGROK_APP_HIST_END\n";
        let h = parse_hist_stdout(raw).unwrap();
        assert_eq!(h.kind, "chat_history");
        assert!(h.body.contains("hi"));
        let pairs = pairs_from_hist(&h);
        assert_eq!(pairs.len(), 1);
        assert_eq!(pairs[0].1, "hi");
    }

    #[test]
    fn parse_hist_recovers_jsonl_emitted_before_markers() {
        // Repro: python print() + stdout.buffer.write() on a non-TTY SSH pipe.
        let raw = "{\"type\":\"user\",\"content\":\"<user_query>\\n标注任务\\n</user_query>\"}\n{\"type\":\"assistant\",\"content\":\"ok\"}\nGROK_APP_HIST\nKIND\tchat_history\nGROK_APP_HIST_END\n";
        let h = parse_hist_stdout(raw).unwrap();
        assert_eq!(h.kind, "chat_history");
        let pairs = pairs_from_hist(&h);
        assert_eq!(pairs.len(), 2);
        assert_eq!(pairs[0].1, "标注任务");
        assert_eq!(pairs[1].1, "ok");
    }

    #[test]
    fn looks_like_agent_uuid_matches_grok_ids() {
        assert!(looks_like_agent_uuid(
            "01a01907-adf3-7e00-a7a8-aee1082b0556"
        ));
        assert!(!looks_like_agent_uuid("帮我看一下 hallucination"));
    }

    #[test]
    fn parse_remote_sessions() {
        let raw =
            "noise\nGROK_APP_SESS\nTOTAL\t35\nid1\t%2Fwork\t171000\tFix bug\nid2\t%2Ftmp\t0\t\n";
        let (total, s) = parse_sess_stdout(raw).unwrap();
        assert_eq!(total, 35);
        assert_eq!(s.len(), 2);
        assert_eq!(s[0].cwd, "/work");
        assert_eq!(s[0].title, "Fix bug");
        assert!(s[0].updated_at.as_deref().unwrap_or("").contains("1970"));
        assert_eq!(s[1].title, "");
        assert_eq!(s[1].updated_at, None);
    }

    #[test]
    fn controlpath_with_spaces_is_quoted_for_ssh_o() {
        let path = "/Users/me/Library/Application Support/com.grokapp.grok-app/ssh-cm/UTS.sock";
        let a = ssh_config_assignment("ControlPath", path);
        assert_eq!(
            a,
            r#"ControlPath="/Users/me/Library/Application Support/com.grokapp.grok-app/ssh-cm/UTS.sock""#
        );
        assert!(!a.starts_with("ControlPath=/Users"));
    }

    #[test]
    fn simple_controlpath_stays_unquoted() {
        assert_eq!(
            ssh_config_assignment("ControlPath", "/tmp/grok-app-ssh-cm/UTS.sock"),
            "ControlPath=/tmp/grok-app-ssh-cm/UTS.sock"
        );
    }

    #[test]
    fn openssh_rejects_unquoted_controlpath_with_spaces() {
        let Some(ssh) = find_ssh_binary() else {
            return;
        };
        let null = if cfg!(windows) { "NUL" } else { "/dev/null" };
        let out = std::process::Command::new(ssh)
            .args([
                "-G",
                "-F",
                null,
                "-o",
                "ControlPath=/tmp/Application Support/x.sock",
                "-o",
                "BatchMode=yes",
                "127.0.0.1",
            ])
            .output()
            .expect("ssh -G");
        let stderr = String::from_utf8_lossy(&out.stderr).to_ascii_lowercase();
        assert!(
            stderr.contains("extra arguments"),
            "expected OpenSSH extra-arguments error, got: {stderr}"
        );
    }

    #[test]
    fn openssh_accepts_quoted_controlpath_with_spaces() {
        let Some(ssh) = find_ssh_binary() else {
            return;
        };
        let null = if cfg!(windows) { "NUL" } else { "/dev/null" };
        let path = "/tmp/Application Support/x.sock";
        let opt = ssh_config_assignment("ControlPath", path);
        let out = std::process::Command::new(ssh)
            .args([
                "-G",
                "-F",
                null,
                "-o",
                &opt,
                "-o",
                "BatchMode=yes",
                "127.0.0.1",
            ])
            .output()
            .expect("ssh -G");
        let stderr = String::from_utf8_lossy(&out.stderr).to_ascii_lowercase();
        assert!(
            !stderr.contains("extra arguments"),
            "quoted ControlPath still rejected: {stderr}"
        );
        assert!(out.status.success(), "ssh -G failed: {stderr}");
        let stdout = String::from_utf8_lossy(&out.stdout).to_ascii_lowercase();
        assert!(
            stdout.contains("controlpath"),
            "ssh -G did not echo controlpath"
        );
    }

    #[test]
    fn ssh_pty_remote_cmd_quotes_cwd() {
        let cmd = ssh_pty_remote_cmd(Some("/data/pengqlu/my proj"));
        assert!(cmd.contains(posix_single_quote("/data/pengqlu/my proj").as_str()));
        assert!(cmd.contains("exec ${SHELL:-bash} -l"));
        assert!(!cmd.contains("UTS"));
        assert_eq!(ssh_pty_remote_cmd(None), "exec ${SHELL:-bash} -l");
        assert_eq!(ssh_pty_remote_cmd(Some("  ")), "exec ${SHELL:-bash} -l");
    }

    #[test]
    fn ssh_pty_argv_keeps_alias_as_own_word() {
        let Some(_) = find_ssh_binary() else {
            return;
        };
        let argv = ssh_pty_argv("UTS", Some("/data/pengqlu/code")).expect("argv");
        assert!(argv[0].contains("ssh"));
        assert_eq!(argv[1], "-tt");
        assert!(argv.iter().any(|a| a == "UTS"));
        assert_eq!(
            argv.iter().any(|a| a.contains("ControlMaster=auto")),
            ssh_control_master_enabled()
        );
        let remote = argv.last().expect("remote cmd");
        assert!(remote.contains("/data/pengqlu/code"));
        assert!(remote.starts_with("exec /bin/sh -c "));
        assert!(!argv.iter().any(|a| a.contains("ssh UTS")));
        assert!(ssh_pty_argv("host;rm", None).is_err());
    }

    #[test]
    fn ssh_acp_remote_command_quotes_cwd_and_flags() {
        let script = ssh_acp_remote_command(
            "/data/pengqlu/my proj",
            &[
                "--no-auto-update".into(),
                "agent".into(),
                "--no-leader".into(),
                "stdio".into(),
            ],
        )
        .unwrap();
        assert!(script.contains(posix_single_quote("/data/pengqlu/my proj").as_str()));
        assert!(script.contains("'--no-auto-update'"));
        assert!(script.contains("'stdio'"));
        assert!(script.contains("GROK_APP_CLI_MISSING"));
        assert!(script.contains("agent leader --no-exit-on-disconnect"));
        assert!(script.contains("\"$LEADER_FLAG\""));
        assert!(!script.contains("'--no-leader'"));
        assert!(!script.contains("'--leader'"));
        assert!(!script.contains("UTS"));
        let quoted =
            ssh_acp_remote_command("/tmp", &["--rules".into(), "it's fine".into()]).unwrap();
        assert!(quoted.contains(posix_single_quote("it's fine").as_str()));
        assert!(ssh_acp_remote_command("/tmp\0", &[]).is_err());
    }

    #[test]
    fn ssh_acp_argv_is_one_remote_script() {
        let Some(_) = find_ssh_binary() else {
            return;
        };
        let argv = ssh_acp_argv(
            "UTS",
            "/data/pengqlu/my proj",
            &["--no-auto-update".into(), "agent".into(), "stdio".into()],
        )
        .expect("argv");
        assert_eq!(argv[1], "-T");
        assert!(!argv.iter().any(|a| a == "-tt"));
        assert!(!argv.iter().any(|a| a == "bash"));
        assert!(!argv.iter().any(|a| a == "-lc"));
        assert!(argv.iter().any(|a| a == "UTS"));
        assert_eq!(argv.iter().filter(|a| *a == "UTS").count(), 1);
        let script = argv.last().expect("remote script");
        assert!(script.starts_with("exec /bin/sh -c "));
        assert!(script.contains("GROK_APP_CLI_MISSING"));
        assert!(script.contains("/data/pengqlu/my proj"));
        assert!(script.contains("stdio"));
        assert!(script.contains("LEADER_FLAG"));
        assert!(script.contains("agent leader --no-exit-on-disconnect"));
        assert!(!script.contains("UTS"));
        assert_eq!(
            argv.iter().any(|a| a.contains("ControlMaster=auto")),
            ssh_control_master_enabled()
        );
        assert!(ssh_acp_argv("host;rm", "/tmp", &[]).is_err());
    }

    #[test]
    fn wrap_remote_posix_is_one_sh_c_word() {
        let inner = "echo GROK_APP_PROBE";
        let wrapped = wrap_remote_posix(inner);
        assert!(wrapped.starts_with("exec /bin/sh -c "));
        assert!(wrapped.contains("GROK_APP_PROBE"));
        assert!(!wrapped.contains("bash -lc"));
    }

    #[test]
    fn control_socket_name_stays_short() {
        assert_eq!(control_socket_name("UTS"), "UTS.sock");
        let long = "a".repeat(80);
        let name = control_socket_name(&long);
        assert!(name.ends_with(".sock"));
        assert!(name.len() < 24);
        assert_ne!(name, format!("{long}.sock"));
    }

    #[test]
    fn parse_del_stdout_reads_status_rows() {
        let rows = parse_del_stdout("noise\nGROK_APP_DEL\na\tok\nb\tmissing\nbadline\nc\terror\n");
        assert_eq!(
            rows,
            vec![
                ("a".into(), "ok".into()),
                ("b".into(), "missing".into()),
                ("c".into(), "error".into()),
            ]
        );
        assert!(parse_del_stdout("").is_empty());
        assert!(REMOTE_DEL_PY.contains("shutil.rmtree"));
        assert!(REMOTE_DEL_PY.contains("GROK_APP_DEL"));
        assert!(!REMOTE_DEL_PY.contains("UTS"));
    }

    #[test]
    fn ssh_acp_remote_command_fail_opens_leader_flag() {
        let script = ssh_acp_remote_command(
            "/tmp",
            &[
                "agent".into(),
                "--leader".into(),
                "--model".into(),
                "grok-4.6".into(),
                "stdio".into(),
            ],
        )
        .unwrap();
        assert!(script.contains("LEADER_FLAG=--leader"));
        assert!(script.contains("LEADER_FLAG=--no-leader"));
        assert!(script.contains("'agent' \"$LEADER_FLAG\""));
        assert!(script.contains("'--model'"));
        assert!(script.contains("'grok-4.6'"));
        assert!(!script.contains("'--leader'"));
        let i_agent = script.find("'agent'").expect("agent");
        let i_stdio = script.find("'stdio'").expect("stdio");
        assert!(i_agent < i_stdio);
        assert!(script[i_agent..i_stdio].contains("\"$LEADER_FLAG\""));
    }

    #[test]
    fn loopback_http_url_rewrites_to_local_bind() {
        let t = parse_loopback_http_url("http://localhost:5173/app?x=1#h").unwrap();
        assert_eq!(t.host, "localhost");
        assert_eq!(t.port, 5173);
        assert_eq!(t.scheme, "http");
        assert_eq!(
            rewrite_loopback_url(&t, 49152),
            "http://127.0.0.1:49152/app?x=1#h"
        );
        assert!(parse_loopback_http_url("https://www.google.com").is_none());
        assert!(parse_loopback_http_url("http://127.0.0.1:3000").is_some());
        assert!(parse_loopback_http_url("http://[::1]:8080/").is_some());
        assert!(is_loopback_http_host("0.0.0.0"));
        assert!(!is_loopback_http_host("example.com"));
        assert_eq!(
            local_forward_spec(9, "127.0.0.1", 3000),
            "127.0.0.1:9:127.0.0.1:3000"
        );
        assert_eq!(local_forward_spec(9, "::1", 3000), "127.0.0.1:9:[::1]:3000");
    }

    #[test]
    fn parse_inspect_stdout_reads_json_after_ok() {
        let raw = "noise\nGROK_APP_INSPECT\nOK\n{\"skills\":[{\"name\":\"foo\"}]}\ntrailing\n";
        let (v, err) = parse_inspect_stdout(raw);
        assert!(err.is_none());
        let parsed = v.unwrap();
        let names: Vec<_> = parsed
            .get("skills")
            .and_then(|x| x.as_array())
            .unwrap()
            .iter()
            .filter_map(|s| s.get("name").and_then(|n| n.as_str()))
            .collect();
        assert_eq!(names, vec!["foo"]);
        let missing = parse_inspect_stdout("GROK_APP_INSPECT\nMISSING\n");
        assert!(missing.0.is_none());
        assert!(missing.1.unwrap().contains("not found"));
    }
}
