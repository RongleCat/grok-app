import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const components = join(__dirname, "../components");
const panels = [
  "PrivacyCenterPanel.tsx",
  "MemoryEmbedPanel.tsx",
  "CodebaseIndexingPanel.tsx",
  "AgentConfigEditPanel.tsx",
] as const;

describe("settings toggle reuse", () => {
  it.each(panels)("%s uses the shared UiCheck", (file) => {
    const src = readFileSync(join(components, file), "utf8");

    expect(src).toContain("<UiCheck");
    expect(src).not.toContain("function Toggle(");
    expect(src).not.toContain("<Toggle");
  });
});
