/**
 * Side-browser Design Mode — inspect a page element and send it to chat.
 *
 * The injected overlay lives in the child Webview (native surface sits above
 * React). Host `side_browser_eval` installs / polls / tears it down. Composer
 * prompt assembly and eval-result decoding stay pure so tests cover them.
 */

export const DESIGN_MODE_NS = "__GROK_DM__";

export type DesignModeStyles = {
  color: string;
  backgroundColor: string;
  fontSize: string;
  fontFamily: string;
  fontWeight: string;
  lineHeight: string;
  letterSpacing: string;
  textAlign: string;
  display: string;
  position: string;
  width: string;
  height: string;
  padding: string;
  margin: string;
  border: string;
  borderRadius: string;
  gap: string;
  opacity: string;
  boxShadow: string;
};

export type DesignModeRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type DesignModeSelection = {
  tag: string;
  id: string;
  className: string;
  cssPath: string;
  text: string;
  html: string;
  rect: DesignModeRect;
  styles: DesignModeStyles;
  href: string;
  dpr: number;
};

export type DesignModeShotStatus = "idle" | "pending" | "ok" | "error";

export type DesignModeShot = {
  status: DesignModeShotStatus;
  dataUrl?: string;
  error?: string;
};

export type DesignModePoll = {
  ok: boolean;
  enabled: boolean;
  version: number;
  hasSelection: boolean;
  shotStatus: DesignModeShotStatus;
  reason?: string;
};

export type DesignModeInstallResult = {
  ok: boolean;
  already?: boolean;
  error?: string;
};

export type DesignModeReadResult = {
  ok: boolean;
  selected: DesignModeSelection | null;
  shot: DesignModeShot;
};

export type DesignModePromptLabels = {
  intro: string;
  page: string;
  element: string;
  cssPath: string;
  text: string;
  size: string;
  styles: string;
  html: string;
  change: string;
};

export type DesignModeStatus =
  | "off"
  | "installing"
  | "ready"
  | "unavailable";

const STYLE_KEYS: (keyof DesignModeStyles)[] = [
  "color",
  "backgroundColor",
  "fontSize",
  "fontFamily",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "textAlign",
  "display",
  "position",
  "width",
  "height",
  "padding",
  "margin",
  "border",
  "borderRadius",
  "gap",
  "opacity",
  "boxShadow",
];

const EMPTY_STYLES: DesignModeStyles = {
  color: "",
  backgroundColor: "",
  fontSize: "",
  fontFamily: "",
  fontWeight: "",
  lineHeight: "",
  letterSpacing: "",
  textAlign: "",
  display: "",
  position: "",
  width: "",
  height: "",
  padding: "",
  margin: "",
  border: "",
  borderRadius: "",
  gap: "",
  opacity: "",
  boxShadow: "",
};

/** Host eval wraps JS strings as JSON; a returned stringify() is often double-encoded. */
export function parseEvalJson(raw: unknown): unknown {
  let value: unknown = raw;
  for (let i = 0; i < 3; i++) {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      value = JSON.parse(trimmed);
    } catch {
      return i === 0 ? null : value;
    }
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asBool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function parseStyles(raw: unknown): DesignModeStyles {
  const rec = asRecord(raw);
  const out = { ...EMPTY_STYLES };
  if (!rec) return out;
  for (const key of STYLE_KEYS) {
    out[key] = asString(rec[key]);
  }
  return out;
}

function parseRect(raw: unknown): DesignModeRect {
  const rec = asRecord(raw);
  return {
    x: asNumber(rec?.x),
    y: asNumber(rec?.y),
    w: asNumber(rec?.w),
    h: asNumber(rec?.h),
  };
}

export function parseDesignModeSelection(
  raw: unknown,
): DesignModeSelection | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const tag = asString(rec.tag).trim().toLowerCase();
  if (!tag) return null;
  return {
    tag,
    id: asString(rec.id),
    className: asString(rec.className),
    cssPath: asString(rec.cssPath),
    text: asString(rec.text),
    html: asString(rec.html),
    rect: parseRect(rec.rect),
    styles: parseStyles(rec.styles),
    href: asString(rec.href),
    dpr: asNumber(rec.dpr, 1) || 1,
  };
}

