import { describe, expect, it } from "vitest";
import {
  classifyMirrorError,
  deriveMirrorClientLinkStatus,
  deriveMirrorHostStatus,
  isLoopbackMirrorUrl,
  mirrorCopyUrl,
  mirrorDiagnosticDisplay,
  mirrorErrorKindHintKey,
  mirrorErrorKindLabelKey,
  mirrorErrorKindTone,
  mirrorHostLinkReady,
  mirrorHostPhaseClass,
  mirrorHostPhaseLabelField,
  mirrorSoftFailKeepsHost,
  sanitizeMirrorDiagnostic,
  shouldShowMirrorQr,
} from "./mirrorStatus";

describe("sanitizeMirrorDiagnostic", () => {
  it("returns null for empty", () => {
    expect(sanitizeMirrorDiagnostic(null)).toBeNull();
    expect(sanitizeMirrorDiagnostic("   ")).toBeNull();
  });

  it("redacts path tokens and URLs", () => {
    const s = sanitizeMirrorDiagnostic(
      "fail https://trycloudflare.com/t/secretToken123/ws path /t/abcDEF/ok",
    );
    expect(s).not.toContain("secretToken123");
    expect(s).not.toContain("trycloudflare");
    expect(s).toContain("/t/<redacted>");
    expect(s).toContain("[url]");
  });

  it("caps length", () => {
    const s = sanitizeMirrorDiagnostic("x".repeat(500), 40);
    expect(s!.length).toBeLessThanOrEqual(40);
  });
});

describe("classifyMirrorError", () => {
  it("detects cloudflared missing / timeout / spawn / dead", () => {
    expect(
      classifyMirrorError(
        "cloudflared not found on PATH — install cloudflared or set GROK_MIRROR_NO_TUNNEL=1",
      ),
    ).toBe("cloudflared_missing");
    expect(
      classifyMirrorError(
        "cloudflared not found on PATH and Docker daemon is unavailable — start Docker Desktop",
      ),
    ).toBe("cloudflared_missing");
    expect(
      classifyMirrorError("cloudflared did not become ready within 90s"),
    ).toBe("tunnel_timeout");
    expect(classifyMirrorError("failed to spawn cloudflared: ENOENT")).toBe(
      "tunnel_spawn",
    );
    expect(classifyMirrorError("cloudflared tunnel process exited")).toBe(
      "tunnel_dead",
    );
    expect(
      classifyMirrorError(
        "cloudflared printed URL but never 'Registered tunnel connection'",
      ),
    ).toBe("tunnel_not_registered");
  });

  it("detects port bind, desktop-only, clients full", () => {
    expect(classifyMirrorError("Address already in use (os error 48)")).toBe(
      "port_bind",
    );
    expect(classifyMirrorError("mirror host requires desktop app")).toBe(
      "desktop_only",
    );
    expect(classifyMirrorError("too many clients (503)")).toBe("clients_full");
  });

  it("detects transport / RPC errors", () => {
    expect(classifyMirrorError("mirror websocket closed")).toBe("ws_closed");
    expect(classifyMirrorError("mirror websocket connect timeout")).toBe(
      "ws_timeout",
    );
    expect(classifyMirrorError("mirror RPC timeout: sessions.list")).toBe(
      "rpc_timeout",
    );
    expect(classifyMirrorError("UNSUPPORTED: secrets_get_masked")).toBe(
      "rpc_unsupported",
    );
    expect(classifyMirrorError("mirror websocket not connected")).toBe(
      "not_connected",
    );
  });

  it("uses phase hint for tunnel_dead", () => {
    expect(classifyMirrorError(null, { phase: "tunnel_dead" })).toBe(
      "tunnel_dead",
    );
  });

  it("maps label / hint keys", () => {
    expect(mirrorErrorKindLabelKey("cloudflared_missing")).toBe(
      "mirror.err.cloudflaredMissing",
    );
    expect(mirrorErrorKindHintKey("tunnel_timeout")).toBe(
      "mirror.hint.tunnelTimeout",
    );
    expect(mirrorErrorKindTone("cloudflared_missing")).toBe("err");
    expect(mirrorErrorKindTone("tunnel_dead")).toBe("warn");
  });
});

