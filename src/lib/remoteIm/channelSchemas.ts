/**
 * Schema-driven Remote IM channel catalog.
 * Spec §6 field lists — add a channel by extending schemas, not full JSX pages.
 */

import type { ChannelSchema, RemoteChannelId } from "./types";

const ACL_ALLOW_FROM = {
  key: "allow_from",
  labelKey: "settings.remoteIm.field.allowFrom",
  control: "text" as const,
  section: "options" as const,
  defaultValue: "*",
  helpKey: "settings.remoteIm.field.allowFromHelp",
};

const SHARED_SESSION = {
  key: "share_session_in_channel",
  labelKey: "settings.remoteIm.field.shareSession",
  control: "checkbox" as const,
  section: "options" as const,
  defaultValue: false,
};

const THREAD_ISOLATION = {
  key: "thread_isolation",
  labelKey: "settings.remoteIm.field.threadIsolation",
  control: "checkbox" as const,
  section: "options" as const,
  defaultValue: false,
};

const PROGRESS_STYLE = {
  key: "progress_style",
  labelKey: "settings.remoteIm.field.progressStyle",
  control: "select" as const,
  section: "options" as const,
  defaultValue: "compact",
  choices: [
    { value: "legacy", labelKey: "settings.remoteIm.progress.legacy" },
    { value: "compact", labelKey: "settings.remoteIm.progress.compact" },
    { value: "card", labelKey: "settings.remoteIm.progress.card" },
  ],
};

const REACTION = {
  key: "reaction_emoji",
  labelKey: "settings.remoteIm.field.reactionEmoji",
  control: "text" as const,
  section: "options" as const,
  defaultValue: "",
};

const DONE_EMOJI = {
  key: "done_emoji",
  labelKey: "settings.remoteIm.field.doneEmoji",
  control: "text" as const,
  section: "options" as const,
  defaultValue: "",
};

const PROXY = {
  key: "proxy",
  labelKey: "settings.remoteIm.field.proxy",
  control: "text" as const,
  section: "advanced" as const,
  defaultValue: "",
};

/** Feishu / Lark §6.1 — Phase 1 implemented */
const FEISHU_FIELDS: ChannelSchema["fields"] = [
  {
    key: "app_id",
    labelKey: "settings.remoteIm.field.appId",
    control: "text",
    section: "bind",
    required: true,
    helpKey: "settings.remoteIm.feishu.appIdHelp",
  },
  {
    key: "app_secret",
    labelKey: "settings.remoteIm.field.appSecret",
    control: "password",
    section: "bind",
    required: true,
    secret: true,
    helpKey: "settings.remoteIm.feishu.appSecretHelp",
  },
  {
    key: "domain",
    labelKey: "settings.remoteIm.field.domain",
    control: "select",
    section: "bind",
    defaultValue: "open.feishu.cn",
    helpKey: "settings.remoteIm.feishu.domainHelp",
    choices: [
      {
        value: "open.feishu.cn",
        labelKey: "settings.remoteIm.domain.feishu",
      },
      {
        value: "open.larksuite.com",
        labelKey: "settings.remoteIm.domain.lark",
      },
      { value: "custom", labelKey: "settings.remoteIm.domain.custom" },
    ],
  },
  {
    key: "custom_domain",
    labelKey: "settings.remoteIm.field.customDomain",
    control: "text",
    section: "bind",
    when: { key: "domain", equals: "custom" },
    helpKey: "settings.remoteIm.feishu.customDomainHelp",
  },
  {
    key: "port",
    labelKey: "settings.remoteIm.field.port",
    control: "text",
    section: "advanced",
    helpKey: "settings.remoteIm.field.webhookOnly",
  },
  {
    key: "callback_path",
    labelKey: "settings.remoteIm.field.callbackPath",
    control: "text",
    section: "advanced",
    helpKey: "settings.remoteIm.field.webhookOnly",
  },
  {
    key: "encrypt_key",
    labelKey: "settings.remoteIm.field.encryptKey",
    control: "password",
    section: "advanced",
    secret: true,
    helpKey: "settings.remoteIm.field.webhookOnly",
  },
  {
    key: "enable_feishu_card",
    labelKey: "settings.remoteIm.field.enableFeishuCard",
    control: "toggle",
    section: "options",
    defaultValue: true,
    helpKey: "settings.remoteIm.feishu.enableCardHelp",
  },
  // group_reply_all is inverse of ACL requireMention (§3.2 / §6.1) — not dual-rendered
  {
    key: "group_only",
    labelKey: "settings.remoteIm.field.groupOnly",
    control: "checkbox",
    section: "options",
    defaultValue: false,
  },
  SHARED_SESSION,
  THREAD_ISOLATION,
  {
    key: "reply_to_trigger",
    labelKey: "settings.remoteIm.field.replyToTrigger",
    control: "checkbox",
    section: "options",
    defaultValue: true,
  },
  { ...PROGRESS_STYLE, defaultValue: "legacy" },
  { ...REACTION, defaultValue: "OnIt" },
  DONE_EMOJI,
  {
    key: "image_batch_window_ms",
    labelKey: "settings.remoteIm.field.imageBatchMs",
    control: "number",
    section: "advanced",
    defaultValue: 500,
  },
  {
    key: "resolve_mentions",
    labelKey: "settings.remoteIm.field.resolveMentions",
    control: "checkbox",
    section: "advanced",
    defaultValue: false,
  },
  {
    key: "mention_map",
    labelKey: "settings.remoteIm.field.mentionMap",
    control: "text",
    section: "advanced",
    helpKey: "settings.remoteIm.feishu.mentionMapHelp",
    placeholderKey: "settings.remoteIm.feishu.mentionMapPlaceholder",
  },
];

