use super::*;
use std::net::{Ipv4Addr, Ipv6Addr};

#[test]
fn destination_validation_rejects_any_private_dns_answer() {
    let public = SocketAddr::new(IpAddr::V4(Ipv4Addr::new(1, 1, 1, 1)), 443);
    let private = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 443);
    assert!(validate_public_addresses(vec![public, private]).is_err());
    assert_eq!(
        validate_public_addresses(vec![public, public]).unwrap(),
        [public]
    );
}

#[test]
fn proxy_destinations_use_ip_authorities_but_keep_original_tls_name_separate() {
    let target = SocketAddr::new(IpAddr::V4(Ipv4Addr::new(203, 0, 113, 8)), 443);
    let plans = connection_plans("cdn.example", vec![target]);
    assert_eq!(
        plans,
        [ConnectionPlan {
            tls_host: "cdn.example".into(),
            target,
        }]
    );

    let proxy = Url::parse("http://proxy.example:8080").unwrap();
    let connect = String::from_utf8(http_connect_request(&proxy, target).unwrap()).unwrap();
    assert!(connect.starts_with("CONNECT 203.0.113.8:443 HTTP/1.1\r\nHost: 203.0.113.8:443\r\n"));
    assert!(!connect.contains("cdn.example"));

    let socks = socks5_target_request(&TunnelTarget::Socket(target)).unwrap();
    assert_eq!(socks, [5, 1, 0, 1, 203, 0, 113, 8, 1, 187]);
    assert!(!socks
        .windows("cdn.example".len())
        .any(|window| window == b"cdn.example"));

    assert_eq!(
        socket_authority(SocketAddr::new(IpAddr::V6(Ipv6Addr::LOCALHOST), 443)),
        "[::1]:443"
    );
}

#[test]
fn proxy_dns_mode_is_scheme_specific() {
    for (scheme, expected) in [
        ("http", false),
        ("https", false),
        ("socks5", false),
        ("socks5h", true),
    ] {
        let route = ProxyRoute {
            url: Url::parse(&format!("{scheme}://proxy.example:1080")).unwrap(),
        };
        assert_eq!(proxy_uses_remote_dns(&route), expected, "{scheme}");
    }
}

#[test]
fn socks5h_encodes_the_original_hostname() {
    let request = socks5_target_request(&TunnelTarget::Domain {
        host: "cdn.grok.com".into(),
        port: 443,
    })
    .unwrap();
    let mut expected = vec![5, 1, 0, 3, 12];
    expected.extend_from_slice(b"cdn.grok.com");
    expected.extend_from_slice(&443_u16.to_be_bytes());
    assert_eq!(request, expected);
}

#[test]
fn socks5h_remote_dns_is_fail_closed_to_trusted_domains() {
    assert!(validate_remote_dns_host("api.pexels.com").is_ok());
    assert!(validate_remote_dns_host("images.pexels.com").is_ok());
    assert!(validate_remote_dns_host("pbs.twimg.com").is_ok());
    assert!(validate_remote_dns_host("release-assets.githubusercontent.com").is_ok());
    assert!(validate_remote_dns_host("attacker.example").is_err());
    assert!(validate_remote_dns_host("pexels.com.attacker.example").is_err());
    assert!(validate_remote_dns_host("attacker.github.io").is_err());
    assert!(validate_remote_dns_host("attacker.githubusercontent.com").is_err());
    assert!(validate_remote_dns_host("raw.githubusercontent.com").is_ok());
    assert!(validate_remote_dns_host("attacker.raw.githubusercontent.com").is_err());
    assert!(validate_remote_dns_host("imagine-public.x.ai").is_ok());
    assert!(validate_remote_dns_host("attacker.x.ai").is_err());
}

#[test]
fn address_dependent_no_proxy_disables_remote_dns_after_resolution() {
    assert!(remote_dns_allowed_for_connection(
        "api.pexels.com",
        None,
        false
    ));
    assert!(!remote_dns_allowed_for_connection(
        "api.pexels.com",
        None,
        true
    ));
}

