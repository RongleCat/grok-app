//! Host-only credentials for the fixed Grok Build Responses route.
use super::{cli_default_auth_json_path, jwt_payload_unverified};
use chrono::{DateTime, Duration as ChronoDuration, Utc};
use rand::RngCore;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::Path,
    sync::OnceLock,
    time::{SystemTime, UNIX_EPOCH},
};
static BUILD_OAUTH_REVISION_SALT: OnceLock<[u8; 32]> = OnceLock::new();

const XAI_OAUTH_ISSUER: &str = "https://auth.x.ai";
const XAI_OAUTH_CLIENT_ID: &str = "b1a00492-073a-47ea-816f-4c329264a828";
const XAI_BUILD_AUTH_SCOPE: &str = "https://auth.x.ai::b1a00492-073a-47ea-816f-4c329264a828";
const LEGACY_XAI_AUTH_SCOPE: &str = "https://accounts.x.ai/sign-in";
const BUILD_OAUTH_EXPIRY_SKEW_SECS: i64 = 60;
const BUILD_OAUTH_FALLBACK_TTL_DAYS: i64 = 30;

/// Non-secret identity of the canonical Grok Build credential file.
///
/// The wallpaper Responses router uses this to forget credential-specific
/// failures after Grok Build refreshes or replaces `auth.json`. It intentionally
/// contains neither the path nor any credential material.
#[derive(Clone, PartialEq, Eq, Hash)]
pub(crate) struct BuildOauthCredentialRevision {
    file_len: u64,
    modified_ms: Option<u128>,
    content_tag: [u8; 32],
}

impl BuildOauthCredentialRevision {
    #[cfg(test)]
    pub(crate) fn for_test(file_len: u64, modified_ms: Option<u128>, tag: u8) -> Self {
        Self {
            file_len,
            modified_ms,
            content_tag: [tag; 32],
        }
    }
}

impl std::fmt::Debug for BuildOauthCredentialRevision {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("BuildOauthCredentialRevision")
            .field("file_len", &self.file_len)
            .field("modified_ms", &self.modified_ms)
            .field("content_tag", &"[redacted]")
            .finish()
    }
}

/// Host-only Build OAuth access-token snapshot.
///
/// Deliberately does not implement `Debug` or `Serialize`: the token must never
/// cross IPC, enter diagnostics, or be formatted into an error/log message.
pub(crate) struct BuildOauthAccessToken {
    token: String,
    pub(crate) revision: BuildOauthCredentialRevision,
}

impl BuildOauthAccessToken {
    pub(crate) fn expose_to_build_proxy(&self) -> &str {
        &self.token
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum BuildOauthTokenError {
    Unavailable,
    Expired,
}

impl BuildOauthTokenError {
    pub(crate) fn code(self) -> &'static str {
        match self {
            Self::Unavailable => "oauth_unavailable",
            Self::Expired => "oauth_expired",
        }
    }
}

/// Read the canonical Grok Build OAuth access token for Host-only side routes.
///
/// This intentionally ignores process `GROK_HOME`: a custom provider or an
/// independent agent home must never redirect the official wallpaper side
/// route to different credentials. Tokens expiring within 60 seconds are
/// rejected so a long-running search does not start with a stale credential.
pub(crate) fn read_build_oauth_access_token() -> Result<BuildOauthAccessToken, BuildOauthTokenError>
{
    read_build_oauth_access_token_from_path_at(&cli_default_auth_json_path(), Utc::now())
}

/// Current non-secret revision of canonical Grok Build credentials.
pub(crate) fn build_oauth_credential_revision() -> Option<BuildOauthCredentialRevision> {
    build_oauth_credential_revision_from_path(&cli_default_auth_json_path())
}

fn build_oauth_credential_revision_from_path(path: &Path) -> Option<BuildOauthCredentialRevision> {
    let raw = fs::read(path).ok()?;
    build_oauth_credential_revision_from_bytes(path, &raw)
}

fn build_oauth_credential_revision_from_bytes(
    path: &Path,
    raw: &[u8],
) -> Option<BuildOauthCredentialRevision> {
    let metadata = fs::metadata(path).ok()?;
    let salt = BUILD_OAUTH_REVISION_SALT.get_or_init(|| {
        let mut salt = [0_u8; 32];
        rand::rngs::OsRng.fill_bytes(&mut salt);
        salt
    });
    let mut digest = Sha256::new();
    digest.update(salt);
    digest.update(raw);
    Some(BuildOauthCredentialRevision {
        file_len: metadata.len(),
        modified_ms: metadata.modified().ok().and_then(system_time_millis),
        content_tag: digest.finalize().into(),
    })
}

fn read_build_oauth_access_token_from_path_at(
    path: &Path,
    now: DateTime<Utc>,
) -> Result<BuildOauthAccessToken, BuildOauthTokenError> {
    let raw = fs::read_to_string(path).map_err(|_| BuildOauthTokenError::Unavailable)?;
    let value: Value = serde_json::from_str(&raw).map_err(|_| BuildOauthTokenError::Unavailable)?;
    let token = select_build_oauth_access_token(&value, &now)?.to_string();
    let revision = build_oauth_credential_revision_from_bytes(path, raw.as_bytes())
        .ok_or(BuildOauthTokenError::Unavailable)?;

    Ok(BuildOauthAccessToken { token, revision })
}

fn system_time_millis(value: SystemTime) -> Option<u128> {
    value.duration_since(UNIX_EPOCH).ok().map(|d| d.as_millis())
}

fn access_token_from_auth_entry(entry: &Value) -> Option<&str> {
    entry
        .get("key")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .or_else(|| {
            entry
                .get("access_token")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
        })
}

struct BuildOauthTokenCandidate<'a> {
    token: &'a str,
}

