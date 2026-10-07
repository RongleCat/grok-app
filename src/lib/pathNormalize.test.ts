import { describe, expect, it } from "vitest";
import {
  displayPathLabel,
  isFusedQueryKeyPath,
  isLocalMediaOpenable,
  isRealLocalAbsolutePath,
  isSiteRootAbsolutePath,
  isWindowsStylePath,
  localPathIdentity,
  normalizeLocalPathToken,
  unescapeShellPath,
} from "./pathNormalize";

describe("isFusedQueryKeyPath", () => {
  it("rejects media query keys fused onto Unix roots", () => {
    // `?t=TOKEN&p=/Users/…` → `t:/Users/…`
    expect(isFusedQueryKeyPath("t:/Users/me/pic.png")).toBe(true);
    expect(isFusedQueryKeyPath("p:/Users/me/pic.png")).toBe(true);
    expect(isFusedQueryKeyPath("t:/Users/me/Library/Application Support/a.png")).toBe(true);
    expect(isFusedQueryKeyPath("t:/tmp/x.png")).toBe(true);
    expect(isFusedQueryKeyPath("p:/var/folders/75/xx/a.jpg")).toBe(true);
  });

  it("keeps real Windows drive paths (incl. non-CDE volumes)", () => {
    expect(isFusedQueryKeyPath("C:\\Users\\me\\pic.png")).toBe(false);
    expect(isFusedQueryKeyPath("C:/Users/me/pic.png")).toBe(false);
    expect(isFusedQueryKeyPath("D:/data/project/x.png")).toBe(false);
    expect(isFusedQueryKeyPath("E:/media/1.jpg")).toBe(false);
    expect(isFusedQueryKeyPath("F:/Users/me/a.mp4")).toBe(false);
    expect(isFusedQueryKeyPath("G:/home/media/1.jpg")).toBe(false);
    expect(isFusedQueryKeyPath("C:/Program Files/App/a.png")).toBe(false);
    // Unrelated single-letter prefixes are not media query keys.
    expect(isFusedQueryKeyPath("a:/tmp/x.png")).toBe(false);
    expect(isFusedQueryKeyPath("x:/var/folders/75/xx/a.jpg")).toBe(false);
  });

  it("keeps plain Unix paths and relatives", () => {
    expect(isFusedQueryKeyPath("/Users/me/pic.png")).toBe(false);
    expect(isFusedQueryKeyPath("images/1.jpg")).toBe(false);
    expect(isFusedQueryKeyPath("t")).toBe(false);
    expect(isFusedQueryKeyPath("")).toBe(false);
  });
});

describe("fused query keys never pass as local abs", () => {
  it("isRealLocalAbsolutePath rejects t:/Users…", () => {
    expect(isRealLocalAbsolutePath("t:/Users/me/pic.png")).toBe(false);
    expect(isRealLocalAbsolutePath("p:/Users/me/pic.png")).toBe(false);
    expect(isRealLocalAbsolutePath("C:/Users/me/pic.png")).toBe(true);
    expect(isRealLocalAbsolutePath("/Users/me/pic.png")).toBe(true);
  });

  it("isWindowsStylePath rejects fused forward-slash forms", () => {
    expect(isWindowsStylePath("t:/Users/me/pic.png")).toBe(false);
    expect(isWindowsStylePath("C:\\Users\\me\\pic.png")).toBe(true);
    expect(isWindowsStylePath("C:/Users/me/pic.png")).toBe(true);
  });

  it("isLocalMediaOpenable rejects fused tokens", () => {
    expect(isLocalMediaOpenable("t:/Users/me/pic.png")).toBe(false);
  });
});

describe("unescapeShellPath", () => {
  it("restores spaces and parens from shell escapes", () => {
    expect(
      unescapeShellPath(
        "/Users/me/Downloads/6A5ED46119BDACC7C24DC3B6FF3CF051\\ \\(1\\).png",
      ),
    ).toBe("/Users/me/Downloads/6A5ED46119BDACC7C24DC3B6FF3CF051 (1).png");
  });

  it("normalizes Windows separators without eating drive letters", () => {
    expect(unescapeShellPath("C:\\Users\\me\\a.png")).toBe("C:/Users/me/a.png");
  });
});

describe("isRealLocalAbsolutePath / isSiteRootAbsolutePath", () => {
  it("accepts macOS user paths and home", () => {
    expect(isRealLocalAbsolutePath("/Users/me/pic.png")).toBe(true);
    expect(isRealLocalAbsolutePath("~/docs/a.md")).toBe(true);
    expect(
      isRealLocalAbsolutePath(
        "/Users/me/Library/Application Support/com.grokapp.grok-app/a.png",
      ),
    ).toBe(true);
  });

  it("rejects CMS site-root media paths", () => {
    expect(isSiteRootAbsolutePath("/images/partner-brands/manycore.png")).toBe(
      true,
    );
    expect(isRealLocalAbsolutePath("/images/partner-brands/manycore.png")).toBe(
      false,
    );
    expect(isSiteRootAbsolutePath("/static/logo.svg")).toBe(true);
  });

  it("accepts agent-home / custom abs roots that are not site CMS", () => {
    expect(isRealLocalAbsolutePath("/sess/images/1.jpg")).toBe(true);
    expect(isRealLocalAbsolutePath("/a.png")).toBe(true);
  });

  it("does not treat site roots as openable local media", () => {
    expect(isLocalMediaOpenable("/images/x.png")).toBe(false);
    expect(
      isLocalMediaOpenable("/Users/me/Downloads/微信图片_1.png"),
    ).toBe(true);
  });
});

describe("normalizeLocalPathToken", () => {
  it("shell-unescapes then keeps a real absolute", () => {
    const raw =
      "/Users/ronglecat/Downloads/6A5ED46119BDACC7C24DC3B6FF3CF051\\ \\(1\\).png";
    expect(normalizeLocalPathToken(raw)).toBe(
      "/Users/ronglecat/Downloads/6A5ED46119BDACC7C24DC3B6FF3CF051 (1).png",
    );
    expect(isRealLocalAbsolutePath(normalizeLocalPathToken(raw))).toBe(true);
  });

  it("collapses Windows slash styles onto one identity", () => {
    const back = "C:\\Users\\me\\AppData\\Local\\Temp\\paste.png";
    const fwd = "C:/Users/me/AppData/Local/Temp/paste.png";
    expect(localPathIdentity(back)).toBe(fwd);
    expect(localPathIdentity(fwd)).toBe(localPathIdentity(back));
    expect(localPathIdentity("")).toBe("");
    expect(localPathIdentity("/tmp/a.png")).toBe("/tmp/a.png");
  });
});

describe("displayPathLabel", () => {
  it("shows basename for long absolute paths", () => {
    expect(displayPathLabel("/Users/me/proj/apps/web/public/logo.png")).toBe(
      "logo.png",
    );
  });

  it("keeps short relative paths for code citations", () => {
    expect(displayPathLabel("apps/web/foo.ts")).toBe("apps/web/foo.ts");
  });
});
