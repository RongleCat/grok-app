/**
 * Effective inference model shown in composer model chips.
 *
 * A custom provider (relay) is a **channel**: when it is the active route the
 * agent spawns with the provider's request model (`[model.<id>] model = …`)
 * and the official composer selection is ignored (`agent_spawn_model_id` in
 * providers.rs). The chip must therefore reflect the provider request model —
 * not the stale official catalog pick (default "Grok 4.5") that misleads users
 * into thinking the relay sends Grok.
 */

/**
 * Resolve the model id the composer chip should display.
 *
 * @param modelId Official catalog selection (composer state).
 * @param activeCustomModel Request model of the active custom provider, or
 *   null/undefined when the official route is active.
 */
export function effectiveComposerModel(
  modelId: string,
  activeCustomModel: string | null | undefined,
): string {
  const custom = activeCustomModel?.trim();
  return custom ? custom : modelId;
}

/**
 * Label for the composer model chip.
 *
 * Official route: catalog label (or model id).
 * Custom route: provider display `name`, falling back to request `model`.
 */
export function composerModelChipLabel(opts: {
  modelId: string;
  officialLabel: string;
  activeCustom: { name: string; model: string } | null | undefined;
}): string {
  const custom = opts.activeCustom;
  if (custom) {
    const name = custom.name?.trim();
    if (name) return name;
    const model = custom.model?.trim();
    if (model) return model;
  }
  return opts.officialLabel || opts.modelId;
}

/** 自定义 provider 及其可选模型（`CustomProvider` 的最小投影）。 */
export type ComposerProviderLike = {
  name?: string;
  /** 通道的全局请求模型。 */
  model?: string;
  models?: readonly { id: string; name?: string }[];
};

/**
 * 自定义路由下芯片应展示的模型。
 *
 * provider 的 `model` 是通道全局请求模型，但每个会话在 meta 里各存各的模型
 * id。只要会话解析出的 `modelId` 属于该 provider 的可选模型，就必须以会话的
 * `modelId` 为准，否则切回旧会话仍显示新会话的模型。仅当 `modelId` 不属于该
 * provider（或为空）时才回退到 provider 的全局模型。
 */
export function resolveActiveCustomModel(opts: {
  provider: ComposerProviderLike | null | undefined;
  modelId: string;
}): { name: string; model: string } | null {
  const p = opts.provider;
  if (!p) return null;
  const sessionId = opts.modelId.trim();
  const sessionMatch = sessionId
    ? p.models?.find((m) => m.id === sessionId)
    : undefined;
  const activeId = sessionMatch ? sessionMatch.id : (p.model?.trim() ?? "");
  const entry =
    sessionMatch ??
    p.models?.find((m) => m.id === activeId) ??
    (activeId ? { id: activeId, name: activeId } : null);
  return entry
    ? { name: entry.name?.trim() || entry.id, model: entry.id }
    : { name: p.name?.trim() ?? "", model: p.model?.trim() ?? "" };
}
