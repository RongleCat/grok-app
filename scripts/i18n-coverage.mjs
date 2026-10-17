#!/usr/bin/env node
// Report how many keys of a locale differ from the English source.
// Usage: node scripts/i18n-coverage.mjs [locale=tr] [--min=0.0]
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const loc = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "tr";
const min = Number((process.argv.find((a) => a.startsWith("--min=")) ?? "--min=0").slice(6));
const root = new URL("../src/i18n/messages/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const pair = /^\s+("(?:[^"\\]|\\.)+"):\s*("(?:[^"\\]|\\.)*")\s*,?\s*$/;
const read = (dir) => {
  const out = new Map();
  for (const f of readdirSync(join(root, dir))) {
    if (f === "index.ts" || !f.endsWith(".ts")) continue;
    for (const line of readFileSync(join(root, dir, f), "utf8").split("\n")) {
      const m = pair.exec(line);
      if (m) out.set(`${f}:${JSON.parse(m[1])}`, JSON.parse(m[2]));
    }
  }
  return out;
};
const en = read("en"), tr = read(loc);
let same = 0, missing = 0;
const byFile = {};
for (const [k, v] of en) {
  const f = k.split(":")[0]; byFile[f] ??= [0, 0]; byFile[f][1]++;
  if (!tr.has(k)) missing++;
  else if (tr.get(k) !== v) byFile[f][0]++;
  else same++;
}
const done = en.size - same - missing;
for (const [f, [d, n]] of Object.entries(byFile)) console.log(`${f.padEnd(22)} ${d}/${n}`);
const ratio = done / en.size;
console.log(`${loc}: ${done}/${en.size} single-line keys differ from en (${(ratio * 100).toFixed(1)}%), ${missing} missing`);
if (missing > 0 || ratio < min) process.exit(1);
