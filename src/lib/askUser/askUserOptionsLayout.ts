/**
 * Compact layout for ask-user option chips.
 *
 * Short labels with no real descriptions sit in a row so the composer gate
 * stays short. CLI often echoes the label as `description` — that is not a
 * second line. Anything that would wrap or needs a real description stacks.
 */

import { askUserVisibleDescription } from "./askUserForm";

export type AskUserOptionsLayout = "row" | "stack";

export type AskUserOptionLayoutInput = {
  label: string;
  description?: string | null;
};

/** Display units: CJK / fullwidth ≈ 2, Latin ≈ 1. */
function labelWidth(label: string): number {
  let width = 0;
  for (const ch of label) {
    width += ch.charCodeAt(0) > 0xff ? 2 : 1;
  }
  return width;
}

const MAX_LABEL_WIDTH = 22;
const MAX_ROW_WIDTH = 56;

export function resolveAskUserOptionsLayout(
  options: AskUserOptionLayoutInput[],
): AskUserOptionsLayout {
  if (options.length < 2) return "stack";
  let total = 0;
  for (const option of options) {
    if (askUserVisibleDescription(option.label, option.description)) {
      return "stack";
    }
    const width = labelWidth(option.label.trim());
    if (width === 0 || width > MAX_LABEL_WIDTH) return "stack";
    total += width;
  }
  if (total > MAX_ROW_WIDTH) return "stack";
  return "row";
}
