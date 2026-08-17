/** Syntax-highlighted code file editor (CodeMirror 6). */

import { useEffect, useRef } from "react";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  bracketMatching,
  defaultHighlightStyle,
  indentUnit,
  syntaxHighlighting,
} from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import {
  codeEditorLanguageExtension,
} from "@/lib/codeEditorLang";
import {
  codeEditorThemeExtensions,
  readCodeEditorTheme,
} from "@/lib/codeEditorTheme";

export type CodeFileEditorProps = {
  value: string;
  fileName?: string;
  language?: string;
  onChange: (text: string) => void;
  onSave?: () => void;
  disabled?: boolean;
  ariaLabel: string;
};

export function CodeFileEditor({
  value,
  fileName,
  language,
  onChange,
  onSave,
  disabled = false,
  ariaLabel,
}: CodeFileEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const langComp = useRef(new Compartment());
  const themeComp = useRef(new Compartment());
  const editComp = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const saveCmd = () => {
      onSaveRef.current?.();
      return true;
    };

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        drawSelection(),
        bracketMatching(),
        highlightSelectionMatches(),
        history(),
        indentUnit.of("  "),
        EditorState.tabSize.of(2),
        keymap.of([
          { key: "Mod-s", run: saveCmd, preventDefault: true },
          ...searchKeymap,
          ...historyKeymap,
          indentWithTab,
          ...defaultKeymap,
        ]),
        langComp.current.of(codeEditorLanguageExtension(fileName, language)),
        themeComp.current.of(codeEditorThemeExtensions(readCodeEditorTheme())),
        editComp.current.of([
          EditorState.readOnly.of(disabled),
          EditorView.editable.of(!disabled),
        ]),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          onChangeRef.current(update.state.doc.toString());
        }),
        EditorView.contentAttributes.of({
          "aria-label": ariaLabel,
        }),
      ],
    });

    const view = new EditorView({ state, parent: host });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Mount once per editor instance (parent should key by file tab).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
    });
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: langComp.current.reconfigure(
        codeEditorLanguageExtension(fileName, language),
      ),
    });
  }, [fileName, language]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: editComp.current.reconfigure([
        EditorState.readOnly.of(disabled),
        EditorView.editable.of(!disabled),
      ]),
    });
  }, [disabled]);

  useEffect(() => {
    const apply = () => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: themeComp.current.reconfigure(
          codeEditorThemeExtensions(readCodeEditorTheme()),
        ),
      });
    };
    apply();
    const el = document.documentElement;
    const mo = new MutationObserver(apply);
    mo.observe(el, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);

  return (
    <div
      ref={hostRef}
      className="rp-code-editor"
      data-testid="code-file-editor"
    />
  );
}
