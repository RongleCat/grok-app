/**
 * @vitest-environment jsdom
 *
 * Wiring guard for the command palette after it left AppWorkbench. Row indices
 * are computed per section (actions, then projects, then sessions) and have to
 * stay in lockstep with `flattenSearchPanelItems` in the shell, otherwise the
 * keyboard highlight lands on a different row than the one Enter activates.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import "@/test/jsdomStubs";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { flattenSearchPanelItems } from "@/lib/searchPanelNav";
import type { PaletteActionDef } from "@/lib/paletteActions";
import type { MergedSessionHit, SearchableProject } from "@/lib/sessionSearch";
import type { Project, SessionRow } from "@/lib/app/sidebarModels";
import { SearchPalette } from "./SearchPalette";

afterEach(cleanup);

const actions: PaletteActionDef[] = [
  { id: "new-chat", labelKey: "search.newChat", keywords: ["new"] },
  { id: "add-project", labelKey: "search.addProject", keywords: ["add"] },
];

const projects: SearchableProject[] = [
  { id: "p1", name: "grok-app", path: "/code/grok-app" },
];

const sessionHits: MergedSessionHit[] = [
  { id: "s1", title: "First chat", titleMatch: true, contentMatch: false },
  { id: "s2", title: "Second chat", titleMatch: true, contentMatch: false },
];

const sessions: SessionRow[] = [
  { id: "s1", title: "First chat", projectId: "p1", updatedAt: "2026-08-20" },
  { id: "s2", title: "Second chat", projectId: null, updatedAt: "2026-08-19" },
];

const projectsCatalog: Project[] = [
  {
    id: "p1",
    name: "grok-app",
    path: "/code/grok-app",
    trusted: true,
    pathOk: true,
  },
];

function renderPalette(
  over: Partial<Parameters<typeof SearchPalette>[0]> = {},
) {
  const handlers = {
    onClose: vi.fn(),
    onQueryChange: vi.fn(),
    onModeChange: vi.fn(),
    onRankModeChange: vi.fn(),
    onIncludeArchivedChange: vi.fn(),
    onClearFilters: vi.fn(),
    onActiveIndexChange: vi.fn(),
    onRunAction: vi.fn(),
    onPickProject: vi.fn(),
    onPickSession: vi.fn(),
  };
  render(
    <SearchPalette
      locale="en"
      panelRef={createRef<HTMLDivElement>()}
      query="ch"
      mode="all"
      rankMode="keyword"
      includeArchived={false}
      filtersActive={false}
      activeIndex={0}
      itemCount={actions.length + projects.length + sessionHits.length}
      actions={actions}
      projects={projects}
      sessionHits={sessionHits}
      sessions={sessions}
      projectsCatalog={projectsCatalog}
      contentSearchLoading={false}
      emptyState={null}
      settingsShortcutHint="Ctrl+,"
      {...handlers}
      {...over}
    />,
  );
  return handlers;
}

const rowIndices = () =>
  screen
    .getAllByRole("option")
    .map((el) => Number(el.getAttribute("data-search-idx")));

describe("SearchPalette", () => {
  it("numbers rows continuously across actions, projects, and sessions", () => {
    renderPalette();
    expect(rowIndices()).toEqual([0, 1, 2, 3, 4]);
  });

  it("agrees with the shell's flatten order that drives keyboard nav", () => {
    renderPalette();
    const flat = flattenSearchPanelItems({
      actions,
      projects,
      sessions: sessionHits,
    });
    const domIds = screen
      .getAllByRole("option")
      .map((el) => el.getAttribute("id"));

    expect(domIds).toEqual(flat.map((_, i) => `search-opt-${i}`));
    expect(flat.map((item) => item.id)).toEqual([
      "new-chat",
      "add-project",
      "p1",
      "s1",
      "s2",
    ]);
  });

  it("keeps section offsets correct when the actions group is empty", () => {
    renderPalette({ actions: [] });
    expect(rowIndices()).toEqual([0, 1, 2]);
    const [projectRow] = screen.getAllByRole("option");
    expect(projectRow).toHaveTextContent("/code/grok-app");
    expect(projectRow).toHaveAttribute("data-search-idx", "0");
  });

  it("marks only the active row and points the combobox at it", () => {
    renderPalette({ activeIndex: 3 });
    const rows = screen.getAllByRole("option");

    expect(rows.filter((r) => r.getAttribute("aria-selected") === "true"))
      .toHaveLength(1);
    expect(rows[3]).toHaveAttribute("aria-selected", "true");
    expect(rows[3]).toHaveClass("is-active");
    expect(screen.getByRole("combobox")).toHaveAttribute(
      "aria-activedescendant",
      "search-opt-3",
    );
  });

  it("drops aria-activedescendant when there is nothing to point at", () => {
    renderPalette({
      actions: [],
      projects: [],
      sessionHits: [],
      itemCount: 0,
    });
    expect(screen.getByRole("combobox")).not.toHaveAttribute(
      "aria-activedescendant",
    );
  });

  it("routes each row kind to its own callback", async () => {
    const { onRunAction, onPickProject, onPickSession } = renderPalette();
    const rows = screen.getAllByRole("option");

    await userEvent.click(rows[0]);
    expect(onRunAction).toHaveBeenCalledWith(actions[0]);

    await userEvent.click(rows[2]);
    expect(onPickProject).toHaveBeenCalledWith(projects[0]);

    await userEvent.click(rows[3]);
    expect(onPickSession).toHaveBeenCalledWith(sessions[0], projectsCatalog[0]);
  });

  it("passes a null project for a chat that belongs to none", async () => {
    const { onPickSession } = renderPalette();

    await userEvent.click(screen.getAllByRole("option")[4]);

    expect(onPickSession).toHaveBeenCalledWith(sessions[1], null);
  });

  it("synthesizes a row for a content hit missing from the session list", async () => {
    const orphan: MergedSessionHit = {
      id: "s9",
      title: "Only in the journal",
      titleMatch: false,
      contentMatch: true,
      matchCount: 3,
    };
    const { onPickSession } = renderPalette({ sessionHits: [orphan] });

    await userEvent.click(
      screen.getByRole("option", { name: /Only in the journal/ }),
    );

    expect(onPickSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: "s9", title: "Only in the journal" }),
      null,
    );
  });

  it("hovering a row moves the highlight through the shell", async () => {
    const { onActiveIndexChange } = renderPalette();

    await userEvent.hover(screen.getAllByRole("option")[2]);

    expect(onActiveIndexChange).toHaveBeenCalledWith(2);
  });

  it("keeps hits inside the OverlayScroll viewport so the wheel works", () => {
    renderPalette();
    const listbox = screen.getByRole("listbox");
    expect(listbox.closest(".search-panel__results")).not.toBeNull();
  });

  it("closes on backdrop click but not on a click inside the panel", async () => {
    const { onClose } = renderPalette();

    await userEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("presentation"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
