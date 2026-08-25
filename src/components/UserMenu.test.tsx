/**
 * @vitest-environment jsdom
 */

import { render, screen, waitFor } from "@testing-library/react";
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
  settings: "Settings",
  theme: "Theme",
  themeSystem: "System",
  themeLight: "Light",
  themeDark: "Dark",
  local: "Local",
  signedIn: "Signed in",
  signedOut: "Signed out",
  login: "Log in",
  logout: "Log out",
  remaining: "remaining",
  profileActive: "Active",
  switchTo: "Switch to",
  customProvider: "Custom provider",
  resetsAt: "Resets",
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
        locale="en"
        labels={labels}
        account={null}
        activeProvider={null}
        accountBusy={false}
        onSettings={() => undefined}
        onAccountSettings={() => undefined}
        onTheme={() => undefined}
        onLogin={() => undefined}
        onLogout={() => undefined}
      >
        <button type="button">Account</button>
      </UserMenu>
    </>
  );
}

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
