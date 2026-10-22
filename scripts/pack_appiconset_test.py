"""pack_appiconset never resamples authored PNGs."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from PIL import Image

import pack_appiconset as pack


def _write_png(path: Path, side: int, color: tuple[int, int, int, int]) -> None:
    Image.new("RGBA", (side, side), color).save(path, "PNG")


def _icns_types(data: bytes) -> set[bytes]:
    import struct

    assert data[:4] == b"icns"
    types: set[bytes] = set()
    off = 8
    while off + 8 <= len(data):
        typ = data[off : off + 4]
        length = struct.unpack(">I", data[off + 4 : off + 8])[0]
        if length < 8:
            break
        types.add(typ)
        off += length
    return types


class PackAppiconsetTest(unittest.TestCase):
    def test_require_exact_size_rejects_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "32-mac.png"
            _write_png(p, 31, (0, 0, 0, 255))
            with self.assertRaises(SystemExit):
                pack.require_exact_size(p, 32)

    def test_copy_iconset_keeps_pixels_and_size(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / "set"
            src.mkdir()
            colors = {
                16: (1, 2, 3, 255),
                32: (4, 5, 6, 255),
                64: (7, 8, 9, 255),
                128: (10, 11, 12, 255),
                256: (13, 14, 15, 255),
                512: (16, 17, 18, 255),
                1024: (19, 20, 21, 255),
            }
            names = {
                16: "16-mac.png",
                32: "32-mac.png",
                64: "64-mac.png",
                128: "128-mac.png",
                256: "256-mac.png",
                512: "512-mac.png",
                1024: "1024-mac.png",
            }
            pixels = {}
            for side, name in names.items():
                path = src / name
                _write_png(path, side, colors[side])
                with Image.open(path) as im:
                    pixels[name] = list(im.getdata())
            iconset = Path(tmp) / "AppIcon.iconset"
            pack.copy_iconset(src, iconset)
            for dest_name, src_name, side in pack.ICONSET_SLOTS:
                copied = iconset / dest_name
                self.assertEqual(pack.png_size(copied), (side, side))
                with Image.open(copied) as im:
                    self.assertEqual(list(im.getdata()), pixels[src_name])

    def test_write_ico_keeps_frame_sizes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp)
            for name, side in pack.ICO_SLOTS:
                _write_png(src / name, side, (side % 255, 0, 0, 255))
            dest = Path(tmp) / "icon.ico"
            pack.write_ico_no_resize(src, dest)
            with Image.open(dest) as ico:
                sizes = set()
                try:
                    idx = 0
                    while True:
                        ico.seek(idx)
                        sizes.add(ico.size)
                        idx += 1
                except EOFError:
                    pass
            self.assertEqual(
                ico.info.get("sizes"),
                {(16, 16), (32, 32), (64, 64), (128, 128), (256, 256)},
            )

    def test_write_icns_embeds_exact_pixels(self) -> None:
        from PIL import IcnsImagePlugin

        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / "set"
            src.mkdir()
            colors = {
                16: (10, 20, 30, 255),
                32: (40, 50, 60, 255),
                64: (70, 80, 90, 255),
                128: (11, 22, 33, 255),
                256: (44, 55, 66, 255),
                512: (77, 88, 99, 255),
                1024: (12, 34, 56, 255),
            }
            names = {
                16: "16-mac.png",
                32: "32-mac.png",
                64: "64-mac.png",
                128: "128-mac.png",
                256: "256-mac.png",
                512: "512-mac.png",
                1024: "1024-mac.png",
            }
            for side, name in names.items():
                _write_png(src / name, side, colors[side])
            dest = Path(tmp) / "icon.icns"
            pack.write_icns_no_resize(src, dest)
            types = _icns_types(dest.read_bytes())
            self.assertTrue(
                {b"ic07", b"ic08", b"ic09", b"ic10", b"ic11", b"ic12", b"ic13", b"ic14"}
                <= types
            )
            # Legacy slots decode as stripes in System Settings (#1364).
            self.assertFalse(types & {b"icp4", b"icp5", b"icp6"})
            checks = {
                (16, 16, 2): "32-mac.png",
                (32, 32, 2): "64-mac.png",
                (128, 128, 1): "128-mac.png",
                (256, 256, 1): "256-mac.png",
                (512, 512, 1): "512-mac.png",
                (512, 512, 2): "1024-mac.png",
            }
            with dest.open("rb") as fp:
                icns = IcnsImagePlugin.IcnsFile(fp)
                for key, name in checks.items():
                    got = icns.getimage(key).convert("RGBA")
                    with Image.open(src / name) as ref:
                        self.assertEqual(got.size, ref.size)
                        self.assertEqual(list(got.getdata()), list(ref.convert("RGBA").getdata()))
                    got.close()


if __name__ == "__main__":
    unittest.main()
