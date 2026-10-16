import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  ExperimentOutlined,
  PlayCircleOutlined,
  SafetyCertificateOutlined,
  StopOutlined,
} from "@ant-design/icons";
import type {
  WorkflowAuthoringCapability,
  WorkflowCandidate,
  WorkflowCandidateReview,
  WorkflowDraft,
  WorkflowRunDetails,
} from "@kanvas/contracts/api";
import type { WorkflowAuthoringGraphV1 } from "@kanvas/contracts/workflow-authoring";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Alert,
  App as AntApp,
  Button,
  Collapse,
  Empty,
  Input,
  InputNumber,
  Select,
  Skeleton,
  Tabs,
  Tag,
} from "antd";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ulid } from "ulid";

import {
  cancelWorkflowRun,
  fetchWorkflowCandidate,
  fetchWorkflowCandidates,
  fetchWorkflowRun,
  publishWorkflowCandidate,
  recordWorkflowCandidateEval,
  reviewWorkflowCandidate,
  startWorkflowCandidateTest,
  submitWorkflowCandidate,
} from "../../api/transport.js";
import { queryClient } from "../../query-client.js";
import { ArtifactPreview } from "../../components/artifact-preview.js";
import {
  workflowLiteralValue,
  workflowSchemaFields,
  type WorkflowSchemaField,
} from "./workflow-authoring-model.js";
import { workflowAuthoringFieldKind } from "./workflow-authoring-field-schema-v1.js";
import {
  acceptWorkflowCandidateTestAttempt,
  prepareWorkflowCandidateTestAttempt,
  readWorkflowCandidateTestAttempt,
  workflowCandidateTestInputFingerprint,
  type WorkflowCandidateTestAttempt,
} from "./workflow-candidate-test-attempt.js";
import { WorkflowTestFileControl } from "./workflow-test-file-control.js";
import {
  workflowRunFinalArtifactsV1,
  workflowRunNodeArtifactsV1,
  type WorkflowRunArtifactV1,
} from "./workflow-run-artifacts-v1.js";
import { workflowCapabilityText } from "./workflow-capability-authoring-profile-v1.js";

const ACTIVE_RUN_FAST_POLL_INTERVAL_MS = 750;
const ACTIVE_RUN_SETTLED_POLL_INTERVAL_MS = 2_000;
const ACTIVE_RUN_FAST_POLL_WINDOW_MS = 30_000;

export type WorkflowCandidatePanelSection = "test" | "publish";

export function workflowCandidateIdForDraft(
  candidates: readonly Pick<WorkflowCandidate, "id" | "sourceDraftVersion">[],
  draftVersion: number,
): string | undefined {
  return candidates.find(
    (candidate) => candidate.sourceDraftVersion === draftVersion,
  )?.id;
}

function isTerminal(run: WorkflowRunDetails | undefined): boolean {
  return (
    run?.lifecycleStatus === "completed" ||
    run?.lifecycleStatus === "failed" ||
    run?.lifecycleStatus === "cancelled"
  );
}

export function workflowRunPollIntervalV1(
  run: WorkflowRunDetails | undefined,
  now = Date.now(),
): number | false {
  if (isTerminal(run)) return false;
  const createdAt = run ? Date.parse(run.createdAt) : Number.NaN;
  return Number.isFinite(createdAt) &&
    now - createdAt >= ACTIVE_RUN_FAST_POLL_WINDOW_MS
    ? ACTIVE_RUN_SETTLED_POLL_INTERVAL_MS
    : ACTIVE_RUN_FAST_POLL_INTERVAL_MS;
}

export type WorkflowPublicationPanelStateV1 =
  | "candidate_error"
  | "candidate_loading"
  | "candidate_missing"
  | "permission_denied"
  | "ready";

export function workflowPublicationPanelStateV1(options: {
  readonly canPublish: boolean;
  readonly candidateError: boolean;
  readonly candidateLoading: boolean;
  readonly hasCandidate: boolean;
}): WorkflowPublicationPanelStateV1 {
  if (!options.canPublish) return "permission_denied";
  if (options.candidateLoading) return "candidate_loading";
  if (options.candidateError) return "candidate_error";
  if (!options.hasCandidate) return "candidate_missing";
  return "ready";
}

