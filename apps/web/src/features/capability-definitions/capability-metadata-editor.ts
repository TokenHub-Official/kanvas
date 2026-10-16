import type {
  CapabilityDefinitionSummary,
  UpdateCapabilityDefinitionBody,
} from "@kanvas/contracts/api";

export interface CapabilityMetadataEditorState {
  readonly editing: CapabilityDefinitionSummary;
  readonly requestKey: string;
  readonly titleZh: string;
  readonly titleEn: string;
  readonly descriptionZh: string;
  readonly descriptionEn: string;
  readonly categoryZh: string;
  readonly categoryEn: string;
  readonly tags: string;
}

export function capabilityMetadataEditorFrom(
  definition: CapabilityDefinitionSummary,
): CapabilityMetadataEditorState {
  const catalog = definition.declaration.catalog;
  return Object.freeze({
    editing: definition,
    requestKey: crypto.randomUUID(),
    titleZh: catalog.title["zh-CN"],
    titleEn: catalog.title["en-US"],
    descriptionZh: catalog.description?.["zh-CN"] ?? "",
    descriptionEn: catalog.description?.["en-US"] ?? "",
    categoryZh: catalog.category["zh-CN"],
    categoryEn: catalog.category["en-US"],
    tags: catalog.tags.join(", "),
  });
}

export function capabilityMetadataBody(
  editor: CapabilityMetadataEditorState,
): Omit<UpdateCapabilityDefinitionBody, "expectedVersion"> {
  return {
    title: {
      "zh-CN": editor.titleZh.trim(),
      "en-US": editor.titleEn.trim(),
    },
    ...(editor.descriptionZh.trim() && editor.descriptionEn.trim()
      ? {
          description: {
            "zh-CN": editor.descriptionZh.trim(),
            "en-US": editor.descriptionEn.trim(),
          },
        }
      : {}),
    category: {
      "zh-CN": editor.categoryZh.trim(),
      "en-US": editor.categoryEn.trim(),
    },
    tags: [
      ...new Set(
        editor.tags
          .split(/[,，]/u)
          .map((tag) => tag.trim())
          .filter(Boolean),
      ),
    ],
  };
}

export function capabilityMetadataEditorError(
  editor: CapabilityMetadataEditorState,
): "title" | "category" | "description" | undefined {
  if (!editor.titleZh.trim() || !editor.titleEn.trim()) {
    return "title";
  }
  if (!editor.categoryZh.trim() || !editor.categoryEn.trim()) {
    return "category";
  }
  if (
    Boolean(editor.descriptionZh.trim()) !==
    Boolean(editor.descriptionEn.trim())
  ) {
    return "description";
  }
  return undefined;
}