export function parseDesignModeShot(raw: unknown): DesignModeShot {
  const rec = asRecord(raw);
  const status = asString(rec?.status, "idle");
  const known: DesignModeShotStatus[] = ["idle", "pending", "ok", "error"];
  return {
    status: known.includes(status as DesignModeShotStatus)
      ? (status as DesignModeShotStatus)
      : "idle",
    dataUrl: asString(rec?.dataUrl) || undefined,
    error: asString(rec?.error) || undefined,
  };
}

export function parseDesignModeInstall(raw: unknown): DesignModeInstallResult {
  const value = typeof raw === "string" ? parseEvalJson(raw) : raw;
  const rec = asRecord(value);
  if (!rec) return { ok: false, error: "invalid" };
  return {
    ok: asBool(rec.ok),
    already: rec.already === true ? true : undefined,
    error: asString(rec.error) || undefined,
  };
}

export function parseDesignModePoll(raw: unknown): DesignModePoll | null {
  const value = typeof raw === "string" ? parseEvalJson(raw) : raw;
  const rec = asRecord(value);
  if (!rec) return null;
  const shot = parseDesignModeShot({ status: rec.shotStatus });
  return {
    ok: asBool(rec.ok),
    enabled: asBool(rec.enabled),
    version: asNumber(rec.version),
    hasSelection: asBool(rec.hasSelection),
    shotStatus: shot.status,
    reason: asString(rec.reason) || undefined,
  };
}

export function parseDesignModeRead(raw: unknown): DesignModeReadResult | null {
  const value = typeof raw === "string" ? parseEvalJson(raw) : raw;
  const rec = asRecord(value);
  if (!rec) return null;
  return {
    ok: asBool(rec.ok),
    selected: parseDesignModeSelection(rec.selected),
    shot: parseDesignModeShot(rec.shot),
  };
}

/** Local / loopback / LAN preview — Design Mode is most useful here. */
export function isLikelyInjectablePreviewUrl(url: string): boolean {
  const raw = url.trim();
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === "file:") return true;
    const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host.endsWith(".localhost") ||
      host.endsWith(".local")
    ) {
      return true;
    }
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    return false;
  } catch {
    return false;
  }
}

export function selectorLabel(selection: DesignModeSelection): string {
  const id = selection.id.trim() ? `#${selection.id.trim()}` : "";
  const classes = selection.className
    .split(/\s+/)
    .map((c) => c.trim())
    .filter(Boolean)
    .slice(0, 3)
    .map((c) => `.${c}`)
    .join("");
  return `${selection.tag}${id}${classes}`;
}

export function formatRect(rect: DesignModeRect): string {
  const w = Math.round(rect.w);
  const h = Math.round(rect.h);
  const x = Math.round(rect.x);
  const y = Math.round(rect.y);
  return `${w} × ${h} at (${x}, ${y})`;
}

const STYLE_PROMPT_ORDER: { key: keyof DesignModeStyles; label: string }[] = [
  { key: "color", label: "color" },
  { key: "backgroundColor", label: "background-color" },
  { key: "fontSize", label: "font-size" },
  { key: "fontFamily", label: "font-family" },
  { key: "fontWeight", label: "font-weight" },
  { key: "lineHeight", label: "line-height" },
  { key: "letterSpacing", label: "letter-spacing" },
  { key: "textAlign", label: "text-align" },
  { key: "display", label: "display" },
  { key: "position", label: "position" },
  { key: "width", label: "width" },
  { key: "height", label: "height" },
  { key: "padding", label: "padding" },
  { key: "margin", label: "margin" },
  { key: "border", label: "border" },
  { key: "borderRadius", label: "border-radius" },
  { key: "gap", label: "gap" },
  { key: "opacity", label: "opacity" },
  { key: "boxShadow", label: "box-shadow" },
];

