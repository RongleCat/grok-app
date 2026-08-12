import { describe, expect, it } from "vitest";
import {
  feishuHealthHintKeys,
  feishuRequiredNonSecretKeys,
  feishuRequiredSecretKeys,
  feishuSoftStatusMessage,
  isFeishuAppIdFormat,
  normalizeFeishuDomain,
  parseFeishuMentionMap,
  validateFeishuConfig,
} from "./feishuConfig";

describe("isFeishuAppIdFormat", () => {
  it("accepts common cli_ ids and rejects garbage", () => {
    expect(isFeishuAppIdFormat("cli_a1b2c3d4")).toBe(true);
    expect(isFeishuAppIdFormat("cli_xxx")).toBe(true);
    expect(isFeishuAppIdFormat("")).toBe(false);
    expect(isFeishuAppIdFormat("  ")).toBe(false);
    expect(isFeishuAppIdFormat("has space")).toBe(false);
    expect(isFeishuAppIdFormat("ab")).toBe(false);
  });
});

describe("normalizeFeishuDomain", () => {
  it("maps GUI domains and aliases", () => {
    expect(normalizeFeishuDomain({ domain: "open.feishu.cn" })).toEqual({
      kind: "feishu",
      host: "open.feishu.cn",
    });
    expect(normalizeFeishuDomain({ domain: "open.larksuite.com" })).toEqual({
      kind: "lark",
      host: "open.larksuite.com",
    });
    expect(normalizeFeishuDomain({ domain: "lark" })).toEqual({
      kind: "lark",
      host: "open.larksuite.com",
    });
    expect(
      normalizeFeishuDomain({
        domain: "custom",
        custom_domain: "open.example.com",
      }),
    ).toEqual({ kind: "custom", host: "open.example.com" });
    expect(normalizeFeishuDomain({}, "lark")).toEqual({
      kind: "lark",
      host: "open.larksuite.com",
    });
  });
});

describe("feishu required keys", () => {
  it("ws needs app_id + app_secret", () => {
    expect([...feishuRequiredNonSecretKeys()]).toEqual(["app_id"]);
    expect([...feishuRequiredSecretKeys()]).toEqual(["app_secret"]);
  });
});

describe("validateFeishuConfig", () => {
  it("rejects empty form", () => {
    const r = validateFeishuConfig({
      options: {},
      hasCredentials: false,
    });
    expect(r.ok).toBe(false);
    expect(r.transport).toBe("websocket");
    expect(r.needsPublicUrl).toBe(false);
    expect(r.missing).toContain("app_id");
    expect(r.missing).toContain("app_secret");
    expect(r.softStatus).toBe("missing_credentials");
    expect(feishuSoftStatusMessage(r)).toBe("missing_feishu_credentials");
  });

  it("accepts complete ws bind via form secrets", () => {
    const r = validateFeishuConfig({
      options: { app_id: "cli_aaa", domain: "open.feishu.cn" },
      secretKeysFilled: new Set(["app_secret"]),
    });
    expect(r.ok).toBe(true);
    expect(r.softStatus).toBe("ready_ws");
    expect(r.missing).toEqual([]);
    expect(r.domainKind).toBe("feishu");
    expect(feishuSoftStatusMessage(r)).toBe("feishu_ws_credentials_present");
  });

  it("accepts vault reuse when hasCredentials and app_id present", () => {
    const r = validateFeishuConfig({
      options: { app_id: "cli_aaa" },
      hasCredentials: true,
    });
    expect(r.ok).toBe(true);
    expect(r.softStatus).toBe("ready_ws");
  });

  it("accepts lark domain and soft status code", () => {
    const r = validateFeishuConfig({
      options: { app_id: "cli_aaa", domain: "open.larksuite.com" },
      secretKeysFilled: new Set(["app_secret"]),
      channel: "lark",
    });
    expect(r.ok).toBe(true);
    expect(r.domainKind).toBe("lark");
    expect(feishuSoftStatusMessage(r)).toBe(
      "feishu_ws_credentials_present_lark",
    );
  });

  it("reports invalid app_id format", () => {
    const r = validateFeishuConfig({
      options: { app_id: "bad id" },
      secretKeysFilled: new Set(["app_secret"]),
      appIdValue: "bad id",
    });
    expect(r.ok).toBe(false);
    expect(r.softStatus).toBe("invalid_app_id_format");
    expect(feishuSoftStatusMessage(r)).toBe("invalid_feishu_app_id_format");
  });

  it("requires custom_domain when domain=custom", () => {
    const r = validateFeishuConfig({
      options: { app_id: "cli_aaa", domain: "custom" },
      secretKeysFilled: new Set(["app_secret"]),
    });
    expect(r.ok).toBe(false);
    expect(r.softStatus).toBe("missing_custom_domain");
    expect(r.missing).toContain("custom_domain");
    expect(feishuSoftStatusMessage(r)).toBe("missing_feishu_custom_domain");
  });

  it("accepts custom domain when host set", () => {
    const r = validateFeishuConfig({
      options: {
        app_id: "cli_aaa",
        domain: "custom",
        custom_domain: "open.example.com",
      },
      secretKeysFilled: new Set(["app_secret"]),
    });
    expect(r.ok).toBe(true);
    expect(r.domainKind).toBe("custom");
    expect(r.domainHost).toBe("open.example.com");
  });

  it("reports missing_credentials when secret never entered", () => {
    const r = validateFeishuConfig({
      options: { app_id: "cli_aaa" },
      hasCredentials: false,
    });
    expect(r.ok).toBe(false);
    expect(r.softStatus).toBe("missing_credentials");
    expect(r.missing).toEqual(["app_secret"]);
  });

  it("reports incomplete when secret filled but app_id empty", () => {
    const r = validateFeishuConfig({
      options: {},
      secretKeysFilled: new Set(["app_secret"]),
    });
    expect(r.ok).toBe(false);
    expect(r.softStatus).toBe("incomplete");
    expect(r.missing).toEqual(["app_id"]);
    expect(feishuSoftStatusMessage(r)).toBe("missing_feishu_fields:app_id");
  });

  it("warns when interactive cards are off", () => {
    const r = validateFeishuConfig({
      options: {
        app_id: "cli_aaa",
        enable_feishu_card: false,
      },
      secretKeysFilled: new Set(["app_secret"]),
    });
    expect(r.ok).toBe(true);
    expect(r.warnings).toContain("feishu_card_off");
  });

  it("never claims public URL for websocket", () => {
    const r = validateFeishuConfig({
      options: { app_id: "cli_aaa" },
      secretKeysFilled: new Set(["app_secret"]),
    });
    expect(r.needsPublicUrl).toBe(false);
    expect(r.transport).toBe("websocket");
  });
});

