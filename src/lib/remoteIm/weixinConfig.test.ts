import { describe, expect, it } from "vitest";
import {
  isWeixinHttpUrl,
  isWeixinProxyUrl,
  validateWeixinConfig,
  weixinHealthHintKeys,
  weixinRequiredNonSecretKeys,
  weixinRequiredSecretKeys,
  weixinSoftStatusMessage,
} from "./weixinConfig";

describe("isWeixinHttpUrl", () => {
  it("accepts empty and absolute http(s)", () => {
    expect(isWeixinHttpUrl("")).toBe(true);
    expect(isWeixinHttpUrl("  ")).toBe(true);
    expect(isWeixinHttpUrl("https://ilinkai.weixin.qq.com")).toBe(true);
    expect(isWeixinHttpUrl("http://localhost:8080")).toBe(true);
  });

  it("rejects non-http schemes and bare hosts", () => {
    expect(isWeixinHttpUrl("socks5://x")).toBe(false);
    expect(isWeixinHttpUrl("not a url")).toBe(false);
    expect(isWeixinHttpUrl("ilinkai.weixin.qq.com")).toBe(false);
  });
});

describe("isWeixinProxyUrl", () => {
  it("accepts empty, http(s), socks5(h)", () => {
    expect(isWeixinProxyUrl("")).toBe(true);
    expect(isWeixinProxyUrl("http://127.0.0.1:7890")).toBe(true);
    expect(isWeixinProxyUrl("socks5://127.0.0.1:1080")).toBe(true);
    expect(isWeixinProxyUrl("socks5h://proxy.example:1080")).toBe(true);
  });

  it("rejects garbage", () => {
    expect(isWeixinProxyUrl("ftp://x")).toBe(false);
    expect(isWeixinProxyUrl("not-a-proxy")).toBe(false);
  });
});

describe("weixin required keys", () => {
  it("token only for secrets; no non-secret bind required", () => {
    expect([...weixinRequiredNonSecretKeys()]).toEqual([]);
    expect([...weixinRequiredSecretKeys()]).toEqual(["token"]);
  });
});