export function formatDesignModePrompt(input: {
  selection: DesignModeSelection;
  note: string;
  labels: DesignModePromptLabels;
  attachmentPath?: string | null;
}): string {
  const { selection, labels } = input;
  const note = input.note.trim();
  const styles = STYLE_PROMPT_ORDER.filter(({ key }) => {
    const value = selection.styles[key].trim();
    return value.length > 0 && value !== "none" && value !== "normal";
  })
    .map(({ key, label }) => `- ${label}: ${selection.styles[key].trim()}`)
    .join("\n");

  const lines = [
    labels.intro,
    "",
    `${labels.page} ${selection.href || "(unknown)"}`,
    `${labels.element} ${selectorLabel(selection)}`,
    `${labels.cssPath} ${selection.cssPath || selectorLabel(selection)}`,
  ];
  if (selection.text.trim()) {
    lines.push(`${labels.text} ${selection.text.trim()}`);
  }
  lines.push(`${labels.size} ${formatRect(selection.rect)}`);
  if (styles) {
    lines.push("", `${labels.styles}`, styles);
  }
  if (selection.html.trim()) {
    lines.push("", `${labels.html}`, "```html", selection.html.trim(), "```");
  }
  if (note) {
    lines.push("", `${labels.change}`, note);
  }
  const body = lines.join("\n").trim();
  const path = (input.attachmentPath || "").trim();
  if (!path) return body;
  return `${body}\n\n@${path}`;
}

export function appendDesignModeDraft(prev: string, prompt: string): string {
  const next = prompt.trim();
  if (!next) return prev;
  const cur = prev.replace(/\s+$/, "");
  if (!cur.trim()) return next;
  return `${cur}\n\n${next}`;
}

export function dataUrlToBase64(dataUrl: string): string | null {
  const m = dataUrl
    .trim()
    .match(/^data:image\/[a-zA-Z0-9.+-]+;base64,([A-Za-z0-9+/=\s]+)$/);
  if (!m?.[1]) return null;
  const b64 = m[1].replace(/\s+/g, "");
  return b64.length ? b64 : null;
}

export function inspectorStyleRows(
  selection: DesignModeSelection,
): { key: keyof DesignModeStyles; label: string; value: string }[] {
  return STYLE_PROMPT_ORDER.map(({ key, label }) => ({
    key,
    label,
    value: selection.styles[key].trim(),
  })).filter((row) => row.value && row.value !== "none");
}

