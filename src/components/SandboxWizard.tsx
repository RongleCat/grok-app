/**
 * Sandbox profile guide (GlassModal).
 *
 * Modes:
 * - trust: optional offer after project trust (recommend workspace)
 * - info: Settings “Open sandbox guide” replay
 *
 * Steps: intro → pick profile → confirm. No window.confirm.
 */

import { useEffect, useMemo, useState } from "react";
import { GlassModal } from "@/components/GlassModal";
import {
  createT,
  resolveLocale,
  type Locale,
} from "@/i18n";
import {
  SANDBOX_MIN_CLI,
  type SandboxProfileId,
} from "@/lib/sandboxProfile";
import {
  advanceSandboxWizardStep,
  createSandboxWizardAnswers,
  planSandboxWizardStep,
  recommendSandboxForTrust,
  resolveSandboxWizardBanner,
  retreatSandboxWizardStep,
  sandboxWizardProfileChoices,
  sandboxWizardProfileHelpKey,
  sandboxWizardProfileLabelKey,
  sandboxWizardStepLabelKey,
  sandboxWizardTitleKey,
  type SandboxWizardMode,
  type SandboxWizardStep,
} from "@/lib/sandboxWizard";

export type SandboxWizardProps = {
  open: boolean;
  locale: Locale | string | undefined;
  mode: SandboxWizardMode;
  platform?: string | null;
  /** Pre-resolved CLI support for --sandbox (null = unknown). */
  cliSupportsSandbox?: boolean | null;
  onClose: () => void;
  /**
   * Skip / “not now”. Host may soft-persist dismiss for trust mode.
   * `dontOfferAgain` when the checkbox was ticked.
   */
  onSkip: (opts: { dontOfferAgain: boolean }) => void;
  /** Apply selected profile to settings (host runs danger confirm if needed). */
  onApply: (
    profile: SandboxProfileId,
    opts: { dontOfferAgain: boolean },
  ) => void;
};

