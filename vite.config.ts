import { defineConfig, type Plugin } from "vite";
// SWC avoids Babel codegen deopt on large modules (AppWorkbench.tsx ~450KB).
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { resolveAppDisplayVersion } from "./src/lib/appDisplayVersion";
import { vendorManualChunk } from "./src/lib/viteManualChunks";
import {
  isKatexFallbackFontAsset,
  stripKatexFallbackFontSrc,
} from "./src/lib/katexFontTrim";

const host = process.env.TAURI_DEV_HOST;
const root = path.resolve(__dirname);

function gitOut(args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    }).trim();
  } catch {
    return "";
  }
}

function grokDisplayVersion(): string {
  let packageVersion = "";
  try {
    packageVersion = JSON.parse(
      readFileSync(path.join(root, "package.json"), "utf8"),
    ).version as string;
  } catch {
    packageVersion = "";
  }
  return resolveAppDisplayVersion({
    tagsAtHead: gitOut(["tag", "--points-at", "HEAD"])
      .split(/\r?\n/)
      .map((t) => t.trim())
      .filter(Boolean),
    shortSha: gitOut(["rev-parse", "--short", "HEAD"]) || null,
    packageVersion,
    githubRef: process.env.GITHUB_REF,
    githubRefType: process.env.GITHUB_REF_TYPE,
    githubRefName: process.env.GITHUB_REF_NAME,
    displayOverride:
      process.env.GROK_DISPLAY_VERSION || process.env.VITE_GROK_DISPLAY_VERSION,
  });
}

// KaTeX ships woff2 + woff + ttf per font; the desktop WebViews all do
// woff2, so drop the fallback src entries and their assets (~700KB).
function katexWoff2Only(): Plugin {
  return {
    name: "katex-woff2-only",
    generateBundle(_options, bundle) {
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type !== "asset") continue;
        if (fileName.endsWith(".css")) {
          chunk.source = stripKatexFallbackFontSrc(String(chunk.source));
        } else if (isKatexFallbackFontAsset(fileName)) {
          delete bundle[fileName];
        }
      }
    },
  };
}

export default defineConfig(() => ({
  plugins: [react(), tailwindcss(), katexWoff2Only()],
  define: {
    "import.meta.env.VITE_GROK_DISPLAY_VERSION": JSON.stringify(
      grokDisplayVersion(),
    ),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  server: {
    port: 1421,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1422,
        }
      : undefined,
    watch: {
      ignored: [
        "**/src-tauri/**",
        "**/.grok-app-dev-home/**",
        "**/.cargo-home/**",
        "**/*.tsbuildinfo",
      ],
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: vendorManualChunk,
      },
    },
  },
  test: {
    environment: "node",
    environmentOptions: {
      jsdom: {
        url: "http://localhost/",
      },
    },
    include: ["src/**/*.{test,spec}.ts", "src/**/*.{test,spec}.tsx"],
    setupFiles: ["./src/test/loadLocaleCatalogs.ts"],
  },
}));
