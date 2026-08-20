import { createT, type Locale } from "@/i18n";
import { GlassModal } from "@/components/GlassModal";
import type { ArchiveAgePlan } from "@/lib/sessionArchiveAge";

export function ArchiveAgeConfirmModal(props: {
  locale: Locale;
  plan: ArchiveAgePlan | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const tr = createT(props.locale);
  const plan = props.plan;
  return (
    <GlassModal
      open={!!plan}
      onClose={() => {
        if (props.busy) return;
        props.onClose();
      }}
      title={tr("sidebar.archiveOlderTitle")}
      size="sm"
      closeLabel={tr("common.close")}
      closeOnOverlay={!props.busy}
      showClose={!props.busy}
      wrapBody
      footer={
        <>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={props.busy}
            onClick={props.onClose}
          >
            {tr("common.cancel")}
          </button>
          <button
            type="button"
            className="btn btn--solid"
            disabled={props.busy || !plan?.count}
            data-testid="archive-age-confirm"
            onClick={() => {
              if (!plan) return;
              props.onConfirm();
            }}
          >
            {tr("sidebar.archiveOlderConfirmAction", {
              n: String(plan?.count ?? 0),
            })}
          </button>
        </>
      }
    >
      {plan ? (
        <div className="archive-age-modal">
          <p className="archive-age-modal__msg">
            {tr("sidebar.archiveOlderConfirm", {
              n: String(plan.count),
              days: String(plan.days),
            })}
          </p>
          {plan.previewTitles.length > 0 ? (
            <div className="archive-age-modal__preview">
              <div className="archive-age-modal__preview-label">
                {tr("sidebar.archiveOlderPreviewLabel")}
              </div>
              <ul className="archive-age-modal__list">
                {plan.previewTitles.map((title, i) => {
                  const row = plan.sessions[i];
                  const key = row?.id ?? `preview-${i}`;
                  return (
                    <li key={key} className="archive-age-modal__item">
                      {title || tr("session.untitled")}
                    </li>
                  );
                })}
              </ul>
              {plan.previewMore > 0 ? (
                <div className="archive-age-modal__more">
                  {tr("sidebar.archiveOlderPreviewMore", {
                    n: String(plan.previewMore),
                  })}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </GlassModal>
  );
}
