/**
 * Contenteditable composer: plain text + inline skill chips.
 * Value is stored form with [[skill:name]] tokens.
 *
 * Slash filter: parent also derives query from `value` (draft). This editor
 * still emits caret-based slashQuery for mid-line tokens and live IME updates.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type CompositionEvent,
  type FormEvent,
  type KeyboardEvent,
  type Ref,
} from "react";
import {
  clipboardLooksLikeMedia,
  clipboardPlainText,
  collectFilesFromDataTransfer,
  isFileUrlOnlyText,
  readClipboardMediaFiles,
} from "@/lib/clipboardPaste";
import {
  detectSlashQuery,
  parseStoredContent,
  serializeStored,
  type DraftSegment,
} from "@/lib/draftDoc";

function clearNode(el: HTMLElement) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function appendTextWithBreaks(el: HTMLElement, text: string) {
  const parts = text.split("\n");
  parts.forEach((part, i) => {
    if (part) el.appendChild(document.createTextNode(part));
    if (i < parts.length - 1) el.appendChild(document.createElement("br"));
  });
}

function makeSkillChipEl(name: string): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = "skill-chip skill-chip--sm skill-chip--editor";
  wrap.contentEditable = "false";
  wrap.dataset.skill = name;
  wrap.setAttribute("data-skill", name);

  const icon = document.createElement("span");
  icon.className = "skill-chip__glyph";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "⚒";

  const label = document.createElement("span");
  label.className = "skill-chip__name";
  label.textContent = name;

  wrap.appendChild(icon);
  wrap.appendChild(label);
  return wrap;
}

function renderSegmentsInto(el: HTMLElement, segments: DraftSegment[]) {
  clearNode(el);
  for (const seg of segments) {
    if (seg.type === "text") {
      appendTextWithBreaks(el, seg.text);
    } else {
      el.appendChild(makeSkillChipEl(seg.name));
    }
  }
}

export function serializeDom(el: HTMLElement): string {
  const segs: DraftSegment[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent ?? "";
      if (t) segs.push({ type: "text", text: t });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const he = node as HTMLElement;
    if (he.dataset?.skill) {
      segs.push({ type: "skill", name: he.dataset.skill });
      return;
    }
    if (he.tagName === "BR") {
      segs.push({ type: "text", text: "\n" });
      return;
    }
    he.childNodes.forEach(walk);
  };
  el.childNodes.forEach(walk);
  const merged: DraftSegment[] = [];
  for (const s of segs) {
    if (s.type === "text") {
      const last = merged[merged.length - 1];
      if (last?.type === "text") last.text += s.text;
      else merged.push({ type: "text", text: s.text });
    } else {
      merged.push(s);
    }
  }
  return serializeStored(
    merged.length ? merged : [{ type: "text", text: "" }],
  );
}

function getTextBeforeCaret(el: HTMLElement): string | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.startContainer)) return null;
  const pre = document.createRange();
  pre.selectNodeContents(el);
  pre.setEnd(range.startContainer, range.startOffset);
  const frag = pre.cloneContents();
  const tmp = document.createElement("div");
  tmp.appendChild(frag);
  return serializeDom(tmp);
}

function placeCaretAtEnd(el: HTMLElement) {
  el.focus();
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

/**
 * Paste as plain text only — strip HTML / rich styles from clipboard.
 * Uses insertText when available (keeps undo); falls back to Range insert.
 */
