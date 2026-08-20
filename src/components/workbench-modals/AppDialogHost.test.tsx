/**
 * @vitest-environment jsdom
 *
 * Wiring guard for the in-app confirm / prompt host after it left AppWorkbench.
 * The subtle part is that confirm reads `dialogRef.current` rather than the
 * rendered prop, which is what keeps chained dialogs (YOLO step 1 → step 2)
 * from firing the stale step's handler.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { createT } from "@/i18n";
import type { AppDialog } from "@/lib/app/appDialogTypes";
import { AppDialogHost } from "./AppDialogHost";

afterEach(cleanup);

const tr = createT("en");

function renderHost(
  dialog: NonNullable<AppDialog>,
  over: Partial<Parameters<typeof AppDialogHost>[0]> = {},
) {
  const handlers = {
    onDismiss: vi.fn(),
    onInputChange: vi.fn(),
    onClearError: vi.fn(),
    onConfirm: vi.fn(),
    onPromptSubmit: vi.fn(),
  };
  const dialogRef = { current: dialog as AppDialog };
  render(
    <AppDialogHost
      locale="en"
      dialog={dialog}
      dialogRef={dialogRef}
      panelRef={createRef<HTMLDivElement>()}
      confirmBtnRef={createRef<HTMLButtonElement>()}
      inputRef={createRef<HTMLInputElement>()}
      inputValue=""
      error=""
      {...handlers}
      {...over}
    />,
  );
  return { ...handlers, dialogRef };
}

const confirmDialog = (over: Record<string, unknown> = {}) =>
  ({
    kind: "confirm",
    title: "Delete chat",
    message: "This cannot be undone.",
    onConfirm: vi.fn(),
    ...over,
  }) as Extract<NonNullable<AppDialog>, { kind: "confirm" }>;

const promptDialog = (over: Record<string, unknown> = {}) =>
  ({
    kind: "prompt",
    title: "Rename chat",
    initial: "",
    onSubmit: vi.fn(),
    ...over,
  }) as Extract<NonNullable<AppDialog>, { kind: "prompt" }>;

describe("AppDialogHost", () => {
  it("portals to document.body so overflow parents cannot clip it", () => {
    const { container } = render(
      <AppDialogHost
        locale="en"
        dialog={confirmDialog()}
        dialogRef={{ current: confirmDialog() }}
        panelRef={createRef<HTMLDivElement>()}
        confirmBtnRef={createRef<HTMLButtonElement>()}
        inputRef={createRef<HTMLInputElement>()}
        inputValue=""
        error=""
        onDismiss={vi.fn()}
        onInputChange={vi.fn()}
        onClearError={vi.fn()}
        onConfirm={vi.fn()}
        onPromptSubmit={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("confirms with the latest dialog so chained steps do not fire the stale one", async () => {
    const step1 = confirmDialog({ title: "Enable YOLO?" });
    const step2 = confirmDialog({ title: "Really enable YOLO?" });
    const { onConfirm, dialogRef } = renderHost(step1);

    // The shell swapped in step 2 (keyboard path) before the click landed.
    dialogRef.current = step2;
    await userEvent.click(
      screen.getByRole("button", { name: tr("common.confirm") }),
    );

    expect(onConfirm).toHaveBeenCalledWith(step2);
  });

  it("ignores a confirm click once the shell already cleared the dialog", async () => {
    const { onConfirm, dialogRef } = renderHost(confirmDialog());

    dialogRef.current = null;
    await userEvent.click(
      screen.getByRole("button", { name: tr("common.confirm") }),
    );

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("marks a danger confirm so the destructive button is visually distinct", () => {
    renderHost(confirmDialog({ danger: true, confirmLabel: "Delete" }));
    expect(screen.getByRole("button", { name: "Delete" })).toHaveClass(
      "btn--danger",
    );
  });

  it("submits the prompt value and surfaces an inline error without closing", async () => {
    const { onPromptSubmit } = renderHost(promptDialog(), {
      inputValue: "new title",
    });

    await userEvent.click(
      screen.getByRole("button", { name: tr("common.save") }),
    );
    expect(onPromptSubmit).toHaveBeenCalledWith("new title");

    cleanup();

    renderHost(promptDialog(), {
      inputValue: "taken",
      error: "That name is already used",
    });
    const input = screen.getByRole("textbox");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "That name is already used",
    );
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("That name is already used");
  });

  it("clears a shown error as soon as the user edits the input", async () => {
    const { onInputChange, onClearError } = renderHost(promptDialog(), {
      inputValue: "",
      error: "Required",
    });

    await userEvent.type(screen.getByRole("textbox"), "a");

    expect(onInputChange).toHaveBeenCalledWith("a");
    expect(onClearError).toHaveBeenCalled();
  });

  it("dismisses from the backdrop but not from a click inside the panel", async () => {
    const { onDismiss } = renderHost(confirmDialog());

    await userEvent.click(screen.getByRole("dialog"));
    expect(onDismiss).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("presentation"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