const DINGTALK_FIELDS: ChannelSchema["fields"] = [
  {
    key: "client_id",
    labelKey: "settings.remoteIm.field.clientId",
    control: "text",
    section: "bind",
    required: true,
    helpKey: "settings.remoteIm.dingtalk.clientIdHelp",
  },
  {
    key: "client_secret",
    labelKey: "settings.remoteIm.field.clientSecret",
    control: "password",
    section: "bind",
    required: true,
    secret: true,
    helpKey: "settings.remoteIm.dingtalk.clientSecretHelp",
  },
  {
    ...ACL_ALLOW_FROM,
    helpKey: "settings.remoteIm.dingtalk.allowFromHelp",
  },
  SHARED_SESSION,
  { ...REACTION, defaultValue: "🤔Thinking" },
  DONE_EMOJI,
  {
    key: "enable_ai_card",
    labelKey: "settings.remoteIm.field.enableAiCard",
    control: "toggle",
    section: "options",
    defaultValue: true,
    helpKey: "settings.remoteIm.dingtalk.enableAiCardHelp",
  },
];

const WECOM_FIELDS: ChannelSchema["fields"] = [
  {
    key: "connect_mode",
    labelKey: "settings.remoteIm.field.connectMode",
    control: "radio",
    section: "bind",
    required: true,
    defaultValue: "websocket",
    helpKey: "settings.remoteIm.wecom.modeHelp",
    choices: [
      {
        value: "websocket",
        labelKey: "settings.remoteIm.wecom.modeWs",
      },
      {
        value: "webhook",
        labelKey: "settings.remoteIm.wecom.modeWebhook",
      },
    ],
  },
  {
    key: "bot_id",
    labelKey: "settings.remoteIm.field.botId",
    control: "text",
    section: "bind",
    required: true,
    helpKey: "settings.remoteIm.wecom.botIdHelp",
    when: { key: "connect_mode", equals: "websocket" },
  },
  {
    key: "bot_secret",
    labelKey: "settings.remoteIm.field.botSecret",
    control: "password",
    section: "bind",
    required: true,
    secret: true,
    helpKey: "settings.remoteIm.wecom.botSecretHelp",
    when: { key: "connect_mode", equals: "websocket" },
  },
  {
    key: "api_base_url",
    labelKey: "settings.remoteIm.field.apiBaseUrl",
    control: "text",
    section: "advanced",
    helpKey: "settings.remoteIm.wecom.apiBaseHelp",
    when: { key: "connect_mode", equals: "websocket" },
  },
  {
    key: "corp_id",
    labelKey: "settings.remoteIm.field.corpId",
    control: "text",
    section: "bind",
    required: true,
    helpKey: "settings.remoteIm.wecom.corpIdHelp",
    when: { key: "connect_mode", equals: "webhook" },
  },
  {
    key: "corp_secret",
    labelKey: "settings.remoteIm.field.corpSecret",
    control: "password",
    section: "bind",
    required: true,
    secret: true,
    when: { key: "connect_mode", equals: "webhook" },
  },
  {
    key: "agent_id",
    labelKey: "settings.remoteIm.field.agentId",
    control: "text",
    section: "bind",
    required: true,
    helpKey: "settings.remoteIm.wecom.agentIdHelp",
    when: { key: "connect_mode", equals: "webhook" },
  },
  {
    key: "callback_token",
    labelKey: "settings.remoteIm.field.callbackToken",
    control: "password",
    section: "bind",
    required: true,
    secret: true,
    helpKey: "settings.remoteIm.wecom.callbackTokenHelp",
    when: { key: "connect_mode", equals: "webhook" },
  },
  {
    key: "encoding_aes_key",
    labelKey: "settings.remoteIm.field.encodingAesKey",
    control: "password",
    section: "bind",
    secret: true,
    helpKey: "settings.remoteIm.wecom.encodingAesKeyHelp",
    when: { key: "connect_mode", equals: "webhook" },
  },
  {
    key: "port",
    labelKey: "settings.remoteIm.field.port",
    control: "number",
    section: "advanced",
    defaultValue: 8081,
    helpKey: "settings.remoteIm.wecom.portHelp",
    when: { key: "connect_mode", equals: "webhook" },
  },
  {
    key: "callback_path",
    labelKey: "settings.remoteIm.field.callbackPath",
    control: "text",
    section: "advanced",
    defaultValue: "/wecom/callback",
    when: { key: "connect_mode", equals: "webhook" },
  },
  {
    key: "enable_markdown",
    labelKey: "settings.remoteIm.field.enableMarkdown",
    control: "toggle",
    section: "options",
    defaultValue: true,
    when: { key: "connect_mode", equals: "webhook" },
  },
  ACL_ALLOW_FROM,
  PROXY,
];

