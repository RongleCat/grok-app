// Keep legacy plugin CLI arguments out of the operating-system command line.
// This launcher is embedded in the host; secrets arrive only over its private stdin pipe.
import { pathToFileURL } from "node:url";

const script = process.argv[1];
const chunks = [];
let length = 0;
for await (const chunk of process.stdin) {
  length += chunk.length;
  if (length > 65536) throw new Error("Plugin auth input is too large");
  chunks.push(chunk);
}
let args;
try {
  args = JSON.parse(Buffer.concat(chunks).toString("utf8"));
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
