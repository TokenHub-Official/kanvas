import type { AgentThreadView } from "@kanvas/contracts/api";
import type { TFunction } from "i18next";

type AgentTask = AgentThreadView["tasks"][number];

export interface AgentTaskDisplayText {
  readonly description?: string;
  readonly title: string;
}

export function agentTaskDisplayText(
  task: AgentTask,
  t: TFunction<"translation">,
): AgentTaskDisplayText {
  const presentation = task.presentation;
  if (!presentation) {
    return {
      title: task.title,
      ...(task.description ? { description: task.description } : {}),
    };
  }
  if (presentation.kind === "skill_images_update") {
    return {
      title: presentation.resourceName
        ? t("agent.taskPresentation.skillImagesUpdate.titleNamed", {
            name: presentation.resourceName,
          })
        : t("agent.taskPresentation.skillImagesUpdate.title"),
      description: t("agent.taskPresentation.skillImagesUpdate.description", {
        count: presentation.imageCount,
      }),
    };
  }
  if (presentation.kind === "skill_create") {
    return {
      title: t("agent.taskPresentation.skillCreate.title", {
        name: presentation.resourceName,
      }),
      description:
        presentation.imageCount > 0
          ? t("agent.taskPresentation.skillCreate.descriptionWithImages", {
              count: presentation.imageCount,
            })
          : t("agent.taskPresentation.skillCreate.description"),
    };
  }
  return {
    title: t("agent.taskPresentation.brandPublish.title", {
      name: presentation.resourceName,
    }),
    description: t("agent.taskPresentation.brandPublish.description"),
  };
}
