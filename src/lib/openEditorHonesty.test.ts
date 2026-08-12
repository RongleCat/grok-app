import { describe, expect, it } from "vitest";
import {
  buildOpenTargetSelectOptions,
  classifyOpenEditorError,
  classifyRevealError,
  formatOpenEditorErrorMessage,
  isOsOpenTarget,
  normalizeOpenTargetId,
  openEditorErrorMessageKey,
  orderOpenWithEditors,
  planOpenInEditor,
  resolveEffectiveOpenTarget,
  resolveLegacyEditorTarget,
  resolveOpenEditorEmptyState,
  resolveOpenEditorError,
  resolveRevealError,
  revealErrorMessageKey,
} from "./openEditorHonesty";

describe("classifyOpenEditorError", () => {
  it("maps explicit codes", () => {
    expect(classifyOpenEditorError({ code: "no_editor" })).toBe("no_editor");
    expect(classifyOpenEditorError({ code: "not_found" })).toBe("not_found");
    expect(classifyOpenEditorError({ code: "path_denied" })).toBe(
      "path_denied",
    );
    expect(classifyOpenEditorError({ code: "host_only" })).toBe("host_only");
    expect(classifyOpenEditorError({ code: "cancelled" })).toBe("cancelled");
    expect(classifyOpenEditorError({ code: "need_tauri" })).toBe("host_only");
    expect(classifyOpenEditorError({ code: "path_not_allowed" })).toBe(
      "path_denied",
    );
  });

  it("maps Host path not found", () => {
    expect(classifyOpenEditorError("path not found: /tmp/x.ts")).toBe(
      "not_found",
    );
    expect(classifyOpenEditorError("empty path")).toBe("not_found");
    expect(classifyOpenEditorError(new Error("ENOENT: no such file"))).toBe(
      "not_found",
    );
  });

  it("maps missing editor id / failed open editor", () => {
    expect(classifyOpenEditorError("cursor not found")).toBe("no_editor");
    expect(classifyOpenEditorError("code not found")).toBe("no_editor");
    expect(
      classifyOpenEditorError("failed to open editor `code`: spawn failed"),
    ).toBe("no_editor");
    expect(classifyOpenEditorError("no code editors detected")).toBe(
      "no_editor",
    );
  });

  it("maps path denied / permission", () => {
    expect(classifyOpenEditorError("path not allowed: /secret")).toBe(
      "path_denied",
    );
    expect(classifyOpenEditorError("EACCES: permission denied")).toBe(
      "path_denied",
    );
    expect(classifyOpenEditorError("operation not permitted")).toBe(
      "path_denied",
    );
  });

  it("maps host-only and cancel", () => {
    expect(classifyOpenEditorError("need tauri: desktop app")).toBe(
      "host_only",
    );
    expect(classifyOpenEditorError("not available in browser")).toBe(
      "host_only",
    );
    expect(classifyOpenEditorError("user cancelled")).toBe("cancelled");
    expect(classifyOpenEditorError("Error: canceled")).toBe("cancelled");
  });

  it("falls back to other for unknown noise", () => {
    expect(classifyOpenEditorError("weird boom")).toBe("other");
    expect(classifyOpenEditorError(null)).toBe("other");
    expect(classifyOpenEditorError("")).toBe("other");
  });
});

describe("classifyRevealError", () => {
  it("maps path not found and empty path", () => {
    expect(classifyRevealError("path not found: /a")).toBe("not_found");
    expect(classifyRevealError("empty path")).toBe("not_found");
  });

  it("maps path denied and host only", () => {
    expect(classifyRevealError("path not allowed")).toBe("path_denied");
    expect(classifyRevealError("need_tauri")).toBe("host_only");
  });

  it("maps cancel and other", () => {
    expect(classifyRevealError("user canceled")).toBe("cancelled");
    expect(classifyRevealError("spawn failed: xdg-open")).toBe("other");
  });

  it("does not invent no_editor for reveal", () => {
    // Reveal surface has no no_editor kind — generic not_found / other.
    expect(classifyRevealError("code not found")).toBe("not_found");
  });
});

describe("message keys", () => {
  it("maps every open kind to resources.openErr.*", () => {
    expect(openEditorErrorMessageKey("no_editor")).toBe(
      "resources.openErr.noEditor",
    );
    expect(openEditorErrorMessageKey("not_found")).toBe(
      "resources.openErr.notFound",
    );
    expect(openEditorErrorMessageKey("path_denied")).toBe(
      "resources.openErr.pathDenied",
    );
    expect(openEditorErrorMessageKey("host_only")).toBe(
      "resources.openErr.hostOnly",
    );
    expect(openEditorErrorMessageKey("cancelled")).toBe(
      "resources.openErr.cancelled",
    );
    expect(openEditorErrorMessageKey("other")).toBe("resources.openErr.other");
  });

  it("maps every reveal kind to resources.revealErr.*", () => {
    expect(revealErrorMessageKey("not_found")).toBe(
      "resources.revealErr.notFound",
    );
    expect(revealErrorMessageKey("path_denied")).toBe(
      "resources.revealErr.pathDenied",
    );
    expect(revealErrorMessageKey("host_only")).toBe(
      "resources.revealErr.hostOnly",
    );
    expect(revealErrorMessageKey("cancelled")).toBe(
      "resources.revealErr.cancelled",
    );
    expect(revealErrorMessageKey("other")).toBe("resources.revealErr.other");
  });
});

