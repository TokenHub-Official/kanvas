import {
  ArrowLeftOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  DownloadOutlined,
  ExclamationCircleFilled,
  FolderAddOutlined,
  InfoCircleOutlined,
  LoadingOutlined,
  PlusOutlined,
  StopOutlined,
} from "@ant-design/icons";
import type {
  WorkflowAuthoringCapability,
  WorkflowRunDetails,
  WorkflowTemplate,
} from "@kanvas/contracts/api";
import { projectWorkflowAuthoringGraph } from "@kanvas/contracts/workflow-authoring";
import { useMutation, useQuery } from "@tanstack/react-query";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import {
  Alert,
  App as AntApp,
  Button,
  Collapse,
  Popconfirm,
  Progress,
  Skeleton,
  Tag,
} from "antd";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ulid } from "ulid";

import {
  cancelWorkflowRun,
  createCanvasDraft,
  createWorkspaceAssetFromArtifact,
  decideWorkflowApproval,
  downloadArtifact,
  fetchBrandKitRevision,
  fetchWorkflowAuthoringCapabilities,
  fetchWorkflowCandidate,
  fetchWorkflowRun,
  fetchWorkflowTemplate,
} from "../api/transport.js";
import { BrowserRuntimeNotice } from "../features/browser-executor/browser-runtime-notice.js";
import workingIllustration from "../assets/icons/ant-design/EditOutlined.svg";
import { ArtifactPreview } from "../components/artifact-preview.js";
import { DoodleIcon } from "../components/doodle-icon.js";
import { PageEmptyState } from "../components/feedback.js";
import { StatusTag } from "../components/status-tag.js";
import { useDocumentTitle } from "../components/use-document-title.js";
import { WorkspaceBoundary } from "../components/workspace-page.js";
import { createWorkflowResultDraftV1 } from "../features/editor/workflow-result-draft-v1.js";
import { useBrowserRuntimes } from "../features/browser-executor/use-browser-runtimes.js";
import {
  brandSocialStarterBackgroundColorV1,
  brandSocialStarterCanvasSizeV1,
  brandSocialStarterHeadlineV1,
} from "../features/workflows/brand-social-starter-v1.js";
import { workflowCapabilityText } from "../features/workflows/workflow-capability-authoring-profile-v1.js";
import { WorkflowApprovalCard } from "../features/workflows/workflow-approval-card.js";
import { workflowApprovalDecisionFingerprint } from "../features/workflows/workflow-approval-decision.js";
import {
  workflowRunAvailableArtifacts,
  type WorkflowRunArtifactV1,
} from "../features/workflows/workflow-run-artifacts-v1.js";
import {
  completeWorkflowRunAssetAdoption,
  prepareWorkflowRunAssetAdoption,
  type WorkflowRunAssetAdoptions,
} from "../features/workflows/workflow-run-asset-adoption.js";
import {
  workflowRunCompletedStepCountV1,
  workflowRunDisplayOutputFields,
  workflowRunExperienceStateV1,
  workflowRunIsTerminalV1,
  workflowRunPollIntervalV1,
  workflowRunProgressV1,
  workflowRunSourceArtifactIdsV1,
} from "../features/workflows/workflow-run-session-v1.js";
import { queryClient } from "../query-client.js";

const routeApi = getRouteApi("/w/$workspaceId/workflow-runs/$workflowRunId");
const noCapabilityKeys: readonly string[] = Object.freeze([]);

function runStatusColor(
  status: string,
  outcome?: WorkflowRunDetails["outcome"],
): "success" | "error" | "processing" | "warning" | "default" {
  if (outcome === "partial_success") return "warning";
  if (outcome === "no_usable_output") return "error";
  if (status === "completed") return "success";
  if (status === "failed" || status === "cancelled") return "error";
  if (status === "waiting") return "warning";
  if (status === "queued" || status === "running" || status === "cancelling") {
    return "processing";
  }
  return "default";
}

function artifactFilename(blob: Blob, title: string): string {
  let extension = "bin";
  if (blob.type.includes("png")) extension = "png";
  else if (blob.type.includes("webp")) extension = "webp";
  else if (blob.type.includes("jpeg")) extension = "jpg";
  return `${title}.${extension}`;
}

function runStatusIcon(
  status: string,
  outcome: WorkflowRunDetails["outcome"],
): React.JSX.Element | null {
  if (outcome === "partial_success") {
    return <ExclamationCircleFilled className="text-2xl text-warning" />;
  }
  if (outcome === "no_usable_output") {
    return <CloseCircleFilled className="text-2xl text-danger" />;
  }
  if (status === "completed") {
    return <CheckCircleFilled className="text-2xl text-success" />;
  }
  if (status === "failed" || status === "cancelled") {
    return <CloseCircleFilled className="text-2xl text-danger" />;
  }
  return null;
}