enum BuildOauthCandidateVerdict<'a> {
    Ignore,
    Expired,
    Valid(BuildOauthTokenCandidate<'a>),
}

/// Select only a production xAI credential suitable for the fixed Build proxy.
///
/// Match Grok Build's current-scope then legacy-scope lookup order. Unverified
/// JWT claims are used only to reject an explicit issuer, audience, or expiry
/// conflict before any bearer is sent.
fn select_build_oauth_access_token<'a>(
    value: &'a Value,
    now: &DateTime<Utc>,
) -> Result<&'a str, BuildOauthTokenError> {
    let entries = value.as_object().ok_or(BuildOauthTokenError::Unavailable)?;
    let mut saw_expired_xai_token = false;

    for (scope, legacy) in [(XAI_BUILD_AUTH_SCOPE, false), (LEGACY_XAI_AUTH_SCOPE, true)] {
        let Some(entry) = entries.get(scope) else {
            continue;
        };
        match classify_build_oauth_candidate(entry, legacy, now) {
            BuildOauthCandidateVerdict::Ignore => {}
            BuildOauthCandidateVerdict::Expired => saw_expired_xai_token = true,
            BuildOauthCandidateVerdict::Valid(candidate) => return Ok(candidate.token),
        }
    }

    if saw_expired_xai_token {
        Err(BuildOauthTokenError::Expired)
    } else {
        Err(BuildOauthTokenError::Unavailable)
    }
}

fn classify_build_oauth_candidate<'a>(
    entry: &'a Value,
    legacy: bool,
    now: &DateTime<Utc>,
) -> BuildOauthCandidateVerdict<'a> {
    let Some(token) = access_token_from_auth_entry(entry) else {
        return BuildOauthCandidateVerdict::Ignore;
    };

    if !entry
        .get("auth_mode")
        .and_then(Value::as_str)
        .is_some_and(|mode| matches!(mode, "oidc" | "external"))
    {
        return BuildOauthCandidateVerdict::Ignore;
    }

    match entry.get("oidc_issuer") {
        Some(Value::String(issuer))
            if if legacy {
                is_xai_issuer(issuer)
            } else {
                is_current_xai_issuer(issuer)
            } => {}
        Some(_) => return BuildOauthCandidateVerdict::Ignore,
        None => {}
    }

    match entry.get("oidc_client_id") {
        Some(Value::String(client_id)) if client_id.trim() == XAI_OAUTH_CLIENT_ID => {}
        Some(_) => return BuildOauthCandidateVerdict::Ignore,
        None => {}
    }

    let stored_expiry = match entry.get("expires_at") {
        Some(Value::String(value)) => match DateTime::parse_from_rfc3339(value) {
            Ok(value) => Some(value.with_timezone(&Utc)),
            Err(_) => return BuildOauthCandidateVerdict::Expired,
        },
        Some(_) => return BuildOauthCandidateVerdict::Expired,
        None => None,
    };
    let jwt_expiry = match build_oauth_jwt_expiry(token, legacy) {
        Ok(value) => value,
        Err(()) => return BuildOauthCandidateVerdict::Ignore,
    };
    let fallback_expiry = if stored_expiry.is_none() && jwt_expiry.is_none() {
        match entry.get("create_time").and_then(Value::as_str) {
            Some(value) => DateTime::parse_from_rfc3339(value)
                .ok()
                .map(|value| value.with_timezone(&Utc))
                .and_then(|value| {
                    value.checked_add_signed(ChronoDuration::days(BUILD_OAUTH_FALLBACK_TTL_DAYS))
                }),
            None => None,
        }
    } else {
        None
    };
    let Some(expires_at) = earliest_expiry(stored_expiry, jwt_expiry).or(fallback_expiry) else {
        return BuildOauthCandidateVerdict::Expired;
    };
    if expires_at <= *now + ChronoDuration::seconds(BUILD_OAUTH_EXPIRY_SKEW_SECS) {
        return BuildOauthCandidateVerdict::Expired;
    }

    BuildOauthCandidateVerdict::Valid(BuildOauthTokenCandidate { token })
}