describe("resolveOpenEditorError / resolveRevealError", () => {
  it("is silent for cancelled", () => {
    const r = resolveOpenEditorError("user cancelled");
    expect(r.kind).toBe("cancelled");
    expect(r.silent).toBe(true);
  });

  it("keeps detail only for other", () => {
    const known = resolveOpenEditorError("path not found: /x");
    expect(known.kind).toBe("not_found");
    expect(known.detail).toBe("");

    const other = resolveOpenEditorError("spawn exploded xyz");
    expect(other.kind).toBe("other");
    expect(other.detail).toContain("spawn exploded");
  });

  it("formats with tr + optional detail", () => {
    const tr = (k: string) =>
      k === "resources.openErr.other" ? "Could not open" : k;
    expect(
      formatOpenEditorErrorMessage(
        { messageKey: "resources.openErr.other", detail: "boom" },
        tr,
      ),
    ).toBe("Could not open (boom)");
    expect(
      formatOpenEditorErrorMessage(
        { messageKey: "resources.openErr.other", detail: "" },
        tr,
      ),
    ).toBe("Could not open");
  });

  it("resolveRevealError mirrors kind keys", () => {
    const r = resolveRevealError("path not found: /z");
    expect(r.kind).toBe("not_found");
    expect(r.messageKey).toBe("resources.revealErr.notFound");
    expect(r.silent).toBe(false);
  });
});

describe("resolveOpenEditorEmptyState", () => {
  it("warns when no editors detected", () => {
    const s = resolveOpenEditorEmptyState({ editorsFound: 0 });
    expect(s.kind).toBe("no_editors");
    expect(s.severity).toBe("warn");
    expect(s.messageKey).toBe("settings.openTargetEmpty");
  });

  it("info when preferred editor missing from scan", () => {
    const s = resolveOpenEditorEmptyState({
      editorsFound: 2,
      preferred: "cursor",
      availableIds: ["code", "zed"],
    });
    expect(s.kind).toBe("preferred_missing");
    expect(s.severity).toBe("info");
    expect(s.messageKey).toBe("settings.openTargetPreferredMissing");
  });

  it("ok for finder / system preferred even with zero editors", () => {
    // Zero editors still surfaces no_editors (Finder works but honesty first).
    const zero = resolveOpenEditorEmptyState({
      editorsFound: 0,
      preferred: "finder",
    });
    expect(zero.kind).toBe("no_editors");

    const ok = resolveOpenEditorEmptyState({
      editorsFound: 1,
      preferred: "finder",
      availableIds: ["code"],
    });
    expect(ok.kind).toBe("ok");
    expect(ok.messageKey).toBeNull();
    expect(ok.severity).toBe("none");
  });

  it("ok when preferred is available", () => {
    const s = resolveOpenEditorEmptyState({
      editorsFound: 2,
      preferred: "Code",
      availableIds: ["code", "cursor"],
    });
    expect(s.kind).toBe("ok");
  });
});

describe("planOpenInEditor", () => {
  it("ok for absolute path on tauri", () => {
    expect(
      planOpenInEditor({ path: "/Users/me/a.ts", isTauri: true }),
    ).toEqual({
      ok: true,
      path: "/Users/me/a.ts",
      editorId: null,
    });
  });

  it("soft-fails host_only when not tauri", () => {
    const p = planOpenInEditor({ path: "/a", isTauri: false });
    expect(p.ok).toBe(false);
    if (!p.ok) {
      expect(p.kind).toBe("host_only");
      expect(p.messageKey).toBe("resources.openErr.hostOnly");
    }
  });

  it("soft-fails not_found for empty path", () => {
    const p = planOpenInEditor({ path: "  ", isTauri: true });
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.kind).toBe("not_found");
  });

  it("soft-fails no_editor when preferred editor requested but none found", () => {
    const p = planOpenInEditor({
      path: "/a.ts",
      editorId: "cursor",
      editorsFound: 0,
      isTauri: true,
    });
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.kind).toBe("no_editor");
  });

  it("allows finder/system even when editorsFound is 0", () => {
    expect(
      planOpenInEditor({
        path: "/a",
        editorId: "finder",
        editorsFound: 0,
      }).ok,
    ).toBe(true);
    expect(
      planOpenInEditor({
        path: "/a",
        editorId: "system",
        editorsFound: 0,
      }).ok,
    ).toBe(true);
  });

  it("keeps explicit editorId when ok", () => {
    const p = planOpenInEditor({
      path: "/a.ts",
      editorId: " code ",
      editorsFound: 3,
    });
    expect(p).toEqual({ ok: true, path: "/a.ts", editorId: "code" });
  });

  it("soft-fails no_editor when editorId missing from availableIds", () => {
    const p = planOpenInEditor({
      path: "/a.ts",
      editorId: "cursor",
      availableIds: ["code", "zed"],
      isTauri: true,
    });
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.kind).toBe("no_editor");
  });

  it("allows when editorId is among availableIds", () => {
    const p = planOpenInEditor({
      path: "/a.ts",
      editorId: "Cursor",
      availableIds: ["code", "cursor"],
    });
    expect(p).toEqual({ ok: true, path: "/a.ts", editorId: "cursor" });
  });
});

