#!/usr/bin/env bash
# Create an annotated release tag after syncing version across manifests.
# Usage:
#   ./scripts/release-tag.sh 0.1.1
#   ./scripts/release-tag.sh 0.1.1 --push
#
# Does NOT push by default. CI (.github/workflows/release.yml) runs on tag push v*.
#
# Release notes (GitHub Release body) are generated from CHANGELOG.md by CI:
#   scripts/changelog-for-release.py → releaseBody for tauri-action
# Before tagging, ensure CHANGELOG has a section:
#   ## [X.Y.Z] - YYYY-MM-DD
# with bilingual (EN + 中文) notes under Added/Fixed/Changed as needed.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION="${1:-}"
PUSH="${2:-}"

if [[ -z "$VERSION" ]]; then
  echo "usage: $0 <semver> [--push]" >&2
  echo "example: $0 0.1.1 --push" >&2
  exit 1
fi

# strip leading v if provided
VERSION="${VERSION#v}"
TAG="v${VERSION}"

if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-].*)?$ ]]; then
  echo "error: invalid semver: $VERSION" >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "error: working tree not clean. Commit or stash first." >&2
  git status -sb
  exit 1
fi

if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "error: tag already exists: $TAG" >&2
  exit 1
fi

# Fail early if CHANGELOG section is missing (CI would fail the same way).
if ! python3 scripts/changelog-for-release.py "$VERSION" >/dev/null; then
  echo "error: add bilingual release notes under ## [$VERSION] in CHANGELOG.md first." >&2
  exit 1
fi
echo "==> CHANGELOG section for $VERSION OK (will become GitHub Release body)"

# Refresh circular-avatar contributor galleries in README_*.md (see docs/llm-wiki/release.md).
# Prefer authenticated GitHub API when gh is logged in (avoids anonymous rate limits).
if [[ -z "${GITHUB_TOKEN:-}" && -z "${GH_TOKEN:-}" ]] && command -v gh >/dev/null 2>&1; then
  if tok="$(gh auth token 2>/dev/null)" && [[ -n "$tok" ]]; then
    export GITHUB_TOKEN="$tok"
  fi
fi
echo "==> Refreshing README contributors (circular avatars)"
if ! python3 scripts/update-contributors.py; then
  echo "error: scripts/update-contributors.py failed (network / GitHub API)." >&2
  echo "  export GITHUB_TOKEN=\"\$(gh auth token)\" and re-run, or update READMEs manually." >&2
  exit 1
fi

echo "==> Bumping version to $VERSION"
export VER="$VERSION"

python3 - <<'PY'
import json, os, re
from pathlib import Path

ver = os.environ["VER"]

# package.json
p = Path("package.json")
data = json.loads(p.read_text())
data["version"] = ver
p.write_text(json.dumps(data, indent=2) + "\n")
print("package.json ->", ver)

# tauri.conf.json
p = Path("src-tauri/tauri.conf.json")
data = json.loads(p.read_text())
data["version"] = ver
p.write_text(json.dumps(data, indent=2) + "\n")
print("tauri.conf.json ->", ver)

# Cargo.toml [package] version only (first match)
p = Path("src-tauri/Cargo.toml")
text = p.read_text()
text2, n = re.subn(r'(?m)^version\s*=\s*"[^"]+"', f'version = "{ver}"', text, count=1)
if n != 1:
    raise SystemExit("failed to patch Cargo.toml version")
p.write_text(text2)
print("Cargo.toml ->", ver)

# Cargo.lock package stanza for this crate
p = Path("src-tauri/Cargo.lock")
if p.is_file():
    lock = p.read_text()
    lock2, n = re.subn(
        r'(name = "grok-app"\nversion = ")[^"]+(")',
        rf"\g<1>{ver}\2",
        lock,
        count=1,
    )
    if n != 1:
        raise SystemExit("failed to patch Cargo.lock grok-app version")
    p.write_text(lock2)
    print("Cargo.lock grok-app ->", ver)

# i18n version footer in every locale catalog (en is the key authority)
core_files = sorted(Path("src/i18n/messages").glob("*/core.ts"))
legacy = [Path(rel) for rel in ("src/i18n/messages.ts",)]
found = 0
for p in core_files + legacy:
    if not p.is_file():
        continue
    t = p.read_text()
    t2, n = re.subn(r"(Grok v)[0-9]+\.[0-9]+\.[0-9]+", rf"\g<1>{ver}", t)
    if n:
        p.write_text(t2)
        print(f"{p} versionFooter ->", ver)
        found += 1
    else:
        print(f"warn: versionFooter pattern not found in {p}")
if found < 15:
    raise SystemExit(f"expected ≥15 locale versionFooters, patched {found}")
PY

git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock \
  src/i18n/messages/*/core.ts \
  src/i18n/messages.ts \
  README.md README_EN.md README_ZH.md README_RU.md 2>/dev/null || true
if [[ -n "$(git status --porcelain)" ]]; then
  git commit -m "chore: release $TAG"
fi

git tag -a "$TAG" -m "Release $TAG"
echo "Created tag $TAG"

if [[ "$PUSH" == "--push" ]]; then
  git push origin HEAD
  git push origin "$TAG"
  echo "Pushed $TAG — GitHub Actions release workflow should start."
else
  echo "Tag is local only. Push when ready:"
  echo "  git push origin HEAD && git push origin $TAG"
fi
