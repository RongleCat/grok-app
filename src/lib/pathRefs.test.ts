import { describe, expect, it } from "vitest";
import {
  classifyPathRef,
  looksLikeFilePath,
  normalizePathToken,
  resolveFileToken,
} from "./pathRefs";

describe("normalizePathToken", () => {
  it("preserves absolute unix paths (video history reload)", () => {
    const abs = "/Users/me/proj/out/moon-taste-story.mp4";
    expect(normalizePathToken(abs)).toBe(abs);
    expect(looksLikeFilePath(abs)).toBe(true);
    expect(classifyPathRef(abs)).toBe("video");
    expect(resolveFileToken(abs)).toBe(abs);
  });

  it("shell-unescapes absolute paths with spaces", () => {
    const raw =
      "/Users/me/Downloads/6A5ED46119BDACC7C24DC3B6FF3CF051\\ \\(1\\).png";
    expect(normalizePathToken(raw)).toBe(
      "/Users/me/Downloads/6A5ED46119BDACC7C24DC3B6FF3CF051 (1).png",
    );
    expect(looksLikeFilePath(raw)).toBe(true);
    expect(resolveFileToken(raw)).toBe(
      "/Users/me/Downloads/6A5ED46119BDACC7C24DC3B6FF3CF051 (1).png",
    );
  });

  it("does not treat CMS site-root paths as file cards", () => {
    expect(looksLikeFilePath("/images/partner-brands/manycore.png")).toBe(
      false,
    );
    expect(resolveFileToken("/images/partner-brands/manycore.png")).toBeNull();
  });

  it("does not treat bare media basenames as file cards (OSS cites)", () => {
    expect(looksLikeFilePath("manycore-20260730.png")).toBe(false);
    expect(looksLikeFilePath("manycore.png")).toBe(false);
    // Non-media bare names still can be path cards.
    expect(looksLikeFilePath("README.md")).toBe(true);
  });

  it("does not treat slash-command / skill tokens as file cards", () => {
    expect(looksLikeFilePath("/dbs")).toBe(false);
    expect(looksLikeFilePath("/goal")).toBe(false);
    expect(looksLikeFilePath("/cyber-xiaowan")).toBe(false);
    // Real multi-segment paths still cards.
    expect(looksLikeFilePath("/Users/me/proj/a.md")).toBe(true);
  });

  it("still strips leading ellipsis on relative tokens", () => {
    expect(normalizePathToken(".../foo/bar.mp4")).toBe("foo/bar.mp4");
    expect(normalizePathToken("…/videos/1.mp4")).toBe("videos/1.mp4");
  });

  it("treats a Windows network share as a file", () => {
    const unc = "\\\\server\\share\\a.png";
    expect(looksLikeFilePath(unc)).toBe(true);
    expect(normalizePathToken(unc)).toBe(unc);
    expect(resolveFileToken(unc)).toBe(unc);
    expect(looksLikeFilePath("\\\\files.corp\\share\\a.png")).toBe(true);
    expect(looksLikeFilePath("//cdn.example.com/a.png")).toBe(false);
    expect(looksLikeFilePath("//server/share/a.png")).toBe(false);
  });

  it("never treats fused media query keys (t:/Users/…) as file cards", () => {
    const fused = "t:/Users/me/pic.png";
    expect(normalizePathToken(fused)).toBe(fused); // normalization is lossless
    expect(looksLikeFilePath(fused)).toBe(false);
    expect(resolveFileToken(fused)).toBeNull();
  });
});

describe("resolveFileToken bare media", () => {
  it("does not invent sibling media under a unique pathMap parent", () => {
    // After reload, only image_gen attachment remains under agent images/.
    // Inventing images/shenzhen-weather-card.png caused broken ImageUi cards.
    const pathMap = {
      "/Users/me/agent-home/sessions/abc/images/1.jpg":
        "/Users/me/agent-home/sessions/abc/images/1.jpg",
      "1.jpg": "/Users/me/agent-home/sessions/abc/images/1.jpg",
      "images/1.jpg": "/Users/me/agent-home/sessions/abc/images/1.jpg",
    };
    expect(
      resolveFileToken("shenzhen-weather-card.png", { pathMap }),
    ).toBeNull();
    expect(resolveFileToken("1.jpg", { pathMap })).toBe(
      "/Users/me/agent-home/sessions/abc/images/1.jpg",
    );
  });

  it("still invents sibling non-media files under a unique parent", () => {
    const pathMap = {
      "/Users/me/proj/docs/a.md": "/Users/me/proj/docs/a.md",
      "a.md": "/Users/me/proj/docs/a.md",
    };
    expect(resolveFileToken("b.md", { pathMap })).toBe(
      "/Users/me/proj/docs/b.md",
    );
  });
});
