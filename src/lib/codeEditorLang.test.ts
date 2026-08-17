import { describe, expect, it } from "vitest";
import { codeEditorLangId, codeEditorLangKind } from "./codeEditorLang";

describe("codeEditorLangId", () => {
  it("prefers an explicit language", () => {
    expect(codeEditorLangId("a.py", "json")).toBe("json");
  });

  it("falls back to the filename map", () => {
    expect(codeEditorLangId("export_data_to_test.py")).toBe("python");
    expect(codeEditorLangId("app.tsx")).toBe("typescript");
    expect(codeEditorLangId("Cargo.lock")).toBe("ini");
  });

  it("treats text / empty as plaintext", () => {
    expect(codeEditorLangId(undefined, "text")).toBe("plaintext");
    expect(codeEditorLangId()).toBe("plaintext");
  });
});

describe("codeEditorLangKind", () => {
  it("uses native CM languages for JS / JSON / Python", () => {
    expect(codeEditorLangKind("app.ts")).toBe("javascript");
    expect(codeEditorLangKind("data.json")).toBe("json");
    expect(codeEditorLangKind("script.py")).toBe("python");
  });

  it("streams rust / go / yaml", () => {
    expect(codeEditorLangKind("main.rs")).toBe("stream");
    expect(codeEditorLangKind("main.go")).toBe("stream");
    expect(codeEditorLangKind("cfg.yaml")).toBe("stream");
  });
});
