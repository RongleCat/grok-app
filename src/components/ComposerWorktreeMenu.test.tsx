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

describe("ComposerWorktreeMenu PR banded with the branch", () => {
  const LONG_TITLE =
    "feat(tasks): follow live subagent runs in the Tasks panel with extra words";
  const pr = {
    number: 1316,
    title: LONG_TITLE,
    state: "OPEN",
    checksLine: "4 pass",
  };

  it("bands #number + truncated title into the branch area while watched", () => {
    const html = renderChip(parseWorktreePorcelain(PORCELAIN), {
      pr,
      prWatching: true,
    });
    expect(html).toContain("composer__context-pr-num");
    // React splits the text nodes, so match the number across the marker.
    expect(html).toMatch(/#(<!-- -->)?1316/);
    expect(html).toContain("composer__context-pr-title");
    // Truncated, not the full title.
    expect(html).not.toContain(LONG_TITLE);
    expect(html).toContain("…");
    expect(html).toContain("composer__context-item--branch has-pr");
  });

  it("keeps the branch area clean when the PR is not being watched", () => {
    const html = renderChip(parseWorktreePorcelain(PORCELAIN), {
      pr,
      prWatching: false,
    });
    expect(html).not.toContain("composer__context-pr");
    expect(html).not.toContain("#1316");
    expect(html).toContain("master");
  });

  it("renders no PR at all when the branch has none", () => {
    const html = renderChip(parseWorktreePorcelain(PORCELAIN), {
      pr: null,
      prWatching: false,
    });
    expect(html).not.toContain("composer__context-pr");
    expect(html).not.toContain("#");
  });
});
