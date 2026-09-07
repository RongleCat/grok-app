//! HTTPS transport that validates DNS at connection time and pins the socket
//! (or proxy tunnel) to the validated public address whenever the destination
//! is resolved locally.
//!
//! `skin_net::check_hop` validates URL policy before a request. That alone is
//! not sufficient for attacker-controlled hosts: a second resolver lookup by
//! the HTTP stack can be rebound to loopback or a private network. This
//! connector performs the security lookup while opening each new connection.
//! HTTP CONNECT and `socks5` proxies receive the validated IP address, while
//! TLS SNI and the HTTP Host header retain the original hostname. `socks5h`
//! deliberately delegates DNS to the proxy, so the Host cannot inspect or pin
//! the resulting address. That mode is therefore fail-closed to fixed trusted
//! service/media domains; arbitrary discovery URLs must use a locally
//! verifiable route.

use std::fmt;
use std::future::Future;
use std::io;
use std::net::{IpAddr, SocketAddr};
use std::pin::Pin;
use std::sync::{Arc, LazyLock};
use std::task::{Context, Poll};
use std::time::{Duration, Instant};

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use bytes::Bytes;
use http_body_util::{BodyExt, Empty};
use hyper::body::Incoming;
use hyper::header::{HeaderMap, HeaderValue, ACCEPT_ENCODING, HOST, PROXY_AUTHORIZATION};
use hyper::{Request, StatusCode, Uri};
use hyper_util::client::legacy::connect::{Connected, Connection};
use hyper_util::client::legacy::Client;
use hyper_util::rt::{TokioExecutor, TokioIo};
use ipnet::IpNet;
use percent_encoding::percent_decode_str;
use rustls::pki_types::ServerName;
use rustls::{ClientConfig, RootCertStore};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, ReadBuf};
use tokio::net::TcpStream;
use tokio_rustls::TlsConnector;
use tower::Service;
use url::Url;

use crate::proxy::{self, ProxyDecision};
use crate::skin_net;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const PROXY_REPLY_LIMIT: usize = 16 * 1024;
// These are fixed service hosts, not registrable-domain suffixes. In
// particular, arbitrary GitHub Pages and githubusercontent subdomains remain
// locally resolved and pinned because their namespace is user-controlled.
const REMOTE_DNS_TRUSTED_HOSTS: &[&str] = &[
    "api.openverse.org",
    "api.pexels.com",
    "images.pexels.com",
    "pexels.com",
    "www.pexels.com",
    "pbs.twimg.com",
    "video.twimg.com",
    "ton.twimg.com",
    "abs.twimg.com",
    "cdn.grok.com",
    "assets.grok.com",
    "imagine-public.x.ai",
    "imgen.x.ai",
    "filesystem.site",
    "x.com",
    "twitter.com",
    "x.ai",
    "github.com",
    "github.io",
    "githubusercontent.com",
    "raw.githubusercontent.com",
    "release-assets.githubusercontent.com",
    "objects.githubusercontent.com",
];

type BoxError = Box<dyn std::error::Error + Send + Sync>;
type ConnectorFuture =
    Pin<Box<dyn Future<Output = Result<TokioIo<SafeIo>, BoxError>> + Send + 'static>>;

trait AsyncIo: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T> AsyncIo for T where T: AsyncRead + AsyncWrite + Unpin + Send {}

struct SafeIo {
    inner: Box<dyn AsyncIo>,
}

impl SafeIo {
    fn new<T>(inner: T) -> Self
    where
        T: AsyncRead + AsyncWrite + Unpin + Send + 'static,
    {
        Self {
            inner: Box::new(inner),
        }
    }
}

impl fmt::Debug for SafeIo {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("SafeIo")
    }
}

impl AsyncRead for SafeIo {
    fn poll_read(
        mut self: Pin<&mut Self>,
        context: &mut Context<'_>,
        buffer: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        Pin::new(&mut *self.inner).poll_read(context, buffer)
    }
}

