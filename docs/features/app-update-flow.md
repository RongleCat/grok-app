# App update flow

Settings → About → Check for updates.

## Behaviour

1. Signed release (plugin on + platform supports): check → download → install → `prepare_for_app_update` → relaunch.
2. Unsigned / local / plugin off: query GitHub Releases, then **Open release page** and optional **Download installer**.
3. Package types that cannot auto-update (e.g. Linux non-AppImage): **unsupported** channel + Linux AppImage-only note; manual download CTAs when a newer build is known.
4. Status copy and channel honesty: pure `src/lib/appUpdateHonesty.ts` + About row (`AboutUpdateRow`) — never invents versions; soft-fail error classes; agents stop only after successful install prepare.
5. Empty / check-failed: idle shows “no update status yet”; check/open failures use classified soft-fail hints (never claim silent update).

## Verify

1. Check update against a known newer release — download URL points at the matching asset when present.
2. When already latest — status says up to date.
3. Local / unsigned build shows GitHub download channel, not silent in-app.
4. Linux non-AppImage (when plugin on) shows unsupported channel + AppImage note.
