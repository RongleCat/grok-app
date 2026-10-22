#!/usr/bin/env python3
"""Pack a pre-sized AppIcon.appiconset into .icns / Tauri PNGs / .ico.

Never resample. Each source raster must already be the pixel size its slot
requires. .icns embeds those PNGs losslessly (no iconutil recompress).
.ico only containers the existing 16/32/64/128/256 rasters.
"""

from __future__ import annotations

import argparse
import io
import struct
import sys
from pathlib import Path

from PIL import Image

# Apple .iconset names ← authored mac raster. Second value is required pixels.
ICONSET_SLOTS: tuple[tuple[str, str, int], ...] = (
    ("icon_16x16.png", "16-mac.png", 16),
    ("icon_16x16@2x.png", "32-mac.png", 32),
    ("icon_32x32.png", "32-mac.png", 32),
    ("icon_32x32@2x.png", "64-mac.png", 64),
    ("icon_128x128.png", "128-mac.png", 128),
    ("icon_128x128@2x.png", "256-mac.png", 256),
    ("icon_256x256.png", "256-mac.png", 256),
    ("icon_256x256@2x.png", "512-mac.png", 512),
    ("icon_512x512.png", "512-mac.png", 512),
    ("icon_512x512@2x.png", "1024-mac.png", 1024),
)

# Tauri bundle.icon PNG names ← authored mac raster / required pixels.
TAURI_PNG_SLOTS: tuple[tuple[str, str, int], ...] = (
    ("32x32.png", "32-mac.png", 32),
    ("64x64.png", "64-mac.png", 64),
    ("128x128.png", "128-mac.png", 128),
    ("128x128@2x.png", "256-mac.png", 256),
    ("icon.png", "512-mac.png", 512),
    ("icon-source.png", "1024-mac.png", 1024),
)

# ICO frames: largest first so Pillow does not skip bigger sizes.
# Only sizes that exist as authored files. No 24/48 invention.
ICO_SLOTS: tuple[tuple[str, int], ...] = (
    ("256-mac.png", 256),
    ("128-mac.png", 128),
    ("64-mac.png", 64),
    ("32-mac.png", 32),
    ("16-mac.png", 16),
)

# PNG-in-ICNS types. Same authored file may fill 1x and @2x slots of equal pixels.
# icp4 / icp5 / icp6 are omitted on purpose. Icon Services and `iconutil` on
# current macOS paint a PNG stored in those legacy slots as colored stripes
# (System Settings, process lists). The same bytes in ic11 / ic12 render
# correctly. 16 and 32 point icons scale down from these PNG slots.
ICNS_PNG_SLOTS: tuple[tuple[bytes, str, int], ...] = (
    (b"ic07", "128-mac.png", 128),
    (b"ic08", "256-mac.png", 256),
    (b"ic09", "512-mac.png", 512),
    (b"ic10", "1024-mac.png", 1024),
    (b"ic11", "32-mac.png", 32),
    (b"ic12", "64-mac.png", 64),
    (b"ic13", "256-mac.png", 256),
    (b"ic14", "512-mac.png", 512),
)
ICNS_MAGIC = b"icns"
ICNS_HEADER = 8


def png_size(path: Path) -> tuple[int, int]:
    with Image.open(path) as im:
        return im.size


def load_rgba_exact(path: Path, side: int) -> Image.Image:
    """Decode whatever container the file is (PNG/WebP) without resampling."""
    if not path.is_file():
        raise SystemExit(f"missing {path}")
    im = Image.open(path)
    im.load()
    rgba = im.convert("RGBA")
    im.close()
    if rgba.size != (side, side):
        raise SystemExit(
            f"{path.name}: got {rgba.size[0]}x{rgba.size[1]}, expected {side}x{side} (no resample)"
        )
    return rgba


