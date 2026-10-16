import type { ModelReferenceSyncResult } from "@kanvas/contracts/api";

/** Report actual fields applied to the draft, independently from price conflicts. */
export function modelReferenceFeedback(
  result: ModelReferenceSyncResult,
  changed: number,
  textModel: boolean,
) {
  const missing = textModel
    ? (["contextWindow", "maximumOutputTokens", "toolCall"] as const).filter(
        (key) => result.defaults?.[key] === undefined,
      )
    : [];
  return {
    missing,
    title: changed > 0 ? "updatedDraft" : "noChanges",
    incomplete:
      result.status !== "resolved" || result.stale || missing.length > 0,
  } as const;
}