#[test]
fn remote_dns_preflight_respects_no_proxy_and_route_scheme() {
    let url = Url::parse("https://api.pexels.com/v1/search").unwrap();
    let socks = RouteSnapshot {
        proxy_url: Some("socks5h://127.0.0.1:1080".into()),
        no_proxy: None,
    };
    let ordinary_socks = RouteSnapshot {
        proxy_url: Some("socks5://127.0.0.1:1080".into()),
        no_proxy: None,
    };
    let bypassed = RouteSnapshot {
        proxy_url: socks.proxy_url.clone(),
        no_proxy: Some("api.pexels.com".into()),
    };
    let host = url.host_str().unwrap();
    let port = url.port_or_known_default().unwrap();

    assert!(remote_dns_preflight_allowed_for_route(&url, &socks));
    assert!(!remote_dns_preflight_allowed_for_route(
        &Url::parse("https://attacker.example/image.jpg").unwrap(),
        &socks
    ));
    assert!(!remote_dns_preflight_allowed_for_route(
        &url,
        &ordinary_socks
    ));
    assert!(!remote_dns_preflight_allowed_for_route(&url, &bypassed));
    assert!(proxy_for_target(&socks, host, port, &[])
        .unwrap()
        .as_ref()
        .is_some_and(proxy_uses_remote_dns));
    assert!(!proxy_for_target(&ordinary_socks, host, port, &[])
        .unwrap()
        .as_ref()
        .is_some_and(proxy_uses_remote_dns));
    assert!(proxy_for_target(&bypassed, host, port, &[])
        .unwrap()
        .is_none());
    assert!(no_proxy_has_address_rule("10.0.0.0/8,192.0.2.1:443"));
    assert!(no_proxy_has_address_rule("[2001:db8::1]:443"));
    assert!(!no_proxy_has_address_rule("localhost,.example.com"));

    let cidr_bypass = RouteSnapshot {
        proxy_url: socks.proxy_url,
        no_proxy: Some("203.0.113.0/24".into()),
    };
    assert!(!remote_dns_preflight_allowed_for_route(&url, &cidr_bypass));
}

#[test]
fn direct_route_has_no_proxy_tunnel() {
    let direct = RouteSnapshot {
        proxy_url: None,
        no_proxy: None,
    };
    assert!(proxy_for_target(&direct, "example.com", 443, &[])
        .unwrap()
        .is_none());
}

#[test]
fn literal_targets_are_parsed_without_dns() {
    assert_eq!(
        literal_socket_target("1.1.1.1", 443),
        Some("1.1.1.1:443".parse().unwrap())
    );
    assert_eq!(
        literal_socket_target("[2606:4700:4700::1111]", 443),
        Some("[2606:4700:4700::1111]:443".parse().unwrap())
    );
    assert_eq!(literal_socket_target("api.pexels.com", 443), None);
}

#[test]
fn no_proxy_matches_domains_ips_cidr_and_optional_ports() {
    let addresses = [SocketAddr::new(
        IpAddr::V4(Ipv4Addr::new(203, 0, 113, 8)),
        443,
    )];
    assert!(no_proxy_matches(
        "cdn.example.com",
        443,
        &addresses,
        ".example.com"
    ));
    assert!(no_proxy_matches(
        "cdn.example.com",
        443,
        &addresses,
        "*.example.com"
    ));
    assert!(!no_proxy_matches(
        "notexample.com",
        443,
        &addresses,
        "example.com"
    ));
    assert!(no_proxy_matches(
        "cdn.example.com",
        443,
        &addresses,
        "203.0.113.0/24"
    ));
    assert!(no_proxy_matches(
        "cdn.example.com",
        443,
        &addresses,
        "cdn.example.com:443"
    ));
    assert!(!no_proxy_matches(
        "cdn.example.com",
        8443,
        &addresses,
        "cdn.example.com:443"
    ));
}

#[test]
fn request_keeps_the_original_http_host() {
    let uri = "https://cdn.example:8443/image.jpg".parse().unwrap();
    let mut headers = HeaderMap::new();
    headers.insert(HOST, HeaderValue::from_static("forged.example"));
    let request = build_get_request(uri, headers).unwrap();
    assert_eq!(request.headers().get(HOST).unwrap(), "cdn.example:8443");
}

#[test]
fn request_rejects_caller_supplied_proxy_authorization() {
    let uri = "https://cdn.example/image.jpg".parse().unwrap();
    let mut headers = HeaderMap::new();
    headers.insert(
        PROXY_AUTHORIZATION,
        HeaderValue::from_static("Basic sentinel-proxy-credential"),
    );

    let error = build_get_request(uri, headers).expect_err("proxy credentials must stay hop-only");

    assert_eq!(error.kind(), SafeHttpsErrorKind::Blocked);
}
