use super::super::outbound::{http_client, require_mention, sender_allowed};
use super::super::types::{ChannelInstance, IncomingMessage, StagedRemoteAttachment};
use super::feishu::{open_domain, tenant_token};
use crate::attachments::AttachmentKind;
use crate::remote_im::i18n::MessageKey;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::Write;
use std::path::Path;
use std::time::Duration;
use tokio::sync::mpsc;

pub(super) struct InboundMedia {
    key: String,
    /// Feishu resource `type` query value: `image` or `file`.
    resource_type: &'static str,
    /// Store kind used for journal/preview.
    kind: AttachmentKind,
    /// Original name for file / video messages; images carry none.
    file_name: Option<String>,
}

/// Parsed message plus the media that still has to be downloaded.
pub(super) struct ParsedInbound {
    pub(super) message: IncomingMessage,
    pub(super) media: Vec<InboundMedia>,
    /// The message referenced more than [`MAX_INBOUND_FILES`] resources.
    pub(super) media_truncated: bool,
}

pub(super) fn parse_im_event(inst: &ChannelInstance, root: &Value) -> Option<ParsedInbound> {
    // EventDispatcher wraps: { type, event: { message, sender } } or schema 2.0
    let event = root
        .get("event")
        .cloned()
        .or_else(|| root.get("data").and_then(|d| d.get("event")).cloned())
        .unwrap_or_else(|| root.clone());

    let header_type = root
        .get("header")
        .and_then(|h| h.get("event_type"))
        .and_then(|x| x.as_str())
        .or_else(|| root.get("type").and_then(|x| x.as_str()))
        .unwrap_or("");

    if !header_type.is_empty()
        && header_type != "im.message.receive_v1"
        && !header_type.contains("message")
    {
        // still try parse message body
    }

    let message = event.get("message")?;
    let msg_type = message
        .get("message_type")
        .and_then(|x| x.as_str())
        .unwrap_or("text");

    let content_raw = message
        .get("content")
        .and_then(|x| x.as_str())
        .unwrap_or("{}");
    let content_json: Value = serde_json::from_str(content_raw).unwrap_or(json!({}));
    let mut text = String::new();
    let mut media: Vec<InboundMedia> = Vec::new();
    let mut media_truncated = false;
    if msg_type == "post" {
        collect_post_content(&content_json, &mut text, &mut media, &mut media_truncated);
    } else {
        text = content_json
            .get("text")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string();
        match msg_type {
            "image" => push_media(
                &mut media,
                &mut media_truncated,
                &content_json,
                "image_key",
                "image",
                None,
                AttachmentKind::Image,
            ),
            "file" => push_media(
                &mut media,
                &mut media_truncated,
                &content_json,
                "file_key",
                "file",
                content_json.get("file_name").and_then(|x| x.as_str()),
                AttachmentKind::File,
            ),
            "audio" => push_media(
                &mut media,
                &mut media_truncated,
                &content_json,
                "file_key",
                "file",
                None,
                AttachmentKind::Audio,
            ),
            "media" => push_media(
                &mut media,
                &mut media_truncated,
                &content_json,
                "file_key",
                "file",
                content_json.get("file_name").and_then(|x| x.as_str()),
                AttachmentKind::Video,
            ),
            // Feishu stickers carry a plain `file_key`; store them as images.
            "sticker" => push_media(
                &mut media,
                &mut media_truncated,
                &content_json,
                "file_key",
                "file",
                None,
                AttachmentKind::Image,
            ),
            _ => {}
        }
    }
    // strip @mention placeholders like @_user_1
    let re_clean = regex_lite_strip_mentions(&text);

    let chat_id = message
        .get("chat_id")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let message_id = message
        .get("message_id")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let chat_type_raw = message
        .get("chat_type")
        .and_then(|x| x.as_str())
        .unwrap_or("p2p");
    let chat_type = if chat_type_raw == "group" || chat_type_raw == "public" {
        "group"
    } else {
        "p2p"
    };

    let sender_id = event
        .pointer("/sender/sender_id/open_id")
        .or_else(|| event.pointer("/sender/sender_id/user_id"))
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();

    let mentions = message.get("mentions").and_then(|x| x.as_array());
    let mentioned_bot = mentions
        .map(|arr| {
            arr.iter().any(|m| {
                m.get("id")
                    .and_then(|id| id.get("open_id"))
                    .and_then(|x| x.as_str())
                    .map(|s| s.starts_with("ou_"))
                    .unwrap_or(false)
                    || m.get("name")
                        .and_then(|x| x.as_str())
                        .map(|n| n.contains("bot") || n.contains("机器人"))
                        .unwrap_or(false)
                    || m.get("key").is_some()
            })
        })
        .unwrap_or(chat_type == "p2p");

    if re_clean.trim().is_empty() && media.is_empty() {
        return None;
    }
    let content = re_clean;

    Some(ParsedInbound {
        message: IncomingMessage {
            staged_attachments: Vec::new(),
            attachment_note: None,
            channel: inst.channel.clone(),
            instance_id: inst.id.clone(),
            message_id,
            chat_id,
            chat_type: chat_type.into(),
            sender_id,
            content,
            mentioned_bot: mentioned_bot || chat_type == "p2p",
            thread_id: None,
        },
        media,
        media_truncated,
    })
}

