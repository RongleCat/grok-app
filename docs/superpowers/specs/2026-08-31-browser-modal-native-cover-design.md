# Browser-Safe GlassModal Native Cover

## Problem

When the built-in Browser side pane is open, opening the send-queue edit
dialog leaves the dialog and its backdrop underneath the browser page. The
right side of the dialog is visually clipped and its controls cannot be used.

Reproduction:

1. Open a session with the Browser side pane visible.
2. Add a message to the session send queue.
3. Choose Edit for the queued message.
4. Observe that the browser page paints over the dialog and backdrop.

## Root Cause

`QueueEditModal` renders through the shared `GlassModal` component. The modal
is correctly portaled to `document.body` and uses the established modal
z-index, but the embedded browser is a Tauri child WebView. Native child
WebViews paint above the main DOM WebView, so no CSS z-index can place a DOM
modal above them.

The project already solves this boundary with the reference-counted
`nativeWebviewCover` protocol. `EmbeddedBrowser` subscribes to that protocol
and temporarily hides its native surface while a cover token is held. Floating
menus, Settings navigation, pane motion, and `ThemeEditorModal` already use the
protocol. Shared `GlassModal` dialogs do not, which leaves every standard modal
susceptible to the same layering bug.

## Requirements

- Every open `GlassModal` must acquire one native WebView cover token.
- Closing or unmounting the modal must release exactly that token.
- Multiple simultaneously mounted modals must remain covered until the final
  modal releases its token.
- Opening and closing a modal must preserve the embedded browser instance,
  URL, history, and page state; only native visibility changes.
- Existing focus trapping, Escape handling, overlay click handling, portals,
  styling, and public `GlassModal` props must remain unchanged.
- The queue editor must receive the behavior through `GlassModal`, without a
  queue-specific workaround.
- No new state may be added to `App.tsx` or `AppWorkbench.tsx`.
- No new user-facing copy or i18n keys are needed.

## Design

Add a `useEffect` to `GlassModal` that follows the same lifecycle pattern as
the existing dialog focus effect:

1. If `open` is false, do nothing.
2. If `open` becomes true, call `acquireNativeWebviewCover()`.
3. Return the idempotent release function as the effect cleanup.

`nativeWebviewCover` already owns reference counting and event delivery.
`EmbeddedBrowser` already reacts to cover state by calling `hide()` and restores
the same WebView through its normal visibility synchronization when the cover
depth returns to zero. No CSS, browser command, or queue state change is
required.

This belongs in `GlassModal` rather than `QueueEditModal`: the invariant is
"a DOM modal must paint above native child WebViews", and `GlassModal` is the
shared ownership boundary for that invariant.

## Alternatives Considered

### Queue-only cover

Acquire a cover token in `QueueEditModal`. This fixes the reported path but
leaves every other `GlassModal` vulnerable and duplicates infrastructure
knowledge in a business component. Rejected.

### Higher modal z-index

Raise `.overlay` above the browser. Native child WebViews do not participate in
the DOM stacking context, so this cannot fix the bug. Rejected.

### Observe modal DOM globally

Use a mutation observer or global overlay registry to infer when native
surfaces should hide. This adds timing races and couples behavior to CSS class
names. The explicit component lifecycle is simpler and deterministic. Rejected.

## Test Strategy

Add a jsdom component test for `QueueEditModal`, exercising the real reported
entry point while asserting the shared cover contract:

- closed queue modal leaves cover depth at zero;
- opening the queue modal acquires a cover token;
- closing/unmounting releases the token;
- two open queue modals increment depth independently and one closing does not
  uncover the remaining modal.

The regression test must fail against the current upstream implementation
before production code changes. Existing `nativeWebviewCover` unit tests remain
the authority for idempotent reference counting and subscriber notifications.

Verification after implementation:

- new queue modal regression test;
- existing native cover and modal component tests;
- full Vitest suite;
- TypeScript typecheck;
- ESLint with zero warnings;
- UI production build;
- Tauri runtime check with Browser open: backdrop covers the whole workbench,
  the queue edit dialog is fully visible and interactive, and the same browser
  page returns after the dialog closes.

## Non-Goals

- Rebuilding the embedded browser as an iframe.
- Destroying and recreating the browser WebView around dialogs.
- Changing modal appearance, dimensions, copy, or keyboard behavior.
- Refactoring unrelated ad-hoc overlays that do not use `GlassModal`.
- Changing the native cover protocol or its reference-count implementation.
