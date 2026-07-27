# Trust sandbox

Absolute filesystem access is gated by `path_scope`: trusted project roots, app data, temp, and explicit user grants (file picker).

- `media://` rejects disallowed paths and non-main-window CORS origins.
- Asset protocol denies common secret locations (`.ssh`, `secrets.json`, …).
- CSP is enabled (no `null`); scripts stay `'self'`.
