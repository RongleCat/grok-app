# SSH remote hosts

Remote workspaces are sliced. This page is the product contract for agents.

Related: [settings-ia.md](./settings-ia.md), [session-continuity.md](./session-continuity.md), [media-delivery.md](./media-delivery.md).

## Waves

| Wave | Ships | Does not |
|------|--------|----------|
| **1** | Settings → Runtime → **SSH**: list `~/.ssh/config` Host aliases, **Test connection**, probe remote `grok` + `~/.grok/auth.json`. Copy-paste install / `grok login --device-auth` when missing. | Open a remote folder, file tree, edit, spawn remote agent, tmux |
| **1b** | Live search, Watching / Available lists, watch switch (ControlMaster), scan remote Grok sessions into the sidebar, new-session Remote chip + path picker | Spawn `grok` on the host; in-app file tree/edit of remote files |
| **2** | Remote path as a Project; sidebar tree; markdown preview; text save; Terminal `ssh -tt` PTY; Skills via remote `grok inspect`; Browser localhost via SSH `-L` | Agent cwd on the remote host |
| **3** | Session runs `grok agent stdio` **on the host** via `ssh -T` (remote cwd, resume by remote session id) | Disconnect persistence |
| **4** | Reconnect via `grok agent leader --no-exit-on-disconnect` | tmux UI |

## Hard rules (wave 1)

- Transport is system **OpenSSH** (`ssh` argv). Do not add a second SSH stack.
- Host aliases are concrete names only (`Host *` / `?` / `!` skipped).
- Alias is a process argument, never interpolated into a local shell.
- Tests use `BatchMode=yes` (keys only; no password prompt).
- First-time host keys: tell the user to run `ssh <alias>` once in a terminal (`StrictHostKeyChecking=yes`).
- Remote login check is **presence of `~/.grok/auth.json`**, never file contents.
- Remote install command is the official POSIX installer: `curl -fsSL https://x.ai/cli/install.sh | bash`.
- Remote login command is `grok login --device-auth` (TTY via `ssh -t`).
- Persistence is **not** tmux. Wave 4 uses Grok Build `agent leader --no-exit-on-disconnect`.
- Do not treat a remote path as a local filesystem path.
- **Remote host is POSIX** (`/bin/sh`, `$HOME/.grok`). Windows-as-SSH-server is out of scope. In-app file read/write needs remote `python3`.
- Remote snippets run as `exec /bin/sh -c '…'` (one ssh argv) so a fish/zsh login shell does not parse `[` / `export`. Never extra argv after `bash -lc`.
- **Windows client:** native OpenSSH has no reliable ControlMaster / `ssh -f`. Watch still persists the alias; each list/read/ACP/PTY is a new `ssh` (`BatchMode`). Localhost Browser uses a dedicated `ssh -L`. Discover `ssh.exe` via PATH, Git `usr\bin`, and `System32\OpenSSH`. GUI spawn sets `HOME` from `USERPROFILE`.
- **macOS / Linux client:** ControlMaster + ControlPersist. Quote ControlPath when the cache dir has spaces. Socket file names stay short (AF_UNIX `sun_path`).

## Settings

