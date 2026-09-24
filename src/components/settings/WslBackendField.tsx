/**
 * Settings → Runtime → CLI: use Grok Build installed inside WSL (Windows only).
 *
 * Persists `cliBackend` / `wslDistro` / `wslCliPath` on AppSettings. When
 * backend is `wsl`, Host spawns via `wsl.exe` instead of a native grok.exe.
 */
import { useCallback, useEffect, useState } from "react";
import * as api from "@/lib/api";
import { Select } from "@/components/Select";
import { UiCheck } from "./shared";
import type { Vars } from "@/i18n";

type Props = {
  t: (k: string, vars?: Vars) => string;
  /** After persist — re-probe CLI / soft-respawn agents. */
  onSaved?: () => void;
};

export function WslBackendField({ t, onSaved }: Props) {
  const [enabled, setEnabled] = useState(false);
  const [distro, setDistro] = useState("");
  const [cliPath, setCliPath] = useState("");
  const [status, setStatus] = useState<api.WslStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [probing, setProbing] = useState(false);

  const refresh = useCallback(async () => {
    if (!api.isTauri()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [s, st] = await Promise.all([
        api.settingsGet(),
        api.wslStatus(),
      ]);
      setEnabled((s.cliBackend || "native") === "wsl");
      setDistro(s.wslDistro?.trim() || "");
      setCliPath(s.wslCliPath?.trim() || "");
      setStatus(st);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const persist = async (next: {
    enabled: boolean;
    distro: string;
    cliPath: string;
  }) => {
    if (!api.isTauri() || saving) return;
    setSaving(true);
    try {
      const s = await api.settingsGet();
      await api.settingsSet({
        ...s,
        cliBackend: next.enabled ? "wsl" : "native",
        wslDistro: next.distro.trim() || null,
        wslCliPath: next.cliPath.trim() || null,
      });
      setEnabled(next.enabled);
      setDistro(next.distro.trim());
      setCliPath(next.cliPath.trim());
      const st = await api.wslStatus();
      setStatus(st);
      onSaved?.();
    } finally {
      setSaving(false);
    }
  };

  const runProbe = async () => {
    if (!api.isTauri()) return;
    setProbing(true);
    try {
      // Ensure latest settings before probe.
      await persist({ enabled, distro, cliPath });
      const st = await api.wslStatus();
      setStatus(st);
      // Also refresh main CLI probe path via parent onSaved.
      onSaved?.();
    } finally {
      setProbing(false);
    }
  };

  if (loading) {
    return (
      <div className="settings-row settings-row--stack" id="settings-anchor-wslBackend">
        <div className="settings-row__hint">{t("settings.wsl.loading")}</div>
      </div>
    );
  }

  const distroOptions = [
    { value: "", label: t("settings.wsl.distroDefault") },
    ...(status?.distros ?? []).map((d) => ({ value: d, label: d })),
  ];
  // Keep current distro visible even if list failed.
  if (distro && !distroOptions.some((o) => o.value === distro)) {
    distroOptions.push({ value: distro, label: distro });
  }

  const probe = status?.probe;
  const probeOk = !!probe?.found && !!probe?.version;

  return (
    <div
      className="settings-row settings-row--stack"
      id="settings-anchor-wslBackend"
    >
      <div className="settings-row__text">
        <div className="settings-row__label">{t("settings.wsl.title")}</div>
        <div className="settings-row__desc">{t("settings.wsl.desc")}</div>
      </div>

      {!status?.available ? (
        <div className="settings-row__hint settings-row__hint--warn">
          {t("settings.wsl.unavailable", {
            error: status?.error || "wsl.exe",
          })}
        </div>
      ) : null}

      <div className="settings-row">
        <div className="settings-row__text">
          <div className="settings-row__label">{t("settings.wsl.enable")}</div>
          <div className="settings-row__desc">{t("settings.wsl.enableDesc")}</div>
        </div>
        <UiCheck
          checked={enabled}
          onChange={() => {
            if (!status?.available || saving) return;
            void persist({
              enabled: !enabled,
              distro,
              cliPath,
            });
          }}
          ariaLabel={t("settings.wsl.enable")}
          className={
            !status?.available || saving ? "is-disabled" : undefined
          }
        />
      </div>

      {enabled ? (
        <>
          <div className="settings-row settings-row--stack">
            <div className="settings-row__label">{t("settings.wsl.distro")}</div>
            <div className="settings-row__desc">{t("settings.wsl.distroDesc")}</div>
            <Select
              value={distro}
              options={distroOptions}
              onChange={(v) => {
                void persist({ enabled, distro: v, cliPath });
              }}
              disabled={saving}
              aria-label={t("settings.wsl.distro")}
            />
          </div>
          <div className="settings-row settings-row--stack">
            <div className="settings-row__label">{t("settings.wsl.cliPath")}</div>
            <div className="settings-row__desc">{t("settings.wsl.cliPathDesc")}</div>
            <input
              className="settings-input"
              value={cliPath}
              placeholder={t("settings.wsl.cliPathPlaceholder")}
              disabled={saving}
              onChange={(e) => setCliPath(e.target.value)}
              onBlur={(e) => {
                const v = e.target.value.trim();
                // Persist (and re-probe) only when the path actually changed —
                // blurring an untouched input must not respawn the WSL probe.
                if (v !== cliPath) {
                  void persist({ enabled, distro, cliPath: v });
                }
              }}
            />
          </div>
          <div className="settings-row">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={probing || saving}
              onClick={() => void runProbe()}
            >
              {probing ? t("settings.wsl.probing") : t("settings.wsl.probe")}
            </button>
          </div>
          {probe ? (
            <div
              className={
                "settings-acp-chip" + (probeOk ? " is-ok" : " is-fail")
              }
              role="status"
            >
              <span className="settings-acp-chip__dot" aria-hidden />
              <span className="settings-acp-chip__label">
                {probeOk
                  ? t("settings.wsl.probeOk")
                  : t("settings.wsl.probeFail")}
              </span>
              <span className="settings-acp-chip__meta">
                {probe.version
                  ? `${probe.version}${probe.path ? ` · ${probe.path}` : ""}`
                  : probe.path || t("settings.cliNotFound")}
              </span>
            </div>
          ) : null}
          <div className="settings-row__hint">{t("settings.wsl.hint")}</div>
        </>
      ) : (
        <div className="settings-row__hint">{t("settings.wsl.nativeHint")}</div>
      )}
    </div>
  );
}
