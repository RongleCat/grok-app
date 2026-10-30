//! MCP 厂商标识：从 Target 的注册域抓取站点图标，统一成最长边 ≤64 px 的 PNG / SVG data URL。
//!
//! 图标只是识别辅助，因此所有失败都收敛成 [`McpIconSource::None`]，不向上抛错。
//! Target 可能带 OAuth 回调参数或密钥，所以缓存键与网络请求都只用注册域，
//! 任何日志、缓存文件、返回值都不出现 Target 原文。
//!
//! 下载统一走 [`crate::skin_net`] 的安全 HTTPS 客户端（DNS 校验 + 私网拦截）。

use std::collections::HashSet;
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use bytes::Bytes;
use hyper::header::{HeaderMap, HeaderName, HeaderValue, ACCEPT, CONTENT_TYPE};
use image::imageops::FilterType;
use image::{DynamicImage, ImageFormat, ImageReader, Limits};
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use url::Url;

use crate::extensions::list_mcp_server_defs;
use crate::paths;
use crate::skin_net::{self, OriginPolicy};

/// 站点根文档上限：只看 `<head>` 里的 `<link>`，256 KiB 足够覆盖声明。
const SITE_DOC_MAX_BYTES: u64 = 256 * 1024;
/// 单个图标候选上限，与 ADR 0006 的安全边界一致。
const ICON_MAX_BYTES: u64 = 512 * 1024;
/// SVG 原样返回，但仍要限制体积，避免把巨型 SVG 塞进 data URL。
const SVG_MAX_BYTES: usize = 256 * 1024;
/// 统一输出边长；设置页按 32–40 px 显示，2× 屏足够。
const ICON_MAX_EDGE: u32 = 64;
const ICON_DECODE_MAX_DIMENSION: u32 = 4_096;
const ICON_DECODE_MAX_PIXELS: u64 = 16_000_000;
const ICON_DECODE_MAX_ALLOC: u64 = 64 * 1024 * 1024;
/// 整轮解析（站点文档 + 全部候选）的总预算；单次请求自身的超时更长，
/// 这里靠外层 timeout 取消，避免慢域名拖住设置页。
const RESOLVE_TOTAL_TIMEOUT: Duration = Duration::from_secs(8);
/// `initialize` 只用来读 `serverInfo.icons`；服务器慢或要鉴权时尽快回落。
const SERVER_INFO_TIMEOUT: Duration = Duration::from_secs(4);
/// initialize 响应只需容纳 serverInfo，小体积足够。
const SERVER_INFO_MAX_BYTES: usize = 64 * 1024;
/// 服务器可以用 `data:` 直接内联图标；限制类型与体积后再交给 `<img>`。
const SERVER_ICON_DATA_URL_MAX_BYTES: usize = 256 * 1024;
const SERVER_ICON_MAX_COUNT: usize = 8;
const SUCCESS_TTL_SECS: u64 = 30 * 24 * 60 * 60;
const NONE_TTL_SECS: u64 = 7 * 24 * 60 * 60;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum McpIconSource {
    /// MCP `initialize` 的 `serverInfo.icons`（厂商自报，优先级最高）。
    Server,
    Site,
    Favicon,
    None,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpIconResult {
    pub data_url: Option<String>,
    pub domain: Option<String>,
    pub source: McpIconSource,
    pub from_cache: bool,
}

impl McpIconResult {
    fn unresolved() -> Self {
        Self {
            data_url: None,
            domain: None,
            source: McpIconSource::None,
            from_cache: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct IconTarget {
    /// 原始 Target URL，仅用于对 MCP 服务器做 `initialize`（不落盘、不打日志）。
    url: String,
    host: String,
    domain: String,
}

/// 缓存条目只保存域名与图标；`fetched_at` 为 Unix 秒。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CacheEntry {
    domain: String,
    data_url: Option<String>,
    source: McpIconSource,
    fetched_at: u64,
}

impl CacheEntry {
    /// 缓存文件可被本地进程改写，读回时按外部输入校验，避免把任意字符串
    /// 当作 data URL 交给前端 `<img>`。
    fn is_sane(&self) -> bool {
        let domain_ok = !self.domain.is_empty()
            && self.domain.len() <= 253
            && self
                .domain
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '.'));
        if !domain_ok {
            return false;
        }
        match (&self.data_url, self.source) {
            (None, McpIconSource::None) => true,
            (Some(url), source) if source != McpIconSource::None => {
                let allowed_prefix = url.starts_with("data:image/png;base64,")
                    || url.starts_with("data:image/svg+xml;base64,");
                allowed_prefix && url.len() <= 2 * 1024 * 1024
            }
            _ => false,
        }
    }
}

#[derive(Debug, Clone)]
struct SiteIconCandidate {
    url: String,
    apple_touch: bool,
    svg: bool,
    size: u32,
    order: usize,
}

/// Target → 主机 + 注册域。这里的拒绝条件只做快速剪枝；私网解析由
/// `skin_net` 在每次请求前校验。
fn parse_target(target: &str) -> Option<IconTarget> {
    let url = Url::parse(target.trim()).ok()?;
    if url.scheme() != "https" {
        return None;
    }
    if !url.username().is_empty() || url.password().is_some() {
        return None;
    }
    let host = url.host_str()?.trim_end_matches('.').to_ascii_lowercase();
    // 图标只对域名有意义；IP 字面量（含私网）直接拒绝，不依赖 DNS 层兜底。
    if host.parse::<std::net::IpAddr>().is_ok() {
        return None;
    }
    let valid_host = host.contains('.')
        && !host.starts_with('.')
        && host != "localhost"
        && !host.ends_with(".localhost")
        && !host.ends_with(".local");
    if !valid_host {
        return None;
    }
    // 注册域必须被 PSL 认可。`https://github.io/mcp` 这类「主机名本身就是公共后缀」
    // 的 Target 会让域策略覆盖所有租户，直接拒绝而不是退化成 host。
    let domain = psl::domain_str(&host)?.to_ascii_lowercase();
    Some(IconTarget {
        url: url.to_string(),
        host,
        domain,
    })
}

/// 用 Public Suffix List 求注册域；列表不认识的 TLD 回退到主机名本身，
/// 保证自定义内网域名也能尝试取 `favicon.ico`。
fn registrable_domain(host: &str) -> String {
    let host = host.trim().trim_matches('.').to_ascii_lowercase();
    match psl::domain_str(&host) {
        Some(domain) if !domain.is_empty() => domain.to_string(),
        _ => host,
    }
}

fn resolve_https_url(base: &Url, raw: &str) -> Option<String> {
    let url = base.join(raw.trim()).ok()?;
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
        return None;
    }
    url.host_str()?;
    Some(url.to_string())
}

