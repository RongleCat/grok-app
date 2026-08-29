import { defineConfig } from "vite";
// SWC avoids Babel codegen deopt on large modules (App.tsx ~800KB+).
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import process from "node:process";
import { vendorManualChunk } from "./src/lib/viteManualChunks";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],
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
