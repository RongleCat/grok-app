/**
 * MCP 厂商标识：Target 提取、字母徽标与请求编排。
 *
 * 解析与缓存由宿主负责（`mcp_icon_resolve`）；这里只做前端可缓存、可测试的薄层，
 * 保证同一主机只发一次请求，并把宿主的返回值收敛成 UI 可用的形状。
 */

import * as api from "@/lib/api";
import { isDesktopHost } from "@/lib/api/host";

export type McpIconSource = "server" | "site" | "favicon" | "none";

/** 宿主 DTO 是唯一权威形状；前端只负责校验与缓存。 */
export type McpIconResult = api.McpIconDto;

/**
 * 字母徽标的配色档位数，与 CSS 中的 `--tone-*` 一一对应：
 * accent / success / warning / danger / info。新增档位要同时改样式表。
 */
export const MCP_MONOGRAM_TONES = 5;

/** 同时进行的图标请求上限；设置页一次可能挂出几十行。 */
const MAX_IN_FLIGHT = 4;

/**
 * 把 MCP Target 收敛成可交给宿主的 https URL。
 *
 * 非 https、带 userinfo、没有点号的主机名一律视为不可解析；宿主还会再校验一次，
 * 这里拒绝只是为了避免无意义的 IPC。
 */
export function mcpIconTargetUrl(target: string | null | undefined): string | null {
  const raw = (target ?? "").trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (!url.hostname.includes(".")) return null;
  if (url.username || url.password) return null;
  return url.toString();
}

/**
 * 图标请求的去重键：同一服务器共享一次解析。
 *
 * 带上服务器名，因为 `serverInfo.icons` 是每个服务器自报的；同一域名下的
 * 两个服务器可能声明不同图标。没有服务器名时退化为按主机去重。
 */
export function mcpIconRequestKey(
  target: string | null | undefined,
  serverName?: string | null,
): string {
  const url = mcpIconTargetUrl(target);
  if (!url) return "";
  const host = new URL(url).hostname.toLowerCase();
  const name = (serverName ?? "").trim().toLowerCase();
  return name ? `${host}\u0000${name}` : host;
}

/** 服务器名的首个字母或数字；没有可用字符时返回 `?`。 */
export function mcpMonogramLabel(name: string): string {
  const first = Array.from((name ?? "").trim()).find((ch) =>
    /[\p{L}\p{N}]/u.test(ch),
  );
  return (first ?? "?").toUpperCase();
}

/** 由名称得到稳定的配色档位：同名永远同色，与列表顺序无关。 */
export function mcpMonogramTone(name: string): number {
  let hash = 0x811c9dc5;
  for (const ch of (name ?? "").trim().toLowerCase()) {
    hash ^= ch.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % MCP_MONOGRAM_TONES;
}

/** 校验宿主返回的图标负载，丢弃形状不对的字段。 */
export function normalizeMcpIconResult(value: unknown): McpIconResult | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const source = raw.source;
  if (
    source !== "server" &&
    source !== "site" &&
    source !== "favicon" &&
    source !== "none"
  ) {
    return null;
  }
  const dataUrl =
    typeof raw.dataUrl === "string" &&
    raw.dataUrl.startsWith("data:image/") &&
    raw.dataUrl.length <= 1_000_000
      ? raw.dataUrl
      : null;
  const domain =
    typeof raw.domain === "string" && raw.domain.trim()
      ? raw.domain.trim().toLowerCase()
      : null;
  return {
    dataUrl,
    domain,
    source: dataUrl ? source : "none",
    fromCache: raw.fromCache === true,
  };
}

const resolvedCache = new Map<string, McpIconResult>();
const inFlight = new Map<string, Promise<McpIconResult | null>>();
const waiters: Array<() => void> = [];
let activeRequests = 0;

function acquireSlot(): Promise<void> {
  if (activeRequests < MAX_IN_FLIGHT) {
    activeRequests += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    waiters.push(() => {
      activeRequests += 1;
      resolve();
    });
  });
}

function releaseSlot(): void {
  activeRequests -= 1;
  waiters.shift()?.();
}

/** 同步读取已解析结果，避免列表重挂载时闪一下字母徽标。 */
export function peekMcpIcon(
  target: string | null | undefined,
  serverName?: string | null,
): McpIconResult | null {
  const key = mcpIconRequestKey(target, serverName);
  return key ? (resolvedCache.get(key) ?? null) : null;
}

/**
 * 取厂商图标。浏览器预览（无宿主）与镜像客户端直接返回 null，由 UI 显示字母徽标。
 * 命令失败按“没有图标”处理，不向用户抛错。
 */
export function loadMcpIcon(
  target: string | null | undefined,
  serverName?: string | null,
): Promise<McpIconResult | null> {
  const url = mcpIconTargetUrl(target);
  if (!url) return Promise.resolve(null);
  const key = mcpIconRequestKey(url, serverName);
  if (!key) return Promise.resolve(null);
  const cached = resolvedCache.get(key);
  if (cached) return Promise.resolve(cached);
  const existing = inFlight.get(key);
  if (existing) return existing;
  if (!isDesktopHost()) return Promise.resolve(null);

  const task = (async (): Promise<McpIconResult | null> => {
    await acquireSlot();
    try {
      const raw = await api.mcpIconResolve(url, serverName ?? undefined);
      const result = normalizeMcpIconResult(raw);
      if (!result || result.source === "none") return null;
      resolvedCache.set(key, result);
      return result;
    } catch {
      return null;
    } finally {
      releaseSlot();
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, task);
  return task;
}

/** 仅测试使用：清空会话内缓存的图标与在途请求。 */
export function resetMcpIconCacheForTests(): void {
  resolvedCache.clear();
  inFlight.clear();
  waiters.length = 0;
  activeRequests = 0;
}