describe("normalizeOpenTargetId / isOsOpenTarget", () => {
  it("normalizes and defaults empty to finder", () => {
    expect(normalizeOpenTargetId(" Code ")).toBe("code");
    expect(normalizeOpenTargetId("")).toBe("finder");
    expect(normalizeOpenTargetId(null)).toBe("finder");
  });

  it("classifies OS vs editor targets", () => {
    expect(isOsOpenTarget("finder")).toBe(true);
    expect(isOsOpenTarget("explorer")).toBe(true);
    expect(isOsOpenTarget("system")).toBe(true);
    expect(isOsOpenTarget("default")).toBe(true);
    expect(isOsOpenTarget("cursor")).toBe(false);
    expect(isOsOpenTarget("code")).toBe(false);
  });
});

describe("buildOpenTargetSelectOptions", () => {
  it("lists finder + available editors only", () => {
    const opts = buildOpenTargetSelectOptions({
      finderLabel: "Finder",
      editors: [
        { id: "code", label: "VS Code", available: true },
        { id: "missing", label: "Gone", available: false },
      ],
    });
    expect(opts).toEqual([
      { value: "finder", label: "Finder" },
      { value: "code", label: "VS Code" },
    ]);
  });

  it("soft-disables preferred when missing from probe", () => {
    const opts = buildOpenTargetSelectOptions({
      finderLabel: "Finder",
      preferred: "cursor",
      unavailableSuffix: " (not detected)",
      editors: [{ id: "code", label: "VS Code", available: true }],
    });
    expect(opts).toContainEqual({
      value: "cursor",
      label: "cursor (not detected)",
      disabled: true,
    });
    expect(opts.find((o) => o.value === "code")?.disabled).toBeUndefined();
  });

  it("does not duplicate preferred when available", () => {
    const opts = buildOpenTargetSelectOptions({
      finderLabel: "Finder",
      preferred: "code",
      editors: [{ id: "code", label: "VS Code", available: true }],
    });
    expect(opts.filter((o) => o.value === "code")).toHaveLength(1);
    expect(opts.find((o) => o.value === "code")?.disabled).toBeUndefined();
  });
});

describe("resolveEffectiveOpenTarget / orderOpenWithEditors", () => {
  it("keeps available preferred editor", () => {
    expect(
      resolveEffectiveOpenTarget({
        preferred: "Cursor",
        availableIds: ["code", "cursor"],
      }),
    ).toBe("cursor");
  });

  it("falls back to OS target when preferred missing", () => {
    expect(
      resolveEffectiveOpenTarget({
        preferred: "cursor",
        availableIds: ["code"],
        osTarget: "finder",
      }),
    ).toBe("finder");
  });

  it("keeps finder/system even with empty scan", () => {
    expect(
      resolveEffectiveOpenTarget({
        preferred: "finder",
        availableIds: [],
      }),
    ).toBe("finder");
    expect(
      resolveEffectiveOpenTarget({
        preferred: "system",
        availableIds: [],
      }),
    ).toBe("system");
  });

  it("resolves legacy editor to cursor > code > first", () => {
    expect(resolveLegacyEditorTarget(["code", "cursor", "zed"])).toBe(
      "cursor",
    );
    expect(resolveLegacyEditorTarget(["code", "zed"])).toBe("code");
    expect(resolveLegacyEditorTarget(["zed", "sublime"])).toBe("zed");
    expect(resolveLegacyEditorTarget([])).toBeNull();
    expect(
      resolveEffectiveOpenTarget({
        preferred: "editor",
        availableIds: ["code", "cursor"],
      }),
    ).toBe("cursor");
  });

  it("orders preferred editor first in open-with menus", () => {
    const ordered = orderOpenWithEditors(
      [
        { id: "code", label: "VS Code" },
        { id: "cursor", label: "Cursor" },
        { id: "zed", label: "Zed" },
      ],
      "cursor",
    );
    expect(ordered.map((e) => e.id)).toEqual(["cursor", "code", "zed"]);
  });

  it("leaves order unchanged when preferred is OS or missing", () => {
    const eds = [
      { id: "code" },
      { id: "cursor" },
    ];
    expect(orderOpenWithEditors(eds, "finder").map((e) => e.id)).toEqual([
      "code",
      "cursor",
    ]);
    expect(orderOpenWithEditors(eds, "windsurf").map((e) => e.id)).toEqual([
      "code",
      "cursor",
    ]);
  });
});