fn largest_declared_size(sizes: Option<&str>) -> u32 {
    sizes
        .unwrap_or("")
        .split_ascii_whitespace()
        .filter_map(|token| {
            let (width, height) = token.split_once('x')?;
            let width = width.trim().parse::<u32>().ok()?;
            let height = height.trim().parse::<u32>().ok()?;
            Some(width.min(height))
        })
        .max()
        .unwrap_or(0)
}

fn url_stays_on_domain(url: &Url, domain: &str) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };
    registrable_domain(&host.to_ascii_lowercase()) == domain
}

/// 按「svg → apple-touch-icon → 声明尺寸（大到小）→ 文档顺序」排序并去重。
///
/// 只保留仍在该注册域上的候选：厂商页面若把图标放在第三方 CDN，
/// 宁可回落到 `/favicon.ico`，也不把用户配置了哪些 MCP 厂商发给第三方。
fn extract_site_icon_urls(base: &Url, html: &str, domain: &str) -> Vec<String> {
    let document = Html::parse_document(html);
    let selector = Selector::parse("link").expect("static link selector");
    let mut candidates: Vec<SiteIconCandidate> = Vec::new();
    for (order, element) in document.select(&selector).enumerate() {
        let attrs = element.value();
        let rel = attrs.attr("rel").unwrap_or("").to_ascii_lowercase();
        let tokens: Vec<&str> = rel.split_ascii_whitespace().collect();
        let apple_touch = tokens
            .iter()
            .any(|token| token.starts_with("apple-touch-icon"));
        let has_icon = tokens.contains(&"icon");
        if !has_icon && !apple_touch {
            continue;
        }
        let Some(href) = attrs.attr("href") else {
            continue;
        };
        let Some(url) = resolve_https_url(base, href) else {
            continue;
        };
        let Ok(parsed) = Url::parse(&url) else {
            continue;
        };
        if !url_stays_on_domain(&parsed, domain) {
            continue;
        }
        candidates.push(SiteIconCandidate {
            url,
            apple_touch,
            svg: attrs
                .attr("type")
                .is_some_and(|value| value.to_ascii_lowercase().contains("svg")),
            size: largest_declared_size(attrs.attr("sizes")),
            order,
        });
    }
    candidates.sort_by_key(|candidate| {
        (
            !candidate.svg,
            !candidate.apple_touch,
            std::cmp::Reverse(candidate.size),
            candidate.order,
        )
    });
    let mut seen = HashSet::new();
    candidates
        .into_iter()
        .filter(|candidate| seen.insert(candidate.url.clone()))
        .map(|candidate| candidate.url)
        .collect()
}

