import { describe, expect, it } from "vitest";
import {
  MAX_EXTRA_WORKSPACE_ROOTS,
  extraRoots,
  isCrossRootWriteAllowed,
  normalizeCapability,
  workspaceChipLabel,
  type WorkspaceRecord,
} from "@/lib/multiRootWorkspace";

const sample: WorkspaceRecord = {
  id: "ws_1",
  name: "Web",
  primaryProjectId: "p1",
  roots: [
    { path: "/a", role: "primary", access: "write", pathOk: true },
    { path: "/b", role: "extra", access: "read", pathOk: true },
  ],
  capability: "contextOnly",
  updatedAt: "2026-01-01T00:00:00Z",
};

describe("multiRootWorkspace", () => {
  it("counts extras and labels chip", () => {
    expect(extraRoots(sample)).toHaveLength(1);
    expect(workspaceChipLabel(sample, "App")).toBe("App +1");
    expect(MAX_EXTRA_WORKSPACE_ROOTS).toBe(8);
  });

  it("MVP-0 denies cross-root write for contextOnly", () => {
    expect(isCrossRootWriteAllowed("contextOnly")).toBe(false);
    expect(isCrossRootWriteAllowed("extraWriteActive")).toBe(true);
  });

  it("normalizes capability aliases", () => {
    expect(normalizeCapability("context_only")).toBe("contextOnly");
    expect(normalizeCapability("enforced_read")).toBe("enforcedRead");
  });
});
