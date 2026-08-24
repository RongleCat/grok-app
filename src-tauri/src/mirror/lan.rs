//! LAN bind helpers for the phone-mirror host.
//!
//! Default bind stays loopback (`127.0.0.1`). Opt-in LAN (`0.0.0.0`) is token-gated
//! still, but HTTP is unencrypted — the Connect panel must confirm before enabling.

use std::net::{IpAddr, Ipv4Addr, SocketAddr, UdpSocket};

/// IPv4s that are usable as a phone-facing LAN URL host.
pub fn is_usable_lan_ipv4(ip: Ipv4Addr) -> bool {
    !ip.is_unspecified()
        && !ip.is_loopback()
        && !ip.is_link_local()
        && !ip.is_multicast()
        && !ip.is_broadcast()
}

/// Lower is better. Prefer typical home Wi-Fi ranges.
pub fn rank_lan_ipv4(ip: Ipv4Addr) -> u8 {
    let o = ip.octets();
    if o[0] == 192 && o[1] == 168 {
        0
    } else if o[0] == 10 {
        1
    } else if o[0] == 172 && (16..=31).contains(&o[1]) {
        2
    } else {
        3
    }
}

pub fn pick_lan_ipv4(ips: impl IntoIterator<Item = Ipv4Addr>) -> Option<Ipv4Addr> {
    ips.into_iter()
        .filter(|ip| is_usable_lan_ipv4(*ip))
        .min_by_key(|ip| rank_lan_ipv4(*ip))
}

/// Bind address for the HTTP listener.
pub fn listen_ip(allow_lan: bool) -> Ipv4Addr {
    if allow_lan {
        Ipv4Addr::UNSPECIFIED
    } else {
        Ipv4Addr::LOCALHOST
    }
}

/// Host shown in copy/QR URLs. Never advertise `0.0.0.0`.
pub fn display_host(allow_lan: bool, lan_ip: Option<Ipv4Addr>) -> String {
    if allow_lan {
        if let Some(ip) = lan_ip.filter(|ip| is_usable_lan_ipv4(*ip)) {
            return ip.to_string();
        }
    }
    "127.0.0.1".into()
}

pub fn mirror_path_url(host: &str, port: u16, token: &str) -> String {
    format!("http://{host}:{port}/t/{token}/")
}

pub fn local_access_url(
    allow_lan: bool,
    port: u16,
    token: &str,
    lan_ip: Option<Ipv4Addr>,
) -> String {
    mirror_path_url(&display_host(allow_lan, lan_ip), port, token)
}

/// Best-effort IPv4 of the default-route interface (UDP connect trick; no packets sent).
pub fn detect_lan_ipv4() -> Option<Ipv4Addr> {
    let sock = UdpSocket::bind(SocketAddr::from((Ipv4Addr::UNSPECIFIED, 0))).ok()?;
    // Destination is not contacted; the OS only picks a source address.
    sock.connect(SocketAddr::from((Ipv4Addr::new(1, 1, 1, 1), 80)))
        .ok()?;
    match sock.local_addr().ok()?.ip() {
        IpAddr::V4(ip) if is_usable_lan_ipv4(ip) => Some(ip),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn usable_filters_loopback_and_link_local() {
        assert!(!is_usable_lan_ipv4(Ipv4Addr::LOCALHOST));
        assert!(!is_usable_lan_ipv4(Ipv4Addr::UNSPECIFIED));
        assert!(!is_usable_lan_ipv4(Ipv4Addr::new(169, 254, 1, 1)));
        assert!(is_usable_lan_ipv4(Ipv4Addr::new(192, 168, 1, 8)));
        assert!(is_usable_lan_ipv4(Ipv4Addr::new(10, 0, 0, 4)));
        assert!(is_usable_lan_ipv4(Ipv4Addr::new(172, 16, 0, 2)));
    }

    #[test]
    fn pick_prefers_rfc1918_home_wifi() {
        let picked = pick_lan_ipv4([
            Ipv4Addr::LOCALHOST,
            Ipv4Addr::new(8, 8, 8, 8),
            Ipv4Addr::new(10, 0, 0, 2),
            Ipv4Addr::new(192, 168, 110, 188),
        ]);
        assert_eq!(picked, Some(Ipv4Addr::new(192, 168, 110, 188)));
    }

    #[test]
    fn listen_ip_loopback_by_default() {
        assert_eq!(listen_ip(false), Ipv4Addr::LOCALHOST);
        assert_eq!(listen_ip(true), Ipv4Addr::UNSPECIFIED);
    }

    #[test]
    fn display_host_never_advertises_unspecified() {
        assert_eq!(
            display_host(false, Some(Ipv4Addr::new(192, 168, 1, 2))),
            "127.0.0.1"
        );
        assert_eq!(
            display_host(true, Some(Ipv4Addr::new(192, 168, 1, 2))),
            "192.168.1.2"
        );
        assert_eq!(display_host(true, None), "127.0.0.1");
        assert_eq!(display_host(true, Some(Ipv4Addr::LOCALHOST)), "127.0.0.1");
    }

    #[test]
    fn local_url_embeds_token_path() {
        let url = local_access_url(true, 59166, "tok", Some(Ipv4Addr::new(192, 168, 110, 188)));
        assert_eq!(url, "http://192.168.110.188:59166/t/tok/");
        let loopback =
            local_access_url(false, 59166, "tok", Some(Ipv4Addr::new(192, 168, 110, 188)));
        assert_eq!(loopback, "http://127.0.0.1:59166/t/tok/");
    }
}
