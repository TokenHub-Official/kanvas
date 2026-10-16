import type { AgentHubSkill, SkillDraftSummary } from "@kanvas/contracts/api";

import type { StatusTagTone } from "./status-tag.js";

export type SkillAvailabilityKind =
  | "usable"
  | "usable_with_changes"
  | "needs_publish"
  | "disabled"
  | "revoked"
  | "unavailable";

export interface SkillAvailability {
  readonly kind: SkillAvailabilityKind;
  readonly labelKey: string;
  readonly tone: StatusTagTone;
  readonly publishedRevisionId?: string;
}

export type SkillPublicationStage = "draft" | "changes" | "published";

export function skillPublicationStage(options: {
  readonly draft?: Pick<SkillDraftSummary, "publishedSkillRevisionId">;
  readonly published?: Pick<AgentHubSkill, "skillRevisionId">;
}): SkillPublicationStage {
  if (options.draft)
    return options.draft.publishedSkillRevisionId ? "changes" : "draft";
  return "published";
}

export function skillAvailability(options: {
  readonly draft?: Pick<
    SkillDraftSummary,
    "publishedCurrent" | "publishedSkillRevisionId"
  >;
  readonly published?: Pick<AgentHubSkill, "runtimeStatus" | "skillRevisionId">;
  readonly resourceState?: "enabled" | "disabled" | "deleted" | undefined;
}): SkillAvailability {
  const publishedRevisionId = options.published?.skillRevisionId;
  if (options.resourceState === "deleted") {
    return {
      kind: "unavailable",
      labelKey: "agent.skillWorkbench.availability.unavailable",
      tone: "danger",
    };
  }
  if (options.published?.runtimeStatus === "revoked") {
    return {
      kind: "revoked",
      labelKey: "agent.skillWorkbench.availability.revoked",
      tone: "danger",
      ...(publishedRevisionId ? { publishedRevisionId } : {}),
    };
  }
  if (
    options.resourceState === "disabled" ||
    options.published?.runtimeStatus === "disabled"
  ) {
    return {
      kind: "disabled",
      labelKey: "agent.skillWorkbench.availability.disabled",
      tone: "warning",
      ...(publishedRevisionId ? { publishedRevisionId } : {}),
    };
  }
  if (options.published?.runtimeStatus === "enabled") {
    const hasUnpublishedChanges =
      Boolean(options.draft) && options.draft?.publishedCurrent !== true;
    return {
      kind: hasUnpublishedChanges ? "usable_with_changes" : "usable",
      labelKey: hasUnpublishedChanges
        ? "agent.skillWorkbench.availability.usableWithChanges"
        : "agent.skillWorkbench.availability.usable",
      tone: "positive",
      publishedRevisionId: options.published.skillRevisionId,
    };
  }
  if (options.draft?.publishedSkillRevisionId) {
    return {
      kind: "unavailable",
      labelKey: "agent.skillWorkbench.availability.unavailable",
      tone: "neutral",
    };
  }
  if (options.draft) {
    return {
      kind: "needs_publish",
      labelKey: "agent.skillWorkbench.availability.needsPublish",
      tone: "info",
    };
  }
  return {
    kind: "unavailable",
    labelKey: "agent.skillWorkbench.availability.unavailable",
    tone: "neutral",
  };
}
