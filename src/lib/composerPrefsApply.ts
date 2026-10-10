/**
 * Model + effort chosen when a chat's stored composer prefs are applied.
 * Official ids use the Grok catalog. A custom provider id is checked against
 * that provider's models, and effort is checked against that model's ladder.
 */

import type { CustomProvider } from "@/lib/api/providers";
import {
  effortOptionsFromProvider,
  findModel,
  GROK_BUILD_MODELS,
  isValidEffort,
  isValidModelId,
  pickDefaultEffort,
  pickDefaultModelId,
  type EffortOption,
  type ModelOption,
} from "@/lib/grokCatalog";
import { resolveProviderEfforts } from "@/lib/providerModelConfig";

export type ComposerPrefsSelectionInput = {
  modelId?: string | null;
  effort?: string | null;
  providerId?: string | null;
};

export type ComposerPrefsProvider = Pick<
  CustomProvider,
  "id" | "model" | "models" | "efforts" | "baseUrl"
>;

function isCustomProviderId(providerId: string | null | undefined): boolean {
  const id = providerId?.trim() ?? "";
  return id.length > 0 && id.toLowerCase() !== "official";
}

function providerModelList(provider: ComposerPrefsProvider) {
  if (provider.models?.length) return provider.models;
  const configured = provider.model?.trim() ?? "";
  return configured ? [{ id: configured, name: configured }] : [];
}

function pickEffort(
  effort: string | null | undefined,
  modelOrEfforts: ModelOption | EffortOption[] | null | undefined,
): string {
  const id = (effort ?? "").trim();
  if (isValidEffort(id, modelOrEfforts ?? null)) return id;
  if (Array.isArray(modelOrEfforts)) {
    return pickDefaultEffort(null, modelOrEfforts);
  }
  return pickDefaultEffort(modelOrEfforts ?? null);
}

export type ComposerPrefsDraftPick = {
  providerId?: string | null;
  modelId?: string | null;
  effort?: string | null;
};

/**
 * True when a new chat's pick belongs to the route that chat picked. The draft
 * carries its own provider, because the resolved prefs do not know it yet.
 */
function draftModelIdIsKnown(
  modelId: string,
  draftProviderId: string | null | undefined,
  providers: readonly ComposerPrefsProvider[],
  catalog: ModelOption[],
): boolean {
  if (!isCustomProviderId(draftProviderId)) {
    return isValidModelId(modelId, catalog);
  }
  const provider = providers.find((p) => p.id === draftProviderId?.trim());
  // List not back yet: nothing disproves the pick, so keep it.
  if (!provider) return providers.length === 0;
  return providerModelList(provider).some((m) => m.id === modelId);
}

export function resolveComposerPrefsSelection(opts: {
  prefs: ComposerPrefsSelectionInput;
  catalog: ModelOption[];
  providers?: readonly ComposerPrefsProvider[];
  /**
   * A chat that has not been created yet keeps its pick in memory only, so a
   * resolve — which reads the global / project defaults — would otherwise put
   * the model back to the default. The provider is already restored this way.
   */
  draft?: ComposerPrefsDraftPick | null;
}): { modelId: string; effort: string } {
  const catalog = opts.catalog.length > 0 ? opts.catalog : GROK_BUILD_MODELS;
  const providers = opts.providers ?? [];
  const providerId = opts.prefs.providerId?.trim() ?? "";

  const draftModelId = opts.draft?.modelId?.trim() ?? "";
  if (
    draftModelId &&
    draftModelIdIsKnown(
      draftModelId,
      opts.draft?.providerId,
      providers,
      catalog,
    )
  ) {
    const draftEffort = opts.draft?.effort?.trim() ?? "";
    return {
      modelId: draftModelId,
      effort:
        draftEffort || pickDefaultEffort(findModel(draftModelId, catalog) ?? null),
    };
  }

  if (isCustomProviderId(providerId)) {
    const provider = providers.find((p) => p.id === providerId);
    const storedModel = opts.prefs.modelId?.trim() ?? "";
    // List not back yet: keep the disk id so the chip does not flash official.
    if (!provider) {
      if (providers.length === 0 && storedModel) {
        const storedEffort = (opts.prefs.effort ?? "").trim();
        return {
          modelId: storedModel,
          effort: storedEffort || pickDefaultEffort(null),
        };
      }
    } else {
      const models = providerModelList(provider);
      const known = !!storedModel && models.some((m) => m.id === storedModel);
      const configured = provider.model?.trim() ?? "";
      const nextModelId = known
        ? storedModel
        : configured || pickDefaultModelId(catalog);
      const efforts = effortOptionsFromProvider(
        resolveProviderEfforts(
          { ...provider, baseUrl: provider.baseUrl ?? "" },
          nextModelId,
        ),
      );
      return {
        modelId: nextModelId,
        effort: pickEffort(opts.prefs.effort, efforts),
      };
    }
  }

  const nextModelId =
    opts.prefs.modelId && isValidModelId(opts.prefs.modelId, catalog)
      ? opts.prefs.modelId
      : pickDefaultModelId(catalog);
  return {
    modelId: nextModelId,
    effort: pickEffort(opts.prefs.effort, findModel(nextModelId, catalog)),
  };
}