export function buildDesignModeInstallScript(): string {
  const ns = JSON.stringify(DESIGN_MODE_NS);
  return `(function(){
  try {
    var NS = ${ns};
    var prev = window[NS];
    if (prev && prev.enabled && typeof prev.destroy === "function") {
      try { prev.destroy(); } catch (e1) {}
    }
    var root = document.getElementById("grok-dm-root");
    if (root && root.parentNode) root.parentNode.removeChild(root);

    root = document.createElement("div");
    root.id = "grok-dm-root";
    root.setAttribute("data-grok-dm", "1");
    root.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483646;pointer-events:none;";
    var shadow = root.attachShadow({ mode: "open" });
    var css = document.createElement("style");
    css.textContent = [
      ":host{all:initial;}",
      ".box{position:fixed;pointer-events:none;box-sizing:border-box;border-radius:2px;}",
      ".hover{background:rgba(59,130,246,0.16);outline:2px solid #3b82f6;outline-offset:-2px;}",
      ".sel{background:rgba(37,99,235,0.10);outline:2px solid #1d4ed8;outline-offset:-2px;}"
    ].join("");
    shadow.appendChild(css);
    var hoverBox = document.createElement("div");
    hoverBox.className = "box hover";
    hoverBox.style.display = "none";
    var selBox = document.createElement("div");
    selBox.className = "box sel";
    selBox.style.display = "none";
    shadow.appendChild(hoverBox);
    shadow.appendChild(selBox);
    (document.documentElement || document.body).appendChild(root);

    function esc(s) {
      if (window.CSS && CSS.escape) return CSS.escape(s);
      return String(s).replace(/[^a-zA-Z0-9_-]/g, "\\\\$&");
    }
    function cssPath(el) {
      var parts = [];
      var cur = el;
      var guard = 0;
      while (cur && cur.nodeType === 1 && guard < 12) {
        guard += 1;
        if (cur.id && typeof cur.id === "string" && cur.id.length && cur.id.length < 80) {
          parts.unshift("#" + esc(cur.id));
          break;
        }
        var name = (cur.tagName || "div").toLowerCase();
        var parent = cur.parentElement;
        if (parent) {
          var same = 0;
          var idx = 0;
          var kids = parent.children;
          for (var i = 0; i < kids.length; i++) {
            if (kids[i].tagName === cur.tagName) {
              same += 1;
              if (kids[i] === cur) idx = same;
            }
          }
          if (same > 1 && idx) name += ":nth-of-type(" + idx + ")";
        }
        var rawCls = typeof cur.className === "string" ? cur.className : "";
        var cls = rawCls.split(/\\s+/).filter(Boolean).slice(0, 2);
        if (cls.length) name += "." + cls.map(esc).join(".");
        parts.unshift(name);
        if (cur === document.body || cur === document.documentElement) break;
        cur = parent;
      }
      return parts.join(" > ");
    }
    function pick(cs, name) {
      try { return cs.getPropertyValue(name) || ""; } catch (e2) { return ""; }
    }
    function collect(el) {
      var cs = window.getComputedStyle(el);
      var r = el.getBoundingClientRect();
      var rawCls = typeof el.className === "string" ? el.className : "";
      var html = "";
      try { html = String(el.outerHTML || "").slice(0, 1600); } catch (e3) { html = ""; }
      var text = "";
      try { text = String(el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 220); } catch (e4) { text = ""; }
      return {
        tag: (el.tagName || "").toLowerCase(),
        id: el.id || "",
        className: rawCls,
        cssPath: cssPath(el),
        text: text,
        html: html,
        rect: { x: r.x, y: r.y, w: r.width, h: r.height },
        styles: {
          color: pick(cs, "color"),
          backgroundColor: pick(cs, "background-color"),
          fontSize: pick(cs, "font-size"),
          fontFamily: pick(cs, "font-family"),
          fontWeight: pick(cs, "font-weight"),
          lineHeight: pick(cs, "line-height"),
          letterSpacing: pick(cs, "letter-spacing"),
          textAlign: pick(cs, "text-align"),
          display: pick(cs, "display"),
          position: pick(cs, "position"),
          width: pick(cs, "width"),
          height: pick(cs, "height"),
          padding: pick(cs, "padding"),
          margin: pick(cs, "margin"),
          border: pick(cs, "border"),
          borderRadius: pick(cs, "border-radius"),
          gap: pick(cs, "gap"),
          opacity: pick(cs, "opacity"),
          boxShadow: pick(cs, "box-shadow")
        },
        href: location.href || "",
        dpr: window.devicePixelRatio || 1
      };
    }
    function place(box, el) {
      if (!el) { box.style.display = "none"; return; }
      var r = el.getBoundingClientRect();
      if (r.width < 0.5 && r.height < 0.5) { box.style.display = "none"; return; }
      box.style.display = "block";
      box.style.left = r.left + "px";
      box.style.top = r.top + "px";
      box.style.width = Math.max(1, r.width) + "px";
      box.style.height = Math.max(1, r.height) + "px";
    }
    function isOurs(el) {
      if (!el || el === root) return true;
      if (el.nodeType !== 1) return true;
      if (el.closest && el.closest("[data-grok-dm]")) return true;
      var tag = (el.tagName || "").toLowerCase();
      return tag === "html" || tag === "script" || tag === "style" || tag === "link" || tag === "meta" || tag === "head";
    }
    function startShot(el) {
      state.shot = { status: "pending" };
      try {
        var r = el.getBoundingClientRect();
        var w = Math.max(1, Math.round(r.width));
        var h = Math.max(1, Math.round(r.height));
        var max = 720;
        var dpr = Math.min(2, window.devicePixelRatio || 1);
        var scale = Math.min(1, max / Math.max(w, h));
        var cw = Math.max(1, Math.round(w * scale * dpr));
        var ch = Math.max(1, Math.round(h * scale * dpr));
        if (el.tagName === "IMG" && el.complete && el.naturalWidth) {
          var c0 = document.createElement("canvas");
          c0.width = cw; c0.height = ch;
          var x0 = c0.getContext("2d");
          if (x0) {
            x0.drawImage(el, 0, 0, cw, ch);
            state.shot = { status: "ok", dataUrl: c0.toDataURL("image/png") };
            return;
          }
        }
        var clone = el.cloneNode(true);
        var drop = clone.querySelectorAll ? clone.querySelectorAll("script,iframe,video,audio,canvas") : [];
        for (var i = 0; i < drop.length; i++) {
          if (drop[i].parentNode) drop[i].parentNode.removeChild(drop[i]);
        }
        var cs = window.getComputedStyle(el);
        var styleText = "box-sizing:border-box;width:" + w + "px;height:" + h + "px;margin:0;";
        var props = ["color","background-color","font","font-size","font-family","font-weight","line-height","padding","border","border-radius","display","text-align","letter-spacing","opacity"];
        for (var p = 0; p < props.length; p++) {
          styleText += props[p] + ":" + pick(cs, props[p]) + ";";
        }
        if (clone.setAttribute) clone.setAttribute("style", styleText);
        var wrap = document.createElement("div");
        wrap.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
        wrap.setAttribute("style", "width:" + w + "px;height:" + h + "px;overflow:hidden;background:#fff;");
        wrap.appendChild(clone);
        var xml = new XMLSerializer().serializeToString(wrap);
        var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '"><foreignObject width="100%" height="100%">' + xml + "</foreignObject></svg>";
        var blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
        var url = URL.createObjectURL(blob);
        var img = new Image();
        img.onload = function() {
          try {
            var c = document.createElement("canvas");
            c.width = cw; c.height = ch;
            var ctx = c.getContext("2d");
            if (!ctx) throw new Error("ctx");
            ctx.scale(scale * dpr, scale * dpr);
            ctx.drawImage(img, 0, 0);
            URL.revokeObjectURL(url);
            var dataUrl = c.toDataURL("image/png");
            if (dataUrl.length > 380000) dataUrl = c.toDataURL("image/jpeg", 0.7);
            if (dataUrl.length > 480000) {
              state.shot = { status: "error", error: "too-large" };
            } else {
              state.shot = { status: "ok", dataUrl: dataUrl };
            }
          } catch (e5) {
            try { URL.revokeObjectURL(url); } catch (e6) {}
            state.shot = { status: "error", error: String(e5 && e5.message || e5) };
          }
        };
        img.onerror = function() {
          try { URL.revokeObjectURL(url); } catch (e7) {}
          state.shot = { status: "error", error: "img" };
        };
        img.src = url;
      } catch (e8) {
        state.shot = { status: "error", error: String(e8 && e8.message || e8) };
      }
    }

    var hoverEl = null;
    var selectedEl = null;
    function clearSelection() {
      hoverEl = null;
      selectedEl = null;
      state.selectedEl = null;
      state.selected = null;
      state.shot = { status: "idle" };
      state.version = (state.version || 0) + 1;
      place(hoverBox, null);
      place(selBox, null);
    }

    var state = {
      enabled: true,
      version: prev && typeof prev.version === "number" ? prev.version : 0,
      selected: null,
      shot: { status: "idle" },
      selectedEl: null,
      clearSelection: clearSelection,
      destroy: destroy
    };

    function onMove(ev) {
      if (!state.enabled) return;
      var el = ev.target;
      if (isOurs(el)) { hoverEl = null; place(hoverBox, null); return; }
      hoverEl = el;
      place(hoverBox, el);
    }
    function onClick(ev) {
      if (!state.enabled) return;
      var el = ev.target;
      if (isOurs(el)) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
      selectedEl = el;
      state.selectedEl = el;
      state.selected = collect(el);
      state.version += 1;
      place(selBox, el);
      startShot(el);
    }
    function onKey(ev) {
      if (!state.enabled) return;
      if (ev.key !== "Escape") return;
      if (!selectedEl) return;
      ev.preventDefault();
      clearSelection();
    }
    function onScroll() {
      if (hoverEl) place(hoverBox, hoverEl);
      if (selectedEl) place(selBox, selectedEl);
    }
    function destroy() {
      state.enabled = false;
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll, true);
      if (root && root.parentNode) root.parentNode.removeChild(root);
      hoverEl = null;
      selectedEl = null;
      state.selectedEl = null;
    }

    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll, true);
    window[NS] = state;
    return JSON.stringify({ ok: true });
  } catch (err) {
    return JSON.stringify({ ok: false, error: String(err && err.message || err) });
  }
})()`;
}

