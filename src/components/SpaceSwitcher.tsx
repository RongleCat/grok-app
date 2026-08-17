/**
 * Sidebar Space switcher — named buckets of projects (Work / Personal / …).
 * Presentational: callers own dialogs and persistence.
 */
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  IconCheck,
  IconChevronDown,
  IconPlus,
  IconQueue,
  IconRename,
  IconTrash,
} from "@/components/icons";
import { useFloatingMenu } from "@/lib/floatingMenu";
import {
  ALL_SPACES_ID,
  activeSpaceLabel,
  countProjectsInSpace,
  isAllSpacesView,
  isDefaultSpaceId,
  spaceDisplayName,
  type ProjectSpacesState,
} from "@/lib/projectSpaces";

export type SpaceSwitcherLabels = {
  projects: string;
  all: string;
  default: string;
  switch: string;
  new: string;
  rename: string;
  delete: string;
};

type Props = {
  state: ProjectSpacesState;
  projectIds: readonly string[];
  labels: SpaceSwitcherLabels;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string) => void;
  onDelete: (id: string) => void;
};

export function SpaceSwitcher({
  state,
  projectIds,
  labels,
  onSelect,
  onNew,
  onRename,
  onDelete,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const { pos, style } = useFloatingMenu({
    open,
    triggerRef,
    panelRef: popRef,
    roots: [rootRef],
    onClose: () => setOpen(false),
    placement: "down",
    align: "start",
    fitContent: true,
    minWidth: 200,
    estHeight: 52 + (state.spaces.length + 3) * 32,
    gap: 4,
    deps: [state.spaces.length, state.activeId, open],
  });

  const head = activeSpaceLabel(state, {
    all: labels.all,
    default: labels.default,
    projects: labels.projects,
  });
  const canEditCurrent =
    !isAllSpacesView(state.activeId) &&
    !!state.spaces.find((s) => s.id === state.activeId);
  const canDeleteCurrent =
    canEditCurrent &&
    !isDefaultSpaceId(state.activeId) &&
    state.spaces.length > 1;

  const closeAnd = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <div ref={rootRef} className={"space-switcher" + (open ? " is-open" : "")}>
      <button
        ref={triggerRef}
        type="button"
        className="space-switcher__btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={labels.switch}
        title={labels.switch}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="space-switcher__label">{head}</span>
        <IconChevronDown size={12} />
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={popRef}
              className="menu-panel context-menu space-switcher__menu"
              role="menu"
              style={style}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                role="menuitem"
                className={
                  "space-switcher__opt" +
                  (isAllSpacesView(state.activeId) ? " is-active" : "")
                }
                onClick={() => closeAnd(() => onSelect(ALL_SPACES_ID))}
              >
                <IconQueue size={15} />
                <span className="space-switcher__opt-label">{labels.all}</span>
                <span className="space-switcher__opt-count">
                  {countProjectsInSpace(state, ALL_SPACES_ID, projectIds)}
                </span>
                {isAllSpacesView(state.activeId) ? <IconCheck size={14} /> : null}
              </button>
              {state.spaces.map((space) => {
                const active = state.activeId === space.id;
                const name = spaceDisplayName(space, labels.default);
                return (
                  <button
                    key={space.id}
                    type="button"
                    role="menuitem"
                    className={
                      "space-switcher__opt" + (active ? " is-active" : "")
                    }
                    onClick={() => closeAnd(() => onSelect(space.id))}
                  >
                    <IconQueue size={15} />
                    <span className="space-switcher__opt-label">{name}</span>
                    <span className="space-switcher__opt-count">
                      {countProjectsInSpace(state, space.id, projectIds)}
                    </span>
                    {active ? <IconCheck size={14} /> : null}
                  </button>
                );
              })}
              <div className="space-switcher__sep" />
              <button
                type="button"
                role="menuitem"
                className="space-switcher__opt"
                onClick={() => closeAnd(onNew)}
              >
                <IconPlus size={15} />
                <span className="space-switcher__opt-label">{labels.new}</span>
              </button>
              {canEditCurrent ? (
                <button
                  type="button"
                  role="menuitem"
                  className="space-switcher__opt"
                  onClick={() => closeAnd(() => onRename(state.activeId))}
                >
                  <IconRename size={15} />
                  <span className="space-switcher__opt-label">{labels.rename}</span>
                </button>
              ) : null}
              {canDeleteCurrent ? (
                <button
                  type="button"
                  role="menuitem"
                  className="space-switcher__opt is-danger"
                  onClick={() => closeAnd(() => onDelete(state.activeId))}
                >
                  <IconTrash size={15} />
                  <span className="space-switcher__opt-label">{labels.delete}</span>
                </button>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