export function SandboxWizard({
  open,
  locale,
  mode,
  platform = null,
  cliSupportsSandbox = null,
  onClose,
  onSkip,
  onApply,
}: SandboxWizardProps) {
  const tr = useMemo(() => createT(resolveLocale(locale)), [locale]);
  const [step, setStep] = useState<SandboxWizardStep>("intro");
  const [profile, setProfile] = useState<SandboxProfileId | null>(
    RECOMMENDED_SEED,
  );
  const [dontOfferAgain, setDontOfferAgain] = useState(false);

  const recommendation = useMemo(
    () =>
      recommendSandboxForTrust({
        platform,
        cliSupportsSandbox,
      }),
    [platform, cliSupportsSandbox],
  );

  useEffect(() => {
    if (!open) return;
    const seeded = createSandboxWizardAnswers({
      platform,
      cliSupportsSandbox,
    });
    setStep("intro");
    setProfile(seeded.profile);
    setDontOfferAgain(false);
  }, [open, platform, cliSupportsSandbox]);

  const answers = useMemo(
    () => ({ profile, dontOfferAgain }),
    [profile, dontOfferAgain],
  );
  const plan = useMemo(
    () => planSandboxWizardStep(step, answers),
    [step, answers],
  );

  const bannerKey = useMemo(
    () =>
      resolveSandboxWizardBanner({
        platform,
        cliSupportsSandbox,
        profile: profile ?? recommendation.profile,
      }),
    [platform, cliSupportsSandbox, profile, recommendation.profile],
  );

  const handleContinue = () => {
    if (!plan.canContinue) return;
    const next = advanceSandboxWizardStep(step, answers);
    if (next === "done") {
      if (profile) {
        onApply(profile, { dontOfferAgain });
      }
      return;
    }
    setStep(next);
  };

  const handleBack = () => {
    setStep(retreatSandboxWizardStep(step));
  };

  const handleSkip = () => {
    onSkip({ dontOfferAgain });
  };

  const footer = (
    <>
      <button
        type="button"
        className="btn btn--ghost sandbox-wizard__skip"
        onClick={handleSkip}
      >
        {mode === "info" ? tr("common.close") : tr("sandboxWizard.skip")}
      </button>
      {plan.canBack ? (
        <button type="button" className="btn btn--ghost" onClick={handleBack}>
          {tr("sandboxWizard.back")}
        </button>
      ) : null}
      <button
        type="button"
        className="btn btn--solid"
        disabled={!plan.canContinue}
        onClick={handleContinue}
      >
        {plan.isLast
          ? tr("sandboxWizard.apply")
          : tr("sandboxWizard.next")}
      </button>
    </>
  );

  return (
    <GlassModal
      open={open}
      onClose={onClose}
      title={tr(sandboxWizardTitleKey(mode))}
      size="md"
      closeLabel={tr("common.close")}
      className="sandbox-wizard"
      wrapBody
      bodyClassName="sandbox-wizard__body-wrap"
      footer={footer}
    >
      <p className="sandbox-wizard__progress" aria-live="polite">
        {tr("sandboxWizard.progress", {
          n: String(plan.progress),
          total: String(plan.total),
          step: tr(sandboxWizardStepLabelKey(step)),
        })}
      </p>

      <div
        className="sandbox-wizard__dots"
        role="presentation"
        aria-hidden
      >
        {(["intro", "pick", "confirm"] as const).map((id, i) => (
          <span
            key={id}
            className={
              "sandbox-wizard__dot" +
              (i === plan.index ? " is-active" : "") +
              (i < plan.index ? " is-done" : "")
            }
          />
        ))}
      </div>

      {step === "intro" ? (
        <div className="sandbox-wizard__panel">
          <p className="sandbox-wizard__lead">
            {mode === "trust"
              ? tr("sandboxWizard.intro.trust")
              : tr("sandboxWizard.intro.info")}
          </p>
          <p className="sandbox-wizard__recommend">
            {tr(recommendation.reasonKey)}
          </p>
          <p className="sandbox-wizard__hint" role="note">
            {tr("sandboxWizard.appDefaultNote")}
          </p>
          {bannerKey ? (
            <p
              className="sandbox-wizard__banner settings-row__hint is-danger"
              role="status"
            >
              {tr(bannerKey, { min: SANDBOX_MIN_CLI })}
            </p>
          ) : null}
        </div>
      ) : null}

      {step === "pick" ? (
        <div className="sandbox-wizard__panel">
          <p className="sandbox-wizard__lead">
            {tr("sandboxWizard.pick.lead")}
          </p>
          <div
            className="sandbox-wizard__choices"
            role="radiogroup"
            aria-label={tr("sandboxWizard.step.pick")}
          >
            {sandboxWizardProfileChoices().map((id) => {
              const selected = profile === id;
              const recommended = id === recommendation.profile;
              return (
                <label
                  key={id}
                  className={
                    "sandbox-wizard__choice" +
                    (selected ? " is-selected" : "") +
                    (recommended ? " is-recommended" : "")
                  }
                >
                  <input
                    type="radio"
                    name="sandbox-wizard-profile"
                    value={id}
                    checked={selected}
                    onChange={() => setProfile(id)}
                  />
                  <span className="sandbox-wizard__choice-main">
                    <span className="sandbox-wizard__choice-label">
                      {tr(sandboxWizardProfileLabelKey(id))}
                      {recommended ? (
                        <span className="sandbox-wizard__badge">
                          {tr("sandboxWizard.recommendedBadge")}
                        </span>
                      ) : null}
                    </span>
                    <span className="sandbox-wizard__choice-help">
                      {tr(sandboxWizardProfileHelpKey(id))}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          {bannerKey && profile && profile !== "off" ? (
            <p
              className="sandbox-wizard__banner settings-row__hint is-danger"
              role="status"
            >
              {tr(bannerKey, { min: SANDBOX_MIN_CLI })}
            </p>
          ) : null}
        </div>
      ) : null}

      {step === "confirm" ? (
        <div className="sandbox-wizard__panel">
          <p className="sandbox-wizard__lead">
            {tr("sandboxWizard.confirm.lead", {
              profile: profile
                ? tr(sandboxWizardProfileLabelKey(profile))
                : "—",
            })}
          </p>
          {profile ? (
            <p className="sandbox-wizard__confirm-help">
              {tr(sandboxWizardProfileHelpKey(profile))}
            </p>
          ) : null}
          {plan.dangerKey ? (
            <p
              className="sandbox-wizard__banner settings-row__hint is-danger"
              role="status"
            >
              {tr(plan.dangerKey)}
            </p>
          ) : null}
          {bannerKey && profile && profile !== "off" ? (
            <p
              className="sandbox-wizard__banner settings-row__hint is-danger"
              role="status"
            >
              {tr(bannerKey, { min: SANDBOX_MIN_CLI })}
            </p>
          ) : null}
          <p className="sandbox-wizard__hint">
            {tr("sandboxWizard.confirm.respawnHint")}
          </p>
        </div>
      ) : null}

      {mode === "trust" ? (
        <label className="sandbox-wizard__dont-offer">
          <input
            type="checkbox"
            checked={dontOfferAgain}
            onChange={(e) => setDontOfferAgain(e.target.checked)}
          />
          <span>{tr("sandboxWizard.dontOfferAgain")}</span>
        </label>
      ) : null}
    </GlassModal>
  );
}

const RECOMMENDED_SEED: SandboxProfileId = "workspace";
