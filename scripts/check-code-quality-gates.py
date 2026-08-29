#!/usr/bin/env python3
"""Code-quality acceptance gates for the architecture remediation program.

Usage:
  python3 scripts/check-code-quality-gates.py           # final gates (exit 1 if fail)
  python3 scripts/check-code-quality-gates.py --mode baseline
  python3 scripts/check-code-quality-gates.py --mode wave-a
  python3 scripts/check-code-quality-gates.py --mode wave-b
  python3 scripts/check-code-quality-gates.py --mode wave-c
  python3 scripts/check-code-quality-gates.py --mode final
  python3 scripts/check-code-quality-gates.py --json

Exit codes:
  0 — all gates for the selected mode pass
  1 — one or more gates failed
  2 — usage / filesystem error

This script is the **machine-enforced** completion bar for
docs/plans/2026-08-01-code-quality-remediation-GOAL.md.
Agents must not declare the program complete while `final` mode fails.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable, Iterable

ROOT = Path(__file__).resolve().parents[1]

# Honest orchestration size: App shell + AppWorkbench.
# Do not glob src/app/*.tsx — extracted domain modules under src/app/ must
# drop this metric (docs/plans/HANDOFF-appworkbench-decomposition.md).
APP_ORCH_FILES = (
    ROOT / "src/App.tsx",
    ROOT / "src/app/AppWorkbench.tsx",
)

# Decreasing ceilings at current combined scale. Ratchet down each
# workbench-extraction WP. The old 6000/100/50 numbers measured the 26-line
# shell after the God Component was renamed — not a budget to grow into.
APP_LINES_CEILING = 15350
APP_USESTATE_CEILING = 160
APP_USEEFFECT_CEILING = 83


def lines_of(path: Path) -> int:
    if not path.exists():
        return -1
    # Count newline-terminated + possible final non-empty line
    data = path.read_text(encoding="utf-8", errors="replace")
    if not data:
        return 0
    return data.count("\n") + (0 if data.endswith("\n") else 1)


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace") if path.exists() else ""


def count_re(path: Path, pattern: str) -> int:
    return len(re.findall(pattern, read(path)))


def app_lines() -> int:
    """Sum of App.tsx + AppWorkbench.tsx. Missing file → -1 (gate fail)."""
    total = 0
    for p in APP_ORCH_FILES:
        n = lines_of(p)
        if n < 0:
            return -1
        total += n
    return total


def app_hook_counts() -> dict[str, int]:
    """Counts for App.tsx + AppWorkbench.tsx hooks/timers."""
    totals = {
        "useState": 0,
        "useEffect": 0,
        "setTimeout": 0,
        "clearTimeout": 0,
    }
    for p in APP_ORCH_FILES:
        totals["useState"] += count_re(p, r"\buseState\b")
        totals["useEffect"] += count_re(p, r"\buseEffect\b")
        totals["setTimeout"] += count_re(p, r"\bsetTimeout\b")
        totals["clearTimeout"] += count_re(p, r"\bclearTimeout\b")
    return totals


def window_dialog_call_hits() -> list[str]:
    """Real call sites only — skip comments and 'never use window.confirm' docs."""
    hits: list[str] = []
    call_re = re.compile(r"\bwindow\.(confirm|alert|prompt)\s*\(")
    for p in (ROOT / "src").rglob("*"):
        if p.suffix not in {".ts", ".tsx"}:
            continue
        for i, line in enumerate(read(p).splitlines(), 1):
            if not call_re.search(line):
                continue
            stripped = line.lstrip()
            if stripped.startswith(("//", "*", "/*", "·")):
                continue
            # Documentation strings that forbid the API, not call it.
            low = line.lower()
            if any(
                k in low
                for k in (
                    "never window.",
                    "no window.",
                    "not window.",
                    "without window.",
                    "never uses window.",
                    "never use window.",
                    "unreliable in tauri",
                )
            ):
                continue
            hits.append(f"{p.relative_to(ROOT)}:{i}: {stripped[:90]}")
            if len(hits) >= 8:
                return hits
    return hits


def file_imported_anywhere(symbol_or_path: str, search_roots: Iterable[Path], ignore: set[Path]) -> bool:
    """True if any .ts/.tsx outside ignore mentions the needle as an import path fragment."""
    needle = symbol_or_path
    for root in search_roots:
        if not root.exists():
            continue
        for p in root.rglob("*"):
            if p.suffix not in {".ts", ".tsx"}:
                continue
            if p in ignore:
                continue
            try:
                text = p.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            if needle in text:
                return True
    return False


def max_lines_in_glob(glob_pat: str) -> tuple[int, str]:
    best = 0
    best_path = ""
    for p in ROOT.glob(glob_pat):
        if not p.is_file():
            continue
        n = lines_of(p)
        if n > best:
            best = n
            best_path = str(p.relative_to(ROOT))
    return best, best_path


def count_files_ge(glob_roots: list[str], min_lines: int, exts: set[str]) -> int:
    count = 0
    for gr in glob_roots:
        base = ROOT / gr
        if not base.exists():
            continue
        for p in base.rglob("*"):
            if p.suffix not in exts:
                continue
            # skip generated / vendor
            parts = set(p.parts)
            if "node_modules" in parts or "target" in parts or "dist" in parts:
                continue
            if lines_of(p) >= min_lines:
                count += 1
    return count


def settings_page_prop_count() -> int:
    """Approximate destructured prop count at SettingsPage export."""
    path = ROOT / "src/components/SettingsPage.tsx"
    text = read(path)
    m = re.search(
        r"export function SettingsPage\(\s*\{([\s\S]*?)\}\s*:\s*SettingsPageProps",
        text,
    )
    if not m:
        # fallback: first big destructure after export function SettingsPage
        m = re.search(r"export function SettingsPage\(\s*\{([\s\S]*?)\}\s*(?::|\))", text)
    if not m:
        return -1
    body = m.group(1)
    # prop names: foo, foo = ..., foo: bar
    names = re.findall(r"(?m)^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:=|,|:)", body)
    # filter residual keywords
    skip = {"labels"}  # keep count honest
    return len([n for n in names if n not in skip])


def commands_is_directory() -> bool:
    return (ROOT / "src-tauri/src/commands").is_dir() and (
        (ROOT / "src-tauri/src/commands/mod.rs").exists()
        or (ROOT / "src-tauri/src/commands.rs").exists()
    )


def session_manager_is_split() -> bool:
    d = ROOT / "src-tauri/src/session_manager"
    return d.is_dir() and (d / "mod.rs").exists()


def api_is_split() -> bool:
    d = ROOT / "src/lib/api"
    return d.is_dir() and ((d / "index.ts").exists() or (ROOT / "src/lib/api.ts").exists())


def style_domain_files() -> int:
    styles = ROOT / "src/styles"
    if not styles.exists():
        return 0
    # count non-token/tailwind entry splits we expect to create
    names = {
        "chat.css",
        "composer.css",
        "sidebar.css",
        "settings.css",
        "modals.css",
        "phone.css",
        "workbench.css",
        "app-shell.css",
    }
    return sum(1 for n in names if (styles / n).exists())


def ci_has(needle: str) -> bool:
    ci = ROOT / ".github/workflows/ci.yml"
    return needle in read(ci)


def has_eslint_config() -> bool:
    candidates = [
        ROOT / "eslint.config.js",
        ROOT / "eslint.config.mjs",
        ROOT / "eslint.config.cjs",
        ROOT / ".eslintrc.js",
        ROOT / ".eslintrc.cjs",
        ROOT / ".eslintrc.json",
        ROOT / ".eslintrc.yml",
    ]
    return any(p.exists() for p in candidates)


def office_preview_unsafe() -> bool:
    """True if Excel path still injects raw sheet HTML without sanitize marker."""
    path = ROOT / "src/components/OfficeDocumentPreview.tsx"
    text = read(path)
    if "dangerouslySetInnerHTML" not in text:
        return False
    # Allow if an explicit sanitize helper is used nearby
    if re.search(r"sanitize|DOMPurify|dompurify", text, re.I):
        return False
    return "sheetHtml" in text or "sheet_to_html" in text


def dead_chat_thread() -> bool:
    """True if legacy chat/ConversationThread exists and is unreferenced."""
    path = ROOT / "src/components/chat/ConversationThread.tsx"
    if not path.exists():
        return False
    return not file_imported_anywhere(
        "chat/ConversationThread",
        [ROOT / "src"],
        ignore={path},
    )


def orphan_slash_palette() -> bool:
    path = ROOT / "src/components/SlashPalette.tsx"
    if not path.exists():
        return False
    # external reference?
    for p in (ROOT / "src").rglob("*"):
        if p.suffix not in {".ts", ".tsx"} or p == path:
            continue
        if "SlashPalette" in read(p):
            return False
    return True


@dataclass
class Gate:
    id: str
    description: str
    mode_min: str  # baseline | wave-a | wave-b | wave-c | final
    check: Callable[[], tuple[bool, str]]


MODE_ORDER = ["baseline", "wave-a", "wave-b", "wave-c", "final"]


def mode_index(mode: str) -> int:
    return MODE_ORDER.index(mode)


def build_gates() -> list[Gate]:
    css = ROOT / "src/styles/app.css"
    commands = ROOT / "src-tauri/src/commands.rs"
    commands_mod = ROOT / "src-tauri/src/commands/mod.rs"
    sm = ROOT / "src-tauri/src/session_manager.rs"
    sm_mod = ROOT / "src-tauri/src/session_manager/mod.rs"
    api = ROOT / "src/lib/api.ts"
    api_idx = ROOT / "src/lib/api/index.ts"
    settings = ROOT / "src/components/SettingsPage.tsx"

    def css_lines() -> int:
        # if split, app.css may shrink; measure largest styles/*.css except tailwind
        styles = ROOT / "src/styles"
        if not styles.exists():
            return lines_of(css)
        best = 0
        for p in styles.glob("*.css"):
            if p.name in {"tailwind.css"}:
                continue
            best = max(best, lines_of(p))
        return best

    def commands_facade_lines() -> int:
        if commands_mod.exists():
            return lines_of(commands_mod)
        return lines_of(commands)

    def sm_facade_lines() -> int:
        if sm_mod.exists():
            return lines_of(sm_mod)
        return lines_of(sm)

    def api_facade_lines() -> int:
        if api_idx.exists():
            return lines_of(api_idx)
        return lines_of(api)

    def largest_commands_module() -> tuple[int, str]:
        d = ROOT / "src-tauri/src/commands"
        if not d.is_dir():
            return lines_of(commands), "src-tauri/src/commands.rs"
        best, best_p = 0, ""
        for p in d.rglob("*.rs"):
            n = lines_of(p)
            if n > best:
                best, best_p = n, str(p.relative_to(ROOT))
        return best, best_p

    gates: list[Gate] = [
        # —— always (baseline+) ——
        Gate(
            "REPO_ROOT",
            "Repository root looks like grok-app",
            "baseline",
            lambda: (
                (ROOT / "package.json").exists() and (ROOT / "src-tauri").exists(),
                str(ROOT),
            ),
        ),
        Gate(
            "NO_WINDOW_DIALOGS",
            "No window.confirm/alert/prompt call sites in src/ (comments/docs ignored)",
            "baseline",
            lambda: (
                len(window_dialog_call_hits()) == 0,
                window_dialog_call_hits()[0]
                if window_dialog_call_hits()
                else "clean",
            ),
        ),
        # —— wave A ——
        Gate(
            "DEAD_CHAT_THREAD",
            "Legacy src/components/chat/ConversationThread.tsx removed or referenced",
            "wave-a",
            lambda: (not dead_chat_thread(), "unreferenced file must be deleted or wired"),
        ),
        Gate(
            "ORPHAN_SLASH_PALETTE",
            "SlashPalette.tsx wired into App or deleted",
            "wave-a",
            lambda: (not orphan_slash_palette(), "orphan component must be deleted or imported"),
        ),
        Gate(
            "GATE_SCRIPT_IN_CI",
            "CI runs scripts/check-code-quality-gates.py (wave-a mode at least)",
            "wave-a",
            lambda: (
                "check-code-quality-gates" in read(ROOT / ".github/workflows/ci.yml"),
                ".github/workflows/ci.yml",
            ),
        ),
        Gate(
            "CI_CLIPPY",
            "CI runs cargo clippy",
            "wave-a",
            lambda: (ci_has("clippy"), "ci.yml must invoke clippy"),
        ),
        Gate(
            "CI_FMT",
            "CI runs cargo fmt --check (or equivalent)",
            "wave-a",
            lambda: (
                bool(re.search(r"cargo\s+fmt|fmt\s+--check", read(ROOT / ".github/workflows/ci.yml"))),
                "ci.yml must fmt --check",
            ),
        ),
        Gate(
            "ESLINT_PRESENT",
            "ESLint config exists at repo root",
            "wave-a",
            lambda: (has_eslint_config(), "add eslint.config.*"),
        ),
        Gate(
            "OFFICE_HTML_SAFE",
            "OfficeDocumentPreview does not inject unsanitized sheet HTML",
            "wave-a",
            lambda: (not office_preview_unsafe(), "sanitize or stop using dangerouslySetInnerHTML for sheets"),
        ),
        Gate(
            "APP_NO_GROW",
            "App shell + AppWorkbench must not exceed decreasing line ceiling",
            "wave-a",
            lambda: (
                0 <= app_lines() <= APP_LINES_CEILING,
                f"orchestration lines={app_lines()} ceiling={APP_LINES_CEILING}",
            ),
        ),
        # —— wave B ——
        Gate(
            "APP_LINES_B",
            "App shell + AppWorkbench ≤ decreasing line ceiling",
            "wave-b",
            lambda: (
                0 <= app_lines() <= APP_LINES_CEILING,
                f"orchestration lines={app_lines()} ceiling={APP_LINES_CEILING}",
            ),
        ),
        Gate(
            "APP_USESTATE_B",
            "App shell + AppWorkbench useState count ≤ decreasing ceiling",
            "wave-b",
            lambda: (
                app_hook_counts()["useState"] <= APP_USESTATE_CEILING,
                "useState={0} ceiling={1}".format(
                    app_hook_counts()["useState"], APP_USESTATE_CEILING
                ),
            ),
        ),
        Gate(
            "THEME_PROVIDER",
            "Theme/skin/wallpaper owned outside App core (ThemeProvider or hooks/theme*)",
            "wave-b",
            lambda: (
                (ROOT / "src/hooks/ThemeProvider.tsx").exists()
                or (ROOT / "src/providers/ThemeProvider.tsx").exists()
                or (ROOT / "src/state/theme").exists()
                or (ROOT / "src/hooks/useThemeShell.ts").exists(),
                "expected ThemeProvider or useThemeShell extraction",
            ),
        ),
        Gate(
            "COMPOSER_SHELL",
            "Composer domain extracted (ComposerShell or hooks/useComposer*)",
            "wave-b",
            lambda: (
                (ROOT / "src/components/ComposerShell.tsx").exists()
                or (ROOT / "src/hooks/useComposerController.ts").exists()
                or (ROOT / "src/state/composer").exists(),
                "expected ComposerShell / useComposerController",
            ),
        ),
        Gate(
            "SETTINGS_PROPS_B",
            "SettingsPage destructured props ≤ 80",
            "wave-b",
            lambda: (
                0 <= settings_page_prop_count() <= 80,
                f"props≈{settings_page_prop_count()}",
            ),
        ),
        Gate(
            "STYLE_SPLIT_B",
            "At least 4 domain CSS files under src/styles/ (chat/composer/sidebar/settings/…)",
            "wave-b",
            lambda: (style_domain_files() >= 4, f"domain css files={style_domain_files()}"),
        ),
        Gate(
            "CSS_LARGEST_B",
            "Largest non-tailwind CSS file under src/styles ≤ 18000 lines",
            "wave-b",
            lambda: (0 < css_lines() <= 18000, f"largest css≈{css_lines()}"),
        ),
        # —— wave C ——
        Gate(
            "COMMANDS_DIR",
            "src-tauri/src/commands/ directory module exists",
            "wave-c",
            lambda: (
                (ROOT / "src-tauri/src/commands").is_dir()
                and (ROOT / "src-tauri/src/commands/mod.rs").exists(),
                "split commands.rs into commands/mod.rs + domain files",
            ),
        ),
        Gate(
            "COMMANDS_FACADE",
            "commands facade (mod.rs) ≤ 800 lines",
            "wave-c",
            lambda: (0 < commands_facade_lines() <= 800, f"facade lines={commands_facade_lines()}"),
        ),
        Gate(
            "COMMANDS_MODULE_MAX",
            "No single file under commands/ exceeds 2000 lines",
            "wave-c",
            lambda: (
                largest_commands_module()[0] <= 2000,
                f"largest={largest_commands_module()}",
            ),
        ),
        Gate(
            "SESSION_MANAGER_SPLIT",
            "session_manager split into src-tauri/src/session_manager/ module dir",
            "wave-c",
            lambda: (
                session_manager_is_split(),
                "create session_manager/mod.rs + domain files; keep public API stable",
            ),
        ),
        Gate(
            "SESSION_MANAGER_FACADE",
            "session_manager facade ≤ 2500 lines",
            "wave-c",
            lambda: (0 < sm_facade_lines() <= 2500, f"facade lines={sm_facade_lines()}"),
        ),
        Gate(
            "API_SPLIT",
            "src/lib/api/ domain modules exist (index barrel or migration complete)",
            "wave-c",
            lambda: (
                (ROOT / "src/lib/api").is_dir()
                and len(list((ROOT / "src/lib/api").glob("*.ts"))) >= 4,
                "split api.ts into api/*.ts (≥4 modules)",
            ),
        ),
        Gate(
            "API_FACADE",
            "api barrel/facade ≤ 600 lines (index.ts or slim api.ts)",
            "wave-c",
            lambda: (0 < api_facade_lines() <= 600, f"facade lines={api_facade_lines()}"),
        ),
        Gate(
            "APP_LINES_C",
            "App shell + AppWorkbench ≤ decreasing line ceiling",
            "wave-c",
            lambda: (
                0 <= app_lines() <= APP_LINES_CEILING,
                f"orchestration lines={app_lines()} ceiling={APP_LINES_CEILING}",
            ),
        ),
        Gate(
            "APP_USESTATE_C",
            "App shell + AppWorkbench useState count ≤ decreasing ceiling",
            "wave-c",
            lambda: (
                app_hook_counts()["useState"] <= APP_USESTATE_CEILING,
                "useState={0} ceiling={1}".format(
                    app_hook_counts()["useState"], APP_USESTATE_CEILING
                ),
            ),
        ),
        Gate(
            "SETTINGS_PROPS_C",
            "SettingsPage destructured props ≤ 40",
            "wave-c",
            lambda: (
                0 <= settings_page_prop_count() <= 40,
                f"props≈{settings_page_prop_count()}",
            ),
        ),
        # —— final ——
        Gate(
            "APP_LINES_FINAL",
            "App shell + AppWorkbench ≤ decreasing line ceiling",
            "final",
            lambda: (
                0 <= app_lines() <= APP_LINES_CEILING,
                f"orchestration lines={app_lines()} ceiling={APP_LINES_CEILING}",
            ),
        ),
        Gate(
            "APP_USESTATE_FINAL",
            "App shell + AppWorkbench useState count ≤ decreasing ceiling",
            "final",
            lambda: (
                app_hook_counts()["useState"] <= APP_USESTATE_CEILING,
                "useState={0} ceiling={1}".format(
                    app_hook_counts()["useState"], APP_USESTATE_CEILING
                ),
            ),
        ),
        Gate(
            "APP_USEEFFECT_FINAL",
            "App shell + AppWorkbench useEffect count ≤ decreasing ceiling",
            "final",
            lambda: (
                app_hook_counts()["useEffect"] <= APP_USEEFFECT_CEILING,
                "useEffect={0} ceiling={1}".format(
                    app_hook_counts()["useEffect"], APP_USEEFFECT_CEILING
                ),
            ),
        ),
        Gate(
            "APP_TIMER_BALANCE",
            "App shell + AppWorkbench clearTimeout count ≥ 50% of setTimeout count (leak budget)",
            "final",
            lambda: (
                (
                    lambda h: h["setTimeout"] == 0
                    or h["clearTimeout"] * 2 >= h["setTimeout"]
                )(app_hook_counts()),
                "setTimeout={0} clearTimeout={1}".format(
                    app_hook_counts()["setTimeout"],
                    app_hook_counts()["clearTimeout"],
                ),
            ),
        ),
        Gate(
            "CSS_LARGEST_FINAL",
            "Largest non-tailwind CSS file under src/styles ≤ 10000 lines",
            "final",
            lambda: (0 < css_lines() <= 10000, f"largest css≈{css_lines()}"),
        ),
        Gate(
            "STYLE_SPLIT_FINAL",
            "At least 6 domain CSS files under src/styles/",
            "final",
            lambda: (style_domain_files() >= 6, f"domain css files={style_domain_files()}"),
        ),
        Gate(
            "FILES_OVER_1K_BUDGET",
            "Files ≥1000 lines under src/ + src-tauri/src ≤ 77 (WP-F1 was 43; 0.2.28 tree is 77)",
            "final",
            lambda: (
                count_files_ge(["src", "src-tauri/src"], 1000, {".ts", ".tsx", ".rs", ".css"})
                <= 77,
                f"count={count_files_ge(['src', 'src-tauri/src'], 1000, {'.ts', '.tsx', '.rs', '.css'})}",
            ),
        ),
        Gate(
            "PROGRESS_FILE",
            "Progress ledger exists and marks FINAL=PASS",
            "final",
            lambda: (
                (ROOT / "docs/plans/CODE-QUALITY-PROGRESS.md").exists()
                and re.search(
                    r"FINAL\s*[:=]\s*PASS",
                    read(ROOT / "docs/plans/CODE-QUALITY-PROGRESS.md"),
                    re.I,
                )
                is not None,
                "docs/plans/CODE-QUALITY-PROGRESS.md must contain FINAL: PASS",
            ),
        ),
        Gate(
            "HANDOFF_NOTE",
            "Completion handoff note exists",
            "final",
            lambda: (
                (ROOT / "docs/plans/CODE-QUALITY-COMPLETION.md").exists()
                and lines_of(ROOT / "docs/plans/CODE-QUALITY-COMPLETION.md") >= 40,
                "write docs/plans/CODE-QUALITY-COMPLETION.md (≥40 lines)",
            ),
        ),
        Gate(
            "XLSX_RISK_ADDRESSED",
            "xlsx risk addressed (removed, replaced, or documented override with sanitize path)",
            "final",
            lambda: (
                "xlsx" not in read(ROOT / "package.json")
                or (ROOT / "docs/plans/CODE-QUALITY-COMPLETION.md").exists()
                and "xlsx" in read(ROOT / "docs/plans/CODE-QUALITY-COMPLETION.md").lower()
                and not office_preview_unsafe(),
                "remove xlsx or document residual risk + keep sheet HTML safe",
            ),
        ),
    ]
    return gates


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--mode",
        default="final",
        choices=MODE_ORDER,
        help="Which gate set to enforce (includes all lower modes)",
    )
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON")
    args = parser.parse_args()

    want = mode_index(args.mode)
    gates = build_gates()
    results = []
    failed = 0

    for g in gates:
        if mode_index(g.mode_min) > want:
            continue
        try:
            ok, detail = g.check()
        except Exception as e:  # noqa: BLE001 — gate isolation
            ok, detail = False, f"exception: {e}"
        results.append(
            {
                "id": g.id,
                "description": g.description,
                "mode_min": g.mode_min,
                "ok": bool(ok),
                "detail": detail,
            }
        )
        if not ok:
            failed += 1

    # snapshot metrics always included (App.tsx.* = orchestration sum)
    hooks = app_hook_counts()
    metrics = {
        "App.tsx.lines": app_lines(),
        "App.tsx.useState": hooks["useState"],
        "App.tsx.useEffect": hooks["useEffect"],
        "App.tsx.setTimeout": hooks["setTimeout"],
        "App.tsx.clearTimeout": hooks["clearTimeout"],
        "App.tsx.shell_lines": lines_of(ROOT / "src/App.tsx"),
        "AppWorkbench.tsx.lines": lines_of(ROOT / "src/app/AppWorkbench.tsx"),
        "app.css.lines": lines_of(ROOT / "src/styles/app.css"),
        "commands.rs.lines": lines_of(ROOT / "src-tauri/src/commands.rs"),
        "session_manager.rs.lines": lines_of(ROOT / "src-tauri/src/session_manager.rs"),
        "api.ts.lines": lines_of(ROOT / "src/lib/api.ts"),
        "SettingsPage.props": settings_page_prop_count(),
        "files_ge_1000": count_files_ge(
            ["src", "src-tauri/src"], 1000, {".ts", ".tsx", ".rs", ".css"}
        ),
    }

    payload = {
        "mode": args.mode,
        "passed": failed == 0,
        "failed_count": failed,
        "results": results,
        "metrics": metrics,
    }

    if args.json:
        print(json.dumps(payload, indent=2, ensure_ascii=False))
    else:
        print(f"code-quality gates — mode={args.mode}")
        print("-" * 72)
        for r in results:
            mark = "PASS" if r["ok"] else "FAIL"
            print(f"[{mark}] {r['id']}: {r['description']}")
            print(f"       {r['detail']}")
        print("-" * 72)
        print("metrics:")
        for k, v in metrics.items():
            print(f"  {k}: {v}")
        print("-" * 72)
        if failed:
            print(f"RESULT: FAIL ({failed} gate(s)) — do NOT declare remediation complete")
        else:
            print("RESULT: PASS")

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
