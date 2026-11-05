use super::super::outbound::http_client;
use super::feishu::{open_domain, tenant_token};
use crate::attachments::AttachmentKind;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::Path;

// Channel + credentials + destination + one media payload; splitting would add
// a wrapper struct without making call sites clearer.
#[allow(clippy::too_many_arguments)]
pub async fn send_media(
    channel: &str,
    secrets: &HashMap<String, String>,
    options: &Value,
    chat_id: &str,
    reply_to: Option<&str>,
    path: &Path,
    kind: AttachmentKind,
    name: &str,
) -> Result<(), String> {
    let meta = std::fs::metadata(path).map_err(|e| format!("media stat: {e}"))?;
    if !meta.is_file() {
        return Err("media source is not a file".into());
    }
    let max = 30 * 1024 * 1024;
    if meta.len() > max {
        return Err(format!(
            "file exceeds the Feishu upload limit ({:.0} MB)",
            max as f64 / (1024.0 * 1024.0)
        ));
    }
    let token = tenant_token(channel, secrets, options).await?;
    let domain = open_domain(channel, options);
    let base = format!("https://{domain}");
    let client = http_client()?;

    // Feishu images cap at 10 MB; larger images are uploaded as files.
    let (msg_type, content) = if kind == AttachmentKind::Image && meta.len() <= 10 * 1024 * 1024 {
        match upload_image(&client, &base, &token, path, name).await {
            Ok(image_key) => ("image", json!({ "image_key": image_key })),
            Err(err) => {
                tracing::warn!(error = %err, "feishu image upload failed; retry as file");
                let file_key = upload_file(&client, &base, &token, path, name).await?;
                ("file", json!({ "file_key": file_key }))
            }
        }
    } else {
        let file_key = upload_file(&client, &base, &token, path, name).await?;
        match kind {
            AttachmentKind::Audio => ("audio", json!({ "file_key": file_key })),
            AttachmentKind::Video => ("media", json!({ "file_key": file_key })),
            _ => ("file", json!({ "file_key": file_key })),
        }
    };

    if let Err(err) = send_native_message(
        &client, &base, &token, chat_id, reply_to, msg_type, &content,
    )
    .await
    {
        if msg_type == "audio" || msg_type == "media" {
            let file_key = upload_file(&client, &base, &token, path, name).await?;
            send_native_message(
                &client,
                &base,
                &token,
                chat_id,
                reply_to,
                "file",
                &json!({ "file_key": file_key }),
            )
            .await?;
            return Ok(());
        }
        return Err(err);
    }
    Ok(())
}

/// Stream a local file into a multipart part without loading it into memory.
async fn file_part(
    path: &Path,
    name: &str,
    mime: &str,
) -> Result<reqwest::multipart::Part, String> {
    let len = std::fs::metadata(path)
        .map_err(|e| format!("media stat: {e}"))?
        .len();
    let path = path.to_path_buf();
    let (tx, rx) = tokio::sync::mpsc::channel::<std::io::Result<Vec<u8>>>(4);
    tokio::task::spawn_blocking(move || {
        use std::io::Read;
        let mut file = match std::fs::File::open(&path) {
            Ok(file) => file,
            Err(err) => {
                let _ = tx.blocking_send(Err(err));
                return;
            }
        };
        let mut buf = vec![0u8; 64 * 1024];
        loop {
            match file.read(&mut buf) {
                Ok(0) => break,
                Ok(read) => {
                    if tx.blocking_send(Ok(buf[..read].to_vec())).is_err() {
                        break;
                    }
                }
                Err(err) => {
                    let _ = tx.blocking_send(Err(err));
                    break;
                }
            }
        }
    });
    let stream = futures_util::stream::unfold(rx, |mut rx| async move {
        rx.recv().await.map(|item| (item, rx))
    });
    reqwest::multipart::Part::stream_with_length(reqwest::Body::wrap_stream(stream), len)
        .file_name(name.to_string())
        .mime_str(mime)
        .map_err(|e| format!("media mime: {e}"))
}

