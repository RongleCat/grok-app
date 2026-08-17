/**
 * Atom One Dark / One Light — same palette as CodePreview (highlight.js).
 */

import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";

const darkHighlight = HighlightStyle.define([
  { tag: t.comment, color: "#5c6370", fontStyle: "italic" },
  { tag: t.lineComment, color: "#5c6370", fontStyle: "italic" },
  { tag: t.blockComment, color: "#5c6370", fontStyle: "italic" },
  { tag: t.keyword, color: "#c678dd" },
  { tag: t.controlKeyword, color: "#c678dd" },
  { tag: t.definitionKeyword, color: "#c678dd" },
  { tag: t.moduleKeyword, color: "#c678dd" },
  { tag: t.operatorKeyword, color: "#c678dd" },
  { tag: t.self, color: "#e06c75" },
  { tag: t.string, color: "#98c379" },
  { tag: t.special(t.string), color: "#98c379" },
  { tag: t.regexp, color: "#98c379" },
  { tag: t.number, color: "#d19a66" },
  { tag: t.bool, color: "#56b6c2" },
  { tag: t.null, color: "#56b6c2" },
  { tag: t.atom, color: "#56b6c2" },
  { tag: t.operator, color: "#56b6c2" },
  { tag: t.punctuation, color: "#abb2bf" },
  { tag: t.bracket, color: "#abb2bf" },
  { tag: t.variableName, color: "#abb2bf" },
  { tag: t.definition(t.variableName), color: "#e06c75" },
  { tag: t.function(t.variableName), color: "#61aeee" },
  { tag: t.propertyName, color: "#d19a66" },
  { tag: t.className, color: "#e6c07b" },
  { tag: t.typeName, color: "#e6c07b" },
  { tag: t.namespace, color: "#e6c07b" },
  { tag: t.tagName, color: "#e06c75" },
  { tag: t.attributeName, color: "#d19a66" },
  { tag: t.meta, color: "#61aeee" },
  { tag: t.heading, color: "#e06c75", fontWeight: "bold" },
  { tag: t.link, color: "#61aeee", textDecoration: "underline" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strong, fontWeight: "bold" },
  { tag: t.invalid, color: "#e06c75" },
]);

const lightHighlight = HighlightStyle.define([
  { tag: t.comment, color: "#a0a1a7", fontStyle: "italic" },
  { tag: t.lineComment, color: "#a0a1a7", fontStyle: "italic" },
  { tag: t.blockComment, color: "#a0a1a7", fontStyle: "italic" },
  { tag: t.keyword, color: "#a626a4" },
  { tag: t.controlKeyword, color: "#a626a4" },
  { tag: t.definitionKeyword, color: "#a626a4" },
  { tag: t.moduleKeyword, color: "#a626a4" },
  { tag: t.operatorKeyword, color: "#a626a4" },
  { tag: t.self, color: "#e45649" },
  { tag: t.string, color: "#50a14f" },
  { tag: t.special(t.string), color: "#50a14f" },
  { tag: t.regexp, color: "#50a14f" },
  { tag: t.number, color: "#986801" },
  { tag: t.bool, color: "#0184bc" },
  { tag: t.null, color: "#0184bc" },
  { tag: t.atom, color: "#0184bc" },
  { tag: t.operator, color: "#0184bc" },
  { tag: t.punctuation, color: "#383a42" },
  { tag: t.bracket, color: "#383a42" },
  { tag: t.variableName, color: "#383a42" },
  { tag: t.definition(t.variableName), color: "#e45649" },
  { tag: t.function(t.variableName), color: "#4078f2" },
  { tag: t.propertyName, color: "#986801" },
  { tag: t.className, color: "#c18401" },
  { tag: t.typeName, color: "#c18401" },
  { tag: t.namespace, color: "#c18401" },
  { tag: t.tagName, color: "#e45649" },
  { tag: t.attributeName, color: "#986801" },
  { tag: t.meta, color: "#4078f2" },
  { tag: t.heading, color: "#e45649", fontWeight: "bold" },
  { tag: t.link, color: "#4078f2", textDecoration: "underline" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strong, fontWeight: "bold" },
  { tag: t.invalid, color: "#e45649" },
]);

function chrome(mode: "dark" | "light") {
  const dark = mode === "dark";
  return EditorView.theme(
    {
      "&": {
        height: "100%",
        backgroundColor: dark ? "#21252b" : "#fafafa",
        color: dark ? "#abb2bf" : "#383a42",
        fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
        fontSize: "12.5px",
      },
      ".cm-scroller": {
        fontFamily: "inherit",
        lineHeight: "1.55",
        overflow: "auto",
      },
      ".cm-content": {
        caretColor: dark ? "#528bff" : "#4078f2",
        padding: "14px 0 20px",
      },
      ".cm-gutters": {
        backgroundColor: dark ? "#21252b" : "#f0f0f0",
        color: dark ? "#5c6370" : "#9d9d9f",
        borderRight: `1px solid ${dark ? "#181a1f" : "#e5e5e6"}`,
        minWidth: "2.75rem",
      },
      ".cm-lineNumbers .cm-gutterElement": {
        padding: "0 10px 0 8px",
        minHeight: "1.55em",
      },
      ".cm-activeLine": {
        backgroundColor: dark
          ? "rgba(255, 255, 255, 0.04)"
          : "rgba(0, 0, 0, 0.035)",
      },
      ".cm-activeLineGutter": {
        backgroundColor: dark
          ? "rgba(255, 255, 255, 0.04)"
          : "rgba(0, 0, 0, 0.035)",
        color: dark ? "#abb2bf" : "#383a42",
      },
      ".cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground":
        {
          backgroundColor: dark
            ? "rgba(82, 139, 255, 0.28)"
            : "rgba(64, 120, 242, 0.22)",
        },
      ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: dark ? "#528bff" : "#4078f2",
      },
      "&.cm-focused": { outline: "none" },
      ".cm-matchingBracket": {
        backgroundColor: dark
          ? "rgba(192, 195, 201, 0.16)"
          : "rgba(56, 58, 66, 0.12)",
      },
    },
    { dark },
  );
}

export function readCodeEditorTheme(): "light" | "dark" {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.getAttribute("data-theme") === "light"
    ? "light"
    : "dark";
}

export function codeEditorThemeExtensions(mode: "light" | "dark"): Extension {
  return [
    chrome(mode),
    syntaxHighlighting(mode === "dark" ? darkHighlight : lightHighlight),
  ];
}