const WEIXIN_FIELDS: ChannelSchema["fields"] = [
  {
    key: "token",
    labelKey: "settings.remoteIm.field.token",
    control: "password",
    section: "bind",
    required: true,
    secret: true,
    helpKey: "settings.remoteIm.weixin.tokenHelp",
    placeholderKey: "settings.remoteIm.weixin.tokenPlaceholder",
  },
  {
    key: "base_url",
    labelKey: "settings.remoteIm.field.baseUrl",
    control: "text",
    section: "advanced",
    helpKey: "settings.remoteIm.weixin.baseUrlHelp",
    placeholderKey: "settings.remoteIm.weixin.baseUrlPlaceholder",
  },
  {
    key: "cdn_base_url",
    labelKey: "settings.remoteIm.field.cdnBaseUrl",
    control: "text",
    section: "advanced",
    helpKey: "settings.remoteIm.weixin.cdnBaseHelp",
  },
  {
    ...ACL_ALLOW_FROM,
    helpKey: "settings.remoteIm.weixin.allowFromHelp",
  },
  {
    key: "account_id",
    labelKey: "settings.remoteIm.field.accountId",
    control: "text",
    section: "options",
    defaultValue: "default",
    helpKey: "settings.remoteIm.weixin.accountIdHelp",
  },
  {
    key: "route_tag",
    labelKey: "settings.remoteIm.field.routeTag",
    control: "text",
    section: "advanced",
    helpKey: "settings.remoteIm.weixin.routeTagHelp",
  },
  {
    key: "long_poll_timeout_ms",
    labelKey: "settings.remoteIm.field.longPollMs",
    control: "number",
    section: "advanced",
    defaultValue: 35000,
    helpKey: "settings.remoteIm.weixin.longPollHelp",
  },
  {
    key: "chat_id",
    labelKey: "settings.remoteIm.field.chatId",
    control: "text",
    section: "options",
    helpKey: "settings.remoteIm.weixin.chatIdHelp",
  },
  {
    ...PROXY,
    helpKey: "settings.remoteIm.weixin.proxyHelp",
    placeholderKey: "settings.remoteIm.weixin.proxyPlaceholder",
  },
];

