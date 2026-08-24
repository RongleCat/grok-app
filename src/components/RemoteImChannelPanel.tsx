/**
 * Per-channel bind form (schema-driven) + ACL + project scope + Doctor + danger.
 * All controls use app chrome — Select / ui-check / ext-switch / settings-seg.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createT, resolveLocale, type MessageKey } from "@/i18n";
import type {
  AclConfig,
  ChannelInstance,
  PresenterMode,
  ProjectScope,
  RemoteChannelId,
  TrustedProject,
} from "@/lib/remoteIm";
import {
  lineCloudflaredSnippet,
  applySaveInstance,
  advancedPanelFields,
  channelHasDeepHealth,
  classifyChannelHealth,
  credentialsRefFor,
  defaultAcl,
  getChannelSchema,
  isPresenterLocked,
  isDiscordBotTokenFormat,
  isMatrixAccessTokenFormat,
  isMatrixHomeserverUrl,
  isMatrixUserIdFormat,
  isRetiredChannel,
  isSecretControl,
  isSlackAppTokenFormat,
  isSlackBotTokenFormat,
  isTelegramBotTokenFormat,
  isTelegramProxyUrl,
  parseIdSecretPair,
  primaryBindFields,
  remoteImSecretsPut,
  resolvePresenterForChannel,
  secretFormValue,
  secretPlaceholderWhenStored,
  showsPublicUrlCallout,
  toggleSecretReveal,
  validateBindFields,
} from "@/lib/remoteIm";
import type { TestConnectionResult } from "@/lib/remoteIm/bridgeClient";
import {
  remoteImScanBegin,
  remoteImScanPoll,
  remoteImSaveInstance,
} from "@/lib/remoteIm/bridgeClient";
import {
  RimBadge,
  RimCheck,
  RimChoiceRow,
  RimSecretField,
  RimStatusDot,
  RimSwitch,
} from "@/components/remoteIm/RimControls";
import { IconAlertTriangle, IconDoctor, IconPlus } from "@/components/icons";
import { Select } from "@/components/Select";
import { SegmentedControl } from "@/components/ui/SegmentedControl";

export interface RemoteImChannelPanelProps {
  locale: string;
  channelId: RemoteChannelId;
  instance: ChannelInstance;
  instances: ChannelInstance[];
  trustedProjects: TrustedProject[];
  busy: string | null;
  /** Bridge running/listening — for health classification */
  bridgeRunning?: boolean;
  /** This instance appears in bridge.connectedChannels */
  bridgeLinked?: boolean;
  onSave: (inst: ChannelInstance) => void | Promise<void>;
  onTest: (
    channel: RemoteChannelId,
    instanceId: string,
    hasCredentials: boolean,
  ) => Promise<TestConnectionResult>;
  onRequestDelete: (instanceId: string) => void;
  onSelectInstance: (instanceId: string) => void;
  onAddInstance: () => void;
}

type BindTab = "scan" | "paste";

/**
 * Soft-fail bind shape for overseas channels before vault write.
 * Returns an i18n MessageKey, or null when format is OK / not applicable.
 * Empty secret fields are ignored (vault reuse path).
 */
function overseasBindFormatError(
  channelId: RemoteChannelId,
  secrets: Record<string, string>,
  values: Record<string, unknown>,
): MessageKey | null {
  const sec = (k: string) => (secrets[k] ?? "").trim();
  const opt = (k: string) => {
    const v = values[k];
    if (v == null) return "";
    return String(v).trim();
  };

  if (channelId === "telegram") {
    const token = sec("token") || sec("bot_token");
    if (token && !isTelegramBotTokenFormat(token)) {
      return "settings.remoteIm.telegram.err.tokenFormat";
    }
    const proxy = opt("proxy");
    if (proxy && !isTelegramProxyUrl(proxy)) {
      return "settings.remoteIm.telegram.err.proxy";
    }
    return null;
  }

  if (channelId === "slack") {
    const bot = sec("bot_token") || sec("token");
    const app = sec("app_token") || sec("app_level_token");
    if (bot && !isSlackBotTokenFormat(bot)) {
      return "settings.remoteIm.slack.err.botTokenFormat";
    }
    if (app && !isSlackAppTokenFormat(app)) {
      return "settings.remoteIm.slack.err.appTokenFormat";
    }
    return null;
  }

  if (channelId === "discord") {
    const token = sec("token") || sec("bot_token");
    if (token && !isDiscordBotTokenFormat(token)) {
      return "settings.remoteIm.discord.err.tokenFormat";
    }
    return null;
  }

  if (channelId === "matrix") {
    const hs = opt("homeserver");
    if (hs && !isMatrixHomeserverUrl(hs)) {
      return "settings.remoteIm.matrix.err.homeserver";
    }
    const tok = sec("access_token") || sec("token");
    if (tok && !isMatrixAccessTokenFormat(tok)) {
      return "settings.remoteIm.matrix.err.tokenFormat";
    }
    const uid = opt("user_id");
    if (uid && !isMatrixUserIdFormat(uid)) {
      return "settings.remoteIm.matrix.err.userId";
    }
    const proxy = opt("proxy");
    if (proxy) {
      // Reuse telegram proxy URL rules (http(s)/socks5(h))
      if (!isTelegramProxyUrl(proxy)) {
        return "settings.remoteIm.matrix.err.proxy";
      }
    }
    return null;
  }

  return null;
}

/** Coerce bind form `port` for LINE cloudflared helper (values is Record unknown). */
function lineWebhookPortArg(
  values: Record<string, unknown>,
  secrets: Record<string, string>,
): string | number | null {
  const raw = values.port ?? secrets.port;
  if (typeof raw === "string" || typeof raw === "number") return raw;
  return null;
}

