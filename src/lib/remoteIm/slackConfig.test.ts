import { describe, expect, it } from "vitest";
import {
  isSlackAppTokenFormat,
  isSlackBotTokenFormat,
  slackHealthHintKeys,
  slackRequiredNonSecretKeys,
  slackRequiredSecretKeys,
  slackSoftStatusMessage,
  validateSlackConfig,
} from "./slackConfig";

/** Synthetic fixtures — built so push-protection scanners do not treat them as live tokens. */
const SAMPLE_BOT = ["xoxb", "TEST", "not-a-real-token-xx"].join("-");
const SAMPLE_APP = ["xapp", "1", "TEST", "not-a-real-token-xx"].join("-");
const SAMPLE_BOT_UPPER = ["XOXB", "TEST", "NOTAREALTOKENXX"].join("-");

describe("isSlackBotTokenFormat", () => {
  it("accepts xoxb- bot tokens", () => {
    expect(isSlackBotTokenFormat(SAMPLE_BOT)).toBe(true);
    expect(isSlackBotTokenFormat(SAMPLE_BOT_UPPER)).toBe(true);
  });

  it("rejects empty, wrong prefix, or short bodies", () => {
    expect(isSlackBotTokenFormat("")).toBe(false);
    expect(isSlackBotTokenFormat(["xapp", "not", "a", "bot"].join("-"))).toBe(
      false,
    );
    expect(isSlackBotTokenFormat(["xoxb", "short"].join("-"))).toBe(false);
    expect(
      isSlackBotTokenFormat(
        "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw",
      ),
    ).toBe(false);
  });
});

describe("isSlackAppTokenFormat", () => {
  it("accepts xapp- app-level tokens", () => {
    expect(isSlackAppTokenFormat(SAMPLE_APP)).toBe(true);
  });

  it("rejects bot tokens and garbage", () => {
    expect(isSlackAppTokenFormat("")).toBe(false);
    expect(isSlackAppTokenFormat(SAMPLE_BOT)).toBe(false);
    expect(isSlackAppTokenFormat(["xapp", "short"].join("-"))).toBe(false);
    expect(isSlackAppTokenFormat("not-a-token")).toBe(false);
  });
});

describe("slack required keys", () => {
  it("dual secret tokens; no non-secret bind required", () => {
    expect([...slackRequiredNonSecretKeys()]).toEqual([]);
    expect([...slackRequiredSecretKeys()]).toEqual([
      "bot_token",
      "app_token",
    ]);
  });
});

