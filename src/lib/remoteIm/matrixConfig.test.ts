import { describe, expect, it } from "vitest";
import {
  isMatrixAccessTokenFormat,
  isMatrixHomeserverUrl,
  isMatrixProxyUrl,
  isMatrixUserIdFormat,
  matrixHealthHintKeys,
  matrixOptionalKeys,
  matrixProxyScheme,
  matrixRequiredNonSecretKeys,
  matrixRequiredSecretKeys,
  matrixSoftStatusMessage,
  normalizeMatrixHomeserver,
  validateMatrixConfig,
} from "./matrixConfig";

/** Synthetic token shape for format tests only (not a real secret). */
const SAMPLE_TOKEN = "syt_TEST_NOT_A_REAL_MATRIX_ACCESS_TOKEN_xx";

describe("isMatrixHomeserverUrl", () => {
  it("accepts http(s) with host", () => {
    expect(isMatrixHomeserverUrl("https://matrix.example.com")).toBe(true);
    expect(isMatrixHomeserverUrl("https://matrix.example.com/")).toBe(true);
    expect(isMatrixHomeserverUrl("http://127.0.0.1:8008")).toBe(true);
  });

  it("rejects empty, bare host, or bad schemes", () => {
    expect(isMatrixHomeserverUrl("")).toBe(false);
    expect(isMatrixHomeserverUrl("matrix.org")).toBe(false);
    expect(isMatrixHomeserverUrl("ftp://matrix.example.com")).toBe(false);
    expect(isMatrixHomeserverUrl("not-a-url")).toBe(false);
  });

  it("normalizes trailing slash", () => {
    expect(normalizeMatrixHomeserver("https://matrix.example.com/")).toBe(
      "https://matrix.example.com",
    );
  });
});

describe("isMatrixAccessTokenFormat", () => {
  it("accepts opaque tokens of sufficient length", () => {
    expect(isMatrixAccessTokenFormat(SAMPLE_TOKEN)).toBe(true);
    expect(
      isMatrixAccessTokenFormat("MDAx...legacy-style-token-long-enough"),
    ).toBe(true);
  });

  it("rejects empty, short, whitespace, or URL paste", () => {
    expect(isMatrixAccessTokenFormat("")).toBe(false);
    expect(isMatrixAccessTokenFormat("short")).toBe(false);
    expect(isMatrixAccessTokenFormat("has spaces not allowed")).toBe(false);
    expect(isMatrixAccessTokenFormat("https://matrix.example.com")).toBe(
      false,
    );
  });
});

describe("isMatrixUserIdFormat", () => {
  it("allows empty and valid MXIDs", () => {
    expect(isMatrixUserIdFormat("")).toBe(true);
    expect(isMatrixUserIdFormat("@bot:matrix.org")).toBe(true);
    expect(isMatrixUserIdFormat("@user.name:example.com")).toBe(true);
  });

  it("rejects non-MXID shapes", () => {
    expect(isMatrixUserIdFormat("bot:matrix.org")).toBe(false);
    expect(isMatrixUserIdFormat("@nodomain")).toBe(false);
    expect(isMatrixUserIdFormat("not-an-mxid")).toBe(false);
  });
});

describe("isMatrixProxyUrl / scheme", () => {
  it("allows empty and common schemes", () => {
    expect(isMatrixProxyUrl("")).toBe(true);
    expect(isMatrixProxyUrl("http://127.0.0.1:7890")).toBe(true);
    expect(isMatrixProxyUrl("socks5://127.0.0.1:1080")).toBe(true);
  });

  it("rejects bad schemes", () => {
    expect(isMatrixProxyUrl("ftp://x")).toBe(false);
    expect(isMatrixProxyUrl("not-a-url")).toBe(false);
  });

  it("detects scheme labels", () => {
    expect(matrixProxyScheme("socks5://x")).toBe("socks5");
    expect(matrixProxyScheme("")).toBeNull();
  });
});

describe("matrix required / optional keys", () => {
  it("requires homeserver + access_token", () => {
    expect([...matrixRequiredNonSecretKeys()]).toEqual(["homeserver"]);
    expect([...matrixRequiredSecretKeys()]).toEqual(["access_token"]);
    expect(matrixOptionalKeys()).toContain("user_id");
    expect(matrixOptionalKeys()).toContain("proxy");
    expect(matrixOptionalKeys()).toContain("auto_join");
  });
});

