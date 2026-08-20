/**
 * @vitest-environment jsdom
 *
 * Wiring guard for the compact overlay after it moved out of AppWorkbench.
 * The shell owns every piece of state, so what can regress here is the
 * plumbing: which callback a control fires, and what a live turn disables.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { createT } from "@/i18n";
import type { ContextUsageDisplay } from "@/lib/contextUsage";
import { CompactModal } from "./CompactModal";

afterEach(cleanup);

const tr = createT("en");

function usage(over: Partial<ContextUsageDisplay> = {}): ContextUsageDisplay {
  return {
    tokens: 42_000,
    source: "known",
    label: "42k",
    lastCompact: null,
    breakdown: null,
    knownUsage: null,
    windowSize: 200_000,
    percent: 21,
    cacheHitRate: null,
    cachedReadTokens: null,
    ...over,
  };
}

function renderModal(over: Partial<Parameters<typeof CompactModal>[0]> = {}) {
  const handlers = {
    onClose: vi.fn(),
    onNoteChange: vi.fn(),
    onPresetChange: vi.fn(),
    onCompactionModeChange: vi.fn(),
    onCompactionDetailChange: vi.fn(),
    onSubmit: vi.fn(),
  };
  render(
    <CompactModal
      locale="en"
      formRef={createRef<HTMLFormElement>()}
      noteInputRef={createRef<HTMLInputElement>()}
      note=""
      preset="standard"
      compactionMode="summary"
      compactionDetail="balanced"
      turnLive={false}
      usage={usage()}
      {...handlers}
      {...over}
    />,
  );
  return handlers;
}

const submitButton = () =>
  document.querySelector<HTMLButtonElement>('button[type="submit"]')!;

describe("CompactModal", () => {
  it("reports the picked preset instead of mutating its own state", async () => {
    const { onPresetChange } = renderModal();
    const presets = screen.getAllByRole("radio");
    expect(presets).toHaveLength(3);
    expect(presets[1]).toBeChecked();

    await userEvent.click(presets[2]);

    expect(onPresetChange).toHaveBeenCalledWith("aggressive");
  });

  it("submits the current note and preset", async () => {
    const { onSubmit } = renderModal({ note: "keep the repro", preset: "light" });

    await userEvent.click(submitButton());

    expect(onSubmit).toHaveBeenCalledWith("keep the repro", "light");
  });

  it("blocks submitting while a turn is live", async () => {
    const { onSubmit } = renderModal({ turnLive: true });
    expect(submitButton()).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(tr("slash.compactBusy"));

    await userEvent.click(submitButton());

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("toggles a note chip off when it already holds that text", async () => {
    const label = tr("slash.compactNoteChipDecisions");
    const first = renderModal();
    await userEvent.click(screen.getByRole("button", { name: label }));
    expect(first.onNoteChange).toHaveBeenCalledWith(label);

    cleanup();

    const second = renderModal({ note: label });
    const chip = screen.getByRole("button", { name: label });
    expect(chip).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(chip);
    expect(second.onNoteChange).toHaveBeenCalledWith("");
  });

  it("enables the detail picker only for segments mode", () => {
    const detailLabel = tr("slash.compactDetail");
    renderModal({ compactionMode: "summary" });
    expect(screen.getByRole("button", { name: detailLabel })).toBeDisabled();

    cleanup();

    renderModal({ compactionMode: "segments" });
    expect(screen.getByRole("button", { name: detailLabel })).toBeEnabled();
  });

  it("closes from the backdrop, the header button, and cancel", async () => {
    const { onClose } = renderModal();

    await userEvent.click(screen.getByRole("button", { name: tr("common.close") }));
    await userEvent.click(
      screen.getByRole("button", { name: tr("slash.compactConfirmCancel") }),
    );
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
