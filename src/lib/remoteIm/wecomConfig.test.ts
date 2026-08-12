import { describe, expect, it } from "vitest";
import {
  normalizeWecomConnectMode,
  validateWecomConfig,
  wecomHealthHintKeys,
  wecomRequiredNonSecretKeys,
  wecomRequiredSecretKeys,
  wecomSoftStatusMessage,
} from "./wecomConfig";

describe("normalizeWecomConnectMode", () => {
  it("defaults to websocket", () => {
    expect(normalizeWecomConnectMode({})).toBe("websocket");
    expect(normalizeWecomConnectMode(null)).toBe("websocket");
    expect(normalizeWecomConnectMode({ connect_mode: "weird" })).toBe(
      "websocket",
    );
  });

  it("accepts webhook via connect_mode or mode", () => {
    expect(normalizeWecomConnectMode({ connect_mode: "webhook" })).toBe(
      "webhook",
    );
    expect(normalizeWecomConnectMode({ mode: "webhook" })).toBe("webhook");
  });
});

describe("wecom required keys", () => {
  it("ws needs bot_id + bot_secret", () => {
    expect([...wecomRequiredNonSecretKeys("websocket")]).toEqual(["bot_id"]);
    expect([...wecomRequiredSecretKeys("websocket")]).toEqual(["bot_secret"]);
  });

  it("webhook needs corp + agent + callback_token", () => {
    expect([...wecomRequiredNonSecretKeys("webhook")]).toEqual([
      "corp_id",
      "agent_id",
    ]);
    expect([...wecomRequiredSecretKeys("webhook")]).toEqual([
      "corp_secret",
      "callback_token",
    ]);
  });
});

describe("validateWecomConfig", () => {
  it("rejects empty websocket form", () => {
    const r = validateWecomConfig({
      options: { connect_mode: "websocket" },
      hasCredentials: false,
    });
    expect(r.ok).toBe(false);
    expect(r.mode).toBe("websocket");
    expect(r.needsPublicUrl).toBe(false);
    expect(r.missing).toContain("bot_id");
    expect(r.missing).toContain("bot_secret");
    expect(r.softStatus).toBe("missing_credentials");
    expect(wecomSoftStatusMessage(r)).toBe("missing_wecom_credentials");
  });

  it("accepts complete websocket bind", () => {
    const r = validateWecomConfig({
      options: { connect_mode: "websocket", bot_id: "b1" },
      secretKeysFilled: new Set(["bot_secret"]),
    });
    expect(r.ok).toBe(true);
    expect(r.softStatus).toBe("ready_ws");
    expect(r.transport).toBe("websocket");
    expect(wecomSoftStatusMessage(r)).toBe("wecom_ws_credentials_present");
  });

  it("accepts complete webhook bind", () => {
    const r = validateWecomConfig({
      options: {
        connect_mode: "webhook",
        corp_id: "ww",
        agent_id: "1000002",
      },
      secretKeysFilled: new Set(["corp_secret", "callback_token"]),
    });
    expect(r.ok).toBe(true);
    expect(r.needsPublicUrl).toBe(true);
    expect(r.softStatus).toBe("ready_webhook");
    expect(wecomSoftStatusMessage(r)).toBe(
      "wecom_webhook_credentials_present",
    );
  });

  it("does not require corp secrets in websocket mode", () => {
    const r = validateWecomConfig({
      options: { connect_mode: "websocket", bot_id: "b" },
      secretKeysFilled: new Set(["bot_secret"]),
    });
    expect(r.missing).not.toContain("corp_id");
    expect(r.missing).not.toContain("corp_secret");
    expect(r.ok).toBe(true);
  });

  it("reuses vault secrets only when mode unchanged", () => {
    const same = validateWecomConfig({
      options: { connect_mode: "websocket", bot_id: "b" },
      hasCredentials: true,
      savedConnectMode: "websocket",
    });
    expect(same.ok).toBe(true);
    expect(same.missing).toEqual([]);

    const switched = validateWecomConfig({
      options: {
        connect_mode: "webhook",
        corp_id: "ww",
        agent_id: "1",
      },
      hasCredentials: true,
      savedConnectMode: "websocket",
    });
    expect(switched.ok).toBe(false);
    expect(switched.softStatus).toBe("mode_switch_needs_secrets");
    expect(switched.missing).toContain("corp_secret");
    expect(switched.missing).toContain("callback_token");
    expect(wecomSoftStatusMessage(switched)).toBe(
      "wecom_mode_switch_needs_secrets",
    );
  });

  it("reports incomplete when only some fields present", () => {
    const r = validateWecomConfig({
      options: { connect_mode: "webhook", corp_id: "ww" },
      secretKeysFilled: new Set(["corp_secret"]),
    });
    expect(r.ok).toBe(false);
    expect(r.softStatus).toBe("incomplete");
    expect(r.missing).toContain("agent_id");
    expect(r.missing).toContain("callback_token");
    expect(wecomSoftStatusMessage(r)).toMatch(/^missing_wecom_fields:/);
  });
});

describe("wecomHealthHintKeys", () => {
  it("ws hints avoid public-url callout", () => {
    const v = validateWecomConfig({
      options: { connect_mode: "websocket", bot_id: "b" },
      secretKeysFilled: new Set(["bot_secret"]),
    });
    const hints = wecomHealthHintKeys(v);
    expect(hints.some((k) => k.includes("wecomWs"))).toBe(true);
    expect(hints.some((k) => k.includes("wecomNoLiveClaim"))).toBe(true);
    expect(hints.some((k) => k.includes("wecomPublicUrl"))).toBe(false);
  });

  it("webhook hints include public URL + open ACL when asked", () => {
    const v = validateWecomConfig({
      options: {
        connect_mode: "webhook",
        corp_id: "ww",
        agent_id: "1",
      },
      secretKeysFilled: new Set(["corp_secret", "callback_token"]),
    });
    const hints = wecomHealthHintKeys(v, { openAcl: true });
    expect(hints.some((k) => k.includes("wecomWebhook"))).toBe(true);
    expect(hints.some((k) => k.includes("wecomPublicUrl"))).toBe(true);
    expect(hints.some((k) => k.includes("wecomNoLiveClaim"))).toBe(true);
    expect(hints.some((k) => k.includes("openAcl"))).toBe(true);
  });
});