describe("validateMatrixConfig", () => {
  it("rejects empty form", () => {
    const r = validateMatrixConfig({
      options: {},
      hasCredentials: false,
    });
    expect(r.ok).toBe(false);
    expect(r.missing).toContain("homeserver");
    expect(r.missing).toContain("access_token");
    expect(r.softStatus).toBe("missing_credentials");
    expect(r.transport).toBe("long_poll");
    expect(matrixSoftStatusMessage(r)).toBe("missing_matrix_credentials");
  });

  it("accepts vault credentials with homeserver only", () => {
    const r = validateMatrixConfig({
      options: { homeserver: "https://matrix.example.com" },
      hasCredentials: true,
    });
    expect(r.ok).toBe(true);
    expect(r.softStatus).toBe("ready_long_poll");
    expect(r.homeserver).toBe("https://matrix.example.com");
    expect(r.autoJoin).toBe(true);
    expect(r.autoVerify).toBe(true);
    expect(matrixSoftStatusMessage(r)).toBe("matrix_sync_credentials_present");
  });

  it("accepts form token with valid shape + homeserver", () => {
    const r = validateMatrixConfig({
      options: {
        homeserver: "https://matrix.example.com/",
        user_id: "@bot:example.com",
        auto_join: false,
        group_reply_all: true,
      },
      secretKeysFilled: new Set(["access_token"]),
      accessTokenValue: SAMPLE_TOKEN,
    });
    expect(r.ok).toBe(true);
    expect(r.softStatus).toBe("ready_long_poll");
    expect(r.autoJoin).toBe(false);
    expect(r.groupReplyAll).toBe(true);
    expect(r.homeserver).toBe("https://matrix.example.com");
  });

  it("accepts token secret key alias", () => {
    const r = validateMatrixConfig({
      options: { homeserver: "https://matrix.example.com" },
      secretKeysFilled: new Set(["token"]),
      accessTokenValue: SAMPLE_TOKEN,
    });
    expect(r.ok).toBe(true);
  });

  it("soft-fails invalid homeserver", () => {
    const r = validateMatrixConfig({
      options: { homeserver: "matrix.org" },
      hasCredentials: true,
    });
    expect(r.ok).toBe(false);
    expect(r.softStatus).toBe("invalid_homeserver");
    expect(matrixSoftStatusMessage(r)).toBe("invalid_matrix_homeserver");
  });

  it("soft-fails invalid access token format when value is shown", () => {
    const r = validateMatrixConfig({
      options: { homeserver: "https://matrix.example.com" },
      secretKeysFilled: new Set(["access_token"]),
      accessTokenValue: "short",
    });
    expect(r.ok).toBe(false);
    expect(r.softStatus).toBe("invalid_access_token_format");
    expect(matrixSoftStatusMessage(r)).toBe(
      "invalid_matrix_access_token_format",
    );
  });

  it("soft-fails invalid user_id MXID", () => {
    const r = validateMatrixConfig({
      options: {
        homeserver: "https://matrix.example.com",
        user_id: "not-an-mxid",
      },
      hasCredentials: true,
    });
    expect(r.ok).toBe(false);
    expect(r.softStatus).toBe("invalid_user_id");
    expect(r.missing).toContain("user_id");
  });

  it("soft-fails invalid proxy URL", () => {
    const r = validateMatrixConfig({
      options: {
        homeserver: "https://matrix.example.com",
        proxy: "not-a-url",
      },
      hasCredentials: true,
    });
    expect(r.ok).toBe(false);
    expect(r.missing).toContain("proxy");
    expect(r.softStatus).toBe("invalid_proxy");
    expect(r.proxySet).toBe(true);
  });

  it("ready with valid proxy and notes scheme", () => {
    const r = validateMatrixConfig({
      options: {
        homeserver: "https://matrix.example.com",
        proxy: "socks5://127.0.0.1:1080",
      },
      hasCredentials: true,
    });
    expect(r.ok).toBe(true);
    expect(r.proxySet).toBe(true);
    expect(r.proxyScheme).toBe("socks5");
    expect(matrixSoftStatusMessage(r)).toBe(
      "matrix_sync_credentials_present_proxy",
    );
  });

  it("warns on http homeserver without blocking ready", () => {
    const r = validateMatrixConfig({
      options: { homeserver: "http://127.0.0.1:8008" },
      hasCredentials: true,
    });
    expect(r.ok).toBe(true);
    expect(r.warnings).toContain("homeserver_http");
  });

  it("missing homeserver when vault has token", () => {
    const r = validateMatrixConfig({
      options: {},
      hasCredentials: true,
    });
    expect(r.ok).toBe(false);
    expect(r.softStatus).toBe("missing_homeserver");
    expect(r.missing).toContain("homeserver");
  });
});

describe("matrixHealthHintKeys", () => {
  it("always includes sync + no-webhook", () => {
    const v = validateMatrixConfig({
      options: { homeserver: "https://matrix.example.com" },
      hasCredentials: true,
    });
    const hints = matrixHealthHintKeys(v);
    expect(hints.some((k) => k.includes("matrixSync"))).toBe(true);
    expect(hints.some((k) => k.includes("matrixNoWebhook"))).toBe(true);
    expect(hints.some((k) => k.includes("matrixHomeserverNote"))).toBe(true);
    expect(hints.some((k) => k.includes("matrixAutoJoin"))).toBe(true);
    // Ready shape never claims /sync live without Bridge
    expect(hints.some((k) => k.includes("matrixNoLiveClaim"))).toBe(true);
  });

  it("token format + open ACL + proxy hints", () => {
    const bad = validateMatrixConfig({
      options: {
        homeserver: "https://matrix.example.com",
        proxy: "socks5://127.0.0.1:1",
      },
      secretKeysFilled: new Set(["access_token"]),
      accessTokenValue: "bad",
    });
    const hints = matrixHealthHintKeys(bad, { openAcl: true });
    expect(hints.some((k) => k.includes("matrixTokenFormat"))).toBe(true);
    expect(hints.some((k) => k.includes("matrixAcl"))).toBe(true);
  });

  it("invalid homeserver + missing token hints", () => {
    const v = validateMatrixConfig({
      options: { homeserver: "nope" },
      hasCredentials: false,
    });
    const hints = matrixHealthHintKeys(v);
    expect(hints.some((k) => k.includes("matrixHomeserverInvalid"))).toBe(
      true,
    );
  });

  it("http homeserver warning hint", () => {
    const v = validateMatrixConfig({
      options: { homeserver: "http://localhost:8008" },
      hasCredentials: true,
    });
    const hints = matrixHealthHintKeys(v);
    expect(hints.some((k) => k.includes("matrixHomeserverHttp"))).toBe(true);
  });

  it("invalid proxy hint", () => {
    const v = validateMatrixConfig({
      options: {
        homeserver: "https://matrix.example.com",
        proxy: "garbage",
      },
      hasCredentials: true,
    });
    const hints = matrixHealthHintKeys(v);
    expect(hints.some((k) => k.includes("matrixProxyInvalid"))).toBe(true);
  });
});
