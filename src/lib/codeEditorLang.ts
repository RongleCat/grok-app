/**
 * Map highlight.js language ids (from languageFromFileName) to CodeMirror
 * language extensions. Unknown ids → no highlighter (plain text).
 */

import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { python } from "@codemirror/lang-python";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { xml } from "@codemirror/lang-xml";
import { StreamLanguage } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import {
  c,
  cpp,
  csharp,
  dart,
  java,
  kotlin,
  objectiveC,
  scala,
  shader,
} from "@codemirror/legacy-modes/mode/clike";
import { clojure } from "@codemirror/legacy-modes/mode/clojure";
import { cmake } from "@codemirror/legacy-modes/mode/cmake";
import { coffeeScript } from "@codemirror/legacy-modes/mode/coffeescript";
import { commonLisp } from "@codemirror/legacy-modes/mode/commonlisp";
import { crystal } from "@codemirror/legacy-modes/mode/crystal";
import { diff } from "@codemirror/legacy-modes/mode/diff";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { elm } from "@codemirror/legacy-modes/mode/elm";
import { erlang } from "@codemirror/legacy-modes/mode/erlang";
import { fortran } from "@codemirror/legacy-modes/mode/fortran";
import { go } from "@codemirror/legacy-modes/mode/go";
import { groovy } from "@codemirror/legacy-modes/mode/groovy";
import { haskell } from "@codemirror/legacy-modes/mode/haskell";
import { http } from "@codemirror/legacy-modes/mode/http";
import { julia } from "@codemirror/legacy-modes/mode/julia";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { fSharp, oCaml } from "@codemirror/legacy-modes/mode/mllike";
import { nginx } from "@codemirror/legacy-modes/mode/nginx";
import { octave } from "@codemirror/legacy-modes/mode/octave";
import { perl } from "@codemirror/legacy-modes/mode/perl";
import { powerShell } from "@codemirror/legacy-modes/mode/powershell";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { protobuf } from "@codemirror/legacy-modes/mode/protobuf";
import { r } from "@codemirror/legacy-modes/mode/r";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { rust } from "@codemirror/legacy-modes/mode/rust";
import { sass } from "@codemirror/legacy-modes/mode/sass";
import { scheme } from "@codemirror/legacy-modes/mode/scheme";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { gql, standardSQL } from "@codemirror/legacy-modes/mode/sql";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { swift } from "@codemirror/legacy-modes/mode/swift";
import { tcl } from "@codemirror/legacy-modes/mode/tcl";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { vb } from "@codemirror/legacy-modes/mode/vb";
import { yaml } from "@codemirror/legacy-modes/mode/yaml";
import { languageFromFileName } from "@/lib/codeLang";

function stream(parser: Parameters<typeof StreamLanguage.define>[0]): Extension {
  return StreamLanguage.define(parser);
}

export function codeEditorLangId(
  fileName?: string | null,
  language?: string | null,
): string {
  const explicit = (language || "").trim().toLowerCase();
  if (explicit && explicit !== "plaintext" && explicit !== "text") {
    return explicit;
  }
  if (fileName?.trim()) return languageFromFileName(fileName);
  return "plaintext";
}

/** Which highlighter a file would use (testable without mounting CodeMirror). */
export function codeEditorLangKind(
  fileName?: string | null,
  language?: string | null,
): "javascript" | "json" | "python" | "html" | "css" | "xml" | "stream" | "plain" {
  const id = codeEditorLangId(fileName, language);
  switch (id) {
    case "javascript":
    case "typescript":
      return "javascript";
    case "json":
      return "json";
    case "python":
      return "python";
    case "html":
      return "html";
    case "css":
    case "scss":
    case "less":
      return id === "css" ? "css" : "stream";
    case "xml":
      return "xml";
    case "plaintext":
      return "plain";
    default:
      return "stream";
  }
}

export function codeEditorLanguageExtension(
  fileName?: string | null,
  language?: string | null,
): Extension {
  const id = codeEditorLangId(fileName, language);
  switch (id) {
    case "javascript":
      return javascript();
    case "typescript":
      return javascript({ typescript: true, jsx: true });
    case "json":
      return json();
    case "python":
      return python();
    case "html":
      return html();
    case "css":
      return css();
    case "xml":
      return xml();
    case "rust":
      return stream(rust);
    case "go":
      return stream(go);
    case "c":
      return stream(c);
    case "cpp":
      return stream(cpp);
    case "csharp":
      return stream(csharp);
    case "java":
      return stream(java);
    case "kotlin":
      return stream(kotlin);
    case "scala":
      return stream(scala);
    case "dart":
      return stream(dart);
    case "objectivec":
      return stream(objectiveC);
    case "glsl":
      return stream(shader);
    case "swift":
      return stream(swift);
    case "ruby":
      return stream(ruby);
    case "perl":
      return stream(perl);
    case "lua":
      return stream(lua);
    case "r":
      return stream(r);
    case "julia":
      return stream(julia);
    case "haskell":
      return stream(haskell);
    case "clojure":
      return stream(clojure);
    case "elm":
      return stream(elm);
    case "erlang":
      return stream(erlang);
    case "ocaml":
      return stream(oCaml);
    case "fsharp":
      return stream(fSharp);
    case "coffeescript":
      return stream(coffeeScript);
    case "lisp":
      return stream(commonLisp);
    case "scheme":
      return stream(scheme);
    case "crystal":
      return stream(crystal);
    case "groovy":
      return stream(groovy);
    case "bash":
    case "shell":
      return stream(shell);
    case "powershell":
      return stream(powerShell);
    case "yaml":
      return stream(yaml);
    case "ini":
      return stream(toml);
    case "properties":
      return stream(properties);
    case "toml":
      return stream(toml);
    case "dockerfile":
      return stream(dockerFile);
    case "cmake":
      return stream(cmake);
    case "nginx":
      return stream(nginx);
    case "sql":
      return stream(standardSQL);
    case "graphql":
      return stream(gql);
    case "diff":
      return stream(diff);
    case "http":
      return stream(http);
    case "protobuf":
      return stream(protobuf);
    case "scss":
    case "sass":
    case "less":
      return stream(sass);
    case "latex":
      return stream(stex);
    case "matlab":
      return stream(octave);
    case "fortran":
      return stream(fortran);
    case "vbnet":
      return stream(vb);
    case "tcl":
      return stream(tcl);
    default:
      return [];
  }
}
