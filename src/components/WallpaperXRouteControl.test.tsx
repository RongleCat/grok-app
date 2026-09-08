/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const get = vi.hoisted(() => vi.fn());
const set = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ settingsGet: get, settingsSet: set }));
vi.mock("@/components/Select", () => ({ Select: ({ value, disabled, onChange }: {
  value: string; disabled: boolean; onChange: (value: string) => void;
}) => <button disabled={disabled} onClick={() => onChange("responses_preview")}>{value}</button> }));
import { WallpaperXRouteControl } from "./WallpaperXRouteControl";
afterEach(cleanup);
beforeEach(() => { vi.resetAllMocks(); get.mockResolvedValue({ wallpaperXSearchMode: "cli", theme: "dark" }); set.mockResolvedValue({}); });

it("preserves current settings and displays preview only after successful save", async () => {
  const saving = vi.fn();
  render(<WallpaperXRouteControl t={(key) => key} disabled={false} onSavingChange={saving} />);
  await waitFor(() => expect(screen.getByRole("button").hasAttribute("disabled")).toBe(false));
  fireEvent.click(screen.getByRole("button"));
  await screen.findByText("responses_preview");
  expect(set).toHaveBeenCalledWith({ wallpaperXSearchMode: "responses_preview", theme: "dark" });
  expect(saving.mock.calls).toEqual([[true], [false]]);
});

it("failed persistence keeps the saved mode and restores interaction", async () => {
  set.mockRejectedValue(new Error("disk full"));
  render(<WallpaperXRouteControl t={(key) => key} disabled={false} onSavingChange={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole("button").hasAttribute("disabled")).toBe(false));
  fireEvent.click(screen.getByRole("button"));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "settings.wallpaperSource.routeSaveFailed",
  );
  expect(screen.getByRole("button").textContent).toBe("cli");
  expect(screen.getByRole("button").hasAttribute("disabled")).toBe(false);
});