export function RemoteImChannelPanel({
  locale,
  channelId,
  instance,
  instances,
  trustedProjects,
  busy,
  bridgeRunning = false,
  bridgeLinked = false,
  onSave,
  onTest,
  onRequestDelete,
  onSelectInstance,
  onAddInstance,
}: RemoteImChannelPanelProps) {
  const tr = useMemo(() => createT(resolveLocale(locale)), [locale]);
  const t = useCallback(
    (k: string, vars?: Record<string, string | number>) =>
      tr(k as MessageKey, vars),
    [tr],
  );

  const schema = getChannelSchema(channelId);
  const [bindTab, setBindTab] = useState<BindTab>("paste");
  const [values, setValues] = useState<Record<string, unknown>>(() => ({
    ...instance.options,
  }));
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [showSecret, setShowSecret] = useState<Record<string, boolean>>({});
  const [acl, setAcl] = useState<AclConfig>(instance.acl ?? defaultAcl());
  const [projectScopeMode, setProjectScopeMode] = useState<
    "all_trusted" | "whitelist"
  >(
    typeof instance.projectScope === "object" && instance.projectScope
      ? "whitelist"
      : "all_trusted",
  );
  const [whitelist, setWhitelist] = useState<string[]>(
    typeof instance.projectScope === "object"
      ? instance.projectScope.allow
      : [],
  );
  const [presenter, setPresenter] = useState<PresenterMode>(
    resolvePresenterForChannel(channelId, instance.presenter),
  );
  const [name, setName] = useState(instance.name);
  const [formError, setFormError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(
    null,
  );
  const [savedFlash, setSavedFlash] = useState(false);
  const [pairPaste, setPairPaste] = useState("");
  const [pairPasteRevealed, setPairPasteRevealed] = useState(false);
  const [doctorOpen, setDoctorOpen] = useState(false);
  const [scanPhase, setScanPhase] = useState<"idle" | "waiting" | "done">(
    "idle",
  );
  const [scanUri, setScanUri] = useState<string | null>(null);
  const [scanDeviceCode, setScanDeviceCode] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [doctorCopied, setDoctorCopied] = useState(false);

  useEffect(() => {
    setValues({ ...instance.options });
    setSecrets({});
    setAcl(instance.acl ?? defaultAcl());
    setProjectScopeMode(
      typeof instance.projectScope === "object" ? "whitelist" : "all_trusted",
    );
    setWhitelist(
      typeof instance.projectScope === "object"
        ? instance.projectScope.allow
        : [],
    );
    setPresenter(resolvePresenterForChannel(channelId, instance.presenter));
    setName(instance.name);
    setFormError(null);
    setTestResult(null);
    setBindTab("paste");
    setScanPhase("idle");
    setScanUri(null);
    setScanDeviceCode(null);
    setScanError(null);
    setAdvancedOpen(false);
    setShowSecret({});
    setPairPaste("");
    setPairPasteRevealed(false);
  }, [instance.id, instance, channelId]);

  /**
   * Save + connect. Optional overrides used by scan success (auto-save)
   * so we don't wait for React state to flush.
   */
  const performSave = useCallback(
    async (override?: {
      values?: Record<string, unknown>;
      secrets?: Record<string, string>;
      /** Keep secret fields visible in paste form after save (scan fill-back) */
      keepSecretsVisible?: boolean;
    }): Promise<boolean> => {
      const sch = getChannelSchema(channelId);
      if (!sch || isRetiredChannel(sch) || !sch.implemented) return false;

      setFormError(null);
      const nextValues = { ...values, ...override?.values };
      const nextSecrets = { ...secrets, ...override?.secrets };

      const merged: Record<string, unknown> = { ...nextValues };
      for (const [k, v] of Object.entries(nextSecrets)) {
        if (v) merged[k] = v;
      }
      const filled = new Set(
        Object.entries(nextSecrets)
          .filter(([, v]) => v.trim().length > 0)
          .map(([k]) => k),
      );
      const v = validateBindFields(sch, merged, {
        hasCredentials: instance.hasCredentials,
        secretKeysFilled: filled,
        // Mode switch (WeCom ws↔webhook) must re-enter newly required secrets
        savedValues: instance.options,
      });
      if (!v.ok) {
        setFormError(
          t("settings.remoteIm.err.missingFields", {
            fields: v.missing.join(", "),
          }),
        );
        return false;
      }

      // Overseas channels: soft-fail obvious paste/shape errors before vault write.
      // Never claims live transport — only format honesty for Save & connect.
      const formatErr = overseasBindFormatError(channelId, nextSecrets, nextValues);
      if (formatErr) {
        setFormError(t(formatErr));
        return false;
      }

      const scope: ProjectScope =
        projectScopeMode === "all_trusted"
          ? "all_trusted"
          : { allow: whitelist.filter(Boolean) };

      const options: Record<string, unknown> = {};
      for (const f of sch.fields) {
        if (f.secret) continue;
        if (merged[f.key] !== undefined) options[f.key] = merged[f.key];
      }

      const secretPayload: Record<string, string> = {};
      for (const f of sch.fields) {
        if (!f.secret) continue;
        const s = nextSecrets[f.key];
        if (s && s.trim()) secretPayload[f.key] = s.trim();
      }
      for (const [k, val] of Object.entries(nextSecrets)) {
        if (val.trim()) secretPayload[k] = val.trim();
      }

      const hasNewSecrets = Object.keys(secretPayload).length > 0;
      const hasCredentials = instance.hasCredentials || hasNewSecrets;
      if (!hasCredentials) {
        setFormError(t("settings.remoteIm.err.needSecrets"));
        return false;
      }

      const ref = credentialsRefFor(channelId, instance.id);
      if (hasNewSecrets) {
        await remoteImSecretsPut({
          credentialsRef: ref,
          channel: channelId,
          instanceId: instance.id,
          secrets: secretPayload,
        });
      }

      if (acl.allowFrom != null) {
        options.allow_from = acl.allowFrom;
      }

      // Fail-closed: empty allow list cannot enable (security default).
      const allowRaw = String(acl.allowFrom ?? "").trim();
      if (!allowRaw) {
        setFormError(t("settings.remoteIm.err.allowFromRequired"));
        return false;
      }

      // §3.2 / §6.1: group_reply_all is inverse of require @mention (ACL control).
      options.group_reply_all = !acl.requireMention;
      options.require_mention = acl.requireMention;

      const nextAcl: AclConfig = {
        ...acl,
        shareSessionInChannel:
          !!options.share_session_in_channel || acl.shareSessionInChannel,
      };

      // Weixin §6.9: force text-menu presenter even if UI state drifted to auto
      const presenterToSave = resolvePresenterForChannel(channelId, presenter);
      const saved = applySaveInstance({
        channel: channelId,
        instanceId: instance.id,
        name: name.trim() || "default",
        options,
        acl: nextAcl,
        projectScope: scope,
        presenter: presenterToSave,
        enabled: true,
        hasCredentials: true,
        existing: instance,
      });
      saved.status = "configured";

      const hostSaved = await remoteImSaveInstance({
        instance: saved,
        secrets: secretPayload,
        connectAfterSave: true,
      });
      await onSave(hostSaved ?? saved);

      // Sync local form to complete record; keep secrets visible after scan
      setValues((prev) => ({ ...prev, ...nextValues }));
      if (override?.keepSecretsVisible) {
        setSecrets(secretPayload);
      } else {
        setSecrets({});
      }
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 2000);
      return true;
    },
    [
      values,
      secrets,
      instance,
      projectScopeMode,
      whitelist,
      channelId,
      acl,
      name,
      presenter,
      onSave,
      t,
    ],
  );

  const performSaveRef = useRef(performSave);
  performSaveRef.current = performSave;

  // Poll Feishu/Lark registration → fill paste form → auto save & connect
  useEffect(() => {
    if (scanPhase !== "waiting" || !scanDeviceCode) return;
    let cancelled = false;
    const tick = async () => {
      const r = await remoteImScanPoll(channelId, scanDeviceCode);
      if (cancelled || !r) return;
      if (r.status === "completed" && r.appId && r.appSecret) {
        // Feishu: app_id + app_secret; Weixin ilink: account_id + token (secret)
        const isWeixin =
          channelId === "weixin" || r.platform === "weixin";
        const fillValues = isWeixin
          ? {
              account_id: r.appId,
              ...(r.ownerOpenId
                ? { allow_from: r.ownerOpenId }
                : {}),
            }
          : {
              app_id: r.appId,
              domain:
                r.platform === "lark"
                  ? "open.larksuite.com"
                  : "open.feishu.cn",
            };
        const fillSecrets: Record<string, string> = isWeixin
          ? { token: r.appSecret }
          : { app_secret: r.appSecret };
        setValues((prev) => ({ ...prev, ...fillValues }));
        setSecrets((prev) => ({ ...prev, ...fillSecrets }));
        setBindTab("paste");
        setScanPhase("done");
        setScanError(null);
        setScanDeviceCode(null);
        const ok = await performSaveRef.current({
          values: fillValues,
          secrets: fillSecrets,
          keepSecretsVisible: true,
        });
        if (!ok && !cancelled) {
          setFormError(t("settings.remoteIm.scan.autoSaveFailed"));
        }
        return;
      }
      if (r.status === "scanned" || r.status === "scaned") {
        return;
      }
      // Weixin (and any channel): server-side QR refresh → keep waiting with new URI/key
      if (
        (r.status === "wait" || r.status === "pending") &&
        (r.verificationUri || r.deviceCode)
      ) {
        if (r.verificationUri) setScanUri(r.verificationUri);
        if (r.deviceCode) setScanDeviceCode(r.deviceCode);
        return;
      }
      // Terminal expired only when not a server-side refresh
      if (r.status === "expired" && r.error === "qr_refreshed") {
        if (r.verificationUri) setScanUri(r.verificationUri);
        if (r.deviceCode) setScanDeviceCode(r.deviceCode);
        return;
      }
      if (
        r.status === "denied" ||
        r.status === "expired" ||
        r.status === "error"
      ) {
        setScanError(r.error || r.status);
        setScanPhase("idle");
      }
    };
    const id = window.setInterval(() => void tick(), 4000);
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [scanPhase, scanDeviceCode, channelId, t]);

  if (!schema) {
    return (
      <div className="rim-panel__empty">
        {t("settings.remoteIm.unknownChannel")}
      </div>
    );
  }

  // Soft-retired (WPS xiezuo / agentspace): honest banner, no setup pack, allow cleanup
  if (isRetiredChannel(schema) || schema.retired || schema.unsupported) {
    const hasLegacy =
      instance.hasCredentials ||
      instances.some((i) => i.channel === channelId);
    return (
      <div
        className="rim-retired"
        data-channel={channelId}
        data-retired="1"
      >
        <header className="rim-panel__header">
          <div>
            <h2 className="rim-panel__title">{t(schema.nameKey)}</h2>
            <p className="rim-panel__lead">{t(schema.connectionKey)}</p>
          </div>
          <RimBadge>{t("settings.remoteIm.retired")}</RimBadge>
        </header>
        <div
          className="rim-callout rim-callout--warn"
          role="status"
          data-rim-retired-banner="1"
        >
          <div className="rim-callout__title">
            {t("settings.remoteIm.retiredTitle")}
          </div>
          <p className="rim-callout__body" style={{ margin: "0.35rem 0 0" }}>
            {t("settings.remoteIm.retiredBody")}
          </p>
          <p className="settings-row__hint" style={{ margin: "0.35rem 0 0" }}>
            {t("settings.remoteIm.retiredHint")}
          </p>
        </div>
        {hasLegacy ? (
          <div className="settings-card">
            <div className="settings-row settings-row--stack">
              <div className="settings-row__label">
                {t("settings.remoteIm.instance")}
              </div>
              <div className="settings-row__desc">
                {name || instance.name || instance.id}
                {instance.hasCredentials
                  ? ` · ${t("settings.remoteIm.retired.hasCredentials")}`
                  : ""}
              </div>
            </div>
            <div className="settings-row settings-row--stack">
              <div className="settings-row__label">
                {t("settings.remoteIm.danger")}
              </div>
              <div className="settings-row__desc">
                {t("settings.remoteIm.danger.desc")}
              </div>
              <button
                type="button"
                className="btn btn--danger btn--sm"
                disabled={!!busy}
                onClick={() => onRequestDelete(instance.id)}
              >
                {t("settings.remoteIm.danger.delete")}
              </button>
            </div>
          </div>
        ) : (
          <div className="settings-card rim-disabled-form" aria-disabled>
            <p className="settings-page__lead" style={{ margin: 0 }}>
              {t("settings.remoteIm.retiredNoInstance")}
            </p>
            <div className="settings-row">
              <button type="button" className="btn btn--primary" disabled>
                {t("settings.remoteIm.saveConnect")}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (!schema.implemented) {
    return (
      <div className="rim-coming-soon" data-channel={channelId}>
        <header className="rim-panel__header">
          <div>
            <h2 className="rim-panel__title">{t(schema.nameKey)}</h2>
            <p className="rim-panel__lead">{t(schema.connectionKey)}</p>
          </div>
          <RimBadge>{t("settings.remoteIm.comingSoon")}</RimBadge>
        </header>
        <div className="rim-callout">
          <p>{t("settings.remoteIm.comingSoonBody")}</p>
          <p className="settings-row__hint">
            {t("settings.remoteIm.comingSoonHint")}
          </p>
        </div>
        <div className="settings-card rim-disabled-form" aria-disabled>
          {schema.fields
            .filter((f) => f.section === "bind")
            .slice(0, 3)
            .map((f) => (
              <div key={f.key} className="settings-row settings-row--stack">
                <div className="settings-row__label">{t(f.labelKey)}</div>
                <input className="settings-input" disabled />
              </div>
            ))}
          <div className="settings-row">
            <button type="button" className="btn btn--primary" disabled>
              {t("settings.remoteIm.saveConnect")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const setValue = (key: string, v: unknown) => {
    setValues((prev) => ({ ...prev, [key]: v }));
  };
  const setSecret = (key: string, v: string) => {
    setSecrets((prev) => ({ ...prev, [key]: v }));
  };

  const handlePairPaste = () => {
    const parsed = parseIdSecretPair(pairPaste);
    if (!parsed) {
      setFormError(t("settings.remoteIm.err.pairPaste"));
      return;
    }
    setValue("app_id", parsed.app_id);
    setSecret("app_secret", parsed.app_secret);
    setFormError(null);
  };

  const handleSave = async () => {
    await performSave();
  };

  const handleTest = async () => {
    setTestResult(null);
    const has =
      instance.hasCredentials ||
      Object.values(secrets).some((s) => s.trim().length > 0);
    const r = await onTest(channelId, instance.id, has);
    setTestResult(r);
  };

  const bindFields = primaryBindFields(schema, values);
  const advancedFields = advancedPanelFields(schema, values);

  const startRealScan = async () => {
    setScanError(null);
    setScanPhase("waiting");
    setScanUri(null);
    setScanDeviceCode(null);
    try {
      const scanOpts: Record<string, string> = {};
      if (channelId === "weixin") {
        if (typeof values.base_url === "string" && values.base_url.trim()) {
          scanOpts.base_url = values.base_url.trim();
        }
        if (typeof values.route_tag === "string" && values.route_tag.trim()) {
          scanOpts.route_tag = values.route_tag.trim();
        }
      }
      const begin = await remoteImScanBegin(
        channelId,
        Object.keys(scanOpts).length ? scanOpts : undefined,
      );
      if (!begin) {
        setScanError(t("settings.remoteIm.scan.needHost"));
        setScanPhase("idle");
        return;
      }
      setScanUri(begin.verificationUri);
      setScanDeviceCode(begin.deviceCode);
    } catch (e) {
      setScanError(String(e));
      setScanPhase("idle");
    }
  };

  const health = useMemo(() => {
    const filled = new Set(
      Object.entries(secrets)
        .filter(([, v]) => v.trim().length > 0)
        .map(([k]) => k),
    );
    return classifyChannelHealth({
      instance,
      bridgeRunning,
      bridgeLinked,
      secretKeysFilled: filled,
      // Live form options (e.g. WeCom connect_mode) for honest soft status
      draftOptions: values,
    });
  }, [instance, bridgeRunning, bridgeLinked, secrets, values, channelId]);

  const statusTone = health.badgeTone;
  const statusLabel = t(health.statusKey);

  const renderField = (f: (typeof schema.fields)[0]) => {
    const isSecret = isSecretControl({
      secret: f.secret,
      control: f.control,
    });
    const val = isSecret
      ? secretFormValue(f.key, secrets)
      : (values[f.key] ?? f.defaultValue ?? "");

    if (f.control === "toggle") {
      const on = !!val;
      return (
        <div key={f.key} className="settings-row">
          <div className="settings-row__text">
            <div className="settings-row__label">{t(f.labelKey)}</div>
            {f.helpKey ? (
              <div className="settings-row__desc">{t(f.helpKey)}</div>
            ) : null}
          </div>
          <RimSwitch
            checked={on}
            label={t(f.labelKey)}
            onChange={(next) => setValue(f.key, next)}
          />
        </div>
      );
    }

    if (f.control === "checkbox") {
      const on = !!val;
      return (
        <div key={f.key} className="settings-row">
          <div className="settings-row__text">
            <div className="settings-row__label">{t(f.labelKey)}</div>
            {f.helpKey ? (
              <div className="settings-row__desc">{t(f.helpKey)}</div>
            ) : null}
          </div>
          <RimCheck
            checked={on}
            ariaLabel={t(f.labelKey)}
            onChange={(next) => setValue(f.key, next)}
          />
        </div>
      );
    }

    if (f.control === "select" && f.choices) {
      return (
        <div key={f.key} className="settings-row settings-row--stack">
          <div className="settings-row__text">
            <div className="settings-row__label">{t(f.labelKey)}</div>
            {f.helpKey ? (
              <div className="settings-row__desc">{t(f.helpKey)}</div>
            ) : null}
          </div>
          <Select
            className="rim-select"
            value={String(val ?? f.defaultValue ?? "")}
            aria-label={t(f.labelKey)}
            onChange={(v) => setValue(f.key, v)}
            options={f.choices.map((c) => ({
              value: c.value,
              label: t(c.labelKey),
            }))}
          />
        </div>
      );
    }

    if (f.control === "radio" && f.choices) {
      return (
        <div key={f.key} className="settings-row settings-row--stack">
          <div className="settings-row__text">
            <div className="settings-row__label">{t(f.labelKey)}</div>
            {f.helpKey ? (
              <div className="settings-row__desc">{t(f.helpKey)}</div>
            ) : null}
          </div>
          <RimChoiceRow
            value={String(val ?? f.defaultValue ?? "")}
            onChange={(v) => setValue(f.key, v)}
            options={f.choices.map((c) => ({
              value: c.value,
              label: t(c.labelKey),
            }))}
          />
        </div>
      );
    }

    if (isSecret) {
      const formVal = secretFormValue(f.key, secrets);
      return (
        <div key={f.key} className="settings-row settings-row--stack">
          <div className="settings-row__text">
            <div className="settings-row__label">
              {t(f.labelKey)}
              {f.required ? (
                <span className="rim-required" aria-hidden>
                  *
                </span>
              ) : null}
            </div>
            {f.helpKey ? (
              <div className="settings-row__desc">{t(f.helpKey)}</div>
            ) : null}
          </div>
          <RimSecretField
            value={formVal}
            revealed={!!showSecret[f.key]}
            onToggleReveal={() =>
              setShowSecret((s) => toggleSecretReveal(s, f.key))
            }
            onChange={(next) => setSecret(f.key, next)}
            ariaLabel={t(f.labelKey)}
            showLabel={t("settings.remoteIm.showSecret")}
            hideLabel={t("settings.remoteIm.hideSecret")}
            placeholder={
              secretPlaceholderWhenStored(
                instance.hasCredentials,
                formVal,
                t("settings.remoteIm.secretPlaceholder"),
              ) ??
              (f.placeholderKey ? t(f.placeholderKey) : undefined)
            }
          />
        </div>
      );
    }

    return (
      <div key={f.key} className="settings-row settings-row--stack">
        <div className="settings-row__text">
          <div className="settings-row__label">
            {t(f.labelKey)}
            {f.required ? (
              <span className="rim-required" aria-hidden>
                *
              </span>
            ) : null}
          </div>
          {f.helpKey ? (
            <div className="settings-row__desc">{t(f.helpKey)}</div>
          ) : null}
        </div>
        <input
          className="settings-input"
          type={f.control === "number" ? "number" : "text"}
          autoComplete="off"
          spellCheck={false}
          placeholder={f.placeholderKey ? t(f.placeholderKey) : undefined}
          value={String(val ?? "")}
          onChange={(e) => {
            setValue(
              f.key,
              f.control === "number"
                ? Number(e.target.value)
                : e.target.value,
            );
          }}
        />
      </div>
    );
  };

  const instanceOptions = (instances.length ? instances : [instance]).map(
    (i) => ({
      value: i.id,
      label: i.name || i.id,
    }),
  );

  return (
    <div className="rim-channel" data-channel={channelId}>
      <header className="rim-panel__header">
        <div className="rim-panel__header-text">
          <h2 className="rim-panel__title">{t(schema.nameKey)}</h2>
          <p className="rim-panel__lead">{t(schema.connectionKey)}</p>
        </div>
        <RimBadge tone={statusTone}>
          <span className="rim-badge__inner">
            <RimStatusDot tone={health.tone} />
            {statusLabel}
          </span>
        </RimBadge>
      </header>

      {channelHasDeepHealth(channelId) ? (
        <div
          className={
            "rim-health" +
            (health.badgeTone === "err"
              ? " rim-health--err"
              : health.badgeTone === "ok"
                ? " rim-health--ok"
                : health.badgeTone === "warn"
                  ? " rim-health--warn"
                  : "")
          }
          data-rim-health={channelId}
        >
          <div className="rim-health__head">
            <span className="rim-health__title">
              {t("settings.remoteIm.health.title")}
            </span>
            <span className="rim-health__transport">
              {t(health.transportKey)}
              {health.modeLabel ? (
                <span className="rim-health__mode"> · {health.modeLabel}</span>
              ) : null}
            </span>
          </div>
          <ul className="rim-health__facts">
            <li>
              <span className="rim-health__k">
                {t("settings.remoteIm.health.credentials")}
              </span>
              <span className="rim-health__v">
                {health.hasCredentials
                  ? t("settings.remoteIm.health.credentialsSaved")
                  : t("settings.remoteIm.health.credentialsMissing")}
              </span>
            </li>
            <li>
              <span className="rim-health__k">
                {t("settings.remoteIm.health.bridge")}
              </span>
              <span className="rim-health__v">
                {!bridgeRunning
                  ? t("settings.remoteIm.health.bridgeStopped")
                  : health.bridgeLinked
                    ? t("settings.remoteIm.health.bridgeLinked")
                    : t("settings.remoteIm.health.bridgeNotLinked")}
              </span>
            </li>
            {health.openAcl && health.hasCredentials ? (
              <li>
                <span className="rim-health__k">
                  {t("settings.remoteIm.health.acl")}
                </span>
                <span className="rim-health__v rim-health__v--warn">
                  {t("settings.remoteIm.health.aclOpen")}
                </span>
              </li>
            ) : null}
          </ul>
          {health.lastError ? (
            <div className="rim-health__error" role="status">
              <code>{health.lastError}</code>
            </div>
          ) : null}
          {health.hintKeys.length > 0 ? (
            <ul className="rim-health__hints">
              {health.hintKeys.map((k) => (
                <li key={k}>{t(k)}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="settings-card rim-instance-card">
        <div className="settings-row settings-row--stack">
          <div className="settings-row__label">
            {t("settings.remoteIm.instance")}
          </div>
          <div className="rim-instance-bar">
            <Select
              className="rim-select"
              value={instance.id}
              aria-label={t("settings.remoteIm.instance")}
              options={instanceOptions}
              onChange={onSelectInstance}
            />
            <input
              className="settings-input rim-instance-bar__name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("settings.remoteIm.instanceName")}
            />
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={onAddInstance}
            >
              <IconPlus size={14} />
              {t("settings.remoteIm.addInstance")}
            </button>
          </div>
        </div>
      </div>

      {/* Bind */}
      <h3 className="settings-page__h2">{t("settings.remoteIm.bind")}</h3>
      {channelId === "wecom" ? (
        <div className="rim-callout" data-wecom-guide="1">
          <div className="rim-callout__title">
            {t("settings.remoteIm.wecom.guide.title")}
          </div>
          <ol className="rim-guide-steps">
            <li>{t("settings.remoteIm.wecom.guide.step1")}</li>
            <li>{t("settings.remoteIm.wecom.guide.step2")}</li>
            <li>{t("settings.remoteIm.wecom.guide.step3")}</li>
          </ol>
          <p className="settings-row__hint">
            {t("settings.remoteIm.wecom.guide.softFail")}
          </p>
        </div>
      ) : null}
{channelId === "dingtalk" ? (
        <div className="rim-callout" data-dingtalk-guide="1">
          <div className="rim-callout__title">
            {t("settings.remoteIm.dingtalk.guide.title")}
          </div>
          <ol className="rim-guide-steps">
            <li>{t("settings.remoteIm.dingtalk.guide.step1")}</li>
            <li>{t("settings.remoteIm.dingtalk.guide.step2")}</li>
            <li>{t("settings.remoteIm.dingtalk.guide.step3")}</li>
            <li>{t("settings.remoteIm.dingtalk.guide.step4")}</li>
          </ol>
          <p className="settings-row__hint">
            {t("settings.remoteIm.dingtalk.guide.softFail")}
          </p>
        </div>
      ) : null}
      {channelId === "weixin" ? (
        <div className="rim-callout" data-weixin-guide="1">
          <div className="rim-callout__title">
            {t("settings.remoteIm.weixin.guide.title")}
          </div>
          <ol className="rim-guide-steps">
            <li>{t("settings.remoteIm.weixin.guide.step1")}</li>
            <li>{t("settings.remoteIm.weixin.guide.step2")}</li>
            <li>{t("settings.remoteIm.weixin.guide.step3")}</li>
            <li>{t("settings.remoteIm.weixin.guide.step4")}</li>
          </ol>
          <p className="settings-row__hint">
            {t("settings.remoteIm.weixin.guide.softFail")}
          </p>
        </div>
      ) : null}
{channelId === "telegram" ? (
        <div className="rim-callout" data-telegram-guide="1">
          <div className="rim-callout__title">
            {t("settings.remoteIm.telegram.guide.title")}
          </div>
          <ol className="rim-guide-steps">
            <li>{t("settings.remoteIm.telegram.guide.step1")}</li>
            <li>{t("settings.remoteIm.telegram.guide.step2")}</li>
            <li>{t("settings.remoteIm.telegram.guide.step3")}</li>
          </ol>
          <p className="settings-row__hint">
            {t("settings.remoteIm.telegram.guide.softFail")}
          </p>
        </div>
      ) : null}
{channelId === "lark" ? (
        <div className="rim-callout" data-feishu-guide="1" data-validate="validateFeishuConfig">
          <div className="rim-callout__title">
            {t("settings.remoteIm.feishu.guide.title")}
          </div>
          <ol className="rim-guide-steps">
            <li>{t("settings.remoteIm.feishu.guide.step1")}</li>
            <li>{t("settings.remoteIm.feishu.guide.step2")}</li>
            <li>{t("settings.remoteIm.feishu.guide.step3")}</li>
            <li>{t("settings.remoteIm.feishu.guide.step4")}</li>
          </ol>
          <p className="settings-row__hint">
            {t("settings.remoteIm.feishu.guide.softFail")}
          </p>
        </div>
      ) : null}
      <div className="settings-card">
        {schema.scanSupport ? (
          <div className="settings-row settings-row--stack">
            <SegmentedControl
              value={bindTab}
              role="tablist"
              large
              ariaLabel={t("settings.remoteIm.bind")}
              onChange={(v) => setBindTab(v as BindTab)}
              options={[
                {
                  value: "scan",
                  label: t("settings.remoteIm.bind.scan"),
                },
                {
                  value: "paste",
                  label: t("settings.remoteIm.bind.paste"),
                },
              ]}
            />
          </div>
        ) : null}

        {schema.scanSupport && bindTab === "scan" ? (
          <div className="settings-row settings-row--stack">
            <div
              className={
                "rim-scan__box" +
                (scanPhase === "done" ? " is-done" : "") +
                (scanPhase === "waiting" ? " is-waiting" : "")
              }
            >
              {scanUri ? (
                <>
                  <img
                    className="rim-scan__qr"
                    alt="QR"
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(scanUri)}`}
                  />
                  <span className="rim-scan__uri">{scanUri}</span>
                </>
              ) : (
                <span>
                  {scanPhase === "done"
                    ? t("settings.remoteIm.scan.done")
                    : t(
                        channelId === "weixin"
                          ? "settings.remoteIm.weixin.scan.placeholder"
                          : "settings.remoteIm.scan.placeholder",
                      )}
                </span>
              )}
            </div>
            <div className="settings-row__hint">
              {t(
                channelId === "weixin"
                  ? "settings.remoteIm.weixin.scan.hint"
                  : "settings.remoteIm.scan.hint",
              )}
            </div>
            {scanError ? (
              <div className="rim-callout rim-callout--error">{scanError}</div>
            ) : null}
            <div className="rim-btn-row">
              <button
                type="button"
                className="btn btn--primary"
                disabled={scanPhase === "waiting" && !!scanDeviceCode}
                onClick={() => void startRealScan()}
              >
                {t("settings.remoteIm.scan.start")}
              </button>
              {scanUri ? (
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => {
                    void import("@tauri-apps/api/core")
                      .then(({ invoke }) =>
                        invoke("open_external_url", { url: scanUri }),
                      )
                      .catch(() => {
                        window.open(scanUri, "_blank");
                      });
                  }}
                >
                  {t("settings.remoteIm.scan.openLink")}
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <>
            {(channelId === "feishu" || channelId === "lark") && (
              <div className="settings-row settings-row--stack">
                <div className="settings-row__text">
                  <div className="settings-row__label">
                    {t("settings.remoteIm.pairPaste")}
                  </div>
                  <div className="settings-row__desc">
                    {t("settings.remoteIm.pairPasteDesc")}
                  </div>
                </div>
                <div className="rim-pair-paste">
                  <RimSecretField
                    value={pairPaste}
                    revealed={pairPasteRevealed}
                    onToggleReveal={() =>
                      setPairPasteRevealed((v) => !v)
                    }
                    onChange={setPairPaste}
                    ariaLabel={t("settings.remoteIm.pairPaste")}
                    showLabel={t("settings.remoteIm.showSecret")}
                    hideLabel={t("settings.remoteIm.hideSecret")}
                    placeholder={t("settings.remoteIm.pairPastePlaceholder")}
                  />
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={handlePairPaste}
                  >
                    {t("settings.remoteIm.pairPasteApply")}
                  </button>
                </div>
              </div>
            )}
            {bindFields.map(renderField)}
          </>
        )}

        {showsPublicUrlCallout(schema, values) ? (
          <div
            className="rim-callout rim-callout--warn"
            data-public-url-callout="1"
          >
            <div className="rim-callout__title">
              <IconAlertTriangle size={14} />
              {t("settings.remoteIm.publicUrl.title")}
            </div>
            <p>{t("settings.remoteIm.publicUrl.body")}</p>
            <code className="rim-callout__code">
              {`cloudflared tunnel --url http://127.0.0.1:${
                String(values.port ?? secrets.port ?? "").trim() || "8081"
              }`}
            </code>
          </div>
        ) : null}

        {channelId === "discord" ? (
          <div className="rim-callout">
            <p>{t("settings.remoteIm.discord.intentHint")}</p>
          </div>
        ) : null}

        {channelId === "qq" ? (
          <div className="rim-callout rim-callout--warn">
            <p>{t("settings.remoteIm.qq.riskHint")}</p>
          </div>
        ) : null}
      </div>

      {/* Minimal ACL on main path */}
      <div className="settings-card">
        <div className="settings-row settings-row--stack">
          <div className="settings-row__text">
            <div className="settings-row__label">
              {t("settings.remoteIm.field.allowFrom")}
            </div>
            <div className="settings-row__desc">
              {t("settings.remoteIm.field.allowFromHelp")}
            </div>
          </div>
          <input
            className="settings-input"
            value={acl.allowFrom}
            onChange={(e) => setAcl({ ...acl, allowFrom: e.target.value })}
          />
        </div>
      </div>

      {/* Advanced: extra options, ACL detail, project scope, presenter */}
      <div className="settings-card rim-collapse">
        <button
          type="button"
          className="rim-collapse__head"
          onClick={() => setAdvancedOpen((o) => !o)}
          aria-expanded={advancedOpen}
        >
          <span>{t("settings.remoteIm.advanced")}</span>
          <span aria-hidden>{advancedOpen ? "▾" : "▸"}</span>
        </button>
        {advancedOpen ? (
          <div className="rim-collapse__body">
            {advancedFields.map(renderField)}
            <div className="settings-row settings-row--stack">
              <div className="settings-row__label">
                {t("settings.remoteIm.field.allowChat")}
              </div>
              <input
                className="settings-input"
                value={acl.allowChat ?? ""}
                onChange={(e) => setAcl({ ...acl, allowChat: e.target.value })}
              />
            </div>
            <div className="settings-row">
              <div className="settings-row__label">
                {t("settings.remoteIm.field.requireMention")}
              </div>
              <RimCheck
                checked={acl.requireMention}
                ariaLabel={t("settings.remoteIm.field.requireMention")}
                onChange={(next) => setAcl({ ...acl, requireMention: next })}
              />
            </div>
            <div className="settings-row">
              <div className="settings-row__label">
                {t("settings.remoteIm.field.groupOnly")}
              </div>
              <RimCheck
                checked={acl.groupOnly}
                ariaLabel={t("settings.remoteIm.field.groupOnly")}
                onChange={(next) => setAcl({ ...acl, groupOnly: next })}
              />
            </div>
            <div className="settings-row settings-row--stack">
              <div className="settings-row__label">
                {t("settings.remoteIm.field.adminFrom")}
              </div>
              <input
                className="settings-input"
                value={acl.adminFrom ?? ""}
                onChange={(e) => setAcl({ ...acl, adminFrom: e.target.value })}
              />
            </div>
            <div className="settings-row">
              <div className="settings-row__label">
                {t("settings.remoteIm.field.shareSession")}
              </div>
              <RimCheck
                checked={acl.shareSessionInChannel}
                ariaLabel={t("settings.remoteIm.field.shareSession")}
                onChange={(next) =>
                  setAcl({ ...acl, shareSessionInChannel: next })
                }
              />
            </div>
            <div className="settings-row settings-row--stack">
              <div className="settings-row__label">
                {t("settings.remoteIm.projectScope")}
              </div>
              <div className="settings-row__desc">
                {t("settings.remoteIm.projectScopeDesc")}
              </div>
              <RimChoiceRow
                value={projectScopeMode}
                onChange={(v) => {
                  setProjectScopeMode(v as "all_trusted" | "whitelist");
                }}
                options={[
                  {
                    value: "all_trusted",
                    label: t("settings.remoteIm.scope.allTrusted"),
                  },
                  {
                    value: "whitelist",
                    label: t("settings.remoteIm.scope.whitelist"),
                  },
                ]}
              />
              {projectScopeMode === "whitelist" ? (
                trustedProjects.length === 0 ? (
                  <p className="settings-row__hint">
                    {t("settings.remoteIm.scope.noProjects")}
                  </p>
                ) : (
                  <div className="rim-chips">
                    {trustedProjects.map((p) => {
                      const on = whitelist.includes(p.id);
                      return (
                        <button
                          key={p.id}
                          type="button"
                          className={"rim-chip" + (on ? " is-on" : "")}
                          onClick={() => {
                            setWhitelist((prev) =>
                              on
                                ? prev.filter((x) => x !== p.id)
                                : [...prev, p.id],
                            );
                          }}
                        >
                          {p.name}
                        </button>
                      );
                    })}
                  </div>
                )
              ) : null}
            </div>
            <div className="settings-row settings-row--stack">
              <div className="settings-row__label">
                {t("settings.remoteIm.field.presenter")}
              </div>
              {isPresenterLocked(channelId) ? (
                <div
                  className="settings-row__desc"
                  data-weixin-presenter-locked="1"
                >
                  {t("settings.remoteIm.weixin.presenterHint")}
                </div>
              ) : null}
          {channelId === "qqbot" ? (
          <div
            className="rim-callout"
            data-qqbot-intents="1"
          >
            <div className="rim-callout__title">
              {t("settings.remoteIm.qqbot.intentsTitle")}
            </div>
            <p>{t("settings.remoteIm.qqbot.intentsHint")}</p>
          </div>
        ) : null}
          {channelId === "qqbot" ? (
        <div className="rim-callout" data-qqbot-guide="1">
          <div className="rim-callout__title">
            {t("settings.remoteIm.qqbot.guide.title")}
          </div>
          <ol className="rim-guide-steps">
            <li>{t("settings.remoteIm.qqbot.guide.step1")}</li>
            <li>{t("settings.remoteIm.qqbot.guide.step2")}</li>
            <li>{t("settings.remoteIm.qqbot.guide.step3")}</li>
            <li>{t("settings.remoteIm.qqbot.guide.step4")}</li>
          </ol>
          <p className="settings-row__hint">
            {t("settings.remoteIm.qqbot.guide.softFail")}
          </p>
        </div>
      ) : null}
          {channelId === "weibo" ? (
        <div
          className="rim-callout"
          data-weibo-guide="1"
          data-validate="validateWeiboConfig"
        >
          <div className="rim-callout__title">
            {t("settings.remoteIm.weibo.guide.title")}
          </div>
          <ol className="rim-guide-steps">
            <li>{t("settings.remoteIm.weibo.guide.step1")}</li>
            <li>{t("settings.remoteIm.weibo.guide.step2")}</li>
            <li>{t("settings.remoteIm.weibo.guide.step3")}</li>
            <li>{t("settings.remoteIm.weibo.guide.step4")}</li>
          </ol>
          <p className="settings-row__hint">
            {t("settings.remoteIm.weibo.guide.softFail")}
          </p>
        </div>
      ) : null}
          {channelId === "matrix" ? (
        <div className="rim-callout" data-matrix-guide="1">
          <div className="rim-callout__title">
            {t("settings.remoteIm.matrix.guide.title")}
          </div>
          <ol className="rim-guide-steps">
            <li>{t("settings.remoteIm.matrix.guide.step1")}</li>
            <li>{t("settings.remoteIm.matrix.guide.step2")}</li>
            <li>{t("settings.remoteIm.matrix.guide.step3")}</li>
            <li>{t("settings.remoteIm.matrix.guide.step4")}</li>
          </ol>
          <p className="settings-row__hint">
            {t("settings.remoteIm.matrix.guide.softFail")}
          </p>
        </div>
      ) : null}
          {channelId === "qq" ? (
          <div
            className="rim-callout rim-callout--warn"
            data-qq-risk="1"
          >
            <div className="rim-callout__title">
              <IconAlertTriangle size={14} />
              {t("settings.remoteIm.qq.riskTitle")}
            </div>
            <p>{t("settings.remoteIm.qq.riskHint")}</p>
          </div>
        ) : null}
          {channelId === "qq" ? (
        <div className="rim-callout" data-qq-guide="1">
          <div className="rim-callout__title">
            {t("settings.remoteIm.qq.guide.title")}
          </div>
          <ol className="rim-guide-steps">
            <li>{t("settings.remoteIm.qq.guide.step1")}</li>
            <li>{t("settings.remoteIm.qq.guide.step2")}</li>
            <li>{t("settings.remoteIm.qq.guide.step3")}</li>
            <li>{t("settings.remoteIm.qq.guide.step4")}</li>
          </ol>
          <p className="settings-row__hint">
            {t("settings.remoteIm.qq.guide.softFail")}
          </p>
        </div>
      ) : null}
          {channelId === "slack" ? (
        <div className="rim-callout" data-slack-guide="1">
          <div className="rim-callout__title">
            {t("settings.remoteIm.slack.guide.title")}
          </div>
          <ol className="rim-guide-steps">
            <li>{t("settings.remoteIm.slack.guide.step1")}</li>
            <li>{t("settings.remoteIm.slack.guide.step2")}</li>
            <li>{t("settings.remoteIm.slack.guide.step3")}</li>
            <li>{t("settings.remoteIm.slack.guide.step4")}</li>
            <li>{t("settings.remoteIm.slack.guide.step5")}</li>
          </ol>
          <p className="settings-row__hint">
            {t("settings.remoteIm.slack.guide.softFail")}
          </p>
        </div>
      ) : null}
          {channelId === "line" ? (
              <p className="settings-row__hint">
                {t("settings.remoteIm.line.publicUrl.helper")}
              </p>
            ) : null}
          {channelId === "line" ? (
              <div className="rim-btn-row" style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => {
                    const snippet = lineCloudflaredSnippet(
                      lineWebhookPortArg(values, secrets),
                    );
                    void navigator.clipboard?.writeText(snippet).catch(() => {
                      /* clipboard optional — snippet still visible */
                    });
                  }}
                >
                  {t("settings.remoteIm.line.publicUrl.copy")}
                </button>
              </div>
            ) : null}
          {channelId === "line"
                ? lineCloudflaredSnippet(lineWebhookPortArg(values, secrets))
                : `cloudflared tunnel --url http://127.0.0.1:${
                    String(values.port ?? secrets.port ?? "").trim() || "8081"
                  }`}
          {channelId === "line" ? (
        <div className="rim-callout" data-line-guide="1">
          <div className="rim-callout__title">
            {t("settings.remoteIm.line.guide.title")}
          </div>
          <ol className="rim-guide-steps">
            <li>{t("settings.remoteIm.line.guide.step1")}</li>
            <li>{t("settings.remoteIm.line.guide.step2")}</li>
            <li>{t("settings.remoteIm.line.guide.step3")}</li>
            <li>{t("settings.remoteIm.line.guide.step4")}</li>
          </ol>
          <p className="settings-row__hint">
            {t("settings.remoteIm.line.guide.softFail")}
          </p>
        </div>
      ) : null}
          {channelId === "discord" ? (
          <div
            className="rim-callout rim-callout--warn"
            data-discord-intent="1"
          >
            <div className="rim-callout__title">
              <IconAlertTriangle size={14} />
              {t("settings.remoteIm.discord.intentTitle")}
            </div>
            <p>{t("settings.remoteIm.discord.intentHint")}</p>
          </div>
        ) : null}
          {channelId === "discord" ? (
        <div className="rim-callout" data-discord-guide="1">
          <div className="rim-callout__title">
            {t("settings.remoteIm.discord.guide.title")}
          </div>
          <ol className="rim-guide-steps">
            <li>{t("settings.remoteIm.discord.guide.step1")}</li>
            <li>{t("settings.remoteIm.discord.guide.step2")}</li>
            <li>{t("settings.remoteIm.discord.guide.step3")}</li>
            <li>{t("settings.remoteIm.discord.guide.step4")}</li>
          </ol>
          <p className="settings-row__hint">
            {t("settings.remoteIm.discord.guide.softFail")}
          </p>
        </div>
      ) : null}
              <Select
                className="rim-select"
                value={
                  isPresenterLocked(channelId) ? "text_only" : presenter
                }
                aria-label={t("settings.remoteIm.field.presenter")}
                onChange={(v) => {
                  if (isPresenterLocked(channelId)) {
                    setPresenter("text_only");
                    return;
                  }
                  setPresenter(v as PresenterMode);
                }}
                options={
                  isPresenterLocked(channelId)
                    ? [
                        {
                          value: "text_only",
                          label: t("settings.remoteIm.presenter.textOnly"),
                        },
                      ]
                    : [
                        {
                          value: "auto",
                          label: t("settings.remoteIm.presenter.auto"),
                        },
                        {
                          value: "text_only",
                          label: t("settings.remoteIm.presenter.textOnly"),
                        },
                      ]
                }
              />
            </div>
          </div>
        ) : null}
      </div>

      <h3 className="settings-page__h2">{t("settings.remoteIm.doctor")}</h3>
      <div className="settings-card">
        <div className="settings-row">
          <div className="settings-row__text">
            <div className="settings-row__label">
              <IconDoctor size={16} />
              {t("settings.remoteIm.doctor")}
            </div>
            <div className="settings-row__desc">
              {t("settings.remoteIm.doctor.hint")}
            </div>
          </div>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setDoctorOpen((o) => !o)}
          >
            {doctorOpen ? "▾" : "▸"}
          </button>
        </div>
        {doctorOpen ? (
          <div className="settings-row settings-row--stack rim-doctor">
            <ul className="rim-help-list">
              <li>
                channel: <code>{channelId}</code>
              </li>
              <li>
                instance: <code>{instance.id}</code>
              </li>
              <li>
                hasCredentials:{" "}
                <code>{instance.hasCredentials ? "yes" : "no"}</code>
              </li>
              <li>
                status: <code>{instance.status}</code>
              </li>
            </ul>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => {
                const cmd = `grok-app remote-im doctor --channel ${channelId}`;
                void navigator.clipboard?.writeText(cmd).then(() => {
                  setDoctorCopied(true);
                  window.setTimeout(() => setDoctorCopied(false), 1200);
                });
              }}
            >
              {doctorCopied
                ? t("message.copied")
                : t("settings.remoteIm.doctor.copyCmd")}
            </button>
          </div>
        ) : null}
      </div>

      {formError ? (
        <div className="rim-callout rim-callout--error" role="alert">
          {formError}
        </div>
      ) : null}
      {testResult ? (
        <div
          className={
            "rim-callout" + (testResult.ok ? "" : " rim-callout--error")
          }
        >
          {testResult.ok
            ? t("settings.remoteIm.test.ok")
            : t("settings.remoteIm.test.fail", {
                error: testResult.message,
              })}
        </div>
      ) : null}
      {savedFlash ? (
        <div className="rim-callout rim-callout--ok">
          {t("settings.remoteIm.saved")}
        </div>
      ) : null}

      <div className="rim-actions">
        <button
          type="button"
          className="btn btn--ghost"
          disabled={!!busy}
          onClick={() => void handleTest()}
        >
          {t("settings.remoteIm.testConnection")}
        </button>
        <button
          type="button"
          className="btn btn--primary"
          disabled={!!busy}
          onClick={() => void handleSave()}
        >
          {t("settings.remoteIm.saveConnect")}
        </button>
      </div>

      <h3 className="settings-page__h2">{t("settings.remoteIm.danger")}</h3>
      <div className="settings-card rim-danger">
        <div className="settings-row">
          <div className="settings-row__text">
            <div className="settings-row__label">
              {t("settings.remoteIm.danger.delete")}
            </div>
            <div className="settings-row__desc">
              {t("settings.remoteIm.danger.desc")}
            </div>
          </div>
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => onRequestDelete(instance.id)}
          >
            {t("settings.remoteIm.danger.delete")}
          </button>
        </div>
      </div>
    </div>
  );
}
