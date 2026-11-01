//! 带请求体的 POST 助手（MCP `initialize` 握手用）。
//!
//! 单独成文件：`safe_https_client.rs` 已接近仓库的「≥1000 行文件」预算。

use super::*;

impl SafeHttpsClient {
    /// POST a small JSON payload to a public https endpoint.
    ///
    /// Used for the MCP `initialize` handshake. Redirects are not followed: the
    /// caller's endpoint is authoritative, and a hop would escape the policy the
    /// caller validated before the call.
    pub async fn post_json(
        &self,
        url: &Url,
        headers: HeaderMap,
        body: Bytes,
        timeout: Duration,
    ) -> Result<SafeHttpsResponse, SafeHttpsError> {
        let response = self
            .request(hyper::Method::POST, url, headers, body, timeout)
            .await?;
        reject_redirect(response.status())?;
        Ok(response)
    }
}

/// `post_json` 不跟随重定向：跟随会把调用方的 `Authorization` 重发到一个
/// 调用方从未校验过的主机。这里把 3xx 直接判为阻断。
pub(super) fn reject_redirect(status: StatusCode) -> Result<StatusCode, SafeHttpsError> {
    if status.is_redirection() {
        return Err(SafeHttpsError::new(SafeHttpsErrorKind::Blocked));
    }
    Ok(status)
}
