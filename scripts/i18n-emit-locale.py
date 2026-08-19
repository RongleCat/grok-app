#!/usr/bin/env python3
"""Emit a complete locale catalog from JSON, matching en/ file splits."""

from __future__ import annotations

import json
import os
import re
import sys

ROOT = os.path.join(os.path.dirname(__file__), "..")
EN_DIR = os.path.join(ROOT, "src/i18n/messages/en")
PAT = re.compile(
    r'''^\s*"((?:\\.|[^"\\])+)"\s*:\s*(["'])(?:\\.|(?!\2).)*\2''',
    re.M,
)

EN_FILES = [
    "core.ts",
    "sidebar.ts",
    "project.ts",
    "session.ts",
    "chat.ts",
    "errors.ts",
    "composer.ts",
    "workspace.ts",
    "tasks.ts",
    "slash.ts",
    "account.ts",
    "providers.ts",
    "doctor.ts",
    "extensions.ts",
    "automations.ts",
    "features.ts",
    "kanban.ts",
    "settings.ts",
    "settings-ui.ts",
    "settings-agent.ts",
    "settings-memory.ts",
    "settings-code.ts",
    "settings-remoteIm.ts",
    "settings-pet.ts",
]

EXPORT_PREFIX = {
    "core.ts": "Core",
    "sidebar.ts": "Sidebar",
    "project.ts": "Project",
    "session.ts": "Session",
    "chat.ts": "Chat",
    "errors.ts": "Errors",
    "composer.ts": "Composer",
    "workspace.ts": "Workspace",
    "tasks.ts": "Tasks",
    "slash.ts": "Slash",
    "account.ts": "Account",
    "providers.ts": "Providers",
    "doctor.ts": "Doctor",
    "extensions.ts": "Extensions",
    "automations.ts": "Automations",
    "features.ts": "Features",
    "kanban.ts": "Kanban",
    "settings.ts": "Settings",
    "settings-ui.ts": "SettingsUi",
    "settings-agent.ts": "SettingsAgent",
    "settings-memory.ts": "SettingsMemory",
    "settings-code.ts": "SettingsCode",
    "settings-remoteIm.ts": "SettingsRemoteIm",
    "settings-pet.ts": "SettingsPet",
}


def camel(loc: str) -> str:
    if loc == "pt-BR":
        return "ptBR"
    return loc.replace("-", "")


def ident(loc: str, fname: str) -> str:
    return camel(loc) + EXPORT_PREFIX[fname]


def load_en_keys(fname: str) -> list[str]:
    text = open(os.path.join(EN_DIR, fname), encoding="utf-8").read()
    return [m.group(1) for m in PAT.finditer(text)]


def ts_string(s: str) -> str:
    return json.dumps(s, ensure_ascii=False)


def emit(loc: str, table: dict[str, str]) -> None:
    out_dir = os.path.join(ROOT, "src/i18n/messages", loc)
    os.makedirs(out_dir, exist_ok=True)
    missing: list[str] = []
    exports: list[str] = []
    for fname in EN_FILES:
        keys = load_en_keys(fname)
        lines = [
            f"/** {loc} messages — domain: {fname[:-3]} */",
            f"export const {ident(loc, fname)} = {{",
        ]
        for key in keys:
            if key not in table:
                missing.append(f"{fname}:{key}")
                val = ""
            else:
                val = table[key]
            lines.append(f"  {ts_string(key)}: {ts_string(val)},")
        lines.append("};")
        lines.append("")
        open(os.path.join(out_dir, fname), "w", encoding="utf-8").write(
            "\n".join(lines)
        )
        exports.append(ident(loc, fname))

    var = camel(loc)
    index_imports = [
        f'import {{ {ident(loc, f)} }} from "./{f[:-3]}";' for f in EN_FILES
    ]
    spreads = ",\n  ".join(f"...{name}" for name in exports)
    index = (
        f"/** Merged {loc} message catalog by domain. */\n"
        + "\n".join(index_imports)
        + "\n\nimport type { MessageKey } from \"../en\";\n\n"
        + f"export const {var}: Record<MessageKey, string> = {{\n  {spreads},\n}};\n"
    )
    open(os.path.join(out_dir, "index.ts"), "w", encoding="utf-8").write(index)
    if missing:
        raise SystemExit(f"{loc}: missing {len(missing)} keys, e.g. {missing[:8]}")
    print(f"emitted {loc}: {len(table)} keys")


def main() -> None:
    if len(sys.argv) < 3:
        raise SystemExit("usage: i18n-emit-locale.py <locale> <complete.json>")
    loc = sys.argv[1]
    table = json.load(open(sys.argv[2], encoding="utf-8"))
    emit(loc, table)


if __name__ == "__main__":
    main()
