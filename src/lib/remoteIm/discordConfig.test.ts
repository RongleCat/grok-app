import { describe, expect, it } from "vitest";
import {
  discordHealthHintKeys,
  discordOptionalKeys,
  discordRequiredSecretKeys,
  discordSoftStatusMessage,
  isDiscordBotTokenFormat,
  normalizeDiscordProgressStyle,
  validateDiscordConfig,
} from "./discordConfig";

/** Synthetic three-segment shape for format tests only (not a real secret). */
const SAMPLE_TOKEN =
  "TESTTOKEN_NOT_A_SECRET_xx.TEST.TESTTOKEN_NOT_A_SECRET_TAIL_xx";

describe("isDiscordBotTokenFormat", () => {
  it("accepts three-segment bot tokens", () => {
    expect(isDiscordBotTokenFormat(SAMPLE_TOKEN)).toBe(true);
    expect(isDiscordBotTokenFormat(`Bot ${SAMPLE_TOKEN}`)).toBe(true);
  });

  it("rejects empty, short, or non-discord shapes", () => {
    expect(isDiscordBotTokenFormat("")).toBe(false);
    expect(isDiscordBotTokenFormat("not-a-token")).toBe(false);
    expect(isDiscordBotTokenFormat("only.two")).toBe(false);
    expect(
      isDiscordBotTokenFormat(
        "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw",
      ),
    ).toBe(false);
    expect(isDiscordBotTokenFormat("a.b.c")).toBe(false);
  });
});

describe("normalizeDiscordProgressStyle", () => {
  it("defaults to compact", () => {
    expect(normalizeDiscordProgressStyle({})).toBe("compact");
    expect(normalizeDiscordProgressStyle(null)).toBe("compact");
    expect(normalizeDiscordProgressStyle({ progress_style: "weird" })).toBe(
      "compact",
    );
  });

  it("accepts legacy / compact / card", () => {
    expect(
      normalizeDiscordProgressStyle({ progress_style: "legacy" }),
    ).toBe("legacy");
    expect(normalizeDiscordProgressStyle({ progress_style: "CARD" })).toBe(
      "card",
    );
  });
});

describe("discord required / optional keys", () => {
  it("requires token only", () => {
    expect([...discordRequiredSecretKeys()]).toEqual(["token"]);
    expect(discordOptionalKeys()).toContain("allow_from");
    expect(discordOptionalKeys()).toContain("thread_isolation");
    expect(discordOptionalKeys()).toContain("progress_style");
  });
});

describe("validateDiscordConfig", () => {
  it("rejects empty form", () => {
    const r = validateDiscordConfig({
      options: {},
      hasCredentials: false,
    });
    expect(r.ok).toBe(false);
    expect(r.missing).toContain("token");
    expect(r.softStatus).toBe("missing_token");
    expect(r.transport).toBe("gateway");
    expect(r.progressStyle).toBe("compact");
    expect(r.threadIsolation).toBe(false);
    expect(discordSoftStatusMessage(r)).toBe("missing_discord_token");
  });

  it("accepts vault-only credentials without form token", () => {
    const r = validateDiscordConfig({
      options: {},
      hasCredentials: true,
    });
    expect(r.ok).toBe(true);
    expect(r.softStatus).toBe("ready_gateway");
    expect(discordSoftStatusMessage(r)).toBe(
      "discord_gateway_credentials_present",
    );
  });

  it("accepts form token with valid shape", () => {
    const r = validateDiscordConfig({
      options: {
        allow_from: "123",
        thread_isolation: true,
        progress_style: "card",
      },
      secretKeysFilled: new Set(["token"]),
      tokenValue: SAMPLE_TOKEN,
    });
    expect(r.ok).toBe(true);
    expect(r.softStatus).toBe("ready_gateway");
    expect(r.threadIsolation).toBe(true);
    expect(r.progressStyle).toBe("card");
  });

  it("accepts bot_token secret key alias", () => {
    const r = validateDiscordConfig({
      options: {},
      secretKeysFilled: new Set(["bot_token"]),
      tokenValue: SAMPLE_TOKEN,
    });
    expect(r.ok).toBe(true);
  });

  it("soft-fails invalid token format when value is shown", () => {
    const r = validateDiscordConfig({
      options: {},
      secretKeysFilled: new Set(["token"]),
      tokenValue: "not-a-bot-token",
    });
    expect(r.ok).toBe(false);
    expect(r.softStatus).toBe("invalid_token_format");
    expect(discordSoftStatusMessage(r)).toBe("invalid_discord_token_format");
  });

  it("normalizes junk progress_style with soft warning", () => {
    const r = validateDiscordConfig({
      options: { progress_style: "sparkle" },
      hasCredentials: true,
    });
    expect(r.ok).toBe(true);
    expect(r.progressStyle).toBe("compact");
    expect(r.warnings).toContain("progress_style_normalized");
  });
});

describe("discordHealthHintKeys", () => {
  it("always includes gateway + no-webhook + intent", () => {
    const v = validateDiscordConfig({
      options: {},
      hasCredentials: true,
    });
    const hints = discordHealthHintKeys(v);
    expect(hints.some((k) => k.includes("discordGateway"))).toBe(true);
    expect(hints.some((k) => k.includes("discordNoWebhook"))).toBe(true);
    expect(hints.some((k) => k.includes("discordIntent"))).toBe(true);
    // Ready token never claims Gateway live without Bridge
    expect(hints.some((k) => k.includes("discordNoLiveClaim"))).toBe(true);
  });

  it("token format + open ACL + thread isolation hints", () => {
    const bad = validateDiscordConfig({
      options: { thread_isolation: true, allow_from: "*" },
      secretKeysFilled: new Set(["token"]),
      tokenValue: "bad",
    });
    const hints = discordHealthHintKeys(bad, { openAcl: true });
    expect(hints.some((k) => k.includes("discordTokenFormat"))).toBe(true);
    expect(hints.some((k) => k.includes("discordAcl"))).toBe(true);
    expect(hints.some((k) => k.includes("discordThreadIso"))).toBe(true);
  });

  it("missing token hint", () => {
    const v = validateDiscordConfig({
      options: {},
      hasCredentials: false,
    });
    const hints = discordHealthHintKeys(v);
    expect(hints.some((k) => k.includes("discordMissingToken"))).toBe(true);
  });
});
