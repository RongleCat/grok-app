/**
 * @vitest-environment jsdom
 *
 * Wake-path test: a real host update payload goes through the shipped diff and
 * prompt builders and reaches the session transport.
 *
 * Only the outside edges are stubbed — the gh-backed reads and the session
 * transport. The diff, the wake key, the dedup memory and the prompt under test
 * are the shipped implementations.
 */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitPrCommentsResult, GitPrHubListResult, GitPrChecksResult } from "@/lib/gitPrHub";
import type { PrMonitorSnapshot, PrMonitorUpdateEvent } from "@/lib/prMonitor";

const gitPrList = vi.hoisted(() => vi.fn());
const gitPrComments = vi.hoisted(() => vi.fn());
const gitPrChecks = vi.hoisted(() => vi.fn());
const prMonitorList = vi.hoisted(() => vi.fn());
const prMonitorWatch = vi.hoisted(() => vi.fn());
const prMonitorUnwatch = vi.hoisted(() => vi.fn());
const prMonitorPollNow = vi.hoisted(() => vi.fn());
const prMonitorConsumePending = vi.hoisted(() => vi.fn());
const sessionSend = vi.hoisted(() => vi.fn());
const onPrMonitorUpdate = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({
  gitPrList,
  gitPrComments,
  gitPrChecks,
  prMonitorList,
  prMonitorWatch,
  prMonitorUnwatch,
  prMonitorPollNow,
  prMonitorConsumePending,
  sessionSend,
  onPrMonitorUpdate,
}));

import { usePrMonitor } from "@/hooks/usePrMonitor";

const PROJECT = "/Users/me/repo";
const BRANCH = "feat/subagent-live-monitor";
const SESSION = "004a47dc-5443-448a-81fe-7c1cf3ea37ec";

/** Host event listener captured from the subscription. */
let emit: ((payload: PrMonitorUpdateEvent) => void) | null = null;
const unlisten = vi.fn();

function prListResult(over: Partial<GitPrHubListResult> = {}): GitPrHubListResult {
  return {
    available: true,
    ghFound: true,
    gitFound: true,
    reason: null,
    prs: [
      {
        number: 1316,
        title: "feat(tasks): follow live subagent runs in the Tasks panel",
        url: "https://github.com/RongleCat/grok-app/pull/1316",
        author: "BoringLink",
        state: "OPEN",
        isDraft: false,
        headRefName: BRANCH,
        baseRefName: "main",
        mergeable: "MERGEABLE",
        checks: {
          pass: 4,
          fail: 0,
          pending: 0,
          skipping: 0,
          cancel: 0,
          total: 4,
          overall: "pass",
        },
      },
      {
        number: 1200,
        title: "unrelated",
        url: "https://github.com/RongleCat/grok-app/pull/1200",
        author: "someone",
        state: "OPEN",
        isDraft: false,
        headRefName: "feat/other",
      },
    ],
    ...over,
  };
}

function snap(over: Partial<PrMonitorSnapshot> = {}): PrMonitorSnapshot {
  return {
    number: 1316,
    title: "feat(tasks): follow live subagent runs in the Tasks panel",
    url: "https://github.com/RongleCat/grok-app/pull/1316",
    state: "OPEN",
    isDraft: false,
    mergeable: "MERGEABLE",
    headRefName: BRANCH,
    baseRefName: "main",
    updatedAt: "2026-10-10T09:00:00Z",
    checks: {
      pass: 4,
      fail: 0,
      pending: 0,
      skipping: 0,
      cancel: 0,
      total: 4,
      overall: "pass",
    },
    comments: [
      {
        id: "c1",
        author: "BoringLink",
        kind: "comment",
        state: null,
        createdAt: "2026-10-10T08:00:00Z",
        excerpt: "CI is green.",
      },
    ],
    ...over,
  };
}

