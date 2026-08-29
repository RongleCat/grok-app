//! In-process mock ACP stub for PR2.
//!
//! Deliberately does **not** spawn `grok agent stdio` — that is PR3 after a
//! real-machine spike. This stub implements the same Host-facing surface the
//! real AcpClient will later fill (connect / send / stream chunks / stop).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::task::JoinHandle;

/// Fake stream chunk pushed to the frontend via Tauri events.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamChunk {
    pub session_id: String,
    pub message_id: String,
    pub text: String,
    pub done: bool,
}

/// Mock connect modes for demos / tests.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum MockConnectMode {
    /// Successful handshake → Ready.
    #[default]
    Success,
    /// Fail with CLI_NOT_FOUND after a short delay.
    FailCliNotFound,
}

/// Handle for an in-flight mock stream (cancel via stop flag).
pub struct MockStreamHandle {
    pub stop: Arc<AtomicBool>,
    #[allow(dead_code)]
    pub join: JoinHandle<()>,
}

impl MockStreamHandle {
    pub fn request_stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
    }
}

/// Split a reply into fake token-ish chunks for incremental UI rendering.
pub fn chunk_text(text: &str, max_chars: usize) -> Vec<String> {
    let max_chars = max_chars.max(1);
    let mut out = Vec::new();
    let mut buf = String::new();
    for ch in text.chars() {
        buf.push(ch);
        if buf.chars().count() >= max_chars {
            out.push(std::mem::take(&mut buf));
        }
    }
    if !buf.is_empty() {
        out.push(buf);
    }
    if out.is_empty() {
        out.push(String::new());
    }
    out
}

/// Build a deterministic mock reply for a user prompt.
pub fn mock_reply_for(prompt: &str) -> String {
    format!(
        "Mock ACP reply: I received «{prompt}». \
         This stream is fake token output from the in-process stub — \
         not grok agent stdio. Ready for PR3 swap."
    )
}

/// Spawn an async task that emits StreamChunks with delay; respects stop flag.
pub fn spawn_fake_stream(
    session_id: String,
    message_id: String,
    prompt: String,
    chunk_delay: Duration,
    mut on_chunk: impl FnMut(StreamChunk) + Send + 'static,
) -> MockStreamHandle {
    let stop = Arc::new(AtomicBool::new(false));
    let stop_flag = Arc::clone(&stop);

    let join = tokio::spawn(async move {
        let full = mock_reply_for(&prompt);
        let pieces = chunk_text(&full, 6);
        for (i, piece) in pieces.iter().enumerate() {
            if stop_flag.load(Ordering::SeqCst) {
                on_chunk(StreamChunk {
                    session_id: session_id.clone(),
                    message_id: message_id.clone(),
                    text: String::new(),
                    done: true,
                });
                return;
            }
            let is_last = i + 1 == pieces.len();
            on_chunk(StreamChunk {
                session_id: session_id.clone(),
                message_id: message_id.clone(),
                text: piece.clone(),
                done: is_last,
            });
            if !is_last {
                tokio::time::sleep(chunk_delay).await;
            }
        }
    });

    MockStreamHandle { stop, join }
}

/// Channel-based variant used by unit tests (no Tauri AppHandle).
#[cfg(test)]
pub fn spawn_fake_stream_channel(
    session_id: String,
    message_id: String,
    prompt: String,
    chunk_delay: Duration,
) -> (
    MockStreamHandle,
    tokio::sync::mpsc::UnboundedReceiver<StreamChunk>,
) {
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
    let handle = spawn_fake_stream(session_id, message_id, prompt, chunk_delay, move |c| {
        let _ = tx.send(c);
    });
    (handle, rx)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunk_text_splits_incrementally() {
        let parts = chunk_text("abcdefghij", 3);
        assert_eq!(parts, vec!["abc", "def", "ghi", "j"]);
    }

    #[test]
    fn mock_reply_does_not_mention_real_spawn_path_as_backend() {
        let r = mock_reply_for("hello");
        assert!(r.contains("Mock ACP"));
        assert!(r.contains("not grok agent stdio"));
    }

    #[tokio::test]
    async fn stream_emits_multiple_chunks_then_done() {
        let (handle, mut rx) = spawn_fake_stream_channel(
            "s1".into(),
            "m1".into(),
            "hi".into(),
            Duration::from_millis(1),
        );
        let mut texts = Vec::new();
        let mut done = false;
        while let Some(c) = rx.recv().await {
            if !c.text.is_empty() {
                texts.push(c.text);
            }
            if c.done {
                done = true;
                break;
            }
        }
        handle.join.await.unwrap();
        assert!(
            texts.len() > 1,
            "expected multi-chunk stream, got {texts:?}"
        );
        assert!(done);
        let joined: String = texts.concat();
        assert!(joined.contains("Mock ACP"));
    }

    #[tokio::test]
    async fn stop_ends_stream_early() {
        let (handle, mut rx) = spawn_fake_stream_channel(
            "s1".into(),
            "m1".into(),
            "long prompt for more chunks".into(),
            Duration::from_millis(50),
        );
        // Wait for first chunk then stop.
        let first = rx.recv().await.expect("first chunk");
        assert!(!first.done || !first.text.is_empty());
        handle.request_stop();
        let mut saw_done = false;
        while let Some(c) = rx.recv().await {
            if c.done {
                saw_done = true;
                break;
            }
        }
        let _ = handle.join.await;
        assert!(saw_done, "stop should finish stream with done=true");
    }
}