describe("validateWeixinConfig", () => {
  it("rejects empty form", () => {
    const r = validateWeixinConfig({
      options: {},
      hasCredentials: false,
    });
    expect(r.ok).toBe(false);
    expect(r.transport).toBe("long_poll");
    expect(r.needsPublicUrl).toBe(false);
    expect(r.missing).toContain("token");
    expect(r.softStatus).toBe("missing_token");
    expect(weixinSoftStatusMessage(r)).toBe("missing_weixin_token");
  });

  it("accepts complete bind via form secret key presence", () => {
    const r = validateWeixinConfig({
      options: {},
      secretKeysFilled: new Set(["token"]),
    });
    expect(r.ok).toBe(true);
    expect(r.softStatus).toBe("ready_long_poll");
    expect(r.missing).toEqual([]);
    expect(weixinSoftStatusMessage(r)).toBe("weixin_ilink_credentials_present");
  });

  it("accepts vault reuse when hasCredentials", () => {
    const r = validateWeixinConfig({
      options: { account_id: "default" },
      hasCredentials: true,
    });
    expect(r.ok).toBe(true);
    expect(r.softStatus).toBe("ready_long_poll");
  });

  it("accepts bot_token / ilink_token aliases for secret key presence", () => {
    expect(
      validateWeixinConfig({
        options: {},
        secretKeysFilled: new Set(["bot_token"]),
      }).ok,
    ).toBe(true);
    expect(
      validateWeixinConfig({
        options: {},
        secretKeysFilled: new Set(["ilink_token"]),
      }).ok,
    ).toBe(true);
  });

  it("reports missing_token when secret never entered", () => {
    const r = validateWeixinConfig({
      options: { account_id: "default" },
      hasCredentials: false,
    });
    expect(r.ok).toBe(false);
    expect(r.softStatus).toBe("missing_token");
    expect(r.missing).toEqual(["token"]);
  });

  it("rejects invalid base_url override", () => {
    const r = validateWeixinConfig({
      options: { base_url: "not-a-url" },
      secretKeysFilled: new Set(["token"]),
    });
    expect(r.ok).toBe(false);
    expect(r.softStatus).toBe("invalid_base_url");
    expect(r.missing).toContain("base_url");
    expect(weixinSoftStatusMessage(r)).toBe("invalid_weixin_base_url");
  });

  it("rejects invalid proxy", () => {
    const r = validateWeixinConfig({
      options: { proxy: "ftp://bad" },
      secretKeysFilled: new Set(["token"]),
    });
    expect(r.ok).toBe(false);
    expect(r.softStatus).toBe("invalid_proxy");
    expect(weixinSoftStatusMessage(r)).toBe("invalid_weixin_proxy");
  });

  it("flags proxy presence on ready soft message", () => {
    const r = validateWeixinConfig({
      options: { proxy: "socks5://127.0.0.1:1080" },
      secretKeysFilled: new Set(["token"]),
    });
    expect(r.ok).toBe(true);
    expect(r.proxySet).toBe(true);
    expect(weixinSoftStatusMessage(r)).toBe(
      "weixin_ilink_credentials_present_proxy",
    );
  });

  it("warns when chat_id lacks room suffix but stays ready", () => {
    const r = validateWeixinConfig({
      options: { chat_id: "123456" },
      secretKeysFilled: new Set(["token"]),
    });
    expect(r.ok).toBe(true);
    expect(r.chatIdSet).toBe(true);
    expect(r.warnings).toContain("chat_id_maybe_not_room");
  });

  it("accepts group chat_id with @chatroom", () => {
    const r = validateWeixinConfig({
      options: { chat_id: "123@chatroom" },
      secretKeysFilled: new Set(["token"]),
    });
    expect(r.ok).toBe(true);
    expect(r.warnings).not.toContain("chat_id_maybe_not_room");
  });

  it("never claims public URL", () => {
    const r = validateWeixinConfig({
      options: {},
      secretKeysFilled: new Set(["token"]),
    });
    expect(r.needsPublicUrl).toBe(false);
  });

  it("warns on extreme long_poll_timeout_ms", () => {
    const r = validateWeixinConfig({
      options: { long_poll_timeout_ms: 500 },
      secretKeysFilled: new Set(["token"]),
    });
    expect(r.ok).toBe(true);
    expect(r.warnings).toContain("long_poll_timeout_out_of_range");
  });
});

describe("weixinHealthHintKeys", () => {
  it("long-poll hints avoid public-url product callouts", () => {
    const v = validateWeixinConfig({
      options: {},
      secretKeysFilled: new Set(["token"]),
    });
    const hints = weixinHealthHintKeys(v);
    expect(hints.some((k) => k.includes("weixinPoll"))).toBe(true);
    expect(hints.some((k) => k.includes("weixinNoPublicUrl"))).toBe(true);
    expect(hints.some((k) => k.includes("weixinNoLiveClaim"))).toBe(true);
    expect(hints.some((k) => k.includes("weixinTextMenu"))).toBe(true);
    expect(hints.some((k) => k.includes("PublicUrl") && k.includes("wecom"))).toBe(
      false,
    );
  });

  it("includes missing token, proxy, chat_id, open ACL when asked", () => {
    const v = validateWeixinConfig({
      options: {
        proxy: "socks5://127.0.0.1:1",
        chat_id: "bare-id",
      },
      hasCredentials: false,
    });
    const hints = weixinHealthHintKeys(v, { openAcl: true });
    expect(hints.some((k) => k.includes("weixinMissingToken"))).toBe(true);
    expect(hints.some((k) => k.includes("weixinProxy"))).toBe(true);
    expect(hints.some((k) => k.includes("weixinChatId"))).toBe(true);
    expect(hints.some((k) => k.includes("openAcl"))).toBe(true);
  });

  it("surfaces invalid base_url and invalid proxy distinctly", () => {
    const base = validateWeixinConfig({
      options: { base_url: "nope" },
      secretKeysFilled: new Set(["token"]),
    });
    expect(
      weixinHealthHintKeys(base).some((k) => k.includes("weixinBaseUrlInvalid")),
    ).toBe(true);

    const proxy = validateWeixinConfig({
      options: { proxy: "bad" },
      secretKeysFilled: new Set(["token"]),
    });
    expect(
      weixinHealthHintKeys(proxy).some((k) =>
        k.includes("weixinProxyInvalid"),
      ),
    ).toBe(true);
  });
});
