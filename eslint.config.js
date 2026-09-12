// Minimal ESLint flat config for quality gates (wave-a+).
// Parses TS/TSX via typescript-eslint; keeps rules light; forbids native dialogs.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "src-tauri/target/**",
      "node_modules/**",
      "coverage/**",
      "**/*.min.js",
    ],
  },
  {
    // Existing eslint-disable comments for rules we do not enforce yet.
    linterOptions: {
      reportUnusedDisableDirectives: "off",
    },
  },
  js.configs.recommended,
  // Parse TS/TSX; disable noisy recommended rules for historical codebase size.
  ...tseslint.configs.recommended.map((cfg) => ({
    ...cfg,
    rules: {
      ...(cfg.rules ?? {}),
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-unused-expressions": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-unsafe-function-type": "off",
      "@typescript-eslint/no-wrapper-object-types": "off",
      "@typescript-eslint/prefer-as-const": "off",
      "@typescript-eslint/no-namespace": "off",
      "@typescript-eslint/no-this-alias": "off",
    },
  })),
  {
    files: ["src/**/*.{js,jsx,ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        window: "readonly",
        document: "readonly",
        console: "readonly",
        localStorage: "readonly",
        sessionStorage: "readonly",
        navigator: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        requestAnimationFrame: "readonly",
        cancelAnimationFrame: "readonly",
        fetch: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        FormData: "readonly",
        Blob: "readonly",
        File: "readonly",
        FileReader: "readonly",
        AbortController: "readonly",
        AbortSignal: "readonly",
        HTMLElement: "readonly",
        HTMLDivElement: "readonly",
        HTMLTextAreaElement: "readonly",
        HTMLInputElement: "readonly",
        HTMLButtonElement: "readonly",
        Element: "readonly",
        Node: "readonly",
        NodeList: "readonly",
        Event: "readonly",
        CustomEvent: "readonly",
        KeyboardEvent: "readonly",
        MouseEvent: "readonly",
        ClipboardEvent: "readonly",
        DragEvent: "readonly",
        FocusEvent: "readonly",
        ResizeObserver: "readonly",
        IntersectionObserver: "readonly",
        MutationObserver: "readonly",
        performance: "readonly",
        crypto: "readonly",
        process: "readonly",
        __dirname: "readonly",
        module: "readonly",
        require: "readonly",
        exports: "readonly",
        Buffer: "readonly",
        global: "readonly",
        React: "readonly",
        JSX: "readonly",
      },
    },
    rules: {
      // Register hooks plugin so eslint-disable-next-line react-hooks/* is valid;
      // do not enforce exhaustive-deps yet (historical AppWorkbench surface).
      "react-hooks/rules-of-hooks": "off",
      "react-hooks/exhaustive-deps": "off",

      // Project hard rule: never use native browser dialogs in Tauri UI.
      "no-restricted-globals": [
        "error",
        {
          name: "confirm",
          message: "Use in-app dialogs (setAppDialog / GlassModal), never window.confirm.",
        },
        {
          name: "alert",
          message: "Use in-app dialogs, never window.alert.",
        },
        {
          name: "prompt",
          message: "Use in-app dialogs, never window.prompt.",
        },
      ],
      "no-restricted-properties": [
        "error",
        {
          object: "window",
          property: "confirm",
          message: "Use in-app dialogs (setAppDialog / GlassModal), never window.confirm.",
        },
        {
          object: "window",
          property: "alert",
          message: "Use in-app dialogs, never window.alert.",
        },
        {
          object: "window",
          property: "prompt",
          message: "Use in-app dialogs, never window.prompt.",
        },
      ],
      // Keep stray console.log out of product code; warn/error/info/debug stay
      // allowed. scrollPerfDebug.ts opts out per-file (its console report IS
      // the feature).
      "no-console": ["error", { allow: ["warn", "error", "info", "debug"] }],

      // Historical codebase is large; keep noise low in wave-a+.
      "no-unused-vars": "off",
      "no-undef": "off",
      "no-empty": "off",
      "no-redeclare": "off",
      "no-constant-condition": "off",
      "no-prototype-builtins": "off",
      "no-useless-escape": "off",
      "no-control-regex": "off",
      "no-cond-assign": "off",
      "no-fallthrough": "off",
      "no-sparse-arrays": "off",
      "no-extra-boolean-cast": "off",
      "no-case-declarations": "off",
      "no-useless-catch": "off",
      "no-async-promise-executor": "off",
      "prefer-const": "off",
      "no-var": "off",
      "no-inner-declarations": "off",
      "no-dupe-else-if": "off",
      "no-unsafe-optional-chaining": "off",
      "no-constant-binary-expression": "off",
    },
  },
);