describe("parseFeishuMentionMap", () => {
  it("parses name=open_id lines and JSON object", () => {
    expect(parseFeishuMentionMap("alice=ou_1\nbob:ou_2")).toEqual({
      alice: "ou_1",
      bob: "ou_2",
    });
    expect(parseFeishuMentionMap('{"alice":"ou_1"}')).toEqual({ alice: "ou_1" });
    expect(parseFeishuMentionMap("")).toEqual({});
    expect(parseFeishuMentionMap("# comment\n")).toEqual({});
  });
});

describe("feishuHealthHintKeys", () => {
  it("ws hints avoid public-url callout and include card events", () => {
    const v = validateFeishuConfig({
      options: { app_id: "cli_aaa", domain: "open.feishu.cn" },
      secretKeysFilled: new Set(["app_secret"]),
    });
    const hints = feishuHealthHintKeys(v, { enableFeishuCard: true });
    expect(hints.some((k) => k.includes("feishuWs"))).toBe(true);
    expect(hints.some((k) => k.includes("feishuNoWebhook"))).toBe(true);
    expect(hints.some((k) => k.includes("feishuCardEvents"))).toBe(true);
    expect(hints.some((k) => k.includes("PublicUrl") || k.includes("public"))).toBe(
      false,
    );
  });

  it("includes missing-keys, format, lark domain, and open ACL when asked", () => {
    const missing = validateFeishuConfig({
      options: {},
      hasCredentials: false,
    });
    const h1 = feishuHealthHintKeys(missing, { openAcl: true });
    expect(h1.some((k) => k.includes("feishuMissingKeys"))).toBe(true);
    expect(h1.some((k) => k.includes("openAcl"))).toBe(true);

    const badId = validateFeishuConfig({
      options: { app_id: "x y" },
      secretKeysFilled: new Set(["app_secret"]),
      appIdValue: "x y",
    });
    expect(
      feishuHealthHintKeys(badId).some((k) => k.includes("feishuAppIdFormat")),
    ).toBe(true);

    const lark = validateFeishuConfig({
      options: { app_id: "cli_a", domain: "lark" },
      secretKeysFilled: new Set(["app_secret"]),
    });
    expect(
      feishuHealthHintKeys(lark).some((k) => k.includes("feishuLarkDomain")),
    ).toBe(true);
  });
});