impl AsyncWrite for SafeIo {
    fn poll_write(
        mut self: Pin<&mut Self>,
        context: &mut Context<'_>,
        buffer: &[u8],
    ) -> Poll<Result<usize, io::Error>> {
        Pin::new(&mut *self.inner).poll_write(context, buffer)
    }

    fn poll_flush(
        mut self: Pin<&mut Self>,
        context: &mut Context<'_>,
    ) -> Poll<Result<(), io::Error>> {
        Pin::new(&mut *self.inner).poll_flush(context)
    }

    fn poll_shutdown(
        mut self: Pin<&mut Self>,
        context: &mut Context<'_>,
    ) -> Poll<Result<(), io::Error>> {
        Pin::new(&mut *self.inner).poll_shutdown(context)
    }
}

impl Connection for SafeIo {
    fn connected(&self) -> Connected {
        Connected::new()
    }
}

#[derive(Clone)]
struct SafeHttpsConnector {
    route: RouteSnapshot,
}

impl fmt::Debug for SafeHttpsConnector {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("SafeHttpsConnector")
    }
}

impl Service<Uri> for SafeHttpsConnector {
    type Response = TokioIo<SafeIo>;
    type Error = BoxError;
    type Future = ConnectorFuture;

    fn poll_ready(&mut self, _context: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        Poll::Ready(Ok(()))
    }

    fn call(&mut self, destination: Uri) -> Self::Future {
        let route = self.route.clone();
        Box::pin(async move { connect_https(destination, route).await })
    }
}

#[derive(Clone)]
pub struct SafeHttpsClient {
    inner: Client<SafeHttpsConnector, Empty<Bytes>>,
}

impl Default for SafeHttpsClient {
    fn default() -> Self {
        Self::new()
    }
}

impl fmt::Debug for SafeHttpsClient {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("SafeHttpsClient")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SafeHttpsErrorKind {
    Blocked,
    Timeout,
    Network,
}

#[derive(Debug)]
pub struct SafeHttpsError {
    kind: SafeHttpsErrorKind,
}

impl SafeHttpsError {
    fn new(kind: SafeHttpsErrorKind) -> Self {
        Self { kind }
    }

    pub fn kind(&self) -> SafeHttpsErrorKind {
        self.kind
    }
}

impl fmt::Display for SafeHttpsError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self.kind {
            SafeHttpsErrorKind::Blocked => "HTTPS destination blocked",
            SafeHttpsErrorKind::Timeout => "HTTPS request timed out",
            SafeHttpsErrorKind::Network => "HTTPS request failed",
        })
    }
}

impl std::error::Error for SafeHttpsError {}

pub struct SafeHttpsResponse {
    status: StatusCode,
    headers: HeaderMap,
    body: Incoming,
    deadline: Instant,
}

impl SafeHttpsResponse {
    pub fn status(&self) -> StatusCode {
        self.status
    }

    pub fn headers(&self) -> &HeaderMap {
        &self.headers
    }

    pub fn content_length(&self) -> Option<u64> {
        self.headers
            .get(hyper::header::CONTENT_LENGTH)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse().ok())
    }

    pub async fn chunk(&mut self) -> Result<Option<Bytes>, SafeHttpsError> {
        loop {
            let frame = tokio::time::timeout_at(self.deadline.into(), self.body.frame())
                .await
                .map_err(|_| SafeHttpsError::new(SafeHttpsErrorKind::Timeout))?
                .transpose()
                .map_err(|_| SafeHttpsError::new(SafeHttpsErrorKind::Network))?;
            let Some(frame) = frame else {
                return Ok(None);
            };
            if let Ok(data) = frame.into_data() {
                return Ok(Some(data));
            }
        }
    }
}

impl SafeHttpsClient {
    pub fn new() -> Self {
        Self::with_route(route_snapshot())
    }

    fn with_route(route: RouteSnapshot) -> Self {
        Self {
            inner: Client::builder(TokioExecutor::new()).build(SafeHttpsConnector { route }),
        }
    }

