/**
 * In-app dialog + context-menu state shapes.
 * window.prompt/confirm are unreliable in Tauri WebView — use these instead.
 */

export type ContextMenuState =
  | { kind: "project"; id: string; x: number; y: number }
  | { kind: "project-policy"; id: string; x: number; y: number }
  | { kind: "project-sandbox"; id: string; x: number; y: number }
  | { kind: "project-color"; id: string; x: number; y: number }
  | { kind: "session"; id: string; x: number; y: number }
  | { kind: "archive-older"; x: number; y: number }
  | null;

/** In-app dialogs — window.prompt/confirm are unreliable in Tauri WebView. */
export type AppDialog =
  | {
      kind: "confirm";
      title: string;
      message: string;
      confirmLabel?: string;
      danger?: boolean;
      onConfirm: () => void | Promise<void>;
      /**
       * Called when the user dismisses without confirming (Cancel, Escape,
       * overlay click, close button). Used e.g. to cancel host pending-quit.
       */
      onDismiss?: () => void;
    }
  | {
      kind: "prompt";
      title: string;
      initial: string;
      /** Optional secondary copy above the input (e.g. compact confirm). */
      message?: string;
      placeholder?: string;
      /** Primary submit button label (default: common.save). */
      submitLabel?: string;
      /**
       * Return `false` to keep the prompt open, or a string to keep it open
       * and show that message inline next to the actions.
       */
      onSubmit: (
        value: string,
      ) => boolean | string | void | Promise<boolean | string | void>;
      /** Called when dismissed without submit (Cancel / Escape / overlay). */
      onDismiss?: () => void;
    }
  | null;
