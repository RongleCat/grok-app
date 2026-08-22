#!/usr/bin/env bash
# White (inverted) dock icon for `pnpm dev` only. Production icons stay black.
# Requires ffmpeg (negate) + sips/iconutil (macOS).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/src-tauri/icons/icon-source.png"
OUT="$ROOT/src-tauri/icons/dev"
command -v ffmpeg >/dev/null || { echo "ffmpeg required" >&2; exit 1; }
command -v sips >/dev/null || { echo "sips required (macOS)" >&2; exit 1; }
command -v iconutil >/dev/null || { echo "iconutil required (macOS)" >&2; exit 1; }
[[ -f "$SRC" ]] || { echo "missing $SRC" >&2; exit 1; }
mkdir -p "$OUT"
ffmpeg -y -i "$SRC" -vf negate -update 1 -frames:v 1 "$OUT/icon-source.png" -hide_banner -loglevel error
sips -z 512 512 "$OUT/icon-source.png" --out "$OUT/icon.png" >/dev/null
sips -z 32 32 "$OUT/icon-source.png" --out "$OUT/32x32.png" >/dev/null
sips -z 64 64 "$OUT/icon-source.png" --out "$OUT/64x64.png" >/dev/null
sips -z 128 128 "$OUT/icon-source.png" --out "$OUT/128x128.png" >/dev/null
sips -z 256 256 "$OUT/icon-source.png" --out "$OUT/128x128@2x.png" >/dev/null
ICONSET="$OUT/AppIcon.iconset"
rm -rf "$ICONSET"
mkdir -p "$ICONSET"
while read -r size name; do
  sips -z "$size" "$size" "$OUT/icon-source.png" --out "$ICONSET/$name" >/dev/null
done <<'PAIRS'
16 icon_16x16.png
32 icon_16x16@2x.png
32 icon_32x32.png
64 icon_32x32@2x.png
128 icon_128x128.png
256 icon_128x128@2x.png
256 icon_256x256.png
512 icon_256x256@2x.png
512 icon_512x512.png
1024 icon_512x512@2x.png
PAIRS
iconutil -c icns "$ICONSET" -o "$OUT/icon.icns"
rm -rf "$ICONSET"
echo "wrote $OUT/icon.icns"