function nodeDisplayName(
  node: WorkflowRunDetails["nodes"][number],
  template: WorkflowTemplate | undefined,
  capabilities: readonly WorkflowAuthoringCapability[],
  language: string,
): string {
  const topologyNode = template?.topology.nodes.find(
    (candidate) => candidate.key === node.nodeKey,
  );
  let reference:
    { readonly contractId: string; readonly revision: number } | undefined;
  if (topologyNode && "capability" in topologyNode && topologyNode.capability) {
    reference = topologyNode.capability;
  } else if (topologyNode && "invoke" in topologyNode) {
    reference = topologyNode.invoke.capability;
  }
  const capability = reference
    ? capabilities.find(
        (item) =>
          item.contractId === reference.contractId &&
          item.revision === reference.revision,
      )
    : undefined;
  return capability
    ? workflowCapabilityText(capability.authoring.catalog.title, language)
    : node.nodeKey;
}

function WorkflowOutputValue({ value }: { readonly value: unknown }) {
  if (typeof value === "string") {
    return (
      <p className="m-0 whitespace-pre-wrap break-words text-sm leading-6 text-white">
        {value}
      </p>
    );
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return <p className="m-0 text-sm leading-6 text-white">{String(value)}</p>;
  }
  return (
    <pre className="m-0 max-h-[42svh] overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-6 text-white">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function workflowOutputFieldLabel(
  field: ReturnType<typeof workflowRunDisplayOutputFields>[number],
): string | undefined {
  if (field.label) return field.label;
  return field.key === "output" ? undefined : field.key;
}

function ResultStage({
  active,
  artifacts,
  currentActivity,
  emptyDescription,
  emptyTitle,
  outputFields,
  selectedArtifactId,
  sourceArtifactId,
  title,
  workspaceId,
  onSelect,
}: {
  readonly active: boolean;
  readonly artifacts: readonly WorkflowRunArtifactV1[];
  readonly currentActivity: string;
  readonly emptyDescription: string;
  readonly emptyTitle: string;
  readonly outputFields: ReturnType<typeof workflowRunDisplayOutputFields>;
  readonly selectedArtifactId?: string;
  readonly sourceArtifactId?: string;
  readonly title: string;
  readonly workspaceId: string;
  readonly onSelect: (artifactId: string) => void;
}): React.JSX.Element {
  const { i18n, t } = useTranslation();
  const visibleArtifactId = selectedArtifactId ?? artifacts[0]?.artifactId;
  if (visibleArtifactId) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center gap-4 px-5 pb-6 sm:px-10 lg:px-12">
        <ArtifactPreview
          alt={t("workflows.runSession.resultAlt", { name: title })}
          artifactId={visibleArtifactId}
          imageClassName="aspect-[4/3] max-h-[66svh] w-full max-w-[820px] rounded-[22px] bg-black/20 object-contain shadow-[0_28px_80px_rgb(0_0_0_/_38%)]"
          workspaceId={workspaceId}
        />
        {artifacts.length > 1 ? (
          <div
            aria-label={t("workflows.runSession.resultsLabel")}
            className="flex max-w-full gap-2 overflow-x-auto rounded-[16px] bg-black/25 p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            role="list"
          >
            {artifacts.map((artifact) => (
              <button
                aria-pressed={visibleArtifactId === artifact.artifactId}
                className="shrink-0 rounded-[12px] border border-white/15 bg-white/6 p-1 transition-colors hover:border-white/45 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-acid aria-pressed:border-acid"
                key={`${artifact.fieldKey}:${artifact.artifactId}`}
                onClick={() => onSelect(artifact.artifactId)}
                type="button"
              >
                <ArtifactPreview
                  alt={workflowCapabilityText(artifact.label, i18n.language)}
                  artifactId={artifact.artifactId}
                  imageClassName="size-16 rounded-[8px] object-cover sm:size-20"
                  thumbnail
                  workspaceId={workspaceId}
                />
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  }
  if (!active && outputFields.length > 0) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center px-5 pb-8 sm:px-10 lg:px-12">
        <section
          aria-labelledby="workflow-run-output-title"
          className="w-full max-w-[760px] rounded-[22px] bg-white/8 p-5 shadow-[0_28px_80px_rgb(0_0_0_/_24%)] sm:p-7"
        >
          <h2
            className="m-0 mb-5 text-xs font-bold tracking-[0.08em] text-white/60 uppercase"
            id="workflow-run-output-title"
          >
            {t("workflows.editor.workflowOutput")}
          </h2>
          <dl className="m-0 grid gap-5">
            {outputFields.map((field) => (
              <div className="grid gap-1.5" key={field.key}>
                {workflowOutputFieldLabel(field) ? (
                  <dt className="text-xs font-semibold text-white/60">
                    {workflowOutputFieldLabel(field)}
                  </dt>
                ) : null}
                <dd className="m-0">
                  <WorkflowOutputValue value={field.value} />
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    );
  }
  if (sourceArtifactId) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center px-5 pb-6 sm:px-10 lg:px-12">
        <div className="relative w-full max-w-[760px]">
          <ArtifactPreview
            alt={t("workflows.runSession.sourceAlt")}
            artifactId={sourceArtifactId}
            imageClassName={`aspect-[4/3] max-h-[62svh] w-full rounded-[22px] bg-black/20 object-contain shadow-[0_28px_80px_rgb(0_0_0_/_38%)] transition-opacity duration-300 ${active ? "opacity-55" : "opacity-75"}`}
            workspaceId={workspaceId}
          />
          <span className="absolute top-4 left-4 rounded-full bg-black/65 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-sm">
            {t("workflows.runSession.inputBadge")}
          </span>
          {active ? (
            <div className="absolute inset-x-4 bottom-4 flex items-center gap-3 rounded-[16px] bg-black/70 px-4 py-3 text-white backdrop-blur-md">
              <LoadingOutlined className="shrink-0 text-lg text-acid" spin />
              <strong className="text-sm">{currentActivity}</strong>
            </div>
          ) : null}
        </div>
      </div>
    );
  }
  return (
    <div className="grid min-h-0 flex-1 place-items-center px-6 pb-8 text-center">
      <div className="grid max-w-sm justify-items-center gap-5 text-white">
        <DoodleIcon
          aspectRatio="241 / 211"
          className="h-48 w-auto text-white sm:h-60"
          source={workingIllustration}
        />
        <div>
          <h2 className="m-0 text-2xl font-bold tracking-[-0.03em]">
            {active ? currentActivity : emptyTitle}
          </h2>
          {active || emptyDescription ? (
            <p className="mt-2 mb-0 text-sm leading-6 text-white/65">
              {active
                ? t("workflows.runSession.stageWaitingDescription")
                : emptyDescription}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function WorkflowRunPage(): React.JSX.Element {
  const { workflowRunId, workspaceId } = routeApi.useParams();
  return (
    <WorkspaceBoundary workspaceId={workspaceId}>
      {({ context, workspace }) => (
        <WorkflowRunSession
          canCreateCanvas={
            workspace.permissions.includes("asset.write") &&
            workspace.permissions.includes("canvas.write")
          }
          canRun={workspace.permissions.includes("workflow.run")}
          canDecide={workspace.permissions.includes("approval.decide")}
          canSave={workspace.permissions.includes("asset.write")}
          csrfToken={context.csrfToken}
          workflowRunId={workflowRunId}
          workspaceId={workspace.id}
        />
      )}
    </WorkspaceBoundary>
  );
}

function WorkflowRunSession({
  canCreateCanvas,
  canDecide,
  canRun,
  canSave,
  csrfToken,
  workflowRunId,
  workspaceId,
}: {
  readonly canCreateCanvas: boolean;
  readonly canDecide: boolean;
  readonly canRun: boolean;
  readonly canSave: boolean;
  readonly csrfToken: string;
  readonly workflowRunId: string;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { i18n, t } = useTranslation();
  const { notification } = AntApp.useApp();
  const navigate = useNavigate();
  const [selectedArtifactId, setSelectedArtifactId] = useState<string>();
  const [browserRestartKey, setBrowserRestartKey] = useState(0);
  const approvalDecisionIdsRef = useRef(
    new Map<string, { readonly fingerprint: string; readonly id: string }>(),
  );
  const assetAdoptionsRef = useRef<WorkflowRunAssetAdoptions>({});
  const [assetAdoptions, setAssetAdoptions] =
    useState<WorkflowRunAssetAdoptions>({});
  const canvasRequestRef = useRef<
    | {
        readonly artifactId: string;
        readonly document: ReturnType<typeof createWorkflowResultDraftV1>;
        readonly idempotencyKey: string;
      }
    | undefined
  >(undefined);
  const run = useQuery({
    queryKey: ["workflow-run", workspaceId, workflowRunId],
    queryFn: () => fetchWorkflowRun(workspaceId, workflowRunId),
    refetchInterval: (query) => workflowRunPollIntervalV1(query.state.data),
    refetchIntervalInBackground: false,
    retry: false,
  });
  const revisionId = run.data?.workflowRevisionId;
  const template = useQuery({
    queryKey: ["workflow-template", workspaceId, revisionId],
    queryFn: () => fetchWorkflowTemplate(workspaceId, revisionId!),
    enabled: Boolean(revisionId),
    retry: false,
  });
  const candidateId = run.data?.publicationCandidateId;
  const candidate = useQuery({
    queryKey: ["workflow-candidate", workspaceId, candidateId],
    queryFn: () => fetchWorkflowCandidate(workspaceId, candidateId!),
    enabled: Boolean(candidateId),
    retry: false,
  });
  const capabilities = useQuery({
    queryKey: ["workflow-authoring-capabilities", workspaceId],
    queryFn: () => fetchWorkflowAuthoringCapabilities(workspaceId),
    retry: false,
  });
  const runBrand = run.data?.brand;
  const brandRevision = useQuery({
    queryKey: runBrand
      ? [
          "brand-kit-revision",
          workspaceId,
          runBrand.brandKitId,
          runBrand.brandKitRevisionId,
        ]
      : ["brand-kit-revision", workspaceId, "workflow-result"],
    queryFn: () =>
      fetchBrandKitRevision(
        workspaceId,
        runBrand!.brandKitId,
        runBrand!.brandKitRevisionId,
      ),
    enabled: Boolean(runBrand),
    retry: false,
    staleTime: 30_000,
  });
  const candidateDocument = candidate.data?.candidate.contentDocument;
  const title =
    template.data?.displayName ??
    candidateDocument?.presentation?.title ??
    t("workflows.runSession.title");
  useDocumentTitle(
    t("workflows.runSession.documentTitle", {
      name: title,
    }),
  );
  const graph = useMemo(() => {
    if (candidateDocument) {
      return projectWorkflowAuthoringGraph(candidateDocument);
    }
    return template.data
      ? projectWorkflowAuthoringGraph({
          schemaVersion: 1,
          inputSchema: template.data.inputSchema,
          outputSchema: template.data.outputSchema,
          topology: template.data.topology,
        })
      : undefined;
  }, [candidateDocument, template.data]);
  const availableArtifacts = useMemo(
    () =>
      run.data && graph
        ? workflowRunAvailableArtifacts(
            run.data,
            graph,
            capabilities.data?.items ?? [],
          )
        : [],
    [capabilities.data?.items, graph, run.data],
  );
  const outputFields = useMemo(
    () =>
      workflowRunDisplayOutputFields(
        run.data?.output,
        template.data?.outputSchema ?? candidateDocument?.outputSchema,
      ),
    [
      candidateDocument?.outputSchema,
      run.data?.output,
      template.data?.outputSchema,
    ],
  );
  const sourceArtifacts = useMemo(
    () =>
      workflowRunSourceArtifactIdsV1(
        template.data?.effectiveInvocationSchema,
        run.data?.input,
      ),
    [run.data?.input, template.data?.effectiveInvocationSchema],
  );
  const visibleArtifact =
    availableArtifacts.find(
      (artifact) => artifact.artifactId === selectedArtifactId,
    ) ?? availableArtifacts[0];
  const visibleAssetAdoption = visibleArtifact
    ? assetAdoptions[visibleArtifact.artifactId]
    : undefined;
  const active = Boolean(run.data) && !workflowRunIsTerminalV1(run.data);
  const browserCapabilityKeys =
    run.data?.browserExecution?.requiredCapabilityKeys ?? noCapabilityKeys;
  const browserExecutionRequired = active && browserCapabilityKeys.length > 0;
  const browserRuntimeState = useBrowserRuntimes({
    csrfToken,
    enabled: canRun && browserExecutionRequired,
    requiredCapabilityKeys: browserCapabilityKeys,
    restartKey: browserRestartKey,
    workspaceId,
  });
  const experienceState = run.data
    ? workflowRunExperienceStateV1(run.data.lifecycleStatus, run.data.outcome)
    : "preparing";
  const completedSteps = run.data
    ? workflowRunCompletedStepCountV1(run.data.nodes)
    : 0;
  const progress = run.data ? workflowRunProgressV1(run.data.nodes) : 0;
  const currentNode = run.data?.nodes.find(
    (node) =>
      node.lifecycleStatus === "running" || node.lifecycleStatus === "waiting",
  );

  const cancel = useMutation({
    mutationFn: () =>
      cancelWorkflowRun({ csrfToken, workspaceId }, workflowRunId, {
        reasonCode: "user_requested",
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["workflow-run", workspaceId, workflowRunId],
      });
    },
    onError: () => {
      notification.error({
        title: t("workflows.runSession.cancelError"),
        description: t("workflows.runSession.cancelErrorDescription"),
      });
    },
  });
  const decideApproval = useMutation({
    mutationFn: async ({
      approvalRequestId,
      decision,
    }: {
      readonly approvalRequestId: string;
      readonly decision: Readonly<Record<string, unknown>>;
    }) => {
      const fingerprint = workflowApprovalDecisionFingerprint(decision);
      const current = approvalDecisionIdsRef.current.get(approvalRequestId);
      const idempotencyKey =
        current?.fingerprint === fingerprint ? current.id : ulid();
      approvalDecisionIdsRef.current.set(approvalRequestId, {
        fingerprint,
        id: idempotencyKey,
      });
      return decideWorkflowApproval(
        { csrfToken, workspaceId },
        workflowRunId,
        { approvalRequestId, decision },
        idempotencyKey,
      );
    },
    onSuccess: async (result) => {
      approvalDecisionIdsRef.current.delete(result.approvalRequestId);
      await queryClient.invalidateQueries({
        queryKey: ["workflow-run", workspaceId, workflowRunId],
      });
      notification.success({
        title: t("workflows.runSession.approval.recorded"),
      });
    },
    onError: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["workflow-run", workspaceId, workflowRunId],
      });
      notification.error({
        title: t("workflows.runSession.approval.errorTitle"),
        description: t("workflows.runSession.approval.errorDescription"),
      });
    },
  });
  const download = useMutation({
    mutationFn: async () => {
      if (!visibleArtifact) throw new Error("No result artifact.");
      const blob = await downloadArtifact(
        workspaceId,
        visibleArtifact.artifactId,
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = artifactFilename(blob, title);
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    },
    onError: () => {
      notification.error({
        title: t("workflows.runSession.downloadError"),
        description: t("workflows.runSession.downloadErrorDescription"),
      });
    },
  });
  const save = useMutation({
    mutationFn: async (artifact: WorkflowRunArtifactV1) => {
      const prepared = prepareWorkflowRunAssetAdoption(
        assetAdoptionsRef.current,
        artifact.artifactId,
        ulid,
      );
      assetAdoptionsRef.current = prepared.state;
      setAssetAdoptions(prepared.state);
      const resultIndex =
        availableArtifacts.findIndex(
          (candidate) => candidate.artifactId === artifact.artifactId,
        ) + 1;
      const result = await createWorkspaceAssetFromArtifact(
        { csrfToken, workspaceId },
        {
          assetId: prepared.adoption.idempotencyKey,
          artifactId: artifact.artifactId,
          name: t("workflows.runSession.savedAssetResultName", {
            name: title,
            result: workflowCapabilityText(artifact.label, i18n.language),
            index: resultIndex,
          }),
        },
      );
      return { artifactId: artifact.artifactId, result };
    },
    onSuccess: async ({ artifactId, result }) => {
      const next = completeWorkflowRunAssetAdoption(
        assetAdoptionsRef.current,
        artifactId,
        result.assetId,
      );
      assetAdoptionsRef.current = next;
      setAssetAdoptions(next);
      await queryClient.invalidateQueries({
        queryKey: ["workspace-assets", workspaceId],
      });
      notification.success({
        title: t("workflows.runSession.saved"),
        description: t("workflows.runSession.savedDescription"),
      });
    },
    onError: () => {
      notification.error({
        title: t("workflows.runSession.saveError"),
        description: t("workflows.runSession.saveErrorDescription"),
      });
    },
  });
  const continueInCanvas = useMutation({
    mutationFn: async () => {
      if (!visibleArtifact || !run.data) {
        throw new Error("No result is available for Canvas.");
      }
      if (run.data.brand && !brandRevision.data) {
        throw new Error("Brand content is unavailable.");
      }
      const current = canvasRequestRef.current;
      const backgroundColor = brandSocialStarterBackgroundColorV1(
        run.data.input,
      );
      const request =
        current?.artifactId === visibleArtifact.artifactId
          ? current
          : {
              artifactId: visibleArtifact.artifactId,
              idempotencyKey: ulid(),
              document: createWorkflowResultDraftV1({
                workspaceId,
                runId: workflowRunId,
                artifactId: visibleArtifact.artifactId,
                sourceTitle: title,
                headline: brandSocialStarterHeadlineV1(run.data.input),
                ...(backgroundColor ? { backgroundColor } : {}),
                intrinsicSize: brandSocialStarterCanvasSizeV1(run.data.output),
                nodeIds: {
                  image: `result-${ulid()}`,
                  text: `headline-${ulid()}`,
                },
                ...(brandRevision.data
                  ? { brandRevision: brandRevision.data }
                  : {}),
              }),
            };
      canvasRequestRef.current = request;
      return createCanvasDraft(
        { csrfToken, workspaceId },
        {
          document: request.document,
          brandKitRevisionId: run.data.brand?.brandKitRevisionId ?? null,
        },
        request.idempotencyKey,
      );
    },
    onSuccess: async (result) => {
      await navigate({
        to: "/w/$workspaceId/boards/$canvasDraftId",
        params: { workspaceId, canvasDraftId: result.draft.id },
        search: { importImage: false },
      });
    },
    onError: () => {
      notification.error({
        title: t("workflows.runSession.canvasError"),
        description: t("workflows.runSession.canvasErrorDescription"),
      });
    },
  });

  if (run.isPending) {
    return (
      <main className="grid min-h-svh bg-canvas lg:grid-cols-[minmax(0,1.1fr)_minmax(420px,0.9fr)]">
        <div className="min-h-[52svh] bg-canvas" />
        <div className="bg-paper p-7 lg:p-10">
          <Skeleton active paragraph={{ rows: 8 }} />
        </div>
      </main>
    );
  }
  if (run.isError || !run.data) {
    return (
      <main className="grid min-h-svh place-items-center bg-mist p-6">
        <PageEmptyState
          action={() => void run.refetch()}
          actionLabel={t("workflows.runSession.reload")}
          title={t("workflows.runSession.loadError")}
        >
          {t("workflows.runSession.loadErrorDescription")}
        </PageEmptyState>
      </main>
    );
  }

  const nodeNames = new Map(
    run.data.nodes.map((node) => [
      node.id,
      nodeDisplayName(
        node,
        template.data,
        capabilities.data?.items ?? [],
        i18n.language,
      ),
    ]),
  );
  const partialOutcome = run.data.outcome === "partial_success";
  const noUsableOutcome = run.data.outcome === "no_usable_output";
  const incompleteOutcome =
    run.data.lifecycleStatus === "failed" || noUsableOutcome;
  const partialDescriptionKey =
    availableArtifacts.length > 0
      ? "workflows.runSession.partialDescription"
      : "workflows.runSession.partialWithoutResultsDescription";
  let terminalStatusKey: string = run.data.lifecycleStatus;
  if (partialOutcome) terminalStatusKey = "partial";
  else if (noUsableOutcome) {
    terminalStatusKey =
      availableArtifacts.length > 0 ? "failed" : "noUsableOutput";
  }
  const currentActivity =
    experienceState === "working" && currentNode
      ? t("workflows.runSession.workingOn", {
          name: nodeNames.get(currentNode.id),
        })
      : t(`workflows.runSession.activity.${experienceState}`);
  const userHeading = active
    ? t(`workflows.runSession.heading.${experienceState}`)
    : title;
  const headerDescription = active
    ? t(
        browserExecutionRequired
          ? "workflows.runSession.browser.activeDescription"
          : "workflows.runSession.activeDescription",
      )
    : (template.data?.description ??
      candidateDocument?.presentation?.description);
  return (
    <main
      className="grid min-h-svh bg-canvas lg:max-h-svh lg:grid-cols-[minmax(0,1.1fr)_minmax(420px,0.9fr)] lg:overflow-hidden"
      id="kanvas-main-content"
    >
      <section className="flex min-h-[58svh] min-w-0 flex-col bg-canvas text-white lg:min-h-svh">
        <header className="flex min-h-16 items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <Link
            className="inline-flex min-h-11 items-center gap-2 rounded-[12px] px-3 text-sm font-semibold text-white/75 no-underline transition-colors hover:bg-white/8 hover:text-white focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-acid"
            params={{ workspaceId }}
            to="/w/$workspaceId/workflow-templates"
          >
            <ArrowLeftOutlined />
            {t("workflows.runSession.back")}
          </Link>
          {active ? (
            <span className="text-xs font-semibold text-white/55">
              {t(
                browserExecutionRequired
                  ? "workflows.runSession.browser.keepOpenShort"
                  : "workflows.runSession.backgroundContinuesShort",
              )}
            </span>
          ) : (
            <StatusTag className="px-3 py-1" tone="inverse">
              {t(`workflows.runSession.terminal.${terminalStatusKey}`)}
            </StatusTag>
          )}
        </header>
        <ResultStage
          active={active}
          artifacts={availableArtifacts}
          currentActivity={currentActivity}
          emptyDescription={
            incompleteOutcome
              ? t("workflows.runSession.noAvailableResultDescription")
              : ""
          }
          emptyTitle={t(
            incompleteOutcome
              ? "workflows.runSession.noAvailableResult"
              : "workflows.runSession.terminal.complete",
          )}
          onSelect={setSelectedArtifactId}
          outputFields={outputFields}
          title={title}
          workspaceId={workspaceId}
          {...(visibleArtifact
            ? { selectedArtifactId: visibleArtifact.artifactId }
            : {})}
          {...(active && sourceArtifacts[0]
            ? { sourceArtifactId: sourceArtifacts[0] }
            : {})}
        />
      </section>

      <aside className="min-w-0 overflow-y-auto bg-paper px-5 py-6 text-ink sm:px-8 sm:py-8 lg:px-10 lg:py-10">
        <div className="mx-auto grid w-full max-w-[620px] content-start gap-7">
          <header>
            <p className="m-0 text-xs font-bold tracking-[0.08em] text-primary uppercase">
              {active ? title : t("workflows.runSession.eyebrow")}
            </p>
            <h1 className="mt-2 mb-0 text-[clamp(30px,4vw,46px)] leading-[1.05] font-bold tracking-[-0.045em] text-ink">
              {userHeading}
            </h1>
            {headerDescription ? (
              <p className="mt-3 mb-0 text-sm leading-6 text-muted">
                {headerDescription}
              </p>
            ) : null}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-muted">
                {t("workflows.runSession.brandContext")}
              </span>
              <StatusTag tone={run.data.brand ? "info" : "neutral"}>
                {run.data.brand?.name ?? t("studio.home.withoutBrand")}
              </StatusTag>
            </div>
          </header>

          {run.data.pendingApprovals?.map((approval) => (
            <WorkflowApprovalCard
              approval={approval}
              canDecide={canDecide}
              key={approval.id}
              onDecide={(approvalRequestId, decision) =>
                decideApproval.mutate({ approvalRequestId, decision })
              }
              submitting={
                decideApproval.isPending &&
                decideApproval.variables?.approvalRequestId === approval.id
              }
            />
          ))}

          {active ? (
            <section
              aria-live="polite"
              className="grid gap-5 border-y border-line py-6"
              role="status"
            >
              <div className="flex items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/8 text-primary">
                  <LoadingOutlined className="text-lg" spin />
                </span>
                <div>
                  <strong className="block text-base text-ink">
                    {currentActivity}
                  </strong>
                  <span className="mt-1 block text-xs leading-5 text-muted">
                    {t("workflows.runSession.usualDuration")}
                  </span>
                </div>
              </div>
              <Progress
                percent={progress}
                railColor="var(--mist-deep)"
                showInfo={false}
                status="active"
                strokeColor="var(--primary)"
              />
              {browserExecutionRequired ? (
                <BrowserRuntimeNotice
                  canRun={canRun}
                  onReconnect={() =>
                    setBrowserRestartKey((current) => current + 1)
                  }
                  state={browserRuntimeState}
                />
              ) : (
                <p className="m-0 flex items-start gap-2 text-xs leading-5 text-muted">
                  <InfoCircleOutlined className="mt-1 shrink-0 text-primary" />
                  {t("workflows.runSession.backgroundContinues")}
                </p>
              )}
            </section>
          ) : (
            <section
              aria-live="polite"
              className="grid gap-4 rounded-[20px] bg-mist p-5"
              role="status"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <strong className="block text-base text-ink">
                    {t(`workflows.runSession.terminal.${terminalStatusKey}`)}
                  </strong>
                  <span className="mt-1 block text-xs leading-5 text-muted">
                    {t("workflows.runSession.progress", {
                      completed: completedSteps,
                      total: run.data.nodes.length,
                    })}
                  </span>
                </div>
                {runStatusIcon(run.data.lifecycleStatus, run.data.outcome)}
              </div>
              <Progress
                percent={progress}
                railColor="var(--paper)"
                showInfo={false}
                strokeColor={
                  partialOutcome ? "var(--warning)" : "var(--primary)"
                }
                {...(incompleteOutcome ? { status: "exception" as const } : {})}
              />
            </section>
          )}

          {partialOutcome ? (
            <Alert
              description={t(partialDescriptionKey, {
                count: availableArtifacts.length,
              })}
              showIcon
              title={t("workflows.runSession.partialTitle")}
              type="warning"
            />
          ) : null}

          {incompleteOutcome ? (
            <Alert
              description={t(
                availableArtifacts.length > 0
                  ? "workflows.runSession.failedWithResultsDescription"
                  : "workflows.runSession.failedWithoutResultsDescription",
                { count: availableArtifacts.length },
              )}
              showIcon
              title={t("workflows.runSession.failedTitle")}
              type="error"
            />
          ) : null}

          {visibleArtifact ? (
            <section aria-labelledby="workflow-run-actions-title">
              <h2
                className="m-0 mb-3 text-sm font-bold text-ink"
                id="workflow-run-actions-title"
              >
                {t(
                  partialOutcome || incompleteOutcome
                    ? "workflows.runSession.availableResultActions"
                    : "workflows.runSession.resultActions",
                )}
              </h2>
              <div className="grid gap-2 sm:grid-cols-2">
                <Button
                  className="sm:col-span-2"
                  disabled={
                    !canCreateCanvas ||
                    (Boolean(run.data.brand) &&
                      (brandRevision.isPending || brandRevision.isError))
                  }
                  icon={<PlusOutlined />}
                  loading={continueInCanvas.isPending}
                  onClick={() => continueInCanvas.mutate()}
                  size="large"
                  type="primary"
                >
                  {t("workflows.runSession.continueInCanvas")}
                </Button>
                <Button
                  icon={<DownloadOutlined />}
                  loading={download.isPending}
                  onClick={() => download.mutate()}
                  size="large"
                >
                  {t("workflows.runSession.download")}
                </Button>
                {visibleAssetAdoption?.assetId ? (
                  <Link
                    className="inline-flex min-h-10 items-center justify-center gap-2 rounded-[10px] bg-[var(--control-fill-rest)] px-4 text-sm font-semibold text-ink no-underline transition-colors hover:bg-[var(--control-fill-hover)] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    params={{
                      assetId: visibleAssetAdoption.assetId,
                      workspaceId,
                    }}
                    to="/w/$workspaceId/assets/$assetId"
                  >
                    <FolderAddOutlined />
                    {t("workflows.runSession.viewAsset")}
                  </Link>
                ) : (
                  <Button
                    disabled={!canSave || save.isPending}
                    icon={<FolderAddOutlined />}
                    loading={
                      save.isPending &&
                      save.variables?.artifactId === visibleArtifact.artifactId
                    }
                    onClick={() => save.mutate(visibleArtifact)}
                    size="large"
                  >
                    {t("workflows.runSession.saveAsset")}
                  </Button>
                )}
              </div>
            </section>
          ) : null}

          <details
            className="border-t border-line pt-5"
            open={incompleteOutcome || partialOutcome}
          >
            <summary className="cursor-pointer text-sm font-bold text-muted hover:text-ink focus-visible:rounded-sm focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary">
              {t("workflows.runSession.processDetails")}
            </summary>
            <div className="mt-4">
              <Collapse
                bordered={false}
                className="bg-transparent"
                classNames={{
                  body: "border-0 bg-transparent px-4",
                  header: "bg-mist px-4",
                }}
                defaultActiveKey={run.data.nodes
                  .filter((node) => node.lifecycleStatus === "failed")
                  .map((node) => node.id)}
                items={run.data.nodes.map((node) => ({
                  className:
                    "mb-2 overflow-hidden rounded-[14px] border-0 last:mb-0",
                  key: node.id,
                  label: (
                    <span className="flex min-w-0 items-center justify-between gap-3">
                      <span className="min-w-0 truncate font-semibold text-ink">
                        {nodeNames.get(node.id)}
                      </span>
                      <Tag
                        className="!m-0 shrink-0"
                        color={runStatusColor(node.lifecycleStatus)}
                      >
                        {t(
                          `workflows.templateDetail.runStatus.${node.lifecycleStatus}`,
                        )}
                      </Tag>
                    </span>
                  ),
                  children: (
                    <div className="grid gap-3">
                      {node.error ? (
                        <Alert
                          description={t(
                            "workflows.runSession.stepErrorDescription",
                          )}
                          showIcon
                          title={t("workflows.runSession.stepError")}
                          type="error"
                        />
                      ) : null}
                    </div>
                  ),
                }))}
                size="small"
              />
            </div>
          </details>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-5">
            {active && canRun ? (
              <Popconfirm
                cancelText={t("workflows.runSession.keepRunning")}
                okButtonProps={{ danger: true }}
                okText={t("workflows.runSession.confirmCancel")}
                onConfirm={() => cancel.mutate()}
                title={t("workflows.runSession.cancelTitle")}
              >
                <Button
                  danger
                  icon={<StopOutlined />}
                  loading={cancel.isPending}
                  type="text"
                >
                  {t("workflows.runSession.cancel")}
                </Button>
              </Popconfirm>
            ) : null}
            {!active && revisionId ? (
              <Link
                className="inline-flex min-h-10 items-center rounded-[10px] px-3 text-sm font-semibold text-muted no-underline hover:bg-mist hover:text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary"
                params={{ workflowRevisionId: revisionId, workspaceId }}
                search={
                  run.data.brand
                    ? { brandKitId: run.data.brand.brandKitId }
                    : { withoutBrand: true }
                }
                to="/w/$workspaceId/workflow-templates/$workflowRevisionId"
              >
                {t("workflows.runSession.runAgain")}
              </Link>
            ) : null}
          </div>
        </div>
      </aside>
    </main>
  );
}
