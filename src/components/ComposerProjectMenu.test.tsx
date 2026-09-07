import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import React from "react";
import { ComposerProjectMenu } from "@/components/ComposerProjectMenu";

describe("ComposerProjectMenu", () => {
  it("shows the default-workspace label when no project is bound", () => {
    const html = renderToString(
      React.createElement(ComposerProjectMenu, {
        activeProject: null,
        projects: [],
        labels: {
          noProject: "Default workspace",
          pickProject: "Project folder",
          addProject: "Add project",
        },
        variant: "context",
        onSelect: vi.fn(),
        onAdd: vi.fn(),
      }),
    );
    expect(html).toContain("Default workspace");
    expect(html).toContain("composer__context-item--project");
    expect(html).toContain("is-muted");
    expect(html).toContain("g-icon--home");
  });
});
