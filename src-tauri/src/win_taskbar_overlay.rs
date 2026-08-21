//! Windows taskbar overlay badge for unread / busy sessions.
//!
//! Tauri `WebviewWindow::set_badge_count` is a no-op on Windows (wry has no
//! `SetBadgeCount` branch; the docs say use `set_overlay_icon`). This module
//! paints a 16×16 overlay and remembers the last count so hide-to-tray
//! `DeleteTab` / `AddTab` can put it back.

use std::sync::atomic::{AtomicU32, Ordering};

pub const SIZE: u32 = 16;
static LAST_COUNT: AtomicU32 = AtomicU32::new(0);

/// Fill of the circular badge (same orange-red family as the pet unread pastille).
const FILL: [u8; 3] = [232, 72, 48];
const GLYPH: [u8; 3] = [255, 255, 255];

/// 5×7 digit bitmaps, MSB = left column of each row.
const DIGITS: [[u8; 7]; 10] = [
    [
        0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110,
    ], // 0
    [
        0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110,
    ], // 1
    [
        0b01110, 0b10001, 0b00001, 0b00110, 0b01000, 0b10000, 0b11111,
    ], // 2
    [
        0b01110, 0b10001, 0b00001, 0b00110, 0b00001, 0b10001, 0b01110,
    ], // 3
    [
        0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010,
    ], // 4
    [
        0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110,
    ], // 5
    [
        0b01110, 0b10000, 0b11110, 0b10001, 0b10001, 0b10001, 0b01110,
    ], // 6
    [
        0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000,
    ], // 7
    [
        0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110,
    ], // 8
    [
        0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00001, 0b01110,
    ], // 9
];

/// Plus mark for counts ≥ 10 (5×5, centered).
const PLUS: [u8; 5] = [0b00100, 0b00100, 0b11111, 0b00100, 0b00100];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OverlayKind {
    Digit(u8),
    Overflow,
}

/// Pure: which overlay to show for a busy/unread count.
pub fn overlay_kind(count: u32) -> Option<OverlayKind> {
    match count {
        0 => None,
        1..=9 => Some(OverlayKind::Digit(count as u8)),
        _ => Some(OverlayKind::Overflow),
    }
}

/// Remember the last count so show-from-tray can re-apply after AddTab.
pub fn remember(count: u32) {
    LAST_COUNT.store(count, Ordering::Relaxed);
}

pub fn last_count() -> u32 {
    LAST_COUNT.load(Ordering::Relaxed)
}

/// 16×16 RGBA (row-major). `None` means clear the overlay.
pub fn overlay_rgba(count: u32) -> Option<Vec<u8>> {
    overlay_kind(count).map(render)
}

fn render(kind: OverlayKind) -> Vec<u8> {
    let mut px = vec![0u8; (SIZE * SIZE * 4) as usize];
    let cx = (SIZE as f32 / 2.0) - 0.5;
    let cy = cx;
    let r = (SIZE as f32 / 2.0) - 0.6;
    for y in 0..SIZE {
        for x in 0..SIZE {
            let dx = x as f32 - cx;
            let dy = y as f32 - cy;
            let d = (dx * dx + dy * dy).sqrt();
            let a = if d <= r - 0.5 {
                255u8
            } else if d >= r + 0.5 {
                0
            } else {
                ((r + 0.5 - d) * 255.0).clamp(0.0, 255.0) as u8
            };
            if a == 0 {
                continue;
            }
            let i = pixel_index(x, y);
            px[i] = FILL[0];
            px[i + 1] = FILL[1];
            px[i + 2] = FILL[2];
            px[i + 3] = a;
        }
    }
    match kind {
        OverlayKind::Digit(n) => blit_bits(&mut px, &DIGITS[n as usize], 5, 7, 6, 4),
        OverlayKind::Overflow => blit_bits(&mut px, &PLUS, 5, 5, 6, 5),
    }
    px
}

fn pixel_index(x: u32, y: u32) -> usize {
    ((y * SIZE + x) * 4) as usize
}

fn blit_bits(px: &mut [u8], rows: &[u8], width: u32, height: u32, ox: u32, oy: u32) {
    for row in 0..height {
        let bits = rows[row as usize];
        for col in 0..width {
            if (bits >> (width - 1 - col)) & 1 == 0 {
                continue;
            }
            let x = ox + col;
            let y = oy + row;
            if x >= SIZE || y >= SIZE {
                continue;
            }
            let i = pixel_index(x, y);
            if px[i + 3] < 32 {
                continue;
            }
            px[i] = GLYPH[0];
            px[i + 1] = GLYPH[1];
            px[i + 2] = GLYPH[2];
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kind_clears_at_zero_digits_then_overflow() {
        assert_eq!(overlay_kind(0), None);
        assert_eq!(overlay_kind(1), Some(OverlayKind::Digit(1)));
        assert_eq!(overlay_kind(9), Some(OverlayKind::Digit(9)));
        assert_eq!(overlay_kind(10), Some(OverlayKind::Overflow));
        assert_eq!(overlay_kind(99), Some(OverlayKind::Overflow));
    }

    #[test]
    fn rgba_is_16x16_and_none_at_zero() {
        assert!(overlay_rgba(0).is_none());
        let px = overlay_rgba(3).expect("digit overlay");
        assert_eq!(px.len(), (SIZE * SIZE * 4) as usize);
        let overflow = overlay_rgba(12).expect("overflow overlay");
        assert_eq!(overflow.len(), px.len());
    }

    #[test]
    fn digit_overlay_has_fill_and_white_glyph() {
        let px = overlay_rgba(8).expect("8");
        let mut fill = 0usize;
        let mut white = 0usize;
        for chunk in px.chunks_exact(4) {
            if chunk[3] < 200 {
                continue;
            }
            if chunk[0] > 200 && chunk[1] < 120 && chunk[2] < 100 {
                fill += 1;
            }
            if chunk[0] > 240 && chunk[1] > 240 && chunk[2] > 240 {
                white += 1;
            }
        }
        assert!(fill > 40, "expected circular fill, got {fill}");
        assert!(white > 8, "expected digit pixels, got {white}");
    }

    #[test]
    fn remember_round_trips() {
        remember(0);
        assert_eq!(last_count(), 0);
        remember(4);
        assert_eq!(last_count(), 4);
        remember(0);
        assert_eq!(last_count(), 0);
    }
}
