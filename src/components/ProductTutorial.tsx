/**
 * Optional product tour modal — GlassModal shell, solid app styles.
 * Does not block first-run SetupWizard; host decides when to open.
 */

import { useEffect, useMemo, useState } from "react";
import { GlassModal } from "@/components/GlassModal";
import {
  createT,
  resolveLocale,
  type Locale,
  type MessageKey,
} from "@/i18n";
import {
  getSteps,
  stepCount,
  type ProductTutorialStepId,
} from "@/lib/productTutorial";

export type ProductTutorialProps = {
  open: boolean;
  locale: Locale | string | undefined;
  /** Dismiss (X / overlay) — host should treat as skip (persist done). */
  onClose: () => void;
  /** Skip tour button. */
  onSkip: () => void;
  /** Finish last step. */
  onDone: () => void;
};

function titleKeyFor(id: ProductTutorialStepId): MessageKey {
  return `tutorial.step.${id}.title` as MessageKey;
}

function bodyKeyFor(id: ProductTutorialStepId): MessageKey {
  return `tutorial.step.${id}.body` as MessageKey;
}

export function ProductTutorial({
  open,
  locale,
  onClose,
  onSkip,
  onDone,
}: ProductTutorialProps) {
  const tr = useMemo(
    () => createT(resolveLocale(locale)),
    [locale],
  );
  const steps = useMemo(() => getSteps(), []);
  const total = stepCount();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  const stepId = steps[index] ?? "welcome";
  const isFirst = index <= 0;
  const isLast = index >= total - 1;
  const current = Math.min(index + 1, total);

  const footer = (
    <>
      <button
        type="button"
        className="btn btn--ghost product-tutorial__skip"
        onClick={onSkip}
      >
        {tr("tutorial.skip")}
      </button>
      {!isFirst ? (
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
        >
          {tr("tutorial.back")}
        </button>
      ) : null}
      {isLast ? (
        <button type="button" className="btn btn--solid" onClick={onDone}>
          {tr("tutorial.done")}
        </button>
      ) : (
        <button
          type="button"
          className="btn btn--solid"
          onClick={() => setIndex((i) => Math.min(total - 1, i + 1))}
        >
          {tr("tutorial.next")}
        </button>
      )}
    </>
  );

  return (
    <GlassModal
      open={open}
      onClose={onClose}
      title={tr(titleKeyFor(stepId))}
      size="md"
      closeLabel={tr("common.close")}
      className="product-tutorial"
      wrapBody
      bodyClassName="product-tutorial__body-wrap"
      footer={footer}
    >
      <p className="product-tutorial__progress" aria-live="polite">
        {tr("tutorial.stepOf", {
          current: String(current),
          total: String(total),
        })}
      </p>
      <div
        className="product-tutorial__dots"
        role="presentation"
        aria-hidden
      >
        {steps.map((id, i) => (
          <span
            key={id}
            className={
              "product-tutorial__dot" +
              (i === index ? " is-active" : "") +
              (i < index ? " is-done" : "")
            }
          />
        ))}
      </div>
      <p className="product-tutorial__body">{tr(bodyKeyFor(stepId))}</p>
    </GlassModal>
  );
}