const TELEGRAM_FIELDS: ChannelSchema["fields"] = [
  {
    key: "token",
    labelKey: "settings.remoteIm.field.botToken",
    control: "password",
    section: "bind",
    required: true,
    secret: true,
    helpKey: "settings.remoteIm.telegram.tokenHelp",
    placeholderKey: "settings.remoteIm.telegram.tokenPlaceholder",
  },
  ACL_ALLOW_FROM,
  {
    ...PROXY,
    helpKey: "settings.remoteIm.telegram.proxyHelp",
    placeholderKey: "settings.remoteIm.telegram.proxyPlaceholder",
  },
  {
    key: "proxy_username",
    labelKey: "settings.remoteIm.field.proxyUsername",
    control: "text",
    section: "advanced",
    helpKey: "settings.remoteIm.telegram.proxyUserHelp",
  },
  {
    key: "proxy_password",
    labelKey: "settings.remoteIm.field.proxyPassword",
    control: "password",
    section: "advanced",
    secret: true,
    helpKey: "settings.remoteIm.telegram.proxyPassHelp",
  },
  PROGRESS_STYLE,
  {
    key: "thread_isolation",
    labelKey: "settings.remoteIm.field.threadIsolation",
    control: "checkbox",
    section: "options",
    defaultValue: false,
    helpKey: "settings.remoteIm.telegram.threadHelp",
  },
];

const SLACK_FIELDS: ChannelSchema["fields"] = [
  {
    key: "bot_token",
    labelKey: "settings.remoteIm.field.botTokenXoxb",
    control: "password",
    section: "bind",
    required: true,
    secret: true,
    helpKey: "settings.remoteIm.slack.botTokenHelp",
    placeholderKey: "settings.remoteIm.slack.botTokenPlaceholder",
  },
  {
    key: "app_token",
    labelKey: "settings.remoteIm.field.appTokenXapp",
    control: "password",
    section: "bind",
    required: true,
    secret: true,
    helpKey: "settings.remoteIm.slack.appTokenHelp",
    placeholderKey: "settings.remoteIm.slack.appTokenPlaceholder",
  },
  {
    ...ACL_ALLOW_FROM,
    helpKey: "settings.remoteIm.slack.allowFromHelp",
  },
];

const DISCORD_FIELDS: ChannelSchema["fields"] = [
  {
    key: "token",
    labelKey: "settings.remoteIm.field.botToken",
    control: "password",
    section: "bind",
    required: true,
    secret: true,
    helpKey: "settings.remoteIm.discord.tokenHelp",
    placeholderKey: "settings.remoteIm.discord.tokenPlaceholder",
  },
  {
    ...ACL_ALLOW_FROM,
    helpKey: "settings.remoteIm.discord.allowFromHelp",
  },
  {
    ...THREAD_ISOLATION,
    helpKey: "settings.remoteIm.discord.threadHelp",
  },
  {
    ...PROGRESS_STYLE,
    helpKey: "settings.remoteIm.discord.progressHelp",
  },
];

const MATRIX_FIELDS: ChannelSchema["fields"] = [
  {
    key: "homeserver",
    labelKey: "settings.remoteIm.field.homeserver",
    control: "text",
    section: "bind",
    required: true,
    helpKey: "settings.remoteIm.matrix.homeserverHelp",
    placeholderKey: "settings.remoteIm.matrix.homeserverPlaceholder",
  },
  {
    key: "access_token",
    labelKey: "settings.remoteIm.field.accessToken",
    control: "password",
    section: "bind",
    required: true,
    secret: true,
    helpKey: "settings.remoteIm.matrix.tokenHelp",
    placeholderKey: "settings.remoteIm.matrix.tokenPlaceholder",
  },
  {
    key: "user_id",
    labelKey: "settings.remoteIm.field.userId",
    control: "text",
    section: "options",
    helpKey: "settings.remoteIm.matrix.userIdHelp",
    placeholderKey: "settings.remoteIm.matrix.userIdPlaceholder",
  },
  {
    key: "device_id",
    labelKey: "settings.remoteIm.field.deviceId",
    control: "text",
    section: "advanced",
    helpKey: "settings.remoteIm.matrix.deviceIdHelp",
  },
  {
    ...ACL_ALLOW_FROM,
    helpKey: "settings.remoteIm.matrix.allowFromHelp",
  },
  {
    key: "auto_join",
    labelKey: "settings.remoteIm.field.autoJoin",
    control: "checkbox",
    section: "options",
    defaultValue: true,
    helpKey: "settings.remoteIm.matrix.autoJoinHelp",
  },
  {
    key: "auto_verify",
    labelKey: "settings.remoteIm.field.autoVerify",
    control: "checkbox",
    section: "options",
    defaultValue: true,
    helpKey: "settings.remoteIm.matrix.autoVerifyHelp",
  },
  {
    key: "cross_signing_password",
    labelKey: "settings.remoteIm.field.crossSigningPassword",
    control: "password",
    section: "advanced",
    secret: true,
    helpKey: "settings.remoteIm.matrix.crossSigningHelp",
  },
  {
    ...SHARED_SESSION,
    helpKey: "settings.remoteIm.matrix.shareSessionHelp",
  },
  {
    key: "group_reply_all",
    labelKey: "settings.remoteIm.field.groupReplyAll",
    control: "checkbox",
    section: "options",
    defaultValue: false,
    helpKey: "settings.remoteIm.matrix.groupReplyHelp",
  },
  {
    ...PROXY,
    helpKey: "settings.remoteIm.matrix.proxyHelp",
    placeholderKey: "settings.remoteIm.matrix.proxyPlaceholder",
  },
];

