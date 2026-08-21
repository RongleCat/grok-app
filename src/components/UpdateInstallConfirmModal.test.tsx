/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createT } from "@/i18n";
import "@/test/jsdomStubs";
import { UpdateInstallConfirmModal } from "./UpdateInstallConfirmModal";
import { updateInstallConfirmCopyKeys } from "@/lib/appUpdateHonesty";

afterEach(cleanup);

const tr = createT("en");
const keys = updateInstallConfirmCopyKeys();

describe("UpdateInstallConfirmModal", () => {
  it("interpolates {version} and confirm runs onConfirm, not onClose", async () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    render(
      <UpdateInstallConfirmModal
        open
        version="1.2.3"
        t={tr}
        onClose={onClose}
        onConfirm={onConfirm}
      />,
    );

    expect(
      screen.getByText(tr(keys.messageKey, { version: "1.2.3" })),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: tr(keys.titleKey) })).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: tr(keys.confirmKey) }),
    );
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("cancel closes without installing", async () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    render(
      <UpdateInstallConfirmModal
        open
        version="9.9.9"
        t={tr}
        onClose={onClose}
        onConfirm={onConfirm}
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: tr(keys.cancelKey) }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
