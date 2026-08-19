#!/usr/bin/env python3
"""Merge have+fill JSON into a complete catalog and emit TS files."""

from __future__ import annotations

import json
import os
import subprocess
import sys

ROOT = os.path.join(os.path.dirname(__file__), "..")
TMP = "/tmp/grok-i18n"


def merge_locale(loc: str) -> tuple[int, int]:
    en = json.load(open(os.path.join(TMP, "en.json"), encoding="utf-8"))
    have: dict[str, str] = {}
    # fill last so new translations win over stale complete dumps
    for name in (f"{loc}-complete.json", f"{loc}-have.json", f"{loc}-fill.json"):
        path = os.path.join(TMP, name)
        if not os.path.isfile(path):
            continue
        obj = json.load(open(path, encoding="utf-8"))
        if isinstance(obj, dict):
            have.update({k: v for k, v in obj.items() if isinstance(v, str) and v.strip()})
    complete = {k: have.get(k, en[k]) for k in en}
    out = os.path.join(TMP, f"{loc}-complete.json")
    json.dump(complete, open(out, "w", encoding="utf-8"), ensure_ascii=False)
    same = sum(1 for k in en if complete[k] == en[k])
    subprocess.check_call(
        [sys.executable, os.path.join(ROOT, "scripts/i18n-emit-locale.py"), loc, out],
        cwd=ROOT,
    )
    return len(en) - same, same


def main() -> None:
    locs = sys.argv[1:] or [
        "de",
        "es",
        "fil",
        "fr",
        "id",
        "ko",
        "pt-BR",
        "ru",
        "ta",
        "uk",
    ]
    for loc in locs:
        unique, same = merge_locale(loc)
        print(f"{loc:6} unique={unique:4} same-as-en={same:4}")


if __name__ == "__main__":
    main()
