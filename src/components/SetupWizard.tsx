/**
 * Full-screen first-run gate: install Grok Build (required) → account (skippable) → enter home.
 * No page scrollbars; content is centered and compact.
 *
 * Honesty (SETUP-GATE-PRO): CLI is hard-required; account is soft/skippable.
 * Errors are classified via pure `setupGatePro` helpers — never invent success.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { GrokLogo } from "@/components/GrokLogo";
import { Select } from "@/components/Select";
import { Spinner } from "@/components/ui/spinner";
import {
  tauriDragRegion,
  titlebarMaximizeHandlers,
} from "@/components/WindowControls";
import * as api from "@/lib/api";
import type { createT } from "@/i18n";
import type { MessageKey } from "@/i18n";
import {
  buildAuthDeferredFlags,
  buildReadyChecklist,
  canAdvancePastRuntime,
  canEnterHome,
  clampInstallPercent,
  mirrorHostFromUrl,
  resolveInitialWizardStep,
  resolveSetupGateError,
  type SetupGateErrorView,
  type SetupWizardStep,
} from "@/lib/setupGatePro";
import {
  cliTrustChipClass,
  gradeFromSetupErrorKind,
  resolveChecksumTrustGrade,
  resolveCliTrustBanner,
  type ChecksumTrustGrade,
} from "@/lib/cliTrustSupplyChain";

type Tr = ReturnType<typeof createT>;

export type SetupCliInfo = {
  found: boolean;
  path: string | null;
  version: string | null;
  source: string;
  cliAuthPresent: boolean;
};

type Step = SetupWizardStep;
type AccountPanel = "menu" | "key" | "relay";

type Props = {
  tr: Tr;
  platform: "mac" | "win" | "linux" | "other";
  useCustomWindowChrome: boolean;
  initialCli: SetupCliInfo;
  onComplete: (cli: SetupCliInfo) => void;
  onAccountLoginOauth: () => Promise<boolean>;
};

export function SetupWizard({
  tr,
  platform,
  useCustomWindowChrome,
  initialCli,
  onComplete,
  onAccountLoginOauth,
}: Props) {
  const [step, setStep] = useState<Step>(() =>
    resolveInitialWizardStep(initialCli.found),
  );
  const [cli, setCli] = useState<SetupCliInfo>(initialCli);
  const [probing, setProbing] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<api.CliInstallProgress | null>(null);
  const [errorView, setErrorView] = useState<SetupGateErrorView | null>(null);
  /** Trust grade from last install attempt or classified checksum error. */
  const [trustGrade, setTrustGrade] = useState<ChecksumTrustGrade | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [installCmds, setInstallCmds] = useState<api.CliInstallCommands | null>(
    null,
  );
  const [copied, setCopied] = useState(false);
  const [accountPanel, setAccountPanel] = useState<AccountPanel>("menu");
  const [accountBusy, setAccountBusy] = useState(false);
  const [authOk, setAuthOk] = useState(
    () => initialCli.cliAuthPresent,
  );
  const [authDeferred, setAuthDeferred] = useState(false);
  const [officialKey, setOfficialKey] = useState("");
  const [relayBase, setRelayBase] = useState("");
  const [relayKey, setRelayKey] = useState("");
  /** Default: OpenAI Responses — preferred for modern gateways. */
  const [relayBackend, setRelayBackend] = useState("responses");

  const reportError = useCallback((err: unknown) => {
    const view = resolveSetupGateError(err);
    if (view.silent) {
      setErrorView(null);
      return view;
    }
    setErrorView(view);
    const g = gradeFromSetupErrorKind(view.kind);
    if (g) setTrustGrade(g);
    return view;
  }, []);

  const clearError = useCallback(() => {
    setErrorView(null);
  }, []);

  const protocolOptions = useMemo(
    () => [
      { value: "responses", label: tr("prov.protocol.responses") },
      {
        value: "chat_completions",
        label: tr("prov.protocol.chatCompletions"),
      },
      { value: "messages", label: tr("prov.protocol.messages") },
    ],
    [tr],
  );

  useEffect(() => {
    void api.cliInstallCommands().then(setInstallCmds).catch(() => null);
  }, []);

  // Live install progress from Host
  useEffect(() => {
    if (!api.isTauri()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen<api.CliInstallProgress>(
          "setup://cli-install-progress",
          (ev) => {
            if (!cancelled) setProgress(ev.payload);
          },
        );
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const recheck = useCallback(async (manualPath?: string | null) => {
    setProbing(true);
    clearError();
    try {
      const r = await api.probeCli(manualPath || undefined);
      const next: SetupCliInfo = {
        found: r.found,
        path: r.path,
        version: r.version,
        source: r.source || "",
        cliAuthPresent: !!r.cliAuthPresent,
      };
      setCli(next);
      if (next.cliAuthPresent) setAuthOk(true);
      if (next.found) {
        setStatusMsg(null);
      }
      return next;
    } catch (e) {
      reportError(e);
      return null;
    } finally {
      setProbing(false);
    }
  }, [clearError, reportError]);

  // Soft auto-detect once when opening runtime step without CLI
  useEffect(() => {
    if (step !== "runtime" || cli.found) return;
    void recheck();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const runInstall = useCallback(
    async (opts?: { allowUnverified?: boolean }) => {
      if (installing) return;
      setInstalling(true);
      clearError();
      setProgress({
        phase: "resolving",
        message: tr("setup.detecting"),
        percent: 0,
      });
      try {
        const res = await api.cliInstallLatest(
          opts?.allowUnverified ? { allowUnverified: true } : undefined,
        );
        if (!res.ok) {
          reportError(res.message || tr("setup.error"));
          return;
        }
        // Honest grade from Host — never invent verified when flag is false/absent.
        setTrustGrade(
          resolveChecksumTrustGrade({
            verifiedFlag:
              typeof res.checksumVerified === "boolean"
                ? res.checksumVerified
                : null,
            allowUnverified: opts?.allowUnverified === true,
          }),
        );
        const next = await recheck(res.path);
        if (next?.found && canAdvancePastRuntime(next.found)) {
          setStep("account");
        } else {
          reportError({ code: "cli_missing", message: tr("setup.cli.missing") });
        }
      } catch (e) {
        const view = reportError(e);
        const msg = view.detail || tr(view.titleKey as MessageKey);
        setProgress((p) =>
          p
            ? { ...p, phase: "error", message: msg }
            : { phase: "error", message: msg },
        );
      } finally {
        setInstalling(false);
      }
    },
    [clearError, installing, recheck, reportError, tr],
  );

  const checksumMissing = !!errorView?.offerUnverifiedInstall;
  const trustBanner = useMemo(
    () => (trustGrade ? resolveCliTrustBanner(trustGrade) : null),
    [trustGrade],
  );
  /** Risk chip: missing sidecar (warn) or mismatch (hard fail honesty). */
  const showTrustRiskChip =
    trustGrade === "missing_sidecar" ||
    trustGrade === "mismatch" ||
    trustGrade === "unverified_allowed";

  const pickBinary = useCallback(async () => {
    clearError();
    try {
      const path = await api.pickCliBinary();
      if (!path) return;
      await api.settingsGet().then((s) =>
        api.settingsSet({ ...s, manualCliPath: path }),
      );
      const next = await recheck(path);
      if (next?.found && canAdvancePastRuntime(next.found)) {
        setStep("account");
      } else {
        reportError({ code: "cli_missing", message: tr("setup.cli.missing") });
      }
    } catch (e) {
      reportError(e);
    }
  }, [clearError, recheck, reportError, tr]);

  const copyCmd = useCallback(async () => {
    const cmd = installCmds?.primary;
    if (!cmd) return;
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      reportError(tr("setup.error"));
    }
  }, [installCmds, reportError, tr]);

  const openDocs = useCallback(() => {
    const url = installCmds?.docsUrl || "https://docs.x.ai/build/overview";
    void api.openExternalUrl(url).catch((e) => reportError(e));
  }, [installCmds, reportError]);

  const finishWizard = useCallback(
    async (opts: { authDeferred: boolean; authOk: boolean }) => {
      if (!canEnterHome(cli.found)) return;
      const flags = buildAuthDeferredFlags({
        authDeferred: opts.authDeferred,
        authOk: opts.authOk,
      });
      try {
        const s = await api.settingsGet();
        await api.settingsSet({
          ...s,
          setupWizardCompleted: true,
          authSetupDeferred: flags.authSetupDeferred,
          onboardingDone: true,
          setupSkipped: flags.setupSkipped,
        });
      } catch {
        /* still enter if probe ok */
      }
      onComplete(cli);
    },
    [cli, onComplete],
  );

  const goAccountContinue = useCallback(() => {
    if (!canAdvancePastRuntime(cli.found)) return;
    setStep("ready");
  }, [cli.found]);

  const skipAccount = useCallback(() => {
    // Soft gate: account is optional — never blocks home after CLI is ready.
    setAuthDeferred(true);
    setStep("ready");
  }, []);

  const saveOfficialKey = useCallback(async () => {
    const key = officialKey.trim();
    if (!key) return;
    setAccountBusy(true);
    clearError();
    try {
      await api.secretsSet({ officialApiKey: key });
      setAuthOk(true);
      setStatusMsg(tr("setup.account.ok"));
      setAccountPanel("menu");
      setStep("ready");
    } catch (e) {
      reportError(e);
    } finally {
      setAccountBusy(false);
    }
  }, [clearError, officialKey, reportError, tr]);

  const saveRelay = useCallback(async () => {
    const base = relayBase.trim();
    const key = relayKey.trim();
    if (!base || !key) return;
    setAccountBusy(true);
    clearError();
    try {
      // Write agent-home config with chosen message format (default Responses).
      // Host recycles warm agents on setAsDefault so the first workbench send
      // spawns with the relay (no full app restart — issue #376).
      await api.providersUpsert({
        id: "relay",
        model: "default",
        baseUrl: base,
        name: "Custom relay",
        apiKey: key,
        apiBackend: relayBackend || "responses",
        setAsDefault: true,
      });
      try {
        await api.secretsSet({ relayBaseUrl: base, relayApiKey: key });
      } catch {
        /* soft-fail: config.toml already holds the key */
      }
      try {
        const ping = await api.providersPing({ baseUrl: base, apiKey: key });
        if (ping && (ping as { ok?: boolean }).ok === false) {
          setStatusMsg(
            String((ping as { message?: string }).message || "ping failed"),
          );
        } else {
          setStatusMsg(tr("setup.account.ok"));
        }
      } catch {
        // Soft-fail ping — still enter workbench; user can fix URL in Settings.
        setStatusMsg(tr("setup.account.ok"));
      }
      setAuthOk(true);
      setAccountPanel("menu");
      setStep("ready");
    } catch (e) {
      reportError(e);
    } finally {
      setAccountBusy(false);
    }
  }, [clearError, relayBase, relayKey, relayBackend, reportError, tr]);

  const runOauth = useCallback(async () => {
    setAccountBusy(true);
    clearError();
    try {
      const ok = await onAccountLoginOauth();
      if (ok) {
        setAuthOk(true);
        setStatusMsg(tr("setup.account.ok"));
        setStep("ready");
      }
      const next = await recheck(cli.path);
      if (next?.cliAuthPresent) {
        setAuthOk(true);
        setStep("ready");
      }
    } catch (e) {
      reportError(e);
    } finally {
      setAccountBusy(false);
    }
  }, [clearError, cli.path, onAccountLoginOauth, recheck, reportError, tr]);

  const importCli = useCallback(async () => {
    setAccountBusy(true);
    clearError();
    try {
      const r = await api.importGrokCli();
      if ((r as { ok?: boolean }).ok) {
        setAuthOk(true);
        setStatusMsg(tr("setup.account.ok"));
        setStep("ready");
      } else {
        setStatusMsg(JSON.stringify((r as { messages?: string[] }).messages || r));
      }
    } catch (e) {
      reportError(e);
    } finally {
      setAccountBusy(false);
    }
  }, [clearError, reportError, tr]);

  const importGo = useCallback(async () => {
    setAccountBusy(true);
    clearError();
    try {
      await api.importGrokGo();
      setAuthOk(true);
      setStatusMsg(tr("setup.account.ok"));
      setStep("ready");
    } catch (e) {
      reportError(e);
    } finally {
      setAccountBusy(false);
    }
  }, [clearError, reportError, tr]);

  /** Abort the running login (OAuth/device) and unlock the UI immediately.
   *  The backend kills the `grok login` child; the pending handler's `finally`
   *  also clears accountBusy, but we reset here so the UI is instant. */
  const cancelAccountLogin = useCallback(async () => {
    try {
      await api.accountLoginCancel();
    } catch {
      /* host may be unavailable; still unlock UI below */
    }
    setAccountBusy(false);
  }, []);

  const percent = useMemo(
    () => clampInstallPercent(progress?.percent, installing),
    [progress, installing],
  );

  const readyChecklist = useMemo(
    () =>
      buildReadyChecklist({
        cliFound: cli.found,
        cliVersion: cli.version,
        authOk,
        authDeferred,
      }),
    [cli.found, cli.version, authOk, authDeferred],
  );

  const stepIndex = step === "runtime" ? 0 : step === "account" ? 1 : 2;

  return (
    <div
      className={
        "setup-gate" +
        (useCustomWindowChrome ? " setup-gate--custom-chrome" : "")
      }
      data-platform={platform}
      data-testid="setup-wizard"
    >
      <div
        className="setup-gate__drag"
        data-tauri-drag-region={tauriDragRegion(platform)}
        {...titlebarMaximizeHandlers()}
      />

      <div className="setup-gate__center">
        <div className="setup-hero">
          <div
            className={
              "setup-logo" +
              (installing || probing ? " setup-logo--spin" : " setup-logo--pulse")
            }
          >
            <GrokLogo size={44} />
          </div>
          <h1 className="setup-title">{tr("setup.title")}</h1>
          <p className="setup-subtitle">{tr("setup.subtitle")}</p>
        </div>

        <ol className="setup-steps" aria-label={tr("setup.stepsAria")}>
          {(
            [
              ["runtime", "setup.step.runtime"],
              ["account", "setup.step.account"],
              ["ready", "setup.step.ready"],
            ] as const
          ).map(([id, key], i) => (
            <li
              key={id}
              className={
                "setup-steps__item" +
                (i === stepIndex ? " is-active" : "") +
                (i < stepIndex ? " is-done" : "")
              }
            >
              <span className="setup-steps__dot" />
              <span className="setup-steps__label">{tr(key)}</span>
            </li>
          ))}
        </ol>

        <div className="setup-card">
          {step === "runtime" && (
            <>
              <div className="setup-card__head">
                <h2>
                  {cli.found
                    ? tr("setup.cli.found")
                    : tr("setup.cli.required")}
                </h2>
                <p>
                  {cli.found
                    ? tr("setup.cli.foundHint", {
                        version: cli.version || "—",
                      })
                    : tr("setup.cli.requiredHint")}
                </p>
                {cli.path && (
                  <p className="setup-mono">
                    {tr("setup.cli.path", { path: cli.path })}
                  </p>
                )}
                {showTrustRiskChip && trustBanner && (
                  <div
                    className="setup-trust-chip-row"
                    data-testid="setup-cli-trust-chip"
                    data-trust-grade={trustGrade ?? undefined}
                  >
                    <span
                      className={cliTrustChipClass(trustBanner.severity)}
                      title={
                        trustBanner.hintKey
                          ? tr(trustBanner.hintKey as MessageKey)
                          : undefined
                      }
                    >
                      {tr(trustBanner.titleKey as MessageKey)}
                    </span>
                    {trustGrade === "mismatch" ? (
                      <span className="setup-trust-chip-row__hint">
                        {tr("cliTrust.hint.mismatch" as MessageKey)}
                      </span>
                    ) : trustBanner.hintKey ? (
                      <span className="setup-trust-chip-row__hint">
                        {tr(trustBanner.hintKey as MessageKey)}
                      </span>
                    ) : null}
                  </div>
                )}
              </div>

              {(installing || progress) && (
                <div className="setup-progress" aria-live="polite">
                  <div className="setup-progress__track">
                    <div
                      className="setup-progress__fill"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                  <div className="setup-progress__meta">
                    <span>
                      {progress?.message ||
                        (installing
                          ? tr("setup.installing")
                          : tr("setup.detecting"))}
                    </span>
                    <span>{tr("setup.progress", { percent })}</span>
                  </div>
                  {progress?.mirror && (
                    <div className="setup-progress__mirror">
                      {tr("setup.mirror", {
                        host: mirrorHostFromUrl(progress.mirror),
                      })}
                    </div>
                  )}
                </div>
              )}

              {!cli.found && !installing && (
                <p className="setup-hint">{tr("setup.manualHint")}</p>
              )}

              <div className="setup-actions">
                {cli.found ? (
                  <button
                    type="button"
                    className="btn btn--primary setup-btn-primary"
                    onClick={() => setStep("account")}
                  >
                    {tr("setup.continue")}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn--primary setup-btn-primary"
                    disabled={installing || probing}
                    onClick={() => void runInstall()}
                  >
                    {installing ? (
                      <>
                        <Spinner className="size-4" />
                        {tr("setup.installing")}
                      </>
                    ) : (
                      tr("setup.install")
                    )}
                  </button>
                )}
                {checksumMissing && !cli.found && !installing && (
                  <button
                    type="button"
                    className="btn btn--primary setup-btn-primary"
                    disabled={probing}
                    onClick={() => void runInstall({ allowUnverified: true })}
                  >
                    {tr("setup.installUnverified")}
                  </button>
                )}
                <div className="setup-actions__row">
                  <button
                    type="button"
                    className="btn btn--ghost"
                    disabled={installing || probing}
                    onClick={() => void recheck()}
                  >
                    {probing ? <Spinner className="size-3.5" /> : null}
                    {tr("setup.recheck")}
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    disabled={installing}
                    onClick={() => void pickBinary()}
                  >
                    {tr("setup.pickBinary")}
                  </button>
                </div>
                <div className="setup-actions__row">
                  <button
                    type="button"
                    className="btn btn--ghost"
                    disabled={!installCmds?.primary}
                    onClick={() => void copyCmd()}
                  >
                    {copied ? tr("setup.copied") : tr("setup.copyCmd")}
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={openDocs}
                  >
                    {tr("setup.openDocs")}
                  </button>
                </div>
                {installCmds?.primary && (
                  <code className="setup-cmd">{installCmds.primary}</code>
                )}
              </div>
            </>
          )}

          {step === "account" && (
            <>
              <div className="setup-card__head">
                <h2>{tr("setup.account.title")}</h2>
                <p>{tr("setup.account.hint")}</p>
              </div>

              {accountPanel === "menu" && (
                <div className="setup-entry-grid">
                  {cli.cliAuthPresent && (
                    <button
                      type="button"
                      className="setup-entry setup-entry--recommended"
                      disabled={accountBusy}
                      onClick={() => void importCli()}
                    >
                      <strong>{tr("setup.reuseCliAuthTitle")}</strong>
                      <span>{tr("setup.reuseCliAuthDesc")}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    className="setup-entry"
                    disabled={accountBusy}
                    onClick={() => void runOauth()}
                  >
                    <strong>{tr("setup.account.oauth")}</strong>
                    <span>{tr("setup.account.oauthHint")}</span>
                  </button>
                  <button
                    type="button"
                    className="setup-entry"
                    disabled={accountBusy}
                    onClick={() => setAccountPanel("key")}
                  >
                    <strong>{tr("setup.account.key")}</strong>
                    <span>{tr("setup.account.keyHint")}</span>
                  </button>
                  <button
                    type="button"
                    className="setup-entry"
                    disabled={accountBusy}
                    onClick={() => setAccountPanel("relay")}
                  >
                    <strong>{tr("setup.account.relay")}</strong>
                    <span>{tr("setup.account.relayHint")}</span>
                  </button>
                  <button
                    type="button"
                    className="setup-entry"
                    disabled={accountBusy}
                    onClick={() => void importGo()}
                  >
                    <strong>{tr("setup.account.importGo")}</strong>
                    <span>{tr("onboarding.importGoHint")}</span>
                  </button>
                </div>
              )}

              {accountPanel === "key" && (
                <div className="setup-form">
                  <input
                    className="setup-input"
                    type="password"
                    autoComplete="off"
                    placeholder={tr("setup.account.keyPh")}
                    value={officialKey}
                    onChange={(e) => setOfficialKey(e.target.value)}
                  />
                  <div className="setup-actions__row">
                    <button
                      type="button"
                      className="btn btn--ghost"
                      onClick={() => setAccountPanel("menu")}
                    >
                      {tr("common.cancel")}
                    </button>
                    <button
                      type="button"
                      className="btn btn--primary"
                      disabled={accountBusy || !officialKey.trim()}
                      onClick={() => void saveOfficialKey()}
                    >
                      {tr("setup.account.saveKey")}
                    </button>
                  </div>
                </div>
              )}

              {accountPanel === "relay" && (
                <div className="setup-form">
                  <input
                    className="setup-input"
                    type="url"
                    autoComplete="off"
                    placeholder={tr("setup.account.basePh")}
                    value={relayBase}
                    onChange={(e) => setRelayBase(e.target.value)}
                  />
                  <input
                    className="setup-input"
                    type="password"
                    autoComplete="off"
                    placeholder={tr("setup.account.relayKeyPh")}
                    value={relayKey}
                    onChange={(e) => setRelayKey(e.target.value)}
                  />
                  <label className="setup-field">
                    <span className="setup-field__label">
                      {tr("setup.account.protocol")}
                    </span>
                    <Select
                      value={relayBackend}
                      onChange={setRelayBackend}
                      options={protocolOptions}
                      aria-label={tr("setup.account.protocol")}
                    />
                  </label>
                  <div className="setup-actions__row">
                    <button
                      type="button"
                      className="btn btn--ghost"
                      onClick={() => setAccountPanel("menu")}
                    >
                      {tr("common.cancel")}
                    </button>
                    <button
                      type="button"
                      className="btn btn--primary"
                      disabled={
                        accountBusy || !relayBase.trim() || !relayKey.trim()
                      }
                      onClick={() => void saveRelay()}
                    >
                      {tr("setup.account.saveRelay")}
                    </button>
                  </div>
                </div>
              )}

              {accountBusy && (
                <div className="setup-busy">
                  <Spinner className="size-4" />
                  {tr("setup.account.busy")}
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => void cancelAccountLogin()}
                  >
                    {tr("setup.account.cancelBusy")}
                  </button>
                </div>
              )}

              <div className="setup-actions setup-actions--footer">
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={accountBusy}
                  onClick={skipAccount}
                >
                  {tr("setup.account.skip")}
                </button>
                {(authOk || accountPanel === "menu") && (
                  <button
                    type="button"
                    className="btn btn--primary"
                    disabled={accountBusy}
                    onClick={goAccountContinue}
                  >
                    {tr("setup.continue")}
                  </button>
                )}
              </div>
            </>
          )}

          {step === "ready" && (
            <>
              <div className="setup-card__head">
                <h2>{tr("setup.ready.title")}</h2>
                {readyChecklist.authDeferred && (
                  <p className="setup-ready-soft">
                    {tr("setup.ready.authSoftNote")}
                  </p>
                )}
              </div>
              <ul className="setup-checklist">
                {readyChecklist.rows.map((row) => (
                  <li
                    key={row.id}
                    className={
                      row.ok ? "is-ok" : row.soft ? "is-soft" : "is-fail"
                    }
                    data-setup-check={row.id}
                  >
                    <span className="setup-check" />
                    {tr(row.labelKey as MessageKey)}
                    {row.meta ? (
                      <span className="setup-check-meta">{row.meta}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
              <div className="setup-actions">
                <button
                  type="button"
                  className="btn btn--primary setup-btn-primary"
                  disabled={!readyChecklist.canEnter}
                  onClick={() =>
                    void finishWizard({
                      authDeferred: authDeferred || !authOk,
                      authOk,
                    })
                  }
                >
                  {tr("setup.ready.enter")}
                </button>
              </div>
            </>
          )}

          {errorView && !errorView.silent && (
            <div
              className={
                "setup-error" +
                (errorView.tone === "warn" ? " setup-error--warn" : "")
              }
              role="alert"
              data-setup-error-kind={errorView.kind}
            >
              <strong>{tr(errorView.titleKey as MessageKey)}</strong>
              {errorView.detail ? <span>{errorView.detail}</span> : null}
              {errorView.hintKey ? (
                <span className="setup-error__hint">
                  {tr(errorView.hintKey as MessageKey)}
                </span>
              ) : null}
            </div>
          )}
          {statusMsg && !(errorView && !errorView.silent) && (
            <div className="setup-status" role="status">
              {statusMsg}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