describe("deriveMirrorHostStatus", () => {
  it("stopped clean", () => {
    const s = deriveMirrorHostStatus({ phase: "stopped", running: false });
    expect(s.phase).toBe("stopped");
    expect(s.tone).toBe("muted");
    expect(s.showSoftLocal).toBe(false);
    expect(s.inventLiveFromLoopback).toBe(false);
  });

  it("live only when host phase is live", () => {
    const s = deriveMirrorHostStatus({
      phase: "live",
      running: true,
      publicUrl: "https://example.trycloudflare.com/t/tok/",
      clients: 1,
    });
    expect(s.phase).toBe("live");
    expect(s.tone).toBe("ok");
    expect(s.clients).toBe(1);
  });

  it("never invents live from loopback URL alone", () => {
    const s = deriveMirrorHostStatus({
      phase: "local",
      running: true,
      publicUrl: "http://127.0.0.1:7420/t/abc/",
    });
    expect(s.phase).toBe("local");
    expect(s.phase).not.toBe("live");
    expect(s.inventLiveFromLoopback).toBe(false);
  });

  it("tunnel soft-fail → soft_local while host still running", () => {
    const s = deriveMirrorHostStatus({
      phase: "error",
      running: true,
      publicUrl: "http://127.0.0.1:7420/t/tok/",
      localPort: 7420,
      error:
        "cloudflared not found on PATH — install cloudflared or set GROK_MIRROR_NO_TUNNEL=1",
    });
    expect(s.phase).toBe("soft_local");
    expect(s.tone).toBe("warn");
    expect(s.showSoftLocal).toBe(true);
    expect(s.showDiagnostic).toBe(true);
    expect(s.errorKind).toBe("cloudflared_missing");
    expect(s.running).toBe(true);
    expect(s.safeMessage).not.toContain("tok");
  });

  it("tunnel_dead keeps soft continuity", () => {
    const s = deriveMirrorHostStatus({
      phase: "tunnel_dead",
      running: true,
      publicUrl: "https://x.trycloudflare.com/t/abc/",
      error: "cloudflared tunnel process exited",
    });
    expect(s.phase).toBe("tunnel_dead");
    expect(s.showSoftLocal).toBe(true);
    expect(s.errorKind).toBe("tunnel_dead");
    expect(s.tone).toBe("warn");
  });

  it("hard error when not running", () => {
    const s = deriveMirrorHostStatus({
      phase: "error",
      running: false,
      error: "Address already in use",
    });
    expect(s.phase).toBe("error");
    expect(s.tone).toBe("err");
    expect(s.errorKind).toBe("port_bind");
    expect(s.showSoftLocal).toBe(false);
  });

  it("intentional local (no tunnel) is ok, not soft-fail", () => {
    const s = deriveMirrorHostStatus({
      phase: "local",
      running: true,
      publicUrl: "http://127.0.0.1:1/t/a/",
    });
    expect(s.phase).toBe("local");
    expect(s.tone).toBe("ok");
    expect(s.showSoftLocal).toBe(false);
  });

  it("uiError classifies when status.error empty", () => {
    const s = deriveMirrorHostStatus({
      phase: "stopped",
      running: false,
      uiError: "mirror host requires desktop app",
    });
    expect(s.errorKind).toBe("desktop_only");
    expect(s.showDiagnostic).toBe(true);
  });
});

describe("deriveMirrorClientLinkStatus", () => {
  it("connected only when WS open", () => {
    const s = deriveMirrorClientLinkStatus({ wsConnected: true, hasToken: true });
    expect(s.phase).toBe("connected");
    expect(s.tone).toBe("ok");
    expect(s.wsConnected).toBe(true);
  });

  it("reconnecting when auto-reconnect and not connected", () => {
    const s = deriveMirrorClientLinkStatus({
      wsConnected: false,
      hasToken: true,
    });
    expect(s.phase).toBe("reconnecting");
    expect(s.tone).toBe("warn");
  });

  it("disconnected when auto-reconnect off", () => {
    const s = deriveMirrorClientLinkStatus({
      wsConnected: false,
      hasToken: true,
      autoReconnect: false,
    });
    expect(s.phase).toBe("disconnected");
    expect(s.labelKey).toBe("mirror.chrome.disconnected");
  });

  it("token missing is hard err", () => {
    const s = deriveMirrorClientLinkStatus({
      wsConnected: false,
      hasToken: false,
    });
    expect(s.phase).toBe("token_missing");
    expect(s.tone).toBe("err");
  });
});