    pub async fn get(
        &self,
        url: &Url,
        mut headers: HeaderMap,
        timeout: Duration,
    ) -> Result<SafeHttpsResponse, SafeHttpsError> {
        if url.scheme() != "https"
            || !url.username().is_empty()
            || url.password().is_some()
            || url.host_str().is_none()
        {
            return Err(SafeHttpsError::new(SafeHttpsErrorKind::Blocked));
        }
        headers
            .entry(ACCEPT_ENCODING)
            .or_insert(HeaderValue::from_static("identity"));
        let uri = url
            .as_str()
            .parse::<Uri>()
            .map_err(|_| SafeHttpsError::new(SafeHttpsErrorKind::Blocked))?;
        let request = build_get_request(uri, headers)?;
        let deadline = Instant::now() + timeout;
        let response = tokio::time::timeout_at(deadline.into(), self.inner.request(request))
            .await
            .map_err(|_| SafeHttpsError::new(SafeHttpsErrorKind::Timeout))?
            .map_err(|error| {
                let kind = if error_chain_has_io_kind(&error, io::ErrorKind::PermissionDenied) {
                    SafeHttpsErrorKind::Blocked
                } else if error_chain_has_io_kind(&error, io::ErrorKind::TimedOut) {
                    SafeHttpsErrorKind::Timeout
                } else {
                    SafeHttpsErrorKind::Network
                };
                SafeHttpsError::new(kind)
            })?;
        let (parts, body) = response.into_parts();
        Ok(SafeHttpsResponse {
            status: parts.status,
            headers: parts.headers,
            body,
            deadline,
        })
    }
}

fn build_get_request(
    uri: Uri,
    mut headers: HeaderMap,
) -> Result<Request<Empty<Bytes>>, SafeHttpsError> {
    // Proxy credentials belong only to the connector's CONNECT/SOCKS
    // handshake. Forwarding a caller-supplied value here would send it through
    // the encrypted tunnel to the destination origin.
    if headers.contains_key(PROXY_AUTHORIZATION) {
        return Err(SafeHttpsError::new(SafeHttpsErrorKind::Blocked));
    }
    let authority = uri
        .authority()
        .ok_or_else(|| SafeHttpsError::new(SafeHttpsErrorKind::Blocked))?;
    let host = HeaderValue::from_str(authority.as_str())
        .map_err(|_| SafeHttpsError::new(SafeHttpsErrorKind::Blocked))?;
    headers.insert(HOST, host);
    let request = Request::get(uri)
        .body(Empty::new())
        .map_err(|_| SafeHttpsError::new(SafeHttpsErrorKind::Blocked))?;
    let (mut parts, body) = request.into_parts();
    parts.headers = headers;
    Ok(Request::from_parts(parts, body))
}

