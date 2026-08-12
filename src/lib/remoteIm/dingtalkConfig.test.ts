import { describe, expect, it } from "vitest";
import {
  dingtalkClientId,
  dingtalkHealthHintKeys,
  dingtalkRequiredNonSecretKeys,
  dingtalkRequiredSecretKeys,
  dingtalkSoftStatusMessage,
  validateDingtalkConfig,
} from "./dingtalkConfig";

describe("dingtalkClientId", () => {
  it("reads client_id and falls back to app_key", () => {
    expect(dingtalkClientId({ client_id: "cid" })).toBe("cid");
    expect(dingtalkClientId({ app_key: "ak" })).toBe("ak");
    expect(dingtalkClientId({ client_id: "  ", app_key: "ak" })).toBe("ak");
    expect(dingtalkClientId({})).toBe("");
    expect(dingtalkClientId(null)).toBe("");
  });
});

describe("dingtalk required keys", () => {
  it("stream needs client_id + client_secret", () => {
    expect([...dingtalkRequiredNonSecretKeys()]).toEqual(["client_id"]);
    expect([...dingtalkRequiredSecretKeys()]).toEqual(["client_secret"]);
  });
});

describe("validateDingtalkConfig", () => {
  it("rejects empty form", () => {
    const r = validateDingtalkConfig({
      options: {},
      hasCredentials: false,
    });
    expect(r.ok).toBe(false);
    expect(r.mode).toBe("stream");
    expect(r.needsPublicUrl).toBe(false);
    expect(r.transport).toBe("stream");
    expect(r.missing).toContain("client_id");
    expect(r.missing).toContain("client_secret");
    expect(r.softStatus).toBe("missing_credentials");
    expect(dingtalkSoftStatusMessage(r)).toBe("missing_dingtalk_credentials");
  });

  it("accepts complete stream bind via form secrets", () => {
    const r = validateDingtalkConfig({
      options: { client_id: "dingxxx" },
      secretKeysFilled: new Set(["client_secret"]),
    });
    expect(r.ok).toBe(true);
    expect(r.softStatus).toBe("ready_stream");
    expect(r.missing).toEqual([]);
    expect(dingtalkSoftStatusMessage(r)).toBe(
      "dingtalk_stream_credentials_present",
    );
  });

  it("accepts vault reuse when hasCredentials and client_id present", () => {
    const r = validateDingtalkConfig({
      options: { client_id: "dingxxx" },
      hasCredentials: true,
    });
    expect(r.ok).toBe(true);
    expect(r.softStatus).toBe("ready_stream");
  });

  it("accepts app_key alias for client id", () => {
    const r = validateDingtalkConfig({
      options: { app_key: "legacy" },
      secretKeysFilled: new Set(["client_secret"]),
    });
    expect(r.ok).toBe(true);
    expect(r.missing).not.toContain("client_id");
  });

  it("accepts app_secret alias for secret key presence", () => {
    const r = validateDingtalkConfig({
      options: { client_id: "c" },
      secretKeysFilled: new Set(["app_secret"]),
    });
    expect(r.ok).toBe(true);
  });

  it("reports missing_credentials when secret never entered", () => {
    const r = validateDingtalkConfig({
      options: { client_id: "c" },
      hasCredentials: false,
    });
    expect(r.ok).toBe(false);
    expect(r.softStatus).toBe("missing_credentials");
    expect(r.missing).toEqual(["client_secret"]);
    expect(dingtalkSoftStatusMessage(r)).toBe("missing_dingtalk_credentials");
  });

  it("reports incomplete when secret filled but client_id empty", () => {
    const r = validateDingtalkConfig({
      options: {},
      secretKeysFilled: new Set(["client_secret"]),
    });
    expect(r.ok).toBe(false);
    expect(r.softStatus).toBe("incomplete");
    expect(r.missing).toEqual(["client_id"]);
    expect(dingtalkSoftStatusMessage(r)).toBe(
      "missing_dingtalk_fields:client_id",
    );
  });

  it("never claims public URL for stream", () => {
    const r = validateDingtalkConfig({
      options: { client_id: "c" },
      secretKeysFilled: new Set(["client_secret"]),
    });
    expect(r.needsPublicUrl).toBe(false);
  });
});

describe("dingtalkHealthHintKeys", () => {
  it("stream hints avoid public-url callout", () => {
    const v = validateDingtalkConfig({
      options: { client_id: "c" },
      secretKeysFilled: new Set(["client_secret"]),
    });
    const hints = dingtalkHealthHintKeys(v);
    expect(hints.some((k) => k.includes("dingtalkStream"))).toBe(true);
    expect(hints.some((k) => k.includes("dingtalkNoLiveClaim"))).toBe(true);
    expect(hints.some((k) => k.includes("PublicUrl") || k.includes("public"))).toBe(
      false,
    );
  });

  it("includes missing-keys, AI card, and open ACL when asked", () => {
    const v = validateDingtalkConfig({
      options: {},
      hasCredentials: false,
    });
    const hints = dingtalkHealthHintKeys(v, {
      openAcl: true,
      enableAiCard: true,
    });
    expect(hints.some((k) => k.includes("dingtalkMissingKeys"))).toBe(true);
    expect(hints.some((k) => k.includes("dingtalkAiCard"))).toBe(true);
    expect(hints.some((k) => k.includes("openAcl"))).toBe(true);
  });
});
