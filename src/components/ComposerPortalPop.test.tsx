/**
 * @vitest-environment jsdom
 *
 * Portal contract for composer-row chip menus (dialogs.md hard rules):
 * every chip pop must portal directly into document.body (never clipped by
 * overflow parents), carry the glass-listed `cmm__pop cmm__pop--portal`
 * material classes plus its chip-specific class, sit on the floating-menu
 * z-index layer, keep trigger aria wiring, and close on Escape / outside
 * mousedown while clicks inside the panel keep working.
 *
 * Written against the per-file portal copies first; now guards the shared
 * ComposerPortalPop layer so a refactor cannot silently drop the material
 * class (transparent panel) or the body portal (clipped menu).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import "@/test/jsdomStubs";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ComposerModelMenu,
  placeHubFlyout,
} from "@/components/ComposerModelMenu";
import { ComposerProjectMenu } from "@/components/ComposerProjectMenu";
import { ComposerWorktreeMenu } from "@/components/ComposerWorktreeMenu";
import { ContextUsageChip } from "@/components/ContextUsageChip";
import { FLOATING_MENU_Z_INDEX } from "@/lib/floatingMenu";
import type { ContextUsageDisplay } from "@/lib/contextUsage";

afterEach(cleanup);

/** The chip pop must be a direct child of body — that is the portal contract. */
function bodyPop(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>(":scope > .cmm__pop");
}

function renderProjectMenu() {
  const onSelect = vi.fn();
  render(
    <ComposerProjectMenu
      activeProject={null}
      projects={[
        {
          id: "p1",
          name: "grok-app",
          path: "/code/grok-app",
          trusted: true,
          pathOk: true,
        },
      ]}
      labels={{
        noProject: "Default workspace",
        pickProject: "Project folder",
        addProject: "Add project",
      }}
      variant="context"
      onSelect={onSelect}
      onAdd={vi.fn()}
    />,
  );
  return { onSelect };
}