fn error_chain_has_io_kind(error: &(dyn std::error::Error + 'static), kind: io::ErrorKind) -> bool {
    let mut current = Some(error);
    while let Some(error) = current {
        if error
            .downcast_ref::<io::Error>()
            .is_some_and(|error| error.kind() == kind)
        {
            return true;
        }
        current = error.source();
    }
    false
}

static SHARED_CLIENT: LazyLock<parking_lot::Mutex<Option<(RouteSnapshot, SafeHttpsClient)>>> =
    LazyLock::new(|| parking_lot::Mutex::new(None));

pub fn shared() -> SafeHttpsClient {
    let route = route_snapshot();
    let mut cached = SHARED_CLIENT.lock();
    if let Some((cached_route, client)) = cached.as_ref() {
        if cached_route == &route {
            return client.clone();
        }
    }
    let client = SafeHttpsClient::with_route(route.clone());
    *cached = Some((route, client.clone()));
    client
}

static TLS_CONFIG: LazyLock<Arc<ClientConfig>> = LazyLock::new(|| {
    let roots = RootCertStore::from_iter(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let mut config = ClientConfig::builder()
        .with_root_certificates(roots)
        .with_no_client_auth();
    config.alpn_protocols = vec![b"http/1.1".to_vec()];
    Arc::new(config)
});

async fn connect_https(
    destination: Uri,
    route: RouteSnapshot,
) -> Result<TokioIo<SafeIo>, BoxError> {
    if destination.scheme_str() != Some("https") {
        return Err(io_error(io::ErrorKind::PermissionDenied, "HTTPS required"));
    }
    let host = destination
        .host()
        .ok_or_else(|| io_error(io::ErrorKind::PermissionDenied, "missing host"))?
        .to_string();
    let port = destination.port_u16().unwrap_or(443);
    let literal_target = literal_socket_target(&host, port);
    let literal_addresses = literal_target.into_iter().collect::<Vec<_>>();
    if !literal_addresses.is_empty() {
        validate_public_addresses(literal_addresses.clone())?;
    }
    let mut proxy = proxy_for_target(&route, &host, port, &literal_addresses)?;
    let address_dependent_bypass = route
        .no_proxy
        .as_deref()
        .is_some_and(no_proxy_has_address_rule);

    let may_use_remote_dns =
        remote_dns_allowed_for_connection(&host, literal_target, address_dependent_bypass);

    if proxy.as_ref().is_some_and(proxy_uses_remote_dns) && may_use_remote_dns {
        let target = TunnelTarget::Domain {
            host: host.clone(),
            port,
        };
        let stream = connect_proxy_tunnel(proxy.as_ref().expect("proxy checked"), &target).await?;
        return tls_wrap(stream, &host).await.map(TokioIo::new);
    }

    let target_addrs = match literal_target {
        Some(address) => vec![address],
        None => resolve_public_target(&host, port).await?,
    };
    // A CIDR NO_PROXY rule can only be evaluated after local resolution.
    proxy = proxy_for_target(&route, &host, port, &target_addrs)?;
    if proxy.as_ref().is_some_and(proxy_uses_remote_dns) && may_use_remote_dns {
        let target = TunnelTarget::Domain {
            host: host.clone(),
            port,
        };
        let stream = connect_proxy_tunnel(proxy.as_ref().expect("proxy checked"), &target).await?;
        return tls_wrap(stream, &host).await.map(TokioIo::new);
    }

    let mut last_error: Option<BoxError> = None;
    for plan in connection_plans(&host, target_addrs) {
        match connect_target_once(&plan.tls_host, plan.target, proxy.as_ref()).await {
            Ok(stream) => return Ok(TokioIo::new(stream)),
            Err(error) => last_error = Some(error),
        }
    }
    Err(last_error.unwrap_or_else(|| io_error(io::ErrorKind::NotConnected, "no address")))
}

fn literal_socket_target(host: &str, port: u16) -> Option<SocketAddr> {
    host.trim_matches(['[', ']'])
        .parse::<IpAddr>()
        .ok()
        .map(|ip| SocketAddr::new(ip, port))
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ConnectionPlan {
    tls_host: String,
    target: SocketAddr,
}

fn connection_plans(host: &str, addresses: Vec<SocketAddr>) -> Vec<ConnectionPlan> {
    addresses
        .into_iter()
        .map(|target| ConnectionPlan {
            tls_host: host.to_string(),
            target,
        })
        .collect()
}

async fn resolve_public_target(host: &str, port: u16) -> Result<Vec<SocketAddr>, BoxError> {
    let addresses = tokio::net::lookup_host((host, port))
        .await
        .map_err(|_| io_error(io::ErrorKind::NotConnected, "DNS failed"))?
        .collect::<Vec<_>>();
    validate_public_addresses(addresses)
}

fn validate_public_addresses(addresses: Vec<SocketAddr>) -> Result<Vec<SocketAddr>, BoxError> {
    if addresses.is_empty() {
        return Err(io_error(io::ErrorKind::NotConnected, "DNS empty"));
    }
    if addresses
        .iter()
        .any(|address| skin_net::is_blocked_ip(address.ip()))
    {
        return Err(io_error(
            io::ErrorKind::PermissionDenied,
            "private destination blocked",
        ));
    }
    let mut unique = Vec::with_capacity(addresses.len());
    for address in addresses {
        if !unique.contains(&address) {
            unique.push(address);
        }
    }
    Ok(unique)
}

#[derive(Clone)]
struct ProxyRoute {
    url: Url,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum TunnelTarget {
    Socket(SocketAddr),
    Domain { host: String, port: u16 },
}

#[derive(Clone, PartialEq, Eq)]
struct RouteSnapshot {
    proxy_url: Option<String>,
    no_proxy: Option<String>,
}

fn route_snapshot() -> RouteSnapshot {
    match proxy::resolve().decision {
        ProxyDecision::Direct => RouteSnapshot {
            proxy_url: None,
            no_proxy: None,
        },
        ProxyDecision::Use { url, no_proxy } => RouteSnapshot {
            proxy_url: Some(url),
            no_proxy,
        },
        ProxyDecision::Inherit => RouteSnapshot {
            proxy_url: first_env(&["HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"]),
            no_proxy: first_env(&["NO_PROXY", "no_proxy"]),
        },
    }
}

/// Whether a URL is allowed to rely on an unobservable proxy-side DNS answer.
/// This is deliberately narrower than `AnyHttps`: only fixed service/media
/// domains may trade address pinning for genuine socks5h semantics.
pub(crate) fn remote_dns_preflight_allowed(url: &Url) -> bool {
    remote_dns_preflight_allowed_for_route(url, &route_snapshot())
}

fn remote_dns_preflight_allowed_for_route(url: &Url, route: &RouteSnapshot) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };
    if literal_socket_target(host, url.port_or_known_default().unwrap_or(443)).is_some() {
        return false;
    }
    if route
        .no_proxy
        .as_deref()
        .is_some_and(no_proxy_has_address_rule)
    {
        return false;
    }
    let Ok(proxy) = proxy_for_target(route, host, url.port_or_known_default().unwrap_or(443), &[])
    else {
        return false;
    };
    proxy.as_ref().is_some_and(proxy_uses_remote_dns) && validate_remote_dns_host(host).is_ok()
}

fn proxy_for_target(
    route: &RouteSnapshot,
    host: &str,
    port: u16,
    addresses: &[SocketAddr],
) -> Result<Option<ProxyRoute>, BoxError> {
    if route
        .no_proxy
        .as_deref()
        .is_some_and(|list| no_proxy_matches(host, port, addresses, list))
    {
        return Ok(None);
    }
    let Some(raw_proxy) = route.proxy_url.as_deref() else {
        return Ok(None);
    };
    if !proxy::is_valid_proxy_url(raw_proxy) {
        return Err(io_error(io::ErrorKind::InvalidInput, "invalid proxy"));
    }
    let url = Url::parse(raw_proxy)
        .map_err(|_| io_error(io::ErrorKind::InvalidInput, "invalid proxy"))?;
    Ok(Some(ProxyRoute { url }))
}

fn proxy_uses_remote_dns(route: &ProxyRoute) -> bool {
    route.url.scheme() == "socks5h"
}

fn remote_dns_allowed_for_connection(
    host: &str,
    literal_target: Option<SocketAddr>,
    address_dependent_bypass: bool,
) -> bool {
    literal_target.is_none() && !address_dependent_bypass && validate_remote_dns_host(host).is_ok()
}

fn validate_remote_dns_host(host: &str) -> Result<(), BoxError> {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    let configured_catalog_host = Url::parse(skin_net::OFFICIAL_SKIN_CATALOG_URL)
        .ok()
        .and_then(|url| url.host_str().map(str::to_ascii_lowercase));
    let trusted = REMOTE_DNS_TRUSTED_HOSTS.contains(&host.as_str())
        || configured_catalog_host.as_deref() == Some(host.as_str());
    if trusted {
        Ok(())
    } else {
        Err(io_error(
            io::ErrorKind::PermissionDenied,
            "SOCKS remote DNS destination blocked",
        ))
    }
}

fn first_env(names: &[&str]) -> Option<String> {
    names.iter().find_map(|name| {
        std::env::var(name)
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    })
}

fn no_proxy_has_address_rule(list: &str) -> bool {
    list.split(',').any(|raw| {
        let mut entry = raw.trim();
        if let Some(rest) = entry.strip_prefix('[') {
            let Some(end) = rest.find(']') else {
                return false;
            };
            entry = &rest[..end];
        } else if entry.matches(':').count() == 1 {
            if let Some((candidate, port)) = entry.rsplit_once(':') {
                if port.parse::<u16>().is_ok() {
                    entry = candidate;
                }
            }
        }
        entry.parse::<IpAddr>().is_ok() || entry.parse::<IpNet>().is_ok()
    })
}

fn no_proxy_matches(host: &str, port: u16, addresses: &[SocketAddr], list: &str) -> bool {
    let host = host.trim_matches(['[', ']']).to_ascii_lowercase();
    list.split(',').any(|raw| {
        let entry = raw.trim();
        if entry.is_empty() {
            return false;
        }
        if entry == "*" {
            return true;
        }
        let (entry, required_port) = if entry.starts_with('[') {
            let Some(end) = entry.find(']') else {
                return false;
            };
            let suffix = &entry[end + 1..];
            let required_port = suffix
                .strip_prefix(':')
                .and_then(|value| value.parse::<u16>().ok());
            (&entry[1..end], required_port)
        } else if entry.matches(':').count() == 1 {
            if let Some((name, port)) = entry.rsplit_once(':') {
                if let Ok(required_port) = port.parse::<u16>() {
                    (name, Some(required_port))
                } else {
                    (entry, None)
                }
            } else {
                (entry, None)
            }
        } else {
            (entry, None)
        };
        if required_port.is_some_and(|required| required != port) {
            return false;
        }
        if let Ok(network) = entry.parse::<IpNet>() {
            return addresses
                .iter()
                .any(|address| network.contains(&address.ip()));
        }
        if let Ok(ip) = entry.parse::<IpAddr>() {
            return addresses.iter().any(|address| address.ip() == ip);
        }
        let domain = entry
            .strip_prefix("*.")
            .unwrap_or(entry)
            .trim_start_matches('.')
            .to_ascii_lowercase();
        !domain.is_empty() && (host == domain || host.ends_with(&format!(".{domain}")))
    })
}

async fn connect_target_once(
    target_host: &str,
    target: SocketAddr,
    proxy: Option<&ProxyRoute>,
) -> Result<SafeIo, BoxError> {
    let transport = match proxy {
        None => SafeIo::new(connect_tcp(&[target]).await?),
        Some(route) => connect_proxy_tunnel(route, &TunnelTarget::Socket(target)).await?,
    };
    tls_wrap(transport, target_host).await
}

async fn connect_proxy_tunnel(
    route: &ProxyRoute,
    target: &TunnelTarget,
) -> Result<SafeIo, BoxError> {
    let scheme = route.url.scheme();
    let proxy_host = route
        .url
        .host_str()
        .ok_or_else(|| io_error(io::ErrorKind::InvalidInput, "proxy host missing"))?;
    let proxy_port = route.url.port_or_known_default().unwrap_or(match scheme {
        "socks5" | "socks5h" => 1080,
        "https" => 443,
        _ => 80,
    });
    let proxy_addrs = tokio::net::lookup_host((proxy_host, proxy_port))
        .await
        .map_err(|_| io_error(io::ErrorKind::NotConnected, "proxy DNS failed"))?
        .collect::<Vec<_>>();
    let mut stream = SafeIo::new(connect_tcp(&proxy_addrs).await?);
    if scheme == "https" {
        stream = tls_wrap(stream, proxy_host).await?;
    }
    match scheme {
        "http" | "https" => match target {
            TunnelTarget::Socket(target) => http_connect(stream, &route.url, *target).await,
            TunnelTarget::Domain { .. } => Err(io_error(
                io::ErrorKind::PermissionDenied,
                "HTTP proxy target must be validated",
            )),
        },
        "socks5" => match target {
            TunnelTarget::Socket(_) => socks5_connect(stream, &route.url, target).await,
            TunnelTarget::Domain { .. } => Err(io_error(
                io::ErrorKind::PermissionDenied,
                "SOCKS target must be validated",
            )),
        },
        "socks5h" => socks5_connect(stream, &route.url, target).await,
        _ => Err(io_error(io::ErrorKind::InvalidInput, "proxy scheme")),
    }
}

async fn connect_tcp(addresses: &[SocketAddr]) -> Result<TcpStream, BoxError> {
    if addresses.is_empty() {
        return Err(io_error(io::ErrorKind::NotConnected, "no socket address"));
    }
    let result = tokio::time::timeout(CONNECT_TIMEOUT, async {
        let mut last = None;
        for address in addresses {
            match TcpStream::connect(address).await {
                Ok(stream) => {
                    let _ = stream.set_nodelay(true);
                    return Ok(stream);
                }
                Err(error) => last = Some(error),
            }
        }
        Err(last.unwrap_or_else(|| io::Error::new(io::ErrorKind::NotConnected, "connect")))
    })
    .await
    .map_err(|_| io_error(io::ErrorKind::TimedOut, "connect timeout"))?;
    result.map_err(|_| io_error(io::ErrorKind::NotConnected, "connect failed"))
}

async fn tls_wrap(stream: SafeIo, host: &str) -> Result<SafeIo, BoxError> {
    let server_name = ServerName::try_from(host.to_string())
        .map_err(|_| io_error(io::ErrorKind::InvalidInput, "invalid TLS host"))?;
    let stream = tokio::time::timeout(
        CONNECT_TIMEOUT,
        TlsConnector::from(Arc::clone(&TLS_CONFIG)).connect(server_name, stream),
    )
    .await
    .map_err(|_| io_error(io::ErrorKind::TimedOut, "TLS timeout"))?
    .map_err(|_| io_error(io::ErrorKind::ConnectionAborted, "TLS failed"))?;
    Ok(SafeIo::new(stream))
}

async fn http_connect(
    mut stream: SafeIo,
    proxy_url: &Url,
    target: SocketAddr,
) -> Result<SafeIo, BoxError> {
    let request = http_connect_request(proxy_url, target)?;
    stream.write_all(&request).await?;
    stream.flush().await?;

    let mut reply = Vec::with_capacity(512);
    loop {
        if reply.len() == PROXY_REPLY_LIMIT {
            return Err(io_error(
                io::ErrorKind::InvalidData,
                "proxy reply too large",
            ));
        }
        let mut byte = [0_u8; 1];
        let read = stream.read(&mut byte).await?;
        if read == 0 {
            return Err(io_error(io::ErrorKind::UnexpectedEof, "proxy reply ended"));
        }
        reply.push(byte[0]);
        if reply.ends_with(b"\r\n\r\n") {
            break;
        }
    }
    let first_line = reply.split(|byte| *byte == b'\n').next().unwrap_or(&[]);
    let success = first_line.starts_with(b"HTTP/1.1 2") || first_line.starts_with(b"HTTP/1.0 2");
    if !success {
        return Err(io_error(
            io::ErrorKind::ConnectionRefused,
            "proxy CONNECT failed",
        ));
    }
    Ok(stream)
}

fn http_connect_request(proxy_url: &Url, target: SocketAddr) -> Result<Vec<u8>, BoxError> {
    let authority = socket_authority(target);
    let mut request = format!(
        "CONNECT {authority} HTTP/1.1\r\nHost: {authority}\r\nProxy-Connection: keep-alive\r\n"
    );
    if let Some(auth) = proxy_authorization(proxy_url)? {
        request.push_str("Proxy-Authorization: ");
        request.push_str(
            auth.to_str()
                .map_err(|_| io_error(io::ErrorKind::InvalidInput, "proxy authorization"))?,
        );
        request.push_str("\r\n");
    }
    request.push_str("\r\n");
    Ok(request.into_bytes())
}

async fn socks5_connect(
    mut stream: SafeIo,
    proxy_url: &Url,
    target: &TunnelTarget,
) -> Result<SafeIo, BoxError> {
    let username = decode_component(proxy_url.username());
    let password = decode_component(proxy_url.password().unwrap_or(""));
    let has_auth = !username.is_empty() || proxy_url.password().is_some();
    stream
        .write_all(if has_auth {
            &[5_u8, 2, 0, 2]
        } else {
            &[5_u8, 1, 0]
        })
        .await?;
    let mut choice = [0_u8; 2];
    stream.read_exact(&mut choice).await?;
    if choice[0] != 5 || choice[1] == 0xff {
        return Err(io_error(
            io::ErrorKind::PermissionDenied,
            "SOCKS auth method",
        ));
    }
    if choice[1] == 2 {
        if username.len() > 255 || password.len() > 255 {
            return Err(io_error(io::ErrorKind::InvalidInput, "SOCKS credentials"));
        }
        let mut auth = Vec::with_capacity(username.len() + password.len() + 3);
        auth.extend_from_slice(&[1, username.len() as u8]);
        auth.extend_from_slice(username.as_bytes());
        auth.push(password.len() as u8);
        auth.extend_from_slice(password.as_bytes());
        stream.write_all(&auth).await?;
        let mut result = [0_u8; 2];
        stream.read_exact(&mut result).await?;
        if result != [1, 0] {
            return Err(io_error(
                io::ErrorKind::PermissionDenied,
                "SOCKS auth failed",
            ));
        }
    } else if choice[1] != 0 {
        return Err(io_error(
            io::ErrorKind::PermissionDenied,
            "SOCKS auth unsupported",
        ));
    }

    let request = socks5_target_request(target)?;
    stream.write_all(&request).await?;

    let mut header = [0_u8; 4];
    stream.read_exact(&mut header).await?;
    if header[0] != 5 || header[1] != 0 {
        return Err(io_error(
            io::ErrorKind::ConnectionRefused,
            "SOCKS connect failed",
        ));
    }
    let address_bytes = match header[3] {
        1 => 4,
        4 => 16,
        3 => {
            let mut length = [0_u8; 1];
            stream.read_exact(&mut length).await?;
            length[0] as usize
        }
        _ => return Err(io_error(io::ErrorKind::InvalidData, "SOCKS reply")),
    };
    let mut discard = vec![0_u8; address_bytes + 2];
    stream.read_exact(&mut discard).await?;
    Ok(stream)
}

fn socks5_target_request(target: &TunnelTarget) -> Result<Vec<u8>, BoxError> {
    let mut request = vec![5_u8, 1, 0];
    let port = match target {
        TunnelTarget::Socket(SocketAddr::V4(target)) => {
            request.push(1);
            request.extend_from_slice(&target.ip().octets());
            target.port()
        }
        TunnelTarget::Socket(SocketAddr::V6(target)) => {
            request.push(4);
            request.extend_from_slice(&target.ip().octets());
            target.port()
        }
        TunnelTarget::Domain { host, port } => {
            if host.is_empty() || host.len() > u8::MAX as usize || !host.is_ascii() {
                return Err(io_error(io::ErrorKind::InvalidInput, "SOCKS domain"));
            }
            request.extend_from_slice(&[3, host.len() as u8]);
            request.extend_from_slice(host.as_bytes());
            *port
        }
    };
    request.extend_from_slice(&port.to_be_bytes());
    Ok(request)
}

fn proxy_authorization(url: &Url) -> Result<Option<HeaderValue>, BoxError> {
    if url.username().is_empty() && url.password().is_none() {
        return Ok(None);
    }
    let value = B64.encode(format!(
        "{}:{}",
        decode_component(url.username()),
        decode_component(url.password().unwrap_or(""))
    ));
    let mut header = HeaderValue::from_str(&format!("Basic {value}"))
        .map_err(|_| io_error(io::ErrorKind::InvalidInput, "proxy authorization"))?;
    header.set_sensitive(true);
    debug_assert_eq!(PROXY_AUTHORIZATION.as_str(), "proxy-authorization");
    Ok(Some(header))
}

fn decode_component(value: &str) -> String {
    percent_decode_str(value).decode_utf8_lossy().into_owned()
}

fn socket_authority(address: SocketAddr) -> String {
    match address.ip() {
        IpAddr::V4(ip) => format!("{ip}:{}", address.port()),
        IpAddr::V6(ip) => format!("[{ip}]:{}", address.port()),
    }
}

fn io_error(kind: io::ErrorKind, message: &'static str) -> BoxError {
    Box::new(io::Error::new(kind, message))
}

#[cfg(test)]
mod tests;