/// 有些站点把 SVG 当 `image/x-icon` 或直接给二进制流，因此既看声明也嗅探正文。
fn looks_like_svg(content_type: Option<&str>, bytes: &[u8]) -> bool {
    if content_type.is_some_and(|value| value.to_ascii_lowercase().contains("svg")) {
        return true;
    }
    let body = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
    let head_len = body.len().min(512);
    let head = String::from_utf8_lossy(&body[..head_len]).to_ascii_lowercase();
    let head = head.trim_start();
    head.starts_with("<svg") || (head.starts_with("<?xml") && head.contains("<svg"))
}

fn decode_icon_image(bytes: &[u8]) -> Option<DynamicImage> {
    let mut limits = Limits::default();
    limits.max_image_width = Some(ICON_DECODE_MAX_DIMENSION);
    limits.max_image_height = Some(ICON_DECODE_MAX_DIMENSION);
    limits.max_alloc = Some(ICON_DECODE_MAX_ALLOC);

    // 先只读头部拿尺寸，超过像素上限就不解码，防「小文件、巨尺寸」的图标炸弹。
    let mut dimensions_reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .ok()?;
    dimensions_reader.limits(limits.clone());
    let (width, height) = dimensions_reader.into_dimensions().ok()?;
    let pixels = u64::from(width).saturating_mul(u64::from(height));
    if pixels == 0 || pixels > ICON_DECODE_MAX_PIXELS {
        return None;
    }

    let mut decode_reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .ok()?;
    decode_reader.limits(limits);
    decode_reader.decode().ok()
}

fn encode_png_fitted(image: &DynamicImage) -> Option<Vec<u8>> {
    // 只缩不放：小图标保持原尺寸，避免把 16×16 放大成像素块、平白增大 data URL。
    // `resize` 等比缩放并保留 RGBA 透明通道。
    let fitted = if image.width() > ICON_MAX_EDGE || image.height() > ICON_MAX_EDGE {
        image.resize(ICON_MAX_EDGE, ICON_MAX_EDGE, FilterType::Triangle)
    } else {
        image.clone()
    };
    let mut png = Cursor::new(Vec::new());
    fitted.write_to(&mut png, ImageFormat::Png).ok()?;
    Some(png.into_inner())
}

fn png_data_url_from_icon(bytes: &[u8]) -> Option<String> {
    let image = decode_icon_image(bytes)?;
    let png = encode_png_fitted(&image)?;
    Some(format!("data:image/png;base64,{}", BASE64.encode(png)))
}

/// SVG 原样保留（矢量在任何尺寸都清晰），位图统一缩到最长边 ≤64 px 的 PNG。
fn icon_data_url(content_type: Option<&str>, bytes: &[u8]) -> Option<String> {
    if bytes.is_empty() {
        return None;
    }
    if looks_like_svg(content_type, bytes) {
        if bytes.len() > SVG_MAX_BYTES {
            return None;
        }
        return Some(format!(
            "data:image/svg+xml;base64,{}",
            BASE64.encode(bytes)
        ));
    }
    png_data_url_from_icon(bytes)
}

fn cache_ttl(entry: &CacheEntry) -> u64 {
    if entry.data_url.is_some() {
        SUCCESS_TTL_SECS
    } else {
        NONE_TTL_SECS
    }
}

fn cache_is_fresh(entry: &CacheEntry, now: u64) -> bool {
    now.saturating_sub(entry.fetched_at) < cache_ttl(entry)
}

