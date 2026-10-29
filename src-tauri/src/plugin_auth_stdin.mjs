// Keep legacy plugin CLI arguments out of the operating-system command line.
// This launcher is embedded in the host; secrets arrive only over its private stdin pipe.
import { pathToFileURL } from "node:url";

const script = process.argv[1];
// One length-prefixed frame. Stop once it is buffered; do not wait for stdin EOF.
const chunks = [];
let buffered = 0;
let declared = -1;
for await (const chunk of process.stdin) {
  chunks.push(chunk);
  buffered += chunk.length;
  if (declared < 0) {
    if (buffered < 4) continue;
    declared = Buffer.concat(chunks).readUInt32LE(0);
    if (declared > 65536) throw new Error("Plugin auth input is too large");
  }
  if (buffered >= 4 + declared) break;
}
const frame = Buffer.concat(chunks);
if (declared < 0 || frame.length < 4 + declared) {
  throw new Error("Invalid plugin auth input");
}
let args;
try {
  args = JSON.parse(frame.subarray(4, 4 + declared).toString("utf8"));
} catch {
  throw new Error("Invalid plugin auth input");
}
if (!script || !Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
  throw new Error("Invalid plugin auth arguments");
}
// Updating this JS array does not alter the OS command line. The plugin remains
// compatible with its existing process.argv-based parser without a second spawn.
process.argv = [process.execPath, script, ...args];
await import(pathToFileURL(script).href);