describe("composer chip portal pops", () => {
  it("project chip portals a material cmm pop into document.body", async () => {
    const user = userEvent.setup();
    renderProjectMenu();
    expect(bodyPop()).toBeNull();

    const trigger = screen.getByRole("button", { name: "Default workspace" });
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    await user.click(trigger);

    const pop = bodyPop();
    expect(pop).not.toBeNull();
    expect(pop!.parentElement).toBe(document.body);
    expect(pop!.className).toBe("cmm__pop cmm__pop--portal cpm__pop");
    expect(pop!.getAttribute("role")).toBe("menu");
    expect(pop!.getAttribute("aria-label")).toBe("Project folder");
    expect(pop!.style.position).toBe("fixed");
    expect(pop!.style.zIndex).toBe(String(FLOATING_MENU_Z_INDEX));
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("project chip closes on Escape and returns aria-expanded=false", async () => {
    const user = userEvent.setup();
    renderProjectMenu();
    const trigger = screen.getByRole("button", { name: "Default workspace" });
    await user.click(trigger);
    expect(bodyPop()).not.toBeNull();

    await user.keyboard("{Escape}");
    expect(bodyPop()).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("project chip closes on outside mousedown but not on inside clicks", async () => {
    const user = userEvent.setup();
    const { onSelect } = renderProjectMenu();
    const trigger = screen.getByRole("button", { name: "Default workspace" });

    await user.click(trigger);
    fireEvent.mouseDown(document.body);
    expect(bodyPop()).toBeNull();

    await user.click(trigger);
    const row = screen.getByRole("menuitem", { name: "grok-app" });
    await user.click(row);
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "p1" }),
    );
    expect(bodyPop()).toBeNull();
  });

  it("worktree chip portals its cwm pop with menu semantics", async () => {
    const user = userEvent.setup();
    render(
      <ComposerWorktreeMenu
        activePath="/code/grok-app"
        worktrees={[
          {
            path: "/code/grok-app",
            branch: "main",
            head: "abc123",
            isMain: true,
            detached: false,
            locked: false,
            prunable: false,
          },
        ]}
        worktreesAvailable={true}
        variant="context"
        labels={{
          worktrees: "Git worktrees",
          worktreesEmpty: "No linked worktrees",
          worktreesUnavailable: "Worktrees unavailable",
          worktreeCurrent: "current",
          worktreeMain: "main",
          worktreeDetached: "detached",
          worktreeTip: "Switch git worktree",
          worktreeNew: "New worktree",
          worktreeNewChat: "New worktree & chat",
          worktreeGc: "Clean stale worktrees",
        }}
        onSwitch={vi.fn()}
        onCreate={vi.fn()}
        onCreateAndChat={vi.fn()}
        onGc={vi.fn()}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Switch git worktree" }),
    );
    const pop = bodyPop();
    expect(pop).not.toBeNull();
    expect(pop!.parentElement).toBe(document.body);
    expect(pop!.className).toBe("cmm__pop cmm__pop--portal cwm__pop");
    expect(pop!.getAttribute("role")).toBe("menu");
    expect(pop!.getAttribute("aria-label")).toBe("Git worktrees");
  });

  it("context usage chip portals its ctx pop on the same layer", async () => {
    const user = userEvent.setup();
    const display: ContextUsageDisplay = {
      tokens: 12000,
      source: "known",
      label: "12k",
      lastCompact: null,
      breakdown: null,
      knownUsage: null,
      windowSize: 100000,
      percent: 12,
      cacheHitRate: null,
      cachedReadTokens: null,
    };
    render(
      <ContextUsageChip
        display={display}
        labels={{
          aria: "Context",
          tipUnknown: "unknown",
          tipEstimated: "estimated",
          tipKnown: "known",
          menuTitle: "Context usage",
          current: "Current",
          sourceKnown: "known",
          sourceEstimated: "estimated",
          sourceUnknown: "unknown",
          lastCompact: "Last compact",
          lastCompactNone: "never",
          tokensRange: "{before} → {after}",
          compactAction: "Compact now",
          heuristicNote: "heuristic",
          auto: "auto",
          manual: "manual",
          breakdownUser: "User",
          breakdownAssistant: "Assistant",
          breakdownThought: "Thought",
          breakdownEstimatedNote: "estimated rows",
          window: "Window",
          percentUsed: "Used",
          cacheHit: "Cache hit",
        }}
        onCompact={vi.fn()}
        locale="en"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Context: 12k" }));
    const pop = bodyPop();
    expect(pop).not.toBeNull();
    expect(pop!.parentElement).toBe(document.body);
    expect(pop!.className).toBe("cmm__pop cmm__pop--portal ctx-chip__pop");
    expect(pop!.getAttribute("role")).toBe("menu");
    expect(pop!.getAttribute("aria-label")).toBe("Context usage");
    expect(pop!.style.zIndex).toBe(String(FLOATING_MENU_Z_INDEX));
  });

  it("model chip keeps dialog semantics and aria-controls wiring", async () => {
    const user = userEvent.setup();
    render(
      <ComposerModelMenu
        modelId="test-model"
        effort="high"
        labels={{
          model: "Model",
          effort: "Effort",
          effortHigh: "High",
          effortMedium: "Medium",
          effortLow: "Low",
          modelSearchPlaceholder: "Search models",
          modelSearchEmpty: "No models",
          modelGroupOfficial: "Official",
          contextWindow: "Context window",
          contextWindowOfficial: "official",
          contextWindowCustom: "custom",
          contextWindowPlaceholder: "tokens",
          contextWindowSave: "Save",
          contextWindowOfficialHint: "unknown",
        }}
        onEffort={vi.fn()}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Model" });
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
    await user.click(trigger);

    const pop = bodyPop();
    expect(pop).not.toBeNull();
    expect(pop!.parentElement).toBe(document.body);
    expect(pop!.classList.contains("cmm__pop")).toBe(true);
    expect(pop!.classList.contains("cmm__pop--portal")).toBe(true);
    expect(pop!.classList.contains("cmm__pop--model")).toBe(true);
    expect(pop!.getAttribute("role")).toBe("dialog");
    expect(pop!.getAttribute("aria-label")).toBe("Model");
    expect(pop!.id).not.toBe("");
    expect(trigger.getAttribute("aria-controls")).toBe(pop!.id);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("opens a combined model menu with an effort slider and Advanced", async () => {
    const user = userEvent.setup();
    render(
      <ComposerModelMenu
        modelId="test-model"
        effort="high"
        labels={{
          model: "Model",
          effort: "Effort",
          effortHigh: "High",
          effortMedium: "Medium",
          effortLow: "Low",
          modelSearchPlaceholder: "Search models",
          modelSearchEmpty: "No models",
          modelGroupOfficial: "Official",
          contextWindow: "Context window",
          contextWindowOfficial: "official",
          contextWindowCustom: "custom",
          contextWindowPlaceholder: "tokens",
          contextWindowSave: "Save",
          contextWindowOfficialHint: "unknown",
          advanced: "Advanced",
        }}
        onEffort={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Effort" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Model" }));
    const pop = bodyPop();
    expect(pop).not.toBeNull();
    expect(pop!.querySelector('[role="slider"]')).not.toBeNull();
    expect(pop!.textContent ?? "").toMatch(/Effort High/);
    expect(screen.getByRole("button", { name: "Advanced" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Advanced" }));
    expect(screen.queryByRole("searchbox", { name: "Search models" })).toBeNull();
    expect(pop!.textContent ?? "").toMatch(/Model/);
    expect(pop!.textContent ?? "").toMatch(/Effort/);
    expect(pop!.classList.contains("cmm__pop--hub")).toBe(true);
    const hubModel = pop!.querySelector(".cmm__row");
    expect(hubModel).not.toBeNull();
    fireEvent.mouseEnter(hubModel!);
    const flyout = await waitFor(() => {
      const el = document.body.querySelector<HTMLElement>(
        ":scope > .cmm__pop--flyout",
      );
      expect(el).not.toBeNull();
      return el!;
    });
    expect(flyout.parentElement).toBe(document.body);
    expect(flyout.style.zIndex).toBe(pop!.style.zIndex);
    expect(flyout.classList.contains("cmm__pop--flyout-models")).toBe(true);
    expect(
      screen.getByRole("searchbox", { name: "Search models" }),
    ).toBeTruthy();
  });

  it("keeps Advanced hub and model flyout open after picking a model", async () => {
    const user = userEvent.setup();
    const onModel = vi.fn();
    render(
      <ComposerModelMenu
        modelId="grok-4.6"
        effort="high"
        labels={{
          model: "Model",
          effort: "Effort",
          effortHigh: "High",
          effortMedium: "Medium",
          effortLow: "Low",
          modelSearchPlaceholder: "Search models",
          modelSearchEmpty: "No models",
          modelGroupOfficial: "Official",
          contextWindow: "Context window",
          contextWindowOfficial: "official",
          contextWindowCustom: "custom",
          contextWindowPlaceholder: "tokens",
          contextWindowSave: "Save",
          contextWindowOfficialHint: "unknown",
          advanced: "Advanced",
        }}
        onModel={onModel}
        onEffort={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Model" }));
    await user.click(screen.getByRole("button", { name: "Advanced" }));
    const pop = bodyPop();
    expect(pop).not.toBeNull();
    fireEvent.mouseEnter(pop!.querySelector(".cmm__row")!);
    const pick = await waitFor(() => {
      const el = screen.getByRole("button", { name: /Grok 4\.5/ });
      expect(el).toBeTruthy();
      return el;
    });
    await user.click(pick);
    expect(onModel).toHaveBeenCalledWith("grok-4.5");
    expect(bodyPop()).not.toBeNull();
    expect(bodyPop()!.classList.contains("cmm__pop--hub")).toBe(true);
    expect(
      document.body.querySelector(":scope > .cmm__pop--flyout"),
    ).not.toBeNull();
    expect(screen.getByRole("button", { name: "Advanced" })).toBeTruthy();
    expect(
      screen.getByRole("searchbox", { name: "Search models" }),
    ).toBeTruthy();
  });

  it("pins a left flyout to the hub inner edge on the same z layer", () => {
    const hub = {
      left: 720,
      right: 1000,
      top: 200,
      bottom: 360,
      width: 280,
      height: 160,
      x: 720,
      y: 200,
      toJSON() {
        return this;
      },
    } as DOMRect;
    const prev = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    const { pos, side } = placeHubFlyout(hub, null, "effort");
    expect(side).toBe("left");
    expect(pos.zIndex).toBe(FLOATING_MENU_Z_INDEX);
    expect(pos.left).toBe("auto");
    expect(pos.right).toBe(1024 - 720 + 8);
    expect(pos.top).toBe(200);
    expect(pos.maxHeight).toBeLessThanOrEqual(280);
    const rightHub = { ...hub, left: 80, right: 360, x: 80 } as DOMRect;
    const right = placeHubFlyout(rightHub, null, "models");
    expect(right.side).toBe("right");
    expect(right.pos.left).toBe(360 + 8);
    expect(right.pos.maxHeight).toBe(240);
    const windowRow = {
      ...hub,
      top: 292,
      bottom: 324,
      y: 292,
      height: 32,
    } as DOMRect;
    const windowFly = placeHubFlyout(hub, null, "window", windowRow);
    expect(windowFly.side).toBe("left");
    expect(windowFly.pos.top).toBe(292);
    expect(windowFly.pos.right).toBe(1024 - 720 + 8);
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 800 });
    const tight = {
      ...hub,
      left: 420,
      right: 700,
      x: 420,
      width: 280,
    } as DOMRect;
    const flipped = placeHubFlyout(tight, null, "models");
    expect(flipped.side).toBe("left");
    expect(flipped.pos.left).toBe("auto");
    const flippedRight = Number(flipped.pos.right);
    const flippedW = Number(flipped.pos.width);
    expect(800 - flippedRight).toBeLessThanOrEqual(800 - 8);
    expect(800 - flippedRight - flippedW).toBeGreaterThanOrEqual(8);
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 400 });
    const squeezedHub = {
      ...hub,
      left: 40,
      right: 320,
      x: 40,
      width: 280,
    } as DOMRect;
    const clamped = placeHubFlyout(squeezedHub, null, "models");
    const cLeft = Number(clamped.pos.left === "auto" ? 8 : clamped.pos.left);
    const cW = Number(clamped.pos.width);
    if (clamped.pos.left === "auto") {
      const rightEdge = 400 - Number(clamped.pos.right);
      expect(rightEdge - cW).toBeGreaterThanOrEqual(8);
      expect(rightEdge).toBeLessThanOrEqual(400 - 8);
    } else {
      expect(cLeft).toBeGreaterThanOrEqual(8);
      expect(cLeft + cW).toBeLessThanOrEqual(400 - 8);
    }
    Object.defineProperty(window, "innerWidth", { configurable: true, value: prev });
  });

  it("reopens the effort slider after closing from Advanced", async () => {
    const user = userEvent.setup();
    render(
      <ComposerModelMenu
        modelId="test-model"
        effort="high"
        labels={{
          model: "Model",
          effort: "Effort",
          effortHigh: "High",
          effortMedium: "Medium",
          effortLow: "Low",
          modelSearchPlaceholder: "Search models",
          modelSearchEmpty: "No models",
          modelGroupOfficial: "Official",
          contextWindow: "Context window",
          contextWindowOfficial: "official",
          contextWindowCustom: "custom",
          contextWindowPlaceholder: "tokens",
          contextWindowSave: "Save",
          contextWindowOfficialHint: "unknown",
          advanced: "Advanced",
        }}
        onEffort={vi.fn()}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Model" });
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Advanced" }));
    expect(screen.queryByRole("searchbox", { name: "Search models" })).toBeNull();
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(bodyPop()).toBeNull(), { timeout: 1000 });
    await user.click(trigger);
    const pop = bodyPop();
    expect(pop).not.toBeNull();
    expect(pop!.querySelector('[role="slider"]')).not.toBeNull();
    expect(screen.queryByRole("searchbox", { name: "Search models" })).toBeNull();
  });

  it("localizes grok-4.6 xhigh via effort i18n in composer menu", async () => {
    const user = userEvent.setup();
    render(
      <ComposerModelMenu
        modelId="grok-4.6"
        effort="xhigh"
        labels={{
          model: "Model",
          effort: "Effort",
          effortHigh: "High",
          effortMedium: "Medium",
          effortLow: "Low",
          effortXhigh: "Extra high",
          effortExtra: "Extra",
          modelSearchPlaceholder: "Search models",
          modelSearchEmpty: "No models",
          modelGroupOfficial: "Official",
          contextWindow: "Context window",
          contextWindowOfficial: "official",
          contextWindowCustom: "custom",
          contextWindowPlaceholder: "tokens",
          contextWindowSave: "Save",
          contextWindowOfficialHint: "unknown",
          advanced: "Advanced",
        }}
        onEffort={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Model" }));
    const pop = bodyPop();
    expect(pop).not.toBeNull();
    expect(pop!.textContent ?? "").toMatch(/Effort Extra high/);
    expect(pop!.textContent ?? "").not.toMatch(/\bxhigh\b/);
    await user.click(screen.getByRole("button", { name: "Advanced" }));
    expect(screen.queryByRole("searchbox", { name: "Search models" })).toBeNull();
    expect(pop!.textContent ?? "").toMatch(/Extra high/);
    expect(pop!.textContent ?? "").not.toMatch(/\bxhigh\b/);
  });
});
