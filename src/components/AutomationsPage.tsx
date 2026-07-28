/**
 * Scheduled automations workbench — Codex-style “已安排”.
 * List + filter + AI create entry + manual form panel.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as api from "@/lib/api";
import {
  computeNextRunAt,
  formatNextRunRelative,
  formatScheduleSummary,
  type Automation,
} from "@/lib/automations";
import { Select } from "@/components/Select";
import {
  IconAutomations,
  IconClose,
  IconMore,
  IconPlus,
  IconScheduled,
  IconSearch,
} from "@/components/icons";
import { Tip } from "@/components/ui/tooltip";
import {
  DEFAULT_EFFORT,
  DEFAULT_MODEL_ID,
  GROK_BUILD_EFFORTS,
  GROK_BUILD_MODELS,
  type ModelOption,
} from "@/lib/grokCatalog";

export type AutomationsFilter = "all" | "enabled" | "paused";

export interface AutomationsProjectOption {
  id: string;
  name: string;
}

export interface AutomationsPageProps {
  t: (key: string, vars?: Record<string, string | number>) => string;
  projects: AutomationsProjectOption[];
  defaultModelId?: string;
  defaultEffort?: string;
  /** Live selectable models; falls back to catalog. */
  models?: ModelOption[];
  onAiCreate: () => void;
  onRunNow?: (auto: Automation) => void;
}

type FormState = {
  title: string;
  prompt: string;
  projectId: string; // "" = none
  modelId: string;
  effort: string;
  frequency: string;
  time: string;
  notify: string;
  enabled: boolean;
};

const emptyForm = (modelId: string, effort: string): FormState => ({
  title: "",
  prompt: "",
  projectId: "",
  modelId,
  effort,
  frequency: "daily",
  time: "09:00",
  notify: "all",
  enabled: true,
});