fn short_hash(value: &str) -> String {
    let digest = Sha256::digest(value.as_bytes());
    digest
        .iter()
        .take(20)
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// 缓存按「域名 + 服务器名」定位：同一域名下两个服务器可以各自声明不同图标。
/// 服务器名来自用户配置，不含 Target 的路径或查询参数。
fn cache_path_for(domain: &str, server_name: Option<&str>) -> PathBuf {
    let name = server_name.map(str::trim).unwrap_or("");
    paths::mcp_icons_dir().join(format!("{}.json", short_hash(&format!("{domain}\0{name}"))))
}

fn read_cache(path: &Path) -> Option<CacheEntry> {
    let raw = fs::read_to_string(path).ok()?;
    let entry: CacheEntry = serde_json::from_str(&raw).ok()?;
    entry.is_sane().then_some(entry)
}

fn write_cache(path: &Path, entry: &CacheEntry) {
    let Some(parent) = path.parent() else {
        return;
    };
    if fs::create_dir_all(parent).is_err() {
        return;
    }
    let Ok(raw) = serde_json::to_vec(entry) else {
        return;
    };
    let tmp = path.with_extension("json.partial");
    if fs::write(&tmp, raw).is_err() {
        return;
    }
    if fs::rename(&tmp, path).is_err() {
        let _ = fs::remove_file(&tmp);
    }
}

fn unix_now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or(0)
}

fn is_html_content_type(content_type: Option<&str>) -> bool {
    content_type
        .unwrap_or("")
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .eq_ignore_ascii_case("text/html")
}

fn vendor_policy(domain: &str) -> OriginPolicy {
    OriginPolicy::SameRegistrableDomain {
        domain: domain.to_string(),
    }
}

/// 站点声明取不到时的回落顺序：注册域 `/favicon.ico` → 原始主机 `/favicon.ico`。
fn fallback_icon_candidates(target: &IconTarget) -> Vec<(String, McpIconSource)> {
    let mut out = vec![(
        format!("https://{}/favicon.ico", target.domain),
        McpIconSource::Favicon,
    )];
    if target.host != target.domain {
        out.push((
            format!("https://{}/favicon.ico", target.host),
            McpIconSource::Favicon,
        ));
    }
    out
}

async fn fetch_site_document(domain: &str) -> Option<(Url, String)> {
    let start = format!("https://{domain}/");
    let response = match skin_net::safe_https_get_browser_document_response(
        &start,
        vendor_policy(domain),
        SITE_DOC_MAX_BYTES,
    )
    .await
    {
        Ok(response) => response,
        Err(error) => {
            // 取不到站点文档是常见情况（无页面、403、超时），只记域名，不记 Target。
            tracing::debug!(domain, error = %error, "mcp_icon: site document unavailable");
            return None;
        }
    };
    if !is_html_content_type(response.content_type.as_deref()) {
        return None;
    }
    // 缺 charset 的站点可能不是 UTF-8，宽松解码只影响属性文本，不影响后续 URL 校验。
    let html = String::from_utf8_lossy(&response.bytes).into_owned();
    Some((response.final_url, html))
}

async fn download_icon_data_url(url: &str, domain: &str) -> Option<String> {
    let bytes =
        match skin_net::safe_https_get(url, vendor_policy(domain), ICON_MAX_BYTES, None).await {
            Ok(bytes) => bytes,
            Err(error) => {
                // 单个候选失败属正常（404 / 非图片 / 超限），继续下一个候选。
                tracing::debug!(error = %error, "mcp_icon: candidate download skipped");
                return None;
            }
        };
    icon_data_url(None, &bytes)
}

fn is_allowed_server_icon_data_url(value: &str) -> bool {
    const PREFIXES: &[&str] = &[
        "data:image/png;base64,",
        "data:image/jpeg;base64,",
        "data:image/webp;base64,",
        "data:image/svg+xml;base64,",
        "data:image/x-icon;base64,",
        "data:image/vnd.microsoft.icon;base64,",
    ];
    value.len() <= SERVER_ICON_DATA_URL_MAX_BYTES
        && PREFIXES.iter().any(|prefix| value.starts_with(prefix))
}

