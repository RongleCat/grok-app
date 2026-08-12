import { describe, expect, it } from "vitest";
import {
  canAttemptRestart,
  checkInboundRateLimit,
  classifyChannelsEmptyState,
  classifyRecoveryStatus,
  classifyRimError,
  classifyTimelineEmptyState,
  createTokenBucket,
  defaultChatRateConfig,
  displayBridgeLastError,
  nextRetryAfterFailureSecs,
  planBridgeReconnectAction,
  rateLimitPolicyFacts,
  reconnectBackoffSecs,
  refillTokenBucket,
  RIM_BACKOFF_CAP_SECS,
  rimErrorKindKey,
  rimRecoveryPhaseKey,
  sanitizeRecoveryNote,
  secondsUntilRetry,
  shouldShowResilienceHonestyNotes,
  tryConsumeToken,
} from "./resilience";

describe("reconnectBackoffSecs", () => {
  it("is zero for first attempt", () => {
    expect(reconnectBackoffSecs(0)).toBe(0);
    expect(reconnectBackoffSecs(-1)).toBe(0);
  });

  it("doubles then caps at 60s", () => {
    expect(reconnectBackoffSecs(1)).toBe(2);
    expect(reconnectBackoffSecs(2)).toBe(4);
    expect(reconnectBackoffSecs(3)).toBe(8);
    expect(reconnectBackoffSecs(4)).toBe(16);
    expect(reconnectBackoffSecs(5)).toBe(32);
    expect(reconnectBackoffSecs(6)).toBe(RIM_BACKOFF_CAP_SECS); // 2^6=64 → 60
    expect(reconnectBackoffSecs(20)).toBe(RIM_BACKOFF_CAP_SECS);
  });

  it("floors fractional attempts", () => {
    expect(reconnectBackoffSecs(1.9)).toBe(2);
  });
});

describe("nextRetryAfterFailureSecs / schedule helpers", () => {
  it("schedules 2s after first failure", () => {
    expect(nextRetryAfterFailureSecs(0)).toBe(2);
    expect(nextRetryAfterFailureSecs(1)).toBe(4);
  });

  it("canAttemptRestart respects deadline", () => {
    expect(canAttemptRestart(100, null)).toBe(true);
    expect(canAttemptRestart(100, 0)).toBe(true);
    expect(canAttemptRestart(100, 100)).toBe(true);
    expect(canAttemptRestart(99, 100)).toBe(false);
    expect(canAttemptRestart(150, 100)).toBe(true);
  });

  it("secondsUntilRetry is non-negative", () => {
    expect(secondsUntilRetry(100, 130)).toBe(30);
    expect(secondsUntilRetry(130, 100)).toBe(0);
    expect(secondsUntilRetry(100, null)).toBe(0);
  });
});

describe("classifyRimError", () => {
  it("detects rate limits honestly", () => {
    expect(classifyRimError("HTTP 429 Too Many Requests")).toBe("rate_limit");
    expect(classifyRimError("quota exceeded")).toBe("rate_limit");
    expect(classifyRimError("usage limit hit")).toBe("rate_limit");
    expect(classifyRimError("rate_limit from API")).toBe("rate_limit");
  });

  it("detects auth / config / crash / network", () => {
    expect(classifyRimError("401 unauthorized")).toBe("auth");
    expect(classifyRimError("no enabled channel with credentials")).toBe("config");
    expect(classifyRimError("bridge connectors exited unexpectedly")).toBe("crash");
    expect(classifyRimError("ws connect: connection refused")).toBe("network");
  });

  it("unknown for empty / junk", () => {
    expect(classifyRimError("")).toBe("unknown");
    expect(classifyRimError(null)).toBe("unknown");
    expect(classifyRimError("something else failed")).toBe("unknown");
  });

  it("builds i18n keys", () => {
    expect(rimErrorKindKey("rate_limit")).toBe(
      "settings.remoteIm.resilience.errorKind.rate_limit",
    );
    expect(rimRecoveryPhaseKey("backing_off")).toBe(
      "settings.remoteIm.resilience.phase.backing_off",
    );
  });
});

