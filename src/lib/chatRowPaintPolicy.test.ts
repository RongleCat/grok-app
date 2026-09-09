import { describe, expect, it } from "vitest";
import {
  CHAT_RICH_HYDRATE_ROWS_PER_COMMIT,
  chatRichBandNeedsFollowUp,
  chatRowPaint,
  nextChatRichBand,
} from "./chatRowPaintPolicy";

const band = (richStart: number, richEnd: number) => ({ richStart, richEnd });

describe("chatRowPaint", () => {
  it("shells an empty band", () => {
    expect(chatRowPaint(4, band(10, 10))).toBe("shell");
  });

  it("paints only the half-open rich range", () => {
    expect(chatRowPaint(4, band(4, 8))).toBe("rich");
    expect(chatRowPaint(7, band(4, 8))).toBe("rich");
    expect(chatRowPaint(8, band(4, 8))).toBe("shell");
    expect(chatRowPaint(3, band(4, 8))).toBe("shell");
  });
});

describe("nextChatRichBand", () => {
  it("freezes the committed band during a gesture instead of hydrating", () => {
    const next = nextChatRichBand({
      target: band(40, 52),
      committed: band(10, 22),
      geoStart: 0,
      geoEnd: 80,
      scrolling: true,
    });
    expect(next).toEqual(band(10, 22));
  });

  it("drops committed rows that left the geometric window while gesturing", () => {
    const next = nextChatRichBand({
      target: band(90, 102),
      committed: band(10, 22),
      geoStart: 80,
      geoEnd: 140,
      scrolling: true,
    });
    expect(next).toEqual(band(80, 80));
  });

  it("does not union toward the moving viewport while gesturing", () => {
    const next = nextChatRichBand({
      target: band(18, 30),
      committed: band(10, 22),
      geoStart: 0,
      geoEnd: 80,
      scrolling: true,
    });
    expect(next).toEqual(band(10, 22));
  });

  it("fills the whole target in one idle commit after a hole", () => {
    const next = nextChatRichBand({
      target: band(90, 102),
      committed: band(10, 22),
      geoStart: 80,
      geoEnd: 140,
      scrolling: false,
    });
    expect(next).toEqual(band(90, 102));
  });

  it("hydrates at most a few extra rows per idle commit when already overlapping", () => {
    expect(CHAT_RICH_HYDRATE_ROWS_PER_COMMIT).toBe(3);
    const next = nextChatRichBand({
      target: band(10, 22),
      committed: band(10, 13),
      geoStart: 0,
      geoEnd: 80,
      scrolling: false,
    });
    expect(next).toEqual(band(10, 16));
    expect(chatRichBandNeedsFollowUp(next, band(10, 22))).toBe(true);
  });

  it("shrinks to the target once idle", () => {
    const next = nextChatRichBand({
      target: band(20, 28),
      committed: band(10, 28),
      geoStart: 0,
      geoEnd: 80,
      scrolling: false,
    });
    expect(next).toEqual(band(20, 28));
  });

  it("pin snaps to the target instead of chunking the streaming tail", () => {
    const next = nextChatRichBand({
      target: band(72, 80),
      committed: band(10, 16),
      geoStart: 40,
      geoEnd: 80,
      scrolling: false,
      pinToBottom: true,
    });
    expect(next).toEqual(band(72, 80));
  });

  it("keeps the committed band while pinned AND gesturing", () => {
    const next = nextChatRichBand({
      target: band(72, 80),
      committed: band(68, 80),
      geoStart: 40,
      geoEnd: 80,
      scrolling: true,
      pinToBottom: true,
    });
    expect(next).toEqual(band(68, 80));
  });
});
