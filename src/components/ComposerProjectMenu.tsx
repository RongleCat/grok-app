/**
 * Composer project chip — pick / clear / add folder; switch git worktrees.
 */

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  IconCheck,
  IconChevronDown,
  IconFolder,
  IconPlus,
} from "@/components/icons";
import { Tip } from "@/components/ui/tooltip";
import { useFloatingMenu } from "@/lib/floatingMenu";
import { pathsEqual, worktreeLabel } from "@/lib/gitWorktree";
import type { GitWorktreeEntry } from "@/lib/api";

export type ProjectOption = {
  id: string;
  name: string;
  path: string;
  trusted: boolean;
  pathOk: boolean;
  pinned?: boolean;
};

type Props = {
  activeProject: ProjectOption | null;
  projects: ProjectOption[];
  labels: {
    noProject: string;
    pickProject: string;
    addProject: string;
    worktrees: string;
    worktreesEmpty: string;
    worktreesUnavailable: string;
    worktreesLoading?: string;
    worktreeCurrent: string;
    worktreeSwitch: string;
    worktreeMain: string;
    worktreeDetached: string;
    /** Badge when project folder is missing on disk. */
    pathMissing?: string;
  };
  /** Linked worktrees for the active project (loaded by parent). */
  worktrees?: GitWorktreeEntry[];
  /**
   * `true` only after host confirmed a git work tree.
   * `false` = not a git repo / git missing — section hidden.
   * `null` / omitted = unknown (loading or no project) — section hidden.
   */
  worktreesAvailable?: boolean | null;
  worktreesLoading?: boolean;
  worktreesReason?: string | null;
  disabled?: boolean;
  onSelect: (project: ProjectOption | null) => void;
  onAdd: () => void;
  /** Switch agent cwd to this worktree path (add project if needed + bind). */
  onSwitchWorktree?: (wt: GitWorktreeEntry) => void;
  onOpen?: () => void;
};

const LIST_MAX_H = 220;

