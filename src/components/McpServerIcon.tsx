/**
 * 设置 → 扩展 → MCP 行的厂商标识。
 *
 * 图标异步解析：先在同步缓存里找，找不到先用字母徽标占位，结果到达后替换。
 * 组件卸载后到达的响应直接丢弃，避免对已移除的行写入状态。
 */

import { useEffect, useState } from "react";
import {
  loadMcpIcon,
  mcpMonogramLabel,
  mcpMonogramTone,
  peekMcpIcon,
  type McpIconResult,
} from "@/lib/mcpIcon";

export interface McpServerIconProps {
  /** MCP 服务器名，用于字母徽标。 */
  name: string;
  /** MCP Target；远程服务器是 URL，本地服务器是启动命令。 */
  target?: string | null;
  /**
   * 服务器是否启用。禁用的服务器只展示已有缓存或字母徽标：
   * 打开设置不应为一个被关掉的服务器发 `initialize` 或抓站点图标。
   */
  enabled?: boolean;
}

export function McpServerIcon({
  name,
  target,
  enabled = true,
}: McpServerIconProps) {
  const [icon, setIcon] = useState<McpIconResult | null>(() =>
    peekMcpIcon(target, name),
  );

  useEffect(() => {
    const cached = peekMcpIcon(target, name);
    setIcon(cached);
    if (cached || !enabled) return;
    let cancelled = false;
    void loadMcpIcon(target, name).then((result) => {
      if (!cancelled && result) setIcon(result);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, name, target]);

  const dataUrl = icon?.dataUrl ?? null;
  const tone = mcpMonogramTone(name);

  return (
    <div className="ext-ref-row__icon" aria-hidden>
      {dataUrl ? (
        <img
          className="ext-ref-row__icon-img"
          src={dataUrl}
          alt=""
          draggable={false}
        />
      ) : (
        <span className={"ext-ref-row__icon-mono ext-ref-row__icon-mono--tone-" + tone}>
          {mcpMonogramLabel(name)}
        </span>
      )}
    </div>
  );
}
