/**
 * @vitest-environment jsdom
 *
 * usePrMonitor tests.
 *
 * The host owns the watches, so this hook only reads twice (the repository's
 * open PRs, this chat's watches) and then renders what the host pushes. The
 * tests drive it through real pushes from a stubbed transport — the transport is
 * the only thing replaced, never the logic under test.
 */
import "@/test/jsdomStubs";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitPrHubListResult } from "@/lib/gitPrHub";
import type { PrMonitorStateEvent, PrMonitorWakeEvent } from "@/lib/prMonitor";
const gitPrList = vi.hoisted(() => vi.fn());
const prMonitorState = vi.hoisted(() => vi.fn());
const prMonitorWatch = vi.hoisted(() => vi.fn());
const prMonitorUnwatch = vi.hoisted(() => vi.fn());
const onPrMonitorState = vi.hoisted(() => vi.fn());
const onPrMonitorWake = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({
  gitPrList,
  prMonitorState,
  prMonitorWatch,
  prMonitorUnwatch,
  onPrMonitorState,
  onPrMonitorWake,
  isDesktopHost: () => true,
}));

import { usePrMonitor } from "@/hooks/usePrMonitor";

const PROJECT = "/Users/me/repo";
const SESSION = "session-1";

let pushState: ((payload: PrMonitorStateEvent) => void) | null = null;
let pushWake: ((payload: PrMonitorWakeEvent) => void) | null = null;

function listResult(over: Partial<GitPrHubListResult> = {}): GitPrHubListResult {
  return {
    available: true,
    ghFound: true,
    reason: null,
    prs: [
      {
        number: 1316,
        title: "Follow live subagent runs",
        url: "https://github.com/RongleCat/grok-app/pull/1316",
        author: "BoringLink",
        state: "OPEN",
        isDraft: false,
        headRefName: "feat/subagent-live-monitor",
        baseRefName: "main",
        updatedAt: "2026-10-11T09:00:00Z",
        checks: { pass: 4, fail: 0, pending: 0, skipping: 0, cancel: 0, total: 4, overall: "pass" },
      },
      {
        number: 2,
        title: "Second fixture PR",
        url: "https://github.com/RongleCat/grok-app/pull/2",
        author: "BoringLink",
        state: "OPEN",
        isDraft: false,
        headRefName: "test/pr-monitor-wake-2",
        baseRefName: "main",
        updatedAt: "2026-10-12T09:00:00Z",
      },
    ],
    ...over,
  };
}

function watchInfo(over: Record<string, unknown> = {}) {
  return {
    sessionId: SESSION,
    projectPath: PROJECT,
    prNumber: 1316,
    intervalSecs: 60,
    mountedAt: "2026-10-11T10:00:00Z",
    polls: 1,
    updates: 0,
    terminal: false,
    pending: false,
    ...over,
  };
}

function setup(over: Partial<Parameters<typeof usePrMonitor>[0]> = {}) {
  const notify = vi.fn();
  const hook = renderHook(() =>
    usePrMonitor({
      enabled: true,
      projectPath: PROJECT,
      sessionId: SESSION,
      locale: "en",
      notify,
      ...over,
    }),
  );
  return { hook, notify };
}