function JsonBlock({ value }: { readonly value: unknown }): React.JSX.Element {
  return (
    <pre className="max-h-52 overflow-auto rounded-xl bg-canvas p-3 text-[11px] leading-5 text-white">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function testValueText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  return JSON.stringify(value, null, 2);
}

function runStatusColor(
  status: string,
  outcome?: WorkflowRunDetails["outcome"],
): "success" | "error" | "processing" | "warning" {
  if (outcome === "partial_success") return "warning";
  if (outcome === "no_usable_output") return "error";
  if (status === "completed") return "success";
  if (status === "failed" || status === "cancelled") return "error";
  return "processing";
}

function checkColor(outcome: string): "success" | "error" | "default" {
  if (outcome === "passed") return "success";
  if (outcome === "failed") return "error";
  return "default";
}

function checkIcon(outcome: string): React.JSX.Element | undefined {
  if (outcome === "passed") return <CheckCircleOutlined />;
  if (outcome === "failed") return <CloseCircleOutlined />;
  return undefined;
}

function hasTestValue(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null;
}

export function workflowCandidateTestValuesFromRun(
  input: unknown,
  fields: readonly WorkflowSchemaField[],
): Readonly<Record<string, unknown>> | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const record = input as Readonly<Record<string, unknown>>;
  return Object.fromEntries(
    fields.flatMap((field) =>
      Object.hasOwn(record, field.key)
        ? [[field.key, record[field.key]] as const]
        : [],
    ),
  );
}

export function workflowCandidateRecoveredTestInput(
  run: WorkflowRunDetails | undefined,
  runId: string | undefined,
  fields: readonly WorkflowSchemaField[],
): {
  readonly serialized: string;
  readonly values: Readonly<Record<string, unknown>> | undefined;
} {
  if (!run || run.id !== runId) {
    return { serialized: "{}", values: undefined };
  }
  return {
    serialized: testValueText(run.input) || "{}",
    values: workflowCandidateTestValuesFromRun(run.input, fields),
  };
}

