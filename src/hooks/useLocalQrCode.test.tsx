/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocalQrCode } from "./useLocalQrCode";

const { generate } = vi.hoisted(() => ({
  generate: vi.fn<(value: string, options: unknown) => Promise<string>>(),
}));
vi.mock("qrcode", () => ({ default: { toDataURL: generate } }));
beforeEach(() => { generate.mockReset(); });
afterEach(cleanup);

describe("private binding QR generation", () => {
  it("encodes the binding locally, without constructing a remote image URL", async () => {
    generate.mockResolvedValue("data:image/png;base64,local");
    const uri = "https://binding.example/verify?token=synthetic-secret";
    const { result } = renderHook(() => useLocalQrCode(uri));
    await waitFor(() => expect(result.current.dataUrl).toBe("data:image/png;base64,local"));
    expect(generate).toHaveBeenCalledWith(uri, expect.objectContaining({ width: 180 }));
    expect(result.current.error).toBe(false);
  });

  it("hides the old QR on refresh and ignores a stale completion", async () => {
    let resolveOld!: (value: string) => void;
    let resolveNew!: (value: string) => void;
    generate.mockImplementationOnce(() => new Promise<string>((resolve) => { resolveOld = resolve; }));
    generate.mockImplementationOnce(() => new Promise<string>((resolve) => { resolveNew = resolve; }));
    const { result, rerender } = renderHook(({ uri }) => useLocalQrCode(uri), {
      initialProps: { uri: "old-binding" },
    });
    rerender({ uri: "new-binding" });
    expect(result.current.dataUrl).toBeNull();
    await act(async () => resolveNew("data:image/png;base64,new"));
    await act(async () => resolveOld("data:image/png;base64,old"));
    expect(result.current.dataUrl).toBe("data:image/png;base64,new");
  });

  it("clears a displayed QR when the binding is cleared", async () => {
    generate.mockResolvedValue("data:image/png;base64,old");
    const { result, rerender } = renderHook(({ uri }: { uri: string | null }) => useLocalQrCode(uri), {
      initialProps: { uri: "binding" as string | null },
    });
    await waitFor(() => expect(result.current.dataUrl).not.toBeNull());
    rerender({ uri: null });
    expect(result.current).toEqual({ dataUrl: null, error: false });
  });

  it("reports generation failure without an external fallback", async () => {
    generate.mockRejectedValue(new Error("synthetic binding must not be logged"));
    const { result } = renderHook(() => useLocalQrCode("binding"));
    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current.dataUrl).toBeNull();
    expect(generate).toHaveBeenCalledTimes(1);
  });
});