/// Pick the human body out of a `post` payload. Feishu wraps rich text in a
/// locale map (`{"zh_cn": {"title":…, "content":[…]}}`); older fixtures and
/// plain shapes put `title` / `content` at the top level.
fn post_body(content: &Value) -> &Value {
    if looks_like_post_body(content) {
        return content;
    }
    for locale in ["zh_cn", "en_us"] {
        if let Some(body) = content.get(locale) {
            if looks_like_post_body(body) {
                return body;
            }
        }
    }
    content
        .as_object()
        .and_then(|map| map.values().find(|v| looks_like_post_body(v)))
        .unwrap_or(content)
}

fn looks_like_post_body(value: &Value) -> bool {
    value.get("content").and_then(|x| x.as_array()).is_some()
        || value.get("title").and_then(|x| x.as_str()).is_some()
}

/// Collect text and media refs from a rich-text (`post`) message body.
fn collect_post_content(
    content: &Value,
    text: &mut String,
    media: &mut Vec<InboundMedia>,
    truncated: &mut bool,
) {
    let body = post_body(content);
    if let Some(title) = body
        .get("title")
        .and_then(|x| x.as_str())
        .map(str::trim)
        .filter(|t| !t.is_empty())
    {
        text.push_str(title);
    }
    let lines = body.get("content").and_then(|x| x.as_array());
    let Some(lines) = lines else {
        return;
    };
    for line in lines {
        let Some(nodes) = line.as_array() else {
            continue;
        };
        let mut line_text = String::new();
        for node in nodes {
            match node.get("tag").and_then(|x| x.as_str()).unwrap_or("") {
                "text" | "a" | "md" => {
                    if let Some(t) = node.get("text").and_then(|x| x.as_str()) {
                        line_text.push_str(t);
                    }
                }
                "at" => {
                    if let Some(name) = node.get("user_name").and_then(|x| x.as_str()) {
                        line_text.push('@');
                        line_text.push_str(name);
                    }
                }
                "img" => push_media(
                    media,
                    truncated,
                    node,
                    "image_key",
                    "image",
                    None,
                    AttachmentKind::Image,
                ),
                "media" => push_media(
                    media,
                    truncated,
                    node,
                    "file_key",
                    "file",
                    node.get("file_name").and_then(|x| x.as_str()),
                    AttachmentKind::Video,
                ),
                _ => {}
            }
        }
        let line_text = line_text.trim();
        if !line_text.is_empty() {
            if !text.is_empty() {
                text.push('\n');
            }
            text.push_str(line_text);
        }
    }
}