function WorkflowArtifactResultCard({
  artifact,
  language,
  workspaceId,
}: {
  readonly artifact: WorkflowRunArtifactV1;
  readonly language: string;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const title = workflowCapabilityText(artifact.label, language);
  return (
    <figure className="m-0 grid min-w-0 gap-2 rounded-2xl bg-paper p-3 shadow-[0_10px_30px_rgb(28_30_45_/_7%)]">
      <ArtifactPreview
        alt={title}
        artifactId={artifact.artifactId}
        imageClassName="aspect-[4/3] max-h-72 w-full rounded-xl bg-mist object-contain"
        lazy
        thumbnail
        workspaceId={workspaceId}
      />
      <figcaption className="flex min-w-0 items-center justify-between gap-3 px-1">
        <strong className="truncate text-xs text-ink">{title}</strong>
        <span className="shrink-0 text-[10px] text-muted">
          {t("workflows.candidate.imageResult")}
        </span>
      </figcaption>
    </figure>
  );
}

function TestFieldControl({
  csrfToken,
  field,
  onBusyChange,
  onChange,
  value,
  workspaceId,
}: {
  readonly csrfToken: string;
  readonly field: WorkflowSchemaField;
  readonly onBusyChange: (busy: boolean) => void;
  readonly onChange: (value: unknown) => void;
  readonly value: unknown;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  function changeBoolean(nextValue: "false" | "true"): void {
    onChange(nextValue === "true");
  }
  const fieldKind = workflowAuthoringFieldKind(field.schema ?? {});
  if (fieldKind === "file" || fieldKind === "file_list") {
    return (
      <WorkflowTestFileControl
        csrfToken={csrfToken}
        field={field}
        onBusyChange={onBusyChange}
        onChange={onChange}
        value={value}
        workspaceId={workspaceId}
      />
    );
  }
  if (field.type === "boolean") {
    let selected: "false" | "true" | undefined;
    if (value === true) selected = "true";
    if (value === false) selected = "false";
    return (
      <Select
        onChange={changeBoolean}
        options={[
          { label: t("workflows.templateDetail.yes"), value: "true" },
          { label: t("workflows.templateDetail.no"), value: "false" },
        ]}
        value={selected ?? null}
        variant="filled"
      />
    );
  }
  if (field.type === "integer" || field.type === "number") {
    return (
      <InputNumber
        onChange={(nextValue) => onChange(nextValue ?? undefined)}
        placeholder={field.placeholder}
        value={(value as number | undefined) ?? null}
        variant="filled"
      />
    );
  }
  if (field.type === "object" || field.type === "array") {
    return (
      <Input.TextArea
        autoSize={{ minRows: 3, maxRows: 8 }}
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder={field.placeholder}
        spellCheck={false}
        value={testValueText(value)}
        variant="filled"
      />
    );
  }
  return (
    <Input
      onChange={(event) => onChange(event.currentTarget.value)}
      placeholder={field.placeholder}
      value={testValueText(value)}
      variant="filled"
    />
  );
}

export function WorkflowCandidatePanel({
  activeSection,
  canAuthor,
  canPublish,
  canRun,
  capabilities,
  csrfToken,
  draft,
  graph,
  hasUnsavedChanges,
  onRunActivityChange,
  onSectionChange,
  workspaceId,
}: {
  readonly activeSection: WorkflowCandidatePanelSection;
  readonly canAuthor: boolean;
  readonly canPublish: boolean;
  readonly canRun: boolean;
  readonly capabilities: readonly WorkflowAuthoringCapability[];
  readonly csrfToken: string;
  readonly draft: WorkflowDraft;
  readonly graph: WorkflowAuthoringGraphV1;
  readonly hasUnsavedChanges: boolean;
  readonly onRunActivityChange?: (active: boolean) => void;
  readonly onSectionChange: (section: WorkflowCandidatePanelSection) => void;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { notification } = AntApp.useApp();
  const { i18n, t } = useTranslation();
  const inputFields = useMemo(
    () => workflowSchemaFields(draft.draft.document.inputSchema),
    [draft.draft.document.inputSchema],
  );
  const nodeDisplayNames = useMemo(
    () =>
      new Map(
        graph.nodes.flatMap((node) =>
          node.type === "capability" || node.type === "batch"
            ? [[node.nodeKey, node.displayName] as const]
            : [],
        ),
      ),
    [graph.nodes],
  );
  const [selectedCandidateId, setSelectedCandidateId] = useState<string>();
  const [testInputEdit, setTestInputEdit] = useState<{
    readonly scopeKey: string;
    readonly value: string;
  }>();
  const [testValueEdits, setTestValueEdits] = useState<{
    readonly scopeKey: string;
    readonly values: Readonly<Record<string, unknown>>;
  }>();
  const [localRun, setLocalRun] = useState<{
    readonly candidateId: string;
    readonly runId: string;
  }>();
  const testAttemptRef = useRef<WorkflowCandidateTestAttempt | undefined>(
    undefined,
  );
  const reconciledTerminalRunRef = useRef<string | undefined>(undefined);
  const [uploadingFieldKeys, setUploadingFieldKeys] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const candidates = useQuery({
    queryKey: [
      "workflow-candidates",
      workspaceId,
      draft.definition.workflowKey,
    ],
    queryFn: () =>
      fetchWorkflowCandidates(workspaceId, draft.definition.workflowKey),
    retry: false,
  });
  const effectiveCandidateId =
    selectedCandidateId ?? candidates.data?.items[0]?.id;
  const currentDraftCandidateId = workflowCandidateIdForDraft(
    candidates.data?.items ?? [],
    draft.draft.version,
  );
  const candidate = useQuery({
    queryKey: ["workflow-candidate", workspaceId, effectiveCandidateId],
    queryFn: () => fetchWorkflowCandidate(workspaceId, effectiveCandidateId!),
    enabled: Boolean(effectiveCandidateId),
    retry: false,
  });
  const storedAttempt = useMemo(
    () =>
      effectiveCandidateId
        ? readWorkflowCandidateTestAttempt(workspaceId, effectiveCandidateId)
        : undefined,
    [effectiveCandidateId, workspaceId],
  );
  const localRunId =
    localRun && localRun.candidateId === effectiveCandidateId
      ? localRun.runId
      : undefined;
  const activeTestRunIds = candidate.data?.activeTestRunIds ?? [];
  const candidateHasActiveRuns = activeTestRunIds.length > 0;
  const runId =
    localRunId ??
    activeTestRunIds[0] ??
    candidate.data?.latestTestRunId ??
    storedAttempt?.runId;
  const managedTestRunIds = [
    ...new Set([...(runId ? [runId] : []), ...activeTestRunIds]),
  ];
  const run = useQuery({
    queryKey: ["workflow-run", workspaceId, runId],
    queryFn: () => fetchWorkflowRun(workspaceId, runId!),
    enabled: Boolean(runId),
    refetchInterval: (query) => workflowRunPollIntervalV1(query.state.data),
    refetchIntervalInBackground: false,
    retry: false,
  });
  const finalArtifacts = useMemo(
    () =>
      run.data
        ? workflowRunFinalArtifactsV1(run.data, graph, capabilities)
        : [],
    [capabilities, graph, run.data],
  );
  const runActive = Boolean(run.data) && !isTerminal(run.data);
  const runUnavailable = Boolean(runId) && run.isError;
  const inputScopeKey =
    runId ??
    effectiveCandidateId ??
    `${draft.draft.id}:${String(draft.draft.version)}`;
  const recoveredInput = useMemo(
    () => workflowCandidateRecoveredTestInput(run.data, runId, inputFields),
    [inputFields, run.data, runId],
  );
  const testValues = useMemo(
    () => ({
      ...recoveredInput.values,
      ...(testValueEdits?.scopeKey === inputScopeKey
        ? testValueEdits.values
        : {}),
    }),
    [inputScopeKey, recoveredInput.values, testValueEdits],
  );
  const testInput =
    testInputEdit?.scopeKey === inputScopeKey
      ? testInputEdit.value
      : recoveredInput.serialized;
  const missingRequiredField = inputFields.find(
    (field) => field.required && !hasTestValue(testValues[field.key]),
  );
  useEffect(() => {
    const active =
      candidateHasActiveRuns ||
      (Boolean(runId) && (run.isPending || runActive));
    onRunActivityChange?.(active);
    return () => onRunActivityChange?.(false);
  }, [
    candidateHasActiveRuns,
    onRunActivityChange,
    run.isPending,
    runActive,
    runId,
  ]);
  useEffect(() => {
    if (
      !effectiveCandidateId ||
      !runId ||
      !isTerminal(run.data) ||
      reconciledTerminalRunRef.current === runId
    ) {
      return;
    }
    reconciledTerminalRunRef.current = runId;
    void queryClient.invalidateQueries({
      queryKey: ["workflow-candidate", workspaceId, effectiveCandidateId],
    });
  }, [effectiveCandidateId, run.data, runId, workspaceId]);

  async function refreshCandidate(value: WorkflowCandidateReview) {
    setSelectedCandidateId(value.candidate.id);
    queryClient.setQueryData(
      ["workflow-candidate", workspaceId, value.candidate.id],
      value,
    );
    await queryClient.invalidateQueries({
      queryKey: [
        "workflow-candidates",
        workspaceId,
        draft.definition.workflowKey,
      ],
    });
  }

  function notifyError(error: unknown) {
    notification.error({
      title: t("workflows.candidate.errorTitle"),
      description:
        error instanceof Error &&
        [
          t("workflows.candidate.notReady"),
          t("workflows.candidate.invalidJson"),
          t("workflows.candidate.noRun"),
          t("workflows.candidate.notLoaded"),
        ].includes(error.message)
          ? error.message
          : t("workflows.candidate.errorDescription"),
    });
  }

  const submit = useMutation({
    mutationFn: () =>
      submitWorkflowCandidate(
        { csrfToken, workspaceId },
        draft.definition.id,
        draft.draft.id,
        { expectedDraftVersion: draft.draft.version },
        ulid(),
      ),
    onSuccess: refreshCandidate,
    onError: notifyError,
  });
  const startTest = useMutation({
    mutationFn: async () => {
      if (hasUnsavedChanges) {
        throw new Error(t("workflows.candidate.notReady"));
      }
      if (missingRequiredField) {
        throw new Error(
          t("workflows.candidate.requiredInput", {
            field: missingRequiredField.title,
          }),
        );
      }
      let preparedCandidateId = currentDraftCandidateId;
      let preparedReview: WorkflowCandidateReview | undefined;
      if (!preparedCandidateId) {
        if (!canAuthor) {
          throw new Error(t("workflows.candidate.notReady"));
        }
        preparedReview = await submitWorkflowCandidate(
          { csrfToken, workspaceId },
          draft.definition.id,
          draft.draft.id,
          { expectedDraftVersion: draft.draft.version },
          ulid(),
        );
        preparedCandidateId = preparedReview.candidate.id;
      }
      let input: unknown;
      if (inputFields.length > 0) {
        input = Object.fromEntries(
          inputFields.flatMap((field) => {
            const value = testValues[field.key];
            if (value === undefined || value === "") {
              return [];
            }
            return [
              [
                field.key,
                typeof value === "string"
                  ? workflowLiteralValue(value, field.type)
                  : value,
              ],
            ];
          }),
        );
      } else {
        try {
          input = JSON.parse(testInput) as unknown;
        } catch {
          throw new Error(t("workflows.candidate.invalidJson"));
        }
      }
      const forceNew = Boolean(run.data && isTerminal(run.data));
      const inputFingerprint = workflowCandidateTestInputFingerprint(input);
      const inMemoryAttempt = testAttemptRef.current;
      const attempt =
        !forceNew &&
        inMemoryAttempt?.candidateId === preparedCandidateId &&
        inMemoryAttempt.inputFingerprint === inputFingerprint &&
        !inMemoryAttempt.runId
          ? inMemoryAttempt
          : prepareWorkflowCandidateTestAttempt({
              workspaceId,
              candidateId: preparedCandidateId,
              input,
              createId: ulid,
              forceNew,
            });
      testAttemptRef.current = attempt;
      const started = await startWorkflowCandidateTest(
        { csrfToken, workspaceId },
        preparedCandidateId,
        { input },
        attempt.idempotencyKey,
      );
      return { attempt, started, preparedCandidateId, preparedReview };
    },
    onSuccess: async ({
      attempt,
      preparedCandidateId,
      preparedReview,
      started,
    }) => {
      testAttemptRef.current = acceptWorkflowCandidateTestAttempt(
        workspaceId,
        attempt,
        started.id,
      );
      if (preparedReview) {
        await refreshCandidate(preparedReview);
      } else {
        setSelectedCandidateId(preparedCandidateId);
      }
      setLocalRun({ candidateId: preparedCandidateId, runId: started.id });
      await queryClient.invalidateQueries({
        queryKey: ["workflow-candidate", workspaceId, preparedCandidateId],
      });
    },
    onError: notifyError,
  });
  const cancelTest = useMutation({
    mutationFn: () => {
      if (!runId) throw new Error(t("workflows.candidate.noRun"));
      return cancelWorkflowRun({ csrfToken, workspaceId }, runId, {
        reasonCode: "user_requested",
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["workflow-run", workspaceId, runId],
        }),
        effectiveCandidateId
          ? queryClient.invalidateQueries({
              queryKey: [
                "workflow-candidate",
                workspaceId,
                effectiveCandidateId,
              ],
            })
          : Promise.resolve(),
      ]);
    },
    onError: notifyError,
  });
  const evalCheck = useMutation({
    mutationFn: () => {
      const reviewValue = candidate.data;
      if (!reviewValue || !runId) {
        throw new Error(t("workflows.candidate.noRun"));
      }
      return recordWorkflowCandidateEval(
        { csrfToken, workspaceId },
        reviewValue.candidate.id,
        {
          workflowRunId: runId,
          expectedCandidateDigest: reviewValue.candidate.canonicalDigest,
        },
      );
    },
    onSuccess: refreshCandidate,
    onError: notifyError,
  });
  const review = useMutation({
    mutationFn: (decision: "approved" | "rejected") => {
      const value = candidate.data;
      if (!value) {
        throw new Error(t("workflows.candidate.notLoaded"));
      }
      return reviewWorkflowCandidate(
        { csrfToken, workspaceId },
        value.candidate.id,
        {
          expectedCandidateDigest: value.candidate.canonicalDigest,
          decision,
        },
      );
    },
    onSuccess: refreshCandidate,
    onError: notifyError,
  });
  const publish = useMutation({
    mutationFn: () => {
      const value = candidate.data;
      if (!value) {
        throw new Error(t("workflows.candidate.notLoaded"));
      }
      return publishWorkflowCandidate(
        { csrfToken, workspaceId },
        value.candidate.id,
        { expectedCandidateDigest: value.candidate.canonicalDigest },
        ulid(),
      );
    },
    onSuccess: async (value) => {
      await refreshCandidate(value);
      await queryClient.invalidateQueries({
        queryKey: ["workflow-definitions", workspaceId],
      });
    },
    onError: notifyError,
  });

  function retryCandidateLoad(): void {
    void candidates.refetch();
    if (effectiveCandidateId) void candidate.refetch();
  }

  function selectCandidate(value: string): void {
    setSelectedCandidateId(value);
    setLocalRun(undefined);
  }

  const current = candidate.data;
  const checks = new Map(
    current?.checks.map((check) => [check.checkKind, check.outcome]) ?? [],
  );
  const checksPassed = (
    ["schema", "resources", "security", "compatibility", "eval"] as const
  ).every((kind) => checks.get(kind) === "passed");
  const publicationPanelState = workflowPublicationPanelStateV1({
    canPublish,
    candidateError: candidates.isError || candidate.isError,
    candidateLoading:
      candidates.isPending ||
      (Boolean(effectiveCandidateId) && candidate.isPending),
    hasCandidate: Boolean(current),
  });
  let publicationActions: ReactNode;
  if (publicationPanelState === "permission_denied") {
    publicationActions = (
      <Alert
        description={t("workflows.candidate.publishPermission")}
        showIcon
        type="info"
      />
    );
  } else if (publicationPanelState === "candidate_loading") {
    publicationActions = <Skeleton active paragraph={{ rows: 2 }} />;
  } else if (publicationPanelState === "candidate_error") {
    publicationActions = (
      <Alert
        action={
          <Button onClick={retryCandidateLoad} size="small">
            {t("workflows.candidate.retry")}
          </Button>
        }
        description={t("workflows.candidate.candidateLoadFailed")}
        showIcon
        type="error"
      />
    );
  } else if (publicationPanelState === "candidate_missing" || !current) {
    publicationActions = (
      <Alert
        action={
          <Button onClick={() => onSectionChange("test")} size="small">
            {t("workflows.candidate.prepareCandidate")}
          </Button>
        }
        description={t("workflows.candidate.candidateMissing")}
        showIcon
        type="info"
      />
    );
  } else {
    publicationActions = (
      <>
        {!current.review ? (
          <>
            <Button
              disabled={!checksPassed}
              loading={review.isPending}
              onClick={() => review.mutate("approved")}
              type="primary"
            >
              {t("workflows.candidate.approve")}
            </Button>
            <Button
              danger
              loading={review.isPending}
              onClick={() => review.mutate("rejected")}
            >
              {t("workflows.candidate.reject")}
            </Button>
          </>
        ) : null}
        {current.review?.decision === "approved" &&
        !current.publishedRevision ? (
          <Button
            loading={publish.isPending}
            onClick={() => publish.mutate()}
            type="primary"
          >
            {t("workflows.candidate.publish")}
          </Button>
        ) : null}
        {current.publishedRevision ? (
          <div className="grid gap-3">
            <Alert
              description={t("workflows.candidate.published")}
              showIcon
              type="success"
            />
            <Link
              className="inline-flex min-h-10 items-center justify-center rounded-xl bg-primary px-4 text-xs font-bold text-on-primary no-underline hover:bg-primary-deep"
              params={{
                workspaceId,
                workflowRevisionId: current.publishedRevision.id,
              }}
              to="/w/$workspaceId/workflow-templates/$workflowRevisionId"
            >
              {t("workflows.candidate.usePublishedTemplate")}
            </Link>
          </div>
        ) : null}
        {current.review?.decision === "rejected" ? (
          <Alert
            description={t("workflows.candidate.rejected")}
            showIcon
            type="error"
          />
        ) : null}
      </>
    );
  }
  let testActionLabel = t("workflows.candidate.startTest");
  if (run.data) testActionLabel = t("workflows.candidate.runAgain");
  if (candidateHasActiveRuns || runActive || (run.isPending && runId)) {
    testActionLabel = t("workflows.candidate.testRunning");
  }
  let runAction: ReactNode;
  if (runActive) {
    runAction = (
      <Button
        danger
        icon={<StopOutlined aria-hidden="true" />}
        loading={cancelTest.isPending}
        onClick={() => cancelTest.mutate()}
        size="small"
      >
        {t("workflows.candidate.cancelTest")}
      </Button>
    );
  } else if (isTerminal(run.data) && checks.get("eval") === undefined) {
    runAction = (
      <Button
        icon={<ExperimentOutlined aria-hidden="true" />}
        loading={evalCheck.isPending}
        onClick={() => evalCheck.mutate()}
        size="small"
      >
        {t("workflows.candidate.recordEvidence")}
      </Button>
    );
  }
  let runStatusLabel = run.data
    ? t(`workflows.templateDetail.runStatus.${run.data.lifecycleStatus}`)
    : "";
  if (run.data?.outcome === "partial_success") {
    runStatusLabel = t("workflows.runSession.terminal.partial");
  } else if (run.data?.outcome === "no_usable_output") {
    runStatusLabel = t("workflows.runSession.terminal.noUsableOutput");
  }
  const pendingApproval = run.data?.pendingApprovals?.[0];

  const testPanel = (
    <div className="grid gap-4 lg:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.2fr)]">
      <section className="grid content-start gap-4 rounded-2xl bg-mist/70 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-ink">
              {t("workflows.candidate.testInput")}
            </h3>
            <p className="mt-1 text-xs text-muted">
              {t("workflows.candidate.testInputDescription")}
            </p>
          </div>
          <Button
            disabled={
              !canAuthor ||
              hasUnsavedChanges ||
              runActive ||
              candidateHasActiveRuns ||
              runUnavailable ||
              Boolean(run.isPending && runId)
            }
            loading={submit.isPending}
            onClick={() => submit.mutate()}
            size="small"
          >
            {t("workflows.candidate.refreshSnapshot")}
          </Button>
        </div>
        {candidates.isPending ? (
          <Skeleton active paragraph={{ rows: 2 }} />
        ) : null}
        {candidates.data?.items.length ? (
          <Select
            aria-label={t("workflows.candidate.current")}
            disabled={candidateHasActiveRuns || runActive || runUnavailable}
            onChange={selectCandidate}
            options={candidates.data.items.map((item) => ({
              label: t("workflows.candidate.snapshotOption", {
                version: item.sourceDraftVersion,
                time: new Intl.DateTimeFormat(i18n.resolvedLanguage, {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(item.createdAt)),
              }),
              value: item.id,
            }))}
            value={effectiveCandidateId ?? null}
            variant="filled"
          />
        ) : (
          <Alert
            description={
              hasUnsavedChanges
                ? t("workflows.candidate.empty")
                : t("workflows.candidate.autoSnapshot", {
                    version: draft.draft.version,
                  })
            }
            showIcon
            type="info"
          />
        )}
        <fieldset
          className="contents"
          disabled={
            candidateHasActiveRuns ||
            runActive ||
            runUnavailable ||
            Boolean(run.isPending && runId)
          }
        >
          {inputFields.length > 0 ? (
            <div className="grid gap-3">
              {inputFields.map((field) => (
                <label className="grid gap-1.5" key={field.key}>
                  <span className="text-xs font-semibold text-muted">
                    {field.title}
                    {field.required ? " *" : ""}
                  </span>
                  <TestFieldControl
                    csrfToken={csrfToken}
                    field={field}
                    onBusyChange={(busy) => {
                      setUploadingFieldKeys((current) => {
                        const next = new Set(current);
                        if (busy) next.add(field.key);
                        else next.delete(field.key);
                        return next;
                      });
                    }}
                    onChange={(value) => {
                      setTestValueEdits((current) => ({
                        scopeKey: inputScopeKey,
                        values: {
                          ...(current?.scopeKey === inputScopeKey
                            ? current.values
                            : {}),
                          [field.key]: value,
                        },
                      }));
                    }}
                    value={testValues[field.key]}
                    workspaceId={workspaceId}
                  />
                </label>
              ))}
            </div>
          ) : (
            <Input.TextArea
              autoSize={{ minRows: 6, maxRows: 12 }}
              onChange={(event) => {
                setTestInputEdit({
                  scopeKey: inputScopeKey,
                  value: event.currentTarget.value,
                });
              }}
              spellCheck={false}
              value={testInput}
              variant="filled"
            />
          )}
        </fieldset>
        <Button
          disabled={
            !canAuthor ||
            !canRun ||
            hasUnsavedChanges ||
            Boolean(missingRequiredField) ||
            uploadingFieldKeys.size > 0 ||
            candidates.isPending ||
            submit.isPending ||
            runActive ||
            candidateHasActiveRuns ||
            runUnavailable ||
            Boolean(run.isPending && runId)
          }
          icon={<PlayCircleOutlined aria-hidden="true" />}
          loading={startTest.isPending}
          onClick={() => startTest.mutate()}
          type={run.data ? "default" : "primary"}
        >
          {testActionLabel}
        </Button>
      </section>
      <section className="min-h-72 rounded-2xl bg-mist/70 p-4">
        <h3 className="mb-3 text-sm font-bold text-ink">
          {t("workflows.candidate.runDetails")}
        </h3>
        {managedTestRunIds.length > 1 ? (
          <Select
            aria-label={t("workflows.candidate.activeTestRuns")}
            className="mb-3 w-full"
            onChange={(nextRunId) => {
              if (!effectiveCandidateId || !nextRunId) return;
              setLocalRun({
                candidateId: effectiveCandidateId,
                runId: nextRunId,
              });
            }}
            options={managedTestRunIds.map((managedRunId) => {
              const activeIndex = activeTestRunIds.indexOf(managedRunId);
              return {
                label:
                  activeIndex >= 0
                    ? t("workflows.candidate.activeTestRunOption", {
                        index: activeIndex + 1,
                      })
                    : t("workflows.candidate.recentTestRunOption"),
                value: managedRunId,
              };
            })}
            value={runId}
            variant="filled"
          />
        ) : null}
        {run.isPending && runId ? (
          <Skeleton active paragraph={{ rows: 5 }} />
        ) : null}
        {runUnavailable ? (
          <Alert
            action={
              <Button onClick={() => void run.refetch()} size="small">
                {t("workflows.candidate.retry")}
              </Button>
            }
            description={t("workflows.candidate.runLoadFailed")}
            showIcon
            type="error"
          />
        ) : null}
        {run.data ? (
          <div className="grid gap-3">
            {pendingApproval ? (
              <section className="grid gap-3 rounded-xl bg-paper p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div>
                  <strong className="text-sm text-ink">
                    {pendingApproval.title ??
                      t("workflows.runSession.approval.title")}
                  </strong>
                  {pendingApproval.message ? (
                    <p className="mt-1 mb-0 text-xs leading-5 text-muted">
                      {pendingApproval.message}
                    </p>
                  ) : null}
                </div>
                <Link
                  className="inline-flex min-h-9 items-center justify-center rounded-xl bg-primary px-3 text-xs font-bold text-on-primary no-underline hover:bg-primary-deep"
                  params={{
                    workspaceId,
                    workflowRunId: run.data.id,
                  }}
                  to="/w/$workspaceId/workflow-runs/$workflowRunId"
                >
                  {t("workflows.candidate.openApprovalRun")}
                </Link>
              </section>
            ) : null}
            {finalArtifacts.length > 0 ? (
              <section aria-labelledby="workflow-run-results-title">
                <h4
                  className="mb-2 text-xs font-bold text-ink"
                  id="workflow-run-results-title"
                >
                  {t("workflows.candidate.runResults")}
                </h4>
                <div className="grid gap-3 sm:grid-cols-2">
                  {finalArtifacts.map((artifact) => (
                    <WorkflowArtifactResultCard
                      artifact={artifact}
                      key={`${artifact.fieldKey}:${artifact.artifactId}`}
                      language={i18n.language}
                      workspaceId={workspaceId}
                    />
                  ))}
                </div>
              </section>
            ) : null}
            <div
              aria-live="polite"
              className="flex items-center justify-between gap-3"
              role="status"
            >
              <Tag
                color={runStatusColor(
                  run.data.lifecycleStatus,
                  run.data.outcome,
                )}
              >
                {runStatusLabel}
              </Tag>
              {runAction}
            </div>
            <Collapse
              bordered={false}
              className="bg-transparent"
              classNames={{
                body: "border-0 bg-transparent px-3",
                header: "bg-paper px-3",
              }}
              defaultActiveKey={run.data.nodes
                .filter((node) => node.lifecycleStatus === "failed")
                .map((node) => node.id)}
              items={run.data.nodes.map((node) => ({
                className: "mb-2 overflow-hidden rounded-xl border-0 last:mb-0",
                key: node.id,
                label: (
                  <span className="flex items-center justify-between gap-3">
                    <strong>
                      {nodeDisplayNames.get(node.nodeKey) ?? node.nodeKey}
                    </strong>
                    <Tag color={runStatusColor(node.lifecycleStatus)}>
                      {t(
                        `workflows.templateDetail.runStatus.${node.lifecycleStatus}`,
                      )}
                    </Tag>
                  </span>
                ),
                children: (
                  <div className="grid gap-3">
                    {workflowRunNodeArtifactsV1(
                      node.nodeKey,
                      node.output,
                      graph,
                      capabilities,
                    ).map((artifact) => (
                      <WorkflowArtifactResultCard
                        artifact={artifact}
                        key={`${artifact.fieldKey}:${artifact.artifactId}`}
                        language={i18n.language}
                        workspaceId={workspaceId}
                      />
                    ))}
                    <details>
                      <summary className="cursor-pointer text-xs font-semibold text-muted">
                        {t("workflows.candidate.technicalDetails")}
                      </summary>
                      <div className="mt-2">
                        <JsonBlock value={node.output} />
                      </div>
                    </details>
                    {node.error ? (
                      <div>
                        <span className="mb-1 block text-xs font-semibold text-danger">
                          {t("workflows.candidate.nodeError")}
                        </span>
                        <JsonBlock value={node.error} />
                      </div>
                    ) : null}
                  </div>
                ),
              }))}
              key={`${run.data.id}:${run.data.lifecycleStatus}`}
              size="small"
            />
          </div>
        ) : null}
        {!run.data && !runId ? (
          <Empty
            description={t("workflows.candidate.noRunYet")}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        ) : null}
      </section>
    </div>
  );

  const publishPanel = (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section className="grid content-start gap-4 rounded-2xl bg-mist/70 p-4">
        <div>
          <h3 className="text-sm font-bold text-ink">
            {t("workflows.candidate.publishReadiness")}
          </h3>
          <p className="mt-1 text-xs text-muted">
            {t("workflows.candidate.publishReadinessDescription")}
          </p>
        </div>
        {candidate.isPending && effectiveCandidateId ? (
          <Skeleton active paragraph={{ rows: 4 }} />
        ) : null}
        {current ? (
          <div className="grid gap-3">
            <div className="flex flex-wrap gap-2">
              {(
                [
                  "schema",
                  "resources",
                  "security",
                  "compatibility",
                  "eval",
                ] as const
              ).map((kind) => {
                const outcome = checks.get(kind) ?? "pending";
                return (
                  <Tag
                    color={checkColor(outcome)}
                    icon={checkIcon(outcome)}
                    key={kind}
                  >
                    {t(`workflows.candidate.checks.${kind}`)}
                  </Tag>
                );
              })}
            </div>
            {!checksPassed ? (
              <Alert
                description={t("workflows.candidate.checksIncomplete")}
                showIcon
                type="warning"
              />
            ) : (
              <Alert
                description={t("workflows.candidate.checksPassed")}
                icon={<SafetyCertificateOutlined />}
                showIcon
                type="success"
              />
            )}
          </div>
        ) : (
          <Empty
            description={t("workflows.candidate.empty")}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        )}
      </section>
      <section className="grid content-start gap-3 rounded-2xl bg-mist/70 p-4">
        <h3 className="text-sm font-bold text-ink">
          {current?.publishedRevision
            ? t("workflows.candidate.publishStatus")
            : t("workflows.candidate.reviewDecision")}
        </h3>
        {publicationActions}
      </section>
    </div>
  );

  return (
    <Tabs
      activeKey={activeSection}
      items={[
        {
          key: "test",
          label: t("workflows.candidate.testTab"),
          children: testPanel,
        },
        {
          key: "publish",
          label: t("workflows.candidate.publishTab"),
          children: publishPanel,
        },
      ]}
      onChange={(key) => {
        onSectionChange(key as WorkflowCandidatePanelSection);
      }}
    />
  );
}
