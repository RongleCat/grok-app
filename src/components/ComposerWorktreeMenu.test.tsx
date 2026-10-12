import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import React from "react";
import { ComposerWorktreeMenu } from "@/components/ComposerWorktreeMenu";
import {
  applyGitStatusBranch,
  parseWorktreePorcelain,
} from "@/lib/gitWorktree";

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
};

const PORCELAIN = `worktree /Users/me/typebooks
HEAD abcdef0123456789
branch refs/heads/master
`;

function renderChip(
  worktrees: ReturnType<typeof parseWorktreePorcelain>,
  extra: Record<string, unknown> = {},
) {
  return renderToString(
    React.createElement(ComposerWorktreeMenu, {
      activePath: "/Users/me/typebooks",
      worktrees,
      worktreesAvailable: true,
      labels: LABELS,
      variant: "context",
      onSwitch: vi.fn(),
      onCreate: vi.fn(),
      onCreateAndChat: vi.fn(),
      onGc: vi.fn(),
      ...extra,
    }),
  );
}

describe("ComposerWorktreeMenu branch chip", () => {
  it("shows the cached worktree branch on the trigger", () => {
    const html = renderChip(parseWorktreePorcelain(PORCELAIN));
    expect(html).toContain("composer__context-item--branch");
    expect(html).toContain("master");
  });

  it("updates the trigger after an in-place checkout without opening the menu", () => {
    const cached = parseWorktreePorcelain(PORCELAIN);
    expect(renderChip(cached)).toContain("master");
    expect(renderChip(cached)).not.toContain("feat/session-branch");

    const next = applyGitStatusBranch(cached, "/Users/me/typebooks", {
      available: true,
      branch: "feat/session-branch",
    });
    const html = renderChip(next);
    expect(html).toContain("feat/session-branch");
    expect(html).not.toContain("master");
  });
});

describe("ComposerWorktreeMenu chip watch count", () => {
  const labels = {
    ...LABELS,
    prChipCount: "{count} watching",
    prChipCountTip: "This chat follows {count} pull request(s)",
  };

  it("counts the PRs this chat follows, without naming one", () => {
    const html = renderChip(parseWorktreePorcelain(PORCELAIN), {
      prWatchingCount: 2,
      labels,
    });
    expect(html).toContain("composer__context-pr");
    expect(html).toContain("2 watching");
    expect(html).toContain("has-pr");
    expect(html).toContain("master");
    // A pull request belongs to the repository, so no number rides the chip.
    expect(html).not.toContain("#1316");
  });

  it("keeps the branch area clean while this chat follows nothing", () => {
    const html = renderChip(parseWorktreePorcelain(PORCELAIN), {
      prWatchingCount: 0,
      labels,
    });
    expect(html).not.toContain("composer__context-pr");
    expect(html).not.toContain("has-pr");
    expect(html).toContain("master");
  });
});
