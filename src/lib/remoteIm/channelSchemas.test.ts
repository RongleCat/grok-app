import { describe, expect, it } from "vitest";
import {
  CHANNEL_SCHEMAS,
  REQUIRED_CHANNEL_IDS,
  RETIRED_CHANNEL_IDS,
  filterActiveChannels,
  getChannelSchema,
  isRetiredChannel,
  parseIdSecretPair,
  showsPublicUrlCallout,
  validateBindFields,
  visibleFields,
} from "./channelSchemas";

describe("remoteIm channelSchemas", () => {
  it("includes every required sidebar channel id", () => {
    const ids = new Set(CHANNEL_SCHEMAS.map((c) => c.id));
    for (const id of REQUIRED_CHANNEL_IDS) {
      expect(ids.has(id), `missing channel ${id}`).toBe(true);
    }
  });

  it("excludes retired WPS channels from REQUIRED_CHANNEL_IDS", () => {
    for (const id of RETIRED_CHANNEL_IDS) {
      expect(REQUIRED_CHANNEL_IDS).not.toContain(id);
    }
    expect(isRetiredChannel("wps-xiezuo")).toBe(true);
    expect(isRetiredChannel("wps-agentspace")).toBe(true);
    expect(isRetiredChannel("feishu")).toBe(false);
    expect(isRetiredChannel(getChannelSchema("wps-xiezuo"))).toBe(true);
    expect(isRetiredChannel(null)).toBe(false);
  });

  it("marks WPS schemas retired/unsupported and not bindable", () => {
    for (const id of RETIRED_CHANNEL_IDS) {
      const s = getChannelSchema(id)!;
      expect(s.retired).toBe(true);
      expect(s.unsupported).toBe(true);
      expect(s.implemented).toBe(false);
      expect(validateBindFields(s, { app_id: "x", app_secret: "y" }).ok).toBe(
        false,
      );
      expect(validateBindFields(s, { app_id: "x", app_secret: "y" }).missing).toContain(
        "_retired",
      );
    }
  });

  it("filterActiveChannels hides retired unless legacy instances exist", () => {
    const active = filterActiveChannels();
    expect(active.some((c) => c.id === "wps-xiezuo")).toBe(false);
    expect(active.some((c) => c.id === "wps-agentspace")).toBe(false);
    expect(active.some((c) => c.id === "feishu")).toBe(true);
    expect(active.every((c) => !isRetiredChannel(c))).toBe(true);

    const withLegacy = filterActiveChannels(CHANNEL_SCHEMAS, {
      includeRetiredWithInstances: true,
      instances: [{ channel: "wps-xiezuo" }],
    });
    expect(withLegacy.some((c) => c.id === "wps-xiezuo")).toBe(true);
    expect(withLegacy.some((c) => c.id === "wps-agentspace")).toBe(false);
  });

  it("orders domestic then overseas then other groups", () => {
    const groups = CHANNEL_SCHEMAS.map((c) => c.group);
    const firstOverseas = groups.indexOf("overseas");
    const firstOther = groups.indexOf("other");
    const lastDomestic = groups.lastIndexOf("domestic");
    expect(lastDomestic).toBeLessThan(firstOverseas);
    expect(firstOverseas).toBeLessThan(firstOther);
  });

  it("feishu has §6.1 bind fields app_id and app_secret as password", () => {
    const feishu = getChannelSchema("feishu");
    expect(feishu?.implemented).toBe(true);
    expect(feishu?.scanSupport).toBe(true);
    const secret = feishu?.fields.find((f) => f.key === "app_secret");
    expect(secret?.control).toBe("password");
    expect(secret?.secret).toBe(true);
    expect(feishu?.fields.some((f) => f.key === "app_id")).toBe(true);
    expect(feishu?.fields.some((f) => f.key === "enable_feishu_card")).toBe(
      true,
    );
  });

  it("wecom switches fields by connect_mode", () => {
    const wecom = getChannelSchema("wecom")!;
    const ws = visibleFields(wecom, { connect_mode: "websocket" }, "bind");
    expect(ws.some((f) => f.key === "bot_id")).toBe(true);
    expect(ws.some((f) => f.key === "corp_id")).toBe(false);
    const wh = visibleFields(wecom, { connect_mode: "webhook" }, "bind");
    expect(wh.some((f) => f.key === "corp_id")).toBe(true);
    expect(wh.some((f) => f.key === "bot_id")).toBe(false);
  });

  it("wecom public-URL callout only in webhook mode (§6.8)", () => {
    const wecom = getChannelSchema("wecom")!;
    expect(wecom.needsPublicUrl).toBe(true);
    expect(
      showsPublicUrlCallout(wecom, { connect_mode: "websocket" }),
    ).toBe(false);
    expect(
      showsPublicUrlCallout(wecom, { connect_mode: "webhook" }),
    ).toBe(true);
  });

  it("wecom validateBindFields is mode-aware and honest on mode switch", () => {
    const wecom = getChannelSchema("wecom")!;
    expect(
      validateBindFields(wecom, {
        connect_mode: "websocket",
        bot_id: "b1",
        bot_secret: "s1",
      }).ok,
    ).toBe(true);
    expect(
      validateBindFields(wecom, {
        connect_mode: "webhook",
        corp_id: "ww",
        agent_id: "1",
        corp_secret: "cs",
        callback_token: "ct",
      }).ok,
    ).toBe(true);

    // Incomplete webhook
    expect(
      validateBindFields(wecom, {
        connect_mode: "webhook",
        corp_id: "ww",
      }).ok,
    ).toBe(false);

    // Vault reuse only for secrets that were already visible under saved mode
    const switched = validateBindFields(
      wecom,
      {
        connect_mode: "webhook",
        corp_id: "ww",
        agent_id: "1",
      },
      {
        hasCredentials: true,
        savedValues: { connect_mode: "websocket", bot_id: "b" },
      },
    );
    expect(switched.ok).toBe(false);
    expect(switched.missing).toContain("corp_secret");
    expect(switched.missing).toContain("callback_token");

    const sameMode = validateBindFields(
      wecom,
      {
        connect_mode: "websocket",
        bot_id: "b1",
      },
      {
        hasCredentials: true,
        savedValues: { connect_mode: "websocket", bot_id: "b1" },
      },
    );
    expect(sameMode.ok).toBe(true);
  });

  it("wecom schema documents mode help + §6.8 fields", () => {
    const wecom = getChannelSchema("wecom")!;
    expect(wecom.implemented).toBe(true);
    expect(wecom.scanSupport).toBe(false);
    expect(wecom.pasteSupport).toBe(true);
    const mode = wecom.fields.find((f) => f.key === "connect_mode");
    expect(mode?.helpKey).toBe("settings.remoteIm.wecom.modeHelp");
    expect(wecom.fields.some((f) => f.key === "encoding_aes_key")).toBe(true);
    expect(wecom.fields.some((f) => f.key === "enable_markdown")).toBe(true);
  });

  it("dingtalk schema is paste-first Stream §6.2", () => {
    const ding = getChannelSchema("dingtalk")!;
    expect(ding.implemented).toBe(true);
    expect(ding.scanSupport).toBe(false);
    expect(ding.pasteSupport).toBe(true);
    expect(ding.connectionKey).toContain("stream");
    expect(ding.fields.some((f) => f.key === "client_id" && f.required)).toBe(
      true,
    );
    expect(
      ding.fields.some((f) => f.key === "client_secret" && f.secret),
    ).toBe(true);
    expect(ding.fields.some((f) => f.key === "enable_ai_card")).toBe(true);
  });

  it("weixin schema is scan+paste long-poll §6.9 with field help", () => {
    const wx = getChannelSchema("weixin")!;
    expect(wx.implemented).toBe(true);
    expect(wx.scanSupport).toBe(true);
    expect(wx.pasteSupport).toBe(true);
    const token = wx.fields.find((f) => f.key === "token");
    expect(token?.secret).toBe(true);
    expect(token?.helpKey).toBe("settings.remoteIm.weixin.tokenHelp");
    expect(wx.fields.some((f) => f.key === "long_poll_timeout_ms")).toBe(true);
    expect(wx.fields.some((f) => f.key === "chat_id")).toBe(true);
  });

  it("soft-retired WPS channels stay non-implemented", () => {
    expect(getChannelSchema("wps-xiezuo")?.implemented).toBe(false);
    expect(getChannelSchema("wps-agentspace")?.implemented).toBe(false);
  });

  it("LINE always shows public-URL callout when flagged", () => {
    const line = getChannelSchema("line")!;
    expect(showsPublicUrlCallout(line, {})).toBe(true);
  });

  it("feishu never shows public-URL callout", () => {
    const feishu = getChannelSchema("feishu")!;
    expect(showsPublicUrlCallout(feishu, {})).toBe(false);
  });

  it("rejects credential submit when schema not implemented", () => {
    const fake = {
      ...getChannelSchema("line")!,
      implemented: false,
    };
    const r = validateBindFields(fake, {
      channel_secret: "x",
      channel_access_token: "y",
    });
    expect(r.ok).toBe(false);
    expect(r.missing).toContain("_not_implemented");
  });

  it("validates required feishu bind fields", () => {
    const feishu = getChannelSchema("feishu")!;
    expect(validateBindFields(feishu, {}).ok).toBe(false);
    expect(
      validateBindFields(feishu, {
        app_id: "cli_x",
        app_secret: "sec",
        domain: "open.feishu.cn",
      }).ok,
    ).toBe(true);
  });

  it("parses cli_id:secret paste pairs", () => {
    expect(parseIdSecretPair("cli_abc:s3cret")).toEqual({
      app_id: "cli_abc",
      app_secret: "s3cret",
    });
    expect(parseIdSecretPair("nope")).toBeNull();
  });

  it("marks secret fields with password control for implemented channels", () => {
    for (const schema of CHANNEL_SCHEMAS.filter((c) => c.implemented)) {
      for (const f of schema.fields) {
        if (f.secret) {
          expect(f.control, `${schema.id}.${f.key}`).toBe("password");
        }
      }
    }
  });

  it("overseas §6 schemas wire help + placeholders and transport honesty", () => {
    const tg = getChannelSchema("telegram")!;
    expect(tg.group).toBe("overseas");
    expect(tg.implemented).toBe(true);
    expect(tg.connectionKey).toContain("longPoll");
    expect(showsPublicUrlCallout(tg, {})).toBe(false);
    const token = tg.fields.find((f) => f.key === "token")!;
    expect(token.helpKey).toBe("settings.remoteIm.telegram.tokenHelp");
    expect(token.placeholderKey).toBe(
      "settings.remoteIm.telegram.tokenPlaceholder",
    );
    expect(tg.fields.some((f) => f.key === "proxy")).toBe(true);
    expect(tg.fields.some((f) => f.key === "proxy_username")).toBe(true);
    expect(tg.fields.some((f) => f.key === "thread_isolation")).toBe(true);
    expect(
      validateBindFields(tg, { token: "12345:AAAAAAAAAAAAAAAAAAAA" }).ok,
    ).toBe(true);

    const slack = getChannelSchema("slack")!;
    expect(slack.connectionKey).toContain("socketMode");
    expect(showsPublicUrlCallout(slack, {})).toBe(false);
    expect(slack.fields.find((f) => f.key === "bot_token")?.helpKey).toBe(
      "settings.remoteIm.slack.botTokenHelp",
    );
    expect(slack.fields.find((f) => f.key === "app_token")?.placeholderKey).toBe(
      "settings.remoteIm.slack.appTokenPlaceholder",
    );
    expect(
      validateBindFields(slack, {
        bot_token: "xoxb-test",
        app_token: "xapp-test",
      }).ok,
    ).toBe(true);
    expect(validateBindFields(slack, { bot_token: "xoxb-only" }).ok).toBe(
      false,
    );

    const discord = getChannelSchema("discord")!;
    expect(discord.connectionKey).toContain("gateway");
    expect(discord.fields.find((f) => f.key === "token")?.helpKey).toBe(
      "settings.remoteIm.discord.tokenHelp",
    );
    expect(
      discord.fields.find((f) => f.key === "thread_isolation")?.helpKey,
    ).toBe("settings.remoteIm.discord.threadHelp");
    expect(
      validateBindFields(discord, { token: "a.b.c" }).ok,
    ).toBe(true);

    const matrix = getChannelSchema("matrix")!;
    expect(matrix.connectionKey).toContain("longPoll");
    expect(showsPublicUrlCallout(matrix, {})).toBe(false);
    expect(matrix.fields.find((f) => f.key === "homeserver")?.helpKey).toBe(
      "settings.remoteIm.matrix.homeserverHelp",
    );
    expect(matrix.fields.find((f) => f.key === "access_token")?.secret).toBe(
      true,
    );
    expect(matrix.fields.find((f) => f.key === "auto_join")?.defaultValue).toBe(
      true,
    );
    expect(
      validateBindFields(matrix, {
        homeserver: "https://matrix.example.com",
        access_token: "syt_xxx",
      }).ok,
    ).toBe(true);
    expect(
      validateBindFields(matrix, { access_token: "syt_xxx" }).missing,
    ).toContain("homeserver");

    const line = getChannelSchema("line")!;
    expect(line.needsPublicUrl).toBe(true);
    expect(line.fields.find((f) => f.key === "channel_secret")?.helpKey).toBe(
      "settings.remoteIm.line.channelSecretHelp",
    );
    expect(
      line.fields.find((f) => f.key === "channel_access_token")?.placeholderKey,
    ).toBe("settings.remoteIm.line.accessTokenPlaceholder");
  });
});
