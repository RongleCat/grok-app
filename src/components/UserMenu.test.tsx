/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { UserMenu } from "./UserMenu";

vi.mock("@/lib/floatingMenu", () => ({
  FLOATING_MENU_Z_INDEX: 13_000,
  useFloatingMenu: () => ({
    pos: { top: 100, left: 10 },
    style: { position: "fixed" },
    settled: true,
  }),
}));

const labels = {
  theme: "Theme",
  themeSystem: "System",
  themeLight: "Light",
  themeDark: "Dark",
  login: "Log in",
  logout: "Log out",
};

function Harness({ collapsed }: { collapsed: boolean }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <output data-testid="open">{String(open)}</output>
      <UserMenu
        open={open}
        closeImmediately={collapsed}
        onClose={() => setOpen(false)}
        theme="dark"
        themePreference="dark"
        labels={labels}
        account={null}
        activeProvider={null}
        accountBusy={false}
        onTheme={() => undefined}
        onLogin={() => undefined}
        onLogout={() => undefined}
      >
        <button type="button">Account</button>
      </UserMenu>
    </>
  );
}

it("opens the theme editor from the theme submenu footer group", async () => {
  const onThemeEditor = vi.fn();
  const view = render(
    <UserMenu
      open
      onClose={() => undefined}
      theme="dark"
      themePreference="dark"
      labels={{ ...labels, themeEditor: "Theme editor" }}
      account={null}
      activeProvider={null}
      accountBusy={false}
      onTheme={() => undefined}
      onThemeEditor={onThemeEditor}
      onLogin={() => undefined}
      onLogout={() => undefined}
    >
      <button type="button">Account</button>
    </UserMenu>,
  );

  fireEvent.mouseEnter(screen.getByRole("menuitem", { name: "Theme" }));
  const editor = await screen.findByRole("menuitem", { name: "Theme editor" });
  expect(document.querySelector(".user-menu__flyout-sep")).not.toBeNull();
  fireEvent.click(editor);
  expect(onThemeEditor).toHaveBeenCalledTimes(1);
  view.rerender(
    <UserMenu
      open={false}
      onClose={() => undefined}
      theme="dark"
      themePreference="dark"
      labels={{ ...labels, themeEditor: "Theme editor" }}
      account={null}
      activeProvider={null}
      accountBusy={false}
      onTheme={() => undefined}
      onThemeEditor={onThemeEditor}
      onLogin={() => undefined}
      onLogout={() => undefined}
    >
      <button type="button">Account</button>
    </UserMenu>,
  );
  await waitFor(() =>
    expect(document.querySelector(".user-menu__pop--portal")).toBeNull(),
  );
  view.unmount();
});

it("does not put quota or settings in the account menu", async () => {
  const view = render(
    <UserMenu
      open
      onClose={() => undefined}
      theme="dark"
      themePreference="dark"
      labels={labels}
      account={null}
      activeProvider={null}
      accountBusy={false}
      onTheme={() => undefined}
      onLogin={() => undefined}
      onLogout={() => undefined}
    >
      <button type="button">Account</button>
    </UserMenu>,
  );
  expect(document.querySelector(".user-menu__account")).toBeNull();
  expect(screen.queryByRole("menuitem", { name: "Settings" })).toBeNull();
  expect(screen.getByRole("menuitem", { name: "Theme" })).toBeTruthy();
  view.rerender(
    <UserMenu
      open={false}
      onClose={() => undefined}
      theme="dark"
      themePreference="dark"
      labels={labels}
      account={null}
      activeProvider={null}
      accountBusy={false}
      onTheme={() => undefined}
      onLogin={() => undefined}
      onLogout={() => undefined}
    >
      <button type="button">Account</button>
    </UserMenu>,
  );
  await waitFor(() =>
    expect(document.querySelector(".user-menu__pop--portal")).toBeNull(),
  );
  view.unmount();
});

it("clears an open account menu when the sidebar collapses", async () => {
  const view = render(<Harness collapsed={false} />);
  expect(document.querySelector(".user-menu__pop--portal")).not.toBeNull();

  view.rerender(<Harness collapsed />);
  expect(document.querySelector(".user-menu__pop--portal")).toBeNull();
  await waitFor(() =>
    expect(screen.getByTestId("open").textContent).toBe("false"),
  );

  view.rerender(<Harness collapsed={false} />);
  expect(document.querySelector(".user-menu__pop--portal")).toBeNull();
});