fn push_media(
    media: &mut Vec<InboundMedia>,
    truncated: &mut bool,
    node: &Value,
    key_field: &str,
    resource_type: &'static str,
    file_name: Option<&str>,
    kind: AttachmentKind,
) {
    let Some(key) = node
        .get(key_field)
        .and_then(|x| x.as_str())
        .map(str::trim)
        // Feishu keys are `img_v3_…` / `file_v3_…`; reject anything that could
        // alter the download URL path.
        .filter(|k| is_safe_resource_id(k))
    else {
        return;
    };
    if media.iter().any(|m| m.key == key) {
        return;
    }
    if media.len() >= MAX_INBOUND_FILES {
        *truncated = true;
        return;
    }
    media.push(InboundMedia {
        key: key.to_string(),
        resource_type,
        kind,
        file_name: file_name
            .map(str::trim)
            .filter(|n| !n.is_empty())
            .map(str::to_string),
    });
}

/// Feishu message ids (`om_…`) and resource keys use this charset only.
fn is_safe_resource_id(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
}

fn regex_lite_strip_mentions(s: &str) -> String {
    // remove @_user_N and bare @xxx patterns used by Feishu
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '@' {
            // skip until space or end
            while let Some(&n) = chars.peek() {
                if n.is_whitespace() {
                    break;
                }
                chars.next();
            }
            continue;
        }
        out.push(c);
    }
    out.trim().to_string()
}

const MAX_INBOUND_FILES: usize = 16;
const MAX_INBOUND_MEDIA_BYTES: usize = 100 * 1024 * 1024;

/// Per-chat download budget so one chat cannot fill the disk between engine
/// rate-limit windows. The engine still applies its own turn rate limit.
const MEDIA_WINDOW: Duration = Duration::from_secs(60);
const MAX_MEDIA_BYTES_PER_CHAT_WINDOW: usize = 200 * 1024 * 1024;

struct MediaBudget {
    started: std::time::Instant,
    bytes: usize,
}

impl MediaBudget {
    fn new() -> Self {
        Self {
            started: std::time::Instant::now(),
            bytes: 0,
        }
    }

    fn remaining(&mut self) -> usize {
        if self.started.elapsed() >= MEDIA_WINDOW {
            self.started = std::time::Instant::now();
            self.bytes = 0;
        }
        MAX_MEDIA_BYTES_PER_CHAT_WINDOW.saturating_sub(self.bytes)
    }

    fn record(&mut self, bytes: usize) {
        self.bytes = self.bytes.saturating_add(bytes);
    }
}

/// Streamed download result; the file already lives under store staging.
#[derive(Debug)]
struct DownloadedResource {
    size: u64,
    sha256: String,
    content_type: Option<String>,
}

/// Downloads queued messages off the WS read loop. One worker per connection
/// keeps message order while the socket keeps answering heartbeats.
pub(super) async fn run_media_worker(
    inst: ChannelInstance,
    mut queue: mpsc::Receiver<ParsedInbound>,
    tx: mpsc::Sender<IncomingMessage>,
) {
    let mut budgets: HashMap<String, MediaBudget> = HashMap::new();
    while let Some(parsed) = queue.recv().await {
        let ParsedInbound {
            mut message,
            media,
            media_truncated,
        } = parsed;
        // Never stage files for senders the engine will reject (ACL) or for a
        // group message the bot was not mentioned in. Forward the message so
        // the engine keeps its existing reply/drop behavior.
        if can_download_media(&inst, &message) {
            let media_count = media.len();
            budgets.retain(|_, budget| budget.started.elapsed() < MEDIA_WINDOW * 5);
            let budget = budgets
                .entry(message.chat_id.clone())
                .or_insert_with(MediaBudget::new);
            attach_inbound_media(&inst, &mut message, &media, budget).await;
            if media_truncated {
                append_note(
                    &mut message.attachment_note,
                    bridge_copy(MessageKey::AttachmentTooMany).to_string(),
                );
            }
            tracing::info!(
                instance = %inst.id,
                chat = %message.chat_id,
                content_len = message.content.len(),
                media = media_count,
                staged = message.staged_attachments.len(),
                preview = %message.content.chars().take(40).collect::<String>(),
                "feishu inbound message"
            );
        }
        if tx.send(message).await.is_err() {
            break;
        }
    }
}

