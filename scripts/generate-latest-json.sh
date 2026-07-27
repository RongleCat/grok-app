#!/usr/bin/env bash
# Assemble a multi-platform Tauri updater latest.json.
#
# Usage:
#   generate-latest-json.sh <version> <platform-key:sig-file:archive-url>...
#
# Example:
#   ./scripts/generate-latest-json.sh 0.1.9 \
#     darwin-aarch64:./Grok.app.tar.gz.sig:https://github.com/org/grok-app/releases/download/grok-desktop-latest/Grok_aarch64.app.tar.gz \
#     linux-x86_64:./Grok.AppImage.sig:https://github.com/org/grok-app/releases/download/grok-desktop-latest/Grok.AppImage
#
# Platform keys (Tauri 2):
#   darwin-aarch64 | darwin-x86_64 | linux-x86_64 | windows-x86_64
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: generate-latest-json.sh <version> <platform-key:sig-file:archive-url>..." >&2
  exit 1
fi

VERSION="$1"
shift

if ! command -v jq >/dev/null 2>&1; then
  echo "Error: jq is required" >&2
  exit 1
fi

platform_args=()
platforms_obj="{}"
i=0
for triple in "$@"; do
  key="${triple%%:*}"
  rest="${triple#*:}"
  sig_file="${rest%%:*}"
  url="${rest#*:}"
  if [[ "$key" == "$triple" || "$sig_file" == "$rest" || -z "$key" || -z "$sig_file" || -z "$url" ]]; then
    echo "Error: malformed triple '$triple' (expected platform-key:sig-file:archive-url)" >&2
    exit 1
  fi
  if [[ ! -f "$sig_file" ]]; then
    echo "Error: signature file not found: $sig_file" >&2
    exit 1
  fi

  # Strip CR so Windows-checked-out or macOS-exported .sig files still verify.
  sig_body="$(tr -d '\r' <"$sig_file")"
  if [[ -z "$sig_body" ]]; then
    echo "Error: empty signature file: $sig_file" >&2
    exit 1
  fi
  # Soft format check: minisign blocks start with "untrusted comment" or base64 "RWT".
  first_line="$(printf '%s\n' "$sig_body" | head -n1)"
  if [[ "$first_line" != untrusted\ comment:* && "$first_line" != RWT* ]]; then
    echo "warn: signature file may not be minisign format: $sig_file (first line: ${first_line:0:40})" >&2
  fi

  sig_arg="sig$i"
  url_arg="url$i"
  platform_args+=(--arg "$sig_arg" "$sig_body" --arg "$url_arg" "$url")
  platforms_obj="$platforms_obj + { \"$key\": { signature: \$$sig_arg, url: \$$url_arg } }"
  i=$((i + 1))
done

jq -n \
  --arg version "$VERSION" \
  --arg notes "Grok App v$VERSION" \
  --arg pub_date "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  "${platform_args[@]}" \
  "{ version: \$version, notes: \$notes, pub_date: \$pub_date, platforms: ($platforms_obj) }"