const QQ_FIELDS: ChannelSchema["fields"] = [
  {
    key: "ws_url",
    labelKey: "settings.remoteIm.field.wsUrl",
    control: "text",
    section: "bind",
    required: true,
  },
  {
    key: "token",
    labelKey: "settings.remoteIm.field.accessToken",
    control: "password",
    section: "bind",
    secret: true,
  },
  ACL_ALLOW_FROM,
];

const QQBOT_FIELDS: ChannelSchema["fields"] = [
  {
    key: "app_id",
    labelKey: "settings.remoteIm.field.appId",
    control: "text",
    section: "bind",
    required: true,
  },
  {
    key: "app_secret",
    labelKey: "settings.remoteIm.field.appSecret",
    control: "password",
    section: "bind",
    required: true,
    secret: true,
  },
  {
    key: "intents",
    labelKey: "settings.remoteIm.field.intents",
    control: "text",
    section: "advanced",
    helpKey: "settings.remoteIm.field.intentsHelp",
  },
  ACL_ALLOW_FROM,
];

const WEIBO_FIELDS: ChannelSchema["fields"] = [
  {
    key: "app_id",
    labelKey: "settings.remoteIm.field.appId",
    control: "text",
    section: "bind",
    required: true,
  },
  {
    key: "app_secret",
    labelKey: "settings.remoteIm.field.appSecret",
    control: "password",
    section: "bind",
    required: true,
    secret: true,
  },
  ACL_ALLOW_FROM,
  {
    key: "token_endpoint",
    labelKey: "settings.remoteIm.field.tokenEndpoint",
    control: "text",
    section: "advanced",
  },
  {
    key: "ws_endpoint",
    labelKey: "settings.remoteIm.field.wsEndpoint",
    control: "text",
    section: "advanced",
  },
];

const WPS_XIEZUO_FIELDS: ChannelSchema["fields"] = [
  {
    key: "app_id",
    labelKey: "settings.remoteIm.field.appId",
    control: "text",
    section: "bind",
    required: true,
  },
  {
    key: "app_secret",
    labelKey: "settings.remoteIm.field.appSecret",
    control: "password",
    section: "bind",
    required: true,
    secret: true,
  },
  {
    key: "base_url",
    labelKey: "settings.remoteIm.field.apiBaseUrl",
    control: "text",
    section: "options",
    defaultValue: "https://openapi.wps.cn",
  },
  ACL_ALLOW_FROM,
  {
    key: "clean_reply",
    labelKey: "settings.remoteIm.field.cleanReply",
    control: "checkbox",
    section: "options",
    defaultValue: false,
  },
];

const WPS_AGENTSPACE_FIELDS: ChannelSchema["fields"] = [
  {
    key: "app_id",
    labelKey: "settings.remoteIm.field.appId",
    control: "text",
    section: "bind",
    required: true,
  },
  {
    key: "wps_sid",
    labelKey: "settings.remoteIm.field.wpsSid",
    control: "password",
    section: "bind",
    required: true,
    secret: true,
  },
  {
    key: "device_name",
    labelKey: "settings.remoteIm.field.deviceName",
    control: "text",
    section: "options",
  },
  {
    key: "device_uuid",
    labelKey: "settings.remoteIm.field.deviceUuid",
    control: "text",
    section: "advanced",
  },
];