fn earliest_expiry(
    left: Option<DateTime<Utc>>,
    right: Option<DateTime<Utc>>,
) -> Option<DateTime<Utc>> {
    match (left, right) {
        (Some(left), Some(right)) => Some(left.min(right)),
        (Some(value), None) | (None, Some(value)) => Some(value),
        (None, None) => None,
    }
}

fn is_current_xai_issuer(value: &str) -> bool {
    value
        .trim()
        .trim_end_matches('/')
        .eq_ignore_ascii_case(XAI_OAUTH_ISSUER)
}

fn is_xai_issuer(value: &str) -> bool {
    let value = value.trim().trim_end_matches('/');
    is_current_xai_issuer(value)
        || value.eq_ignore_ascii_case("https://accounts.x.ai")
        || value.eq_ignore_ascii_case(LEGACY_XAI_AUTH_SCOPE)
}

fn build_oauth_jwt_expiry(token: &str, legacy: bool) -> Result<Option<DateTime<Utc>>, ()> {
    let Some(payload) = jwt_payload_unverified(token) else {
        return Ok(None);
    };

    if let Some(issuer) = payload.get("iss") {
        let Some(issuer) = issuer.as_str() else {
            return Err(());
        };
        let issuer_matches = if legacy {
            is_xai_issuer(issuer)
        } else {
            is_current_xai_issuer(issuer)
        };
        if !issuer_matches {
            return Err(());
        }
    }
    if let Some(audience) = payload.get("aud") {
        if !build_oauth_audience_matches(audience) {
            return Err(());
        }
    }

    match payload.get("exp") {
        Some(value) => {
            let seconds = value
                .as_i64()
                .or_else(|| value.as_u64().and_then(|value| i64::try_from(value).ok()))
                .ok_or(())?;
            DateTime::from_timestamp(seconds, 0).map(Some).ok_or(())
        }
        None => Ok(None),
    }
}

