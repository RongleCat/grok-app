import { describe, expect, it } from "vitest";
import {
  isTelegramBotTokenFormat,
  isTelegramProxyUrl,
  telegramHealthHintKeys,
  telegramProxyScheme,
  telegramSoftStatusMessage,
  validateTelegramConfig,
} from "./telegramConfig";

describe("isTelegramBotTokenFormat", () => {
  it("accepts BotFather-shaped tokens", () => {
    expect(
      isTelegramBotTokenFormat(
        "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw",
      ),
    ).toBe(true);
    expect(
      isTelegramBotTokenFormat(
        "bot7123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw",
      ),
    ).toBe(true);
  });

  it("rejects empty, short, or non-bot shapes", () => {
    expect(isTelegramBotTokenFormat("")).toBe(false);
    expect(isTelegramBotTokenFormat("not-a-token")).toBe(false);
    expect(isTelegramBotTokenFormat("123:short")).toBe(false);
    expect(isTelegramBotTokenFormat("xoxb-slack-token-long-enough-xx")).toBe(
      false,
    );
  });
});

describe("isTelegramProxyUrl / scheme", () => {
  it("allows empty and common schemes", () => {
    expect(isTelegramProxyUrl("")).toBe(true);
    expect(isTelegramProxyUrl("http://127.0.0.1:7890")).toBe(true);
    expect(isTelegramProxyUrl("https://proxy.example:8443")).toBe(true);
    expect(isTelegramProxyUrl("socks5://127.0.0.1:1080")).toBe(true);
    expect(isTelegramProxyUrl("socks5h://localhost:1080")).toBe(true);
  });

  it("rejects bad schemes / garbage", () => {
    expect(isTelegramProxyUrl("ftp://x")).toBe(false);
    expect(isTelegramProxyUrl("not-a-url")).toBe(false);
    expect(isTelegramProxyUrl("://nohost")).toBe(false);
  });

  it("detects scheme labels", () => {
    expect(telegramProxyScheme("socks5://x")).toBe("socks5");
    expect(telegramProxyScheme("HTTP://x")).toBe("http");
    expect(telegramProxyScheme("")).toBeNull();
  });
});

describe("validateTelegramConfig", () => {
  it("rejects empty form", () => {
    const r = validateTelegramConfig({
      options: {},
      hasCredentials: false,
    });
    expect(r.ok).toBe(false);
    expect(r.missing).toContain("token");
    expect(r.softStatus).toBe("missing_token");
    expect(r.transport).toBe("long_poll");
    expect(telegramSoftStatusMessage(r)).toBe("missing_telegram_token");
  });

  it("accepts vault-only credentials without form token", () => {
    const r = validateTelegramConfig({
      options: {},
      hasCredentials: true,
    });
    expect(r.ok).toBe(true);
    expect(r.softStatus).toBe("ready_long_poll");
    expect(telegramSoftStatusMessage(r)).toBe(
      "telegram_long_poll_credentials_present",
    );
  });

  it("accepts form token with valid shape", () => {
    const tok = "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw";
    const r = validateTelegramConfig({
      options: {},
      secretKeysFilled: new Set(["token"]),
      tokenValue: tok,
    });
    expect(r.ok).toBe(true);
    expect(r.softStatus).toBe("ready_long_poll");
  });

  it("soft-fails invalid token format when value is shown", () => {
    const r = validateTelegramConfig({
      options: {},
      secretKeysFilled: new Set(["token"]),
      tokenValue: "not-a-bot-token",
    });
    expect(r.ok).toBe(false);
    expect(r.softStatus).toBe("invalid_token_format");
    expect(telegramSoftStatusMessage(r)).toBe("invalid_telegram_token_format");
  });

  it("soft-fails invalid proxy URL", () => {
    const r = validateTelegramConfig({
      options: { proxy: "not-a-url" },
      hasCredentials: true,
    });
    expect(r.ok).toBe(false);
    expect(r.missing).toContain("proxy");
    expect(r.softStatus).toBe("invalid_proxy");
    expect(r.proxySet).toBe(true);
  });

  it("ready with valid proxy and notes scheme", () => {
    const r = validateTelegramConfig({
      options: { proxy: "socks5://127.0.0.1:1080" },
      hasCredentials: true,
    });
    expect(r.ok).toBe(true);
    expect(r.proxySet).toBe(true);
    expect(r.proxyScheme).toBe("socks5");
    expect(telegramSoftStatusMessage(r)).toBe(
      "telegram_long_poll_credentials_present_proxy",
    );
  });

  it("warns on partial proxy auth without blocking ready", () => {
    const r = validateTelegramConfig({
      options: {
        proxy: "http://127.0.0.1:7890",
        proxy_username: "u",
      },
      hasCredentials: true,
    });
    expect(r.ok).toBe(true);
    expect(r.warnings).toContain("proxy_auth_partial");
  });
});

describe("telegramHealthHintKeys", () => {
  it("always includes long-poll + no-webhook", () => {
    const v = validateTelegramConfig({
      options: {},
      hasCredentials: true,
    });
    const hints = telegramHealthHintKeys(v);
    expect(hints.some((k) => k.includes("telegramPoll"))).toBe(true);
    expect(hints.some((k) => k.includes("telegramNoWebhook"))).toBe(true);
    expect(hints.some((k) => k.includes("telegramProxy"))).toBe(false);
    // Ready credentials never claim getUpdates live without Bridge
    expect(hints.some((k) => k.includes("telegramNoLiveClaim"))).toBe(true);
  });

  it("proxy + open ACL + format hints", () => {
    const bad = validateTelegramConfig({
      options: { proxy: "socks5://127.0.0.1:1" },
      secretKeysFilled: new Set(["token"]),
      tokenValue: "bad",
    });
    const hints = telegramHealthHintKeys(bad, { openAcl: true });
    expect(hints.some((k) => k.includes("telegramTokenFormat"))).toBe(true);
    expect(hints.some((k) => k.includes("telegramAcl"))).toBe(true);
    // proxy is set but format fails first; proxy hint still when proxySet & valid
  });

  it("invalid proxy hint", () => {
    const v = validateTelegramConfig({
      options: { proxy: "garbage" },
      hasCredentials: true,
    });
    const hints = telegramHealthHintKeys(v);
    expect(hints.some((k) => k.includes("telegramProxyInvalid"))).toBe(true);
  });
});