function update(
  prev: PrMonitorSnapshot,
  next: PrMonitorSnapshot,
): PrMonitorUpdateEvent {
  return {
    watcherId: `${PROJECT}\u001f${BRANCH}`,
    projectPath: PROJECT,
    branch: BRANCH,
    prNumber: 1316,
    sessionId: SESSION,
    url: next.url,
    title: next.title,
    prev,
    next,
    at: "2026-10-10T09:30:00Z",
  };
}

/** New comment posted on the PR (also the CI-green follow-up case). */
function newCommentEvent(): PrMonitorUpdateEvent {
  const prev = snap();
  return update(
    prev,
    snap({
      updatedAt: "2026-10-10T09:30:00Z",
      comments: [
        {
          id: "c2",
          author: "RongleCat",
          kind: "comment",
          state: null,
          createdAt: "2026-10-10T09:30:00Z",
          excerpt: "Please rebase on main.",
        },
        ...prev.comments,
      ],
    }),
  );
}

/** CI went from pending to failing. */
function ciFailedEvent(): PrMonitorUpdateEvent {
  const prev = snap({
    checks: {
      pass: 0,
      fail: 0,
      pending: 1,
      skipping: 0,
      cancel: 0,
      total: 1,
      overall: "pending",
    },
  });
  return update(
    prev,
    snap({
      updatedAt: "2026-10-10T10:00:00Z",
      checks: {
        pass: 0,
        fail: 1,
        pending: 0,
        skipping: 0,
        cancel: 0,
        total: 1,
        overall: "fail",
      },
    }),
  );
}

function setup(over: { sessionBusy?: boolean } = {}) {
  const notify = vi.fn();
  const hook = renderHook(
    (props: { sessionBusy: boolean }) =>
      usePrMonitor({
        enabled: true,
        projectPath: PROJECT,
        branch: BRANCH,
        sessionId: SESSION,
        locale: "en",
        sessionBusy: props.sessionBusy,
        notify,
      }),
    { initialProps: { sessionBusy: over.sessionBusy ?? false } },
  );
  return { hook, notify };
}

beforeEach(() => {
  vi.clearAllMocks();
  emit = null;
  gitPrList.mockResolvedValue(prListResult());
  prMonitorList.mockResolvedValue([]);
  prMonitorWatch.mockResolvedValue({
    ok: true,
    watcher: { watcherId: `${PROJECT}\u001f${BRANCH}`, projectPath: PROJECT, branch: BRANCH, prNumber: 1316, intervalSecs: 60, mountedAt: "t", polls: 0, updates: 0, terminal: false },
    error: null,
  });
  prMonitorUnwatch.mockResolvedValue({ ok: true, removed: true });
  prMonitorPollNow.mockResolvedValue({ ok: true, changed: false, watcher: null, error: null });
  prMonitorConsumePending.mockResolvedValue(null);
  sessionSend.mockResolvedValue({});
  gitPrComments.mockResolvedValue({
    available: true,
    ghFound: true,
    comments: [
      {
        id: "c2",
        author: "RongleCat",
        body: "Please rebase on main. The base moved.",
        excerpt: "Please rebase on main.",
        url: "https://github.com/RongleCat/grok-app/pull/1316#issuecomment-2",
        createdAt: "2026-10-10T09:30:00Z",
        kind: "comment",
        state: null,
      },
    ],
  } satisfies GitPrCommentsResult);
  gitPrChecks.mockResolvedValue({
    available: true,
    ghFound: true,
    checks: [
      {
        name: "frontend",
        state: "FAILURE",
        bucket: "fail",
        link: null,
        description: "vitest failed in prMonitor.test.ts",
        workflow: "ci",
      },
    ],
  } satisfies GitPrChecksResult);
  onPrMonitorUpdate.mockImplementation(
    async (handler: (payload: PrMonitorUpdateEvent) => void) => {
      emit = handler;
      return unlisten;
    },
  );
});

afterEach(() => {
  cleanup();
});

