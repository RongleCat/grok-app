/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSetupBootGate } from "./useSetupBootGate";

vi.mock("@/lib/desktopNotify", () => ({
  ensureNotifyPermission: vi.fn(async () => {}),
}));

describe("useSetupBootGate", () => {
  it("retryBootDetect clears timeout flags and bumps the nonce", () => {
    const { result } = renderHook(() => useSetupBootGate());
    const before = result.current.bootRetryNonce;
    act(() => {
      result.current.setBootDetectTimedOut(true);
      result.current.setBootDetectSlow(true);
    });
    act(() => {
      result.current.retryBootDetect();
    });
    expect(result.current.bootDetectTimedOut).toBe(false);
    expect(result.current.bootDetectSlow).toBe(false);
    expect(result.current.bootRetryNonce).toBe(before + 1);
  });

  it("skipToSetup opens the wizard", () => {
    const { result } = renderHook(() => useSetupBootGate());
    act(() => {
      result.current.skipToSetup();
    });
    expect(result.current.appGate).toBe("setup");
    expect(result.current.bootDetectTimedOut).toBe(false);
  });
});
