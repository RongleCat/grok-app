/**
 * @vitest-environment jsdom
 *
 * Branch-chip PR section: the PR row, the watch toggle, the "no PR" state and
 * the portal/material contract (dialogs.md: never a transparent or clipped
 * menu). Drives the shipped component through a real click.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import "@/test/jsdomStubs";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ComposerWorktreeMenu } from "@/components/ComposerWorktreeMenu";
import { FLOATING_MENU_Z_INDEX } from "@/lib/floatingMenu";
import { parseWorktreePorcelain } from "@/lib/gitWorktree";

afterEach(cleanup);

const PORCELAIN = `worktree /Users/me/typebooks
HEAD abcdef0123456789
branch refs/heads/feat/pr-monitor-wake
`;

const LABELS = {
  worktrees: "Git worktrees",
  worktreesEmpty: "No linked worktrees",
  worktreesUnavailable: "Worktrees unavailable",
  worktreeCurrent: "current",
  worktreeMain: "main",
  worktreeDetached: "detached",
  worktreeTip: "Switch git worktree / branch",
  worktreeNew: "New worktree",
  worktreeNewChat: "New worktree & chat",
  worktreeGc: "Clean stale worktrees",
  pr: "Pull request",
  prEmpty: "No pull request for this branch",
  prWatch: "Watch this PR",
  prUnwatch: "Stop watching",
  prWatchTip: "Follow this PR in this chat",
  prUnwatchTip: "Stop following this PR",
  prOpenHub: "Open in PR hub",
  prChipTip: "Watching PR #{number}: {title}",
  prPendingWakes: "{count} follow-up(s) waiting",
  prWatchingLabel: "Watching",
  prLastUpdate: "Last update: {summary}",
  prUnavailable: "Pull requests unavailable (gh not ready)",
};

const LONG_TITLE =
  "feat(tasks): follow live subagent runs in the Tasks panel with a long tail";

function renderMenu(
  extra: Partial<Parameters<typeof ComposerWorktreeMenu>[0]> = {},
) {
  const onTogglePrWatch = vi.fn();
  const onOpenPrHub = vi.fn();
  render(
    <ComposerWorktreeMenu
      variant="context"
      activePath="/Users/me/typebooks"
      worktrees={parseWorktreePorcelain(PORCELAIN)}
      worktreesAvailable
      labels={LABELS}
      onSwitch={vi.fn()}
      onCreate={vi.fn()}
      onCreateAndChat={vi.fn()}
      onGc={vi.fn()}
      onTogglePrWatch={onTogglePrWatch}
      onOpenPrHub={onOpenPrHub}
      {...extra}
    />,
  );
  return { onTogglePrWatch, onOpenPrHub };
}

async function open() {
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: /Switch git worktree/ }),
  );
  return user;
}

describe("ComposerWorktreeMenu PR section", () => {
  it("shows the bound PR, the watching tag and the watch toggle", async () => {
    const { onTogglePrWatch } = renderMenu({
      pr: {
        number: 1316,
        title: LONG_TITLE,
        state: "OPEN",
        checksLine: "4 pass",
      },
      prWatching: true,
      prUpdates: ["New comment from RongleCat: Please rebase on main."],
      prPendingWakes: 2,
    });

    await open();

    // Portal contract: material class on a body-level pop, never transparent.
    const pop = document.body.querySelector<HTMLElement>(
      ":scope > .cmm__pop",
    );
    expect(pop).not.toBeNull();
    expect(pop!.className).toContain("cmm__pop--portal");
    expect(pop!.className).toContain("cwm__pop");
    expect(pop!.style.position).toBe("fixed");
    expect(pop!.style.zIndex).toBe(String(FLOATING_MENU_Z_INDEX));

    const row = screen.getByRole("menuitem", { name: /#1316/ });
    expect(row.textContent).toContain("OPEN · 4 pass");
    // Menu rows are wider than the chip, so the long title is kept here.
    expect(row.textContent).toContain("feat(tasks): follow live subagent runs");

    const toggle = screen.getByRole("menuitem", { name: /Stop watching/ });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");

    expect(screen.getByText("Watching")).toBeTruthy();
    expect(
      screen.getByText("Last update: New comment from RongleCat: Please rebase on main."),
    ).toBeTruthy();
    expect(screen.getByText("2 follow-up(s) waiting")).toBeTruthy();

    await userEvent.setup().click(toggle);
    expect(onTogglePrWatch).toHaveBeenCalledTimes(1);
  });

  it("offers to start watching and opens the PR hub", async () => {
    const { onTogglePrWatch, onOpenPrHub } = renderMenu({
      pr: { number: 42, title: "Fix CI", state: "OPEN", checksLine: "3 pass" },
      prWatching: false,
    });

    const user = await open();
    const toggle = screen.getByRole("menuitem", { name: /Watch this PR/ });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    // Not watching → no watching tag and no change line.
    expect(screen.queryByText("Watching")).toBeNull();

    // Each action closes the menu, so reopen between them.
    await user.click(toggle);
    expect(onTogglePrWatch).toHaveBeenCalledTimes(1);

    const user2 = await open();
    await user2.click(screen.getByRole("menuitem", { name: /#42/ }));
    await waitFor(() => expect(onOpenPrHub).toHaveBeenCalledWith(42));
  });

  it("renders no PR section at all when the branch has no PR", async () => {
    renderMenu({ pr: null, prWatching: false });
    await open();

    expect(screen.queryByText("Pull request")).toBeNull();
    expect(screen.queryByText("No pull request for this branch")).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /#/ })).toBeNull();
    // The branch menu itself still works.
    expect(screen.getByText("Git worktrees")).toBeTruthy();
  });

  it("surfaces a poll failure instead of looking healthy", async () => {
    renderMenu({
      pr: { number: 1316, title: "Fix CI", state: "OPEN" },
      prWatching: true,
      prWatchError: "gh: authentication failed",
    });
    await open();
    expect(
      screen.getByText("Pull requests unavailable (gh not ready)"),
    ).toBeTruthy();
  });
});
