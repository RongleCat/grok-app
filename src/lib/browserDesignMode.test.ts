import { describe, expect, it } from "vitest";
import {
  appendDesignModeDraft,
  buildDesignModeClearScript,
  buildDesignModeInstallScript,
  buildDesignModePollScript,
  buildDesignModeReadScript,
  buildDesignModeTeardownScript,
  dataUrlToBase64,
  DESIGN_MODE_NS,
  formatDesignModePrompt,
  formatRect,
  inspectorStyleRows,
  isLikelyInjectablePreviewUrl,
  parseDesignModeInstall,
  parseDesignModePoll,
  parseDesignModeRead,
  parseEvalJson,
  selectorLabel,
  type DesignModePromptLabels,
  type DesignModeSelection,
} from "./browserDesignMode";

const labels: DesignModePromptLabels = {
  intro: "Update the frontend styles for this selected element.",
  page: "Page:",
  element: "Element:",
  cssPath: "CSS path:",
  text: "Text:",
  size: "Size:",
  styles: "Computed styles:",
  html: "HTML:",
  change: "Requested change:",
};

function sampleSelection(
  patch: Partial<DesignModeSelection> = {},
): DesignModeSelection {
  return {
    tag: "button",
    id: "send",
    className: "btn primary",
    cssPath: "header.nav > button#send.btn",
    text: "Send",
    html: '<button id="send" class="btn primary">Send</button>',
    rect: { x: 840, y: 16, w: 120, h: 36 },
    styles: {
      color: "rgb(255, 255, 255)",
      backgroundColor: "rgb(37, 99, 235)",
      fontSize: "14px",
      fontFamily: "Inter, system-ui",
      fontWeight: "600",
      lineHeight: "20px",
      letterSpacing: "normal",
      textAlign: "center",
      display: "inline-flex",
      position: "relative",
      width: "120px",
      height: "36px",
      padding: "8px 16px",
      margin: "0px",
      border: "0px solid rgb(0, 0, 0)",
      borderRadius: "8px",
      gap: "6px",
      opacity: "1",
      boxShadow: "none",
    },
    href: "http://localhost:5173/",
    dpr: 2,
    ...patch,
  };
}

describe("parseEvalJson", () => {
  it("parses a plain JSON object", () => {
    expect(parseEvalJson('{"ok":true,"version":2}')).toEqual({
      ok: true,
      version: 2,
    });
  });

  it("unwraps a JSON-encoded string payload", () => {
    const inner = JSON.stringify({ ok: true, enabled: true });
    expect(parseEvalJson(JSON.stringify(inner))).toEqual({
      ok: true,
      enabled: true,
    });
  });

  it("returns null for garbage", () => {
    expect(parseEvalJson("not-json")).toBeNull();
    expect(parseEvalJson("")).toBeNull();
    expect(parseEvalJson(null)).toBeNull();
  });
});

describe("parseDesignModePoll / install / read", () => {
  it("reads a poll payload from a double-encoded eval result", () => {
    const payload = {
      ok: true,
      enabled: true,
      version: 4,
      hasSelection: true,
      shotStatus: "pending",
    };
    const raw = JSON.stringify(JSON.stringify(payload));
    expect(parseDesignModePoll(raw)).toEqual({
      ok: true,
      enabled: true,
      version: 4,
      hasSelection: true,
      shotStatus: "pending",
      reason: undefined,
    });
  });

  it("returns null when poll JSON is not an object", () => {
    expect(parseDesignModePoll("[]")).toBeNull();
    expect(parseDesignModePoll("true")).toBeNull();
  });

  it("parses install success and failure", () => {
    expect(parseDesignModeInstall('{"ok":true,"already":true}')).toEqual({
      ok: true,
      already: true,
      error: undefined,
    });
    expect(parseDesignModeInstall('{"ok":false,"error":"csp"}')).toEqual({
      ok: false,
      already: undefined,
      error: "csp",
    });
    expect(parseDesignModeInstall("nope")).toEqual({
      ok: false,
      error: "invalid",
    });
  });

  it("parses a full selection read", () => {
    const sel = sampleSelection();
    const raw = JSON.stringify({
      ok: true,
      selected: sel,
      shot: { status: "ok", dataUrl: "data:image/png;base64,aaa" },
    });
    const parsed = parseDesignModeRead(raw);
    expect(parsed?.ok).toBe(true);
    expect(parsed?.selected?.tag).toBe("button");
    expect(parsed?.selected?.id).toBe("send");
    expect(parsed?.selected?.styles.backgroundColor).toBe("rgb(37, 99, 235)");
    expect(parsed?.shot.status).toBe("ok");
    expect(parsed?.shot.dataUrl).toContain("image/png");
  });

  it("drops a selection without a tag", () => {
    const parsed = parseDesignModeRead({
      ok: true,
      selected: { tag: "", cssPath: "x" },
      shot: { status: "idle" },
    });
    expect(parsed?.selected).toBeNull();
  });
});

