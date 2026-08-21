"""Tests for Windows tray contrast badges."""

from __future__ import annotations

import unittest
from pathlib import Path

from PIL import Image

from tray_win_badge import (
    DARK_TASKBAR,
    LIGHT_TASKBAR,
    compose_badge,
    dark_taskbar_badge,
    light_taskbar_badge,
    write_badges,
)


def _black_mark(canvas: int = 32, mark: int = 16) -> Image.Image:
    im = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    origin = (canvas - mark) // 2
    blob = Image.new("RGBA", (mark, mark), (0, 0, 0, 255))
    im.paste(blob, (origin, origin), blob)
    return im


def _pixel(im: Image.Image, x: int, y: int) -> tuple[int, int, int, int]:
    return im.convert("RGBA").getpixel((x, y))


def _any_pixel(im: Image.Image, pred) -> bool:
    rgba = im.convert("RGBA")
    pix = rgba.load()
    w, h = rgba.size
    return any(pred(pix[x, y]) for y in range(h) for x in range(w))


class TrayWinBadgeTest(unittest.TestCase):
    def test_light_taskbar_is_black_tile_white_glyph(self) -> None:
        out = light_taskbar_badge(_black_mark())
        self.assertEqual(out.size, (32, 32))
        # Top-center of the rounded tile (outside the centered mark).
        bg = _pixel(out, 16, 4)
        self.assertLess(bg[0], 16)
        self.assertLess(bg[1], 16)
        self.assertLess(bg[2], 16)
        self.assertGreater(bg[3], 200)
        fg = _pixel(out, 16, 16)
        self.assertGreater(fg[0], 240)
        self.assertGreater(fg[1], 240)
        self.assertGreater(fg[2], 240)
        self.assertGreater(fg[3], 200)
        # Rounded corner stays transparent.
        corner = _pixel(out, 0, 0)
        self.assertLess(corner[3], 20)

    def test_dark_taskbar_is_white_glyph_on_transparent(self) -> None:
        out = dark_taskbar_badge(_black_mark())
        self.assertEqual(out.size, (32, 32))
        # No large opaque white tile — top-center of the old rounded fill is empty.
        tile = _pixel(out, 16, 4)
        self.assertFalse(
            tile[0] > 240 and tile[1] > 240 and tile[2] > 240 and tile[3] > 200,
            f"dark-taskbar badge must not be a white tile: {tile!r}",
        )
        self.assertLess(tile[3], 20)
        fg = _pixel(out, 16, 16)
        self.assertGreater(fg[0], 240)
        self.assertGreater(fg[1], 240)
        self.assertGreater(fg[2], 240)
        self.assertGreater(fg[3], 200)
        corner = _pixel(out, 0, 0)
        self.assertLess(corner[3], 20)

    def test_compose_uses_requested_colors(self) -> None:
        out = compose_badge(
            _black_mark(),
            bg=(10, 20, 30),
            fg=(200, 210, 220),
        )
        bg = _pixel(out, 16, 4)
        self.assertEqual(bg[:3], (10, 20, 30))
        fg = _pixel(out, 16, 16)
        self.assertEqual(fg[:3], (200, 210, 220))

    def test_write_badges_names(self) -> None:
        import tempfile

        src = _black_mark()
        with tempfile.TemporaryDirectory() as td:
            glyph = Path(td) / "glyph.png"
            src.save(glyph)
            light, dark = write_badges(glyph, Path(td))
            self.assertEqual(light.name, LIGHT_TASKBAR)
            self.assertEqual(dark.name, DARK_TASKBAR)
            self.assertTrue(light.is_file())
            self.assertTrue(dark.is_file())


class GenerateIconsScriptContractTest(unittest.TestCase):
    def test_script_writes_win_badges_from_tray32(self) -> None:
        script = Path(__file__).with_name("generate-icons.sh").read_text()
        self.assertIn("tray_win_badge.py", script)
        self.assertIn("tray-32.png", script)

    def test_shipped_badges_match_taskbar_contrast(self) -> None:
        icons = Path(__file__).resolve().parents[1] / "src-tauri" / "icons"
        light = Image.open(icons / LIGHT_TASKBAR).convert("RGBA")
        dark = Image.open(icons / DARK_TASKBAR).convert("RGBA")
        self.assertEqual(light.size, (32, 32))
        self.assertEqual(dark.size, (32, 32))
        lbg = light.getpixel((16, 4))
        dbg = dark.getpixel((16, 4))
        self.assertLess(lbg[0], 16)
        self.assertGreater(lbg[3], 200)
        # Dark: no white rounded tile at the old fill sample point.
        self.assertFalse(
            dbg[0] > 240 and dbg[1] > 240 and dbg[2] > 240 and dbg[3] > 200,
            f"dark-taskbar badge must not be a white tile: {dbg!r}",
        )
        self.assertLess(dbg[3], 20)
        self.assertLess(dark.getpixel((0, 0))[3], 20)
        # The Grok mark is two strokes — (16,16) may sit in a gap. Scan.
        self.assertTrue(
            _any_pixel(
                light, lambda p: p[0] > 240 and p[1] > 240 and p[2] > 240 and p[3] > 200
            ),
            "light-taskbar badge needs a white glyph",
        )
        self.assertTrue(
            _any_pixel(
                dark, lambda p: p[0] > 240 and p[1] > 240 and p[2] > 240 and p[3] > 200
            ),
            "dark-taskbar badge needs a white glyph",
        )
        self.assertFalse(
            _any_pixel(
                dark, lambda p: p[0] < 16 and p[1] < 16 and p[2] < 16 and p[3] > 200
            ),
            "dark-taskbar badge must not restore a black glyph",
        )
        light.close()
        dark.close()


if __name__ == "__main__":
    unittest.main()