async fn upload_image(
    client: &reqwest::Client,
    base: &str,
    token: &str,
    path: &Path,
    name: &str,
) -> Result<String, String> {
    let part = file_part(path, name, mime_for_name(name)).await?;
    let form = reqwest::multipart::Form::new()
        .text("image_type", "message")
        .part("image", part);
    let res = client
        .post(format!("{base}/open-apis/im/v1/images"))
        .bearer_auth(token)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("image upload: {e}"))?;
    let status = res.status();
    let body: Value = res
        .json()
        .await
        .map_err(|e| format!("image upload body: {e}"))?;
    if !status.is_success() || body.get("code").and_then(Value::as_i64) != Some(0) {
        return Err(format!(
            "image upload HTTP {status}: {}",
            upload_error(&body)
        ));
    }
    body.pointer("/data/image_key")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "image upload: missing image_key".to_string())
}

async fn upload_file(
    client: &reqwest::Client,
    base: &str,
    token: &str,
    path: &Path,
    name: &str,
) -> Result<String, String> {
    let part = file_part(path, name, "application/octet-stream").await?;
    let form = reqwest::multipart::Form::new()
        .text("file_type", file_type_for_name(name))
        .text("file_name", name.to_string())
        .part("file", part);
    let res = client
        .post(format!("{base}/open-apis/im/v1/files"))
        .bearer_auth(token)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("file upload: {e}"))?;
    let status = res.status();
    let body: Value = res
        .json()
        .await
        .map_err(|e| format!("file upload body: {e}"))?;
    if !status.is_success() || body.get("code").and_then(Value::as_i64) != Some(0) {
        return Err(format!(
            "file upload HTTP {status}: {}",
            upload_error(&body)
        ));
    }
    body.pointer("/data/file_key")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "file upload: missing file_key".to_string())
}

async fn send_native_message(
    client: &reqwest::Client,
    base: &str,
    token: &str,
    chat_id: &str,
    reply_to: Option<&str>,
    msg_type: &str,
    content: &Value,
) -> Result<(), String> {
    let payload = json!({
        "msg_type": msg_type,
        "content": content.to_string(),
    });
    let (url, body) = match reply_to.map(str::trim).filter(|id| !id.is_empty()) {
        Some(mid) => (
            format!("{base}/open-apis/im/v1/messages/{mid}/reply"),
            payload,
        ),
        None => (
            format!("{base}/open-apis/im/v1/messages?receive_id_type=chat_id"),
            json!({
                "receive_id": chat_id,
                "msg_type": msg_type,
                "content": content.to_string(),
            }),
        ),
    };
    let res = client
        .post(url)
        .bearer_auth(token)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("media message: {e}"))?;
    let status = res.status();
    let body: Value = res
        .json()
        .await
        .map_err(|e| format!("media message body: {e}"))?;
    if !status.is_success() || body.get("code").and_then(Value::as_i64) != Some(0) {
        return Err(format!(
            "media message HTTP {status}: {}",
            upload_error(&body)
        ));
    }
    Ok(())
}

fn upload_error(body: &Value) -> String {
    let msg = body
        .get("msg")
        .and_then(Value::as_str)
        .unwrap_or("upload failed");
    let code = body.get("code").and_then(Value::as_i64).unwrap_or(-1);
    format!("code={code} {msg}")
}

fn mime_for_name(name: &str) -> &'static str {
    let ext = Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        _ => "application/octet-stream",
    }
}

fn file_type_for_name(name: &str) -> &'static str {
    let ext = Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    match ext.as_str() {
        "pdf" => "pdf",
        "doc" | "docx" => "doc",
        "xls" | "xlsx" => "xls",
        "ppt" | "pptx" => "ppt",
        "mp4" | "mov" => "mp4",
        "opus" | "ogg" => "opus",
        _ => "stream",
    }
}