def write_png_exact(im: Image.Image, dest: Path, side: int) -> None:
    if im.size != (side, side):
        raise SystemExit(f"refusing to write {dest.name} at {im.size}, expected {side}x{side}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    im.save(dest, format="PNG")
    written_w, written_h = png_size(dest)
    if (written_w, written_h) != (side, side):
        raise SystemExit(f"{dest.name} wrote {written_w}x{written_h}, expected {side}x{side}")


def require_exact_size(path: Path, side: int) -> None:
    if not path.is_file():
        raise SystemExit(f"missing {path}")
    w, h = png_size(path)
    if (w, h) != (side, side):
        raise SystemExit(f"{path.name}: got {w}x{h}, expected {side}x{side} (no resample)")


def validate_appiconset(src: Path) -> None:
    if not src.is_dir():
        raise SystemExit(f"not an appiconset directory: {src}")
    seen: set[str] = set()
    for _dest, name, side in ICONSET_SLOTS:
        if name in seen:
            continue
        seen.add(name)
        require_exact_size(src / name, side)


def copy_iconset(src: Path, iconset: Path) -> None:
    iconset.mkdir(parents=True, exist_ok=True)
    for dest_name, src_name, side in ICONSET_SLOTS:
        rgba = load_rgba_exact(src / src_name, side)
        write_png_exact(rgba, iconset / dest_name, side)
        rgba.close()


def copy_tauri_pngs(src: Path, dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    for dest_name, src_name, side in TAURI_PNG_SLOTS:
        rgba = load_rgba_exact(src / src_name, side)
        write_png_exact(rgba, dest / dest_name, side)
        rgba.close()


def rewrite_src_as_png(src: Path) -> None:
    """Author files may be WebP named .png. Keep pixels; write real PNG."""
    seen: set[str] = set()
    for _dest, name, side in ICONSET_SLOTS:
        if name in seen:
            continue
        seen.add(name)
        path = src / name
        rgba = load_rgba_exact(path, side)
        tmp = path.with_suffix(".png.tmp")
        write_png_exact(rgba, tmp, side)
        rgba.close()
        tmp.replace(path)


def write_ico_no_resize(src: Path, dest: Path) -> None:
    """Container the authored 16/32/64/128/256 rasters. PIL must not resample."""
    frames: list[Image.Image] = []
    sizes: list[tuple[int, int]] = []
    for name, side in ICO_SLOTS:
        im = load_rgba_exact(src / name, side)
        frames.append(im)
        sizes.append((side, side))
    dest.parent.mkdir(parents=True, exist_ok=True)
    # First frame must be the largest: Pillow skips sizes bigger than im.size.
    frames[0].save(
        dest,
        format="ICO",
        sizes=sizes,
        append_images=frames[1:],
    )
    for im in frames:
        im.close()


def png_payload_exact(src: Path, name: str, side: int) -> bytes:
    """PNG bytes for one slot. Prefer the file as-is when it is already PNG."""
    path = src / name
    require_exact_size(path, side)
    data = path.read_bytes()
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return data
    rgba = load_rgba_exact(path, side)
    buf = io.BytesIO()
    rgba.save(buf, format="PNG")
    rgba.close()
    return buf.getvalue()


def write_icns_no_resize(src: Path, dest: Path) -> None:
    """Embed authored PNGs into .icns. No iconutil (it recompresses 16/32)."""
    entries: list[tuple[bytes, int, bytes]] = []
    for typ, name, side in ICNS_PNG_SLOTS:
        payload = png_payload_exact(src, name, side)
        entries.append((typ, ICNS_HEADER + len(payload), payload))
    toc_len = ICNS_HEADER + ICNS_HEADER * len(entries)
    file_length = ICNS_HEADER + toc_len + sum(length for _t, length, _p in entries)
    dest.parent.mkdir(parents=True, exist_ok=True)
    with dest.open("wb") as fp:
        fp.write(ICNS_MAGIC)
        fp.write(struct.pack(">I", file_length))
        fp.write(b"TOC ")
        fp.write(struct.pack(">I", toc_len))
        for typ, length, _payload in entries:
            fp.write(typ)
            fp.write(struct.pack(">I", length))
        for typ, length, payload in entries:
            fp.write(typ)
            fp.write(struct.pack(">I", length))
            fp.write(payload)
    if dest.stat().st_size != file_length:
        raise SystemExit(f"{dest} size {dest.stat().st_size} != header {file_length}")


def pack(src: Path, dest: Path, ico: Path | None, rewrite_src: bool = False) -> None:
    validate_appiconset(src)
    if rewrite_src:
        rewrite_src_as_png(src)
        validate_appiconset(src)
    dest.mkdir(parents=True, exist_ok=True)
    copy_tauri_pngs(src, dest)
    write_icns_no_resize(src, dest / "icon.icns")
    if ico is not None:
        write_ico_no_resize(src, ico)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("appiconset", type=Path, help="AppIcon.appiconset directory")
    p.add_argument("--dest", type=Path, required=True, help="Output dir (icons or icons/dev)")
    p.add_argument("--ico", type=Path, default=None, help="Optional .ico path (no resample)")
    p.add_argument(
        "--rewrite-src",
        action="store_true",
        help="Write real PNG back into the appiconset (same pixels; WebP→PNG)",
    )
    args = p.parse_args(argv)
    pack(args.appiconset, args.dest, args.ico, rewrite_src=args.rewrite_src)
    print(f"OK packed {args.appiconset} → {args.dest}/icon.icns (no resample)")
    if args.ico is not None:
        print(f"OK packed {args.ico} from authored 16/32/64/128/256")
    return 0


if __name__ == "__main__":
    sys.exit(main())
