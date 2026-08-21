/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { PermissionCountdown } from "./PermissionCountdown";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("PermissionCountdown", () => {
  it("ticks remaining seconds inside the countdown, not the parent", () => {
    const started = 1_000_000;
    vi.setSystemTime(started);
    render(
      <PermissionCountdown
        startedAtMs={started}
        timeoutSec={30}
        format={(seconds) => `T${seconds}`}
      />,
    );
    expect(screen.getByText("T30")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText("T29")).toBeInTheDocument();
  });

  it("hides when remaining hits zero", () => {
    const started = 1_000_000;
    vi.setSystemTime(started);
    render(
      <PermissionCountdown
        startedAtMs={started}
        timeoutSec={1}
        format={(seconds) => `T${seconds}`}
      />,
    );
    expect(screen.getByText("T1")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByText(/^T/)).toBeNull();
  });
});
