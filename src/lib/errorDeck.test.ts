import { describe, expect, it } from "vitest";
import {
  buildErrorDeck,
  classifyErrorMessage,
  deckCodeFromAgent,
  isReconnectAction,
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
    expect(stall.problem.toLowerCase()).toMatch(/stuck|stream/);
    expect(stall.primary.id).toBe("keep_waiting");
    expect(stall.secondary?.id).toBe("cancel_turn");
    expect(stall.primary.label.toLowerCase()).toMatch(/wait/);
    // Copy changed from "Cancel" to "End turn"; assert intent, not wording.
    expect(stall.secondary?.label.toLowerCase()).toMatch(/cancel|end/);
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

  it("resolveErrorDeckCode prefers host code then message", () => {
    expect(resolveErrorDeckCode("AUTH_FAILED", "something else")).toBe(
      "AUTH_FAILED",
    );
    expect(resolveErrorDeckCode(null, "command not found: grok")).toBe(
      "CLI_NOT_FOUND",
    );
  });
});
