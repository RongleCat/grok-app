import { describe, expect, it } from "vitest";
import {
  channelHasDeepHealth,
  channelModeLabel,
  classifyChannelHealth,
  credentialReadiness,
  sanitizeChannelError,
  transportForChannel,
  transportKeyFor,
} from "./channelHealth";
import { createDefaultInstance } from "./store";
import type { ChannelInstance } from "./types";

function inst(
  channel: ChannelInstance["channel"],
  patch: Partial<ChannelInstance> = {},
): ChannelInstance {
  return {
    ...createDefaultInstance(channel),
    ...patch,
    channel,
    options: { ...createDefaultInstance(channel).options, ...patch.options },
  };
}

describe("sanitizeChannelError", () => {
  it("redacts token/secret pairs and urls", () => {
    const s = sanitizeChannelError(
      "failed app_secret=superleak token=abc123 https://evil.example/x",
    );
    expect(s).toBeTruthy();
    expect(s!).not.toContain("superleak");
    expect(s!).not.toContain("abc123");
    expect(s!).toContain("[url]");
    expect(s!).toMatch(/••••|\[redacted\]|app_secret=••••/i);
  });

  it("returns null for empty", () => {
    expect(sanitizeChannelError("")).toBeNull();
    expect(sanitizeChannelError(null)).toBeNull();
  });
});

describe("transportForChannel", () => {
  it("feishu is websocket; telegram is long_poll", () => {
    expect(transportForChannel("feishu")).toBe("websocket");
    expect(transportForChannel("lark")).toBe("websocket");
    expect(transportForChannel("telegram")).toBe("long_poll");
    expect(transportForChannel("dingtalk")).toBe("stream");
  });

  it("wecom respects connect mode", () => {
    expect(transportForChannel("wecom", { connect_mode: "webhook" })).toBe(
      "webhook",
    );
    expect(transportForChannel("wecom", { connect_mode: "websocket" })).toBe(
      "websocket",
    );
  });

  it("transportKeyFor maps known transports", () => {
    expect(transportKeyFor("websocket")).toContain("websocket");
    expect(transportKeyFor("long_poll")).toContain("longPoll");
  });
});

describe("channelModeLabel", () => {
  it("feishu domain + telegram proxy", () => {
    expect(channelModeLabel("feishu", { domain: "feishu" })).toBe(
      "domain=feishu",
    );
    expect(channelModeLabel("lark", { domain: "lark" })).toBe("domain=lark");
    expect(channelModeLabel("telegram", {})).toBe("proxy=none");
    expect(channelModeLabel("telegram", { proxy: "socks5://x" })).toBe(
      "proxy=set",
    );
  });
});

describe("credentialReadiness", () => {
  it("feishu needs app_id + secret unless hasCredentials", () => {
    const bare = inst("feishu", {
      hasCredentials: false,
      options: { app_id: "" },
    });
    const r = credentialReadiness("feishu", bare);
    expect(r.ready).toBe(false);
    expect(r.missingKeys).toContain("app_id");
    expect(r.missingKeys).toContain("app_secret");

    const saved = inst("feishu", {
      hasCredentials: true,
      options: { app_id: "cli_x" },
    });
    expect(credentialReadiness("feishu", saved).ready).toBe(true);
  });

  it("telegram ready with token in form set", () => {
    const bare = inst("telegram", { hasCredentials: false });
    expect(credentialReadiness("telegram", bare).ready).toBe(false);
    expect(
      credentialReadiness("telegram", bare, new Set(["token"])).ready,
    ).toBe(true);
  });
});