export function ComposerProjectMenu({
  activeProject,
  projects,
  labels,
  worktrees = [],
  worktreesAvailable = null,
  worktreesLoading = false,
  worktreesReason = null,
  disabled,
  onSelect,
  onAdd,
  onSwitchWorktree,
  onOpen,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  /** Avoid putting unstable parent callbacks in the open-effect deps (re-fetch loop). */
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  // Only for confirmed git work trees — hide while loading / non-git / no project.
  const showWorktrees = !!activeProject && worktreesAvailable === true;

  const estHeight = Math.min(
    400,
    52 +
      Math.min(LIST_MAX_H, projects.length * 40 + 8) +
      (showWorktrees
        ? 28 + Math.min(160, Math.max(worktrees.length, 1) * 36 + 8)
        : 0),
  );
  const { pos, style: popStyle } = useFloatingMenu({
    open,
    triggerRef,
    panelRef: popRef,
    roots: [rootRef],
    onClose: () => setOpen(false),
    placement: "up",
    fitContent: true,
    minWidth: 260,
    estHeight,
    gap: 8,
    deps: [projects.length, worktrees.length, showWorktrees],
  });

  // Refresh only when the menu opens — not when parent re-renders with a new onOpen.
  useEffect(() => {
    if (!open) return;
    onOpenRef.current?.();
  }, [open]);

  const label = activeProject?.name ?? labels.noProject;
  const activeMissing = activeProject?.pathOk === false;
  const tip = activeMissing
    ? (labels.pathMissing
        ? `${labels.pathMissing}: ${activeProject?.path || ""}`.trim()
        : activeProject?.path) || labels.pickProject
    : activeProject?.path || labels.pickProject;

  return (
    <div ref={rootRef} className={`cpm${open ? " is-open" : ""}`}>
      <Tip label={tip} disabled={open}>
        <button
          ref={triggerRef}
          type="button"
          className={
            "chip chip--project" +
            (open ? " is-open" : "") +
            (!activeProject ? " chip--muted" : "") +
            (activeMissing ? " chip--project-path-missing" : "")
          }
          disabled={disabled}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <IconFolder size={14} />
          <span className="chip__label">{label}</span>
          <IconChevronDown size={12} />
        </button>
      </Tip>
      {open &&
        pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popRef}
            className="cmm__pop cmm__pop--portal cpm__pop"
            role="menu"
            aria-label={labels.pickProject}
            style={popStyle as CSSProperties}
          >
            <div className="cpm__actions">
              <button
                type="button"
                role="menuitem"
                className={
                  "cpm__action" + (!activeProject ? " is-active" : "")
                }
                onClick={() => {
                  onSelect(null);
                  setOpen(false);
                }}
              >
                <IconFolder size={14} aria-hidden />
                <span>{labels.noProject}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="cpm__action cpm__action--add"
                onClick={() => {
                  setOpen(false);
                  onAdd();
                }}
              >
                <IconPlus size={14} aria-hidden />
                <span>{labels.addProject}</span>
              </button>
            </div>
            {projects.length > 0 ? (
              <div
                className="cpm__list"
                style={{ maxHeight: LIST_MAX_H }}
                role="group"
                aria-label={labels.pickProject}
              >
                {projects.map((p) => {
                  const active = activeProject?.id === p.id;
                  const missing = p.pathOk === false;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      role="menuitem"
                      className={
                        "cmm__opt cpm__item" +
                        (active ? " is-active" : "") +
                        (missing ? " cpm__item--path-missing" : "")
                      }
                      title={
                        missing && labels.pathMissing
                          ? `${labels.pathMissing}: ${p.path}`
                          : p.path
                      }
                      onClick={() => {
                        onSelect(p);
                        setOpen(false);
                      }}
                    >
                      <span className="cmm__opt-main">
                        <span className="cmm__opt-title">{p.name}</span>
                        {missing && labels.pathMissing ? (
                          <span className="cpm__path-badge">
                            {labels.pathMissing}
                          </span>
                        ) : null}
                      </span>
                      {active ? (
                        <span className="cmm__opt-check" aria-hidden>
                          <IconCheck size={16} />
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ) : null}

            {showWorktrees ? (
              <div className="cpm__worktrees" role="group" aria-label={labels.worktrees}>
                <div className="cpm__worktrees-head">{labels.worktrees}</div>
                {worktrees.length > 0 ? (
                  <ul
                    className={
                      "cpm__worktrees-list" +
                      (worktreesLoading ? " is-loading" : "")
                    }
                    aria-busy={worktreesLoading || undefined}
                  >
                    {worktrees.map((wt) => {
                      const current = pathsEqual(wt.path, activeProject?.path);
                      const name = worktreeLabel(wt);
                      const meta = [
                        wt.isMain ? labels.worktreeMain : null,
                        wt.detached ? labels.worktreeDetached : null,
                        current ? labels.worktreeCurrent : null,
                      ]
                        .filter(Boolean)
                        .join(" · ");
                      return (
                        <li key={wt.path}>
                          <button
                            type="button"
                            role="menuitem"
                            className={
                              "cmm__opt cpm__item cpm__worktree" +
                              (current ? " is-active" : "")
                            }
                            title={wt.path}
                            disabled={current || !onSwitchWorktree}
                            onClick={() => {
                              if (current || !onSwitchWorktree) return;
                              setOpen(false);
                              onSwitchWorktree(wt);
                            }}
                          >
                            <span className="cpm__worktree-row">
                              <span className="cpm__worktree-name">{name}</span>
                              {meta ? (
                                <span className="cpm__worktree-meta">{meta}</span>
                              ) : null}
                            </span>
                            {current ? (
                              <span className="cmm__opt-check" aria-hidden>
                                <IconCheck size={16} />
                              </span>
                            ) : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="cpm__worktrees-empty">
                    {worktreesReason?.trim()
                      ? labels.worktreesUnavailable
                      : labels.worktreesEmpty}
                  </p>
                )}
              </div>
            ) : null}
          </div>,
          document.body,
        )}
    </div>
  );
}