fn can_download_media(inst: &ChannelInstance, msg: &IncomingMessage) -> bool {
    if !sender_allowed(&inst.acl, &msg.sender_id) {
        return false;
    }
    !(msg.chat_type == "group" && require_mention(&inst.options, &inst.acl) && !msg.mentioned_bot)
}

/// Stream each inbound resource into the attachment store's staging area.
///
/// The engine commits staging after resolving the App session and checking the
/// 512 MB session budget. No `@path` is written into the journal here.
async fn attach_inbound_media(
    inst: &ChannelInstance,
    incoming: &mut IncomingMessage,
    media: &[InboundMedia],
    budget: &mut MediaBudget,
) {
    if media.is_empty() {
        return;
    }
    if budget.remaining() == 0 {
        push_media_failure(
            &mut incoming.attachment_note,
            bridge_copy(MessageKey::AttachmentQuotaExhausted),
        );
        return;
    }
    let store = match crate::attachments::shared() {
        Ok(store) => store,
        Err(err) => {
            push_media_failure(&mut incoming.attachment_note, &err);
            return;
        }
    };
    // One token + one client per message, not per attachment.
    let token = match tenant_token(&inst.channel, &inst.secrets, &inst.options).await {
        Ok(token) => token,
        Err(err) => {
            push_media_failure(&mut incoming.attachment_note, &err);
            return;
        }
    };
    let api_base = format!("https://{}", open_domain(&inst.channel, &inst.options));
    let client = match http_client() {
        Ok(client) => client,
        Err(err) => {
            push_media_failure(&mut incoming.attachment_note, &err);
            return;
        }
    };
    for item in media {
        if budget.remaining() == 0 {
            push_media_failure(
                &mut incoming.attachment_note,
                bridge_copy(MessageKey::AttachmentQuotaExhausted),
            );
            break;
        }
        let temp_path = store.staging_path();
        match fetch_message_to_staging(
            &client,
            &api_base,
            &token,
            &incoming.message_id,
            item,
            &temp_path,
            MAX_INBOUND_MEDIA_BYTES,
        )
        .await
        {
            Ok(resource) => {
                budget.record(resource.size as usize);
                let name = media_display_name(item, resource.content_type.as_deref());
                tracing::info!(
                    instance = %inst.id,
                    key = %item.key,
                    file = %name,
                    bytes = resource.size,
                    "feishu inbound media staged"
                );
                incoming.staged_attachments.push(StagedRemoteAttachment {
                    name,
                    kind: item.kind,
                    temp_path,
                    size: resource.size,
                    sha256: resource.sha256,
                });
            }
            Err(err) => {
                let _ = std::fs::remove_file(&temp_path);
                tracing::warn!(
                    instance = %inst.id,
                    key = %item.key,
                    error = %err,
                    "feishu inbound media download failed"
                );
                push_media_failure(&mut incoming.attachment_note, &err);
            }
        }
    }
}

fn append_note(note: &mut Option<String>, line: String) {
    match note {
        Some(existing) => {
            existing.push('\n');
            existing.push_str(&line);
        }
        None => *note = Some(line),
    }
}

pub(super) fn push_media_failure(note: &mut Option<String>, reason: &str) {
    // External text must stay on one line and bounded before it reaches the
    // agent prompt.
    let reason: String = reason
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .take(120)
        .collect();
    append_note(
        note,
        format!(
            "{}{}",
            bridge_copy(MessageKey::AttachmentProcessingFailed),
            reason.trim()
        ),
    );
}

pub(super) fn bridge_copy(key: MessageKey) -> &'static str {
    crate::remote_im::i18n::t(&crate::remote_im::i18n::resolve_engine_lang(), key)
}

