/**
 * Settings → Account → Custom providers.
 * Left list + right detail/form.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MouseEvent,
} from "react";
import * as api from "@/lib/api";
import { createT, type Locale, type MessageKey } from "@/i18n";
import { Select } from "@/components/Select";
import { GlassModal } from "@/components/GlassModal";
import {
  IconCheck,
  IconClose,
  IconEdit,
  IconPlus,
  IconRefresh,
  IconTrash,
} from "@/components/icons";
import {
  PROVIDER_SAVE_TIMEOUT_MS,
  providerMutationNeedsAgentReload,
  slugifyProviderId,
  withProviderSaveTimeout,
} from "@/lib/providerSave";
import {
  buildProviderApplyToastKey,
  classifyProviderPingError,
  classifyProviderSaveError,
  providerPingErrorMessageKey,
  providerSaveErrorMessageKey,
  resolveProviderApplyEffect,
  resolveProvidersEmptyState,
} from "@/lib/providerRouteHonesty";
import {
  PROVIDER_PRESETS,
  defaultCustomChannelEfforts,
  resolveProviderApiKeyUrl,
  resolveProviderBrandId,
  type ProviderPreset,
} from "@/lib/providerPresets";
import {
  ProviderBrandIcon,
  providerAvatarLetter,
} from "@/components/ProviderBrandIcon";

export interface ProvidersPanelProps {
  locale: Locale;
  /** Official OAuth / CLI auth / official API key present. */
  officialAvailable?: boolean;
  /**
   * Provider list mutated (create / update / delete / import).
   * Parent should refresh composer model groups — lightweight, no route recycle toast.
   */
  onProvidersChanged?: () => void;
  /** Called after switching official/custom so host can reconnect Grok Build. */
  onProviderActivated?: () => void;
  /** Ephemeral feedback (e.g. fetch models result). */
  onToast?: (msg: string, ms?: number) => void;
}

type FormModel = {
  /** Upstream request body model id. */
  id: string;
  /** Display name shown on composer chip / menu. */
  name: string;
};

type FormEffort = {
  id: string;
  name: string;
  isDefault: boolean;
};

type FormState = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  apiBackend: string;
  models: FormModel[];
  efforts: FormEffort[];
  /** External signup URL for “Get API Key” (from preset). */
  apiKeyUrl: string | null;
};

type RightMode = "empty" | "pick" | "create" | "edit" | "official";
type Selection = null | "official" | string;

const emptyForm = (): FormState => ({
  id: "",
  name: "",
  baseUrl: "",
  apiKey: "",
  apiBackend: "responses",
  models: [],
  efforts: defaultCustomChannelEfforts().map((e) => ({
    id: e.id,
    name: e.name || e.id,
    isDefault: !!e.isDefault,
  })),
  apiKeyUrl: null,
});

function modelsFromProvider(p: api.CustomProvider): FormModel[] {
  if (p.models?.length) {
    return p.models.map((m) => ({
      id: m.id,
      name: m.name?.trim() || m.id,
    }));
  }
  const id = p.model?.trim() ?? "";
  if (!id) return [];
  return [{ id, name: id }];
}

function effortsFromProvider(p: api.CustomProvider): FormEffort[] {
  if (p.efforts?.length) {
    return p.efforts.map((e) => ({
      id: e.id,
      name: e.name?.trim() || e.id,
      isDefault: !!e.isDefault,
    }));
  }
  return defaultCustomChannelEfforts().map((e) => ({
    id: e.id,
    name: e.name || e.id,
    isDefault: !!e.isDefault,
  }));
}

