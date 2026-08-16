/** API domain: appearance skin packs / presets / catalog */

import { invoke, listen } from "./host";
import type { SkinPackPreview } from "../skinPack";
import type { CatalogPack, SkinCatalogSource } from "../skinCatalog";
import type { PendingSkinImport } from "../skinImportPending";

export type SkinPresetListItem = {
  id: string;
  sourceId: string;
  name: string;
  description: string;
  author: string;
  createdAt: number;
  updatedAt: number;
  skin: string;
  scrim: number;
  hasWallpaper: boolean;
  kind?: string;
  bytes: number;
  previewRel?: string;
};

export type SkinPresetListResult = {
  presets: SkinPresetListItem[];
  usage: { bytes: number; budget: number; hasUndo: boolean };
};

export async function skinPickOpen(): Promise<string | null> {
  return invoke<string | null>("skin_pick_open");
}

export async function skinPickSave(defaultName?: string): Promise<string | null> {
  return invoke<string | null>("skin_pick_save", { defaultName: defaultName ?? null });
}

export async function skinPackInspect(path: string): Promise<SkinPackPreview> {
  return invoke<SkinPackPreview>("skin_pack_inspect", { path });
}

export async function skinInspectAbort(inspectId: string): Promise<void> {
  await invoke<void>("skin_inspect_abort", { inspectId });
}

export type SkinExportResult = {
  warning?: "ffmpeg_unavailable" | string | null;
};

export async function skinPackExport(
  destPath: string,
  stagingId: string | null,
  manifest: unknown,
): Promise<SkinExportResult> {
  return invoke<SkinExportResult>("skin_pack_export", {
    destPath,
    stagingId,
    manifest,
  });
}

export async function skinStagingBegin(): Promise<{ uploadId: string }> {
  return invoke<{ uploadId: string }>("skin_staging_begin");
}

export async function skinStagingAppend(
  stagingId: string,
  chunkBase64: string,
): Promise<number> {
  return invoke<number>("skin_staging_append", { stagingId, chunkBase64 });
}

export async function skinStagingAbort(stagingId: string): Promise<void> {
  await invoke<void>("skin_staging_abort", { stagingId });
}

export async function skinPresetList(): Promise<SkinPresetListResult> {
  return invoke<SkinPresetListResult>("skin_preset_list");
}

export async function skinPresetSaveFromUpload(
  stagingId: string,
  manifest: unknown,
): Promise<SkinPresetListItem> {
  return invoke<SkinPresetListItem>("skin_preset_save_from_upload", {
    stagingId,
    manifest,
  });
}

export async function skinPresetSaveFromInspect(
  inspectId: string,
): Promise<SkinPresetListItem> {
  return invoke<SkinPresetListItem>("skin_preset_save_from_inspect", {
    inspectId,
  });
}

export async function skinPresetMaterialize(id: string): Promise<SkinPackPreview> {
  return invoke<SkinPackPreview>("skin_preset_materialize", { id });
}

export async function skinPresetDelete(id: string): Promise<void> {
  await invoke<void>("skin_preset_delete", { id });
}

export async function skinPresetRename(
  id: string,
  name: string,
): Promise<SkinPresetListItem> {
  return invoke<SkinPresetListItem>("skin_preset_rename", { id, name });
}

export async function skinPresetReplaceFromUpload(
  id: string,
  stagingId: string,
  manifest: unknown,
): Promise<SkinPresetListItem> {
  return invoke<SkinPresetListItem>("skin_preset_replace_from_upload", {
    id,
    stagingId,
    manifest,
  });
}

export async function skinPresetExport(
  id: string,
  destPath: string,
): Promise<SkinExportResult> {
  return invoke<SkinExportResult>("skin_preset_export", { id, destPath });
}

export async function skinUndoPrepare(): Promise<string> {
  return invoke<string>("skin_undo_prepare");
}

export async function skinUndoAppend(
  snapshotId: string,
  chunkBase64: string,
): Promise<number> {
  return invoke<number>("skin_undo_append", { snapshotId, chunkBase64 });
}

export async function skinUndoCommit(
  snapshotId: string,
  manifest: unknown,
): Promise<void> {
  await invoke<void>("skin_undo_commit", { snapshotId, manifest });
}

export async function skinUndoAbort(snapshotId: string): Promise<void> {
  await invoke<void>("skin_undo_abort", { snapshotId });
}

export async function skinCatalogFetch(
  sourceId: string,
  force?: boolean,
): Promise<CatalogPack[]> {
  return invoke<CatalogPack[]>("skin_catalog_fetch", {
    sourceId,
    force: force ?? false,
  });
}

export async function skinCatalogDownload(
  sourceId: string,
  packId: string,
): Promise<SkinPackPreview> {
  return invoke<SkinPackPreview>("skin_catalog_download", { sourceId, packId });
}

export async function skinCatalogPreviewPath(
  sourceId: string,
  packId: string,
): Promise<string | null> {
  return invoke<string | null>("skin_catalog_preview_path", { sourceId, packId });
}

export async function skinSourcesList(): Promise<SkinCatalogSource[]> {
  return invoke<SkinCatalogSource[]>("skin_sources_list");
}

export async function skinSourcesAdd(
  url: string,
  label?: string,
): Promise<SkinCatalogSource> {
  return invoke<SkinCatalogSource>("skin_sources_add", { url, label: label ?? "" });
}

export async function skinSourcesRemove(id: string): Promise<void> {
  await invoke<void>("skin_sources_remove", { id });
}

export async function skinSourcesSetEnabled(
  id: string,
  enabled: boolean,
): Promise<SkinCatalogSource> {
  return invoke<SkinCatalogSource>("skin_sources_set_enabled", { id, enabled });
}

export async function skinImportTakePending(): Promise<PendingSkinImport | null> {
  return invoke<PendingSkinImport | null>("skin_import_take_pending");
}

export async function skinPackFetchUrl(href: string): Promise<SkinPackPreview> {
  return invoke<SkinPackPreview>("skin_pack_fetch_url", { href });
}

export function listenSkinImportPending(handler: () => void): Promise<() => void> {
  return listen<unknown>("skin://import-pending", () => handler());
}
