/**
 * Composer project chip — pick / clear / add folder.
 * Git worktrees live in {@link ComposerWorktreeMenu} (branch chip).
 */

import { useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  IconCheck,
  IconChevronDown,
  IconFolder,
  IconHome,
  IconPlus,
} from "@/components/icons";
import { Tip } from "@/components/ui/tooltip";
import { useFloatingMenu } from "@/lib/floatingMenu";
import { isProjectFolderMissing } from "@/lib/projectPath";

export type ProjectOption = {
  id: string;
  name: string;
  path: string;
  trusted: boolean;
  pathOk: boolean;
  pinned?: boolean;
  sshAlias?: string | null;
};

type Props = {
  activeProject: ProjectOption | null;
  projects: ProjectOption[];
  labels: {
    noProject: string;
    pickProject: string;
    addProject: string;
    /** Badge when project folder is missing on disk. */
    pathMissing?: string;
  };
  disabled?: boolean;
  /**
   * `chip` — composer toolbar (legacy).
   * `context` — new-session bar above the input (flat, no chevron).
   */
  variant?: "chip" | "context";
  onSelect: (project: ProjectOption | null) => void;
  onAdd: () => void;
};

const LIST_MAX_H = 220;

export function ComposerProjectMenu({
  activeProject,
  projects,
  labels,
  disabled,
  variant = "chip",
  onSelect,
  onAdd,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const estHeight = Math.min(
    360,
    52 + Math.min(LIST_MAX_H, projects.length * 40 + 8),
  );
  const { pos, style: popStyle } = useFloatingMenu({
    open,
    triggerRef,
    panelRef: popRef,
    roots: [rootRef],
    onClose: () => setOpen(false),
    placement: "auto",
    fitContent: true,
    minWidth: 240,
    estHeight,
    gap: 8,
    deps: [projects.length],
  });

  const label = activeProject?.name ?? labels.noProject;
  const activeMissing = isProjectFolderMissing(activeProject);
  const tip = activeMissing
    ? (labels.pathMissing
        ? `${labels.pathMissing}: ${activeProject?.path || ""}`.trim()
        : activeProject?.path) || labels.pickProject
    : activeProject?.path || labels.pickProject;

  const isContext = variant === "context";

  return (
    <div
      ref={rootRef}
      className={
        `cpm${open ? " is-open" : ""}` + (isContext ? " cpm--context" : "")
      }
    >
      <Tip label={tip} disabled={open}>
        <button
          ref={triggerRef}
          type="button"
          className={
            isContext
              ? "composer__context-item composer__context-item--project" +
                (open ? " is-open" : "") +
                (!activeProject ? " is-muted" : "") +
                (activeMissing ? " is-path-missing" : "")
              : "chip chip--project" +
                (open ? " is-open" : "") +
                (!activeProject ? " chip--muted" : "") +
                (activeMissing ? " chip--project-path-missing" : "")
          }
          disabled={disabled}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {activeProject ? <IconFolder size={14} /> : <IconHome size={14} />}
          <span className={isContext ? "composer__context-label" : "chip__label"}>
            {label}
          </span>
          {!isContext ? <IconChevronDown size={12} /> : null}
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
                <IconHome size={14} aria-hidden />
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
                  const missing = isProjectFolderMissing(p);
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
          </div>,
          document.body,
        )}
    </div>
  );
}