function formFromPreset(preset: ProviderPreset): FormState {
  return {
    id: preset.suggestedId,
    name: preset.name,
    baseUrl: preset.baseUrl,
    apiKey: "",
    apiBackend: preset.apiBackend,
    models: preset.models.map((m) => ({
      id: m.id,
      name: m.name || m.id,
    })),
    efforts: preset.efforts.map((e) => ({
      id: e.id,
      name: e.name || e.id,
      isDefault: !!e.isDefault,
    })),
    apiKeyUrl: preset.apiKeyUrl ?? null,
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

function ccSwitchStatusKey(status: string): MessageKey {
  switch (status) {
    case "importable":
      return "prov.ccSwitch.status.importable";
    case "official":
      return "prov.ccSwitch.status.official";
    case "missing_key":
      return "prov.ccSwitch.status.missing_key";
    case "proxy_managed":
      return "prov.ccSwitch.status.proxy_managed";
    case "exists":
      return "prov.ccSwitch.status.exists";
    case "invalid":
    default:
      return "prov.ccSwitch.status.invalid";
  }
}

export function ProvidersPanel({
  locale,
  officialAvailable = false,
  onProvidersChanged,
  onProviderActivated,
  onToast,
}: ProvidersPanelProps) {
  const tr = useMemo(() => createT(locale), [locale]);
  const [list, setList] = useState<api.ProvidersListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [rightMode, setRightMode] = useState<RightMode>("empty");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [remoteModels, setRemoteModels] = useState<string[]>([]);
  /** Busy flag for fetch-models only (disables button while in flight). */
  const [fetchingModels, setFetchingModels] = useState(false);
  /** Draft row for manually adding a model. */
  const [draftModelId, setDraftModelId] = useState("");
  const [draftModelName, setDraftModelName] = useState("");
  /** Draft row for adding a reasoning effort. */
  const [draftEffortId, setDraftEffortId] = useState("");
  const [draftEffortName, setDraftEffortName] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [hintTone, setHintTone] = useState<"ok" | "err" | "muted">("muted");
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  /** Official xAI API key (for speech / STT when not using OAuth). */
  const [hasOfficialKey, setHasOfficialKey] = useState(false);
  const [officialKeyDraft, setOfficialKeyDraft] = useState("");
  const [showOfficialKey, setShowOfficialKey] = useState(false);
  const [officialKeyBusy, setOfficialKeyBusy] = useState(false);

  /** CC Switch import dialog */
  const [ccImportOpen, setCcImportOpen] = useState(false);
  const [ccScan, setCcScan] = useState<api.CcSwitchScanResult | null>(null);
  const [ccScanBusy, setCcScanBusy] = useState(false);
  const [ccImportBusy, setCcImportBusy] = useState(false);
  const [ccSelected, setCcSelected] = useState<Set<string>>(new Set());
  const [ccImportMsg, setCcImportMsg] = useState<string | null>(null);

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

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!api.isTauri()) {
        setList({
          providers: [],
          defaultModel: null,
          activeSource: "official",
          activeProviderId: null,
          configPath: "",
          agentHome: "",
        });
        setHasOfficialKey(false);
        return;
      }
      const [r, masked] = await Promise.all([
        api.providersList(),
        api.secretsGetMasked().catch(() => null),
      ]);
      setList(r);
      setHasOfficialKey(!!masked?.hasOfficialKey);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const providers = list?.providers ?? [];
  const activeSource = list?.activeSource ?? "official";
  const activeProviderId = list?.activeProviderId ?? null;
  const officialActive = activeSource === "official";
  /** Show official row even without OAuth so users can paste an API key for speech. */
  const showOfficialRow = true;

  /** Open preset gallery (or skip to blank form when no presets). */
  const openCreate = () => {
    setSelection(null);
    setEditingId(null);
    setForm(emptyForm());
    setDraftModelId("");
    setDraftModelName("");
    setDraftEffortId("");
    setDraftEffortName("");
    setRemoteModels([]);
    setHint(null);
    setShowKey(false);
    setRightMode(PROVIDER_PRESETS.length > 0 ? "pick" : "create");
  };

  const openCustomCreate = () => {
    setSelection(null);
    setEditingId(null);
    setForm(emptyForm());
    setDraftModelId("");
    setDraftModelName("");
    setDraftEffortId("");
    setDraftEffortName("");
    setRemoteModels([]);
    setHint(null);
    setShowKey(false);
    setRightMode("create");
  };

  const openPresetCreate = (preset: ProviderPreset) => {
    setSelection(null);
    setEditingId(null);
    setForm(formFromPreset(preset));
    setDraftModelId("");
    setDraftModelName("");
    setDraftEffortId("");
    setDraftEffortName("");
    setRemoteModels([]);
    setHint(null);
    setShowKey(false);
    setRightMode("create");
  };

  const openCcImport = () => {
    setCcImportOpen(true);
    setCcImportMsg(null);
    setCcScan(null);
    setCcSelected(new Set());
    void runCcScan();
  };

  const runCcScan = async () => {
    if (!api.isTauri()) {
      setCcScan({
        status: "not_found",
        triedPaths: [],
        items: [],
        error: tr("prov.ccSwitch.needTauri"),
      });
      return;
    }
    setCcScanBusy(true);
    setCcImportMsg(null);
    try {
      const r = await api.providersCcSwitchScan();
      setCcScan(r);
      if (r.status === "ok") {
        const next = new Set<string>();
        for (const it of r.items) {
          // Default conflict = overwrite, so existing ids are selectable too.
          if (it.status === "importable" || it.status === "exists") {
            next.add(it.sourceId);
          }
        }
        setCcSelected(next);
      } else {
        setCcSelected(new Set());
      }
    } catch (e) {
      setCcScan({
        status: "error",
        triedPaths: [],
        items: [],
        error: String(e),
      });
    } finally {
      setCcScanBusy(false);
    }
  };

  const toggleCcItem = (sourceId: string, selectable: boolean) => {
    if (!selectable) return;
    setCcSelected((prev) => {
      const n = new Set(prev);
      if (n.has(sourceId)) n.delete(sourceId);
      else n.add(sourceId);
      return n;
    });
  };

  const runCcImport = async () => {
    if (!api.isTauri() || ccSelected.size === 0) return;
    setCcImportBusy(true);
    setCcImportMsg(null);
    try {
      // Always overwrite same id; never auto-activate route after import.
      const r = await api.providersCcSwitchImport({
        sourceIds: Array.from(ccSelected),
        onConflict: "overwrite",
        activateId: null,
      });
      if (r.providers) setList(r.providers);
      const failN = r.failed?.length ?? 0;
      if (r.imported > 0) {
        await reload();
        onProvidersChanged?.();
      }
      // Success with at least one imported → close dialog (toast-style summary optional).
      if (r.imported > 0 && failN === 0) {
        setCcImportOpen(false);
        setCcImportMsg(null);
        setHint(
          tr("prov.ccSwitch.importDone", {
            n: String(r.imported),
            skipped: String(r.skipped),
            failed: String(failN),
          }),
        );
        setHintTone("ok");
      } else {
        setCcImportMsg(
          tr("prov.ccSwitch.importDone", {
            n: String(r.imported),
            skipped: String(r.skipped),
            failed: String(failN),
          }),
        );
      }
    } catch (e) {
      setCcImportMsg(String(e));
    } finally {
      setCcImportBusy(false);
    }
  };

  const openOfficial = () => {
    setSelection("official");
    setEditingId(null);
    setRightMode("official");
    setHint(null);
    setOfficialKeyDraft("");
    setShowOfficialKey(false);
  };

  const saveOfficialKey = async () => {
    const key = officialKeyDraft.trim();
    if (!key || !api.isTauri()) return;
    setOfficialKeyBusy(true);
    setHint(null);
    try {
      await api.secretsSet({ officialApiKey: key });
      setOfficialKeyDraft("");
      setShowOfficialKey(false);
      setHasOfficialKey(true);
      setHint(tr("prov.officialKeySaved"));
      setHintTone("ok");
      onProviderActivated?.();
    } catch (e) {
      setHint(String(e));
      setHintTone("err");
    } finally {
      setOfficialKeyBusy(false);
    }
  };

  const clearOfficialKey = async () => {
    if (!api.isTauri() || !hasOfficialKey) return;
    setOfficialKeyBusy(true);
    setHint(null);
    try {
      await api.secretsSet({ officialApiKey: "" });
      setHasOfficialKey(false);
      setOfficialKeyDraft("");
      setHint(tr("prov.officialKeyCleared"));
      setHintTone("muted");
      onProviderActivated?.();
    } catch (e) {
      setHint(String(e));
      setHintTone("err");
    } finally {
      setOfficialKeyBusy(false);
    }
  };

  const openEdit = (p: api.CustomProvider) => {
    setSelection(p.id);
    setEditingId(p.id);
    setForm({
      id: p.id,
      name: p.name,
      baseUrl: p.baseUrl,
      apiKey: "",
      apiBackend: p.apiBackend || "responses",
      models: modelsFromProvider(p),
      efforts: effortsFromProvider(p),
      apiKeyUrl: resolveProviderApiKeyUrl({
        providerId: p.id,
        baseUrl: p.baseUrl,
      }),
    });
    setDraftModelId("");
    setDraftModelName("");
    setDraftEffortId("");
    setDraftEffortName("");
    setRemoteModels([]);
    setHint(null);
    setShowKey(false);
    setRightMode("edit");
  };

  const closeRight = () => {
    setRightMode("empty");
    setSelection(null);
    setEditingId(null);
    setHint(null);
    setRemoteModels([]);
    setDraftModelId("");
    setDraftModelName("");
    setDraftEffortId("");
    setDraftEffortName("");
  };

  const addModelToForm = (modelId: string, displayName?: string) => {
    const id = modelId.trim();
    if (!id) return;
    const name = (displayName ?? draftModelName).trim() || id;
    setForm((f) => {
      if (f.models.some((m) => m.id === id)) return f;
      return { ...f, models: [...f.models, { id, name }] };
    });
    setDraftModelId("");
    setDraftModelName("");
  };

  const save = async () => {
    if (!form.baseUrl.trim()) {
      setHint(tr("prov.err.needBase"));
      setHintTone("err");
      return;
    }
    if (!editingId && !form.apiKey.trim()) {
      setHint(tr("prov.err.needKey"));
      setHintTone("err");
      return;
    }
    const models = form.models
      .map((m) => ({
        id: m.id.trim(),
        name: m.name.trim() || m.id.trim(),
      }))
      .filter((m) => m.id);
    if (models.length === 0) {
      setHint(tr("prov.err.needModel"));
      setHintTone("err");
      return;
    }
    let efforts = form.efforts
      .map((e) => ({
        id: e.id.trim(),
        name: e.name.trim() || e.id.trim(),
        isDefault: !!e.isDefault,
      }))
      .filter((e) => e.id);
    if (efforts.length === 0) {
      efforts = defaultCustomChannelEfforts().map((e) => ({
        id: e.id,
        name: e.name || e.id,
        isDefault: !!e.isDefault,
      }));
    } else if (!efforts.some((e) => e.isDefault)) {
      efforts = efforts.map((e, i) => ({ ...e, isDefault: i === 0 }));
    }
    setBusy(true);
    setHint(tr("prov.saving"));
    setHintTone("muted");
    const isCreate = rightMode === "create" || !editingId;
    const id =
      editingId ??
      (slugifyProviderId(form.id || form.name || form.baseUrl) ||
        `provider-${Date.now().toString(36)}`);
    // Create flow: always use the form catalog (first model). Never reuse a
    // ghost list entry's active model after delete+re-add with the same id.
    const existing = list?.providers.find((p) => p.id === id);
    const preferred =
      !isCreate &&
      existing?.model &&
      models.some((m) => m.id === existing.model)
        ? existing.model
        : models[0].id;
    const payload = {
      id,
      model: preferred,
      baseUrl: form.baseUrl.trim(),
      name: form.name.trim() || id,
      apiKey: form.apiKey.trim() || undefined,
      apiBackend: form.apiBackend,
      setAsDefault: false as boolean,
      models,
      efforts,
    };
    try {
      // Wall-clock budget so a hung host IPC cannot leave the UI on “Saving…”.
      // Disk write may still complete after a timeout (user can re-open panel).
      // Do not auto-set default — user activates via Use / composer pick.
      //
      // Create: try createOnly first so we never silently merge a ghost section.
      // If the same id still exists (failed/missed delete, or re-add preset),
      // overwrite with the form payload so the new preset wins.
      let r: api.ProvidersListResult;
      let replacedExisting = false;
      try {
        r = await withProviderSaveTimeout(
          api.providersUpsert({
            ...payload,
            createOnly: isCreate,
          }),
          PROVIDER_SAVE_TIMEOUT_MS,
          tr("prov.err.saveTimeout"),
        );
      } catch (e) {
        const msg = String(e);
        const alreadyExists =
          isCreate && /already exists/i.test(msg);
        if (!alreadyExists) throw e;
        if (!form.apiKey.trim()) {
          setHint(tr("prov.err.recreateNeedKey"));
          setHintTone("err");
          setBusy(false);
          return;
        }
        r = await withProviderSaveTimeout(
          api.providersUpsert({
            ...payload,
            createOnly: false,
            // Force-write key so we do not keep a deleted provider's secret.
            apiKey: form.apiKey.trim(),
          }),
          PROVIDER_SAVE_TIMEOUT_MS,
          tr("prov.err.saveTimeout"),
        );
        replacedExisting = true;
      }
      setList(r);
      const saved = r.providers.find((p) => p.id === id);
      if (saved) {
        openEdit(saved);
      } else {
        setRightMode("empty");
        setSelection(null);
      }
      // Always refresh composer model groups (list may have new models/names).
      onProvidersChanged?.();
      const needsReload = providerMutationNeedsAgentReload({
        setAsDefault: false,
        providerId: id,
        activeSource: r.activeSource,
        activeProviderId: r.activeProviderId,
      });
      // Apply-path honesty: soft_respawn | saved_disk_only | host_only.
      const effect = resolveProviderApplyEffect({
        needsReload,
        isTauri: api.isTauri(),
      });
      const toastKey = buildProviderApplyToastKey(effect) as MessageKey;
      if (effect === "soft_respawn") {
        setHint(tr(toastKey));
        setHintTone("ok");
        onToast?.(tr(toastKey), 3200);
        try {
          // Fire-and-forget UI refresh; host already recycled agents on upsert.
          onProviderActivated?.();
        } catch (e) {
          // Soft-fail: config is on disk; next message / restart still works.
          setHint(tr("prov.savedApplyFailed", { detail: String(e) }));
          setHintTone("err");
          onToast?.(
            tr("prov.savedApplyFailed", { detail: String(e) }),
            4800,
          );
        }
      } else if (replacedExisting && effect === "saved_disk_only") {
        setHint(tr("prov.savedReplaced"));
        setHintTone("ok");
        onToast?.(tr("prov.savedReplaced"), 3200);
      } else {
        setHint(tr(toastKey));
        setHintTone(effect === "host_only" ? "err" : "ok");
        onToast?.(tr(toastKey), effect === "host_only" ? 4000 : 2800);
      }
    } catch (e) {
      // Classified soft-fail — never invent success or leave raw Error dumps only.
      const kind = classifyProviderSaveError(e);
      const key = providerSaveErrorMessageKey(kind) as MessageKey;
      // Prefer classified copy for known kinds; keep detail for generic other.
      const msg =
        kind === "other"
          ? tr("prov.err.other", { detail: String(e) })
          : kind === "timeout"
            ? tr("prov.err.saveTimeout")
            : tr(key);
      setHint(msg);
      setHintTone("err");
      onToast?.(msg, 4000);
    } finally {
      // Always leave “Saving…” — never leave busy latched on hung apply.
      setBusy(false);
    }
  };

  const confirmRemove = async () => {
    if (!deleteTarget) return;
    const { id } = deleteTarget;
    const wasActive =
      activeSource === "custom" && activeProviderId === id;
    setBusy(true);
    setDeleteTarget(null);
    try {
      const r = await api.providersRemove(id);
      setList(r);
      if (editingId === id || selection === id) {
        closeRight();
      }
      onProvidersChanged?.();
      // Deleting the live route falls back to official — recycle chrome like activate.
      if (wasActive) {
        onProviderActivated?.();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const activateOfficial = async (e?: MouseEvent) => {
    e?.stopPropagation();
    setBusy(true);
    try {
      const r = await api.providersActivate("official");
      setList(r);
      onProviderActivated?.();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const activateCustom = async (id: string, e?: MouseEvent) => {
    e?.stopPropagation();
    setBusy(true);
    try {
      const r = await api.providersActivate("custom", id);
      setList(r);
      onProviderActivated?.();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const fetchModels = async () => {
    if (!form.baseUrl.trim()) {
      onToast?.(tr("prov.err.needBase"), 3200);
      return;
    }
    if (!api.isTauri()) {
      const key = providerPingErrorMessageKey("host_only") as MessageKey;
      onToast?.(tr(key), 4000);
      return;
    }
    setFetchingModels(true);
    try {
      const r = await api.providersListModels({
        baseUrl: form.baseUrl.trim(),
        apiKey: form.apiKey.trim() || undefined,
        providerId: editingId ?? undefined,
      });
      setRemoteModels(r.models.map((m) => m.id));
      if (r.models.length) {
        onToast?.(tr("prov.loaded", { n: r.models.length }), 2800);
      } else {
        onToast?.(tr("prov.emptyList"), 2800);
      }
    } catch (e) {
      // Soft-fail: classify ping / list-models errors (never invent reachability).
      const kind = classifyProviderPingError(e);
      const key = providerPingErrorMessageKey(kind) as MessageKey;
      const msg =
        kind === "other"
          ? tr("prov.ping.err.other", { detail: String(e) })
          : tr(key);
      onToast?.(msg, 4000);
    } finally {
      setFetchingModels(false);
    }
  };

  if (loading) {
    return (
      <div className="prov-panel" data-testid="providers-panel">
        <div className="prov-loading">{tr("prov.loading")}</div>
      </div>
    );
  }

  const emptyState = resolveProvidersEmptyState({
    isTauri: api.isTauri(),
    customCount: providers.length,
    loadError: error,
  });
  const listEmpty =
    emptyState.kind === "no_custom" &&
    !showOfficialRow &&
    providers.length === 0;

  return (
    <div className="prov-panel" data-testid="providers-panel">
      {error && (
        <div className="prov-alert" role="alert">
          <span>{error}</span>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setError(null)}
          >
            {tr("common.dismiss")}
          </button>
        </div>
      )}

      {emptyState.kind === "host_only" && emptyState.messageKey ? (
        <div
          className="prov-alert"
          role="status"
          data-testid="prov-empty-host-only"
        >
          <span>{tr(emptyState.messageKey as MessageKey)}</span>
        </div>
      ) : null}

      <div className="prov-split">
        {/* ── Left: list ───────────────────────────────────────────── */}
        <aside className="prov-split__list">
          <div className="prov-list-actions">
            <button
              type="button"
              className="btn btn--solid prov-add-btn"
              onClick={openCreate}
              disabled={busy}
            >
              <IconPlus size={16} />
              {tr("prov.new")}
            </button>
            <button
              type="button"
              className="btn btn--ghost prov-cc-import-btn"
              onClick={openCcImport}
              disabled={busy || !api.isTauri()}
              data-testid="prov-cc-switch-import"
              title={tr("prov.ccSwitch.importBtnHint")}
            >
              {tr("prov.ccSwitch.importBtn")}
            </button>
          </div>

          <div className="prov-rail" role="list">
            {showOfficialRow && (
              <div
                role="listitem"
                className={
                  "prov-item" +
                  (selection === "official" ? " is-selected" : "") +
                  (officialActive ? " is-active" : "")
                }
              >
                <button
                  type="button"
                  className="prov-item__main"
                  onClick={openOfficial}
                >
                  <span className="prov-item__avatar" aria-hidden>
                    G
                  </span>
                  <span className="prov-item__text">
                    <span className="prov-item__name">
                      {tr("prov.officialName")}
                    </span>
                    {(hasOfficialKey || officialAvailable) && (
                      <span className="prov-item__sub">
                        {officialAvailable
                          ? tr("prov.officialAuthOk")
                          : tr("prov.officialKeyOnly")}
                      </span>
                    )}
                  </span>
                </button>
                {officialAvailable ? (
                  !officialActive ? (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm prov-item__use"
                      disabled={busy}
                      onClick={(e) => void activateOfficial(e)}
                    >
                      {tr("prov.useThis")}
                    </button>
                  ) : (
                    <span
                      className="prov-item__using"
                      title={tr("prov.active")}
                      aria-label={tr("prov.active")}
                    >
                      <IconCheck size={14} />
                    </span>
                  )
                ) : null}
              </div>
            )}

            {providers.map((p) => {
              const active =
                activeSource === "custom" && activeProviderId === p.id;
              const selected = selection === p.id;
              const brandId = resolveProviderBrandId({
                providerId: p.id,
                baseUrl: p.baseUrl,
              });
              return (
                <div
                  key={p.id}
                  role="listitem"
                  className={
                    "prov-item" +
                    (selected ? " is-selected" : "") +
                    (active ? " is-active" : "")
                  }
                >
                  <button
                    type="button"
                    className="prov-item__main"
                    onClick={() => openEdit(p)}
                  >
                    <span
                      className={
                        "prov-item__avatar" +
                        (brandId ? " prov-item__avatar--logo" : "")
                      }
                      aria-hidden
                    >
                      {brandId ? (
                        <ProviderBrandIcon brand={brandId} size={18} />
                      ) : (
                        providerAvatarLetter(p.name || p.id)
                      )}
                    </span>
                    <span className="prov-item__text">
                      <span className="prov-item__name">{p.name || p.id}</span>
                      <span className="prov-item__sub">
                        {hostOf(p.baseUrl)}
                        {p.model ? ` · ${p.model}` : ""}
                      </span>
                    </span>
                  </button>
                  {!active ? (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm prov-item__use"
                      disabled={busy}
                      onClick={(e) => void activateCustom(p.id, e)}
                    >
                      {tr("prov.useThis")}
                    </button>
                  ) : (
                    <span
                      className="prov-item__using"
                      title={tr("prov.active")}
                      aria-label={tr("prov.active")}
                    >
                      <IconCheck size={14} />
                    </span>
                  )}
                </div>
              );
            })}

            {listEmpty && (
              <div className="prov-rail-empty">{tr("prov.emptyTitle")}</div>
            )}
            {emptyState.kind === "no_custom" &&
            emptyState.messageKey &&
            showOfficialRow ? (
              <div
                className="prov-rail-empty"
                data-testid="prov-empty-no-custom"
              >
                {tr(emptyState.messageKey as MessageKey)}
              </div>
            ) : null}
          </div>
        </aside>

        {/* ── Right: detail / form ─────────────────────────────────── */}
        <section className="prov-split__detail">
          {rightMode === "empty" && (
            <div className="prov-detail-empty">
              <p>{tr("prov.detailEmpty")}</p>
            </div>
          )}

          {rightMode === "pick" && (
            <div className="prov-detail settings-card prov-form">
              <div className="prov-form__head">
                <h3 className="prov-detail__title">{tr("prov.presetsTitle")}</h3>
                <button
                  type="button"
                  className="chrome-btn"
                  onClick={closeRight}
                  aria-label={tr("common.close")}
                >
                  <IconClose size={16} />
                </button>
              </div>
              <p className="prov-field__hint">{tr("prov.presetsHint")}</p>
              <div className="prov-presets" role="list">
                <button
                  type="button"
                  className="prov-presets__chip prov-presets__chip--custom"
                  role="listitem"
                  onClick={openCustomCreate}
                >
                  <IconPlus size={16} />
                  <span>{tr("prov.presetCustom")}</span>
                </button>
                {PROVIDER_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className="prov-presets__chip"
                    role="listitem"
                    onClick={() => openPresetCreate(preset)}
                    title={
                      preset.blurbKey
                        ? tr(preset.blurbKey as MessageKey)
                        : preset.name
                    }
                  >
                    <span
                      className={
                        "prov-presets__avatar" +
                        (preset.brandId ? " prov-presets__avatar--logo" : "")
                      }
                      aria-hidden
                    >
                      {preset.brandId ? (
                        <ProviderBrandIcon brand={preset.brandId} size={16} />
                      ) : (
                        providerAvatarLetter(preset.name)
                      )}
                    </span>
                    <span className="prov-presets__name">{preset.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {rightMode === "official" && (
            <div className="prov-detail settings-card">
              <div className="prov-detail__head">
                <div>
                  <h3 className="prov-detail__title">
                    {tr("prov.officialName")}
                  </h3>
                  <p className="prov-detail__sub">
                    {tr("prov.officialDesc")}
                  </p>
                </div>
                {officialAvailable ? (
                  officialActive ? (
                    <span className="account-badge account-badge--ok">
                      {tr("prov.active")}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="btn btn--solid"
                      disabled={busy}
                      onClick={() => void activateOfficial()}
                    >
                      {tr("prov.useThis")}
                    </button>
                  )
                ) : null}
              </div>
              <p className="prov-detail__sub" id="settings-anchor-official-key">
                {tr("prov.officialVoiceHint")}
              </p>
              <label className="prov-field">
                <span className="prov-field__label">
                  {tr("prov.officialApiKey")}
                </span>
                <div className="prov-key-row">
                  <input
                    className="settings-input"
                    type={showOfficialKey ? "text" : "password"}
                    value={officialKeyDraft}
                    onChange={(e) => setOfficialKeyDraft(e.target.value)}
                    placeholder={
                      hasOfficialKey
                        ? tr("prov.keyKeep")
                        : tr("prov.officialKeyPh")
                    }
                    autoComplete="off"
                    spellCheck={false}
                    disabled={officialKeyBusy}
                  />
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => setShowOfficialKey((v) => !v)}
                  >
                    {showOfficialKey ? tr("prov.keyHide") : tr("prov.keyShow")}
                  </button>
                </div>
              </label>
              <div className="prov-form__actions">
                <button
                  type="button"
                  className="btn btn--solid"
                  disabled={
                    officialKeyBusy || !officialKeyDraft.trim() || !api.isTauri()
                  }
                  onClick={() => void saveOfficialKey()}
                >
                  {officialKeyBusy
                    ? tr("prov.saving")
                    : tr("prov.officialKeySave")}
                </button>
                {hasOfficialKey ? (
                  <button
                    type="button"
                    className="btn btn--ghost"
                    disabled={officialKeyBusy}
                    onClick={() => void clearOfficialKey()}
                  >
                    {tr("prov.officialKeyClear")}
                  </button>
                ) : null}
              </div>
              {hasOfficialKey ? (
                <p className="prov-detail__sub">{tr("prov.officialKeyPresent")}</p>
              ) : null}
              {!officialAvailable ? (
                <p className="prov-detail__sub">{tr("prov.officialLoginHint")}</p>
              ) : null}
              {hint && rightMode === "official" ? (
                <p
                  className={
                    "prov-hint" +
                    (hintTone === "ok"
                      ? " prov-hint--ok"
                      : hintTone === "err"
                        ? " prov-hint--err"
                        : "")
                  }
                  role="status"
                >
                  {hint}
                </p>
              ) : null}
            </div>
          )}

          {(rightMode === "create" || rightMode === "edit") && (
            <div
              className="prov-detail settings-card prov-form"
              data-testid="provider-form"
            >
              <div className="prov-form__head">
                <h3 className="prov-detail__title">
                  {editingId ? tr("prov.editTitle") : tr("prov.addTitle")}
                </h3>
                <button
                  type="button"
                  className="chrome-btn"
                  onClick={closeRight}
                  aria-label={tr("common.close")}
                >
                  <IconClose size={16} />
                </button>
              </div>

              <div className="prov-form__grid">
                {/* Row: display name | config id */}
                <label className="prov-field">
                  <span className="prov-field__label">{tr("prov.name")}</span>
                  <input
                    className="settings-input"
                    value={form.name}
                    onChange={(e) => {
                      const name = e.target.value;
                      setForm((f) => ({
                        ...f,
                        name,
                        id: editingId ? f.id : slugifyProviderId(name) || f.id,
                      }));
                    }}
                    placeholder={tr("prov.namePh")}
                    autoComplete="off"
                  />
                  <span className="prov-field__hint">{tr("prov.nameChipHint")}</span>
                </label>

                <label className="prov-field">
                  <span className="prov-field__label">
                    {tr("prov.displayName")}
                  </span>
                  <input
                    className="settings-input"
                    value={form.id}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        id: slugifyProviderId(e.target.value),
                      }))
                    }
                    placeholder={tr("prov.idPh")}
                    autoComplete="off"
                    spellCheck={false}
                    disabled={!!editingId}
                    readOnly={!!editingId}
                  />
                </label>

                {/* Base URL full — typically long */}
                <label className="prov-field prov-field--full">
                  <span className="prov-field__label">{tr("prov.baseUrl")}</span>
                  <input
                    className="settings-input"
                    value={form.baseUrl}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, baseUrl: e.target.value }))
                    }
                    placeholder={tr("prov.baseUrlPh")}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>

                {/* Row: protocol | API key — equal grid columns */}
                <div className="prov-field">
                  <span className="prov-field__label">{tr("prov.protocol")}</span>
                  <Select
                    value={form.apiBackend}
                    onChange={(v) =>
                      setForm((f) => ({ ...f, apiBackend: v }))
                    }
                    options={protocolOptions}
                    aria-label={tr("prov.protocol")}
                    className="prov-field__select"
                  />
                </div>

                <div className="prov-field">
                  <span className="prov-field__label-row">
                    <span className="prov-field__label">{tr("prov.apiKey")}</span>
                    {form.apiKeyUrl ? (
                      <button
                        type="button"
                        className="prov-field__text-link"
                        onClick={() => {
                          const url = form.apiKeyUrl;
                          if (!url) return;
                          void api.openExternalUrl(url).catch((e) => {
                            onToast?.(String(e), 4000);
                          });
                        }}
                      >
                        {tr("prov.getApiKey")}
                      </button>
                    ) : null}
                  </span>
                  <div className="prov-key-row">
                    <input
                      className="settings-input"
                      type={showKey ? "text" : "password"}
                      value={form.apiKey}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, apiKey: e.target.value }))
                      }
                      placeholder={
                        editingId ? tr("prov.keyKeep") : tr("prov.keyPh")
                      }
                      autoComplete="new-password"
                      spellCheck={false}
                    />
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => setShowKey((v) => !v)}
                    >
                      {showKey ? tr("prov.keyHide") : tr("prov.keyShow")}
                    </button>
                  </div>
                </div>

                {/* Models — full-width section, 2 equal columns inside */}
                <div className="prov-field prov-field--full prov-section">
                  <span className="prov-field__label-row">
                    <span className="prov-field__label">
                      {tr("prov.requestModel")}
                    </span>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => void fetchModels()}
                      disabled={busy || fetchingModels}
                    >
                      <IconRefresh size={14} />
                      {fetchingModels
                        ? tr("prov.fetching")
                        : tr("prov.fetchModels")}
                    </button>
                  </span>
                  <p className="prov-field__hint">{tr("prov.modelsHint")}</p>

                  {remoteModels.length > 0 ? (
                    <div className="prov-models__remote">
                      <div className="prov-models__remote-label">
                        {tr("prov.remoteModels")}
                      </div>
                      <div className="prov-models__chips">
                        {remoteModels.map((mid) => {
                          const added = form.models.some((m) => m.id === mid);
                          return (
                            <button
                              key={mid}
                              type="button"
                              className={
                                "prov-models__chip" +
                                (added ? " is-added" : "")
                              }
                              disabled={busy || added}
                              onClick={() => addModelToForm(mid, mid)}
                              title={mid}
                            >
                              {mid}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  <div
                    className="prov-models"
                    role="group"
                    aria-label={tr("prov.requestModel")}
                  >
                    <div className="prov-models__head" aria-hidden>
                      <span>{tr("prov.modelDisplayName")}</span>
                      <span>{tr("prov.modelId")}</span>
                      <span />
                    </div>

                    {form.models.length === 0 ? (
                      <p className="prov-models__empty">
                        {tr("prov.modelsEmpty")}
                      </p>
                    ) : (
                      form.models.map((m, index) => (
                        <div key={index} className="prov-models__row">
                          <input
                            className="settings-input"
                            value={m.name}
                            onChange={(e) => {
                              const name = e.target.value;
                              setForm((f) => ({
                                ...f,
                                models: f.models.map((row, i) =>
                                  i === index ? { ...row, name } : row,
                                ),
                              }));
                            }}
                            placeholder={tr("prov.modelDisplayNamePh")}
                            aria-label={tr("prov.modelDisplayName")}
                            autoComplete="off"
                          />
                          <input
                            className="settings-input"
                            value={m.id}
                            onChange={(e) => {
                              const next = e.target.value;
                              setForm((f) => ({
                                ...f,
                                models: f.models.map((row, i) =>
                                  i === index
                                    ? {
                                        ...row,
                                        id: next,
                                        name:
                                          !row.name.trim() ||
                                          row.name.trim() === row.id
                                            ? next
                                            : row.name,
                                      }
                                    : row,
                                ),
                              }));
                            }}
                            placeholder={tr("prov.modelPh")}
                            aria-label={tr("prov.modelId")}
                            autoComplete="off"
                            spellCheck={false}
                          />
                          <button
                            type="button"
                            className="icon-btn prov-models__remove"
                            onClick={() =>
                              setForm((f) => ({
                                ...f,
                                models: f.models.filter((_, i) => i !== index),
                              }))
                            }
                            aria-label={tr("prov.removeModel")}
                            disabled={busy}
                          >
                            <IconTrash size={15} />
                          </button>
                        </div>
                      ))
                    )}

                    <div className="prov-models__add-row">
                      <input
                        className="settings-input"
                        value={draftModelName}
                        onChange={(e) => setDraftModelName(e.target.value)}
                        placeholder={tr("prov.modelDisplayNamePh")}
                        aria-label={tr("prov.modelDisplayName")}
                        autoComplete="off"
                      />
                      <input
                        className="settings-input"
                        value={draftModelId}
                        onChange={(e) => {
                          const id = e.target.value;
                          setDraftModelId(id);
                          setDraftModelName((n) =>
                            !n.trim() || n.trim() === draftModelId.trim()
                              ? id
                              : n,
                          );
                        }}
                        placeholder={tr("prov.modelPh")}
                        aria-label={tr("prov.modelId")}
                        autoComplete="off"
                        spellCheck={false}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addModelToForm(draftModelId, draftModelName);
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm prov-models__add-btn"
                        disabled={busy || !draftModelId.trim()}
                        onClick={() =>
                          addModelToForm(draftModelId, draftModelName)
                        }
                      >
                        <IconPlus size={14} />
                        {tr("prov.addModel")}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Efforts — full-width section, 2 equal columns inside */}
                <div className="prov-field prov-field--full prov-section">
                  <span className="prov-field__label-row">
                    <span className="prov-field__label">
                      {tr("prov.efforts")}
                    </span>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={busy}
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          efforts: defaultCustomChannelEfforts().map((e) => ({
                            id: e.id,
                            name: e.name || e.id,
                            isDefault: !!e.isDefault,
                          })),
                        }))
                      }
                    >
                      {tr("prov.effortsResetGrok")}
                    </button>
                  </span>
                  <p className="prov-field__hint">{tr("prov.effortsHint")}</p>
                  <div
                    className="prov-models prov-efforts"
                    role="group"
                    aria-label={tr("prov.efforts")}
                  >
                    <div className="prov-models__head" aria-hidden>
                      <span>{tr("prov.effortDisplayName")}</span>
                      <span>{tr("prov.effortId")}</span>
                      <span />
                    </div>
                    {form.efforts.length === 0 ? (
                      <p className="prov-models__empty">
                        {tr("prov.effortsEmpty")}
                      </p>
                    ) : (
                      form.efforts.map((e, index) => (
                        <div key={index} className="prov-models__row">
                          <input
                            className="settings-input"
                            value={e.name}
                            onChange={(ev) => {
                              const name = ev.target.value;
                              setForm((f) => ({
                                ...f,
                                efforts: f.efforts.map((row, i) =>
                                  i === index ? { ...row, name } : row,
                                ),
                              }));
                            }}
                            placeholder={tr("prov.effortDisplayNamePh")}
                            aria-label={tr("prov.effortDisplayName")}
                            autoComplete="off"
                          />
                          <input
                            className="settings-input"
                            value={e.id}
                            onChange={(ev) => {
                              const next = ev.target.value;
                              setForm((f) => ({
                                ...f,
                                efforts: f.efforts.map((row, i) =>
                                  i === index
                                    ? {
                                        ...row,
                                        id: next,
                                        name:
                                          !row.name.trim() ||
                                          row.name.trim() === row.id
                                            ? next
                                            : row.name,
                                      }
                                    : row,
                                ),
                              }));
                            }}
                            placeholder={tr("prov.effortIdPh")}
                            aria-label={tr("prov.effortId")}
                            autoComplete="off"
                            spellCheck={false}
                          />
                          <button
                            type="button"
                            className="icon-btn prov-models__remove"
                            onClick={() =>
                              setForm((f) => ({
                                ...f,
                                efforts: f.efforts.filter((_, i) => i !== index),
                              }))
                            }
                            aria-label={tr("prov.removeEffort")}
                            disabled={busy}
                          >
                            <IconTrash size={15} />
                          </button>
                        </div>
                      ))
                    )}
                    <div className="prov-models__add-row">
                      <input
                        className="settings-input"
                        value={draftEffortName}
                        onChange={(ev) => setDraftEffortName(ev.target.value)}
                        placeholder={tr("prov.effortDisplayNamePh")}
                        aria-label={tr("prov.effortDisplayName")}
                        autoComplete="off"
                      />
                      <input
                        className="settings-input"
                        value={draftEffortId}
                        onChange={(ev) => {
                          const id = ev.target.value;
                          setDraftEffortId(id);
                          setDraftEffortName((n) =>
                            !n.trim() || n.trim() === draftEffortId.trim()
                              ? id
                              : n,
                          );
                        }}
                        placeholder={tr("prov.effortIdPh")}
                        aria-label={tr("prov.effortId")}
                        autoComplete="off"
                        spellCheck={false}
                        onKeyDown={(ev) => {
                          if (ev.key === "Enter") {
                            ev.preventDefault();
                            const id = draftEffortId.trim();
                            if (!id) return;
                            setForm((f) => {
                              if (f.efforts.some((x) => x.id === id)) return f;
                              return {
                                ...f,
                                efforts: [
                                  ...f.efforts,
                                  {
                                    id,
                                    name: draftEffortName.trim() || id,
                                    isDefault: f.efforts.length === 0,
                                  },
                                ],
                              };
                            });
                            setDraftEffortId("");
                            setDraftEffortName("");
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm prov-models__add-btn"
                        disabled={busy || !draftEffortId.trim()}
                        onClick={() => {
                          const id = draftEffortId.trim();
                          if (!id) return;
                          setForm((f) => {
                            if (f.efforts.some((x) => x.id === id)) return f;
                            return {
                              ...f,
                              efforts: [
                                ...f.efforts,
                                {
                                  id,
                                  name: draftEffortName.trim() || id,
                                  isDefault: f.efforts.length === 0,
                                },
                              ],
                            };
                          });
                          setDraftEffortId("");
                          setDraftEffortName("");
                        }}
                      >
                        <IconPlus size={14} />
                        {tr("prov.addEffort")}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {hint && (
                <div
                  className={
                    "prov-form__hint" +
                    (hintTone === "ok"
                      ? " is-ok"
                      : hintTone === "err"
                        ? " is-err"
                        : "")
                  }
                >
                  {hint}
                </div>
              )}

              <div className="prov-form__actions">
                {editingId && (
                  <button
                    type="button"
                    className="btn btn--danger"
                    disabled={busy}
                    onClick={() =>
                      setDeleteTarget({
                        id: editingId,
                        name: form.name || editingId,
                      })
                    }
                  >
                    <IconTrash size={14} />
                    {tr("prov.delete")}
                  </button>
                )}
                <div className="prov-form__actions-end">
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={closeRight}
                    disabled={busy}
                  >
                    {tr("common.cancel")}
                  </button>
                  <button
                    type="button"
                    className="btn btn--solid"
                    onClick={() => void save()}
                    disabled={busy}
                  >
                    {busy ? (
                      tr("prov.saving")
                    ) : editingId ? (
                      <>
                        <IconEdit size={14} />
                        {tr("prov.save")}
                      </>
                    ) : (
                      <>
                        <IconPlus size={14} />
                        {tr("prov.add")}
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      <GlassModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title={tr("prov.delete")}
        size="sm"
        closeLabel={tr("common.close")}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setDeleteTarget(null)}
            >
              {tr("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => void confirmRemove()}
            >
              {tr("prov.delete")}
            </button>
          </>
        }
      >
        <p className="prov-delete-msg">
          {tr("prov.confirmDelete", {
            id: deleteTarget?.name || deleteTarget?.id || "",
          })}
        </p>
      </GlassModal>

      <GlassModal
        open={ccImportOpen}
        onClose={() => !ccImportBusy && setCcImportOpen(false)}
        title={tr("prov.ccSwitch.title")}
        size="lg"
        closeLabel={tr("common.close")}
        wrapBody
        bodyClassName="prov-cc-modal-body"
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={ccImportBusy}
              onClick={() => setCcImportOpen(false)}
            >
              {tr("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={ccScanBusy || ccImportBusy}
              onClick={() => void runCcScan()}
            >
              <IconRefresh size={14} />
              {tr("prov.ccSwitch.rescan")}
            </button>
            <button
              type="button"
              className="btn btn--solid"
              disabled={
                ccImportBusy ||
                ccScanBusy ||
                ccSelected.size === 0 ||
                ccScan?.status !== "ok"
              }
              onClick={() => void runCcImport()}
            >
              {ccImportBusy
                ? tr("prov.ccSwitch.importing")
                : tr("prov.ccSwitch.importAction", {
                    n: String(ccSelected.size),
                  })}
            </button>
          </>
        }
      >
        {ccScanBusy && !ccScan ? (
          <p className="prov-cc-status" role="status">
            {tr("prov.ccSwitch.scanning")}
          </p>
        ) : null}

        {ccScan?.status === "not_found" ? (
          <div className="prov-cc-empty">
            <p>{tr("prov.ccSwitch.notFound")}</p>
            <p className="prov-cc-muted">{tr("prov.ccSwitch.notFoundHint")}</p>
            {ccScan.triedPaths.length > 0 ? (
              <details className="prov-cc-paths">
                <summary>{tr("prov.ccSwitch.triedPaths")}</summary>
                <ul>
                  {ccScan.triedPaths.map((p) => (
                    <li key={p}>
                      <code>{p}</code>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        ) : null}

        {ccScan?.status === "error" ? (
          <div className="prov-cc-empty" role="alert">
            <p>{tr("prov.ccSwitch.scanError")}</p>
            <p className="prov-cc-muted">{ccScan.error}</p>
          </div>
        ) : null}

        {ccScan?.status === "ok" ? (
          <>
            <p className="prov-cc-muted">
              {tr("prov.ccSwitch.found", {
                n: String(ccScan.items.length),
                path: ccScan.dbPath || "",
              })}
            </p>
            {ccScan.items.length === 0 ? (
              <p className="prov-cc-empty">{tr("prov.ccSwitch.noItems")}</p>
            ) : (
              <ul className="prov-cc-list" role="list">
                {ccScan.items.map((it) => {
                  const selectable =
                    it.status === "importable" || it.status === "exists";
                  const checked = ccSelected.has(it.sourceId);
                  return (
                    <li
                      key={it.sourceId}
                      className={
                        "prov-cc-item" +
                        (checked ? " is-checked" : "") +
                        (!selectable ? " is-disabled" : "")
                      }
                    >
                      <label className="prov-cc-item__row">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!selectable || ccImportBusy}
                          onChange={() =>
                            toggleCcItem(it.sourceId, selectable)
                          }
                        />
                        <span className="prov-cc-item__main">
                          <span className="prov-cc-item__name">
                            {it.name}
                            {it.isCurrent ? (
                              <span className="prov-cc-badge">
                                {tr("prov.ccSwitch.current")}
                              </span>
                            ) : null}
                          </span>
                          <span className="prov-cc-item__sub">
                            {it.baseUrl || "—"}
                            {it.model ? ` · ${it.model}` : ""}
                            {it.apiBackend ? ` · ${it.apiBackend}` : ""}
                          </span>
                          <span
                            className={
                              "prov-cc-item__status prov-cc-item__status--" +
                              it.status
                            }
                          >
                            {tr(ccSwitchStatusKey(it.status))}
                            {it.statusDetail
                              ? ` — ${it.statusDetail}`
                              : it.keyHint
                                ? ` · ${it.keyHint}`
                                : ""}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        ) : null}

        {ccImportMsg ? (
          <p className="prov-cc-result" role="status">
            {ccImportMsg}
          </p>
        ) : null}
      </GlassModal>
    </div>
  );
}