describe("usePrMonitor", () => {
  it("binds the branch's PR", async () => {
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    expect(hook.result.current.pr?.number).toBe(1316);
    expect(hook.result.current.available).toBe(true);
  });

  it("offers no PR when the branch has none or gh is unavailable", async () => {
    gitPrList.mockResolvedValue(prListResult({ prs: [] }));
    const none = setup();
    await waitFor(() => expect(none.hook.result.current.ready).toBe(true));
    expect(none.hook.result.current.pr).toBeNull();
    expect(none.hook.result.current.available).toBe(true);

    gitPrList.mockResolvedValue(
      prListResult({ available: false, prs: [], reason: "gh not available" }),
    );
    const noGh = setup();
    await waitFor(() => expect(noGh.hook.result.current.ready).toBe(true));
    expect(noGh.hook.result.current.pr).toBeNull();
    expect(noGh.hook.result.current.available).toBe(false);
    expect(noGh.hook.result.current.reason).toBe("gh not available");
  });

  it("stays out of the way on a detached HEAD but keeps the wake channel", async () => {
    const hook = renderHook(() =>
      usePrMonitor({
        enabled: true,
        projectPath: PROJECT,
        branch: null,
        sessionId: SESSION,
        locale: "en",
        sessionBusy: false,
      }),
    );
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    expect(hook.result.current.pr).toBeNull();
    expect(hook.result.current.watching).toBe(false);
    // No branch → nothing to bind to, so no PR read.
    expect(gitPrList).not.toHaveBeenCalled();
    // A watch mounted before the checkout is still able to reach its session.
    await waitFor(() => expect(emit).toBeTypeOf("function"));
  });

  it("wakes the session with a prompt aimed at the new comment", async () => {
    const { hook, notify } = setup();
    await waitFor(() => expect(emit).toBeTypeOf("function"));
    expect(hook.result.current.watching).toBe(false);

    await act(async () => {
      emit?.(newCommentEvent());
    });

    await waitFor(() => expect(sessionSend).toHaveBeenCalledTimes(1));
    const [text, , sid] = sessionSend.mock.calls[0];
    expect(sid).toBe(SESSION);
    expect(text).toContain("#1316");
    expect(text).toContain("Please rebase on main. The base moved.");
    expect(text).toContain("New comment from RongleCat");
    // gh-backed read was used for the full body, not the 200-char excerpt.
    expect(gitPrComments).toHaveBeenCalledWith(PROJECT, 1316);
    // Delivered → the host's copy is released so a remount cannot re-deliver.
    await waitFor(() =>
      expect(prMonitorConsumePending).toHaveBeenCalledWith(PROJECT, BRANCH),
    );
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        expect.stringContaining("PR #1316 changed"),
        "info",
      ),
    );
    expect(hook.result.current.lastUpdates?.map((u) => u.kind)).toEqual([
      "comment",
    ]);
  });

  it("wakes the session the watch was mounted for, not the focused one", async () => {
    setup();
    await waitFor(() => expect(emit).toBeTypeOf("function"));

    const event = { ...newCommentEvent(), sessionId: "session-that-mounted-it" };
    await act(async () => {
      emit?.(event);
    });

    await waitFor(() => expect(sessionSend).toHaveBeenCalledTimes(1));
    expect(sessionSend.mock.calls[0][2]).toBe("session-that-mounted-it");
  });

  it("wakes once per real change, even if the event is replayed", async () => {
    setup();
    await waitFor(() => expect(emit).toBeTypeOf("function"));
    const event = newCommentEvent();

    await act(async () => {
      emit?.(event);
      emit?.(event);
    });
    await waitFor(() => expect(sessionSend).toHaveBeenCalledTimes(1));

    // A later, different change still wakes.
    await act(async () => {
      emit?.(
        update(
          event.next,
          snap({
            updatedAt: "2026-10-10T11:00:00Z",
            state: "MERGED",
            comments: event.next.comments,
          }),
        ),
      );
    });
    await waitFor(() => expect(sessionSend).toHaveBeenCalledTimes(2));
    expect(prMonitorUnwatch).toHaveBeenCalledWith(PROJECT, BRANCH);
  });

  it("ignores a no-op poll and drops its host copy", async () => {
    const { hook } = setup();
    await waitFor(() => expect(emit).toBeTypeOf("function"));

    const same = snap();
    await act(async () => {
      emit?.(update(same, same));
    });
    expect(sessionSend).not.toHaveBeenCalled();
    expect(hook.result.current.lastUpdates).toBeNull();
    await waitFor(() =>
      expect(prMonitorConsumePending).toHaveBeenCalledWith(PROJECT, BRANCH),
    );
  });

  it("queues a CI failure while the session is busy and delivers it when idle", async () => {
    const { hook, notify } = setup({ sessionBusy: true });
    await waitFor(() => expect(emit).toBeTypeOf("function"));

    await act(async () => {
      emit?.(ciFailedEvent());
    });
    expect(sessionSend).not.toHaveBeenCalled();
    // The user is told the follow-up is queued, not lost.
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("will follow up when this chat is free"),
      "info",
    );
    await waitFor(() => expect(hook.result.current.pendingCount).toBe(1));

    hook.rerender({ sessionBusy: false });
    await waitFor(() => expect(sessionSend).toHaveBeenCalledTimes(1));
    const [text] = sessionSend.mock.calls[0];
    expect(text).toContain("CI is failing");
    expect(text).toContain("fix the failing CI checks");
    expect(text).toContain("**frontend** — FAILURE");
    expect(gitPrChecks).toHaveBeenCalledWith(PROJECT, 1316);
    expect(notify).not.toHaveBeenCalledWith(
      expect.stringContaining("Could not wake"),
      "error",
    );
  });

  it("mounts, seeds and unmounts the host watch from the chip toggle", async () => {
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.pr?.number).toBe(1316));

    await act(async () => {
      hook.result.current.toggleWatch();
    });
    await waitFor(() =>
      expect(prMonitorWatch).toHaveBeenCalledWith({
        projectPath: PROJECT,
        branch: BRANCH,
        prNumber: 1316,
        sessionId: SESSION,
      }),
    );
    expect(prMonitorPollNow).toHaveBeenCalledWith(PROJECT, BRANCH);
    await waitFor(() => expect(hook.result.current.watching).toBe(true));

    await act(async () => {
      hook.result.current.toggleWatch();
    });
    await waitFor(() => expect(prMonitorUnwatch).toHaveBeenCalledWith(PROJECT, BRANCH));
    await waitFor(() => expect(hook.result.current.watching).toBe(false));
  });

  it("reports a failed mount instead of pretending to watch", async () => {
    prMonitorWatch.mockResolvedValue({ ok: false, watcher: null, error: "gh not available" });
    const { hook, notify } = setup();
    await waitFor(() => expect(hook.result.current.pr?.number).toBe(1316));

    await act(async () => {
      hook.result.current.toggleWatch();
    });
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        expect.stringContaining("gh not available"),
        "error",
      ),
    );
    expect(hook.result.current.watching).toBe(false);
  });

  it("drains a change the UI missed while unmounted", async () => {
    const pending = newCommentEvent();
    prMonitorList.mockResolvedValue([
      {
        watcherId: `${PROJECT}\u001f${BRANCH}`,
        projectPath: PROJECT,
        branch: BRANCH,
        prNumber: 1316,
        sessionId: SESSION,
        intervalSecs: 60,
        mountedAt: "t",
        polls: 3,
        updates: 1,
        terminal: false,
        pending,
      },
    ]);
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.watching).toBe(true));

    await waitFor(() => expect(sessionSend).toHaveBeenCalledTimes(1));
    expect(sessionSend.mock.calls[0][0]).toContain("Please rebase on main.");
    expect(prMonitorConsumePending).toHaveBeenCalledWith(PROJECT, BRANCH);
  });
});