- Section `runtime`, tab `ssh`, hash `#/settings/runtime/ssh`.
- Catalog id `runtime.sshHosts`, anchor `settings-anchor-sshHosts`.
- Host commands: `ssh_list_hosts`, `ssh_test_host`, `ssh_watch_start`, `ssh_watch_stop` in `src-tauri/src/ssh_remote/`.
- Watch switch: thumb and Watching / Available partition update immediately. `ssh_watch_start` / `ssh_watch_stop` run after. Failure reverts the switch and shows an error. Missing remote CLI or login is a warning, not a silent no-op.
- `-o ControlPath=` is ssh_config. Quote values with spaces (`Library/Application Support`). Sockets live under the app **cache** dir (`ssh-cm`), not data dir. Tests: `openssh_accepts_quoted_controlpath_with_spaces` and `SshHostsPanel.test.tsx`.
- Sidebar remote rail is two-level: `远程 {alias}` → cwd folder (basename, full path on hover) → sessions. Same `tree-l2` / `tree-l3` row as local chats (name + relative time). Title: custom overlay, else `<user_query>` first sentence, else cwd basename. Never UUID / `<system-reminder>`. Newest 20 + Load more at the host. Click: `ssh_open_session` then `openSession`. Folder hover pencil is the same `sidebar.newConversation` control as local projects: `project_add_ssh` + new chat in that remote cwd. While that host is watching, hide `sshAlias` projects from the local project tree so an imported chat is not listed twice. Chat pane keeps OverlayScroll + MessageNodeRail (no extra scroller). Cmd/Ctrl click (or right-click → Select) enters the same select mode as local chats. Delete removes the remote grok session dir and any imported App journal. Tests: `SshRemoteSessionRail` select / delete.
- Remote session scan must match `grok sessions list` / TUI `/resume`, not every directory under `~/.grok/sessions`. Skip `summary.json` `session_kind` that starts with `subagent`. Skip empty shells that have only `chat_history.jsonl` and no `updates.jsonl` / no title. Those cannot load. Tests: `listable_matches_grok_resume_not_raw_dirs`.
- Session title marquee only runs when the title is wider than the name slot. Do not subtract a fake hover-icon reserve. Clip the scroll inside the name slot so it never paints over relative time.
- Wave 3: an `sshAlias` project spawns `ssh -T` + ControlMaster, then **one** remote script that `exec grok agent stdio` in the remote cwd. OpenSSH joins the remote command into a single `-c` string — do not pass grok flags as extra ssh argv after `bash -lc` (that exits immediately → `host_exit`). Imported chats store the remote grok UUID as `agent_session_id` so ACP `session/load` can resume. Send and warm-connect are on. Tests: `ssh_acp_argv_is_one_remote_script`.
- Wave 4: that same remote script starts `grok agent leader --no-exit-on-disconnect` when `~/.grok/leader.sock` is missing, then execs grok with `$LEADER_FLAG` (`--leader` if the socket exists, else `--no-leader`). Host requests `--leader` for SSH. Do not kill the remote leader on watch stop or app exit. Not tmux. Tests: `ssh_acp_remote_command_fail_opens_leader_flag`.
- ACP `session/new` must not `Path::is_dir` the remote cwd. Handshake can succeed on the host then die with `AGENT_CRASHED` / `project cwd is not a directory: /data/...`. Skip local MCP inject too. Tests: `acp_session_cwd_ok_skips_local_isdir_for_ssh`.
- Never spawn local `grok` with a remote path as cwd. Resolve `ssh_alias` from the connect arg, the session's project, or a path match. A missing local directory without an alias is `CONNECT_FAILED`, never `CLI_NOT_FOUND`. Tests: `pick_ssh_alias_prefers_explicit_then_bound_then_path`, `local_acp_cwd_ok_rejects_ssh_and_missing_dirs`.
- Never mark an SSH project `path_ok=false` from local `is_dir`. A remote cwd is valid on the host. `load_projects` keeps `path_ok` true when `ssh_alias` is set, repairs rows that lost the alias (`UTS:{basename}` + POSIX path), and merges duplicate alias+path folders. UI `路径失效` / relocate is local-disk only (`isProjectFolderMissing`). Tests: `load_projects_repairs_ssh_alias_and_merges_duplicates`, `add_ssh_project_rebinds_same_path_without_alias`.
- Wave 2: an `sshAlias` project uses Side Workbench Files over OpenSSH (`ssh_list_dir` / `ssh_read_file` / `ssh_write_file`). Relative paths cannot contain `..`. Text/markdown preview and save only, 2 MiB cap. Do not treat the remote path as local `std::fs`. Tests: `join_remote_rel_rejects_escape`.
- Wave 2 terminal: PTY is `ssh -tt` with ControlMaster, remote `cd` + login shell. Do not spawn local `$SHELL` with the remote path as cwd (`Path::is_dir` would miss and fall back to local HOME). Tests: `ssh_pty_argv_keeps_alias_as_own_word`.
- Wave 2 skills: `skills_list` with `sshAlias` runs remote `grok inspect --json` plus `{project}/.grok/skills`. Never local inspect using the remote path.
- Wave 2 browser: loopback URLs (`localhost` / `127.0.0.1` / `::1`) open through SSH `-L` so the embedded webview hits the remote process. Public https stays local. Do not launch an X11 browser on the HPC node. Tests: `loopback_http_url_rewrites_to_local_bind`, [src/lib/sshLoopbackUrl.test.ts](../../src/lib/sshLoopbackUrl.test.ts).