const LINE_FIELDS: ChannelSchema["fields"] = [
  {
    key: "channel_secret",
    labelKey: "settings.remoteIm.field.channelSecret",
    control: "password",
    section: "bind",
    required: true,
    secret: true,
    helpKey: "settings.remoteIm.line.channelSecretHelp",
    placeholderKey: "settings.remoteIm.line.channelSecretPlaceholder",
  },
  {
    key: "channel_access_token",
    labelKey: "settings.remoteIm.field.channelAccessToken",
    control: "password",
    section: "bind",
    required: true,
    secret: true,
    helpKey: "settings.remoteIm.line.accessTokenHelp",
    placeholderKey: "settings.remoteIm.line.accessTokenPlaceholder",
  },
  {
    key: "port",
    labelKey: "settings.remoteIm.field.port",
    control: "number",
    section: "advanced",
    helpKey: "settings.remoteIm.line.portHelp",
    placeholderKey: "settings.remoteIm.line.portPlaceholder",
  },
  {
    key: "callback_path",
    labelKey: "settings.remoteIm.field.callbackPath",
    control: "text",
    section: "advanced",
    helpKey: "settings.remoteIm.line.callbackPathHelp",
    placeholderKey: "settings.remoteIm.line.callbackPathPlaceholder",
  },
];

/**
 * Soft-retired channel ids (product decision: WPS xiezuo + agentspace).
 * Kept in CHANNEL_SCHEMAS for legacy instance resolve; hidden by default.
 */
export const RETIRED_CHANNEL_IDS: readonly RemoteChannelId[] = [
  "wps-xiezuo",
  "wps-agentspace",
] as const;

/**
 * Full sidebar catalog order (spec §2.2).
 * `implemented` gates credential submit; false → comingSoon panel.
 * `retired` / `unsupported` hide from default picker; soft banner for legacy.
 */
export const CHANNEL_SCHEMAS: ChannelSchema[] = [
  {
    id: "feishu",
    group: "domestic",
    implemented: true,
    scanSupport: true,
    pasteSupport: true,
    connectionKey: "settings.remoteIm.conn.websocket",
    nameKey: "settings.remoteIm.channel.feishu",
    fields: FEISHU_FIELDS,
  },
  {
    id: "lark",
    group: "domestic",
    implemented: true,
    scanSupport: true,
    pasteSupport: true,
    connectionKey: "settings.remoteIm.conn.websocket",
    nameKey: "settings.remoteIm.channel.lark",
    fields: FEISHU_FIELDS.map((f) =>
      f.key === "domain"
        ? { ...f, defaultValue: "open.larksuite.com" }
        : f,
    ),
  },
  {
    id: "dingtalk",
    group: "domestic",
    implemented: true,
    // Paste only until official DingTalk QR onboarding is productized
    scanSupport: false,
    pasteSupport: true,
    connectionKey: "settings.remoteIm.conn.stream",
    nameKey: "settings.remoteIm.channel.dingtalk",
    fields: DINGTALK_FIELDS,
  },
  {
    id: "wecom",
    group: "domestic",
    implemented: true,
    scanSupport: false,
    pasteSupport: true,
    needsPublicUrl: true,
    connectionKey: "settings.remoteIm.conn.wsOrWebhook",
    nameKey: "settings.remoteIm.channel.wecom",
    fields: WECOM_FIELDS,
  },
  {
    id: "weixin",
    group: "domestic",
    implemented: true,
    scanSupport: true,
    pasteSupport: true,
    connectionKey: "settings.remoteIm.conn.longPoll",
    nameKey: "settings.remoteIm.channel.weixin",
    fields: WEIXIN_FIELDS,
  },
  {
    id: "wps-xiezuo",
    group: "domestic",
    implemented: false,
    retired: true,
    unsupported: true,
    scanSupport: false,
    pasteSupport: false,
    connectionKey: "settings.remoteIm.conn.websocket",
    nameKey: "settings.remoteIm.channel.wpsXiezuo",
    fields: WPS_XIEZUO_FIELDS,
  },
  {
    id: "weibo",
    group: "domestic",
    implemented: true,
    scanSupport: false,
    pasteSupport: true,
    connectionKey: "settings.remoteIm.conn.websocket",
    nameKey: "settings.remoteIm.channel.weibo",
    fields: WEIBO_FIELDS,
  },
  {
    id: "qq",
    group: "domestic",
    implemented: true,
    scanSupport: false,
    pasteSupport: true,
    connectionKey: "settings.remoteIm.conn.forwardWs",
    nameKey: "settings.remoteIm.channel.qq",
    fields: QQ_FIELDS,
  },
  {
    id: "qqbot",
    group: "domestic",
    implemented: true,
    scanSupport: false,
    pasteSupport: true,
    connectionKey: "settings.remoteIm.conn.websocket",
    nameKey: "settings.remoteIm.channel.qqbot",
    fields: QQBOT_FIELDS,
  },
  {
    id: "telegram",
    group: "overseas",
    implemented: true,
    scanSupport: false,
    pasteSupport: true,
    connectionKey: "settings.remoteIm.conn.longPoll",
    nameKey: "settings.remoteIm.channel.telegram",
    fields: TELEGRAM_FIELDS,
  },
  {
    id: "slack",
    group: "overseas",
    implemented: true,
    scanSupport: false,
    pasteSupport: true,
    connectionKey: "settings.remoteIm.conn.socketMode",
    nameKey: "settings.remoteIm.channel.slack",
    fields: SLACK_FIELDS,
  },
  {
    id: "discord",
    group: "overseas",
    implemented: true,
    scanSupport: false,
    pasteSupport: true,
    connectionKey: "settings.remoteIm.conn.gateway",
    nameKey: "settings.remoteIm.channel.discord",
    fields: DISCORD_FIELDS,
  },
  {
    id: "matrix",
    group: "overseas",
    implemented: true,
    scanSupport: false,
    pasteSupport: true,
    connectionKey: "settings.remoteIm.conn.longPoll",
    nameKey: "settings.remoteIm.channel.matrix",
    fields: MATRIX_FIELDS,
  },
  {
    id: "line",
    group: "overseas",
    implemented: true,
    scanSupport: false,
    pasteSupport: true,
    needsPublicUrl: true,
    connectionKey: "settings.remoteIm.conn.webhook",
    nameKey: "settings.remoteIm.channel.line",
    fields: LINE_FIELDS,
  },
  {
    id: "wps-agentspace",
    group: "other",
    implemented: false,
    retired: true,
    unsupported: true,
    scanSupport: false,
    pasteSupport: false,
    connectionKey: "settings.remoteIm.conn.websocket",
    nameKey: "settings.remoteIm.channel.wpsAgentspace",
    fields: WPS_AGENTSPACE_FIELDS,
  },
];