fn media_display_name(item: &InboundMedia, content_type: Option<&str>) -> String {
    let ext = content_type
        .and_then(extension_for_content_type)
        .unwrap_or_else(|| match item.kind {
            AttachmentKind::Image => "png".into(),
            AttachmentKind::Audio => "opus".into(),
            AttachmentKind::Video => "mp4".into(),
            AttachmentKind::File => "bin".into(),
        });
    if let Some(name) = item
        .file_name
        .as_deref()
        .and_then(crate::attachments::sanitize_file_name)
    {
        if Path::new(&name).extension().is_some() {
            return name;
        }
        return format!("{name}.{ext}");
    }
    let stem = match item.kind {
        AttachmentKind::Image => "image",
        AttachmentKind::Audio => "audio",
        AttachmentKind::Video => "video",
        AttachmentKind::File => "attachment",
    };
    format!("{stem}.{ext}")
}

fn extension_for_content_type(content_type: &str) -> Option<String> {
    let essence = content_type.split(';').next()?.trim().to_ascii_lowercase();
    let ext = match essence.as_str() {
        "image/jpeg" | "image/jpg" => "jpg",
        "image/png" => "png",
        "image/webp" => "webp",
        "image/gif" => "gif",
        "image/bmp" => "bmp",
        "application/pdf" => "pdf",
        "text/plain" => "txt",
        "application/zip" => "zip",
        "audio/opus" => "opus",
        "audio/ogg" => "ogg",
        "audio/mpeg" | "audio/mp3" => "mp3",
        "audio/mp4" => "m4a",
        "video/mp4" => "mp4",
        "video/quicktime" => "mov",
        _ => return None,
    };
    Some(ext.into())
}

/// Fetch one message resource into an already-allocated staging path.
async fn fetch_message_to_staging(
    client: &reqwest::Client,
    api_base: &str,
    token: &str,
    message_id: &str,
    media: &InboundMedia,
    temp_path: &Path,
    max_bytes: usize,
) -> Result<DownloadedResource, String> {
    if !is_safe_resource_id(message_id) {
        return Err("invalid message_id".into());
    }
    let url = format!(
        "{api_base}/open-apis/im/v1/messages/{message_id}/resources/{}?type={}",
        media.key, media.resource_type
    );
    let mut res = client
        .get(url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("feishu media request: {e}"))?;
    let status = res.status();
    if !status.is_success() {
        let body = res.text().await.unwrap_or_default();
        // The upstream body stays in the log; the prompt only gets the status.
        tracing::warn!(
            status = %status,
            body = %body.chars().take(160).collect::<String>(),
            "feishu media HTTP error"
        );
        return Err(format!("HTTP {status}"));
    }
    let content_type = res
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);

    let mut file = crate::attachments::create_staging_file(temp_path)
        .map_err(|e| format!("feishu media: create staging: {e}"))?;
    let mut hasher = Sha256::new();
    let mut total = 0usize;
    while let Some(chunk) = res
        .chunk()
        .await
        .map_err(|e| format!("feishu media read: {e}"))?
    {
        if total.saturating_add(chunk.len()) > max_bytes {
            drop(file);
            let _ = std::fs::remove_file(temp_path);
            return Err(format!(
                "attachment exceeds the {:.1} MB limit",
                max_bytes as f64 / (1024.0 * 1024.0)
            ));
        }
        if let Err(err) = file.write_all(&chunk) {
            drop(file);
            let _ = std::fs::remove_file(temp_path);
            return Err(format!("feishu media write: {err}"));
        }
        hasher.update(&chunk);
        total += chunk.len();
    }
    if total == 0 {
        drop(file);
        let _ = std::fs::remove_file(temp_path);
        return Err("feishu media: empty body".into());
    }
    file.sync_all()
        .map_err(|e| format!("feishu media sync: {e}"))?;

    Ok(DownloadedResource {
        size: total as u64,
        sha256: hex::encode(hasher.finalize()),
        content_type,
    })
}

#[cfg(test)]
#[path = "feishu_media_tests.rs"]
mod inbound_media_tests;