describe("display helpers", () => {
  it("mirrorHostPhaseClass", () => {
    expect(mirrorHostPhaseClass("ok")).toContain("--ok");
    expect(mirrorHostPhaseClass("warn")).toContain("--warn");
    expect(mirrorHostPhaseClass("err")).toContain("--err");
    expect(mirrorHostPhaseClass("muted")).toBe("");
  });

  it("mirrorHostPhaseLabelField", () => {
    expect(mirrorHostPhaseLabelField("soft_local")).toBe("phaseSoftLocal");
    expect(mirrorHostPhaseLabelField("live")).toBe("phaseLive");
  });

  it("mirrorDiagnosticDisplay prefers cloudflared label", () => {
    expect(
      mirrorDiagnosticDisplay({
        errorKind: "cloudflared_missing",
        safeMessage: "cloudflared not found…",
        missingCloudflaredLabel: "Install cloudflared",
        genericLabel: "oops",
      }),
    ).toBe("Install cloudflared");
    expect(
      mirrorDiagnosticDisplay({
        errorKind: "tunnel_timeout",
        safeMessage: "timed out",
        missingCloudflaredLabel: "Install cloudflared",
        genericLabel: "oops",
      }),
    ).toBe("timed out");
  });

  it("mirrorHostLinkReady / softFailKeepsHost", () => {
    const live = deriveMirrorHostStatus({
      phase: "live",
      running: true,
      publicUrl: "https://x/t/y/",
    });
    expect(mirrorHostLinkReady(live)).toBe(true);

    const soft = deriveMirrorHostStatus({
      phase: "error",
      running: true,
      publicUrl: "http://127.0.0.1/t/a/",
      error: "cloudflared not found",
    });
    expect(mirrorHostLinkReady(soft)).toBe(false);
    expect(
      mirrorSoftFailKeepsHost({
        running: true,
        phase: "error",
        publicUrl: "http://127.0.0.1/t/a/",
        localPort: 1,
      }),
    ).toBe(true);
  });
});

describe("LAN copy / QR (#875)", () => {
  const lan = "http://192.168.110.188:59166/t/tok/";
  const loopback = "http://127.0.0.1:59166/t/tok/";

  it("detects loopback hosts", () => {
    expect(isLoopbackMirrorUrl(loopback)).toBe(true);
    expect(isLoopbackMirrorUrl("http://localhost:1/t/x/")).toBe(true);
    expect(isLoopbackMirrorUrl(lan)).toBe(false);
    expect(isLoopbackMirrorUrl("https://x.trycloudflare.com/t/tok/")).toBe(
      false,
    );
  });

  it("local-only copy prefers LAN URL once opted in", () => {
    expect(
      mirrorCopyUrl({
        running: true,
        phase: "local",
        publicUrl: loopback,
        lanUrl: lan,
        allowLan: true,
      }),
    ).toBe(lan);
    expect(
      mirrorCopyUrl({
        running: true,
        phase: "error",
        publicUrl: loopback,
        lanUrl: lan,
        allowLan: true,
      }),
    ).toBe(lan);
    expect(
      mirrorCopyUrl({
        running: true,
        phase: "local",
        publicUrl: loopback,
        lanUrl: lan,
        allowLan: false,
      }),
    ).toBe(loopback);
  });

  it("live tunnel stays the primary copy URL", () => {
    const pub = "https://x.trycloudflare.com/t/tok/";
    expect(
      mirrorCopyUrl({
        running: true,
        phase: "live",
        publicUrl: pub,
        lanUrl: lan,
        allowLan: true,
      }),
    ).toBe(pub);
  });

  it("does not QR a loopback URL", () => {
    const local = deriveMirrorHostStatus({
      phase: "local",
      running: true,
      publicUrl: loopback,
    });
    expect(
      shouldShowMirrorQr(
        {
          running: true,
          phase: "local",
          publicUrl: loopback,
          lanUrl: null,
          allowLan: false,
        },
        local,
      ),
    ).toBe(false);
    expect(
      shouldShowMirrorQr(
        {
          running: true,
          phase: "local",
          publicUrl: lan,
          lanUrl: lan,
          allowLan: true,
        },
        local,
      ),
    ).toBe(true);
  });
});