/**
 * Required channel ids for default sidebar completeness checks.
 * Soft-retired WPS channels are intentionally excluded.
 */
export const REQUIRED_CHANNEL_IDS: RemoteChannelId[] = [
  "feishu",
  "lark",
  "dingtalk",
  "wecom",
  "weixin",
  "weibo",
  "qq",
  "qqbot",
  "telegram",
  "slack",
  "discord",
  "matrix",
  "line",
];

export function getChannelSchema(
  id: RemoteChannelId | string,
): ChannelSchema | undefined {
  return CHANNEL_SCHEMAS.find((c) => c.id === id);
}

/**
 * Whether a channel is soft-retired / unsupported (hidden from default picker).
 * Accepts id string or schema object.
 */
export function isRetiredChannel(
  channel: RemoteChannelId | string | ChannelSchema | null | undefined,
): boolean {
  if (channel == null) return false;
  if (typeof channel === "object") {
    return !!(channel.retired || channel.unsupported);
  }
  if ((RETIRED_CHANNEL_IDS as readonly string[]).includes(channel)) {
    return true;
  }
  const schema = getChannelSchema(channel);
  return !!(schema?.retired || schema?.unsupported);
}

export type FilterActiveChannelsOpts = {
  /**
   * When true, keep retired schemas that still have a saved instance
   * (so users can open the soft-retired banner + delete credentials).
   */
  includeRetiredWithInstances?: boolean;
  /** Instance list used when includeRetiredWithInstances is set */
  instances?: Array<{ channel: string }>;
};

/**
 * Default sidebar / new-bind picker: active (non-retired) channels only.
 * Optionally re-includes retired channels that still have saved instances.
 */
export function filterActiveChannels(
  channels: readonly ChannelSchema[] = CHANNEL_SCHEMAS,
  opts?: FilterActiveChannelsOpts,
): ChannelSchema[] {
  const includeLegacy = !!opts?.includeRetiredWithInstances;
  const instances = opts?.instances ?? [];
  return channels.filter((schema) => {
    if (!isRetiredChannel(schema)) return true;
    if (!includeLegacy) return false;
    return instances.some((i) => i.channel === schema.id);
  });
}