function insertPlainTextAtSelection(text: string) {
  if (!text) return;
  const plain = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  try {
    if (document.queryCommandSupported?.("insertText")) {
      const ok = document.execCommand("insertText", false, plain);
      if (ok) return;
    }
  } catch {
    /* fall through */
  }

  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  range.deleteContents();

  const frag = document.createDocumentFragment();
  const parts = plain.split("\n");
  parts.forEach((part, i) => {
    if (part) frag.appendChild(document.createTextNode(part));
    if (i < parts.length - 1) frag.appendChild(document.createElement("br"));
  });
  const last = frag.lastChild;
  range.insertNode(frag);
  if (last) {
    range.setStartAfter(last);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

export type ComposerEditorProps = {
  value: string;
  onChange: (stored: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
  onSlashQueryChange?: (
    q: { start: number; query: string; end: number } | null,
  ) => void;
  editorRef?: Ref<HTMLDivElement | null>;
  onPasteFiles?: (files: File[]) => void;
  /**
   * When the paste event looks like media but has no File objects (and async
   * Clipboard API also fails), parent should try native OS clipboard.
   * `expectMedia: true` → show a failure toast if nothing was attached.
   */
  onPasteMediaFallback?: (opts?: {
    expectMedia?: boolean;
  }) => void | Promise<void>;
};

export function ComposerEditor({
  value,
  onChange,
  disabled,
  placeholder,
  className,
  onKeyDown,
  onSlashQueryChange,
  editorRef,
  onPasteFiles,
  onPasteMediaFallback,
}: ComposerEditorProps) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const lastValue = useRef(value);
  const composing = useRef(false);
  const focused = useRef(false);
  /**
   * DOM may show typed / IME glyphs before React `value` commits.
   * Track live emptiness so the overlay placeholder never paints over ink.
   */
  const [domEmpty, setDomEmpty] = useState(() => !value.trim());

  const setRefs = useCallback(
    (node: HTMLDivElement | null) => {
      elRef.current = node;
      if (typeof editorRef === "function") editorRef(node);
      else if (editorRef && "current" in editorRef) {
        (editorRef as { current: HTMLDivElement | null }).current = node;
      }
    },
    [editorRef],
  );

  const resize = useCallback(() => {
    const el = elRef.current;
    if (!el) return;
    const line = 22;
    const min = line;
    const max = line * 10;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, min), max)}px`;
  }, []);

  const emitSlash = useCallback(() => {
    const el = elRef.current;
    if (!el || !onSlashQueryChange) return;
    const beforeCaret = getTextBeforeCaret(el);
    const full = serializeDom(el);
    // Prefer full text — more reliable after IME confirms 汉字.
    const fromFull = detectSlashQuery(full);
    const fromCaret =
      beforeCaret != null ? detectSlashQuery(beforeCaret) : null;
    const q = fromFull ?? fromCaret;
    if (!q) {
      // During composition the DOM may briefly not contain `/…`; keep prior.
      if (composing.current) return;
      onSlashQueryChange(null);
      return;
    }
    const end = fromFull ? full.length : (beforeCaret?.length ?? full.length);
    onSlashQueryChange({ start: q.start, query: q.query, end });
  }, [onSlashQueryChange]);

  const syncDomEmpty = useCallback((el: HTMLElement) => {
    const stored = serializeDom(el);
    const empty =
      !stored.trim() ||
      (parseStoredContent(stored).every(
        (s) => s.type === "text" && !s.text.trim(),
      ) &&
        !stored.includes("[[skill:"));
    setDomEmpty(empty);
  }, []);

  const commitFromDom = useCallback(
    (el: HTMLElement) => {
      let stored = serializeDom(el);
      if (
        /\[\[skill:[a-zA-Z0-9_.:-]+\]\]/.test(stored) &&
        !el.querySelector("[data-skill]")
      ) {
        renderSegmentsInto(el, parseStoredContent(stored));
        stored = serializeDom(el);
        placeCaretAtEnd(el);
      }
      syncDomEmpty(el);
      if (stored !== lastValue.current) {
        lastValue.current = stored;
        onChange(stored);
      }
      emitSlash();
      resize();
    },
    [onChange, emitSlash, resize, syncDomEmpty],
  );

  useLayoutEffect(() => {
    const el = elRef.current;
    if (!el) return;
    if (composing.current) return;
    const current = serializeDom(el);
    if (current === value && el.childNodes.length > 0) {
      lastValue.current = value;
      resize();
      return;
    }
    if (focused.current && value === lastValue.current) {
      resize();
      return;
    }
    if (focused.current && value !== lastValue.current) {
      renderSegmentsInto(el, parseStoredContent(value));
      lastValue.current = value;
      placeCaretAtEnd(el);
      resize();
      emitSlash();
      return;
    }
    renderSegmentsInto(el, parseStoredContent(value));
    lastValue.current = value;
    resize();
  }, [value, resize, emitSlash]);

  const onInput = (e: FormEvent<HTMLDivElement>) => {
    // Hide placeholder as soon as the DOM has glyphs (incl. IME preedit).
    syncDomEmpty(e.currentTarget);
    if (composing.current) {
      // Live pinyin in DOM — update slash filter without committing draft yet.
      emitSlash();
      resize();
      return;
    }
    commitFromDom(e.currentTarget);
  };

  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();

    // Prefer nativeEvent — React's synthetic clipboardData is empty on some WebViews.
    const cd =
      e.clipboardData ??
      (e.nativeEvent as globalThis.ClipboardEvent | undefined)?.clipboardData ??
      null;

    const files = collectFilesFromDataTransfer(cd);
    if (files.length && onPasteFiles) {
      onPasteFiles(files);
    } else if (onPasteFiles && clipboardLooksLikeMedia(cd)) {
      // Screenshot paste: event often has image/* types but no File objects.
      void (async () => {
        const asyncFiles = await readClipboardMediaFiles();
        if (asyncFiles.length) {
          onPasteFiles(asyncFiles);
          return;
        }
        await onPasteMediaFallback?.({ expectMedia: true });
      })();
    } else if (!files.length && onPasteMediaFallback) {
      // Empty-looking paste on Mac can still be a pure bitmap clipboard.
      // Only run native fallback when no text is about to be inserted.
      const plainProbe = clipboardPlainText(cd);
      if (!plainProbe.trim()) {
        void (async () => {
          const asyncFiles = await readClipboardMediaFiles();
          if (asyncFiles.length) {
            onPasteFiles?.(asyncFiles);
            return;
          }
          // Soft try — no error toast if clipboard has no image.
          await onPasteMediaFallback({ expectMedia: false });
        })();
      }
    }

    const plain = clipboardPlainText(cd);
    if (!plain) return;
    if (files.length && isFileUrlOnlyText(plain)) return;
    insertPlainTextAtSelection(plain);
    const el = elRef.current;
    if (el) commitFromDom(el);
  };

  const flushAfterIme = useCallback(
    (el: HTMLElement) => {
      composing.current = false;
      commitFromDom(el);
      // WebKit may finalize the text node after compositionend.
      requestAnimationFrame(() => {
        commitFromDom(el);
        requestAnimationFrame(() => commitFromDom(el));
      });
      window.setTimeout(() => commitFromDom(el), 0);
      window.setTimeout(() => commitFromDom(el), 50);
    },
    [commitFromDom],
  );

  /**
   * Live sync while focused: contenteditable + IME can change the DOM without a
   * clean input event. MutationObserver keeps draft + slash filter aligned with
   * what the user actually sees (including after 汉字 selection).
   */
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;

    let raf = 0;
    const sync = () => {
      if (!elRef.current) return;
      if (composing.current) {
        emitSlash();
        return;
      }
      const live = serializeDom(el);
      if (live !== lastValue.current) {
        commitFromDom(el);
      } else {
        emitSlash();
      }
    };
    const schedule = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(sync);
    };

    const mo = new MutationObserver(schedule);
    mo.observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => {
      mo.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [commitFromDom, emitSlash, value]);

  const valueEmpty =
    !value.trim() ||
    (parseStoredContent(value).every(
      (s) => s.type === "text" && !s.text.trim(),
    ) &&
      !value.includes("[[skill:"));
  // Both prop and live DOM must be empty — otherwise placeholder covers ink.
  const isEmpty = valueEmpty && domEmpty;

  // External value clear (send / clear) must restore placeholder.
  useEffect(() => {
    if (valueEmpty) {
      const el = elRef.current;
      if (el) syncDomEmpty(el);
      else setDomEmpty(true);
    } else {
      setDomEmpty(false);
    }
  }, [valueEmpty, value, syncDomEmpty]);

  return (
    <div className="composer-editor-wrap">
      {isEmpty && placeholder ? (
        <div className="composer-editor__placeholder" aria-hidden>
          {placeholder}
        </div>
      ) : null}
      <div
        ref={setRefs}
        className={className ?? "composer__input"}
        contentEditable={!disabled}
        role="textbox"
        aria-multiline
        aria-placeholder={placeholder}
        data-placeholder={placeholder}
        suppressContentEditableWarning
        onFocus={() => {
          focused.current = true;
        }}
        onBlur={() => {
          focused.current = false;
        }}
        onInput={onInput}
        onPaste={onPaste}
        onKeyUp={() => {
          if (!composing.current) emitSlash();
        }}
        onClick={() => emitSlash()}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionUpdate={() => {
          emitSlash();
        }}
        onCompositionEnd={(e: CompositionEvent<HTMLDivElement>) => {
          flushAfterIme(e.currentTarget);
        }}
        onKeyDown={(e) => {
          const ne = e.nativeEvent;
          if (ne.isComposing || ne.keyCode === 229 || composing.current) {
            return;
          }
          onKeyDown?.(e);
        }}
      />
    </div>
  );
}

export function focusComposerEnd(el: HTMLDivElement | null) {
  placeCaretAtEnd(el!);
}
