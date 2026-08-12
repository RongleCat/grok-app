//! Live credential validation per channel (no mock).

#![allow(dead_code)] // residual-clippy: format validators
use super::config;
use super::TestConnectionDto;
use std::collections::HashMap;

pub async fn test_connection(
    channel: &str,
    instance_id: &str,
) -> Result<TestConnectionDto, String> {
    let secrets = config::get_secrets(instance_id);
    let options = config::list_instances()
        .into_iter()
        .find(|i| i.id == instance_id)
        .map(|i| i.options)
        .unwrap_or(serde_json::json!({}));

    // GUI stores non-secret bind fields (e.g. feishu app_id) in options and only
    // password fields in secrets. Merge so doctor matches runtime secret_or_opt.
    let creds = merge_creds(&secrets, &options);

    if creds.is_empty() {
        let has = config::list_instances()
            .into_iter()
            .any(|i| i.id == instance_id && i.has_credentials);
        if !has {
            return Ok(TestConnectionDto {
                ok: false,
                message: "missing_credentials".into(),
                mock: false,
            });
        }
    }

    match channel {
        "feishu" | "lark" => test_feishu(&creds, channel, &options).await,
        "telegram" => test_telegram(&creds).await,
        "discord" => test_discord(&creds).await,
        "slack" => test_slack(&creds).await,
        "dingtalk" => {
            let ok = creds.contains_key("client_id") && creds.contains_key("client_secret");
            Ok(TestConnectionDto {
                ok,
                message: if ok {
                    "credentials_present_stream".into()
                } else {
                    "missing_client_id_or_secret".into()
                },
                mock: false,
            })
        }
        "wecom" => test_wecom(&creds),
        "weixin" => test_weixin(&creds),
        "line" => test_line(&creds),
        "qq" => test_qq(&creds),
        "matrix" => test_matrix(&creds),
        "weibo" => Ok(test_weibo(&creds)),
        "qqbot" => test_qqbot(&creds).await,
        _ => {
            let ok = !creds.is_empty() || !secrets.is_empty();
            Ok(TestConnectionDto {
                ok,
                message: if ok {
                    "credentials_stored".into()
                } else {
                    "missing_credentials".into()
                },
                mock: false,
            })
        }
    }
}

/// secrets win on key collision; string options fill gaps (app_id, domain, …).
fn merge_creds(
    secrets: &HashMap<String, String>,
    options: &serde_json::Value,
) -> HashMap<String, String> {
    let mut out = secrets.clone();
    if let Some(obj) = options.as_object() {
        for (k, v) in obj {
            if out.contains_key(k) {
                continue;
            }
            if let Some(s) = v.as_str().map(str::trim).filter(|s| !s.is_empty()) {
                out.insert(k.clone(), s.to_string());
            } else if let Some(n) = v.as_i64() {
                out.insert(k.clone(), n.to_string());
            } else if let Some(b) = v.as_bool() {
                out.insert(k.clone(), b.to_string());
            }
        }
    }
    out
}

fn cred_get<'a>(creds: &'a HashMap<String, String>, keys: &[&str]) -> &'a str {
    for k in keys {
        if let Some(s) = creds.get(*k).map(|s| s.as_str()).filter(|s| !s.is_empty()) {
            return s;
        }
    }
    ""
}