export function channelsByGroup(
  group: ChannelSchema["group"],
): ChannelSchema[] {
  return CHANNEL_SCHEMAS.filter((c) => c.group === group);
}

export function isRemoteChannelId(v: string): v is RemoteChannelId {
  return CHANNEL_SCHEMAS.some((c) => c.id === v);
}

/** Default non-secret options from schema */
export function defaultOptionsFor(schema: ChannelSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of schema.fields) {
    if (f.secret) continue;
    if (f.defaultValue !== undefined) out[f.key] = f.defaultValue;
  }
  return out;
}

/** Visible fields given current option values */
export function visibleFields(
  schema: ChannelSchema,
  values: Record<string, unknown>,
  section?: ChannelSchema["fields"][0]["section"],
) {
  return schema.fields.filter((f) => {
    if (section && f.section !== section) return false;
    if (!f.when) return true;
    return values[f.when.key] === f.when.equals;
  });
}

/**
 * Whether to show the public-URL / tunnel Callout.
 * Spec §6.8 WeCom: Callout only for webhook mode (not WebSocket).
 * LINE / other `needsPublicUrl` channels: always when flagged.
 */
export function showsPublicUrlCallout(
  schema: ChannelSchema,
  values: Record<string, unknown>,
): boolean {
  if (!schema.needsPublicUrl) return false;
  if (schema.id === "wecom") {
    return values.connect_mode === "webhook";
  }
  return true;
}

/** Primary bind fields only (required credentials for connect). */
export function primaryBindFields(
  schema: ChannelSchema,
  values: Record<string, unknown>,
) {
  return visibleFields(schema, values, "bind").filter((f) => f.required || f.section === "bind");
}

/** Everything else goes under Advanced collapse. */
export function advancedPanelFields(
  schema: ChannelSchema,
  values: Record<string, unknown>,
) {
  const bindExtra = visibleFields(schema, values, "bind").filter(
    (f) => !f.required,
  );
  return [
    ...bindExtra,
    ...visibleFields(schema, values, "options"),
    ...visibleFields(schema, values, "advanced"),
  ];
}

/** Validate required bind fields (non-secret may be empty if hasCredentials) */
export function validateBindFields(
  schema: ChannelSchema,
  values: Record<string, unknown>,
  opts?: {
    hasCredentials?: boolean;
    secretKeysFilled?: Set<string>;
    /**
     * Last-saved options. When a secret field becomes visible only after a
     * mode change (e.g. WeCom websocket→webhook), vault reuse is denied
     * until the new secret keys are filled (honest soft-fail).
     */
    savedValues?: Record<string, unknown>;
  },
): { ok: boolean; missing: string[] } {
  if (isRetiredChannel(schema)) {
    return { ok: false, missing: ["_retired"] };
  }
  if (!schema.implemented) {
    return { ok: false, missing: ["_not_implemented"] };
  }
  const missing: string[] = [];
  for (const f of visibleFields(schema, values, "bind")) {
    if (!f.required) continue;
    const v = values[f.key];
    const empty =
      v === undefined ||
      v === null ||
      (typeof v === "string" && v.trim() === "");
    if (empty) {
      if (f.secret && opts?.secretKeysFilled?.has(f.key)) continue;
      if (
        f.secret &&
        opts?.hasCredentials &&
        !opts.secretKeysFilled?.has(f.key)
      ) {
        // Reuse vault only if this secret was already required under saved values
        if (opts.savedValues) {
          const wasVisible =
            !f.when || opts.savedValues[f.when.key] === f.when.equals;
          if (wasVisible) continue;
          // Mode switch → require re-entry
        } else {
          // Legacy callers without savedValues keep previous soft reuse
          continue;
        }
      }
      missing.push(f.key);
    }
  }
  return { ok: missing.length === 0, missing };
}

/** Parse `cli_xxx:secret` style paste into app_id + app_secret */
export function parseIdSecretPair(
  raw: string,
): { app_id: string; app_secret: string } | null {
  const s = raw.trim();
  const idx = s.indexOf(":");
  if (idx <= 0 || idx === s.length - 1) return null;
  const app_id = s.slice(0, idx).trim();
  const app_secret = s.slice(idx + 1).trim();
  if (!app_id || !app_secret) return null;
  return { app_id, app_secret };
}
