/**
 * Esc → stop generation / leave Settings.
 *
 * Overlays, permission, ask-user, find, menus, and voice own Escape first.
 * Settings is a full-page view: Esc leaves it instead of stopping a
 * background turn. Nested GlassModal / Select layers still own Escape.
 */

export type EscapeStopOpts = {
  /** True when Stop is available (streaming / awaiting permission / latch). */
  streamingOrBusy: boolean;
  /** Search, dialogs, doctor, shortcuts help, export modal, etc. */
  overlayOpen: boolean;
  /** Permission bar owns Esc → deny. */
  permOpen: boolean;
  /** Ask-user questionnaire modal. */
  askUserOpen: boolean;
  /** In-chat find bar. */
  chatFindOpen: boolean;
  /** Slash palette, composer +, context menu, user menu, phone tools. */
  slashOrMenuOpen: boolean;
  /** Prompt history picker. */
  promptHistoryOpen?: boolean;
  /** In-progress voice dictation steals Esc. */
  voiceStealsEscape?: boolean;
  /** Settings view is showing (Esc leaves; does not stop). */
  settingsOpen?: boolean;
};

export type EscapeCloseSettingsOpts = Omit<
  EscapeStopOpts,
  "streamingOrBusy"
> & {
  settingsOpen: boolean;
  /** GlassModal / Select already owns Escape. */
  nestedLayerOpen?: boolean;
};

/** GlassModal overlay and Settings Select menus — Esc closes those first. */
export const SETTINGS_NESTED_ESCAPE_SELECTOR =
  ".overlay .modal, .c-select__menu";

function escapeOwnedByOverlay(
  opts: Pick<
    EscapeStopOpts,
    | "overlayOpen"
    | "permOpen"
    | "askUserOpen"
    | "chatFindOpen"
    | "slashOrMenuOpen"
    | "promptHistoryOpen"
    | "voiceStealsEscape"
  >,
): boolean {
  return Boolean(
    opts.voiceStealsEscape ||
      opts.overlayOpen ||
      opts.permOpen ||
      opts.askUserOpen ||
      opts.chatFindOpen ||
      opts.slashOrMenuOpen ||
      opts.promptHistoryOpen,
  );
}

/** Stop the turn only when busy and nothing else owns Escape. */
export function shouldEscapeStopGeneration(opts: EscapeStopOpts): boolean {
  if (!opts.streamingOrBusy) return false;
  if (opts.settingsOpen) return false;
  return !escapeOwnedByOverlay(opts);
}

/** Leave Settings for the workbench when nothing else owns Escape. */
export function shouldEscapeCloseSettings(
  opts: EscapeCloseSettingsOpts,
): boolean {
  if (!opts.settingsOpen) return false;
  if (opts.nestedLayerOpen) return false;
  return !escapeOwnedByOverlay(opts);
}

/** Nested Settings dialog / Select should get Escape before leaving the page. */
export function isSettingsEscapeOwnedByNestedLayer(
  root: ParentNode | null | undefined,
): boolean {
  if (!root || typeof root.querySelector !== "function") return false;
  return Boolean(root.querySelector(SETTINGS_NESTED_ESCAPE_SELECTOR));
}
