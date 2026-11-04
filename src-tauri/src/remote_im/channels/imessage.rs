//! macOS Messages (iMessage) via the local chat database and AppleScript.
//!
//! There is no public bot API. This Mac must stay signed into Messages.
//! Inbound rows come from `~/Library/Messages/chat.db` (Full Disk Access).
//! Outbound text goes through `osascript` → Messages. Private IMCore /
//! Barcelona frameworks are not used. Windows and Linux cannot host this.
//!
//! Only rows newer than the cursor at start are delivered, so enabling the
//! channel does not replay history. A restart moves the cursor to the latest
//! row again.

use super::super::outbound::sender_allowed;
use super::super::types::{ChannelInstance, IncomingMessage};
use rusqlite::{Connection, OpenFlags};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::sync::{mpsc, watch};

pub fn protocol_name() -> &'static str {
    "imessage-chatdb"
}

/// Channels that store no bot token. The allow-from list is the credential.
pub fn runs_without_stored_secrets(channel: &str) -> bool {
    channel == "imessage"
}

pub fn unavailable_reason(os: &str) -> Option<&'static str> {
    if os == "macos" {
        None
    } else {
        Some(
            "iMessage runs only on macOS. This Mac must stay signed into Messages. Windows and Linux cannot host it.",
        )
    }
}

const OUTBOUND_CHAR_CAP: usize = 4_000;

const SEND_SCRIPT: &str = r#"on run argv
  set msg to item 1 of argv
  set targetId to item 2 of argv
  tell application "Messages"
    send msg to chat id targetId
  end tell
end run"#;

/// `osascript` arguments. The message and chat id are argv, never spliced
/// into the script text.
pub fn osascript_args(chat_id: &str, text: &str) -> Vec<String> {
    vec![
        "-e".to_string(),
        SEND_SCRIPT.to_string(),
        // A message that starts with `-e` must not become another script flag.
        "--".to_string(),
        bounded_outbound(text),
        chat_id.to_string(),
    ]
}

fn bounded_outbound(text: &str) -> String {
    let mut out = String::new();
    for (i, ch) in text.chars().enumerate() {
        if i >= OUTBOUND_CHAR_CAP {
            out.push('…');
            break;
        }
        out.push(ch);
    }
    out
}

pub fn chat_db_path() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME").ok_or_else(|| "iMessage: HOME is unset".to_string())?;
    Ok(PathBuf::from(home)
        .join("Library")
        .join("Messages")
        .join("chat.db"))
}

fn open_ro(path: &Path) -> Result<Connection, String> {
    Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| {
        format!("iMessage: cannot read Messages ({e}). Grant Full Disk Access to Grok App.")
    })
}

