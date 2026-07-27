#!/usr/bin/env bash
# Download versioned release assets, map platform archives + .sig files, write
# latest.json, and clobber-upload to the rolling `grok-desktop-latest` release.
#
# Usage (CI after all platform builds):
#   TAG=v0.1.9 REPO=owner/grok-app bash scripts/assemble-updater-manifest.sh
#
# Optional: PLATFORM_HINTS="darwin-aarch64:Grok_0.1.9_aarch64.app.tar.gz,..."
#   Prefer explicit matrix mappings over filename heuristics.
#
# Requires: gh, jq. Optional: GH_TOKEN for higher rate limit.
set -euo pipefail

TAG="${TAG:-}"
REPO="${REPO:-${GITHUB_REPOSITORY:-}}"
ROLLING_TAG="${ROLLING_TAG:-grok-desktop-latest}"
WORK="${WORK:-/tmp/grok-updater-assets}"
PLATFORM_HINTS="${PLATFORM_HINTS:-}"

if [[ -z "$TAG" || -z "$REPO" ]]; then
  echo "Usage: TAG=vX.Y.Z REPO=owner/name $0" >&2
  exit 1
fi

VERSION="${TAG#v}"
BASE="https://github.com/${REPO}/releases/download/${ROLLING_TAG}"

rm -rf "$WORK"
mkdir -p "$WORK"
cd "$WORK"

echo "==> Downloading assets for $TAG from $REPO"
gh release download "$TAG" --repo "$REPO" --pattern '*' || {
  echo "error: failed to download release assets for $TAG" >&2
  exit 1
}

# Heuristic map: filename → Tauri platform key.
# Prefer updater archives (.app.tar.gz, .nsis.zip) over installers when both exist.
# Unknown / ambiguous names return empty — never guess wrong arch (P1).
map_platform() {
  local name="$1"
  case "$name" in
    *.app.tar.gz)
      if [[ "$name" == *universal* ]]; then
        # Universal is not a Tauri platform key; skip rather than mis-tag.
        echo ""
      elif [[ "$name" == *aarch64* || "$name" == *arm64* ]]; then
        echo "darwin-aarch64"
      elif [[ "$name" == *x64* || "$name" == *x86_64* || "$name" == *amd64* ]]; then
        echo "darwin-x86_64"
      else
        echo ""
      fi
      ;;
    *.AppImage)
      if [[ "$name" == *aarch64* || "$name" == *arm64* ]]; then
        echo "linux-aarch64"
      else
        echo "linux-x86_64"
      fi
      ;;
    *-setup.exe|*.nsis.zip|*.msi)
      if [[ "$name" == *aarch64* || "$name" == *arm64* ]]; then
        echo "windows-aarch64"
      else
        echo "windows-x86_64"
      fi
      ;;
    *)
      echo ""
      ;;
  esac
}

declare -A ARCHIVE_FOR_PLATFORM=()
declare -A SIG_FOR_PLATFORM=()

# Explicit hints from CI matrix (platform:filename pairs), highest priority.
if [[ -n "$PLATFORM_HINTS" ]]; then
  IFS=',' read -ra HINTS <<<"$PLATFORM_HINTS"
  for hint in "${HINTS[@]}"; do
    [[ -z "$hint" ]] && continue
    platform="${hint%%:*}"
    archive="${hint#*:}"
    if [[ "$platform" == "$hint" || -z "$platform" || -z "$archive" ]]; then
      echo "warn: malformed PLATFORM_HINTS entry: $hint" >&2
      continue
    fi
    if [[ ! -f "$archive" ]]; then
      echo "warn: PLATFORM_HINTS archive missing: $archive (platform=$platform)" >&2
      continue
    fi
    ARCHIVE_FOR_PLATFORM["$platform"]="$archive"
    if [[ -f "${archive}.sig" ]]; then
      SIG_FOR_PLATFORM["$platform"]="${archive}.sig"
    fi
  done
fi

# First pass: collect .sig files keyed by base name.
shopt -s nullglob
for f in *.sig; do
  base="${f%.sig}"
  if [[ -f "$base" ]]; then
    platform="$(map_platform "$base")"
    if [[ -n "$platform" ]]; then
      # Do not overwrite explicit hints.
      if [[ -z "${ARCHIVE_FOR_PLATFORM[$platform]:-}" ]]; then
        SIG_FOR_PLATFORM["$platform"]="$f"
        ARCHIVE_FOR_PLATFORM["$platform"]="$base"
      elif [[ -z "${SIG_FOR_PLATFORM[$platform]:-}" ]]; then
        SIG_FOR_PLATFORM["$platform"]="$f"
      fi
    else
      echo "warn: skipping unmapped archive (need arch in filename): $base"
    fi
  fi
