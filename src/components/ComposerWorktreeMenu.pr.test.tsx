/**
 * @vitest-environment jsdom
 *
 * Branch menu's PR section: one row per open PR of the repository, each with its
 * own watch control, plus the chip count. Drives the shipped component through
 * real clicks, and pins the portal/material contract (dialogs.md: never a
 * transparent or clipped menu).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import "@/test/jsdomStubs";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ComposerWorktreeMenu } from "@/components/ComposerWorktreeMenu";
import { FLOATING_MENU_Z_INDEX } from "@/lib/floatingMenu";
import { parseWorktreePorcelain } from "@/lib/gitWorktree";
import type { PrListRow } from "@/lib/prMonitor";

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
  prEmpty: "No open pull requests",
  prWatch: "Watch this PR",
  prUnwatch: "Stop watching",
  prWatchTip: "Follow this PR in this chat",
  prUnwatchTip: "Stop following this PR",
  prOpenHub: "Open in PR hub",
  prChipCount: "{count} watching",
  prChipCountTip: "This chat follows {count} pull request(s)",
  prPendingWakes: "{count} follow-up(s) waiting",
  prWatchingLabel: "Watching",
  prLastUpdate: "Last update: {summary}",
  prUnavailable: "Pull requests unavailable (gh not ready)",
};

const LONG_TITLE =
  "feat(tasks): follow live subagent runs in the Tasks panel with a long tail";

const ROWS: PrListRow[] = [
  {
    number: 1316,
    title: LONG_TITLE,
    state: "OPEN",
    checksLine: "4 pass",
    branch: "feat/pr-monitor-wake",
    watching: true,
    busy: false,
  },
  {
    number: 2,
    title: "Second fixture PR",
    state: "OPEN",
    checksLine: "2 pass",
    branch: "test/pr-monitor-wake-2",
    watching: false,
    busy: false,
  },
];

function renderMenu(
  extra: Partial<Parameters<typeof ComposerWorktreeMenu>[0]> = {},
) {
  const onTogglePrWatch = vi.fn();
  const onOpenPrHub = vi.fn();
  const onPrListVisible = vi.fn();
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
      onPrListVisible={onPrListVisible}
      {...extra}
    />,
  );
  return { onTogglePrWatch, onOpenPrHub, onPrListVisible };
}

async function open() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /Switch git worktree/ }));
  return user;
}

describe("ComposerWorktreeMenu PR section", () => {
  it("lists every open PR of the repository, one row with its own watch control", async () => {
    const { onTogglePrWatch } = renderMenu({
      prRows: ROWS,
      prWatchingCount: 1,
      prLastChange: "New comment from RongleCat: Please rebase on main.",
      prPendingWakes: 2,
    });

    const user = await open();

    // Portal contract: material class on a body-level pop, never transparent.
    const pop = document.body.querySelector<HTMLElement>(":scope > .cmm__pop");
    expect(pop).not.toBeNull();
    expect(pop!.className).toContain("cmm__pop--portal");
    expect(pop!.className).toContain("cwm__pop");
    expect(pop!.style.position).toBe("fixed");
    expect(pop!.style.zIndex).toBe(String(FLOATING_MENU_Z_INDEX));

    // Both fixtures are offered, whichever branch each one sits on.
    const watchedRow = screen.getByRole("menuitem", { name: /#1316/ });
    const otherRow = screen.getByRole("menuitem", { name: /#2 Second fixture PR/ });
    expect(watchedRow.textContent).toContain("OPEN · 4 pass · feat/pr-monitor-wake");
    expect(otherRow.textContent).toContain("OPEN · 2 pass · test/pr-monitor-wake-2");
    // Menu rows are wider than the chip, so the long title is kept here.
    expect(watchedRow.textContent).toContain("feat(tasks): follow live subagent runs");

    // One bell per row, on the PR it controls.
    const bells = screen.getAllByRole("button", { name: /Watch this PR|Stop watching/ });
    expect(bells).toHaveLength(2);
    const [watchedBell, otherBell] = bells;
    expect(watchedBell.getAttribute("aria-pressed")).toBe("true");
    expect(otherBell.getAttribute("aria-pressed")).toBe("false");

    expect(screen.getByText("Watching")).toBeTruthy();
    expect(
      screen.getByText("Last update: New comment from RongleCat: Please rebase on main."),
    ).toBeTruthy();
    expect(screen.getByText("2 follow-up(s) waiting")).toBeTruthy();

    // Toggling leaves the menu open, so several mounts can be handled in one pass.
    await user.click(otherBell);
    expect(onTogglePrWatch).toHaveBeenCalledWith(2);
    expect(screen.getByText("Pull request")).toBeTruthy();

    await user.click(watchedBell);
    expect(onTogglePrWatch).toHaveBeenCalledWith(1316);
  });

  it("counts the PRs this chat follows on the branch chip", async () => {
    renderMenu({ prRows: ROWS, prWatchingCount: 2 });
    const trigger = screen.getByRole("button", { name: /This chat follows 2/ });
    expect(trigger.className).toContain("has-pr");
    expect(trigger.textContent).toContain("2 watching");
    // The chip names no PR: a pull request belongs to the repository.
    expect(trigger.textContent).not.toContain("#1316");
  });

  it("keeps the branch area clean while this chat follows nothing", async () => {
    renderMenu({ prRows: ROWS, prWatchingCount: 0 });
    const trigger = screen.getByRole("button", { name: /Switch git worktree/ });
    expect(trigger.className).not.toContain("has-pr");
    expect(trigger.textContent).not.toContain("composer__context-pr");
    expect(trigger.textContent).toContain("feat/pr-monitor-wake");
  });

  it("opens the PR hub from a row and closes the menu", async () => {
    const { onOpenPrHub } = renderMenu({ prRows: ROWS, prWatchingCount: 1 });
    const user = await open();
    await user.click(screen.getByRole("menuitem", { name: /#2 Second fixture PR/ }));
    await waitFor(() => expect(onOpenPrHub).toHaveBeenCalledWith(2));
    expect(screen.queryByText("Pull request")).toBeNull();
  });

  it("renders no PR section when this repository has no readable PR list", async () => {
    renderMenu({ prRows: [], prLoading: false, prAvailable: false });
    await open();

    expect(screen.queryByText("Pull request")).toBeNull();
    expect(screen.queryByText("No open pull requests")).toBeNull();
    // The branch menu itself still works.
    expect(screen.getByText("Git worktrees")).toBeTruthy();
  });

  it("does not claim there are no PRs while the list is still loading", async () => {
    renderMenu({ prRows: [], prLoading: true, prAvailable: null });
    await open();
    expect(screen.queryByText("No open pull requests")).toBeNull();
    expect(screen.getByText("…")).toBeTruthy();
  });

  it("says so when the repository has no open PRs", async () => {
    renderMenu({ prRows: [], prLoading: false, prAvailable: true });
    await open();
    expect(screen.getByText("Pull request")).toBeTruthy();
    expect(screen.getByText("No open pull requests")).toBeTruthy();
  });

  it("disables the bells when this chat cannot mount a watch", async () => {
    renderMenu({ prRows: ROWS, prWatchingCount: 0, prCanWatch: false });
    await open();
    const bells = screen.getAllByRole("button", {
      name: /Watch this PR|Stop watching/,
    });
    expect(bells).toHaveLength(2);
    for (const bell of bells) {
      expect((bell as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("reads the repository's PRs once per open", async () => {
    const { onPrListVisible } = renderMenu({ prRows: ROWS, prWatchingCount: 1 });
    await open();
    await waitFor(() => expect(onPrListVisible).toHaveBeenCalledTimes(1));
  });

  it("reads again when the menu opens after a failed list", async () => {
    const { onPrListVisible } = renderMenu({
      prRows: [],
      prLoading: false,
      prAvailable: false,
    });
    const user = await open();
    await waitFor(() => expect(onPrListVisible).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Pull request")).toBeNull();

    await user.click(screen.getByRole("button", { name: /Switch git worktree/ }));
    await user.click(screen.getByRole("button", { name: /Switch git worktree/ }));
    await waitFor(() => expect(onPrListVisible).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Pull request")).toBeNull();
  });

  it("surfaces a poll failure instead of looking healthy", async () => {
    renderMenu({
      prRows: ROWS,
      prWatchingCount: 1,
      prWatchError: "gh: authentication failed",
    });
    await open();
    expect(screen.getByText("Pull requests unavailable (gh not ready)")).toBeTruthy();
  });
});