/// Soft App ID shape (aligned with pure feishuConfig). Empty = missing, not invalid.
fn is_feishu_app_id_format(raw: &str) -> bool {
    let t = raw.trim();
    if t.is_empty() || t.len() < 3 || t.len() > 128 {
        return false;
    }
    if t.chars().any(|c| c.is_whitespace()) {
        return false;
    }
    let mut chars = t.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !first.is_ascii_alphanumeric() {
        return false;
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// Soft pre-checks for Feishu/Lark (shape + presence only). Live tenant token is separate.
fn feishu_credential_posture(
    creds: &HashMap<String, String>,
    channel: &str,
    options: &serde_json::Value,
) -> Option<TestConnectionDto> {
    let app_id = cred_get(creds, &["app_id", "appId"]);
    let app_secret = cred_get(creds, &["app_secret", "appSecret"]);

    let mut missing: Vec<&str> = Vec::new();
    if app_id.is_empty() {
        missing.push("app_id");
    }
    if app_secret.is_empty() {
        missing.push("app_secret");
    }

    let domain_raw = options
        .get("domain")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .trim();
    if domain_raw == "custom" {
        let custom = options
            .get("custom_domain")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .trim();
        if custom.is_empty() {
            return Some(TestConnectionDto {
                ok: false,
                message: "missing_feishu_custom_domain".into(),
                mock: false,
            });
        }
    }

    if !app_id.is_empty() && !is_feishu_app_id_format(app_id) {
        return Some(TestConnectionDto {
            ok: false,
            message: "invalid_feishu_app_id_format".into(),
            mock: false,
        });
    }

    if !missing.is_empty() {
        let msg = if missing.len() == 2 {
            "missing_feishu_credentials".to_string()
        } else {
            format!("missing_feishu_fields:{}", missing.join(","))
        };
        return Some(TestConnectionDto {
            ok: false,
            message: msg,
            mock: false,
        });
    }

    // Posture ok — live tenant_access_token runs next. channel reserved for messages.
    let _ = channel;
    None
}

async fn test_feishu(
    creds: &HashMap<String, String>,
    channel: &str,
    options: &serde_json::Value,
) -> Result<TestConnectionDto, String> {
    if let Some(soft) = feishu_credential_posture(creds, channel, options) {
        return Ok(soft);
    }

    let app_id = cred_get(creds, &["app_id", "appId"]);
    let app_secret = cred_get(creds, &["app_secret", "appSecret"]);

    // Prefer configured domain (options.domain) then channel defaults.
    let domain = options
        .get("domain")
        .and_then(|x| x.as_str())
        .filter(|s| !s.is_empty() && *s != "custom" && *s != "feishu" && *s != "lark")
        .or_else(|| {
            let d = options.get("domain").and_then(|x| x.as_str()).unwrap_or("");
            if d == "lark" {
                Some("open.larksuite.com")
            } else if d == "feishu" {
                Some("open.feishu.cn")
            } else {
                None
            }
        })
        .or_else(|| {
            options
                .get("custom_domain")
                .and_then(|x| x.as_str())
                .filter(|s| !s.is_empty())
        })
        .unwrap_or(if channel == "lark" {
            "open.larksuite.com"
        } else {
            "open.feishu.cn"
        });

    let mut candidates: Vec<String> = vec![format!("https://{domain}")];
    if channel != "lark" && domain != "open.larksuite.com" {
        candidates.push("https://open.larksuite.com".into());
    }

    let client = crate::proxy::apply_to_reqwest(reqwest::Client::builder())
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;

    let mut last = String::new();
    for base in &candidates {
        let base = base.trim_end_matches('/');
        let url = format!("{base}/open-apis/auth/v3/tenant_access_token/internal");
        match client
            .post(&url)
            .json(&serde_json::json!({
                "app_id": app_id,
                "app_secret": app_secret,
            }))
            .send()
            .await
        {
            Ok(res) => {
                let v: serde_json::Value = res.json().await.unwrap_or_default();
                let code = v.get("code").and_then(|c| c.as_i64()).unwrap_or(-1);
                if code == 0 && v.get("tenant_access_token").is_some() {
                    // Honest: tenant token only — does not prove WS long-connection is up.
                    return Ok(TestConnectionDto {
                        ok: true,
                        message: format!("feishu_tenant_token_ok:{base}"),
                        mock: false,
                    });
                }
                last = v
                    .get("msg")
                    .and_then(|m| m.as_str())
                    .unwrap_or("token_failed")
                    .to_string();
            }
            Err(e) => last = e.to_string(),
        }
    }
    Ok(TestConnectionDto {
        ok: false,
        message: last,
        mock: false,
    })
}

/// Weixin personal (ilink) credential posture — presence only, no live long-poll.
fn test_weixin(creds: &HashMap<String, String>) -> Result<TestConnectionDto, String> {
    let token = cred_get(creds, &["token", "bot_token", "ilink_token"]);
    if token.is_empty() {
        return Ok(TestConnectionDto {
            ok: false,
            message: "missing_weixin_token".into(),
            mock: false,
        });
    }

    // Soft option checks (shape only — never claims getUpdates is live).
    let base = cred_get(creds, &["base_url"]);
    if !base.is_empty() && !(base.starts_with("https://") || base.starts_with("http://")) {
        return Ok(TestConnectionDto {
            ok: false,
            message: "invalid_weixin_base_url".into(),
            mock: false,
        });
    }
    let proxy = cred_get(creds, &["proxy"]);
    if !proxy.is_empty() {
        let ok_proxy = proxy.starts_with("http://")
            || proxy.starts_with("https://")
            || proxy.starts_with("socks5://")
            || proxy.starts_with("socks5h://");
        if !ok_proxy {
            return Ok(TestConnectionDto {
                ok: false,
                message: "invalid_weixin_proxy".into(),
                mock: false,
            });
        }
    }

    let message = if !proxy.is_empty() {
        "weixin_ilink_credentials_present_proxy"
    } else {
        "weixin_ilink_credentials_present"
    };
    Ok(TestConnectionDto {
        ok: true,
        // Honest: token present only — does not prove ilink long-poll is online
        message: message.into(),
        mock: false,
    })
}

/// WeCom mode-aware credential posture (no live WS). Soft-fail messages only.
fn test_wecom(creds: &HashMap<String, String>) -> Result<TestConnectionDto, String> {
    let mode = creds
        .get("connect_mode")
        .map(|s| s.as_str().trim())
        .filter(|s| !s.is_empty())
        .or_else(|| {
            creds
                .get("mode")
                .map(|s| s.as_str().trim())
                .filter(|s| !s.is_empty())
        })
        .unwrap_or("websocket");

    if mode == "webhook" {
        let mut missing: Vec<&str> = Vec::new();
        for k in ["corp_id", "corp_secret", "agent_id", "callback_token"] {
            if cred_get(creds, &[k]).is_empty() {
                missing.push(k);
            }
        }
        if missing.is_empty() {
            return Ok(TestConnectionDto {
                ok: true,
                // Honest: presence only — no claim that callback is reachable
                message: "wecom_webhook_credentials_present".into(),
                mock: false,
            });
        }
        return Ok(TestConnectionDto {
            ok: false,
            message: format!("missing_wecom_webhook:{}", missing.join(",")),
            mock: false,
        });
    }

    // Default / websocket (aibot long connection)
    let bot_id = cred_get(creds, &["bot_id"]);
    let bot_secret = cred_get(creds, &["bot_secret"]);
    if !bot_id.is_empty() && !bot_secret.is_empty() {
        return Ok(TestConnectionDto {
            ok: true,
            message: "wecom_ws_credentials_present".into(),
            mock: false,
        });
    }
    let mut missing: Vec<&str> = Vec::new();
    if bot_id.is_empty() {
        missing.push("bot_id");
    }
    if bot_secret.is_empty() {
        missing.push("bot_secret");
    }
    Ok(TestConnectionDto {
        ok: false,
        message: format!("missing_wecom_ws:{}", missing.join(",")),
        mock: false,
    })
}

async fn test_telegram(secrets: &HashMap<String, String>) -> Result<TestConnectionDto, String> {
    let token = cred_get(secrets, &["token", "bot_token"]);
    if token.is_empty() {
        return Ok(TestConnectionDto {
            ok: false,
            message: "missing_telegram_token".into(),
            mock: false,
        });
    }
    // Soft-fail bad paste shape before live getMe (never claims getUpdates).
    if !is_telegram_bot_token_format(token) {
        return Ok(TestConnectionDto {
            ok: false,
            message: "invalid_telegram_token_format".into(),
            mock: false,
        });
    }
    let proxy = cred_get(secrets, &["proxy"]);
    if !proxy.is_empty() && !is_telegram_proxy_url(proxy) {
        return Ok(TestConnectionDto {
            ok: false,
            message: "invalid_telegram_proxy".into(),
            mock: false,
        });
    }
    let client = crate::proxy::apply_to_reqwest(reqwest::Client::builder())
        .build()
        .map_err(|e| e.to_string())?;
    let url = format!("https://api.telegram.org/bot{token}/getMe");
    match client.get(&url).send().await {
        Ok(res) => {
            let v: serde_json::Value = res.json().await.unwrap_or_default();
            let ok = v.get("ok").and_then(|o| o.as_bool()).unwrap_or(false);
            let mut message = if ok {
                v.get("result")
                    .and_then(|r| r.get("username"))
                    .and_then(|u| u.as_str())
                    .unwrap_or("ok")
                    .to_string()
            } else {
                v.get("description")
                    .and_then(|d| d.as_str())
                    .unwrap_or("getMe_failed")
                    .to_string()
            };
            // On successful getMe, push native BotFather-style command menu.
            // Honest: getMe / menu registration ≠ getUpdates long-poll live.
            if ok {
                if let Err(e) =
                    super::channels::telegram::register_native_commands(&client, token).await
                {
                    message = format!("{message} (commands_menu: {e})");
                } else {
                    message = format!("{message} · commands_menu=ok · getUpdates_needs_bridge");
                }
            }
            Ok(TestConnectionDto {
                ok,
                message,
                mock: false,
            })
        }
        Err(e) => Ok(TestConnectionDto {
            ok: false,
            message: e.to_string(),
            mock: false,
        }),
    }
}

async fn test_discord(secrets: &HashMap<String, String>) -> Result<TestConnectionDto, String> {
    let token = cred_get(secrets, &["token", "bot_token"]);
    if token.is_empty() {
        return Ok(TestConnectionDto {
            ok: false,
            message: "missing_discord_token".into(),
            mock: false,
        });
    }
    // Soft-fail bad paste shape before live REST @me (never claims Gateway).
    if !is_discord_bot_token_format(token) {
        return Ok(TestConnectionDto {
            ok: false,
            message: "invalid_discord_token_format".into(),
            mock: false,
        });
    }
    let client = crate::proxy::apply_to_reqwest(reqwest::Client::builder())
        .build()
        .map_err(|e| e.to_string())?;
    match client
        .get("https://discord.com/api/v10/users/@me")
        .header("Authorization", format!("Bot {token}"))
        .send()
        .await
    {
        Ok(res) => {
            let ok = res.status().is_success();
            Ok(TestConnectionDto {
                ok,
                // Honest: REST bot identity only — Gateway needs Bridge link.
                message: if ok {
                    "discord_bot_identity_ok · gateway_needs_bridge".into()
                } else {
                    format!("http_{}", res.status().as_u16())
                },
                mock: false,
            })
        }
        Err(e) => Ok(TestConnectionDto {
            ok: false,
            message: e.to_string(),
            mock: false,
        }),
    }
}

async fn test_slack(secrets: &HashMap<String, String>) -> Result<TestConnectionDto, String> {
    // Dual-token posture first (Socket Mode needs bot + app); format soft-fail
    // before any live auth.test. Never claims apps.connections.open / Socket Mode.
    let posture = slack_credential_posture(secrets);
    if !posture.ok {
        return Ok(posture);
    }
    let token = cred_get(secrets, &["bot_token", "token"]);
    let client = crate::proxy::apply_to_reqwest(reqwest::Client::builder())
        .build()
        .map_err(|e| e.to_string())?;
    match client
        .post("https://slack.com/api/auth.test")
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
    {
        Ok(res) => {
            let v: serde_json::Value = res.json().await.unwrap_or_default();
            let ok = v.get("ok").and_then(|o| o.as_bool()).unwrap_or(false);
            Ok(TestConnectionDto {
                ok,
                message: if ok {
                    let user = v.get("user").and_then(|u| u.as_str()).unwrap_or("ok");
                    // Honest: bot auth.test only — Socket Mode needs Bridge.
                    format!("{user} · socket_mode_needs_bridge")
                } else {
                    v.get("error")
                        .and_then(|e| e.as_str())
                        .unwrap_or("auth_test_failed")
                        .to_string()
                },
                mock: false,
            })
        }
        Err(e) => Ok(TestConnectionDto {
            ok: false,
            message: e.to_string(),
            mock: false,
        }),
    }
}

fn test_line(creds: &HashMap<String, String>) -> Result<TestConnectionDto, String> {
    let channel_secret = cred_get(creds, &["channel_secret"]);
    let access_token = cred_get(creds, &["channel_access_token", "access_token"]);

    let mut missing: Vec<&str> = Vec::new();
    if channel_secret.is_empty() {
        missing.push("channel_secret");
    }
    if access_token.is_empty() {
        missing.push("channel_access_token");
    }

    // Soft option shape checks (never prove public HTTPS).
    let port = cred_get(creds, &["port"]);
    if !port.is_empty() {
        let ok_port = port.parse::<u16>().ok().filter(|p| *p >= 1).is_some();
        if !ok_port {
            return Ok(TestConnectionDto {
                ok: false,
                message: "invalid_line_port".into(),
                mock: false,
            });
        }
    }
    let path = cred_get(creds, &["callback_path"]);
    if !path.is_empty() {
        let ok_path = path.starts_with('/')
            && !path.contains("://")
            && !path.chars().any(|c| c.is_whitespace());
        if !ok_path {
            return Ok(TestConnectionDto {
                ok: false,
                message: "invalid_line_callback_path".into(),
                mock: false,
            });
        }
    }

    if !missing.is_empty() {
        return Ok(TestConnectionDto {
            ok: false,
            message: if missing.len() == 2 {
                "missing_line_credentials".into()
            } else {
                format!("missing_line_fields:{}", missing.join(","))
            },
            mock: false,
        });
    }

    let message = if !port.is_empty() && port != "8081" {
        "line_webhook_credentials_present_custom_port"
    } else {
        "line_webhook_credentials_present"
    };
    Ok(TestConnectionDto {
        ok: true,
        // Honest: secrets present only — does not prove public webhook is live
        message: message.into(),
        mock: false,
    })
}

fn test_qq(creds: &HashMap<String, String>) -> Result<TestConnectionDto, String> {
    let ws = cred_get(creds, &["ws_url", "url"]);
    if ws.is_empty() {
        return Ok(TestConnectionDto {
            ok: false,
            message: "missing_qq_ws_url".into(),
            mock: false,
        });
    }
    if !is_qq_ws_url(ws) {
        return Ok(TestConnectionDto {
            ok: false,
            message: "invalid_qq_ws_url".into(),
            mock: false,
        });
    }
    let token = cred_get(creds, &["token", "access_token"]);
    Ok(TestConnectionDto {
        ok: true,
        // Honest: URL shape only — live WS requires Bridge + self-hosted OneBot.
        message: if token.is_empty() {
            "qq_forward_ws_url_present".into()
        } else {
            "qq_forward_ws_credentials_present".into()
        },
        mock: false,
    })
}

fn test_matrix(creds: &HashMap<String, String>) -> Result<TestConnectionDto, String> {
    let homeserver = cred_get(creds, &["homeserver"]);
    let access_token = cred_get(creds, &["access_token", "token"]);
    let user_id = cred_get(creds, &["user_id"]);
    let proxy = cred_get(creds, &["proxy"]);

    if homeserver.is_empty() && access_token.is_empty() {
        return Ok(TestConnectionDto {
            ok: false,
            message: "missing_matrix_credentials".into(),
            mock: false,
        });
    }
    if homeserver.is_empty() {
        return Ok(TestConnectionDto {
            ok: false,
            message: "missing_matrix_homeserver".into(),
            mock: false,
        });
    }
    if !is_matrix_homeserver_url(homeserver) {
        return Ok(TestConnectionDto {
            ok: false,
            message: "invalid_matrix_homeserver".into(),
            mock: false,
        });
    }
    if access_token.is_empty() {
        return Ok(TestConnectionDto {
            ok: false,
            message: "missing_matrix_access_token".into(),
            mock: false,
        });
    }
    if !is_matrix_access_token_format(access_token) {
        return Ok(TestConnectionDto {
            ok: false,
            message: "invalid_matrix_access_token_format".into(),
            mock: false,
        });
    }
    if !is_matrix_user_id_format(user_id) {
        return Ok(TestConnectionDto {
            ok: false,
            message: "invalid_matrix_user_id".into(),
            mock: false,
        });
    }
    if !proxy.is_empty() {
        let proxy_ok = proxy.starts_with("http://")
            || proxy.starts_with("https://")
            || proxy.starts_with("socks5://")
            || proxy.starts_with("socks5h://");
        if !proxy_ok {
            return Ok(TestConnectionDto {
                ok: false,
                message: "invalid_matrix_proxy".into(),
                mock: false,
            });
        }
    }

    // Shape-only success — never claim /sync long-poll is connected.
    Ok(TestConnectionDto {
        ok: true,
        message: if proxy.is_empty() {
            "matrix_sync_credentials_present".into()
        } else {
            "matrix_sync_credentials_present_proxy".into()
        },
        mock: false,
    })
}

fn test_weibo(creds: &HashMap<String, String>) -> TestConnectionDto {
    let app_id = cred_get(creds, &["app_id", "app_key", "appId"]);
    let app_secret = cred_get(creds, &["app_secret", "appSecret", "secret"]);
    let token_endpoint = cred_get(creds, &["token_endpoint"]);
    let ws_endpoint = {
        let a = cred_get(creds, &["ws_endpoint"]);
        if a.is_empty() {
            cred_get(creds, &["ws_url"])
        } else {
            a
        }
    };

    if app_id.is_empty() && app_secret.is_empty() {
        return TestConnectionDto {
            ok: false,
            message: "missing_weibo_credentials".into(),
            mock: false,
        };
    }
    if app_id.is_empty() {
        return TestConnectionDto {
            ok: false,
            message: "missing_weibo_fields:app_id".into(),
            mock: false,
        };
    }
    if app_secret.is_empty() {
        return TestConnectionDto {
            ok: false,
            message: "missing_weibo_fields:app_secret".into(),
            mock: false,
        };
    }
    if !is_weibo_app_id_format(app_id) {
        return TestConnectionDto {
            ok: false,
            message: "invalid_weibo_app_id_format".into(),
            mock: false,
        };
    }
    if !is_weibo_token_endpoint_url(token_endpoint) {
        return TestConnectionDto {
            ok: false,
            message: "invalid_weibo_token_endpoint".into(),
            mock: false,
        };
    }
    if !is_weibo_ws_endpoint_url(ws_endpoint) {
        return TestConnectionDto {
            ok: false,
            message: "invalid_weibo_ws_endpoint".into(),
            mock: false,
        };
    }
    TestConnectionDto {
        ok: true,
        // Honest: presence only — WS requires Bridge + linked instance
        message: "weibo_ws_credentials_present".into(),
        mock: false,
    }
}

async fn test_qqbot(creds: &HashMap<String, String>) -> Result<TestConnectionDto, String> {
    let app_id = cred_get(creds, &["app_id", "appId"]);
    let app_secret = cred_get(creds, &["app_secret", "appSecret", "client_secret"]);
    if app_id.is_empty() && app_secret.is_empty() {
        return Ok(TestConnectionDto {
            ok: false,
            message: "missing_qqbot_credentials".into(),
            mock: false,
        });
    }
    if app_id.is_empty() {
        return Ok(TestConnectionDto {
            ok: false,
            message: "missing_qqbot_app_id".into(),
            mock: false,
        });
    }
    if !is_qqbot_app_id_format(app_id) {
        return Ok(TestConnectionDto {
            ok: false,
            message: "invalid_qqbot_app_id_format".into(),
            mock: false,
        });
    }
    if app_secret.is_empty() {
        return Ok(TestConnectionDto {
            ok: false,
            message: "missing_qqbot_app_secret".into(),
            mock: false,
        });
    }

    // Live soft: mint access token only — does not open Gateway WebSocket.
    let client = crate::proxy::apply_to_reqwest(reqwest::Client::builder())
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;

    match client
        .post("https://bots.qq.com/app/getAppAccessToken")
        .json(&serde_json::json!({
            "appId": app_id,
            "clientSecret": app_secret,
        }))
        .send()
        .await
    {
        Ok(res) => {
            let status = res.status();
            let body: serde_json::Value = res.json().await.unwrap_or_default();
            if body.get("access_token").and_then(|x| x.as_str()).is_some() {
                // Honest: token mint ok — Gateway still needs Bridge link.
                return Ok(TestConnectionDto {
                    ok: true,
                    message: "qqbot_access_token_ok".into(),
                    mock: false,
                });
            }
            let err = body
                .get("message")
                .or_else(|| body.get("msg"))
                .or_else(|| body.get("error"))
                .and_then(|m| m.as_str())
                .map(|s| s.to_string())
                .unwrap_or_else(|| format!("qqbot_token_http_{}", status.as_u16()));
            Ok(TestConnectionDto {
                ok: false,
                message: err,
                mock: false,
            })
        }
        Err(e) => {
            // Soft-fail network — never panics; does not claim Gateway live.
            Ok(TestConnectionDto {
                ok: false,
                message: format!("qqbot_token_network: {e}"),
                mock: false,
            })
        }
    }
}

fn is_discord_bot_token_format(raw: &str) -> bool {
    let t = raw.trim();
    if t.is_empty() {
        return false;
    }
    let body = t
        .strip_prefix("Bot ")
        .or_else(|| t.strip_prefix("bot "))
        .unwrap_or(t)
        .trim();
    let parts: Vec<&str> = body.split('.').collect();
    if parts.len() != 3 {
        return false;
    }
    parts.iter().enumerate().all(|(i, p)| {
        let min = if i == 1 { 4 } else { 20 };
        p.len() >= min
            && p.chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    })
}

/// BotFather tokens: digits:secret body (optional leading "bot").
fn is_telegram_bot_token_format(raw: &str) -> bool {
    let t = raw.trim();
    if t.is_empty() {
        return false;
    }
    let body = t
        .strip_prefix("bot")
        .or_else(|| t.strip_prefix("Bot"))
        .unwrap_or(t);
    let Some((id, secret)) = body.split_once(':') else {
        return false;
    };
    id.len() >= 5
        && id.chars().all(|c| c.is_ascii_digit())
        && secret.len() >= 20
        && secret
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// Optional Telegram proxy: http(s) / socks5(h) with a host.
fn is_telegram_proxy_url(raw: &str) -> bool {
    let t = raw.trim();
    if t.is_empty() {
        return true;
    }
    if let Ok(u) = url::Url::parse(t) {
        let scheme = u.scheme().to_ascii_lowercase();
        if !matches!(scheme.as_str(), "http" | "https" | "socks5" | "socks5h") {
            return false;
        }
        return u.host_str().map(|h| !h.is_empty()).unwrap_or(false);
    }
    // socks5:// may fail Url parse on some inputs — loose fallback
    let lower = t.to_ascii_lowercase();
    (lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("socks5://")
        || lower.starts_with("socks5h://"))
        && t.len() > 10
}

fn slack_credential_posture(creds: &HashMap<String, String>) -> TestConnectionDto {
    let bot = cred_get(creds, &["bot_token", "token"]);
    let app = cred_get(creds, &["app_token", "app_level_token"]);

    if bot.is_empty() && app.is_empty() {
        return TestConnectionDto {
            ok: false,
            message: "missing_slack_credentials".into(),
            mock: false,
        };
    }
    if bot.is_empty() {
        return TestConnectionDto {
            ok: false,
            message: "missing_slack_bot_token".into(),
            mock: false,
        };
    }
    if app.is_empty() {
        return TestConnectionDto {
            ok: false,
            message: "missing_slack_app_token".into(),
            mock: false,
        };
    }
    if !bot.starts_with("xoxb-") || bot.len() < 16 {
        return TestConnectionDto {
            ok: false,
            message: "invalid_slack_bot_token_format".into(),
            mock: false,
        };
    }
    if !app.starts_with("xapp-") || app.len() < 16 {
        return TestConnectionDto {
            ok: false,
            message: "invalid_slack_app_token_format".into(),
            mock: false,
        };
    }
    TestConnectionDto {
        ok: true,
        message: "slack_socket_mode_credentials_present".into(),
        mock: false,
    }
}

fn is_qq_ws_url(raw: &str) -> bool {
    let t = raw.trim();
    if t.is_empty() {
        return false;
    }
    let lower = t.to_ascii_lowercase();
    if !(lower.starts_with("ws://") || lower.starts_with("wss://")) {
        return false;
    }
    // Host part after scheme — reject bare "ws://"
    let rest = if lower.starts_with("wss://") {
        &t[6..]
    } else {
        &t[5..]
    };
    let host = rest.split('/').next().unwrap_or("").trim();
    !host.is_empty()
}

fn is_matrix_homeserver_url(raw: &str) -> bool {
    let t = raw.trim();
    if t.is_empty() {
        return false;
    }
    let Ok(u) = url::Url::parse(t) else {
        return false;
    };
    let scheme = u.scheme().to_ascii_lowercase();
    if scheme != "http" && scheme != "https" {
        return false;
    }
    u.host_str().map(|h| !h.is_empty()).unwrap_or(false)
}

fn is_matrix_user_id_format(raw: &str) -> bool {
    let t = raw.trim();
    if t.is_empty() {
        return true;
    }
    // Soft MXID shape — not a full Matrix grammar.
    let bytes = t.as_bytes();
    if !t.starts_with('@') {
        return false;
    }
    let Some(colon) = t[1..].find(':') else {
        return false;
    };
    let local = &t[1..1 + colon];
    let domain = &t[2 + colon..];
    if local.is_empty() || domain.is_empty() {
        return false;
    }
    local
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '=' | '/' | '-'))
        && domain
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-'))
        && !bytes.is_empty()
}

fn is_matrix_access_token_format(raw: &str) -> bool {
    let t = raw.trim();
    if t.is_empty() || t.len() < 16 {
        return false;
    }
    if t.chars().any(|c| c.is_whitespace()) {
        return false;
    }
    if t.to_ascii_lowercase().starts_with("http://")
        || t.to_ascii_lowercase().starts_with("https://")
    {
        return false;
    }
    true
}

fn is_weibo_ws_endpoint_url(raw: &str) -> bool {
    let t = raw.trim();
    if t.is_empty() {
        return true;
    }
    let Ok(u) = url::Url::parse(t) else {
        return false;
    };
    matches!(u.scheme(), "ws" | "wss" | "http" | "https")
        && u.host_str().is_some_and(|h| !h.is_empty())
}

fn is_weibo_token_endpoint_url(raw: &str) -> bool {
    let t = raw.trim();
    if t.is_empty() {
        return true;
    }
    let Ok(u) = url::Url::parse(t) else {
        return false;
    };
    matches!(u.scheme(), "http" | "https") && u.host_str().is_some_and(|h| !h.is_empty())
}

fn is_weibo_app_id_format(raw: &str) -> bool {
    let t = raw.trim();
    if t.is_empty() || t.len() < 3 || t.len() > 128 {
        return false;
    }
    if t.chars().any(|c| c.is_whitespace()) {
        return false;
    }
    let mut chars = t.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !first.is_ascii_alphanumeric() {
        return false;
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.')
}

fn is_qqbot_app_id_format(raw: &str) -> bool {
    let t = raw.trim();
    if t.is_empty() || t.len() < 3 || t.len() > 64 {
        return false;
    }
    if t.chars().any(|c| c.is_whitespace()) {
        return false;
    }
    t.chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        && t.chars()
            .next()
            .map(|c| c.is_ascii_alphanumeric())
            .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sample_bot() -> String {
        format!("{}-{}-{}", "xoxb", "TEST", "not-a-real-token-xx")
    }

    fn sample_app() -> String {
        format!("{}-{}-{}-{}", "xapp", "1", "TEST", "not-a-real-token-xx")
    }

    #[test]
    fn merge_creds_reads_app_id_from_options() {
        let mut secrets = HashMap::new();
        secrets.insert("app_secret".into(), "sec".into());
        let options = serde_json::json!({
            "app_id": "cli_aaa",
            "domain": "open.feishu.cn",
            "enable_feishu_card": true,
        });
        let m = merge_creds(&secrets, &options);
        assert_eq!(m.get("app_id").map(|s| s.as_str()), Some("cli_aaa"));
        assert_eq!(m.get("app_secret").map(|s| s.as_str()), Some("sec"));
        assert_eq!(m.get("domain").map(|s| s.as_str()), Some("open.feishu.cn"));
        // secrets win
        let mut secrets2 = secrets.clone();
        secrets2.insert("app_id".into(), "from_secret".into());
        let m2 = merge_creds(&secrets2, &options);
        assert_eq!(m2.get("app_id").map(|s| s.as_str()), Some("from_secret"));
    }

    #[test]
    fn feishu_app_id_format_soft_fail() {
        assert!(!is_feishu_app_id_format(""));
        assert!(!is_feishu_app_id_format("ab"));
        assert!(!is_feishu_app_id_format("has space"));
        assert!(is_feishu_app_id_format("cli_a1b2c3d4"));

        let mut c = HashMap::new();
        let opts = serde_json::json!({});
        let r = feishu_credential_posture(&c, "feishu", &opts).unwrap();
        assert!(!r.ok);
        assert_eq!(r.message, "missing_feishu_credentials");

        c.insert("app_id".into(), "bad id".into());
        c.insert("app_secret".into(), "sec".into());
        let r2 = feishu_credential_posture(&c, "feishu", &opts).unwrap();
        assert!(!r2.ok);
        assert_eq!(r2.message, "invalid_feishu_app_id_format");

        c.insert("app_id".into(), "cli_aaa".into());
        let opts_custom = serde_json::json!({ "domain": "custom" });
        let r3 = feishu_credential_posture(&c, "feishu", &opts_custom).unwrap();
        assert!(!r3.ok);
        assert_eq!(r3.message, "missing_feishu_custom_domain");

        let opts_ok = serde_json::json!({ "domain": "open.feishu.cn" });
        assert!(feishu_credential_posture(&c, "feishu", &opts_ok).is_none());
    }

    #[test]
    fn feishu_missing_secret_only() {
        let mut c = HashMap::new();
        c.insert("app_id".into(), "cli_aaa".into());
        let opts = serde_json::json!({});
        let r = feishu_credential_posture(&c, "feishu", &opts).unwrap();
        assert!(!r.ok);
        assert!(r.message.contains("missing_feishu_fields"));
        assert!(r.message.contains("app_secret"));
        assert!(!r.mock);
    }

    #[test]
    fn wecom_ws_requires_bot_id_and_secret() {
        let mut c = HashMap::new();
        c.insert("connect_mode".into(), "websocket".into());
        let r = test_wecom(&c).unwrap();
        assert!(!r.ok);
        assert!(r.message.contains("missing_wecom_ws"));
        assert!(r.message.contains("bot_id"));

        c.insert("bot_id".into(), "b1".into());
        c.insert("bot_secret".into(), "s1".into());
        let r2 = test_wecom(&c).unwrap();
        assert!(r2.ok);
        assert_eq!(r2.message, "wecom_ws_credentials_present");
        assert!(!r2.mock);
    }

    #[test]
    fn wecom_webhook_requires_corp_agent_and_callback() {
        let mut c = HashMap::new();
        c.insert("connect_mode".into(), "webhook".into());
        c.insert("corp_id".into(), "ww".into());
        c.insert("corp_secret".into(), "sec".into());
        // missing agent_id + callback_token
        let r = test_wecom(&c).unwrap();
        assert!(!r.ok);
        assert!(r.message.contains("missing_wecom_webhook"));
        assert!(r.message.contains("agent_id"));
        assert!(r.message.contains("callback_token"));

        c.insert("agent_id".into(), "1000002".into());
        c.insert("callback_token".into(), "tok".into());
        let r2 = test_wecom(&c).unwrap();
        assert!(r2.ok);
        assert_eq!(r2.message, "wecom_webhook_credentials_present");
    }

    #[test]
    fn wecom_defaults_to_websocket_when_mode_missing() {
        let mut c = HashMap::new();
        c.insert("bot_id".into(), "b".into());
        c.insert("bot_secret".into(), "s".into());
        let r = test_wecom(&c).unwrap();
        assert!(r.ok);
        assert_eq!(r.message, "wecom_ws_credentials_present");
    }

    #[test]
    fn weixin_requires_token_not_any_secret() {
        let mut c = HashMap::new();
        c.insert("account_id".into(), "default".into());
        let r = test_weixin(&c).unwrap();
        assert!(!r.ok);
        assert_eq!(r.message, "missing_weixin_token");
        assert!(!r.mock);

        c.insert("token".into(), "ilink-tok".into());
        let r2 = test_weixin(&c).unwrap();
        assert!(r2.ok);
        assert_eq!(r2.message, "weixin_ilink_credentials_present");
    }

    #[test]
    fn weixin_accepts_token_aliases() {
        for key in ["bot_token", "ilink_token"] {
            let mut c = HashMap::new();
            c.insert(key.into(), "x".into());
            let r = test_weixin(&c).unwrap();
            assert!(r.ok, "alias {key}");
            assert_eq!(r.message, "weixin_ilink_credentials_present");
        }
    }

    #[test]
    fn weixin_soft_fails_invalid_base_url_and_proxy() {
        let mut c = HashMap::new();
        c.insert("token".into(), "t".into());
        c.insert("base_url".into(), "not-a-url".into());
        let r = test_weixin(&c).unwrap();
        assert!(!r.ok);
        assert_eq!(r.message, "invalid_weixin_base_url");

        c.remove("base_url");
        c.insert("proxy".into(), "ftp://bad".into());
        let r2 = test_weixin(&c).unwrap();
        assert!(!r2.ok);
        assert_eq!(r2.message, "invalid_weixin_proxy");

        c.insert("proxy".into(), "socks5://127.0.0.1:1080".into());
        let r3 = test_weixin(&c).unwrap();
        assert!(r3.ok);
        assert_eq!(r3.message, "weixin_ilink_credentials_present_proxy");
    }

    #[test]
    fn discord_token_format_accepts_three_segments() {
        // Synthetic shape only — not a real Discord credential.
        let ok = "TESTTOKEN_NOT_A_SECRET_xx.TEST.TESTTOKEN_NOT_A_SECRET_TAIL_xx";
        assert!(is_discord_bot_token_format(ok));
        assert!(is_discord_bot_token_format(&format!("Bot {ok}")));
        assert!(!is_discord_bot_token_format(""));
        assert!(!is_discord_bot_token_format("not-a-token"));
        assert!(!is_discord_bot_token_format("only.two"));
        assert!(!is_discord_bot_token_format(
            "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw"
        ));
    }

    #[test]
    fn telegram_token_and_proxy_format() {
        assert!(is_telegram_bot_token_format(
            "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw"
        ));
        assert!(is_telegram_bot_token_format(
            "bot123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw"
        ));
        assert!(!is_telegram_bot_token_format(""));
        assert!(!is_telegram_bot_token_format("not-a-token"));
        assert!(!is_telegram_bot_token_format("123:short"));
        assert!(is_telegram_proxy_url(""));
        assert!(is_telegram_proxy_url("socks5://127.0.0.1:1080"));
        assert!(is_telegram_proxy_url("http://proxy.example:8080"));
        assert!(!is_telegram_proxy_url("ftp://bad"));
        assert!(!is_telegram_proxy_url("garbage"));
    }

    #[tokio::test]
    async fn telegram_soft_fails_invalid_token_before_live() {
        let mut c = HashMap::new();
        c.insert("token".into(), "not-a-bot-token".into());
        let r = test_telegram(&c).await.unwrap();
        assert!(!r.ok);
        assert_eq!(r.message, "invalid_telegram_token_format");
        assert!(!r.mock);
        // Never claims getUpdates live
        assert!(!r.message.contains("getUpdates"));
        assert!(!r.message.contains("connected"));
    }

    #[tokio::test]
    async fn telegram_soft_fails_invalid_proxy() {
        let mut c = HashMap::new();
        c.insert(
            "token".into(),
            "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw".into(),
        );
        c.insert("proxy".into(), "ftp://bad".into());
        let r = test_telegram(&c).await.unwrap();
        assert!(!r.ok);
        assert_eq!(r.message, "invalid_telegram_proxy");
    }

    #[tokio::test]
    async fn discord_soft_fails_invalid_token_before_live() {
        let mut c = HashMap::new();
        c.insert("token".into(), "not-a-discord-token".into());
        let r = test_discord(&c).await.unwrap();
        assert!(!r.ok);
        assert_eq!(r.message, "invalid_discord_token_format");
        assert!(!r.mock);
        assert!(!r.message.contains("gateway"));
        assert!(!r.message.contains("connected"));
    }

    #[tokio::test]
    async fn slack_test_requires_dual_token_posture_before_live() {
        // Only bot token — must soft-fail missing app token (no auth.test claim).
        let mut c = HashMap::new();
        c.insert(
            "bot_token".into(),
            "xoxb-123456789012-123456789012-abcdefghij".into(),
        );
        let r = test_slack(&c).await.unwrap();
        assert!(!r.ok);
        assert_eq!(r.message, "missing_slack_app_token");
        assert!(!r.mock);

        c.insert("app_token".into(), "not-xapp".into());
        let r2 = test_slack(&c).await.unwrap();
        assert!(!r2.ok);
        assert_eq!(r2.message, "invalid_slack_app_token_format");
    }

    #[test]
    fn line_requires_secret_and_access_token() {
        let mut c = HashMap::new();
        let r = test_line(&c).unwrap();
        assert!(!r.ok);
        assert_eq!(r.message, "missing_line_credentials");
        assert!(!r.mock);

        c.insert("channel_secret".into(), "sec".into());
        let r2 = test_line(&c).unwrap();
        assert!(!r2.ok);
        assert!(r2.message.contains("channel_access_token"));

        c.insert("channel_access_token".into(), "tok".into());
        let r3 = test_line(&c).unwrap();
        assert!(r3.ok);
        assert_eq!(r3.message, "line_webhook_credentials_present");
    }

    #[test]
    fn line_accepts_access_token_alias() {
        let mut c = HashMap::new();
        c.insert("channel_secret".into(), "sec".into());
        c.insert("access_token".into(), "tok".into());
        let r = test_line(&c).unwrap();
        assert!(r.ok);
        assert_eq!(r.message, "line_webhook_credentials_present");
    }

    #[test]
    fn line_soft_fails_invalid_port_and_path() {
        let mut c = HashMap::new();
        c.insert("channel_secret".into(), "sec".into());
        c.insert("channel_access_token".into(), "tok".into());
        c.insert("port".into(), "not-a-port".into());
        let r = test_line(&c).unwrap();
        assert!(!r.ok);
        assert_eq!(r.message, "invalid_line_port");

        c.insert("port".into(), "9443".into());
        c.insert("callback_path".into(), "relative".into());
        let r2 = test_line(&c).unwrap();
        assert!(!r2.ok);
        assert_eq!(r2.message, "invalid_line_callback_path");

        c.insert("callback_path".into(), "/hooks/line".into());
        let r3 = test_line(&c).unwrap();
        assert!(r3.ok);
        assert_eq!(r3.message, "line_webhook_credentials_present_custom_port");
    }

    #[test]
    fn slack_requires_dual_tokens() {
        let mut c = HashMap::new();
        let r = slack_credential_posture(&c);
        assert!(!r.ok);
        assert_eq!(r.message, "missing_slack_credentials");
        assert!(!r.mock);

        c.insert("bot_token".into(), sample_bot());
        let r2 = slack_credential_posture(&c);
        assert!(!r2.ok);
        assert_eq!(r2.message, "missing_slack_app_token");

        c.remove("bot_token");
        c.insert("app_token".into(), sample_app());
        let r3 = slack_credential_posture(&c);
        assert!(!r3.ok);
        assert_eq!(r3.message, "missing_slack_bot_token");
    }

    #[test]
    fn slack_accepts_token_aliases_and_valid_shape() {
        let mut c = HashMap::new();
        c.insert("token".into(), sample_bot());
        c.insert("app_level_token".into(), sample_app());
        let r = slack_credential_posture(&c);
        assert!(r.ok);
        assert_eq!(r.message, "slack_socket_mode_credentials_present");
    }

    #[test]
    fn slack_soft_fails_invalid_token_formats() {
        let mut c = HashMap::new();
        c.insert("bot_token".into(), "not-a-bot".into());
        c.insert("app_token".into(), sample_app());
        let r = slack_credential_posture(&c);
        assert!(!r.ok);
        assert_eq!(r.message, "invalid_slack_bot_token_format");

        c.insert("bot_token".into(), sample_bot());
        c.insert(
            "app_token".into(),
            format!("{}-{}-{}", "xoxb", "wrong", "prefix-xxxx"),
        );
        let r2 = slack_credential_posture(&c);
        assert!(!r2.ok);
        assert_eq!(r2.message, "invalid_slack_app_token_format");
    }

    #[test]
    fn qq_ws_url_accepts_ws_and_wss() {
        assert!(is_qq_ws_url("ws://127.0.0.1:3001"));
        assert!(is_qq_ws_url("wss://onebot.example.com/ws"));
        assert!(is_qq_ws_url("WS://localhost:8080/onebot/v11/ws"));
        assert!(!is_qq_ws_url(""));
        assert!(!is_qq_ws_url("http://127.0.0.1:3001"));
        assert!(!is_qq_ws_url("not-a-url"));
        assert!(!is_qq_ws_url("ws://"));
    }

    #[test]
    fn qq_soft_fails_missing_and_invalid_url() {
        let empty = HashMap::new();
        let r = test_qq(&empty).unwrap();
        assert!(!r.ok);
        assert_eq!(r.message, "missing_qq_ws_url");
        assert!(!r.mock);

        let mut bad = HashMap::new();
        bad.insert("ws_url".into(), "http://127.0.0.1:3001".into());
        let r2 = test_qq(&bad).unwrap();
        assert!(!r2.ok);
        assert_eq!(r2.message, "invalid_qq_ws_url");
        assert!(!r2.mock);
    }

    #[test]
    fn qq_accepts_url_alias_token_optional() {
        let mut c = HashMap::new();
        c.insert("url".into(), "wss://bridge.local/onebot".into());
        let r = test_qq(&c).unwrap();
        assert!(r.ok);
        assert_eq!(r.message, "qq_forward_ws_url_present");
        assert!(!r.mock);

        c.insert("token".into(), "optional-access-token".into());
        let r2 = test_qq(&c).unwrap();
        assert!(r2.ok);
        assert_eq!(r2.message, "qq_forward_ws_credentials_present");
    }

    #[test]
    fn matrix_homeserver_and_token_format() {
        assert!(is_matrix_homeserver_url("https://matrix.example.com"));
        assert!(is_matrix_homeserver_url("http://127.0.0.1:8008"));
        assert!(!is_matrix_homeserver_url(""));
        assert!(!is_matrix_homeserver_url("matrix.org"));
        assert!(is_matrix_access_token_format(
            "syt_TEST_NOT_A_REAL_MATRIX_ACCESS_TOKEN_xx"
        ));
        assert!(!is_matrix_access_token_format("short"));
        assert!(!is_matrix_access_token_format("https://evil.example"));
        assert!(is_matrix_user_id_format(""));
        assert!(is_matrix_user_id_format("@bot:matrix.org"));
        assert!(!is_matrix_user_id_format("bot:matrix.org"));
    }

    #[test]
    fn matrix_soft_fails_missing_and_bad_shape() {
        let empty = HashMap::new();
        let r = test_matrix(&empty).unwrap();
        assert!(!r.ok);
        assert_eq!(r.message, "missing_matrix_credentials");
        assert!(!r.mock);

        let mut only_hs = HashMap::new();
        only_hs.insert("homeserver".into(), "https://matrix.example.com".into());
        let r2 = test_matrix(&only_hs).unwrap();
        assert!(!r2.ok);
        assert_eq!(r2.message, "missing_matrix_access_token");

        let mut bad_hs = HashMap::new();
        bad_hs.insert("homeserver".into(), "matrix.org".into());
        bad_hs.insert(
            "access_token".into(),
            "syt_TEST_NOT_A_REAL_MATRIX_ACCESS_TOKEN_xx".into(),
        );
        let r3 = test_matrix(&bad_hs).unwrap();
        assert!(!r3.ok);
        assert_eq!(r3.message, "invalid_matrix_homeserver");

        let mut bad_tok = HashMap::new();
        bad_tok.insert("homeserver".into(), "https://matrix.example.com".into());
        bad_tok.insert("access_token".into(), "short".into());
        let r4 = test_matrix(&bad_tok).unwrap();
        assert!(!r4.ok);
        assert_eq!(r4.message, "invalid_matrix_access_token_format");

        let mut ok = HashMap::new();
        ok.insert("homeserver".into(), "https://matrix.example.com".into());
        ok.insert(
            "access_token".into(),
            "syt_TEST_NOT_A_REAL_MATRIX_ACCESS_TOKEN_xx".into(),
        );
        let r5 = test_matrix(&ok).unwrap();
        assert!(r5.ok);
        assert_eq!(r5.message, "matrix_sync_credentials_present");
        assert!(!r5.mock);
        // Honest: never claims /sync live
        assert!(!r5.message.contains("sync_live"));
        assert!(!r5.message.contains("connected"));
    }

    #[test]
    fn weibo_app_id_format_accepts_numeric_and_alnum() {
        assert!(is_weibo_app_id_format("1234567890"));
        assert!(is_weibo_app_id_format("wb_app_key_01"));
        assert!(!is_weibo_app_id_format(""));
        assert!(!is_weibo_app_id_format("ab"));
        assert!(!is_weibo_app_id_format("has space"));
    }

    #[test]
    fn weibo_soft_fails_missing_and_bad_shape() {
        let empty = HashMap::new();
        let r = test_weibo(&empty);
        assert!(!r.ok);
        assert_eq!(r.message, "missing_weibo_credentials");
        assert!(!r.mock);

        let mut only_id = HashMap::new();
        only_id.insert("app_id".into(), "1234567890".into());
        let r2 = test_weibo(&only_id);
        assert!(!r2.ok);
        assert_eq!(r2.message, "missing_weibo_fields:app_secret");

        let mut bad_id = HashMap::new();
        bad_id.insert("app_id".into(), "x".into());
        bad_id.insert("app_secret".into(), "sec".into());
        let r3 = test_weibo(&bad_id);
        assert!(!r3.ok);
        assert_eq!(r3.message, "invalid_weibo_app_id_format");
    }

    #[test]
    fn weibo_accepts_credentials_and_valid_endpoints() {
        let mut c = HashMap::new();
        c.insert("app_id".into(), "1234567890".into());
        c.insert("app_secret".into(), "secret-not-logged".into());
        c.insert(
            "token_endpoint".into(),
            "https://api.weibo.com/oauth2/access_token".into(),
        );
        c.insert("ws_endpoint".into(), "wss://api.weibo.com/chat".into());
        let r = test_weibo(&c);
        assert!(r.ok);
        assert_eq!(r.message, "weibo_ws_credentials_present");
        assert!(!r.mock);
    }

    #[test]
    fn weibo_soft_fails_invalid_endpoints() {
        let mut c = HashMap::new();
        c.insert("app_id".into(), "1234567890".into());
        c.insert("app_secret".into(), "sec".into());
        c.insert("token_endpoint".into(), "not-a-url".into());
        let r = test_weibo(&c);
        assert!(!r.ok);
        assert_eq!(r.message, "invalid_weibo_token_endpoint");

        c.insert(
            "token_endpoint".into(),
            "https://api.weibo.com/oauth2/access_token".into(),
        );
        c.insert("ws_endpoint".into(), "ftp://bad".into());
        let r2 = test_weibo(&c);
        assert!(!r2.ok);
        assert_eq!(r2.message, "invalid_weibo_ws_endpoint");
    }

    #[test]
    fn qqbot_app_id_accepts_numeric_and_alphanumeric() {
        assert!(is_qqbot_app_id_format("102012345"));
        assert!(is_qqbot_app_id_format("cli_abc123"));
        assert!(!is_qqbot_app_id_format(""));
        assert!(!is_qqbot_app_id_format("ab"));
        assert!(!is_qqbot_app_id_format("has space"));
        assert!(!is_qqbot_app_id_format("bad!id"));
    }
}
