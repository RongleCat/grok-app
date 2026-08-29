/**
 * @vitest-environment jsdom
 *
 * Runtime → CLI repair CTA: only surfaces when the binary is missing, and a
 * successful install re-probes the CLI so the parent card flips to found.
 * Review notes on #954: account login rows must not appear here — the CLI
 * card repairs the binary only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as api from "@/lib/api";
import { CliRepairPanel } from "./CliRepairPanel";
import type { Vars } from "@/i18n";

function t(k: string, vars?: Vars): string {
  if (k === "settings.cliUpdateDone") return `done:${vars?.version ?? ""}`;
  if (k === "settings.cliUpdateInstallFailed") {
    return `failed:${vars?.error ?? ""}`;
  }
  return String(k);
}

const FOUND_CLI = {
  found: true,
  path: "/usr/local/bin/grok",
  version: "1.0.8",
  source: "PATH",
  cliAuthPresent: true,
};

function renderPanel(
  props: Partial<Parameters<typeof CliRepairPanel>[0]> = {},
) {
  const onCliInfoRefresh = vi.fn();
  const showSettingsToast = vi.fn();
  render(
    <CliRepairPanel
      onCliInfoRefresh={onCliInfoRefresh}
      showSettingsToast={showSettingsToast}
      t={t}
      {...props}
    />,
  );
  return { onCliInfoRefresh, showSettingsToast };
}

beforeEach(() => {
  vi.spyOn(api, "isTauri").mockReturnValue(false);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CliRepairPanel", () => {
  it("renders the repair CTA with shared copy when the CLI is missing", () => {
    renderPanel();
    expect(screen.getByTestId("settings-cli-repair")).toBeInTheDocument();
    expect(
      screen.getByText("settings.cliVersion.missing"),
    ).toBeInTheDocument();
    expect(screen.getByText("settings.cliUpdateNeedCli")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "setup.install" })).toBeEnabled();
  });

  it("calls cli_install_latest on click and re-probes so the parent card refreshes", async () => {
    const installSpy = vi
      .spyOn(api, "cliInstallLatest")
      .mockResolvedValue({
        ok: true,
        path: "/usr/local/bin/grok",
        version: "1.0.8",
        mirrorUsed: null,
        message: "",
      });
    vi.spyOn(api, "probeCli").mockResolvedValue(FOUND_CLI as api.CliProbeInfo);
    const { onCliInfoRefresh, showSettingsToast } = renderPanel();

    await userEvent.click(
      screen.getByRole("button", { name: "setup.install" }),
    );

    expect(installSpy).toHaveBeenCalledWith(undefined);
    await waitFor(() => {
      expect(onCliInfoRefresh).toHaveBeenCalledWith(FOUND_CLI);
    });
    expect(showSettingsToast).toHaveBeenCalledWith("done:1.0.8", 3200);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("surfaces the failure message when the install command fails", async () => {
    vi.spyOn(api, "cliInstallLatest").mockResolvedValue({
      ok: false,
      path: null,
      version: null,
      mirrorUsed: null,
      message: "network down",
    });
    renderPanel();

    await userEvent.click(
      screen.getByRole("button", { name: "setup.install" }),
    );

    const warn = await screen.findByText("failed:network down");
    expect(warn).toHaveClass("settings-row__hint--warn");
  });

  it("shows an in-flight progress line and disables the button while installing", async () => {
    let resolveInstall: (v: api.CliInstallResult) => void = () => {};
    vi.spyOn(api, "cliInstallLatest").mockReturnValue(
      new Promise<api.CliInstallResult>((r) => {
        resolveInstall = r;
      }),
    );
    renderPanel();

    await userEvent.click(
      screen.getByRole("button", { name: "setup.install" }),
    );

    expect(
      screen.getByRole("button", { name: "setup.installing" }),
    ).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("setup.detecting");
    resolveInstall({
      ok: true,
      path: "/usr/local/bin/grok",
      version: "1.0.8",
      mirrorUsed: null,
      message: "",
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "setup.install" })).toBeEnabled();
    });
  });
});
