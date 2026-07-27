# App update flow

Settings → About → Check for updates.

## Behaviour

1. Query GitHub Releases for the latest tag.
2. Compare semver to the running app.
3. When newer: offer **Download installer** (platform asset) and **Open release page**.

Unsigned community builds do not silent-install; the handoff is download + user install.

## Verify

1. Check update against a known newer release — download URL points at the matching asset when present.
2. When already latest — status says up to date.