export function AutomationsPage({
  t,
  projects,
  defaultModelId = DEFAULT_MODEL_ID,
  defaultEffort = DEFAULT_EFFORT,
  models,
  onAiCreate,
  onRunNow,
}: AutomationsPageProps) {
  const [list, setList] = useState<Automation[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<AutomationsFilter>("all");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(() =>
    emptyForm(defaultModelId, defaultEffort),
  );
  const [createMenu, setCreateMenu] = useState(false);
  const [rowMenuId, setRowMenuId] = useState<string | null>(null);
  /** Pending delete — never use window.confirm in Tauri WebView. */
  const [deleteTarget, setDeleteTarget] = useState<Automation | null>(null);
  const [deleting, setDeleting] = useState(false);
  const createBtnRef = useRef<HTMLButtonElement>(null);
  const createMenuRef = useRef<HTMLDivElement>(null);
  const deleteConfirmBtnRef = useRef<HTMLButtonElement>(null);
  const [, setTick] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const rows = await api.automationsList();
      setList(
        rows.map((r) => ({
          ...r,
          weekdays: r.weekdays ?? [],
        })),
      );
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Refresh relative "next run" labels once a minute.
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!createMenu) return;
    const onDoc = (e: MouseEvent) => {
      const el = e.target as Node;
      if (
        createMenuRef.current?.contains(el) ||
        createBtnRef.current?.contains(el)
      ) {
        return;
      }
      setCreateMenu(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [createMenu]);

  useEffect(() => {
    if (!rowMenuId) return;
    // Close on outside mousedown, but ignore presses inside the open menu
    // (otherwise menu unmounts before click fires → items do nothing).
    const onDoc = (e: MouseEvent) => {
      const el = e.target as Element | null;
      if (el?.closest?.(`[data-auto-row-menu="${rowMenuId}"]`)) return;
      // Keep open when pressing the same row's ⋯ trigger (toggle handled there).
      if (el?.closest?.(`[data-auto-row-trigger="${rowMenuId}"]`)) return;
      setRowMenuId(null);
    };
    const timer = window.setTimeout(
      () => document.addEventListener("mousedown", onDoc),
      0,
    );
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [rowMenuId]);

  const filtered = useMemo(() => {
    let rows = list;
    if (filter === "enabled") rows = rows.filter((a) => a.enabled);
    if (filter === "paused") rows = rows.filter((a) => !a.enabled);
    const q = query.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (a) =>
          a.title.toLowerCase().includes(q) ||
          a.prompt.toLowerCase().includes(q),
      );
    }
    return rows;
  }, [list, filter, query]);

  const openCreateManual = () => {
    setCreateMenu(false);
    setEditingId(null);
    setForm(emptyForm(defaultModelId, defaultEffort));
    setPanelOpen(true);
  };

  const openEdit = (auto: Automation) => {
    setRowMenuId(null);
    setEditingId(auto.id);
    setForm({
      title: auto.title,
      prompt: auto.prompt,
      projectId: auto.projectId ?? "",
      modelId: auto.modelId || defaultModelId,
      effort: auto.effort || defaultEffort,
      frequency: auto.frequency || "daily",
      time: auto.time || "09:00",
      notify: auto.notify || "all",
      enabled: auto.enabled,
    });
    setPanelOpen(true);
  };

  const closePanel = () => {
    setPanelOpen(false);
    setEditingId(null);
  };

  const saveForm = async () => {
    const title = form.title.trim();
    const prompt = form.prompt.trim();
    if (!title) {
      setError(t("automations.errTitle"));
      return;
    }
    if (!prompt) {
      setError(t("automations.errPrompt"));
      return;
    }
    const nextRunAt = computeNextRunAt({
      frequency: form.frequency,
      time: form.time,
      weekdays: [],
      enabled: form.enabled,
    });
    const input: api.AutomationInputDto = {
      title,
      prompt,
      enabled: form.enabled,
      projectId: form.projectId || null,
      modelId: form.modelId || null,
      effort: form.effort || null,
      frequency: form.frequency,
      time: form.time,
      weekdays: [],
      notify: form.notify,
      nextRunAt,
    };
    try {
      if (editingId) {
        await api.automationUpdate(editingId, input);
      } else {
        await api.automationCreate(input);
      }
      closePanel();
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  const toggleEnabled = async (auto: Automation) => {
    setRowMenuId(null);
    try {
      const next = await api.automationSetEnabled(auto.id, !auto.enabled);
      if (next.enabled && !next.nextRunAt) {
        const nr = computeNextRunAt(next as Automation);
        if (nr) {
          await api.automationUpdate(auto.id, {
            title: next.title,
            prompt: next.prompt,
            enabled: true,
            projectId: next.projectId,
            modelId: next.modelId,
            effort: next.effort,
            frequency: next.frequency,
            time: next.time,
            weekdays: next.weekdays,
            notify: next.notify,
            nextRunAt: nr,
          });
        }
      }
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  const requestRemove = (auto: Automation) => {
    setRowMenuId(null);
    setDeleteTarget(auto);
  };

  const confirmRemove = async () => {
    const auto = deleteTarget;
    if (!auto || deleting) return;
    setDeleting(true);
    try {
      await api.automationDelete(auto.id);
      setDeleteTarget(null);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setDeleting(false);
    }
  };

  useEffect(() => {
    if (!deleteTarget) return;
    const t = window.setTimeout(() => deleteConfirmBtnRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [deleteTarget]);

  const scheduleLabels = {
    daily: t("automations.freq.daily"),
    weekly: t("automations.freq.weekly"),
    weekdays: t("automations.freq.weekdays"),
    once: t("automations.freq.once"),
    at: t("automations.at"),
  };

  const relativeLabels = {
    overdue: t("automations.next.overdue"),
    inHours: t("automations.next.inHours"),
    inDays: t("automations.next.inDays"),
    inMinutes: t("automations.next.inMinutes"),
    unknown: t("automations.next.unknown"),
  };

  const projectOptions = useMemo(
    () => [
      { value: "", label: t("automations.projectNone") },
      ...projects.map((p) => ({ value: p.id, label: p.name })),
    ],
    [projects, t],
  );

  const modelOptions = (models?.length ? models : GROK_BUILD_MODELS).map((m) => ({
    value: m.id,
    label: m.label,
  }));

  const effortOptions = GROK_BUILD_EFFORTS.map((e) => ({
    value: e.id,
    label: t(`effort.${e.id}` as "effort.high"),
  }));

  const freqOptions = [
    { value: "daily", label: t("automations.freq.daily") },
    { value: "weekdays", label: t("automations.freq.weekdays") },
    { value: "weekly", label: t("automations.freq.weekly") },
    { value: "once", label: t("automations.freq.once") },
  ];

  const timeOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [];
    for (let h = 0; h < 24; h++) {
      for (const m of [0, 30]) {
        const value = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
        opts.push({ value, label: value });
      }
    }
    // Ensure current form time is present even if not on 30-min grid.
    if (form.time && !opts.some((o) => o.value === form.time)) {
      opts.unshift({ value: form.time, label: form.time });
    }
    return opts;
  }, [form.time]);

  const notifyOptions = [
    { value: "all", label: t("automations.notify.all") },
    { value: "failures", label: t("automations.notify.failures") },
    { value: "none", label: t("automations.notify.none") },
  ];

  return (
    <div className="auto-page">
      <div className="auto-page__head">
        <div className="auto-page__titles">
          <h1 className="auto-page__title">{t("automations.title")}</h1>
          <p className="auto-page__subtitle">{t("automations.subtitle")}</p>
          <p className="auto-page__subtitle auto-page__subtitle--hint">
            {t("automations.trayHint")}
          </p>
        </div>
        <div className="auto-page__create-wrap">
          <button
            ref={createBtnRef}
            type="button"
            className="auto-page__create"
            onClick={() => setCreateMenu((v) => !v)}
          >
            {t("automations.create")}
            <span className="auto-page__create-caret" aria-hidden>
              ▾
            </span>
          </button>
          {createMenu && (
            <div
              ref={createMenuRef}
              className="menu-panel auto-page__create-menu"
              role="menu"
            >
              <button
                type="button"
                className="auto-page__create-item"
                role="menuitem"
                onClick={() => {
                  setCreateMenu(false);
                  onAiCreate();
                }}
              >
                <IconAutomations size={16} />
                <span>
                  <strong>{t("automations.createAi")}</strong>
                  <em>{t("automations.createAiHint")}</em>
                </span>
              </button>
              <button
                type="button"
                className="auto-page__create-item"
                role="menuitem"
                onClick={openCreateManual}
              >
                <IconPlus size={16} />
                <span>
                  <strong>{t("automations.createManual")}</strong>
                  <em>{t("automations.createManualHint")}</em>
                </span>
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="auto-page__toolbar">
        <div className="auto-page__search">
          <IconSearch size={15} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("automations.search")}
            aria-label={t("automations.search")}
          />
        </div>
        <div className="auto-page__filters" role="tablist">
          {(
            [
              ["all", "automations.filter.all"],
              ["enabled", "automations.filter.enabled"],
              ["paused", "automations.filter.paused"],
            ] as const
          ).map(([id, key]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={filter === id}
              className={
                "auto-page__filter" + (filter === id ? " is-active" : "")
              }
              onClick={() => setFilter(id)}
            >
              {t(key)}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="auto-page__error" role="alert">
          {error}
          <button type="button" onClick={() => setError(null)}>
            <IconClose size={14} />
          </button>
        </div>
      )}

      <div className="auto-page__body">
        {loading ? (
          <div className="auto-page__empty">{t("automations.loading")}</div>
        ) : filtered.length === 0 ? (
          <div className="auto-page__empty">
            <IconScheduled size={28} />
            <strong>{t("automations.emptyTitle")}</strong>
            <span>{t("automations.emptyHint")}</span>
            <div className="auto-page__empty-actions">
              <button
                type="button"
                className="btn btn--solid"
                onClick={onAiCreate}
              >
                {t("automations.createAi")}
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={openCreateManual}
              >
                {t("automations.createManual")}
              </button>
            </div>
          </div>
        ) : (
          <ul className="auto-list">
            {filtered.map((auto) => {
              const next =
                auto.nextRunAt ||
                (auto.enabled ? computeNextRunAt(auto) : null);
              const projectName = auto.projectId
                ? projects.find((p) => p.id === auto.projectId)?.name
                : null;
              return (
                <li
                  key={auto.id}
                  className={
                    "auto-row" +
                    (!auto.enabled ? " auto-row--paused" : "") +
                    (rowMenuId === auto.id ? " auto-row--menu-open" : "")
                  }
                >
                  <span
                    className={
                      "auto-row__dot" +
                      (auto.enabled ? " is-on" : " is-off")
                    }
                    aria-hidden
                  />
                  <button
                    type="button"
                    className="auto-row__main"
                    onClick={() => openEdit(auto)}
                  >
                    <span className="auto-row__title">{auto.title}</span>
                    <span className="auto-row__meta">
                      {formatScheduleSummary(auto, scheduleLabels)}
                      {" · "}
                      {auto.enabled
                        ? formatNextRunRelative(next, new Date(), relativeLabels)
                        : t("automations.filter.paused")}
                      {projectName ? ` · ${projectName}` : ""}
                    </span>
                  </button>
                  <div className="auto-row__actions">
                    <Tip label={t("automations.menu")}>
                      <button
                        type="button"
                        className="tree-icon-btn"
                        data-auto-row-trigger={auto.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          setRowMenuId((id) =>
                            id === auto.id ? null : auto.id,
                          );
                        }}
                      >
                        <IconMore size={15} />
                      </button>
                    </Tip>
                    {rowMenuId === auto.id && (
                      <div
                        className="menu-panel auto-row__menu"
                        role="menu"
                        data-auto-row-menu={auto.id}
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => openEdit(auto)}
                        >
                          {t("automations.edit")}
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setRowMenuId(null);
                            void toggleEnabled(auto);
                          }}
                        >
                          {auto.enabled
                            ? t("automations.pause")
                            : t("automations.resume")}
                        </button>
                        {onRunNow && (
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setRowMenuId(null);
                              onRunNow(auto);
                            }}
                          >
                            {t("automations.runNow")}
                          </button>
                        )}
                        <button
                          type="button"
                          role="menuitem"
                          className="is-danger"
                          onClick={() => requestRemove(auto)}
                        >
                          {t("automations.delete")}
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {deleteTarget &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="overlay app-dialog-overlay"
            role="presentation"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget && !deleting) {
                setDeleteTarget(null);
              }
            }}
          >
            <div
              className="modal app-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="auto-delete-title"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <header className="modal-head">
                <h2 id="auto-delete-title" className="modal-title">
                  {t("automations.delete")}
                </h2>
                <button
                  type="button"
                  className="icon-btn modal-close"
                  disabled={deleting}
                  onClick={() => setDeleteTarget(null)}
                  aria-label={t("common.close")}
                >
                  <IconClose size={16} />
                </button>
              </header>
              <form
                className="app-dialog__form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void confirmRemove();
                }}
              >
                <p className="app-dialog__msg">
                  {t("automations.deleteConfirm", {
                    title: deleteTarget.title,
                  })}
                </p>
                <div className="app-dialog__actions modal-actions">
                  <button
                    type="button"
                    className="btn btn--ghost"
                    disabled={deleting}
                    onClick={() => setDeleteTarget(null)}
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    ref={deleteConfirmBtnRef}
                    type="submit"
                    className="btn btn--danger"
                    disabled={deleting}
                  >
                    {t("automations.delete")}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body,
        )}

      {panelOpen && (
        <aside className="auto-panel" aria-label={t("automations.formTitle")}>
          <div className="auto-panel__head">
            <h2>
              {editingId
                ? t("automations.editTitle")
                : t("automations.formTitle")}
            </h2>
            <Tip label={t("common.close")}>
              <button
                type="button"
                className="chrome-btn"
                onClick={closePanel}
              >
                <IconClose size={16} />
              </button>
            </Tip>
          </div>
          <div className="auto-panel__body">
            <label className="auto-field">
              <span>{t("automations.field.title")}</span>
              <input
                type="text"
                value={form.title}
                onChange={(e) =>
                  setForm((f) => ({ ...f, title: e.target.value }))
                }
                placeholder={t("automations.field.titlePh")}
              />
            </label>
            <label className="auto-field">
              <span>{t("automations.field.prompt")}</span>
              <textarea
                rows={5}
                value={form.prompt}
                onChange={(e) =>
                  setForm((f) => ({ ...f, prompt: e.target.value }))
                }
                placeholder={t("automations.field.promptPh")}
              />
            </label>

            <div className="auto-panel__section">
              <div className="auto-panel__section-label">
                {t("automations.section.details")}
              </div>
              <div className="auto-field auto-field--row">
                <span>{t("automations.field.project")}</span>
                <Select
                  value={form.projectId}
                  options={projectOptions}
                  onChange={(v) => setForm((f) => ({ ...f, projectId: v }))}
                  aria-label={t("automations.field.project")}
                />
              </div>
              <div className="auto-field auto-field--row">
                <span>{t("automations.field.model")}</span>
                <Select
                  value={form.modelId}
                  options={modelOptions}
                  onChange={(v) => setForm((f) => ({ ...f, modelId: v }))}
                  aria-label={t("automations.field.model")}
                />
              </div>
              <div className="auto-field auto-field--row">
                <span>{t("automations.field.effort")}</span>
                <Select
                  value={form.effort}
                  options={effortOptions}
                  onChange={(v) => setForm((f) => ({ ...f, effort: v }))}
                  aria-label={t("automations.field.effort")}
                />
              </div>
            </div>

            <div className="auto-panel__section">
              <div className="auto-panel__section-label">
                {t("automations.section.schedule")}
              </div>
              <div className="auto-field auto-field--row">
                <span>{t("automations.field.frequency")}</span>
                <Select
                  value={form.frequency}
                  options={freqOptions}
                  onChange={(v) => setForm((f) => ({ ...f, frequency: v }))}
                  aria-label={t("automations.field.frequency")}
                />
              </div>
              <div className="auto-field auto-field--row">
                <span>{t("automations.field.time")}</span>
                <Select
                  value={form.time}
                  options={timeOptions}
                  onChange={(v) => setForm((f) => ({ ...f, time: v }))}
                  aria-label={t("automations.field.time")}
                />
              </div>
              <div className="auto-field auto-field--row">
                <span>{t("automations.field.notify")}</span>
                <Select
                  value={form.notify}
                  options={notifyOptions}
                  onChange={(v) => setForm((f) => ({ ...f, notify: v }))}
                  aria-label={t("automations.field.notify")}
                />
              </div>
            </div>
          </div>
          <div className="auto-panel__foot">
            <button type="button" className="btn btn--ghost" onClick={closePanel}>
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--solid"
              onClick={() => void saveForm()}
            >
              {editingId ? t("automations.save") : t("automations.create")}
            </button>
          </div>
        </aside>
      )}
    </div>
  );
}
