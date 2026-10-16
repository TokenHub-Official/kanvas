import { SettingOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Skeleton } from "antd";
import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import {
  ApiProblem,
  fetchAgentHubSkill,
  fetchBrandKits,
  fetchWorkflowTemplates,
} from "../api/transport.js";
import { httpStatus } from "../api/http-status.js";
import type { AgentLinkedResource } from "./agent-detail-content.js";
import { SkillDetailContent } from "./skill-detail-content.js";

const BrandPreview = lazy(() =>
  import("../features/agent/agent-resource-workbench.js").then((module) => ({
    default: module.BrandResourceViewer,
  })),
);
const WorkflowPreview = lazy(() =>
  import("../features/agent/agent-resource-workbench.js").then((module) => ({
    default: module.WorkflowResourceViewer,
  })),
);

export function ConversationResourcePreview({
  resource,
  workspaceId,
  canReadAssets,
  managementHref,
  manageAgentHref,
  onBack,
}: {
  readonly resource: AgentLinkedResource;
  readonly workspaceId: string;
  readonly canReadAssets: boolean;
  readonly managementHref: string;
  readonly manageAgentHref?: string;
  readonly onBack: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const content = useQuery({
    queryKey: [
      "conversation-linked-resource",
      workspaceId,
      resource.kind,
      resource.id,
    ],
    queryFn: async () => {
      if (resource.kind === "skill")
        return {
          kind: "skill" as const,
          detail: await fetchAgentHubSkill(workspaceId, resource.id),
        };
      if (resource.kind === "brand") {
        const brands = await fetchBrandKits(workspaceId, {
          lifecycleStatus: "active",
        });
        const brand = brands.items.find((item) => item.id === resource.id);
        if (!brand?.latestPublishedRevision)
          throw new Error("resource_unavailable");
        return {
          kind: "brand" as const,
          item: {
            kind: "brand" as const,
            resourceId: brand.id,
            title: brand.name,
            brandKitRevisionId: brand.latestPublishedRevision.id,
            state: "available" as const,
          },
        };
      }
      const workflows = await fetchWorkflowTemplates(workspaceId);
      const workflow = workflows.items.find(
        (item) => item.workflowDefinitionId === resource.id,
      );
      if (!workflow) throw new Error("resource_unavailable");
      return {
        kind: "workflow" as const,
        item: {
          kind: "workflow" as const,
          resourceId: workflow.workflowRevisionId,
          title: workflow.displayName,
          state: "available" as const,
        },
      };
    },
    retry: false,
  });
  if (content.isPending)
    return (
      <div className="p-5">
        <Skeleton active />
      </div>
    );
  if (content.isError) {
    const error = content.error;
    let failure = "temporary";
    if (error instanceof Error && error.message === "resource_unavailable")
      failure = "unavailable";
    if (error instanceof ApiProblem) {
      if (error.status === httpStatus.notFound) failure = "unavailable";
      if (error.status === httpStatus.forbidden) failure = "forbidden";
      if (error.status === httpStatus.unauthorized) failure = "session";
      if (error.code === "skill_library.integrity") failure = "incomplete";
    }
    const needsManager = failure === "unavailable" || failure === "incomplete";
    const descriptionKey = needsManager
      ? `${failure}.${manageAgentHref ? "manager" : "member"}`
      : `${failure}.description`;
    return (
      <div className="p-5">
        <Alert
          type={failure === "temporary" ? "error" : "warning"}
          showIcon
          title={t(`agent.resourceRecovery.${failure}.title`, {
            type: t(`agent.referenceKind.${resource.kind}`),
          })}
          description={t(`agent.resourceRecovery.${descriptionKey}`)}
        />
        <div className="mt-4 flex flex-wrap gap-2">
          {failure === "temporary" ? (
            <Button type="primary" onClick={() => void content.refetch()}>
              {t("agent.retry")}
            </Button>
          ) : null}
          {failure === "session" ? (
            <Button type="primary" onClick={() => window.location.reload()}>
              {t("agent.resourceRecovery.signIn")}
            </Button>
          ) : null}
          {needsManager && manageAgentHref ? (
            <Button
              type="primary"
              href={manageAgentHref}
              icon={<SettingOutlined />}
            >
              {t("agent.polish.manageAgent")}
            </Button>
          ) : null}
          <Button onClick={onBack}>{t("agent.polish.backToAgent")}</Button>
        </div>
      </div>
    );
  }
  let body;
  if (content.data.kind === "skill") {
    const detail = content.data.detail;
    body = (
      <SkillDetailContent
        compact
        detail={detail}
        workspaceId={workspaceId}
        canReadAssets={canReadAssets}
        status={t(`agent.hub.skillRuntime.${detail.runtimeStatus}`)}
        source={{
          kind: "published",
          id: detail.id,
          revisionId: detail.skillRevisionId,
        }}
      />
    );
  } else {
    body = (
      <Suspense
        fallback={
          <div className="p-5">
            <Skeleton active />
          </div>
        }
      >
        {content.data.kind === "brand" ? (
          <BrandPreview item={content.data.item} workspaceId={workspaceId} />
        ) : (
          <WorkflowPreview item={content.data.item} workspaceId={workspaceId} />
        )}
      </Suspense>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-hidden">{body}</div>
      <footer className="shrink-0 border-t border-line p-4">
        <Button href={managementHref} icon={<SettingOutlined />}>
          {t("agent.polish.manageResource", {
            type: t(`agent.referenceKind.${resource.kind}`),
          })}
        </Button>
      </footer>
    </div>
  );
}
