import type {
  ModelResourceFormat,
  ModelResourceImportSummary,
  PublishModelResourceImportBody,
} from "@kanvas/contracts/api";

export type ModelResourcePublishTarget =
  | Readonly<{ kind: "new" }>
  | Readonly<{
      kind: "new_revision";
      modelResourceId: string;
      expectedResourceVersion: number;
      key: string;
    }>;

export interface ModelResourcePublicationDraft {
  readonly requestKey: string;
  readonly target: ModelResourcePublishTarget;
  readonly key: string;
  readonly displayName: string;
  readonly description: string;
  readonly format: ModelResourceFormat;
  readonly licenseSpdxId: string;
  readonly licenseSourceUrl: string;
}

export type ModelResourcePublicationDraftError =
  "key" | "name" | "license" | "licenseUrl";

const keyPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)+$/u;

export function modelResourcePublicationDraftFrom(
  analysis: ModelResourceImportSummary,
  target: ModelResourcePublishTarget,
): ModelResourcePublicationDraft {
  return Object.freeze({
    requestKey: crypto.randomUUID(),
    target,
    key:
      target.kind === "new_revision"
        ? target.key
        : (analysis.suggestedKey ??
          `model.custom.${analysis.id.toLowerCase()}`),
    displayName: analysis.suggestedDisplayName ?? "",
    description: "",
    format: analysis.format ?? "other",
    licenseSpdxId: analysis.license?.spdxId ?? "NOASSERTION",
    licenseSourceUrl: analysis.license?.sourceUrl ?? "",
  });
}

export function modelResourcePublicationDraftError(
  draft: ModelResourcePublicationDraft,
): ModelResourcePublicationDraftError | undefined {
  if (!keyPattern.test(draft.key.trim())) return "key";
  if (!draft.displayName.trim()) return "name";
  if (!draft.licenseSpdxId.trim()) return "license";
  if (draft.licenseSourceUrl) {
    try {
      if (new URL(draft.licenseSourceUrl).protocol !== "https:") {
        return "licenseUrl";
      }
    } catch {
      return "licenseUrl";
    }
  }
  return undefined;
}

export function modelResourcePublicationBody(
  draft: ModelResourcePublicationDraft,
  analysis: ModelResourceImportSummary,
): PublishModelResourceImportBody {
  const error = modelResourcePublicationDraftError(draft);
  if (error) throw new TypeError(error);
  return {
    expectedVersion: analysis.version,
    target:
      draft.target.kind === "new"
        ? { kind: "new", key: draft.key.trim() }
        : {
            kind: "new_revision",
            modelResourceId: draft.target.modelResourceId,
            expectedResourceVersion: draft.target.expectedResourceVersion,
          },
    displayName: draft.displayName.trim(),
    ...(draft.description.trim()
      ? { description: draft.description.trim() }
      : {}),
    format: draft.format,
    license: {
      spdxId: draft.licenseSpdxId.trim(),
      ...(draft.licenseSourceUrl.trim()
        ? { sourceUrl: draft.licenseSourceUrl.trim() }
        : {}),
    },
    ...(analysis.nativeInterface
      ? { nativeInterface: analysis.nativeInterface }
      : {}),
  };
}