describe("token bucket rate limit", () => {
  it("allows up to capacity then denies", () => {
    const cfg = defaultChatRateConfig();
    let st = createTokenBucket(cfg, 0);
    for (let i = 0; i < cfg.capacity; i++) {
      const r = tryConsumeToken(st, cfg, 0);
      expect(r.ok).toBe(true);
      st = r.state;
    }
    const denied = tryConsumeToken(st, cfg, 0);
    expect(denied.ok).toBe(false);
    expect(denied.retryAfterSecs).toBeGreaterThan(0);
  });

  it("refills over the window", () => {
    const cfg = { capacity: 2, refillAmount: 2, windowMs: 1000 };
    let st = createTokenBucket(cfg, 0);
    st = tryConsumeToken(st, cfg, 0).state;
    st = tryConsumeToken(st, cfg, 0).state;
    expect(tryConsumeToken(st, cfg, 0).ok).toBe(false);
    // Full window later
    const after = refillTokenBucket(st, cfg, 1000);
    expect(after.tokens).toBeCloseTo(2, 5);
    expect(tryConsumeToken(after, cfg, 1000).ok).toBe(true);
  });

  it("checkInboundRateLimit applies global then chat", () => {
    const chatCfg = { capacity: 1, refillAmount: 1, windowMs: 60_000 };
    const globalCfg = { capacity: 1, refillAmount: 1, windowMs: 60_000 };
    let chat = createTokenBucket(chatCfg, 0);
    let global = createTokenBucket(globalCfg, 0);

    const a = checkInboundRateLimit({ chat, global, nowMs: 0, chatCfg, globalCfg });
    expect(a.ok).toBe(true);
    chat = a.chat;
    global = a.global;

    const b = checkInboundRateLimit({ chat, global, nowMs: 0, chatCfg, globalCfg });
    expect(b.ok).toBe(false);
    expect(b.limitedBy).toBeTruthy();
  });
});

describe("classifyRecoveryStatus", () => {
  it("hides card while listening", () => {
    const s = classifyRecoveryStatus({
      state: "listening",
      enabled: true,
      restartAttempt: 0,
    });
    expect(s.phase).toBe("listening");
    expect(s.showCard).toBe(false);
    expect(s.severity).toBe("ok");
  });

  it("surfaces backing_off with retry meta", () => {
    const s = classifyRecoveryStatus({
      state: "degraded",
      enabled: true,
      restartAttempt: 3,
      nextRetrySecs: 12,
      lastError: "bridge connectors exited unexpectedly",
    });
    expect(s.phase).toBe("backing_off");
    expect(s.showCard).toBe(true);
    expect(s.showRetryMeta).toBe(true);
    expect(s.nextRetrySecs).toBe(12);
    expect(s.errorKind).toBe("crash");
  });

  it("is honest about rate limits", () => {
    const s = classifyRecoveryStatus({
      state: "error",
      enabled: true,
      rateLimited: true,
      lastError: "HTTP 429",
    });
    expect(s.phase).toBe("rate_limited");
    expect(s.showCard).toBe(true);
    expect(s.bodyKey).toContain("rateLimited");
  });

  it("treats enabled+stopped as degraded recovery path", () => {
    const s = classifyRecoveryStatus({
      state: "stopped",
      enabled: true,
      restartAttempt: 1,
      nextRetrySecs: 4,
    });
    expect(s.phase).toBe("backing_off");
    expect(s.showCard).toBe(true);
  });

  it("error phase when state=error without rate limit", () => {
    const s = classifyRecoveryStatus({
      state: "error",
      enabled: true,
      lastError: "spawn grok failed: not found",
    });
    expect(s.phase).toBe("error");
    expect(s.severity).toBe("err");
  });
});

describe("sanitizeRecoveryNote", () => {
  it("drops secrets and urls", () => {
    expect(sanitizeRecoveryNote("retry ok")).toBe("retry ok");
    expect(sanitizeRecoveryNote("see https://x.com")).toBeUndefined();
    expect(sanitizeRecoveryNote("app_secret: abc")).toBeUndefined();
  });
});