describe("classifyChannelHealth", () => {
  it("feishu: unconfigured → configured → connected with deep hints", () => {
    const bare = inst("feishu", { hasCredentials: false, enabled: false });
    const h0 = classifyChannelHealth({
      instance: bare,
      bridgeRunning: false,
    });
    expect(h0.tone).toBe("unconfigured");
    expect(h0.transport).toBe("websocket");
    expect(channelHasDeepHealth("feishu")).toBe(true);
    expect(h0.hintKeys.some((k) => k.includes("needCredentials"))).toBe(true);
    expect(h0.hintKeys.some((k) => k.includes("feishuWs"))).toBe(true);

    const cfg = inst("feishu", {
      hasCredentials: true,
      enabled: true,
      options: { app_id: "cli_x", domain: "feishu" },
      acl: {
        allowFrom: "*",
        requireMention: true,
        groupOnly: false,
        shareSessionInChannel: false,
      },
    });
    const h1 = classifyChannelHealth({
      instance: cfg,
      bridgeRunning: true,
      bridgeLinked: false,
    });
    expect(h1.tone).toBe("configured");
    expect(h1.openAcl).toBe(true);
    expect(h1.modeLabel).toBe("domain=feishu");
    expect(h1.hintKeys.some((k) => k.includes("openAcl"))).toBe(true);

    const h2 = classifyChannelHealth({
      instance: cfg,
      bridgeRunning: true,
      bridgeLinked: true,
    });
    expect(h2.tone).toBe("connected");
    expect(h2.badgeTone).toBe("ok");
    expect(h2.bridgeLinked).toBe(true);
  });

  it("telegram: long_poll health with proxy and ACL hints", () => {
    expect(channelHasDeepHealth("telegram")).toBe(true);
    const tg = inst("telegram", {
      hasCredentials: true,
      enabled: true,
      options: { proxy: "socks5://127.0.0.1:1080" },
      acl: {
        allowFrom: "*",
        requireMention: true,
        groupOnly: false,
        shareSessionInChannel: false,
      },
      lastError: "auth token=LEAKME failed",
    });
    const h = classifyChannelHealth({
      instance: tg,
      bridgeRunning: true,
      bridgeLinked: true,
    });
    expect(h.tone).toBe("error");
    expect(h.transport).toBe("long_poll");
    expect(h.modeLabel).toBe("proxy=set");
    expect(h.lastError).toBeTruthy();
    expect(h.lastError!).not.toContain("LEAKME");
    expect(h.hintKeys.some((k) => k.includes("telegramPoll"))).toBe(true);
    expect(h.hintKeys.some((k) => k.includes("telegramProxy"))).toBe(true);
  });

  it("error tone when lastError set", () => {
    const i = inst("feishu", {
      hasCredentials: true,
      enabled: true,
      lastError: "ws closed",
    });
    const h = classifyChannelHealth({
      instance: i,
      bridgeRunning: true,
      bridgeLinked: true,
    });
    expect(h.tone).toBe("error");
    expect(h.badgeTone).toBe("err");
  });

  it("wecom: deep health is mode-aware (ws vs webhook)", () => {
    expect(channelHasDeepHealth("wecom")).toBe(true);

    const bare = inst("wecom", {
      hasCredentials: false,
      enabled: false,
      options: { connect_mode: "websocket" },
    });
    const h0 = classifyChannelHealth({
      instance: bare,
      bridgeRunning: false,
    });
    expect(h0.tone).toBe("unconfigured");
    expect(h0.transport).toBe("websocket");
    expect(h0.modeLabel).toBe("mode=websocket");
    expect(h0.credentialsReady).toBe(false);
    expect(h0.hintKeys.some((k) => k.includes("wecomWs"))).toBe(true);
    expect(h0.hintKeys.some((k) => k.includes("wecomNoLiveClaim"))).toBe(true);
    expect(h0.hintKeys.some((k) => k.includes("wecomPublicUrl"))).toBe(false);

    const wsReady = inst("wecom", {
      hasCredentials: true,
      enabled: true,
      options: { connect_mode: "websocket", bot_id: "b1" },
      acl: {
        allowFrom: "*",
        requireMention: true,
        groupOnly: false,
        shareSessionInChannel: false,
      },
    });
    const h1 = classifyChannelHealth({
      instance: wsReady,
      bridgeRunning: true,
      bridgeLinked: true,
    });
    expect(h1.credentialsReady).toBe(true);
    expect(h1.tone).toBe("connected");
    expect(h1.transport).toBe("websocket");
    expect(h1.hintKeys.some((k) => k.includes("wecomWs"))).toBe(true);
    expect(h1.openAcl).toBe(true);

    // Draft mode switch to webhook without new secrets → not ready, not "connected"
    const h2 = classifyChannelHealth({
      instance: wsReady,
      bridgeRunning: true,
      bridgeLinked: true,
      draftOptions: {
        connect_mode: "webhook",
        corp_id: "ww",
        agent_id: "1",
      },
    });
    expect(h2.transport).toBe("webhook");
    expect(h2.modeLabel).toBe("mode=webhook");
    expect(h2.credentialsReady).toBe(false);
    expect(h2.tone).not.toBe("connected");
    expect(h2.hintKeys.some((k) => k.includes("wecomModeSwitch"))).toBe(true);
    expect(h2.hintKeys.some((k) => k.includes("wecomPublicUrl"))).toBe(true);
  });

  it("dingtalk: stream deep health · never connected without Bridge link", () => {
    expect(channelHasDeepHealth("dingtalk")).toBe(true);
    expect(transportForChannel("dingtalk")).toBe("stream");

    const bare = inst("dingtalk", {
      hasCredentials: false,
      enabled: false,
      options: {},
    });
    const h0 = classifyChannelHealth({
      instance: bare,
      bridgeRunning: false,
    });
    expect(h0.tone).toBe("unconfigured");
    expect(h0.transport).toBe("stream");
    expect(h0.credentialsReady).toBe(false);
    expect(h0.hintKeys.some((k) => k.includes("dingtalkStream"))).toBe(true);
    expect(h0.hintKeys.some((k) => k.includes("dingtalkNoLiveClaim"))).toBe(
      true,
    );
    expect(h0.hintKeys.some((k) => k.includes("dingtalkMissingKeys"))).toBe(
      true,
    );

    const ready = inst("dingtalk", {
      hasCredentials: true,
      enabled: true,
      options: { client_id: "dingxxx", enable_ai_card: true },
      acl: {
        allowFrom: "*",
        requireMention: true,
        groupOnly: false,
        shareSessionInChannel: false,
      },
    });
    const h1 = classifyChannelHealth({
      instance: ready,
      bridgeRunning: true,
      bridgeLinked: true,
    });
    expect(h1.credentialsReady).toBe(true);
    expect(h1.tone).toBe("connected");
    expect(h1.modeLabel).toBe("mode=stream");
    expect(h1.hintKeys.some((k) => k.includes("dingtalkAiCard"))).toBe(true);
    expect(h1.openAcl).toBe(true);

    // Bridge running but not linked → never "connected"
    const hNotLinked = classifyChannelHealth({
      instance: ready,
      bridgeRunning: true,
      bridgeLinked: false,
    });
    expect(hNotLinked.tone).toBe("configured");
    expect(hNotLinked.tone).not.toBe("connected");

    // Missing client_id with vault → soft-fail, not connected even if linked
    const incomplete = inst("dingtalk", {
      hasCredentials: true,
      enabled: true,
      options: { client_id: "" },
    });
    const h2 = classifyChannelHealth({
      instance: incomplete,
      bridgeRunning: true,
      bridgeLinked: true,
    });
    expect(h2.credentialsReady).toBe(false);
    expect(h2.tone).not.toBe("connected");
    expect(h2.missingKeys).toContain("client_id");
  });

  it("wecom credentialReadiness ignores corp secrets in websocket mode", () => {
    const i = inst("wecom", {
      hasCredentials: false,
      options: { connect_mode: "websocket", bot_id: "b" },
    });
    const r = credentialReadiness("wecom", i, new Set(["bot_secret"]));
    expect(r.ready).toBe(true);
    expect(r.missingKeys).not.toContain("corp_secret");
  });

  it("weixin: deep health is long-poll / ilink honest", () => {
    expect(channelHasDeepHealth("weixin")).toBe(true);
    expect(transportForChannel("weixin")).toBe("long_poll");

    const bare = inst("weixin", {
      hasCredentials: false,
      enabled: false,
      options: {},
    });
    const h0 = classifyChannelHealth({
      instance: bare,
      bridgeRunning: false,
    });
    expect(h0.tone).toBe("unconfigured");
    expect(h0.transport).toBe("long_poll");
    expect(h0.credentialsReady).toBe(false);
    expect(h0.hintKeys.some((k) => k.includes("weixinPoll"))).toBe(true);
    expect(h0.hintKeys.some((k) => k.includes("weixinNoPublicUrl"))).toBe(true);
    expect(h0.hintKeys.some((k) => k.includes("weixinNoLiveClaim"))).toBe(true);
    expect(h0.hintKeys.some((k) => k.includes("weixinMissingToken"))).toBe(
      true,
    );
    expect(h0.hintKeys.some((k) => k.includes("weixinTextMenu"))).toBe(true);

    const ready = inst("weixin", {
      hasCredentials: true,
      enabled: true,
      options: { account_id: "default", proxy: "socks5://127.0.0.1:1" },
      acl: {
        allowFrom: "*",
        requireMention: true,
        groupOnly: false,
        shareSessionInChannel: false,
      },
    });
    const h1 = classifyChannelHealth({
      instance: ready,
      bridgeRunning: true,
      bridgeLinked: true,
    });
    expect(h1.credentialsReady).toBe(true);
    expect(h1.tone).toBe("connected");
    expect(h1.modeLabel).toContain("mode=ilink");
    expect(h1.modeLabel).toContain("proxy=set");
    expect(h1.hintKeys.some((k) => k.includes("weixinTextMenu"))).toBe(true);
    expect(h1.openAcl).toBe(true);

    // Invalid draft base_url soft-fail — not connected even if Bridge linked
    const hBad = classifyChannelHealth({
      instance: ready,
      bridgeRunning: true,
      bridgeLinked: true,
      draftOptions: { base_url: "not-a-url" },
    });
    expect(hBad.credentialsReady).toBe(false);
    expect(hBad.tone).not.toBe("connected");
    expect(hBad.hintKeys.some((k) => k.includes("weixinBaseUrlInvalid"))).toBe(
      true,
    );

    // Bridge not linked → never "connected"
    const hNotLinked = classifyChannelHealth({
      instance: ready,
      bridgeRunning: true,
      bridgeLinked: false,
    });
    expect(hNotLinked.tone).toBe("configured");
    expect(hNotLinked.tone).not.toBe("connected");
  });

  it("weixin credentialReadiness needs token or vault", () => {
    const bare = inst("weixin", { hasCredentials: false });
    expect(credentialReadiness("weixin", bare).ready).toBe(false);
    expect(
      credentialReadiness("weixin", bare, new Set(["token"])).ready,
    ).toBe(true);
    expect(
      credentialReadiness("weixin", inst("weixin", { hasCredentials: true }))
        .ready,
    ).toBe(true);
  });

  it("discord: gateway deep health with intent + ACL hints", () => {
    expect(channelHasDeepHealth("discord")).toBe(true);
    const bare = inst("discord", {
      hasCredentials: false,
      enabled: false,
      options: {},
    });
    const h0 = classifyChannelHealth({
      instance: bare,
      bridgeRunning: false,
    });
    expect(h0.tone).toBe("unconfigured");
    expect(h0.transport).toBe("gateway");
    expect(h0.credentialsReady).toBe(false);
    expect(h0.hintKeys.some((k) => k.includes("discordGateway"))).toBe(true);
    expect(h0.hintKeys.some((k) => k.includes("discordIntent"))).toBe(true);
    expect(h0.hintKeys.some((k) => k.includes("discordNoWebhook"))).toBe(true);

    const ready = inst("discord", {
      hasCredentials: true,
      enabled: true,
      options: {
        progress_style: "compact",
        thread_isolation: true,
      },
      acl: {
        allowFrom: "*",
        requireMention: true,
        groupOnly: false,
        shareSessionInChannel: false,
      },
    });
    const h1 = classifyChannelHealth({
      instance: ready,
      bridgeRunning: true,
      bridgeLinked: true,
    });
    expect(h1.credentialsReady).toBe(true);
    expect(h1.tone).toBe("connected");
    expect(h1.transport).toBe("gateway");
    expect(h1.modeLabel).toContain("thread_iso");
    expect(h1.hintKeys.some((k) => k.includes("discordGateway"))).toBe(true);
    expect(h1.hintKeys.some((k) => k.includes("discordIntent"))).toBe(true);
    expect(h1.hintKeys.some((k) => k.includes("discordThreadIso"))).toBe(true);
    expect(h1.openAcl).toBe(true);

    // Invalid form token shape → not ready
    const h2 = classifyChannelHealth({
      instance: bare,
      bridgeRunning: false,
      secretKeysFilled: new Set(["token"]),
      tokenValue: "not-a-token",
    });
    expect(h2.credentialsReady).toBe(false);
    expect(h2.hintKeys.some((k) => k.includes("discordTokenFormat"))).toBe(
      true,
    );
  });

  it("line: webhook deep health + public-URL honesty", () => {
    expect(channelHasDeepHealth("line")).toBe(true);
    expect(transportForChannel("line")).toBe("webhook");

    const bare = inst("line", { hasCredentials: false, enabled: false });
    const h0 = classifyChannelHealth({
      instance: bare,
      bridgeRunning: false,
    });
    expect(h0.tone).toBe("unconfigured");
    expect(h0.transport).toBe("webhook");
    // Schema defaults include port 8081 + /line/callback when instance is created
    expect(h0.modeLabel).toContain("mode=webhook");
    expect(h0.credentialsReady).toBe(false);
    expect(h0.hintKeys.some((k) => k.includes("lineWebhook"))).toBe(true);
    expect(h0.hintKeys.some((k) => k.includes("linePublicUrl"))).toBe(true);
    expect(h0.hintKeys.some((k) => k.includes("lineTunnel"))).toBe(true);
    expect(h0.hintKeys.some((k) => k.includes("lineNoLiveClaim"))).toBe(true);
    expect(h0.hintKeys.some((k) => k.includes("lineMissingKeys"))).toBe(true);

    const ready = inst("line", {
      hasCredentials: true,
      enabled: true,
      options: { port: 9443, callback_path: "/hooks/line" },
      acl: {
        allowFrom: "*",
        requireMention: true,
        groupOnly: false,
        shareSessionInChannel: false,
      },
    });
    const h1 = classifyChannelHealth({
      instance: ready,
      bridgeRunning: true,
      bridgeLinked: true,
    });
    expect(h1.credentialsReady).toBe(true);
    expect(h1.tone).toBe("connected");
    expect(h1.modeLabel).toContain("port=9443");
    expect(h1.modeLabel).toContain("path=custom");
    expect(h1.openAcl).toBe(true);
    // Never claims public callback live — only credential / tunnel hints
    expect(h1.hintKeys.some((k) => k.includes("lineNoLiveClaim"))).toBe(true);

    const rForm = credentialReadiness(
      "line",
      inst("line", { hasCredentials: false }),
      new Set(["channel_secret", "access_token"]),
    );
    expect(rForm.ready).toBe(true);
  });

  it("slack: socket_mode deep health with dual-token readiness", () => {
    expect(channelHasDeepHealth("slack")).toBe(true);
    expect(transportForChannel("slack")).toBe("socket_mode");
    expect(channelModeLabel("slack", {})).toBe("mode=socket");

    const bare = inst("slack", { hasCredentials: false, enabled: false });
    const h0 = classifyChannelHealth({
      instance: bare,
      bridgeRunning: false,
    });
    expect(h0.tone).toBe("unconfigured");
    expect(h0.transport).toBe("socket_mode");
    expect(h0.credentialsReady).toBe(false);
    expect(h0.hintKeys.some((k) => k.includes("slackSocketMode"))).toBe(true);
    expect(h0.hintKeys.some((k) => k.includes("slackNoPublicUrl"))).toBe(true);
    expect(h0.hintKeys.some((k) => k.includes("slackMissingTokens"))).toBe(
      true,
    );

    const ready = inst("slack", {
      hasCredentials: true,
      enabled: true,
      acl: {
        allowFrom: "*",
        requireMention: true,
        groupOnly: false,
        shareSessionInChannel: false,
      },
    });
    const h1 = classifyChannelHealth({
      instance: ready,
      bridgeRunning: true,
      bridgeLinked: true,
    });
    expect(h1.credentialsReady).toBe(true);
    expect(h1.tone).toBe("connected");
    expect(h1.modeLabel).toBe("mode=socket");
    expect(h1.hintKeys.some((k) => k.includes("slackDualToken"))).toBe(true);
    expect(h1.openAcl).toBe(true);
    expect(h1.hintKeys.some((k) => k.includes("slackAcl"))).toBe(true);

    // Only bot_token in form without vault → not ready
    const partial = credentialReadiness(
      "slack",
      bare,
      new Set(["bot_token"]),
    );
    expect(partial.ready).toBe(false);
    expect(partial.missingKeys).toContain("app_token");

    const both = credentialReadiness(
      "slack",
      bare,
      new Set(["bot_token", "app_token"]),
    );
    expect(both.ready).toBe(true);
  });

  it("qq: forward_ws deep health with community risk · never live without Bridge", () => {
    expect(channelHasDeepHealth("qq")).toBe(true);
    expect(transportForChannel("qq")).toBe("forward_ws");

    const bare = inst("qq", {
      hasCredentials: false,
      enabled: false,
      options: {},
    });
    const h0 = classifyChannelHealth({
      instance: bare,
      bridgeRunning: false,
    });
    expect(h0.tone).toBe("unconfigured");
    expect(h0.transport).toBe("forward_ws");
    expect(h0.credentialsReady).toBe(false);
    expect(h0.hintKeys.some((k) => k.includes("qqForwardWs"))).toBe(true);
    expect(h0.hintKeys.some((k) => k.includes("qqSelfHosted"))).toBe(true);
    expect(h0.hintKeys.some((k) => k.includes("qqCommunityRisk"))).toBe(true);
    expect(h0.hintKeys.some((k) => k.includes("qqMissingWsUrl"))).toBe(true);

    const ready = inst("qq", {
      hasCredentials: true,
      enabled: true,
      options: { ws_url: "ws://127.0.0.1:3001" },
      acl: {
        allowFrom: "*",
        requireMention: true,
        groupOnly: false,
        shareSessionInChannel: false,
      },
    });
    const h1 = classifyChannelHealth({
      instance: ready,
      bridgeRunning: true,
      bridgeLinked: true,
    });
    expect(h1.credentialsReady).toBe(true);
    expect(h1.tone).toBe("connected");
    expect(h1.transport).toBe("forward_ws");
    expect(h1.modeLabel).toContain("forward_ws");
    expect(h1.modeLabel).toContain("ws");
    expect(h1.hintKeys.some((k) => k.includes("qqForwardWs"))).toBe(true);
    expect(h1.hintKeys.some((k) => k.includes("qqCommunityRisk"))).toBe(true);
    expect(h1.hintKeys.some((k) => k.includes("qqTokenOptional"))).toBe(true);
    expect(h1.openAcl).toBe(true);

    // Invalid URL soft-fail — not ready; never claims WS live
    const bad = inst("qq", {
      hasCredentials: true,
      enabled: true,
      options: { ws_url: "http://127.0.0.1:3001" },
    });
    const h2 = classifyChannelHealth({
      instance: bad,
      bridgeRunning: true,
      bridgeLinked: false,
    });
    expect(h2.credentialsReady).toBe(false);
    expect(h2.tone).not.toBe("connected");
    expect(h2.hintKeys.some((k) => k.includes("qqWsUrlInvalid"))).toBe(true);
    expect(h2.hintKeys.some((k) => k.includes("qqHttpNotWs"))).toBe(true);

    // url alias + optional token in form
    const alias = inst("qq", {
      hasCredentials: false,
      options: { url: "wss://bridge.local/onebot" },
    });
    const r = credentialReadiness("qq", alias, new Set(["token"]));
    expect(r.ready).toBe(true);
    expect(r.missingKeys).not.toContain("token");
  });

  it("overseas: never connected without Bridge link", () => {
    for (const channel of [
      "telegram",
      "slack",
      "discord",
      "matrix",
      "line",
    ] as const) {
      const opts =
        channel === "matrix"
          ? { homeserver: "https://matrix.example.com" }
          : channel === "line"
            ? { port: 8081 }
            : {};
      const ready = inst(channel, {
        hasCredentials: true,
        enabled: true,
        options: opts,
      });
      const stopped = classifyChannelHealth({
        instance: ready,
        bridgeRunning: false,
        bridgeLinked: false,
      });
      expect(stopped.tone, channel).not.toBe("connected");
      expect(stopped.tone, channel).toBe("configured");

      const unlinked = classifyChannelHealth({
        instance: ready,
        bridgeRunning: true,
        bridgeLinked: false,
      });
      expect(unlinked.tone, channel).not.toBe("connected");
      expect(unlinked.tone, channel).toBe("configured");
      expect(unlinked.hintKeys.some((k) => k.includes("notLinked"))).toBe(
        true,
      );

      const live = classifyChannelHealth({
        instance: ready,
        bridgeRunning: true,
        bridgeLinked: true,
      });
      expect(live.tone, channel).toBe("connected");
    }
  });

  it("matrix: long-poll deep health with homeserver + ACL hints", () => {
    expect(channelHasDeepHealth("matrix")).toBe(true);
    const bare = inst("matrix", {
      hasCredentials: false,
      enabled: false,
      options: {},
    });
    const h0 = classifyChannelHealth({
      instance: bare,
      bridgeRunning: false,
    });
    expect(h0.tone).toBe("unconfigured");
    expect(h0.transport).toBe("long_poll");
    expect(h0.credentialsReady).toBe(false);
    expect(h0.hintKeys.some((k) => k.includes("matrixSync"))).toBe(true);
    expect(h0.hintKeys.some((k) => k.includes("matrixNoWebhook"))).toBe(true);
    expect(h0.hintKeys.some((k) => k.includes("matrixHomeserverNote"))).toBe(
      true,
    );

    const ready = inst("matrix", {
      hasCredentials: true,
      enabled: true,
      options: {
        homeserver: "https://matrix.example.com",
        auto_join: true,
      },
      acl: {
        allowFrom: "*",
        requireMention: true,
        groupOnly: false,
        shareSessionInChannel: false,
      },
    });
    const h1 = classifyChannelHealth({
      instance: ready,
      bridgeRunning: true,
      bridgeLinked: true,
    });
    expect(h1.credentialsReady).toBe(true);
    expect(h1.tone).toBe("connected");
    expect(h1.transport).toBe("long_poll");
    expect(h1.modeLabel).toContain("hs=matrix.example.com");
    expect(h1.hintKeys.some((k) => k.includes("matrixSync"))).toBe(true);
    expect(h1.hintKeys.some((k) => k.includes("matrixAutoJoin"))).toBe(true);
    expect(h1.openAcl).toBe(true);

    // Invalid form token shape → not ready
    const h2 = classifyChannelHealth({
      instance: inst("matrix", {
        hasCredentials: false,
        options: { homeserver: "https://matrix.example.com" },
      }),
      bridgeRunning: false,
      secretKeysFilled: new Set(["access_token"]),
      accessTokenValue: "short",
    });
    expect(h2.credentialsReady).toBe(false);
    expect(h2.hintKeys.some((k) => k.includes("matrixTokenFormat"))).toBe(
      true,
    );

    // Missing homeserver with vault token → not ready
    const h3 = classifyChannelHealth({
      instance: inst("matrix", {
        hasCredentials: true,
        options: {},
      }),
      bridgeRunning: false,
    });
    expect(h3.credentialsReady).toBe(false);
    expect(h3.missingKeys).toContain("homeserver");
  });

  it("weibo: websocket deep health with paste-first + endpoint hints", () => {
    expect(channelHasDeepHealth("weibo")).toBe(true);
    const bare = inst("weibo", {
      hasCredentials: false,
      enabled: false,
      options: {},
    });
    const h0 = classifyChannelHealth({
      instance: bare,
      bridgeRunning: false,
    });
    expect(h0.tone).toBe("unconfigured");
    expect(h0.transport).toBe("websocket");
    expect(h0.credentialsReady).toBe(false);
    expect(h0.hintKeys.some((k) => k.includes("weiboWs"))).toBe(true);
    expect(h0.hintKeys.some((k) => k.includes("weiboNoPublicUrl"))).toBe(true);
    expect(h0.hintKeys.some((k) => k.includes("weiboPasteFirst"))).toBe(true);
    expect(h0.hintKeys.some((k) => k.includes("weiboMissingKeys"))).toBe(true);

    const ready = inst("weibo", {
      hasCredentials: true,
      enabled: true,
      options: {
        app_id: "1234567890",
        token_endpoint: "https://api.weibo.com/oauth2/access_token",
        ws_endpoint: "wss://api.weibo.com/chat",
      },
      acl: {
        allowFrom: "*",
        requireMention: true,
        groupOnly: false,
        shareSessionInChannel: false,
      },
    });
    const h1 = classifyChannelHealth({
      instance: ready,
      bridgeRunning: true,
      bridgeLinked: true,
    });
    expect(h1.credentialsReady).toBe(true);
    expect(h1.tone).toBe("connected");
    expect(h1.transport).toBe("websocket");
    expect(h1.modeLabel).toContain("mode=ws");
    expect(h1.modeLabel).toContain("token=custom");
    expect(h1.modeLabel).toContain("ws=custom");
    expect(h1.hintKeys.some((k) => k.includes("weiboWs"))).toBe(true);
    expect(h1.hintKeys.some((k) => k.includes("weiboTokenEndpoint"))).toBe(
      true,
    );
    expect(h1.openAcl).toBe(true);

    // Invalid form app_id shape → not ready (never claims WS live)
    const h2 = classifyChannelHealth({
      instance: bare,
      bridgeRunning: false,
      secretKeysFilled: new Set(["app_secret"]),
      draftOptions: { app_id: "x" },
      appIdValue: "x",
    });
    expect(h2.credentialsReady).toBe(false);
    expect(h2.hintKeys.some((k) => k.includes("weiboAppIdFormat"))).toBe(true);

    // Bridge not linked → never "connected" even with credentials
    const h3 = classifyChannelHealth({
      instance: ready,
      bridgeRunning: true,
      bridgeLinked: false,
    });
    expect(h3.credentialsReady).toBe(true);
    expect(h3.tone).toBe("configured");
    expect(h3.tone).not.toBe("connected");
  });

  it("qqbot: official gateway deep health · default INTERACTION · never live without Bridge", () => {
    expect(channelHasDeepHealth("qqbot")).toBe(true);
    expect(transportForChannel("qqbot")).toBe("gateway");

    const bare = inst("qqbot", {
      hasCredentials: false,
      enabled: false,
      options: {},
    });
    const h0 = classifyChannelHealth({
      instance: bare,
      bridgeRunning: false,
    });
    expect(h0.tone).toBe("unconfigured");
    expect(h0.transport).toBe("gateway");
    expect(h0.credentialsReady).toBe(false);
    expect(h0.hintKeys.some((k) => k.includes("qqbotGateway"))).toBe(true);
    expect(h0.hintKeys.some((k) => k.includes("qqbotNoWebhook"))).toBe(true);
    expect(h0.hintKeys.some((k) => k.includes("qqbotNotOneBot"))).toBe(true);
    expect(h0.hintKeys.some((k) => k.includes("qqbotMissingAppId"))).toBe(
      true,
    );
    expect(h0.hintKeys.some((k) => k.includes("qqbotIntentsDefault"))).toBe(
      true,
    );

    const ready = inst("qqbot", {
      hasCredentials: true,
      enabled: true,
      options: { app_id: "102012345" },
      acl: {
        allowFrom: "*",
        requireMention: true,
        groupOnly: false,
        shareSessionInChannel: false,
      },
    });
    const h1 = classifyChannelHealth({
      instance: ready,
      bridgeRunning: true,
      bridgeLinked: true,
    });
    expect(h1.credentialsReady).toBe(true);
    expect(h1.tone).toBe("connected");
    expect(h1.transport).toBe("gateway");
    expect(h1.modeLabel).toContain("gateway");
    expect(h1.modeLabel).toContain("intents=default");
    expect(h1.hintKeys.some((k) => k.includes("qqbotGateway"))).toBe(true);
    expect(h1.hintKeys.some((k) => k.includes("qqbotIntentsDefault"))).toBe(
      true,
    );
    expect(h1.openAcl).toBe(true);

    // Invalid app_id soft-fail — not ready; never claims Gateway live
    const bad = inst("qqbot", {
      hasCredentials: true,
      enabled: true,
      options: { app_id: "x" },
    });
    const h2 = classifyChannelHealth({
      instance: bad,
      bridgeRunning: true,
      bridgeLinked: false,
    });
    expect(h2.credentialsReady).toBe(false);
    expect(h2.tone).not.toBe("connected");
    expect(h2.hintKeys.some((k) => k.includes("qqbotAppIdFormat"))).toBe(true);

    // Custom intents mode label + form secret readiness
    const custom = inst("qqbot", {
      hasCredentials: false,
      options: { app_id: "1020999", intents: "INTERACTION" },
    });
    const r = credentialReadiness("qqbot", custom, new Set(["app_secret"]));
    expect(r.ready).toBe(true);
    expect(r.missingKeys).not.toContain("app_secret");
    const h3 = classifyChannelHealth({
      instance: custom,
      bridgeRunning: false,
      secretKeysFilled: new Set(["app_secret"]),
      draftOptions: { intents: "INTERACTION" },
    });
    expect(h3.modeLabel).toContain("intents=custom");
    expect(h3.hintKeys.some((k) => k.includes("qqbotIntentsCustom"))).toBe(
      true,
    );
  });
});