describe("validateSlackConfig", () => {
  it("rejects empty form", () => {
    const r = validateSlackConfig({
      options: {},
      hasCredentials: false,
    });
    expect(r.ok).toBe(false);
    expect(r.transport).toBe("socket_mode");
    expect(r.needsPublicUrl).toBe(false);
    expect(r.missing).toContain("bot_token");
    expect(r.missing).toContain("app_token");
    expect(r.softStatus).toBe("missing_credentials");
    expect(slackSoftStatusMessage(r)).toBe("missing_slack_credentials");
  });

  it("accepts vault-only credentials without form tokens", () => {
    const r = validateSlackConfig({
      options: {},
      hasCredentials: true,
    });
    expect(r.ok).toBe(true);
    expect(r.softStatus).toBe("ready_socket_mode");
    expect(slackSoftStatusMessage(r)).toBe(
      "slack_socket_mode_credentials_present",
    );
  });

  it("accepts form dual tokens with valid shapes", () => {
    const r = validateSlackConfig({
      options: {},
      secretKeysFilled: new Set(["bot_token", "app_token"]),
      botTokenValue: SAMPLE_BOT,
      appTokenValue: SAMPLE_APP,
    });
    expect(r.ok).toBe(true);
    expect(r.softStatus).toBe("ready_socket_mode");
    expect(r.missing).toEqual([]);
  });

  it("accepts token / app_level_token aliases for key presence", () => {
    const r = validateSlackConfig({
      options: {},
      secretKeysFilled: new Set(["token", "app_level_token"]),
    });
    expect(r.ok).toBe(true);
    expect(r.softStatus).toBe("ready_socket_mode");
  });

  it("soft-fails invalid bot token format when value is shown", () => {
    const r = validateSlackConfig({
      options: {},
      secretKeysFilled: new Set(["bot_token", "app_token"]),
      botTokenValue: "not-a-bot-token",
      appTokenValue: SAMPLE_APP,
    });
    expect(r.ok).toBe(false);
    expect(r.softStatus).toBe("invalid_bot_token_format");
    expect(slackSoftStatusMessage(r)).toBe("invalid_slack_bot_token_format");
  });

  it("soft-fails invalid app token format when value is shown", () => {
    const r = validateSlackConfig({
      options: {},
      secretKeysFilled: new Set(["bot_token", "app_token"]),
      botTokenValue: SAMPLE_BOT,
      appTokenValue: ["xoxb", "wrong", "prefix", "here"].join("-"),
    });
    expect(r.ok).toBe(false);
    expect(r.softStatus).toBe("invalid_app_token_format");
    expect(slackSoftStatusMessage(r)).toBe("invalid_slack_app_token_format");
  });

  it("reports missing_bot_token when only app token present", () => {
    const r = validateSlackConfig({
      options: {},
      secretKeysFilled: new Set(["app_token"]),
    });
    expect(r.ok).toBe(false);
    expect(r.softStatus).toBe("missing_bot_token");
    expect(r.missing).toContain("bot_token");
    expect(slackSoftStatusMessage(r)).toBe("missing_slack_bot_token");
  });

  it("reports missing_app_token when only bot token present", () => {
    const r = validateSlackConfig({
      options: {},
      secretKeysFilled: new Set(["bot_token"]),
    });
    expect(r.ok).toBe(false);
    expect(r.softStatus).toBe("missing_app_token");
    expect(r.missing).toContain("app_token");
    expect(slackSoftStatusMessage(r)).toBe("missing_slack_app_token");
  });

  it("never claims public URL", () => {
    const r = validateSlackConfig({
      options: {},
      secretKeysFilled: new Set(["bot_token", "app_token"]),
    });
    expect(r.needsPublicUrl).toBe(false);
  });
});

describe("slackHealthHintKeys", () => {
  it("always includes socket mode + no public URL", () => {
    const v = validateSlackConfig({
      options: {},
      hasCredentials: true,
    });
    const hints = slackHealthHintKeys(v);
    expect(hints.some((k) => k.includes("slackSocketMode"))).toBe(true);
    expect(hints.some((k) => k.includes("slackNoPublicUrl"))).toBe(true);
    expect(hints.some((k) => k.includes("slackDualToken"))).toBe(true);
    // Ready dual tokens never claim Socket Mode live without Bridge
    expect(hints.some((k) => k.includes("slackNoLiveClaim"))).toBe(true);
  });

  it("missing tokens + open ACL + format hints", () => {
    const bare = validateSlackConfig({
      options: {},
      hasCredentials: false,
    });
    const bareHints = slackHealthHintKeys(bare, { openAcl: true });
    expect(bareHints.some((k) => k.includes("slackMissingTokens"))).toBe(true);
    expect(bareHints.some((k) => k.includes("slackAcl"))).toBe(true);

    const badBot = validateSlackConfig({
      options: {},
      secretKeysFilled: new Set(["bot_token", "app_token"]),
      botTokenValue: "bad",
      appTokenValue: SAMPLE_APP,
    });
    expect(
      slackHealthHintKeys(badBot).some((k) =>
        k.includes("slackBotTokenFormat"),
      ),
    ).toBe(true);

    const badApp = validateSlackConfig({
      options: {},
      secretKeysFilled: new Set(["bot_token", "app_token"]),
      botTokenValue: SAMPLE_BOT,
      appTokenValue: "bad",
    });
    expect(
      slackHealthHintKeys(badApp).some((k) =>
        k.includes("slackAppTokenFormat"),
      ),
    ).toBe(true);
  });
});