beforeEach(() => {
  vi.clearAllMocks();
  pushState = null;
  pushWake = null;
  gitPrList.mockResolvedValue(listResult());
  prMonitorState.mockResolvedValue({ sessionId: SESSION, watches: [] });
  prMonitorWatch.mockResolvedValue({ ok: true });
  prMonitorUnwatch.mockResolvedValue({ ok: true, removed: true });
  onPrMonitorState.mockImplementation(
    async (handler: (payload: PrMonitorStateEvent) => void) => {
      pushState = handler;
      return () => {
        pushState = null;
      };
    },
  );
  onPrMonitorWake.mockImplementation(
    async (handler: (payload: PrMonitorWakeEvent) => void) => {
      pushWake = handler;
      return () => {
        pushWake = null;
      };
    },
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("usePrMonitor", () => {
  it("offers the repository's open PRs, newest update first", async () => {
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    expect(hook.result.current.prs.map((p) => p.number)).toEqual([2, 1316]);
    expect(hook.result.current.available).toBe(true);
    // One read for the list, never a poll.
    expect(gitPrList).toHaveBeenCalledTimes(1);
  });

  it("reads this chat's watches once and then renders the host's pushes", async () => {
    prMonitorState.mockResolvedValue({
      sessionId: SESSION,
      watches: [watchInfo({ pending: true })],
    });
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.watching).toBe(1));
    expect(prMonitorState).toHaveBeenCalledWith(SESSION);
    expect(hook.result.current.pendingCount).toBe(1);

    // The host pushes the new truth; the hook does not ask again.
    pushState!({ sessionId: SESSION, watches: [] });
    await waitFor(() => expect(hook.result.current.watching).toBe(0));
    expect(prMonitorState).toHaveBeenCalledTimes(1);
  });

  it("ignores another session's pushes", async () => {
    prMonitorState.mockResolvedValue({
      sessionId: SESSION,
      watches: [watchInfo()],
    });
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.watching).toBe(1));

    pushState!({ sessionId: "another-session", watches: [] });
    await Promise.resolve();
    expect(hook.result.current.watching).toBe(1);
  });

  it("tells the user when the host wakes this chat", async () => {
    const { notify } = setup();
    await waitFor(() => expect(pushWake).toBeTypeOf("function"));

    pushWake!({
      sessionId: SESSION,
      prNumber: 1316,
      status: "delivered",
      summary: "New comment from RongleCat: Please rebase.",
      prState: "OPEN",
      pending: false,
      at: "2026-10-11T10:00:00Z",
    });
    expect(notify).toHaveBeenCalledWith(
      "PR #1316 changed — the agent is following up",
      "info",
    );

    pushWake!({
      sessionId: SESSION,
      prNumber: 1316,
      status: "settled",
      summary: "PR state: OPEN → MERGED",
      prState: "MERGED",
      pending: false,
      at: "2026-10-11T10:05:00Z",
    });
    expect(notify).toHaveBeenCalledWith("PR MERGED — stopped watching", "info");

    pushWake!({
      sessionId: "another-session",
      prNumber: 2,
      status: "failed",
      summary: "",
      prState: "OPEN",
      reason: "nope",
      pending: false,
      at: "2026-10-11T10:06:00Z",
    });
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("mounts a watch for a PR of this project and stops it again", async () => {
    prMonitorState.mockResolvedValue({
      sessionId: SESSION,
      watches: [watchInfo({ prNumber: 2 })],
    });
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.watching).toBe(1));

    hook.result.current.toggleWatch(1316);
    await waitFor(() => expect(prMonitorWatch).toHaveBeenCalledTimes(1));
    expect(prMonitorWatch).toHaveBeenCalledWith({
      sessionId: SESSION,
      projectPath: PROJECT,
      prNumber: 1316,
    });
    await waitFor(() => expect(hook.result.current.busy).toEqual([]));

    hook.result.current.toggleWatch(2);
    await waitFor(() => expect(prMonitorUnwatch).toHaveBeenCalledWith(SESSION, 2));
    expect(prMonitorWatch).toHaveBeenCalledTimes(1);
  });

  it("reports a refused mount instead of pretending to watch", async () => {
    prMonitorWatch.mockResolvedValue({ ok: false, error: "too many PR watches" });
    const { hook, notify } = setup();
    await waitFor(() => expect(hook.result.current.ready).toBe(true));

    hook.result.current.toggleWatch(1316);
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        "Could not watch this PR: Error: too many PR watches",
        "error",
      ),
    );
    expect(hook.result.current.watching).toBe(0);
  });

  it("reports a refused stop with its own copy", async () => {
    prMonitorState.mockResolvedValue({
      sessionId: SESSION,
      watches: [watchInfo()],
    });
    prMonitorUnwatch.mockRejectedValue(new Error("host is wedged"));
    const { hook, notify } = setup();
    await waitFor(() => expect(hook.result.current.watching).toBe(1));

    hook.result.current.toggleWatch(1316);
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        "Could not stop watching this PR: Error: host is wedged",
        "error",
      ),
    );
  });

  it("reads the repository's PRs when the list is shown", async () => {
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    expect(gitPrList).toHaveBeenCalledTimes(1);

    hook.result.current.refresh();
    await waitFor(() => expect(gitPrList).toHaveBeenCalledTimes(2));
  });

  it("reads once while a read is already in flight", async () => {
    let release: (() => void) | null = null;
    gitPrList.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(listResult());
        }),
    );
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.loading).toBe(true));

    // The list becoming visible while the first read runs is the same answer.
    hook.result.current.refresh();
    hook.result.current.refresh();
    expect(gitPrList).toHaveBeenCalledTimes(1);

    release!();
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    expect(gitPrList).toHaveBeenCalledTimes(1);
    expect(hook.result.current.prs.map((p) => p.number)).toEqual([2, 1316]);
  });

  it("reads the new project when the project changes during a read", async () => {
    const resolvers: Array<(value: GitPrHubListResult) => void> = [];
    gitPrList.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const hook = renderHook(
      ({ projectPath }: { projectPath: string | null }) =>
        usePrMonitor({
          enabled: true,
          projectPath,
          sessionId: SESSION,
          locale: "en",
        }),
      { initialProps: { projectPath: PROJECT as string | null } },
    );
    await waitFor(() => expect(hook.result.current.loading).toBe(true));
    expect(gitPrList).toHaveBeenCalledTimes(1);

    hook.rerender({ projectPath: "/Users/me/other" });
    expect(gitPrList).toHaveBeenCalledTimes(1);

    resolvers[0]!(listResult());
    await waitFor(() => expect(gitPrList).toHaveBeenCalledTimes(2));
    expect(gitPrList).toHaveBeenLastCalledWith("/Users/me/other", {
      limit: 30,
      state: "open",
    });

    resolvers[1]!(listResult({ prs: [] }));
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(hook.result.current.ready).toBe(true);
    expect(hook.result.current.prs).toEqual([]);
  });

  it("stops loading when the project goes away during a read", async () => {
    const resolvers: Array<(value: GitPrHubListResult) => void> = [];
    gitPrList.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const hook = renderHook(
      ({ projectPath }: { projectPath: string | null }) =>
        usePrMonitor({
          enabled: true,
          projectPath,
          sessionId: SESSION,
          locale: "en",
        }),
      { initialProps: { projectPath: PROJECT as string | null } },
    );
    await waitFor(() => expect(hook.result.current.loading).toBe(true));

    hook.rerender({ projectPath: null });
    resolvers[0]!(listResult());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(gitPrList).toHaveBeenCalledTimes(1);
    expect(hook.result.current.prs).toEqual([]);
    expect(hook.result.current.ready).toBe(true);
  });

  it("knows when this chat can mount a watch", async () => {
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    expect(hook.result.current.canWatch).toBe(true);
  });

  it("soft-fails when gh is not ready, and asks for nothing", async () => {
    gitPrList.mockResolvedValue(
      listResult({ available: false, ghFound: false, prs: [], reason: "gh not found" }),
    );
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    expect(hook.result.current.available).toBe(false);
    expect(hook.result.current.reason).toBe("gh not found");
    expect(hook.result.current.prs).toEqual([]);
  });

  it("does nothing without a project or a chat", async () => {
    const { hook } = setup({ projectPath: null, sessionId: null });
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    expect(gitPrList).not.toHaveBeenCalled();
    expect(prMonitorState).not.toHaveBeenCalled();
    expect(hook.result.current.prs).toEqual([]);
    expect(hook.result.current.watching).toBe(0);
  });
});
