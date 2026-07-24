import { describe, expect, it } from "vitest";
import {
  buildErrorDeck,
  deckCodeFromAgent,
  isReconnectAction,
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
});