done

# Second pass: archives without paired discovery above.
for f in *.app.tar.gz *.AppImage *-setup.exe *.nsis.zip; do
  [[ -f "$f" ]] || continue
  platform="$(map_platform "$f")"
  if [[ -z "$platform" ]]; then
    echo "warn: skipping unmapped archive (need arch in filename): $f"
    continue
  fi
  if [[ -z "${ARCHIVE_FOR_PLATFORM[$platform]:-}" ]]; then
    ARCHIVE_FOR_PLATFORM["$platform"]="$f"
  fi
  if [[ -z "${SIG_FOR_PLATFORM[$platform]:-}" && -f "${f}.sig" ]]; then
    SIG_FOR_PLATFORM["$platform"]="${f}.sig"
  fi
done
shopt -u nullglob

TRIPLES=()
UPLOAD_FILES=()

# Prefer known desktop targets; also emit any extra keys discovered (e.g. arm64).
PLATFORMS_ORDERED=(darwin-aarch64 darwin-x86_64 linux-x86_64 windows-x86_64 linux-aarch64 windows-aarch64)
declare -A SEEN_PLATFORM=()
for platform in "${PLATFORMS_ORDERED[@]}"; do
  SEEN_PLATFORM["$platform"]=1
  archive="${ARCHIVE_FOR_PLATFORM[$platform]:-}"
  sig="${SIG_FOR_PLATFORM[$platform]:-}"
  if [[ -z "$archive" || -z "$sig" ]]; then
    if [[ -n "$archive" || -n "$sig" ]]; then
      echo "warn: incomplete pair for $platform (archive=${archive:-none} sig=${sig:-none})"
    fi
    continue
  fi
  TRIPLES+=("${platform}:${sig}:${BASE}/${archive}")
  UPLOAD_FILES+=("$archive" "$sig")
done

# Any other platforms from hints not in the ordered list.
for platform in "${!ARCHIVE_FOR_PLATFORM[@]}"; do
  [[ -n "${SEEN_PLATFORM[$platform]:-}" ]] && continue
  archive="${ARCHIVE_FOR_PLATFORM[$platform]:-}"
  sig="${SIG_FOR_PLATFORM[$platform]:-}"
  if [[ -z "$archive" || -z "$sig" ]]; then
    continue
  fi
  TRIPLES+=("${platform}:${sig}:${BASE}/${archive}")
  UPLOAD_FILES+=("$archive" "$sig")
done

if [[ ${#TRIPLES[@]} -eq 0 ]]; then
  echo "error: no updater platform triples found — was createUpdaterArtifacts enabled?" >&2
  echo "hint: archives need arch in the name (e.g. aarch64 / x64) or PLATFORM_HINTS" >&2
  ls -la
  exit 1
fi

echo "==> Platforms: ${#TRIPLES[@]}"
for t in "${TRIPLES[@]}"; do
  echo "  $t"
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bash "$SCRIPT_DIR/generate-latest-json.sh" "$VERSION" "${TRIPLES[@]}" > latest.json
echo "==> latest.json"
cat latest.json

# Ensure rolling release exists.
if ! gh release view "$ROLLING_TAG" --repo "$REPO" >/dev/null 2>&1; then
  echo "==> Creating rolling release $ROLLING_TAG"
  gh release create "$ROLLING_TAG" \
    --repo "$REPO" \
    --title "Grok Desktop auto-updater (rolling)" \
    --notes "Rolling release for the Tauri auto-updater. Prefer versioned vX.Y.Z releases for first-time installs." \
    --latest=false || true
fi

echo "==> Uploading archives + latest.json to $ROLLING_TAG"
declare -A SEEN=()
for f in "${UPLOAD_FILES[@]}" latest.json; do
  [[ -n "${SEEN[$f]:-}" ]] && continue
  SEEN[$f]=1
  gh release upload "$ROLLING_TAG" "$f" --repo "$REPO" --clobber
done

# Also attach latest.json to the versioned release for humans / debugging.
gh release upload "$TAG" latest.json --repo "$REPO" --clobber || true

echo "==> Done"
