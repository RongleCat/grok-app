/**
 * Side Workbench chrome: tabs, dock composer, Review focus, close-tab.
 * Host fills {@link SideWorkbenchChromeHost} in place so aside/open/toast
 * verbs stay late-bound. Session file-change lists stay on the host.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { createT } from "@/i18n";
import type { ResourceOpenTarget } from "@/components/resource-viewer/types";
import * as api from "@/lib/api";
import { APP_CLOSE_TAB_OR_WINDOW_EVENT } from "@/lib/confirmQuit";
import { pinReviewFocusPath } from "@/lib/reviewFocusPaths";
import { applySideContextOpen } from "@/lib/sideContextOpen";
import { isSideDockComposerActive } from "@/lib/sideFloatComposer";
import {
  applySideStripClose,
  emptySideWorkbenchState,
  openSideTab,
  openSideTabFromPicker,
  type SidePickerKind,
  type SideWorkbenchState,
} from "@/lib/sideWorkbench";
import { useSideWorkbenchProjectIsolation } from "@/hooks/useSideWorkbenchProjectIsolation";

type TFn = ReturnType<typeof createT>;

export type SideReviewFocus = {
  path: string;
  token: number;
  pinnedPaths: string[];
};

export type SideWorkbenchChromeHost = {
  tr: TFn;
  showToast: (msg: string, ms?: number) => void;
  openAsidePane: () => void;
  setResourceOpenTarget: Dispatch<SetStateAction<ResourceOpenTarget | null>>;
  setPlanFocusKey: Dispatch<SetStateAction<number>>;
  asideCollapsed: () => boolean;
};

function emptyHost(): SideWorkbenchChromeHost {
  const noop = () => {};
  return {
    tr: ((k: string) => k) as TFn,
    showToast: noop,
    openAsidePane: noop,
    setResourceOpenTarget: noop,
    setPlanFocusKey: noop,
    asideCollapsed: () => true,
  };
}

export function createSideWorkbenchChromeHost(): SideWorkbenchChromeHost {
  return emptyHost();
}

export function useSideWorkbenchChrome(opts: {
  hostRef: MutableRefObject<SideWorkbenchChromeHost>;
  projectId: string | null | undefined;
  projectPath: string | null;
  asideCollapsed: boolean;
  phoneLayout: boolean;
  resourceOpenTarget: ResourceOpenTarget | null;
}) {
  const hostRef = opts.hostRef;
  const [sideWorkbench, setSideWorkbench] = useState<SideWorkbenchState>(
    emptySideWorkbenchState,
  );
  const sideWorkbenchRef = useRef(sideWorkbench);
  sideWorkbenchRef.current = sideWorkbench;
  const [closeActiveSideRequest, setCloseActiveSideRequest] = useState<{
    token: number;
  } | null>(null);
  const closeActiveSideTokenRef = useRef(0);
  const [sideDockComposer, setSideDockComposer] = useState(false);
  const [sideDockComposerH, setSideDockComposerH] = useState(0);
  const [sideIsGitProject, setSideIsGitProject] = useState(false);
  const [reviewFocus, setReviewFocus] = useState<SideReviewFocus | null>(null);
  const planOpenedAsideRef = useRef(false);

  useSideWorkbenchProjectIsolation(
    opts.projectId,
    sideWorkbench,
    setSideWorkbench,
  );

  useEffect(() => {
    const path = opts.projectPath?.trim();
    if (!path) {
      setSideIsGitProject(false);
      return;
    }
    let cancelled = false;
    void api
      .gitStatus(path)
      .then((r) => {
        if (!cancelled) setSideIsGitProject(!!r?.available);
      })
      .catch(() => {
        if (!cancelled) setSideIsGitProject(false);
      });
    return () => {
      cancelled = true;
    };
  }, [opts.projectPath]);

  useEffect(() => {
    const target = opts.resourceOpenTarget;
    if (!target) return;
    if (!opts.asideCollapsed) return;
    const h = hostRef.current;
    const result = applySideContextOpen(sideWorkbench, target, {
      isGitProject: sideIsGitProject,
    });
    const skipNotGitToast =
      target.type === "changes" && !!(target.path || "").trim();
    if (result.noticeKey && !skipNotGitToast) {
      h.showToast(h.tr(result.noticeKey), 2400);
    }
    if (result.needAsideOpen) {
      setSideWorkbench(result.state);
      h.openAsidePane();
      return;
    }
    h.setResourceOpenTarget(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- consume once per target
  }, [opts.resourceOpenTarget, opts.asideCollapsed]);

  useEffect(() => {
    if (sideWorkbench.expanded) return;
    setSideDockComposer(false);
    setSideDockComposerH(0);
  }, [sideWorkbench.expanded]);

  const openSkills = useCallback(() => {
    setSideWorkbench((s) => openSideTab(s, "skills"));
    hostRef.current.openAsidePane();
  }, [hostRef]);

  const openPlan = useCallback(() => {
    planOpenedAsideRef.current = true;
    setSideWorkbench((s) =>
      openSideTab(s, "plan", { name: "side.tab.plan" }),
    );
    hostRef.current.openAsidePane();
    hostRef.current.setPlanFocusKey((k) => k + 1);
  }, [hostRef]);

  const openPicker = useCallback(
    (kind: SidePickerKind) => {
      setSideWorkbench((s) => {
        const next = openSideTabFromPicker(s, kind, {
          isGitProject: sideIsGitProject,
        });
        if (!("created" in next)) return s;
        return next;
      });
      hostRef.current.openAsidePane();
    },
    [hostRef, sideIsGitProject],
  );

  const openReview = useCallback(() => {
    setSideWorkbench((s) => openSideTab(s, "review"));
    hostRef.current.openAsidePane();
  }, [hostRef]);

  const focusReviewPath = useCallback((path: string) => {
    const p = path.trim();
    if (!p) return;
    setReviewFocus((prev) => ({
      path: p,
      token: (prev?.token ?? 0) + 1,
      pinnedPaths: pinReviewFocusPath(prev?.pinnedPaths ?? [], p),
    }));
  }, []);

  const onAsideCloseExtras = useCallback(() => {
    planOpenedAsideRef.current = false;
    setSideWorkbench((s) => (s.expanded ? { ...s, expanded: false } : s));
    setSideDockComposer(false);
  }, []);

  const onExpandedChange = useCallback(
    (expanded: boolean) => {
      if (opts.phoneLayout) return;
      if (!expanded) setSideDockComposer(false);
    },
    [opts.phoneLayout],
  );

  const toggleDockComposer = useCallback(() => {
    setSideDockComposer((on) => !on);
  }, []);

  const consumeCloseActive = useCallback(() => {
    setCloseActiveSideRequest(null);
  }, []);

  const closeSideTabOrWindow = useCallback(() => {
    const s = sideWorkbenchRef.current;
    const result = applySideStripClose(s, {
      asideCollapsed: hostRef.current.asideCollapsed(),
    });
    if (result.closeWindow) {
      void (async () => {
        try {
          const { getCurrentWindow } = await import("@tauri-apps/api/window");
          await getCurrentWindow().close();
        } catch (e) {
          console.warn("close window after empty side tabs failed", e);
        }
      })();
      return;
    }
    closeActiveSideTokenRef.current += 1;
    setCloseActiveSideRequest({ token: closeActiveSideTokenRef.current });
  }, [hostRef]);

  useEffect(() => {
    if (!api.isTauri()) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        unlisten = await api.listen(APP_CLOSE_TAB_OR_WINDOW_EVENT, () => {
          closeSideTabOrWindow();
        });
        if (cancelled) unlisten();
      } catch (e) {
        console.warn("close-tab-or-window listener failed", e);
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [closeSideTabOrWindow]);

  const sideDockActive = isSideDockComposerActive({
    expanded: sideWorkbench.expanded,
    dockComposer: sideDockComposer,
    phoneLayout: opts.phoneLayout,
  });

  return {
    sideWorkbench,
    setSideWorkbench,
    sideWorkbenchRef,
    closeActiveSideRequest,
    sideDockComposer,
    setSideDockComposer,
    sideDockComposerH,
    setSideDockComposerH,
    sideIsGitProject,
    reviewFocus,
    setReviewFocus,
    planOpenedAsideRef,
    sideDockActive,
    openSkills,
    openPlan,
    openPicker,
    openReview,
    focusReviewPath,
    onAsideCloseExtras,
    onExpandedChange,
    toggleDockComposer,
    consumeCloseActive,
    closeSideTabOrWindow,
  };
}
