#!/usr/bin/env node
/**
 * PR Monitor MCP — the Agent's own handle on the App's PR watches (stdio).
 *
 * The Host owns every watch (in-process registry, poll loop, wake delivery) and
 * exposes it on the loopback session API. This server is the Agent-facing half:
 * it turns the API into three tools, so an agent that just opened a PR can
 * watch it, see what it is watching, and stop watching when the PR is done —
 * no human has to click the watch bell.
 *
 * The Host injects this script per session (see `pr_monitor/mcp.rs`) and passes:
 *   GROK_APP_PR_MONITOR_ENDPOINT  path to `session-api.json` ({url, token, pid})
 *   GROK_APP_SESSION_ID           the app session that owns the watches
 *   GROK_APP_PROJECT_PATH         the session's project (default for pr_watch)
 *
 * No dependencies: plain stdio JSON-RPC, same shape as official-aux-mcp.mjs.
 */

import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";

const ENDPOINT_ENV = "GROK_APP_PR_MONITOR_ENDPOINT";
const SESSION_ENV = "GROK_APP_SESSION_ID";
const PROJECT_ENV = "GROK_APP_PROJECT_PATH";

function env(name) {
  return String(process.env[name] ?? "").trim();
}

/** `{url, token}` from the endpoint file the Host wrote (0600, same user). */
function endpoint() {
  const file = env(ENDPOINT_ENV);
  if (!file) {
    throw new Error(
      `${ENDPOINT_ENV} is not set: this session has no Grok App host to talk to`,
    );
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`cannot read the host endpoint file (${file}): ${e.message}`);
  }
  const url = String(raw?.url ?? "").trim().replace(/\/+$/, "");
  const token = String(raw?.token ?? "").trim();
  if (!url || !token) {
    throw new Error(`host endpoint file (${file}) has no url/token`);
  }
  return { url, token };
}

/** One loopback call. Returns parsed JSON, or throws the Host's message. */
async function call(method, path, body) {
  const { url, token } = endpoint();
  const res = await fetch(`${url}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-grok-token": token,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const message =
      (json && (json.error || json.message)) ||
      (text.trim() ? text.trim() : `HTTP ${res.status}`);
    throw new Error(String(message));
  }
  return json;
}

function sessionIdArg() {
  const sid = env(SESSION_ENV);
  if (!sid) {
    throw new Error(`${SESSION_ENV} is not set: cannot tell which chat to watch for`);
  }
  return sid;
}

function projectArg(args) {
  const given = String(args?.project_path ?? "").trim();
  const project = given || env(PROJECT_ENV);
  if (!project) {
    throw new Error(
      "no project to watch: pass project_path, or open this chat in a project",
    );
  }
  return project;
}

function prNumberArg(args) {
  const n = Math.trunc(Number(args?.pr_number));
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error("pr_number must be a positive integer (e.g. 1322)");
  }
  return n;
}

const TOOLS = [
  {
    name: "pr_watch",
    description:
      "Start watching a pull request in this chat. The host polls it and wakes this chat with a follow-up turn when it really changes (new comment or review, CI fail, CI green, mergeable change, state change). Call this right after `gh pr create` so the PR is followed without asking the user to click anything. Watching is per chat; the same PR watched twice stays one watch.",
    inputSchema: {
      type: "object",
      properties: {
        pr_number: {
          type: "integer",
          description: "Pull request number, e.g. 1322",
        },
        project_path: {
          type: "string",
          description:
            "Repository to read the PR from. Defaults to this chat's project.",
        },
        interval_secs: {
          type: "integer",
          description: "Poll interval in seconds (host clamps it).",
        },
      },
      required: ["pr_number"],
    },
  },
  {
    name: "pr_unwatch",
    description:
      "Stop watching a pull request in this chat — call it to wrap up. Author side (your own PR, and the user wants it merged): merge it with `gh pr merge`, clean up the local branch, then stop the watch. Contributor side (a maintainer merged or closed your PR): stop the watch and stop doing further work for that branch. The host also drops a watch by itself after the single follow-up turn it delivers for a merged/closed PR, so this call is mostly about ending a watch early.",
    inputSchema: {
      type: "object",
      properties: {
        pr_number: {
          type: "integer",
          description: "Pull request number to stop watching",
        },
      },
      required: ["pr_number"],
    },
  },
  {
    name: "pr_watches",
    description:
      "List the pull requests this chat is watching right now, with state, checks rollup and the last poll error. Use it before watching (to avoid duplicates) and when wrapping up (to confirm nothing is left mounted).",
    inputSchema: { type: "object", properties: {} },
  },
];

function requireSession() {
  return `/v1/pr-monitor/watches?session_id=${encodeURIComponent(sessionIdArg())}`;
}

async function runTool(name, args) {
  if (name === "pr_watch") {
    const result = await call("POST", "/v1/pr-monitor/watches", {
      session_id: sessionIdArg(),
      project_path: projectArg(args),
      pr_number: prNumberArg(args),
      interval_secs: args?.interval_secs ?? null,
    });
    if (result && result.ok === false) {
      throw new Error(result.error || "the host refused to mount the watch");
    }
    return `Watching PR #${prNumberArg(args)} in this chat. The host polls it and wakes this chat on real changes; it stops by itself after the follow-up on a merged/closed PR.`;
  }

  if (name === "pr_unwatch") {
    const n = prNumberArg(args);
    const result = await call("DELETE", "/v1/pr-monitor/watches", {
      session_id: sessionIdArg(),
      pr_number: n,
    });
    return result && result.removed
      ? `Stopped watching PR #${n}.`
      : `PR #${n} was not watched by this chat; nothing to stop.`;
  }

  if (name === "pr_watches") {
    const state = await call("GET", requireSession());
    const watches = Array.isArray(state?.watches) ? state.watches : [];
    if (watches.length === 0) {
      return "This chat is not watching any pull request.";
    }
    return JSON.stringify(
      watches.map((w) => ({
        prNumber: w.prNumber,
        projectPath: w.projectPath,
        state: w.snapshot?.state ?? null,
        title: w.snapshot?.title ?? null,
        intervalSecs: w.intervalSecs,
        polls: w.polls,
        updates: w.updates,
        terminal: w.terminal ?? false,
        lastPollAt: w.lastPollAt ?? null,
        lastError: w.lastError ?? null,
      })),
      null,
      1,
    );
  }

  throw new Error(`unknown tool: ${name}`);
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function okResult(id, text) {
  send({
    jsonrpc: "2.0",
    id,
    result: { content: [{ type: "text", text: String(text) }], isError: false },
  });
}

function errResult(id, message) {
  send({
    jsonrpc: "2.0",
    id,
    result: { content: [{ type: "text", text: String(message) }], isError: true },
  });
}

async function handle(msg) {
  if (!msg || typeof msg !== "object") return;
  const { id, method, params } = msg;

  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: params?.protocolVersion || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "pr-monitor", version: "1.0.0" },
      },
    });
    return;
  }

  if (method === "notifications/initialized" || method === "initialized") {
    return;
  }

  if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    return;
  }

  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments || {};
    try {
      okResult(id, await runTool(name, args));
    } catch (e) {
      errResult(id, e?.message || String(e));
    }
    return;
  }

  if (method === "ping") {
    send({ jsonrpc: "2.0", id, result: {} });
    return;
  }

  if (id !== undefined && id !== null) {
    send({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    void handle(JSON.parse(trimmed));
  } catch {
    // Ignore malformed input; the transport stays alive.
  }
});
