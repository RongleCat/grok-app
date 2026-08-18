import { describe, expect, it } from "vitest";
import {
  buildErrorDeck,
  classifyErrorMessage,
  deckCodeFromAgent,
  isAuthDeckCode,
  isReconnectAction,
  looksLikeRateLimit,
  looksLikeTerminalQuota,
  refineAuthDeckCode,
  refineQuotaDeckCode,
  resolveErrorDeckCode,
} from "./errorDeck";

describe("buildErrorDeck", () => {
  it("returns problem/cause/actions for the four product classes (en)", () => {
    const cli = buildErrorDeck("CLI_NOT_FOUND", "en");
    expect(cli.problem.toLowerCase()).toMatch(/cli/);
    expect(cli.cause.length).toBeGreaterThan(8);
    expect(cli.primary.id).toBe("open_doctor");
    expect(cli.secondary?.id).toBe("open_runtime");

    const auth = buildErrorDeck("AUTH_FAILED", "en");
    expect(auth.problem.toLowerCase()).toMatch(/auth|login|key/);
    expect(auth.primary.id).toBe("open_account");

    const net = buildErrorDeck("NETWORK_PROVIDER", "en");
    expect(net.problem.toLowerCase()).toMatch(/network|provider|model/);
    expect(isReconnectAction(net.primary.id)).toBe(true);

    const crash = buildErrorDeck("AGENT_CRASHED", "en");
    expect(crash.problem.toLowerCase()).toMatch(/agent|crash|process/);
    expect(crash.primary.id).toBe("reconnect");

    const old = buildErrorDeck("CLI_TOO_OLD", "en");
    expect(old.problem.toLowerCase()).toMatch(/cli/);
    expect(old.problem.toLowerCase()).toMatch(/old|version/);
    expect(old.primary.id).toBe("upgrade_cli");
    expect(old.secondary?.id).toBe("open_doctor");
  });

  it("CLI_TOO_OLD maps to its own deck code, not GENERIC", () => {
    expect(deckCodeFromAgent("CLI_TOO_OLD")).toBe("CLI_TOO_OLD");
  });

  it("returns Chinese copy for zh", () => {
    const cli = buildErrorDeck("CLI_NOT_FOUND", "zh");
    expect(cli.problem).toMatch(/CLI|命令行|未找到/);
    expect(cli.cause).toMatch(/安装|路径|Doctor|设置/);
    expect(cli.primary.label.length).toBeGreaterThan(1);
  });

  it("maps timeout / disconnect specials", () => {
    expect(deckCodeFromAgent("NETWORK_PROVIDER", { timeout: true })).toBe(
      "TURN_TIMEOUT",
    );
    expect(deckCodeFromAgent(null, { disconnected: true })).toBe(
      "AGENT_DISCONNECTED",
    );
    expect(deckCodeFromAgent("AUTH_FAILED")).toBe("AUTH_FAILED");
  });

  it("STREAM_STALL uses keep_waiting / cancel_turn (not dual dismiss)", () => {
    const stall = buildErrorDeck("STREAM_STALL", "en");
    expect(stall.code).toBe("STREAM_STALL");
    expect(stall.problem.toLowerCase()).toMatch(/stuck|stream|quiet/);
    expect(stall.primary.id).toBe("keep_waiting");
    expect(stall.secondary?.id).toBe("cancel_turn");
    expect(stall.primary.label.toLowerCase()).toMatch(/wait/);
    // Copy changed from "Cancel" to "End turn"; assert intent, not wording.
    expect(stall.secondary?.label.toLowerCase()).toMatch(/cancel|end/);
  });

  it("new recovery decks expose primary/secondary actions", () => {
    const untrusted = buildErrorDeck("WORKSPACE_UNTRUSTED", "en");
    expect(untrusted.primary.id).toBe("trust_project");
    expect(untrusted.secondary?.id).toBe("dismiss");
    expect(untrusted.problem.toLowerCase()).toMatch(/trust/);

    const missing = buildErrorDeck("PROJECT_MISSING", "en");
    expect(missing.primary.id).toBe("relocate_project");
    expect(missing.secondary?.id).toBe("add_project");

    const perm = buildErrorDeck("PERMISSION_DENIED", "en");
    expect(perm.primary.id).toBe("open_permissions");
    expect(perm.problem.toLowerCase()).toMatch(/permission|denied|access/);

    const mcp = buildErrorDeck("MCP_AUTH_FAILED", "en");
    expect(mcp.primary.id).toBe("open_mcp");
    expect(mcp.secondary?.id).toBe("open_extensions");

    const oauth = buildErrorDeck("OAUTH_EXPIRED", "en");
    expect(oauth.primary.id).toBe("open_mcp");
    expect(oauth.secondary?.id).toBe("open_account");
  });

  it("classifies free-form messages into product classes", () => {
    expect(classifyErrorMessage("CLI not found in PATH")).toBe("CLI_NOT_FOUND");
    expect(classifyErrorMessage("401 unauthorized invalid api key")).toBe(
      "AUTH_FAILED",
    );
    expect(classifyErrorMessage("network timeout via proxy")).toBe(
      "NETWORK_PROVIDER",
    );
    expect(classifyErrorMessage("agent process exited")).toBe("AGENT_CRASHED");
  });

  it("classifies official free-usage-exhausted as QUOTA even when host said NETWORK_PROVIDER", () => {
    const msg =
      "API error (status 429 Too Many Requests): subscription:free-usage-exhausted: You've used all the included free usage for model grok-4.6 for now. Usage resets over a rolling 24-hour window";
    expect(looksLikeTerminalQuota(msg)).toBe(true);
    expect(
      looksLikeTerminalQuota(
        "API error (status 429 Too Many Requests): rate limit, retry later",
      ),
    ).toBe(false);
    expect(resolveErrorDeckCode("NETWORK_PROVIDER", msg)).toBe("QUOTA_EXCEEDED");
    expect(resolveErrorDeckCode("QUOTA_EXCEEDED", msg)).toBe("QUOTA_EXCEEDED");
    const deck = buildErrorDeck("QUOTA_EXCEEDED", "en");
    expect(deck.problem).toMatch(/free usage limit/i);
    expect(deck.cause).toMatch(/24-hour|rolling/i);
    expect(deck.primary.id).toBe("open_account");
    const zh = buildErrorDeck("QUOTA_EXCEEDED", "zh");
    expect(zh.problem).toMatch(/免费用量|上限/);
  });

  it("keeps a bare 429 as Rate limited, not free-usage copy", () => {
    const msg = "API error (status 429 Too Many Requests): rate limit, retry later";
    expect(looksLikeRateLimit(msg)).toBe(true);
    expect(refineQuotaDeckCode(msg)).toBe("RATE_LIMITED");
    expect(resolveErrorDeckCode("QUOTA_EXCEEDED", msg)).toBe("RATE_LIMITED");
    expect(resolveErrorDeckCode("NETWORK_PROVIDER", msg)).toBe("RATE_LIMITED");
    expect(classifyErrorMessage(msg)).toBe("RATE_LIMITED");
    const deck = buildErrorDeck("RATE_LIMITED", "en");
    expect(deck.problem).toMatch(/rate limited/i);
    expect(deck.cause.toLowerCase()).toMatch(/wait a minute|busy/);
    expect(deck.primary.id).toBe("dismiss");
    const zh = buildErrorDeck("RATE_LIMITED", "zh");
    expect(zh.problem).toMatch(/限速/);
    expect(zh.cause).toMatch(/一分钟|正忙/);
  });

  it("classifies Linux bwrap / userns denial as SANDBOX_BLOCKED (#541)", () => {
    const msg =
      "Agent stream closed (EOF); stderr: bwrap: setting up uid map: Permission denied";
    expect(classifyErrorMessage(msg)).toBe("SANDBOX_BLOCKED");
    // Host may still emit crash/network codes — message wins.
    expect(resolveErrorDeckCode("AGENT_CRASHED", msg)).toBe("SANDBOX_BLOCKED");
    expect(resolveErrorDeckCode("NETWORK_PROVIDER", msg)).toBe("SANDBOX_BLOCKED");
    expect(deckCodeFromAgent("SANDBOX_BLOCKED")).toBe("SANDBOX_BLOCKED");
    const deck = buildErrorDeck("SANDBOX_BLOCKED", "en");
    expect(deck.problem.toLowerCase()).toMatch(/sandbox|namespace|linux/);
    expect(deck.primary.id).toBe("open_runtime");
    // Bare tool permission denied is not sandbox.
    expect(classifyErrorMessage("permission denied writing /tmp/foo")).toBe(
      "PERMISSION_DENIED",
    );
  });

  it("classifies xAI Incorrect API key (HTTP 400) as AUTH_FAILED, not crash", () => {
    // CharlieLam support 2026-08-05: host previously mapped this to AGENT_CRASHED.
    const xai400 =
      'Internal error (code -32603, data: {"http_status":400,"message":"API error (status 400 Bad Request): invalid-argument: Incorrect API key provided. You can obtain an API key from https://console.x.ai."})';
    expect(classifyErrorMessage(xai400)).toBe("AUTH_FAILED");
    expect(classifyErrorMessage("Incorrect API key provided")).toBe(
      "AUTH_FAILED",
    );
    expect(
      classifyErrorMessage(
        "Invalid or expired credentials (auth_kind=bearer, reason=no auth context)",
      ),
    ).toBe("AUTH_FAILED");
    expect(classifyErrorMessage("bad-credentials")).toBe("AUTH_FAILED");
    // resolveErrorDeckCode refines host/generic AUTH_FAILED into subtypes.
    expect(resolveErrorDeckCode(null, xai400)).toBe("AUTH_API_KEY");
  });

  it("refines AUTH_FAILED into no-context / api-key / custom-route subtypes", () => {
    const noCtx =
      "cli-proxy HTTP 401: Invalid or expired credentials (auth_kind=bearer, x_xai_token_auth=none, upstream=PermissionDenied, reason=no auth context)";
    expect(refineAuthDeckCode(noCtx)).toBe("AUTH_NO_CONTEXT");
    expect(resolveErrorDeckCode("AUTH_FAILED", noCtx)).toBe("AUTH_NO_CONTEXT");
    expect(isAuthDeckCode("AUTH_NO_CONTEXT")).toBe(true);

    const xai400 = "Incorrect API key provided. Obtain a key from console.x.ai";
    expect(refineAuthDeckCode(xai400)).toBe("AUTH_API_KEY");
    expect(resolveErrorDeckCode("AUTH_FAILED", xai400)).toBe("AUTH_API_KEY");

    // Active custom route → open Providers first (re-login alone is wrong).
    expect(
      refineAuthDeckCode("401 Unauthorized from relay", {
        activeSource: "custom",
      }),
    ).toBe("AUTH_CUSTOM_PROVIDER");
    expect(
      refineAuthDeckCode(noCtx, { activeSource: "custom" }),
    ).toBe("AUTH_CUSTOM_PROVIDER");
    expect(
      resolveErrorDeckCode("AUTH_FAILED", "401 unauthorized", {
        activeSource: "custom",
      }),
    ).toBe("AUTH_CUSTOM_PROVIDER");
    expect(
      refineAuthDeckCode(xai400, { activeSource: "custom" }),
    ).toBe("AUTH_CUSTOM_PROVIDER");

    // Generic expired without markers stays AUTH_FAILED.
    expect(refineAuthDeckCode("login expired please sign in")).toBe(
      "AUTH_FAILED",
    );

    const noCtxDeck = buildErrorDeck("AUTH_NO_CONTEXT", "en");
    expect(noCtxDeck.primary.id).toBe("open_account");
    expect(noCtxDeck.secondary?.id).toBe("reconnect");
    expect(noCtxDeck.cause.toLowerCase()).toMatch(/auth|credential|reconnect|sign/);

    const apiKeyDeck = buildErrorDeck("AUTH_API_KEY", "en");
    expect(apiKeyDeck.primary.id).toBe("open_providers");
    expect(apiKeyDeck.problem.toLowerCase()).toMatch(/api key|key/);

    const customDeck = buildErrorDeck("AUTH_CUSTOM_PROVIDER", "zh");
    expect(customDeck.primary.id).toBe("open_providers");
    expect(customDeck.cause).toMatch(/中转|服务商|Key|官方/);
  });

  it("classifies App project-gate and MCP/permission strings", () => {
    expect(classifyErrorMessage('Trust project "Demo" first.')).toBe(
      "WORKSPACE_UNTRUSTED",
    );
    expect(classifyErrorMessage("请先信任项目「演示」。")).toBe(
      "WORKSPACE_UNTRUSTED",
    );
    expect(classifyErrorMessage("請先信任專案「演示」。")).toBe(
      "WORKSPACE_UNTRUSTED",
    );
    expect(
      classifyErrorMessage(
        'Folder for "Demo" is missing or not a directory. Relocate it to continue.',
      ),
    ).toBe("PROJECT_MISSING");
    expect(classifyErrorMessage("Select a project first.")).toBe(
      "PROJECT_MISSING",
    );
    expect(classifyErrorMessage("请先选择一个项目。")).toBe("PROJECT_MISSING");
    expect(classifyErrorMessage("「演示」的文件夹已丢失或不是目录。")).toBe(
      "PROJECT_MISSING",
    );
    expect(
      classifyErrorMessage("「演示」的資料夾已遺失或不是目錄。請重新定位後繼續。"),
    ).toBe("PROJECT_MISSING");
    expect(classifyErrorMessage("permission denied writing file")).toBe(
      "PERMISSION_DENIED",
    );
    expect(classifyErrorMessage("permission_denied")).toBe("PERMISSION_DENIED");
    expect(classifyErrorMessage("EACCES: operation not permitted")).toBe(
      "PERMISSION_DENIED",
    );
    // #544 diagnostic: CLI rejects wire optionId mid-turn
    expect(
      classifyErrorMessage(
        "Failed to request permission from user: unknown permission option for tool `run_terminal_command`",
      ),
    ).toBe("PERMISSION_DENIED");
    expect(
      classifyErrorMessage("MCP oauth authorization required for server"),
    ).toBe("MCP_AUTH_FAILED");
    expect(
      classifyErrorMessage("invalid_token — MCP access token expired"),
    ).toBe("OAUTH_EXPIRED");
    expect(classifyErrorMessage("oauth failed during MCP handshake")).toBe(
      "MCP_AUTH_FAILED",
    );
  });

  it("deckCodeFromAgent accepts new App-side codes", () => {
    expect(deckCodeFromAgent("WORKSPACE_UNTRUSTED")).toBe("WORKSPACE_UNTRUSTED");
    expect(deckCodeFromAgent("PROJECT_MISSING")).toBe("PROJECT_MISSING");
    expect(deckCodeFromAgent("PERMISSION_DENIED")).toBe("PERMISSION_DENIED");
    expect(deckCodeFromAgent("MCP_AUTH_FAILED")).toBe("MCP_AUTH_FAILED");
    expect(deckCodeFromAgent("OAUTH_EXPIRED")).toBe("OAUTH_EXPIRED");
  });

  it("resolveErrorDeckCode prefers host code then message", () => {
    expect(resolveErrorDeckCode("AUTH_FAILED", "something else")).toBe(
      "AUTH_FAILED",
    );
    expect(resolveErrorDeckCode(null, "command not found: grok")).toBe(
      "CLI_NOT_FOUND",
    );
    expect(
      resolveErrorDeckCode(null, 'Trust project "x" first.'),
    ).toBe("WORKSPACE_UNTRUSTED");
    expect(
      resolveErrorDeckCode("GENERIC", "MCP oauth authorization required"),
    ).toBe("MCP_AUTH_FAILED");
  });
});
