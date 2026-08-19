/**
 * User bubble prefix written by Remote IM host when journaling turns into App.
 * Format: `[Remote IM · {channel}]\n{body}`
 */

export const REMOTE_IM_USER_HEADER_RE =
  /^\[Remote IM\s*[·•.\-]\s*([^\]]+)\](?:\r?\n)+(.*)$/s;

/** Alternate halfwidth/fullwidth dots and optional spaces. */
export const REMOTE_IM_USER_HEADER_RE_LOOSE =
  /^\[Remote IM\s*[·•.\-－]\s*([^\]]+)\]\s*\r?\n+([\s\S]*)$/;

export type RemoteImUserContent = {
  /** Raw channel id, e.g. feishu / weixin */
  channel: string;
  body: string;
};

/** Parse `[Remote IM · channel]\\n body` from Remote IM journaled turns. */
export function parseRemoteImUserContent(
  content: string,
): RemoteImUserContent | null {
  const raw = content || "";
  const m =
    REMOTE_IM_USER_HEADER_RE.exec(raw) ||
    REMOTE_IM_USER_HEADER_RE_LOOSE.exec(raw);
  if (!m) return null;
  const channel = (m[1] || "").trim();
  if (!channel) return null;
  return {
    channel,
    body: (m[2] || "").replace(/^\r?\n/, ""),
  };
}

/**
 * Human-readable channel label for the pill title.
 *
 * These are product names, not UI copy: only the Chinese-market apps have an
 * established local name, so Simplified Chinese gets it and every other locale
 * gets the international brand. Traditional Chinese keeps the brand's own
 * Traditional spelling where it differs.
 */
export function remoteImChannelLabel(channel: string, locale?: string): string {
  const c = channel.trim().toLowerCase();
  const v = (locale ?? "").trim().toLowerCase().replace(/_/g, "-");
  const traditional =
    v === "zh-tw" || v === "zh-hant" || v === "zh-hk" || v === "zh-mo";
  // No locale means the caller has none to give — default to the brand names.
  const simplified = v.startsWith("zh") && !traditional;

  const map: Record<string, { hans?: string; hant?: string; intl: string }> = {
    feishu: { hans: "飞书", hant: "飛書", intl: "Feishu" },
    lark: { intl: "Lark" },
    weixin: { hans: "微信", hant: "微信", intl: "WeChat" },
    wecom: { hans: "企业微信", hant: "企業微信", intl: "WeCom" },
    dingtalk: { hans: "钉钉", hant: "釘釘", intl: "DingTalk" },
    telegram: { intl: "Telegram" },
    discord: { intl: "Discord" },
    slack: { intl: "Slack" },
    qq: { intl: "QQ" },
    qqbot: { hans: "QQ 机器人", hant: "QQ 機器人", intl: "QQ Bot" },
  };

  const entry = map[c];
  if (!entry) return channel;
  if (simplified) return entry.hans ?? entry.intl;
  if (traditional) return entry.hant ?? entry.intl;
  return entry.intl;
}
