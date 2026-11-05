use super::*;
use axum::extract::Path as AxumPath;

#[derive(Deserialize)]
pub(super) struct AttachmentQuery {
    /// Shared secret from `media_server_endpoint`.
    t: String,
    /// `thumb` or `original` (default).
    #[serde(default)]
    variant: Option<String>,
}

pub(super) async fn attachment_get(
    State(state): State<ServerState>,
    AxumPath(id): AxumPath<String>,
    Query(q): Query<AttachmentQuery>,
    req: Request<Body>,
) -> Response {
    let acao = cors_origin_from_headers(req.headers());
    if !request_origin_allowed(req.headers()) {
        return text_status_cors(StatusCode::FORBIDDEN, "origin not allowed", acao);
    }
    if !tokens_equal(state.token.as_str(), &q.t) {
        return text_status_cors(StatusCode::UNAUTHORIZED, "unauthorized", acao);
    }
    let variant = q.variant.as_deref().unwrap_or("original");
    if variant != "thumb" && variant != "original" {
        return text_status_cors(StatusCode::BAD_REQUEST, "unknown variant", acao);
    }

    let store = match crate::attachments::shared() {
        Ok(store) => store,
        Err(err) => {
            tracing::warn!(error = %err, "media server: attachment store unavailable");
            return text_status_cors(StatusCode::NOT_FOUND, "attachment not found", acao);
        }
    };
    let meta = match store.metadata(&id) {
        Ok(meta) => meta,
        Err(_) => return text_status_cors(StatusCode::NOT_FOUND, "attachment not found", acao),
    };
    let path = match store.materialize(&id) {
        Ok(path) => path,
        Err(_) => return text_status_cors(StatusCode::NOT_FOUND, "attachment not found", acao),
    };
    let path = if variant == "thumb" && meta.kind == crate::attachments::AttachmentKind::Image {
        let source = path.to_string_lossy().to_string();
        match tokio::task::spawn_blocking(move || {
            crate::image_thumb::ensure_local_image_thumb(&source)
        })
        .await
        {
            Ok(Ok(thumb)) => PathBuf::from(thumb.thumb_path),
            _ => path,
        }
    } else {
        path
    };

    let method = req.method().clone();
    let range_hdr = req
        .headers()
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let result = tokio::task::spawn_blocking(move || {
        read_file_chunk(&path, range_hdr.as_deref(), method == Method::HEAD)
    })
    .await;
    match result {
        Ok(Ok(mut chunk)) => {
            chunk.cors_origin = acao;
            chunk.into_response()
        }
        Ok(Err((status, msg))) => text_status_cors(status, msg, acao),
        Err(e) => {
            tracing::error!(error = %e, "media server: attachment join error");
            text_status_cors(StatusCode::INTERNAL_SERVER_ERROR, "internal error", acao)
        }
    }
}