fn icon_sources_from_json(value: &serde_json::Value) -> Vec<String> {
    let icons = value
        .get("result")
        .and_then(|result| result.get("serverInfo"))
        .and_then(|info| info.get("icons"))
        .and_then(|icons| icons.as_array());
    let Some(icons) = icons else {
        return Vec::new();
    };
    let mut out: Vec<String> = Vec::new();
    for icon in icons.iter().take(SERVER_ICON_MAX_COUNT) {
        let Some(src) = icon.get("src").and_then(|src| src.as_str()).map(str::trim) else {
            continue;
        };
        let allowed = if src.starts_with("data:image/") {
            is_allowed_server_icon_data_url(src)
        } else {
            Url::parse(src)
                .map(|url| {
                    url.scheme() == "https"
                        && url.host_str().is_some()
                        && url.username().is_empty()
                        && url.password().is_none()
                })
                .unwrap_or(false)
        };
        if allowed && !out.iter().any(|seen| seen == src) {
            out.push(src.to_string());
        }
    }
    out
}

/// MCP 服务器的 `initialize` 回复可能是普通 JSON，也可能是 SSE 帧。
fn parse_server_icon_sources(body: &[u8]) -> Vec<String> {
    let text = String::from_utf8_lossy(body);
    let trimmed = text.trim_start_matches('\u{feff}').trim_start();
    if trimmed.starts_with('{') {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
            return icon_sources_from_json(&value);
        }
    }
    for line in text.lines() {
        let Some(payload) = line.trim_start().strip_prefix("data:") else {
            continue;
        };
        let Ok(value) = serde_json::from_str::<serde_json::Value>(payload.trim()) else {
            continue;
        };
        let icons = icon_sources_from_json(&value);
        if !icons.is_empty() {
            return icons;
        }
    }
    Vec::new()
}

/// 从已保存的 MCP 配置里取该服务器的请求头（Authorization / x-api-key 等）。
/// 这些头只放在这一次 initialize 请求里，不进入缓存或返回值。
fn server_initialize_headers(server_name: Option<&str>) -> HeaderMap {
    let mut headers = HeaderMap::new();
    let name = server_name.map(str::trim).filter(|name| !name.is_empty());
    let Some(name) = name else {
        return headers;
    };
    let defs = list_mcp_server_defs(None);
    let Some(def) = defs.iter().find(|def| def.name == name) else {
        return headers;
    };
    for (key, value) in def.headers.iter().flatten() {
        let Ok(header_name) = HeaderName::from_bytes(key.trim().as_bytes()) else {
            continue;
        };
        let Ok(header_value) = HeaderValue::from_str(value.trim()) else {
            continue;
        };
        headers.insert(header_name, header_value);
    }
    headers
}

/// 问 MCP 服务器自己要图标：`initialize` → `result.serverInfo.icons`。
///
/// 只对 https Target 生效（stdio 服务器需要真正启动进程，设置页不做这件事）。
/// 未鉴权的服务器通常直接 401，调用方随后回落到站点图标。
async fn declared_server_icons(server_name: Option<&str>, target: &IconTarget) -> Vec<String> {
    let Ok(url) = Url::parse(&target.url) else {
        return Vec::new();
    };
    // 配置读取可能触发 `grok mcp list`，放到阻塞线程池，避免占住异步 worker。
    let name = server_name.map(str::to_string);
    let mut headers =
        tokio::task::spawn_blocking(move || server_initialize_headers(name.as_deref()))
            .await
            .unwrap_or_default();
    headers
        .entry(CONTENT_TYPE)
        .or_insert(HeaderValue::from_static("application/json"));
    headers.entry(ACCEPT).or_insert(HeaderValue::from_static(
        "application/json, text/event-stream",
    ));
    let body = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2025-11-25",
            "capabilities": {},
            "clientInfo": {
                "name": "grok-app",
                "version": env!("CARGO_PKG_VERSION"),
            },
        },
    })
    .to_string();

    let mut response = match crate::safe_https_client::shared()
        .post_json(&url, headers, Bytes::from(body), SERVER_INFO_TIMEOUT)
        .await
    {
        Ok(response) => response,
        Err(error) => {
            tracing::debug!(error = %error, "mcp_icon: initialize skipped");
            return Vec::new();
        }
    };
    if !response.status().is_success() {
        return Vec::new();
    }
    let mut bytes: Vec<u8> = Vec::new();
    loop {
        match response.chunk().await {
            Ok(Some(chunk)) => {
                if bytes.len() + chunk.len() > SERVER_INFO_MAX_BYTES {
                    return Vec::new();
                }
                bytes.extend_from_slice(&chunk);
            }
            Ok(None) => break,
            Err(_) => return Vec::new(),
        }
    }
    parse_server_icon_sources(&bytes)
}