pub fn probe_local() -> super::super::TestConnectionDto {
    if let Some(reason) = unavailable_reason(std::env::consts::OS) {
        return super::super::TestConnectionDto {
            ok: false,
            message: reason.to_string(),
            mock: false,
        };
    }
    let path = match chat_db_path() {
        Ok(p) => p,
        Err(e) => {
            return super::super::TestConnectionDto {
                ok: false,
                message: e,
                mock: false,
            };
        }
    };
    if !path.is_file() {
        return super::super::TestConnectionDto {
            ok: false,
            message: "iMessage: Messages database was not found. Sign in to Messages on this Mac."
                .into(),
            mock: false,
        };
    }
    match open_ro(&path).and_then(|conn| max_message_row_id(&conn)) {
        Ok(_) => super::super::TestConnectionDto {
            ok: true,
            message: "messages_db_readable".into(),
            mock: false,
        },
        Err(e) => super::super::TestConnectionDto {
            ok: false,
            message: e,
            mock: false,
        },
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InboundText {
    pub row_id: i64,
    pub sender_id: String,
    pub chat_id: String,
    pub chat_type: String,
    pub text: String,
}

pub fn chat_type_for_guid(guid: &str) -> &'static str {
    if guid.contains(";+;") {
        "group"
    } else {
        "p2p"
    }
}

const NEW_MESSAGES_SQL: &str = r#"
SELECT message.ROWID,
       IFNULL(handle.id, ''),
       IFNULL(chat.guid, ''),
       message.text
FROM message
JOIN chat_message_join ON chat_message_join.message_id = message.ROWID
JOIN chat ON chat.ROWID = chat_message_join.chat_id
LEFT JOIN handle ON handle.ROWID = message.handle_id
WHERE message.ROWID > ?1
  AND message.is_from_me = 0
  AND IFNULL(message.associated_message_type, 0) = 0
  AND message.text IS NOT NULL
ORDER BY message.ROWID ASC
LIMIT 50
"#;

pub fn max_message_row_id(conn: &Connection) -> Result<i64, String> {
    conn.query_row("SELECT IFNULL(MAX(ROWID), 0) FROM message", [], |row| {
        row.get(0)
    })
    .map_err(|e| format!("iMessage: {e}"))
}

pub fn read_new_messages(conn: &Connection, after_row_id: i64) -> Result<Vec<InboundText>, String> {
    let mut stmt = conn
        .prepare(NEW_MESSAGES_SQL)
        .map_err(|e| format!("iMessage: {e}"))?;
    let rows = stmt
        .query_map([after_row_id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .map_err(|e| format!("iMessage: {e}"))?;
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for row in rows {
        let (row_id, sender, chat_id, text) = row.map_err(|e| format!("iMessage: {e}"))?;
        if !seen.insert(row_id) {
            continue;
        }
        let sender_id = sender.trim().to_string();
        let chat_id = chat_id.trim().to_string();
        let text = text.trim().to_string();
        if sender_id.is_empty() || chat_id.is_empty() || text.is_empty() {
            continue;
        }
        out.push(InboundText {
            row_id,
            sender_id,
            chat_type: chat_type_for_guid(&chat_id).to_string(),
            chat_id,
            text,
        });
    }
    Ok(out)
}

pub async fn run(
    inst: ChannelInstance,
    tx: mpsc::Sender<IncomingMessage>,
    mut cancel: watch::Receiver<bool>,
) -> Result<(), String> {
    if let Some(reason) = unavailable_reason(std::env::consts::OS) {
        return Err(reason.to_string());
    }
    let path = chat_db_path()?;
    let mut cursor = {
        let path = path.clone();
        tokio::task::spawn_blocking(move || {
            let conn = open_ro(&path)?;
            max_message_row_id(&conn)
        })
        .await
        .map_err(|e| format!("iMessage: {e}"))??
    };
    let _ = super::super::config::set_instance_last_error(&inst.id, None);
    tracing::info!(instance = %inst.id, cursor, "imessage poll started");

    loop {
        if *cancel.borrow() {
            return Ok(());
        }
        let path_for_poll = path.clone();
        let after = cursor;
        let polled = tokio::task::spawn_blocking(move || {
            let conn = open_ro(&path_for_poll)?;
            read_new_messages(&conn, after)
        })
        .await
        .map_err(|e| format!("iMessage: {e}"))?;

        match polled {
            Ok(batch) => {
                let _ = super::super::config::set_instance_last_error(&inst.id, None);
                for item in batch {
                    cursor = cursor.max(item.row_id);
                    if !sender_allowed(&inst.acl, &item.sender_id) {
                        continue;
                    }
                    let mentioned_bot = item.chat_type != "group";
                    let incoming = IncomingMessage {
                        staged_attachments: Vec::new(),
                        attachment_note: None,
                        channel: "imessage".into(),
                        instance_id: inst.id.clone(),
                        message_id: item.row_id.to_string(),
                        chat_id: item.chat_id,
                        chat_type: item.chat_type,
                        sender_id: item.sender_id,
                        content: item.text,
                        // Groups still honor the shared @ mention switch.
                        // A direct chat has no mention syntax.
                        mentioned_bot,
                        thread_id: None,
                    };
                    if tx.send(incoming).await.is_err() {
                        return Ok(());
                    }
                }
            }
            Err(e) => {
                tracing::warn!(instance = %inst.id, "imessage poll: {e}");
                let _ = super::super::config::set_instance_last_error(&inst.id, Some(e));
            }
        }

        tokio::select! {
            _ = cancel.changed() => {
                if *cancel.borrow() {
                    return Ok(());
                }
            }
            _ = tokio::time::sleep(Duration::from_secs(2)) => {}
        }
    }
}

pub async fn send_text(chat_id: &str, text: &str) -> Result<(), String> {
    if let Some(reason) = unavailable_reason(std::env::consts::OS) {
        return Err(reason.to_string());
    }
    let chat_id = chat_id.trim();
    let text = text.trim();
    if chat_id.is_empty() || text.is_empty() {
        return Err("iMessage: empty chat or text".into());
    }
    let args = osascript_args(chat_id, text);
    let output = tokio::process::Command::new("osascript")
        .args(&args)
        .output()
        .await
        .map_err(|e| format!("iMessage: osascript failed to start: {e}"))?;
    if output.status.success() {
        return Ok(());
    }
    let err = String::from_utf8_lossy(&output.stderr);
    let err = err.replace('\n', " ").trim().to_string();
    let err = if err.chars().count() > 180 {
        let mut s: String = err.chars().take(180).collect();
        s.push('…');
        s
    } else if err.is_empty() {
        format!("osascript exit {}", output.status)
    } else {
        err
    };
    Err(format!("iMessage: {err}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE message (
              ROWID INTEGER PRIMARY KEY,
              text TEXT,
              is_from_me INTEGER,
              handle_id INTEGER,
              associated_message_type INTEGER
            );
            CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT);
            CREATE TABLE chat (ROWID INTEGER PRIMARY KEY, guid TEXT);
            CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER);
            INSERT INTO handle (ROWID, id) VALUES (1, '+15551212'), (2, 'ada@icloud.com');
            INSERT INTO chat (ROWID, guid) VALUES
              (1, 'iMessage;-;+15551212'),
              (2, 'iMessage;+;chat-group');
            INSERT INTO message (ROWID, text, is_from_me, handle_id, associated_message_type) VALUES
              (10, 'old', 0, 1, 0),
              (11, 'from me', 1, 1, 0),
              (12, '   ', 0, 1, 0),
              (13, 'loved an image', 0, 1, 2000),
              (14, 'hello', 0, 1, 0),
              (15, 'group hi', 0, 2, 0);
            INSERT INTO chat_message_join (chat_id, message_id) VALUES
              (1, 10), (1, 11), (1, 12), (1, 13), (1, 14),
              (2, 15), (2, 14);
            "#,
        )
        .unwrap();
        conn
    }

    #[test]
    fn other_platforms_cannot_host_imessage() {
        assert!(unavailable_reason("macos").is_none());
        assert!(unavailable_reason("linux").unwrap().contains("macOS"));
        assert!(unavailable_reason("windows").unwrap().contains("macOS"));
    }

    #[test]
    fn script_does_not_contain_the_message() {
        let args = osascript_args("iMessage;+;chat", "hello \"quoted\"");
        let script = &args[1];
        assert!(script.contains("on run argv"));
        assert!(!script.contains("hello"));
        assert!(!script.contains("iMessage;+;chat"));
        assert_eq!(args[2], "--");
        assert_eq!(args[3], "hello \"quoted\"");
        assert_eq!(args[4], "iMessage;+;chat");
    }

    #[test]
    fn outbound_text_is_capped() {
        let long = "字".repeat(OUTBOUND_CHAR_CAP + 10);
        let bounded = bounded_outbound(&long);
        assert_eq!(bounded.chars().count(), OUTBOUND_CHAR_CAP + 1);
        assert!(bounded.ends_with('…'));
    }

    #[test]
    fn reads_only_new_text_from_other_people() {
        let conn = fixture();
        assert_eq!(max_message_row_id(&conn).unwrap(), 15);
        let rows = read_new_messages(&conn, 10).unwrap();
        assert_eq!(
            rows,
            vec![
                InboundText {
                    row_id: 14,
                    sender_id: "+15551212".into(),
                    chat_id: "iMessage;-;+15551212".into(),
                    chat_type: "p2p".into(),
                    text: "hello".into(),
                },
                InboundText {
                    row_id: 15,
                    sender_id: "ada@icloud.com".into(),
                    chat_id: "iMessage;+;chat-group".into(),
                    chat_type: "group".into(),
                    text: "group hi".into(),
                },
            ]
        );
        assert!(read_new_messages(&conn, 15).unwrap().is_empty());
    }

    #[test]
    fn allowlist_uses_the_handle_id() {
        let acl = serde_json::json!({ "allowFrom": "+15551212" });
        assert!(sender_allowed(&acl, "+15551212"));
        assert!(!sender_allowed(&acl, "ada@icloud.com"));
    }
}
