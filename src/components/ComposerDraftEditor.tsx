/**
 * Thin island: binds ComposerEditor to the external draft store so App need
 * not re-render on every keystroke.
 */

import { memo, useCallback } from "react";
import {
  ComposerEditor,
  type ComposerEditorProps,
} from "@/components/ComposerEditor";
import {
  useComposerDraft,
  useComposerDraftActions,
} from "@/hooks/useComposerDraft";

export type ComposerDraftEditorProps = Omit<
  ComposerEditorProps,
  "value" | "onChange"
> & {
  /** Optional side-effect after store update (e.g. exit prompt-history browse). */
  onDraftChange?: (draft: string) => void;
};

export const ComposerDraftEditor = memo(function ComposerDraftEditor({
  onDraftChange,
  ...rest
}: ComposerDraftEditorProps) {
  const draft = useComposerDraft();
  const { setDraft } = useComposerDraftActions();
  const onChange = useCallback(
    (next: string) => {
      setDraft(next);
      onDraftChange?.(next);
    },
    [setDraft, onDraftChange],
  );
  return <ComposerEditor {...rest} value={draft} onChange={onChange} />;
});
