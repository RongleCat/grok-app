"""Windows tray badges: high-contrast mark for light vs dark taskbars.

Windows has no macOS-style template icons. A black glyph on a dark taskbar
vanishes (#747). Pair (do not swap the two assets):

- light taskbar → black fill, white glyph (`tray-win-light.png`)
- dark taskbar  → white glyph on transparency (`tray-win-dark.png`)

#748 used a white tile / black glyph on dark taskbars so the mark stayed
visible. That tile reads as a white square in the notification area (#776);
the dark asset is a white glyph on a transparent canvas instead. Do not
restore black-on-transparent (the #747 bug). Host still picks by taskbar
`SystemUsesLightTheme`, not the in-app theme.

Input is the monochrome `tray-32.png` (or any black-on-transparent mark).
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 32
# Leave a 2px ring so neighboring notification-area icons do not touch.
INSET = 2
# Windows 11-ish rounded square (~22% of the inner tile).
RADIUS = 6
# Glyph pad inside the tile (each side). Tighter than the macOS menu-bar 14%.
GLYPH_PAD = 0.16

LIGHT_TASKBAR = "tray-win-light.png"
DARK_TASKBAR = "tray-win-dark.png"


def opaque_bbox(im: Image.Image, alpha_min: int = 8) -> tuple[int, int, int, int] | None:
    src = im.convert("RGBA")
    pix = src.load()
    w, h = src.size
    xs: list[int] = []
    ys: list[int] = []
    for y in range(h):
        for x in range(w):
            if pix[x, y][3] > alpha_min:
                xs.append(x)
                ys.append(y)
    if not xs:
        return None
    return min(xs), min(ys), max(xs), max(ys)


def fit_glyph(src: Image.Image, size: int, pad_ratio: float) -> Image.Image:
    """Center the opaque mark on a transparent square with `pad_ratio` margin."""
    src = src.convert("RGBA")
    box = opaque_bbox(src)
    if box is None:
        return Image.new("RGBA", (size, size), (0, 0, 0, 0))
    x0, y0, x1, y1 = box
    crop = src.crop((x0, y0, x1 + 1, y1 + 1))
    inner = max(1, int(round(size * (1.0 - 2 * pad_ratio))))
    cw, ch = crop.size
    scale = min(inner / cw, inner / ch)
    nw = max(1, int(round(cw * scale)))
    nh = max(1, int(round(ch * scale)))
    resized = crop.resize((nw, nh), Image.Resampling.LANCZOS)
    _r, _g, _b, a = resized.split()
    black = Image.new("L", resized.size, 0)
    mark = Image.merge("RGBA", (black, black, black, a))
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(mark, ((size - nw) // 2, (size - nh) // 2))
    return canvas


def _tile_mask(size: int, inset: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle(
        (inset, inset, size - 1 - inset, size - 1 - inset),
        radius=radius,
        fill=255,
    )
    return mask


def tint_glyph(glyph: Image.Image, rgb: tuple[int, int, int]) -> Image.Image:
    g = glyph.convert("RGBA")
    _r, _g, _b, a = g.split()
    return Image.merge(
        "RGBA",
        (
            Image.new("L", g.size, rgb[0]),
            Image.new("L", g.size, rgb[1]),
            Image.new("L", g.size, rgb[2]),
            a,
        ),
    )


def compose_badge(
    glyph: Image.Image,
    *,
    bg: tuple[int, int, int],
    fg: tuple[int, int, int],
    size: int = SIZE,
    inset: int = INSET,
    radius: int = RADIUS,
    pad_ratio: float = GLYPH_PAD,
) -> Image.Image:
    """Rounded tile + tinted glyph. `bg`/`fg` are RGB."""
    mark = fit_glyph(glyph, size, pad_ratio)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    fill = Image.new("RGBA", (size, size), (*bg, 255))
    canvas.paste(fill, (0, 0), _tile_mask(size, inset, radius))
    canvas.alpha_composite(tint_glyph(mark, fg))
    return canvas


def light_taskbar_badge(glyph: Image.Image, **kwargs) -> Image.Image:
    """Black tile, white mark — for a light Windows taskbar."""
    return compose_badge(glyph, bg=(0, 0, 0), fg=(255, 255, 255), **kwargs)


def dark_taskbar_badge(glyph: Image.Image, **kwargs) -> Image.Image:
    """White glyph on transparency — for a dark Windows taskbar (no fill tile)."""
    size = kwargs.get("size", SIZE)
    pad_ratio = kwargs.get("pad_ratio", GLYPH_PAD)
    mark = fit_glyph(glyph, size, pad_ratio)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(tint_glyph(mark, (255, 255, 255)))
    return canvas


def write_badges(glyph_src: Path, dest_dir: Path) -> tuple[Path, Path]:
    dest_dir = Path(dest_dir)
    dest_dir.mkdir(parents=True, exist_ok=True)
    glyph = Image.open(glyph_src)
    light = dest_dir / LIGHT_TASKBAR
    dark = dest_dir / DARK_TASKBAR
    light_taskbar_badge(glyph).save(light, "PNG")
    dark_taskbar_badge(glyph).save(dark, "PNG")
    return light, dark


if __name__ == "__main__":
    import argparse

    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("glyph", type=Path, help="Black-on-transparent tray PNG (tray-32.png)")
    p.add_argument("dest_dir", type=Path, help="icons directory")
    args = p.parse_args()
    light, dark = write_badges(args.glyph, args.dest_dir)
    print(f"OK — {light.name} (light taskbar) + {dark.name} (dark taskbar)")