describe("displayBridgeLastError", () => {
  it("keeps safe notes and redacts secrets", () => {
    expect(displayBridgeLastError("connectors exited").text).toBe(
      "connectors exited",
    );
    const red = displayBridgeLastError("app_secret: xyz", "auth");
    expect(red.redacted).toBe(true);
    expect(red.text).toBe("settings.remoteIm.resilience.errorKind.auth");
  });
});

describe("planBridgeReconnectAction", () => {
  it("shows reconnect during recovery", () => {
    const a = planBridgeReconnectAction({
      recovery: { showCard: true, phase: "backing_off" },
      busy: null,
      state: "degraded",
    });
    expect(a.show).toBe(true);
    expect(a.disabled).toBe(false);
    expect(a.labelKey).toContain("reconnect");
  });

  it("disables while busy or starting", () => {
    expect(
      planBridgeReconnectAction({
        recovery: { showCard: true, phase: "error" },
        busy: "restart",
        state: "error",
      }).disabled,
    ).toBe(true);
    expect(
      planBridgeReconnectAction({
        recovery: { showCard: true, phase: "restarting" },
        busy: null,
        state: "starting",
      }).disabled,
    ).toBe(true);
  });

  it("hides when not in recovery card", () => {
    expect(
      planBridgeReconnectAction({
        recovery: { showCard: false, phase: "listening" },
      }).show,
    ).toBe(false);
  });
});

describe("classifyChannelsEmptyState / timeline empty", () => {
  it("soft-fails channels list while recovering", () => {
    const e = classifyChannelsEmptyState({
      connectedCount: 0,
      configuredCount: 2,
      recovery: { phase: "backing_off", showCard: true },
    });
    expect(e?.softFail).toBe(true);
    expect(e?.kind).toBe("recovering");
    expect(e?.messageKey).toContain("channelsRecovering");
  });

  it("none_configured when nothing bound", () => {
    const e = classifyChannelsEmptyState({
      connectedCount: 0,
      configuredCount: 0,
      recovery: { phase: "stopped", showCard: false },
    });
    expect(e?.kind).toBe("none_configured");
    expect(e?.softFail).toBe(false);
  });

  it("null when channels connected", () => {
    expect(
      classifyChannelsEmptyState({
        connectedCount: 1,
        configuredCount: 1,
        recovery: { phase: "listening", showCard: false },
      }),
    ).toBeNull();
  });

  it("timeline soft-fail empty during recovery", () => {
    const e = classifyTimelineEmptyState({
      eventCount: 0,
      recovery: { phase: "degraded", showCard: true },
    });
    expect(e?.softFail).toBe(true);
    expect(e?.messageKey).toContain("timelineRecovering");
  });

  it("timeline idle empty when healthy", () => {
    const e = classifyTimelineEmptyState({
      eventCount: 0,
      recovery: { phase: "listening", showCard: false },
    });
    expect(e?.kind).toBe("idle");
    expect(e?.softFail).toBe(false);
  });
});

describe("rateLimitPolicyFacts / honesty notes", () => {
  it("exposes Host soft-limit numbers", () => {
    const f = rateLimitPolicyFacts();
    expect(f.perChat).toBe(8);
    expect(f.global).toBe(40);
    expect(f.windowSecs).toBe(60);
    expect(f.backoffCapSecs).toBe(60);
  });

  it("shows honesty notes when enabled or recovering", () => {
    expect(
      shouldShowResilienceHonestyNotes({
        enabled: true,
        recovery: { showCard: false, phase: "stopped" },
      }),
    ).toBe(true);
    expect(
      shouldShowResilienceHonestyNotes({
        enabled: false,
        recovery: { showCard: true, phase: "error" },
      }),
    ).toBe(true);
    expect(
      shouldShowResilienceHonestyNotes({
        enabled: false,
        recovery: { showCard: false, phase: "stopped" },
      }),
    ).toBe(false);
  });
});
