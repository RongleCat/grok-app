import type { ModelOption } from "@/lib/grokCatalog";

export type ComposerModelPick =
  | { kind: "official"; modelId: string }
  | { kind: "custom"; providerId: string; modelId: string };

export type ComposerModelEntry = {
  pick: ComposerModelPick;
  title: string;
  /** Raw model id when title is a display name that differs. */
  subtitle?: string;
  /** Stable row key for React. */
  key: string;
};

export type ComposerModelGroup = {
  key: string;
  title: string;
  entries: ComposerModelEntry[];
};

export type ComposerProviderModelInput = {
  id: string;
  name: string;
};

export type ComposerProviderInput = {
  id: string;
  name: string;
  /** Active request model for this channel (`[model.<id>].model`). */
  model: string;
  /**
   * `grok_build_proxy` sends the catalog id. Any other mode, including a
   * missing one, is a generic relay. Both list every catalog row (#1394).
   */
  providerMode?: string | null;
  /** Catalog of selectable models; falls back to single `model` when empty. */
  models?: ComposerProviderModelInput[];
};

function cleanModels(
  models: ReadonlyArray<ComposerProviderModelInput> | null | undefined,
): ComposerProviderModelInput[] {
  return (models ?? [])
    .map((m) => ({
      id: m.id?.trim() ?? "",
      name: (m.name?.trim() || m.id?.trim()) ?? "",
    }))
    .filter((m) => m.id);
}

/**
 * Models the composer may offer for one channel.
 *
 * Every catalog row is listed. A generic relay sends the matching
 * `[model.<provider>__<slug>]` section, whose `model` field is that row's
 * upstream id (#1337, #1394). A Grok Build-compatible relay sends the
 * catalog id. An empty catalog falls back to the channel `model`.
 */
function modelsForProvider(
  p: ComposerProviderInput,
): ComposerProviderModelInput[] {
  const catalog = cleanModels(p.models);
  if (catalog.length > 0) return catalog;
  const configured = p.model?.trim() ?? "";
  if (!configured) return [];
  return [{ id: configured, name: configured }];
}

/** Slim provider rows for the composer menu, including relay mode. */
export function composerMenuProviders(
  providers: ReadonlyArray<{
    id: string;
    name: string;
    model: string;
    providerMode?: string | null;
    models?: ReadonlyArray<{ id: string; name?: string | null }> | null;
  }>,
): Array<
  ComposerProviderInput & {
    providerMode: string;
    models: ComposerProviderModelInput[];
  }
> {
  return providers.map((p) => ({
    id: p.id,
    name: p.name,
    model: p.model,
    providerMode: p.providerMode ?? "generic",
    models: (p.models?.length
      ? p.models
      : p.model
        ? [{ id: p.model, name: p.model }]
        : []
    ).map((m) => ({
      id: m.id,
      name: (m.name || m.id).trim() || m.id,
    })),
  }));
}

export function buildComposerModelGroups(opts: {
  officialModels: ModelOption[];
  providers: ComposerProviderInput[];
  officialGroupTitle: string;
}): ComposerModelGroup[] {
  const groups: ComposerModelGroup[] = [];
  const officialEntries: ComposerModelEntry[] = opts.officialModels.map(
    (m) => ({
      key: `official:${m.id}`,
      pick: { kind: "official" as const, modelId: m.id },
      title: m.label || m.id,
    }),
  );
  if (officialEntries.length > 0) {
    groups.push({
      key: "official",
      title: opts.officialGroupTitle,
      entries: officialEntries,
    });
  }
  for (const p of opts.providers) {
    const models = modelsForProvider(p);
    if (models.length === 0) continue;
    const groupTitle = p.name?.trim() || p.id;
    groups.push({
      key: `provider:${p.id}`,
      title: groupTitle,
      entries: models.map((m) => {
        const title = m.name || m.id;
        const subtitle = title !== m.id ? m.id : undefined;
        return {
          key: `custom:${p.id}:${m.id}`,
          pick: {
            kind: "custom" as const,
            providerId: p.id,
            modelId: m.id,
          },
          title,
          subtitle,
        };
      }),
    });
  }
  return groups;
}

export function filterComposerModelGroups(
  groups: ComposerModelGroup[],
  query: string,
): ComposerModelGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return groups;
  return groups
    .map((g) => ({
      ...g,
      entries: g.entries.filter(
        (e) =>
          e.title.toLowerCase().includes(q) ||
          (e.subtitle?.toLowerCase().includes(q) ?? false) ||
          g.title.toLowerCase().includes(q) ||
          (e.pick.kind === "official"
            ? e.pick.modelId.toLowerCase().includes(q)
            : e.pick.providerId.toLowerCase().includes(q) ||
              e.pick.modelId.toLowerCase().includes(q)),
      ),
    }))
    .filter((g) => g.entries.length > 0);
}

/** Whether a menu entry is the active selection. */
export function isComposerModelEntryActive(
  entry: ComposerModelEntry,
  opts: {
    activeSource: "official" | "custom" | string;
    activeProviderId: string | null | undefined;
    /** Active custom request model (provider.model). */
    activeRequestModel?: string | null;
    modelId: string;
  },
): boolean {
  if (entry.pick.kind === "official") {
    return (
      opts.activeSource !== "custom" && entry.pick.modelId === opts.modelId
    );
  }
  const requestOk =
    !opts.activeRequestModel ||
    opts.activeRequestModel === entry.pick.modelId;
  return (
    opts.activeSource === "custom" &&
    opts.activeProviderId === entry.pick.providerId &&
    requestOk
  );
}