fn build_oauth_audience_matches(audience: &Value) -> bool {
    match audience {
        Value::String(value) => value == XAI_OAUTH_CLIENT_ID,
        Value::Array(values) => values.iter().any(|value| {
            value
                .as_str()
                .is_some_and(|value| value == XAI_OAUTH_CLIENT_ID)
        }),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    fn fake_jwt(payload: Value) -> String {
        use base64::Engine;

        let encoder = base64::engine::general_purpose::URL_SAFE_NO_PAD;
        let header = encoder.encode(r#"{"alg":"RS256","typ":"JWT"}"#);
        let payload = encoder.encode(serde_json::to_vec(&payload).expect("serialize JWT payload"));
        format!("{header}.{payload}.test-signature")
    }

    fn temp_auth_path(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "grok-app-build-oauth-{label}-{}-{}.json",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock after epoch")
                .as_nanos()
        ))
    }
    fn fixed_oauth_now() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-08-28T00:00:00Z")
            .expect("fixed timestamp")
            .with_timezone(&Utc)
    }

    fn expect_build_oauth_error(
        result: Result<BuildOauthAccessToken, BuildOauthTokenError>,
    ) -> BuildOauthTokenError {
        match result {
            Ok(_) => panic!("expected Build OAuth token read to fail"),
            Err(error) => error,
        }
    }

    fn build_oauth_entries(entries: &[(&str, Value)]) -> Value {
        Value::Object(
            entries
                .iter()
                .map(|(scope, entry)| ((*scope).to_string(), entry.clone()))
                .collect(),
        )
    }

    fn read_build_oauth_fixture(
        label: &str,
        value: &Value,
    ) -> Result<BuildOauthAccessToken, BuildOauthTokenError> {
        let path = temp_auth_path(label);
        fs::write(&path, value.to_string()).expect("write auth fixture");
        let result = read_build_oauth_access_token_from_path_at(&path, fixed_oauth_now());
        fs::remove_file(path).expect("remove auth fixture");
        result
    }

    #[test]
    fn build_oauth_current_scope_wins_over_fresher_legacy_entry() {
        let value = build_oauth_entries(&[
            (
                XAI_BUILD_AUTH_SCOPE,
                serde_json::json!({
                    "key": "current-token",
                    "auth_mode": "oidc",
                    "expires_at": "2026-08-28T01:00:00Z"
                }),
            ),
            (
                LEGACY_XAI_AUTH_SCOPE,
                serde_json::json!({
                    "key": "legacy-token",
                    "auth_mode": "external",
                    "expires_at": "2026-08-28T02:00:00Z"
                }),
            ),
        ]);

        let snapshot = read_build_oauth_fixture("current-before-legacy", &value)
            .expect("current Build credential");
        assert_eq!(snapshot.expose_to_build_proxy(), "current-token");
        assert!(snapshot.revision.file_len > 0);
    }

    #[test]
    fn build_oauth_ignores_foreign_entries_and_other_xai_client_scopes() {
        let value = build_oauth_entries(&[
            (
                "tokens",
                serde_json::json!({
                    "access_token": "foreign-top-level-token",
                    "auth_mode": "oidc",
                    "expires_at": "2026-08-29T00:00:00Z"
                }),
            ),
            (
                "https://auth.openai.com::openai-client",
                serde_json::json!({
                    "access_token": "foreign-issuer-token",
                    "auth_mode": "oidc",
                    "oidc_issuer": "https://auth.openai.com",
                    "expires_at": "2026-08-29T00:00:00Z"
                }),
            ),
            (
                "https://auth.x.ai::other-client",
                serde_json::json!({
                    "key": "other-xai-client-token",
                    "auth_mode": "oidc",
                    "oidc_issuer": XAI_OAUTH_ISSUER,
                    "expires_at": "2026-08-29T00:00:00Z"
                }),
            ),
        ]);

        assert_eq!(
            expect_build_oauth_error(read_build_oauth_fixture("ignored-scopes", &value)),
            BuildOauthTokenError::Unavailable
        );
    }

    #[test]
    fn build_oauth_falls_back_to_legacy_when_current_entry_is_unusable() {
        let current_entries = [
            (
                "expired-current",
                serde_json::json!({
                    "key": "expired-current-token",
                    "auth_mode": "oidc",
                    "expires_at": "2026-08-27T23:59:59Z"
                }),
            ),
            (
                "invalid-current",
                serde_json::json!({
                    "key": "invalid-current-token",
                    "auth_mode": "oidc",
                    "oidc_issuer": LEGACY_XAI_AUTH_SCOPE,
                    "expires_at": "2026-08-28T02:00:00Z"
                }),
            ),
        ];

        for (label, current_entry) in current_entries {
            let value = build_oauth_entries(&[
                (XAI_BUILD_AUTH_SCOPE, current_entry),
                (
                    LEGACY_XAI_AUTH_SCOPE,
                    serde_json::json!({
                        "key": "valid-legacy-token",
                        "auth_mode": "external",
                        "expires_at": "2026-08-28T02:00:00Z"
                    }),
                ),
            ]);
            let snapshot =
                read_build_oauth_fixture(label, &value).expect("valid legacy Build credential");
            assert_eq!(snapshot.expose_to_build_proxy(), "valid-legacy-token");
        }
    }

    #[test]
    fn build_oauth_rejects_entry_issuer_and_client_id_conflicts() {
        let conflicting_entries = [
            (
                "entry-issuer-conflict",
                serde_json::json!({
                    "key": "issuer-conflict-token",
                    "auth_mode": "oidc",
                    "oidc_issuer": LEGACY_XAI_AUTH_SCOPE,
                    "expires_at": "2026-08-28T02:00:00Z"
                }),
            ),
            (
                "entry-client-conflict",
                serde_json::json!({
                    "key": "client-conflict-token",
                    "auth_mode": "oidc",
                    "oidc_issuer": XAI_OAUTH_ISSUER,
                    "oidc_client_id": "another-client",
                    "expires_at": "2026-08-28T02:00:00Z"
                }),
            ),
        ];

        for (label, entry) in conflicting_entries {
            let value = build_oauth_entries(&[(XAI_BUILD_AUTH_SCOPE, entry)]);
            assert_eq!(
                expect_build_oauth_error(read_build_oauth_fixture(label, &value)),
                BuildOauthTokenError::Unavailable
            );
        }
    }

    #[test]
    fn build_oauth_rejects_conflicting_jwt_issuer_and_audience() {
        let cases = [
            (
                "foreign-jwt-issuer",
                fake_jwt(serde_json::json!({
                    "iss": "https://auth.openai.com",
                    "aud": XAI_OAUTH_CLIENT_ID,
                    "exp": fixed_oauth_now().timestamp() + 3600
                })),
            ),
            (
                "legacy-root-jwt-issuer-on-current-scope",
                fake_jwt(serde_json::json!({
                    "iss": "https://accounts.x.ai",
                    "aud": XAI_OAUTH_CLIENT_ID,
                    "exp": fixed_oauth_now().timestamp() + 3600
                })),
            ),
            (
                "legacy-sign-in-jwt-issuer-on-current-scope",
                fake_jwt(serde_json::json!({
                    "iss": LEGACY_XAI_AUTH_SCOPE,
                    "aud": XAI_OAUTH_CLIENT_ID,
                    "exp": fixed_oauth_now().timestamp() + 3600
                })),
            ),
            (
                "foreign-jwt-audience",
                fake_jwt(serde_json::json!({
                    "iss": XAI_OAUTH_ISSUER,
                    "aud": "https://api.openai.com/v1",
                    "exp": fixed_oauth_now().timestamp() + 3600
                })),
            ),
        ];

        for (label, token) in cases {
            let value = build_oauth_entries(&[(
                XAI_BUILD_AUTH_SCOPE,
                serde_json::json!({
                        "key": token,
                        "auth_mode": "oidc",
                        "oidc_issuer": XAI_OAUTH_ISSUER,
                        "oidc_client_id": XAI_OAUTH_CLIENT_ID,
                        "expires_at": "2026-08-28T02:00:00Z"
                }),
            )]);

            assert_eq!(
                expect_build_oauth_error(read_build_oauth_fixture(label, &value)),
                BuildOauthTokenError::Unavailable
            );
        }
    }

    #[test]
    fn build_oauth_accepts_exact_build_client_audience_as_string_or_array() {
        for (label, audience) in [
            (
                "string-client-audience",
                serde_json::json!(XAI_OAUTH_CLIENT_ID),
            ),
            (
                "array-client-audience",
                serde_json::json!(["other", XAI_OAUTH_CLIENT_ID]),
            ),
        ] {
            let token = fake_jwt(serde_json::json!({
                "iss": XAI_OAUTH_ISSUER,
                "aud": audience,
                "exp": fixed_oauth_now().timestamp() + 3600
            }));
            let value = build_oauth_entries(&[(
                XAI_BUILD_AUTH_SCOPE,
                serde_json::json!({
                        "key": token,
                        "auth_mode": "oidc",
                        "oidc_issuer": XAI_OAUTH_ISSUER,
                        "oidc_client_id": XAI_OAUTH_CLIENT_ID
                }),
            )]);

            read_build_oauth_fixture(label, &value).expect("exact Build JWT audience");
        }
    }

    #[test]
    fn build_oauth_rejects_alias_and_service_url_jwt_audiences() {
        for (label, audience) in [
            ("api-grok-audience", "api://grok"),
            (
                "grok-service-url-audience",
                "https://cli-chat-proxy.grok.com/v1",
            ),
            ("xai-service-url-audience", "https://api.x.ai/v1"),
        ] {
            let token = fake_jwt(serde_json::json!({
                "iss": XAI_OAUTH_ISSUER,
                "aud": audience,
                "exp": fixed_oauth_now().timestamp() + 3600
            }));
            let value = build_oauth_entries(&[(
                XAI_BUILD_AUTH_SCOPE,
                serde_json::json!({
                    "key": token,
                    "auth_mode": "oidc",
                    "expires_at": "2026-08-28T02:00:00Z"
                }),
            )]);

            assert_eq!(
                expect_build_oauth_error(read_build_oauth_fixture(label, &value)),
                BuildOauthTokenError::Unavailable
            );
        }
    }

    #[test]
    fn build_oauth_legacy_scope_accepts_oidc_and_external_modes() {
        for (label, auth_mode, issuer) in [
            ("legacy-oidc", "oidc", LEGACY_XAI_AUTH_SCOPE),
            ("legacy-external", "external", "https://accounts.x.ai"),
            ("legacy-current-issuer", "oidc", XAI_OAUTH_ISSUER),
        ] {
            let token = fake_jwt(serde_json::json!({
                "iss": issuer,
                "aud": XAI_OAUTH_CLIENT_ID,
                "exp": fixed_oauth_now().timestamp() + 3600
            }));
            let value = build_oauth_entries(&[(
                LEGACY_XAI_AUTH_SCOPE,
                serde_json::json!({
                    "key": token,
                    "auth_mode": auth_mode,
                    "oidc_issuer": issuer,
                    "oidc_client_id": XAI_OAUTH_CLIENT_ID
                }),
            )]);

            read_build_oauth_fixture(label, &value).expect("supported legacy auth mode");
        }
    }

    #[test]
    fn build_oauth_legacy_scope_rejects_non_oauth_and_missing_modes() {
        for (label, auth_mode) in [
            ("legacy-web-login", Some("web_login")),
            ("legacy-grok-alias", Some("grok")),
            ("legacy-api-key", Some("api_key")),
            ("legacy-missing-mode", None),
        ] {
            let mut entry = serde_json::json!({
                "key": "legacy-token",
                "expires_at": "2026-08-28T02:00:00Z"
            });
            if let Some(auth_mode) = auth_mode {
                entry["auth_mode"] = Value::String(auth_mode.to_string());
            }
            let value = build_oauth_entries(&[(LEGACY_XAI_AUTH_SCOPE, entry)]);

            assert_eq!(
                expect_build_oauth_error(read_build_oauth_fixture(label, &value)),
                BuildOauthTokenError::Unavailable
            );
        }
    }

    #[test]
    fn build_oauth_uses_the_earliest_stored_or_jwt_expiry() {
        let cases = [
            (
                "jwt-expires-first",
                fixed_oauth_now().timestamp() + BUILD_OAUTH_EXPIRY_SKEW_SECS,
                "2026-08-28T02:00:00Z",
            ),
            (
                "stored-expiry-first",
                fixed_oauth_now().timestamp() + 3600,
                "2026-08-28T00:01:00Z",
            ),
        ];

        for (label, jwt_expiry, stored_expiry) in cases {
            let token = fake_jwt(serde_json::json!({
                "iss": XAI_OAUTH_ISSUER,
                "aud": XAI_OAUTH_CLIENT_ID,
                "exp": jwt_expiry
            }));
            let value = build_oauth_entries(&[(
                XAI_BUILD_AUTH_SCOPE,
                serde_json::json!({
                    "key": token,
                    "auth_mode": "oidc",
                    "expires_at": stored_expiry
                }),
            )]);

            assert_eq!(
                expect_build_oauth_error(read_build_oauth_fixture(label, &value)),
                BuildOauthTokenError::Expired
            );
        }
    }

    #[test]
    fn build_oauth_falls_back_to_create_time_plus_thirty_days() {
        let now = fixed_oauth_now();
        let valid_create_time = now - ChronoDuration::days(BUILD_OAUTH_FALLBACK_TTL_DAYS)
            + ChronoDuration::seconds(BUILD_OAUTH_EXPIRY_SKEW_SECS + 1);
        let valid = build_oauth_entries(&[(
            XAI_BUILD_AUTH_SCOPE,
            serde_json::json!({
                "key": "valid-fallback-token",
                "auth_mode": "oidc",
                "create_time": valid_create_time.to_rfc3339()
            }),
        )]);
        let snapshot = read_build_oauth_fixture("valid-create-time-fallback", &valid)
            .expect("credential within fallback lifetime");
        assert_eq!(snapshot.expose_to_build_proxy(), "valid-fallback-token");

        let boundary_create_time = now - ChronoDuration::days(BUILD_OAUTH_FALLBACK_TTL_DAYS)
            + ChronoDuration::seconds(BUILD_OAUTH_EXPIRY_SKEW_SECS);
        let expired_create_time = now - ChronoDuration::days(BUILD_OAUTH_FALLBACK_TTL_DAYS);
        for (label, create_time) in [
            (
                "boundary-create-time-fallback",
                Some(boundary_create_time.to_rfc3339()),
            ),
            (
                "expired-create-time-fallback",
                Some(expired_create_time.to_rfc3339()),
            ),
            (
                "invalid-create-time-fallback",
                Some("not-a-date".to_string()),
            ),
            ("missing-create-time-fallback", None),
        ] {
            let mut entry = serde_json::json!({
                "key": "expired-fallback-token",
                "auth_mode": "oidc"
            });
            if let Some(create_time) = create_time {
                entry["create_time"] = Value::String(create_time);
            }
            let value = build_oauth_entries(&[(XAI_BUILD_AUTH_SCOPE, entry)]);

            assert_eq!(
                expect_build_oauth_error(read_build_oauth_fixture(label, &value)),
                BuildOauthTokenError::Expired
            );
        }
    }

    #[test]
    fn build_oauth_revision_distinguishes_same_metadata_different_content() {
        let path = temp_auth_path("content-revision");
        fs::write(&path, b"same-size-a").expect("write auth fixture");

        // Use the same unchanged file metadata for both revisions. Only the
        // in-memory bytes differ, modeling a same-size/same-mtime replacement.
        let first = build_oauth_credential_revision_from_bytes(&path, b"same-size-a")
            .expect("first revision");
        let second = build_oauth_credential_revision_from_bytes(&path, b"same-size-b")
            .expect("second revision");

        assert_eq!(first.file_len, second.file_len);
        assert_eq!(first.modified_ms, second.modified_ms);
        assert_ne!(first, second);
        let debug = format!("{first:?}");
        assert!(debug.contains("[redacted]"));
        assert!(!debug.contains(&hex::encode(first.content_tag)));

        fs::remove_file(path).expect("remove auth fixture");
    }

    #[test]
    fn build_oauth_rejects_missing_refresh_only_and_malformed_files() {
        let missing = temp_auth_path("missing");
        assert_eq!(
            expect_build_oauth_error(read_build_oauth_access_token_from_path_at(
                &missing,
                fixed_oauth_now(),
            )),
            BuildOauthTokenError::Unavailable
        );

        let refresh_only = temp_auth_path("refresh-only");
        let refresh_only_value = build_oauth_entries(&[(
            XAI_BUILD_AUTH_SCOPE,
            serde_json::json!({
                "refresh_token": "refresh-only",
                "auth_mode": "oidc"
            }),
        )]);
        fs::write(&refresh_only, refresh_only_value.to_string())
            .expect("write refresh-only fixture");
        assert_eq!(
            expect_build_oauth_error(read_build_oauth_access_token_from_path_at(
                &refresh_only,
                fixed_oauth_now(),
            )),
            BuildOauthTokenError::Unavailable
        );
        fs::remove_file(refresh_only).expect("remove refresh-only fixture");

        let malformed = temp_auth_path("malformed");
        fs::write(&malformed, "not-json").expect("write malformed fixture");
        assert_eq!(
            expect_build_oauth_error(read_build_oauth_access_token_from_path_at(
                &malformed,
                fixed_oauth_now(),
            )),
            BuildOauthTokenError::Unavailable
        );
        fs::remove_file(malformed).expect("remove malformed fixture");
    }

    #[test]
    fn build_oauth_rejects_expired_near_expiry_and_invalid_expiry() {
        for (label, expires_at) in [
            ("expired", "2026-08-27T23:59:59Z"),
            ("near-expiry", "2026-08-28T00:01:00Z"),
            ("invalid-expiry", "not-a-date"),
        ] {
            let value = build_oauth_entries(&[(
                XAI_BUILD_AUTH_SCOPE,
                serde_json::json!({
                    "access_token": "test-access-token",
                    "auth_mode": "oidc",
                    "expires_at": expires_at
                }),
            )]);
            assert_eq!(
                expect_build_oauth_error(read_build_oauth_fixture(label, &value)),
                BuildOauthTokenError::Expired
            );
        }
    }

    #[test]
    fn build_oauth_error_codes_are_stable_and_secret_free() {
        assert_eq!(
            BuildOauthTokenError::Unavailable.code(),
            "oauth_unavailable"
        );
        assert_eq!(BuildOauthTokenError::Expired.code(), "oauth_expired");
    }
}
