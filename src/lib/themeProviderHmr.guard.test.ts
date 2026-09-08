import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sourceRoot = resolve(__dirname, "..");
const themeProvider = readFileSync(
  resolve(sourceRoot, "providers/ThemeProvider.tsx"),
  "utf8",
);
const themeContext = readFileSync(
  resolve(sourceRoot, "providers/ThemeShellContext.ts"),
  "utf8",
);
const skinProvider = readFileSync(
  resolve(sourceRoot, "providers/SkinShareProvider.tsx"),
  "utf8",
);
const skinContext = readFileSync(
  resolve(sourceRoot, "providers/SkinShareContext.ts"),
  "utf8",
);

const themeConsumers = [
  "app/AppWorkbench.tsx",
  "hooks/useAppearanceEditorModel.ts",
  "providers/SkinShareProvider.tsx",
  "components/settings/AppearanceOpacityCard.tsx",
  "components/settings/AppearanceChromeCard.tsx",
  "components/settings/SkinPresetsCard.tsx",
] as const;

const skinConsumers = [
  "components/settings/SkinCatalogModal.tsx",
  "components/settings/SkinPresetsCard.tsx",
] as const;

describe("appearance provider Fast Refresh boundaries", () => {
  it("keeps the theme context outside the component module", () => {
    expect(themeProvider).toContain('from "@/providers/ThemeShellContext"');
    expect(themeProvider).not.toContain("createContext(");
    expect(themeProvider).not.toContain("export function useThemeShell");
    expect(themeContext).toContain(
      "export const ThemeShellContext = createContext",
    );
    expect(themeContext).toContain("export function useThemeShell");
  });

  it.each(themeConsumers)(
    "imports the stable theme context from %s",
    (relativePath) => {
      const consumer = readFileSync(resolve(sourceRoot, relativePath), "utf8");
      expect(consumer).toContain(
        'import { useThemeShell } from "@/providers/ThemeShellContext";',
      );
      expect(consumer).not.toContain(
        'import { useThemeShell } from "@/providers/ThemeProvider";',
      );
    },
  );

  it("keeps the skin-share context outside the component module", () => {
    expect(skinProvider).toContain('from "@/providers/SkinShareContext"');
    expect(skinProvider).not.toContain("createContext(");
    expect(skinProvider).not.toContain("export function useSkinShare");
    expect(skinContext).toContain(
      "export const SkinShareContext = createContext",
    );
    expect(skinContext).toContain("export function useSkinShare");
  });

  it.each(skinConsumers)(
    "imports the stable skin-share context from %s",
    (relativePath) => {
      const consumer = readFileSync(resolve(sourceRoot, relativePath), "utf8");
      expect(consumer).toContain(
        'import { useSkinShare } from "@/providers/SkinShareContext";',
      );
      expect(consumer).not.toContain(
        'import { useSkinShare } from "@/providers/SkinShareProvider";',
      );
    },
  );
});
