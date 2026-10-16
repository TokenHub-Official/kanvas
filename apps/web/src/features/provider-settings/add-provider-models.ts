import type { ProviderModelCatalog } from "@kanvas/contracts/api";

import {
  createWorkspaceModel,
  fetchWorkspaceModels,
  fetchWorkspaceProviderModelCatalog,
  importWorkspaceProviderModels,
  mapWorkspaceProviderModel,
  type WorkspaceApiContext,
} from "../../api/transport.js";
import { providerModelIdentifierError } from "./provider-settings-form.js";

export type CatalogModel = ProviderModelCatalog["models"][number];
export interface ProviderModelSelection {
  readonly upstreamModelId: string;
  readonly canonicalSlug: string;
}

export function canAddProviderModel(model: CatalogModel): boolean {
  return !model.imported || model.imported.lifecycle === "discovered";
}

export class AddProviderModelsError extends Error {
  constructor(
    readonly code: "empty" | "missing" | "identifier" | "unavailable",
  ) {
    super(code);
  }
}

/** Re-read before importing so retries resume partial saves without remapping existing models. */
export async function addProviderModels(
  context: WorkspaceApiContext,
  providerSettingId: string,
  selections: readonly ProviderModelSelection[],
): Promise<void> {
  if (selections.length === 0) throw new AddProviderModelsError("empty");
  const [catalog, currentModels] = await Promise.all([
    fetchWorkspaceProviderModelCatalog(context.workspaceId, providerSettingId),
    fetchWorkspaceModels(context.workspaceId),
  ]);
  const catalogById = new Map(
    catalog.models.map((model) => [model.upstreamModelId, model]),
  );
  const pending = selections.flatMap((selection) => {
    const model = catalogById.get(selection.upstreamModelId);
    if (!model) throw new AddProviderModelsError("missing");
    if (
      model.imported?.lifecycle === "disabled" ||
      model.imported?.lifecycle === "removed"
    ) {
      throw new AddProviderModelsError("unavailable");
    }
    if (model.imported?.canonicalModelId) return [];
    if (providerModelIdentifierError(selection.canonicalSlug))
      throw new AddProviderModelsError("identifier");
    return [
      { ...selection, canonicalSlug: selection.canonicalSlug.trim(), model },
    ];
  });
  if (pending.length === 0) return;
  const imported = await importWorkspaceProviderModels(
    context,
    providerSettingId,
    {
      upstreamModelIds: pending.map(({ upstreamModelId }) => upstreamModelId),
    },
  );
  const canonicalBySlug = new Map(
    currentModels.models.map((model) => [model.slug, model]),
  );
  for (const selection of pending) {
    const providerModel = imported.models.find(
      (model) => model.upstreamModelId === selection.upstreamModelId,
    );
    if (!providerModel) throw new AddProviderModelsError("missing");
    if (["disabled", "removed"].includes(providerModel.lifecycle)) {
      throw new AddProviderModelsError("unavailable");
    }
    if (providerModel.lifecycle !== "discovered") continue;
    let canonical = canonicalBySlug.get(selection.canonicalSlug);
    if (!canonical) {
      const result = await createWorkspaceModel(context, {
        slug: selection.canonicalSlug,
        sourceKind: selection.model.suggestionSource ?? "provider",
        sourceReference:
          selection.model.suggestedCanonicalSlug ?? selection.upstreamModelId,
      });
      canonical = result.model;
      canonicalBySlug.set(canonical.slug, canonical);
    }
    const suggested =
      selection.canonicalSlug === selection.model.suggestedCanonicalSlug;
    await mapWorkspaceProviderModel(
      context,
      providerSettingId,
      providerModel.id,
      {
        expectedVersion: providerModel.version,
        canonicalModelId: canonical.id,
        mappingSource: suggested
          ? (selection.model.suggestionSource ?? "provider")
          : "manual",
        mappingConfidence: suggested ? "suggested" : "manual",
      },
    );
  }
}
