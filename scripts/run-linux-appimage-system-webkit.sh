#!/usr/bin/env bash
# Run a Grok AppImage against the *system* WebKitGTK 4.1.
#
# Fixes the stock AppImage black window on some Wayland + AMD hosts
# (EGL_BAD_PARAMETER from the CI-bundled WebKit). See issue #539 and
# README "Linux blank/black window (WebKit)".
#
# Usage:
#   bash scripts/run-linux-appimage-system-webkit.sh ./Grok_0.2.11_amd64.AppImage
#   bash scripts/run-linux-appimage-system-webkit.sh ./Grok_*.AppImage -- --some-flag
#
# Env overrides:
#   GROK_APPIMAGE_EXTRACT_DIR  extract target (default: ./Grok-appimage-extract next to cwd)
#   GROK_APPIMAGE_FORCE_EXTRACT=1  re-extract even if dir exists
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 /path/to/Grok_*.AppImage [-- app-args...]" >&2
  exit 2
fi

APPIMAGE="$1"
shift
if [[ "${1:-}" == "--" ]]; then
  shift
fi

if [[ ! -f "$APPIMAGE" ]]; then
  echo "error: AppImage not found: $APPIMAGE" >&2
  exit 1
fi
if [[ ! -x "$APPIMAGE" ]]; then
  chmod +x "$APPIMAGE" || true
fi

# Locate system WebKitGTK 4.1 (process + libraries).
LIB_DIR=""
for d in /usr/lib/x86_64-linux-gnu /usr/lib64 /usr/lib; do
  if [[ -e "$d/libwebkit2gtk-4.1.so.0" || -e "$d/libwebkit2gtk-4.1.so" ]]; then
    LIB_DIR="$d"
    break
  fi
done

WK_EXEC=""
for d in \
  /usr/lib/x86_64-linux-gnu/webkit2gtk-4.1 \
  /usr/lib64/webkit2gtk-4.1 \
  /usr/lib/webkit2gtk-4.1; do
  if [[ -d "$d" ]]; then
    WK_EXEC="$d"
    break
  fi
done

if [[ -z "$LIB_DIR" || -z "$WK_EXEC" ]]; then
  cat >&2 <<'EOF'
error: system WebKitGTK 4.1 not found.

Install it, then re-run:
  Arch / Manjaro:  sudo pacman -S webkit2gtk-4.1
  Debian / Ubuntu: sudo apt-get install -y libegl1 libgles2 libwebkit2gtk-4.1-0 libayatana-appindicator3-1
  Fedora:          sudo dnf install webkit2gtk4.1

Prefer .deb / .rpm from the same Release when possible (they already use system WebKit).
EOF
  exit 1
fi

# Stock AppImage / extracted grok-app also need host libEGL.so.1 (Debian 13 #899).
if [[ ! -e "$LIB_DIR/libEGL.so.1" && ! -e /usr/lib/x86_64-linux-gnu/libEGL.so.1 && ! -e /usr/lib64/libEGL.so.1 && ! -e /usr/lib/libEGL.so.1 ]]; then
  echo "error: libEGL.so.1 not found. Debian/Ubuntu: sudo apt-get install -y libegl1 libgles2 libwebkit2gtk-4.1-0 libayatana-appindicator3-1" >&2
  exit 1
fi

EXTRACT_DIR="${GROK_APPIMAGE_EXTRACT_DIR:-$PWD/Grok-appimage-extract}"
BIN=""
if [[ -x "$EXTRACT_DIR/usr/bin/grok-app" ]]; then
  BIN="$EXTRACT_DIR/usr/bin/grok-app"
elif [[ -x "$EXTRACT_DIR/usr/bin/Grok" ]]; then
  BIN="$EXTRACT_DIR/usr/bin/Grok"
fi

if [[ -z "$BIN" || "${GROK_APPIMAGE_FORCE_EXTRACT:-}" == "1" ]]; then
  echo "extracting AppImage → $EXTRACT_DIR"
  rm -rf "$EXTRACT_DIR"
  mkdir -p "$EXTRACT_DIR"
  # appimagetool / type-2 runtime extract into ./squashfs-root relative to CWD
  WORK="$(mktemp -d)"
  trap 'rm -rf "$WORK"' EXIT
  (
    cd "$WORK"
    # shellcheck disable=SC2086
    "$APPIMAGE" --appimage-extract
    # Move contents (not the squashfs-root folder name) into EXTRACT_DIR
    shopt -s dotglob
    mv squashfs-root/* "$EXTRACT_DIR"/
  )
  trap - EXIT
  rm -rf "$WORK"
  if [[ -x "$EXTRACT_DIR/usr/bin/grok-app" ]]; then
    BIN="$EXTRACT_DIR/usr/bin/grok-app"
  elif [[ -x "$EXTRACT_DIR/usr/bin/Grok" ]]; then
    BIN="$EXTRACT_DIR/usr/bin/Grok"
  else
    echo "error: binary not found under $EXTRACT_DIR/usr/bin (expected grok-app or Grok)" >&2
    ls -la "$EXTRACT_DIR/usr/bin" 2>/dev/null || true
    exit 1
  fi
fi

export LD_LIBRARY_PATH="${LIB_DIR}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export WEBKIT_EXEC_PATH="$WK_EXEC"
# Prefer user overrides; otherwise use the confirmed #539 combo.
export WEBKIT_DISABLE_DMABUF_RENDERER="${WEBKIT_DISABLE_DMABUF_RENDERER:-1}"
export WEBKIT_DISABLE_COMPOSITING_MODE="${WEBKIT_DISABLE_COMPOSITING_MODE:-1}"
export GDK_BACKEND="${GDK_BACKEND:-x11}"
# Avoid AppImage runtime re-injecting APPDIR library paths.
unset APPDIR APPIMAGE OWD || true

echo "using system WebKit: LD_LIBRARY_PATH head=$LIB_DIR WEBKIT_EXEC_PATH=$WK_EXEC"
echo "exec: $BIN $*"
exec "$BIN" "$@"