export function buildDesignModeTeardownScript(): string {
  const ns = JSON.stringify(DESIGN_MODE_NS);
  return `(function(){
  try {
    var NS = ${ns};
    var s = window[NS];
    if (s && typeof s.destroy === "function") s.destroy();
    window[NS] = undefined;
    try { delete window[NS]; } catch (e1) {}
    var root = document.getElementById("grok-dm-root");
    if (root && root.parentNode) root.parentNode.removeChild(root);
    return JSON.stringify({ ok: true });
  } catch (err) {
    return JSON.stringify({ ok: false, error: String(err && err.message || err) });
  }
})()`;
}

export function buildDesignModePollScript(): string {
  const ns = JSON.stringify(DESIGN_MODE_NS);
  return `(function(){
  try {
    var NS = ${ns};
    var s = window[NS];
    if (!s) return JSON.stringify({ ok: false, reason: "missing" });
    return JSON.stringify({
      ok: true,
      enabled: !!s.enabled,
      version: s.version || 0,
      hasSelection: !!(s.selected && s.selected.tag),
      shotStatus: (s.shot && s.shot.status) || "idle"
    });
  } catch (err) {
    return JSON.stringify({ ok: false, reason: String(err && err.message || err) });
  }
})()`;
}

export function buildDesignModeReadScript(): string {
  const ns = JSON.stringify(DESIGN_MODE_NS);
  return `(function(){
  try {
    var NS = ${ns};
    var s = window[NS];
    if (!s) return JSON.stringify({ ok: false, selected: null, shot: { status: "idle" } });
    return JSON.stringify({
      ok: true,
      selected: s.selected || null,
      shot: s.shot || { status: "idle" }
    });
  } catch (err) {
    return JSON.stringify({ ok: false, selected: null, shot: { status: "error", error: String(err && err.message || err) } });
  }
})()`;
}

export function buildDesignModeClearScript(): string {
  const ns = JSON.stringify(DESIGN_MODE_NS);
  return `(function(){
  try {
    var NS = ${ns};
    var s = window[NS];
    if (!s) return JSON.stringify({ ok: true });
    if (typeof s.clearSelection === "function") s.clearSelection();
    else {
      s.selected = null;
      s.selectedEl = null;
      s.shot = { status: "idle" };
      s.version = (s.version || 0) + 1;
    }
    return JSON.stringify({ ok: true });
  } catch (err) {
    return JSON.stringify({ ok: false, error: String(err && err.message || err) });
  }
})()`;
}