/// 服务器自报的图标可能是 `data:` 内联，也可能在厂商 CDN 上。
async fn server_icon_data_url(src: &str) -> Option<String> {
    if src.starts_with("data:image/") {
        return is_allowed_server_icon_data_url(src).then(|| src.to_string());
    }
    let bytes = skin_net::safe_https_get(src, OriginPolicy::AnyHttps, ICON_MAX_BYTES, None)
        .await
        .ok()?;
    icon_data_url(None, &bytes)
}

/// 候选顺序：`serverInfo.icons`（厂商自报）→ 站点声明的图标 →
/// 注册域 `/favicon.ico` → 原始主机 `/favicon.ico`。
/// 只有注册域根文档能提供 `<link>` 候选；MCP 子域通常没有站点页面。
async fn resolve_remote(
    target: &IconTarget,
    server_name: Option<&str>,
) -> Option<(String, McpIconSource)> {
    for src in declared_server_icons(server_name, target).await {
        if let Some(data_url) = server_icon_data_url(&src).await {
            return Some((data_url, McpIconSource::Server));
        }
    }
    let mut candidates: Vec<(String, McpIconSource)> = Vec::new();
    if let Some((base, html)) = fetch_site_document(&target.domain).await {
        candidates.extend(
            extract_site_icon_urls(&base, &html, &target.domain)
                .into_iter()
                .map(|url| (url, McpIconSource::Site)),
        );
    }
    candidates.extend(fallback_icon_candidates(target));

    for (url, source) in candidates {
        if let Some(data_url) = download_icon_data_url(&url, &target.domain).await {
            return Some((data_url, source));
        }
    }
    None
}

/// 过期后重取失败时的回落：只沿用真正带图标的旧条目，且标记为缓存命中。
fn stale_icon_fallback(cached: Option<CacheEntry>) -> Option<McpIconResult> {
    cached
        .filter(|entry| entry.data_url.is_some())
        .map(result_from_cache)
}

fn result_from_cache(entry: CacheEntry) -> McpIconResult {
    McpIconResult {
        data_url: entry.data_url,
        domain: Some(entry.domain),
        source: entry.source,
        from_cache: true,
    }
}

pub async fn resolve_mcp_icon(target: &str, server_name: Option<&str>) -> McpIconResult {
    let Some(parsed) = parse_target(target) else {
        return McpIconResult::unresolved();
    };
    let path = cache_path_for(&parsed.domain, server_name);
    let now = unix_now_secs();
    let cached = read_cache(&path);
    if let Some(entry) = cached.as_ref() {
        if cache_is_fresh(entry, now) {
            return result_from_cache(entry.clone());
        }
    }

    let resolved =
        tokio::time::timeout(RESOLVE_TOTAL_TIMEOUT, resolve_remote(&parsed, server_name))
            .await
            .ok()
            .flatten();

    match resolved {
        Some((data_url, source)) => {
            let entry = CacheEntry {
                domain: parsed.domain.clone(),
                data_url: Some(data_url.clone()),
                source,
                fetched_at: now,
            };
            write_cache(&path, &entry);
            McpIconResult {
                data_url: Some(data_url),
                domain: Some(parsed.domain),
                source,
                from_cache: false,
            }
        }
        None => {
            // 厂商临时故障或超时不应让已有图标闪回字母徽标：沿用旧缓存，不改写时间戳。
            // 前端会把结果缓存在内存里，所以同一会话只重试一次；下次启动或 30 天后再试。
            if let Some(stale) = stale_icon_fallback(cached) {
                return stale;
            }
            let entry = CacheEntry {
                domain: parsed.domain.clone(),
                data_url: None,
                source: McpIconSource::None,
                fetched_at: now,
            };
            write_cache(&path, &entry);
            McpIconResult {
                data_url: None,
                domain: Some(parsed.domain),
                source: McpIconSource::None,
                from_cache: false,
            }
        }
    }
}

#[cfg(test)]
mod tests;