describe("isLikelyInjectablePreviewUrl", () => {
  it("accepts localhost, loopback, LAN, and file URLs", () => {
    expect(isLikelyInjectablePreviewUrl("http://localhost:5173/app")).toBe(
      true,
    );
    expect(isLikelyInjectablePreviewUrl("http://127.0.0.1:3000")).toBe(true);
    expect(isLikelyInjectablePreviewUrl("http://app.localhost/")).toBe(true);
    expect(isLikelyInjectablePreviewUrl("http://printer.local/")).toBe(true);
    expect(isLikelyInjectablePreviewUrl("http://10.0.0.8:8080")).toBe(true);
    expect(isLikelyInjectablePreviewUrl("http://192.168.1.4/")).toBe(true);
    expect(isLikelyInjectablePreviewUrl("http://172.16.1.9/")).toBe(true);
    expect(isLikelyInjectablePreviewUrl("file:///tmp/preview.html")).toBe(
      true,
    );
  });

  it("rejects public sites and junk", () => {
    expect(isLikelyInjectablePreviewUrl("https://example.com")).toBe(false);
    expect(isLikelyInjectablePreviewUrl("https://github.com")).toBe(false);
    expect(isLikelyInjectablePreviewUrl("not a url")).toBe(false);
    expect(isLikelyInjectablePreviewUrl("")).toBe(false);
  });
});

describe("selector + prompt", () => {
  it("builds tag#id.class from the selection", () => {
    expect(selectorLabel(sampleSelection())).toBe("button#send.btn.primary");
    expect(
      selectorLabel(sampleSelection({ id: "", className: "" })),
    ).toBe("button");
  });

  it("formats the rect", () => {
    expect(formatRect({ x: 10.4, y: 2.8, w: 99.6, h: 40.2 })).toBe(
      "100 × 40 at (10, 3)",
    );
  });

  it("assembles an agent prompt with styles, html, note, and @path", () => {
    const prompt = formatDesignModePrompt({
      selection: sampleSelection(),
      note: "Use a softer blue and 8px more padding.",
      labels,
      attachmentPath: "/tmp/design-mode-element.png",
    });
    expect(prompt).toContain("Update the frontend styles");
    expect(prompt).toContain("http://localhost:5173/");
    expect(prompt).toContain("button#send.btn.primary");
    expect(prompt).toContain("header.nav > button#send.btn");
    expect(prompt).toContain("background-color: rgb(37, 99, 235)");
    expect(prompt).toContain("```html");
    expect(prompt).toContain("Use a softer blue");
    expect(prompt.endsWith("@/tmp/design-mode-element.png")).toBe(true);
    expect(prompt).not.toContain("box-shadow");
  });

  it("omits empty note and attachment", () => {
    const prompt = formatDesignModePrompt({
      selection: sampleSelection({ text: "", html: "" }),
      note: "   ",
      labels,
    });
    expect(prompt).not.toContain("Requested change:");
    expect(prompt).not.toContain("HTML:");
    expect(prompt).not.toContain("@/");
  });

  it("lists inspector rows without empty/none values", () => {
    const rows = inspectorStyleRows(sampleSelection());
    expect(rows.some((r) => r.key === "backgroundColor")).toBe(true);
    expect(rows.some((r) => r.key === "boxShadow")).toBe(false);
  });
});

describe("appendDesignModeDraft", () => {
  it("replaces an empty draft", () => {
    expect(appendDesignModeDraft("  ", "hello")).toBe("hello");
  });

  it("appends after existing text", () => {
    expect(appendDesignModeDraft("keep me\n", "next")).toBe("keep me\n\nnext");
  });
});

describe("dataUrlToBase64", () => {
  it("strips the data-url prefix", () => {
    expect(dataUrlToBase64("data:image/png;base64,abc+12/w==")).toBe(
      "abc+12/w==",
    );
    expect(dataUrlToBase64("data:image/jpeg;base64,Zm9v")).toBe("Zm9v");
  });

  it("rejects non-image payloads", () => {
    expect(dataUrlToBase64("data:text/plain;base64,Zm9v")).toBeNull();
    expect(dataUrlToBase64("abc+12/w==")).toBeNull();
  });
});

describe("injected scripts", () => {
  it("install script talks to the shared namespace and is host-sized", () => {
    const script = buildDesignModeInstallScript();
    expect(script).toContain(DESIGN_MODE_NS);
    expect(script).toContain("data-grok-dm");
    expect(script).toContain("cssPath");
    expect(script).toContain("startShot");
    expect(script).toContain("clearSelection");
    expect(script.startsWith("(function(){")).toBe(true);
    expect(script.length).toBeGreaterThan(2000);
    expect(script.length).toBeLessThan(512_000);
  });

  it("poll / read / teardown / clear stay IIFEs", () => {
    for (const script of [
      buildDesignModePollScript(),
      buildDesignModeReadScript(),
      buildDesignModeTeardownScript(),
      buildDesignModeClearScript(),
    ]) {
      expect(script).toContain(DESIGN_MODE_NS);
      expect(script.startsWith("(function(){")).toBe(true);
      expect(script).toContain("JSON.stringify");
    }
  });
});
