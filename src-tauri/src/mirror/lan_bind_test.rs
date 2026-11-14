//! Verify actual loopback/wildcard binding and token checks without probing
//! a detected default-route address (which may belong to a VPN).

use super::*;

fn test_host(token: &str, dist: PathBuf, allow_lan: bool) -> Arc<MirrorHost> {
    Arc::new(MirrorHost {
        inner: Mutex::new(Inner {
            env: MirrorEnvConfig {
                headless: false,
                token: Some(token.into()),
                port: Some(0),
                no_tunnel: true,
                allow_lan,
                dist: Some(dist),
                max_clients: DEFAULT_MAX_CLIENTS,
            },
            runtime: None,
            ctx: None,
            read_only: true,
            max_clients: DEFAULT_MAX_CLIENTS,
            allow_lan,
        }),
        hub: Arc::new(ws::WsHub::new()),
    })
}

/// Check the actual OS listener against the host's requested mode, including
/// callers that accidentally pass the wrong mode into `start_server`. Every
/// start/rebind invokes this in test builds; no network route is involved.
pub(super) fn assert_actual_bind(host: &MirrorHost, bound: std::net::SocketAddr) {
    let expected = if host.inner.lock().allow_lan {
        std::net::Ipv4Addr::UNSPECIFIED
    } else {
        std::net::Ipv4Addr::LOCALHOST
    };
    assert_eq!(bound.ip(), std::net::IpAddr::V4(expected));
    assert_ne!(bound.port(), 0, "listener must have an assigned port");
}

async fn assert_token_gated_health(client: &reqwest::Client, status: &MirrorStatus) {
    // The current-thread runtime must poll the spawned server and the previous
    // listener's already-signalled shutdown before opening a fresh connection.
    tokio::task::yield_now().await;
    let port = status.local_port.expect("bound port");
    let token = status.token.as_deref().expect("token");
    let base = format!("http://127.0.0.1:{port}");
    let health = client
        .get(format!("{base}/t/{token}/api/health"))
        .send()
        .await
        .unwrap_or_else(|error| {
            panic!("loopback health (allow_lan={}): {error}", status.allow_lan)
        });
    assert_eq!(health.status().as_u16(), 200);
    let rejected = client
        .get(format!("{base}/t/incorrect-token/api/health"))
        .send()
        .await
        .expect("wrong-token health");
    assert_eq!(rejected.status().as_u16(), 401);
}

#[tokio::test]
async fn lan_bind_rebinds_actual_listener_without_default_route_dependency() {
    let dist = resolve_dist_dir(None);
    let host = test_host("lan-bind-token-0123456789abcdef01234567", dist, false);
    let client = reqwest::Client::builder()
        // Each probe must use the current listener after rebind, not a pooled
        // keep-alive connection to the listener that is shutting down.
        .pool_max_idle_per_host(0)
        .no_proxy()
        .timeout(std::time::Duration::from_secs(2))
        .build()
        .expect("client");

    let local = host.start().await.expect("start");
    assert!(!local.allow_lan);
    assert_eq!(local.lan_url, None);
    assert_eq!(
        local.public_url,
        Some(lan::local_access_url(
            false,
            local.local_port.expect("port"),
            local.token.as_deref().expect("token"),
            None,
        ))
    );
    assert_token_gated_health(&client, &local).await;

    // Always exercise opt-in, including hosts without a LAN route. The bind
    // hook checks 0.0.0.0 from TcpListener::local_addr; all HTTP probes stay local.
    let enabled = host.set_allow_lan(true).await.expect("enable lan");
    assert!(enabled.allow_lan);
    let port = enabled.local_port.expect("port after rebind");
    let token = enabled.token.as_deref().expect("token after rebind");
    let advertised_ip = host.inner.lock().runtime.as_ref().expect("runtime").lan_ip;
    assert_eq!(
        enabled.lan_url,
        advertised_ip.map(|ip| lan::mirror_path_url(&ip.to_string(), port, token))
    );
    assert_eq!(
        enabled.public_url,
        Some(lan::local_access_url(true, port, token, advertised_ip))
    );
    assert_token_gated_health(&client, &enabled).await;

    // Revocation must restore the specific loopback bind, not just change URLs.
    let disabled = host.set_allow_lan(false).await.expect("disable lan");
    assert!(!disabled.allow_lan);
    assert_eq!(disabled.lan_url, None);
    assert_eq!(
        disabled.public_url,
        Some(lan::local_access_url(
            false,
            disabled.local_port.expect("port after disable"),
            disabled.token.as_deref().expect("token after disable"),
            None,
        ))
    );
    assert_token_gated_health(&client, &disabled).await;
    host.stop().await.expect("stop");
}
