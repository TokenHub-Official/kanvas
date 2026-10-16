import {
  ArrowLeftOutlined,
  AppstoreAddOutlined,
  CloseOutlined,
  ClusterOutlined,
  DatabaseOutlined,
  ExclamationCircleOutlined,
  ExperimentOutlined,
  FullscreenOutlined,
  PlayCircleOutlined,
  PictureOutlined,
  RocketOutlined,
  SaveOutlined,
  SearchOutlined,
  UndoOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
} from "@ant-design/icons";
import type {
  WorkflowAuthoringCapability,
  WorkflowDraft,
  WorkflowPresentation,
} from "@kanvas/contracts/api";
import {
  compileWorkflowAuthoringGraph,
  projectWorkflowAuthoringGraph,
  workflowAuthoringInputNodeId,
  workflowAuthoringOutputNodeId,
  type WorkflowAuthoringGraphV1,
  type WorkflowAuthoringNodeV1,
} from "@kanvas/contracts/workflow-authoring";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Background,
  MarkerType,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type ReactFlowInstance,
} from "@xyflow/react";
import {
  App as AntApp,
  Button,
  ConfigProvider,
  Drawer,
  Empty,
  Input,
  Modal,
  Skeleton,
  Switch,
  Tooltip,
} from "antd";
import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import "@xyflow/react/dist/style.css";

import {
  ApiProblem,
  fetchWorkflowAuthoringCapabilities,
  fetchWorkflowDraft,
  updateWorkflowDraft,
} from "../../api/transport.js";
import { Brand } from "../../components/brand.js";
import { UnsavedChangesGuard } from "../../components/unsaved-changes-guard.js";
import { KanvasSelect } from "../../components/kanvas-select.js";
import { PageEmptyState, PageLoading } from "../../components/feedback.js";
import { useDocumentTitle } from "../../components/use-document-title.js";
import { cn } from "../../lib/cn.js";
import { kanvasInverseControlTheme } from "../../theme/kanvas-inverse-control-theme.js";
import { useCanvasBrowserRuntimesV1 } from "../editor/use-canvas-browser-runtimes-v1.js";
import {
  WorkflowAuthoringFlowNodeV1,
  type WorkflowAuthoringFlowNodeDataV1,
  type WorkflowAuthoringReactFlowNodeV1,
} from "./workflow-authoring-flow-node-v1.js";
import { workflowCapabilityInputDefaults } from "./workflow-authoring-capability-input-v1.js";
import {
  clearWorkflowAuthoringRecovery,
  readWorkflowAuthoringRecovery,
  reconcileWorkflowAuthoringSave,
  writeWorkflowAuthoringRecovery,
  type WorkflowAuthoringSaveSnapshot,
} from "./workflow-authoring-recovery.js";
import {
  workflowCapabilityOutput,
  workflowCapabilityText,
  workflowInputSemanticType,
} from "./workflow-capability-authoring-profile-v1.js";
import {
  WorkflowAuthoringNodeEditorV1,
  type WorkflowAuthoringVariableOptionV1,
} from "./workflow-authoring-node-editor-v1.js";
import { workflowVariableIdentity } from "./workflow-authoring-text-template-v1.js";
import { WorkflowTestFileControl } from "./workflow-test-file-control.js";
import {
  isStandardWorkflowApprovalDecisionSchema,
  workflowApprovalDecisionFields,
  workflowSchemaFields,
  type WorkflowSchemaField,
} from "./workflow-authoring-model.js";
import {
  defaultWorkflowAuthoringShellLayout,
  readWorkflowAuthoringShellLayout,
  workflowAuthoringNodeUsesCapabilityIdentity,
  workflowAuthoringShellIssues,
  writeWorkflowAuthoringShellLayout,
  type WorkflowAuthoringShellIssue,
} from "./workflow-authoring-shell-model-v1.js";
import type { WorkflowCandidatePanelSection } from "./workflow-candidate-panel.js";

const nodeTypes = { "workflow-authoring-v1": WorkflowAuthoringFlowNodeV1 };

const WorkflowCandidatePanel = lazy(async () => {
  const module = await import("./workflow-candidate-panel.js");
  return { default: module.WorkflowCandidatePanel };
});

type BottomPanel = "problems" | "variables" | "runs";
type RuntimeAuthoringKind = "capability" | "condition" | "batch" | "approval";
type WorkflowAuthoringSaveRequest = {
  readonly baseDraft: WorkflowDraft;
  readonly snapshot: WorkflowAuthoringSaveSnapshot;
};

const nodeCenterX = 112;
const nodeCenterY = 46;
const minimumFocusZoom = 0.8;
const generatedNodeIdLength = 10;
const defaultBatchMaxItems = 100;
const defaultBatchConcurrency = 4;
const apiConflictStatus = 409;
const presentationCoverField: WorkflowSchemaField = Object.freeze({
  key: "coverArtifactId",
  title: "Cover",
  type: "string",
  required: false,
  schema: Object.freeze({
    type: "string",
    "x-kanvas-file": Object.freeze({
      categories: Object.freeze(["image"]),
      transfer: "both",
    }),
  }),
});

function withOptionalPresentationText(
  presentation: WorkflowPresentation,
  key: "category" | "description" | "title",
  value: string,
): WorkflowPresentation {
  if (value.trim()) return { ...presentation, [key]: value };
  const next = { ...presentation };
  delete next[key];
  return next;
}

function withoutPresentationCover(
  presentation: WorkflowPresentation,
): WorkflowPresentation {
  const next = { ...presentation };
  delete next.cover;
  return next;
}

export function defaultWorkflowPresentation(
  draft: WorkflowDraft,
): WorkflowPresentation {
  return {
    schemaVersion: 1,
    title: draft.definition.displayName,
    ...(draft.definition.description
      ? { description: draft.definition.description }
      : {}),
    ...(draft.definition.category
      ? { category: draft.definition.category }
      : {}),
    tags: [],
    availability: {
      standalone: true,
      canvas: false,
      directLink: true,
    },
  };
}

export function normalizeWorkflowPresentation(
  value: WorkflowPresentation,
): WorkflowPresentation {
  return {
    schemaVersion: 1,
    ...(value.title ? { title: value.title } : {}),
    ...(value.description ? { description: value.description } : {}),
    ...(value.category ? { category: value.category } : {}),
    tags: [...value.tags],
    ...(value.cover ? { cover: { ...value.cover } } : {}),
    availability: { ...value.availability },
  };
}
export interface AuthoringCapabilityGroup {
  readonly capabilities: readonly WorkflowAuthoringCapability[];
  readonly key: string;
  readonly label: string;
}

export function latestAuthoringCapabilities(
  capabilities: readonly WorkflowAuthoringCapability[],
): readonly WorkflowAuthoringCapability[] {
  const latest = new Map<string, WorkflowAuthoringCapability>();
  for (const capability of capabilities) {
    const current = latest.get(capability.contractId);
    if (!current || capability.revision > current.revision) {
      latest.set(capability.contractId, capability);
    }
  }
  return [...latest.values()];
}

export function groupAuthoringCapabilities(
  capabilities: readonly WorkflowAuthoringCapability[],
  language: string,
): readonly AuthoringCapabilityGroup[] {
  const groups = new Map<string, AuthoringCapabilityGroup>();
  for (const capability of capabilities) {
    const key = capability.authoring.catalog.category["en-US"];
    const label = workflowCapabilityText(
      capability.authoring.catalog.category,
      language,
    );
    const current = groups.get(key);
    groups.set(key, {
      key,
      label,
      capabilities: [...(current?.capabilities ?? []), capability],
    });
  }
  return [...groups.values()].toSorted((left, right) =>
    left.label.localeCompare(right.label, language),
  );
}

function authoringNodeId(kind: RuntimeAuthoringKind): string {
  return `${kind}_${crypto.randomUUID().replaceAll("-", "").slice(0, generatedNodeIdLength)}`;
}

function capabilityReference(capability: WorkflowAuthoringCapability) {
  return {
    contractId: capability.contractId,
    revision: capability.revision,
    canonicalDigest: capability.canonicalDigest,
  };
}

function createRuntimeAuthoringNode(
  kind: RuntimeAuthoringKind,
  capability: WorkflowAuthoringCapability | undefined,
  language: string,
  t: ReturnType<typeof useTranslation>["t"],
): WorkflowAuthoringNodeV1 | undefined {
  const id = authoringNodeId(kind);
  const displayName =
    kind === "capability" && capability
      ? workflowCapabilityText(capability.authoring.catalog.title, language)
      : t(`workflows.editor.authoringKinds.${kind}`);
  if (kind === "condition") {
    return {
      id,
      nodeKey: id,
      displayName,
      type: kind,
      value: { kind: "literal", value: null },
      cases: [
        {
          id: "case_1",
          label: t("workflows.editor.firstBranch"),
          operator: "exists",
        },
      ],
      defaultLabel: t("workflows.editor.defaultBranch"),
    };
  }
  if (kind === "approval") {
    return {
      id,
      nodeKey: id,
      displayName,
      type: kind,
      request: {
        kind: "object",
        fields: {
          title: {
            kind: "literal",
            value: t("workflows.editor.approvalTitle"),
          },
          message: {
            kind: "literal",
            value: t("workflows.editor.approvalMessage"),
          },
        },
      },
      decisionSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          approved: {
            type: "boolean",
            title: t("workflows.editor.approvalDecisionApprovedTitle"),
          },
        },
        required: ["approved"],
      },
    };
  }
  if (!capability) return undefined;
  if (kind === "batch") {
    return {
      id,
      nodeKey: id,
      displayName,
      type: kind,
      items: { kind: "literal", value: [] },
      scopeKey: {
        kind: "variable",
        variable: { source: "map_item", path: [] },
      },
      maxItems: defaultBatchMaxItems,
      maxConcurrency: defaultBatchConcurrency,
      failureMode: "fail_fast",
      capability: capabilityReference(capability),
      input: workflowCapabilityInputDefaults(
        capability.inputSchema,
        capability.authoring,
      ),
    };
  }
  return {
    id,
    nodeKey: id,
    displayName,
    type: kind,
    capability: capabilityReference(capability),
    input: workflowCapabilityInputDefaults(
      capability.inputSchema,
      capability.authoring,
    ),
  };
}

function createApprovalOutcomeNode(
  approvalNode: Extract<WorkflowAuthoringNodeV1, { readonly type: "approval" }>,
  t: ReturnType<typeof useTranslation>["t"],
): Extract<WorkflowAuthoringNodeV1, { readonly type: "condition" }> {
  const id = authoringNodeId("condition");
  return {
    id,
    nodeKey: id,
    displayName: t("workflows.editor.approvalOutcome"),
    type: "condition",
    value: {
      kind: "variable",
      variable: {
        source: "node_output",
        nodeKey: approvalNode.nodeKey,
        scope: "root",
        path: ["approved"],
      },
    },
    cases: [
      {
        id: "approved",
        label: t("workflows.editor.approvalAcceptedBranch"),
        operator: "equals",
        value: true,
      },
    ],
    defaultLabel: t("workflows.editor.approvalRejectedBranch"),
  };
}

export function replaceAuthoringEdgeWithApprovalGate(
  graph: WorkflowAuthoringGraphV1,
  insertionEdge: WorkflowAuthoringGraphV1["edges"][number],
  approvalNode: Extract<WorkflowAuthoringNodeV1, { readonly type: "approval" }>,
  outcomeNode: Extract<WorkflowAuthoringNodeV1, { readonly type: "condition" }>,
): WorkflowAuthoringGraphV1 {
  return {
    ...graph,
    nodes: [...graph.nodes, approvalNode, outcomeNode],
    edges: [
      ...graph.edges.filter((edge) => edge.id !== insertionEdge.id),
      {
        id: `${insertionEdge.source}:${insertionEdge.sourcePort}:${approvalNode.id}`,
        source: insertionEdge.source,
        sourcePort: insertionEdge.sourcePort,
        target: approvalNode.id,
      },
      {
        id: `${approvalNode.id}:out:${outcomeNode.id}`,
        source: approvalNode.id,
        sourcePort: "out",
        target: outcomeNode.id,
      },
      {
        id: `${outcomeNode.id}:case:approved:${insertionEdge.target}`,
        source: outcomeNode.id,
        sourcePort: "case:approved",
        target: insertionEdge.target,
      },
      {
        id: `${outcomeNode.id}:default:${workflowAuthoringOutputNodeId}`,
        source: outcomeNode.id,
        sourcePort: "default",
        target: workflowAuthoringOutputNodeId,
      },
    ],
  };
}

function isApprovalOutcomeNode(
  graph: WorkflowAuthoringGraphV1,
  approval: Extract<WorkflowAuthoringNodeV1, { readonly type: "approval" }>,
  outcome: Extract<WorkflowAuthoringNodeV1, { readonly type: "condition" }>,
): boolean {
  const variable =
    outcome.value.kind === "variable" ? outcome.value.variable : undefined;
  const approvedCase = outcome.cases[0];
  return (
    isStandardWorkflowApprovalDecisionSchema(approval.decisionSchema) &&
    outcome.cases.length === 1 &&
    approvedCase?.operator === "equals" &&
    approvedCase.value === true &&
    variable?.source === "node_output" &&
    variable.nodeKey === approval.nodeKey &&
    variable.scope === "root" &&
    variable.path.length === 1 &&
    variable.path[0] === "approved" &&
    graph.edges.some(
      (edge) =>
        edge.source === approval.id &&
        edge.sourcePort === "out" &&
        edge.target === outcome.id,
    ) &&
    graph.edges.some(
      (edge) =>
        edge.source === outcome.id &&
        edge.sourcePort === `case:${approvedCase.id}`,
    ) &&
    graph.edges.some(
      (edge) =>
        edge.source === outcome.id &&
        edge.sourcePort === "default" &&
        edge.target === workflowAuthoringOutputNodeId,
    )
  );
}

export function localizeApprovalOutcomeGraph(
  graph: WorkflowAuthoringGraphV1,
  t: ReturnType<typeof useTranslation>["t"],
): WorkflowAuthoringGraphV1 {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      if (node.type !== "condition") return node;
      const approval = graph.nodes.find(
        (
          candidate,
        ): candidate is Extract<
          WorkflowAuthoringNodeV1,
          { readonly type: "approval" }
        > =>
          candidate.type === "approval" &&
          isApprovalOutcomeNode(graph, candidate, node),
      );
      if (!approval) return node;
      return {
        ...node,
        displayName: t("workflows.editor.approvalOutcome"),
        cases: [
          {
            ...node.cases[0]!,
            label: t("workflows.editor.approvalAcceptedBranch"),
          },
        ],
        defaultLabel: t("workflows.editor.approvalRejectedBranch"),
      };
    }),
  };
}

export function preferredAuthoringInsertionEdge(
  graph: WorkflowAuthoringGraphV1,
  selectedNodeId: string | undefined,
): WorkflowAuthoringGraphV1["edges"][number] | undefined {
  const selected = graph.nodes.find((node) => node.id === selectedNodeId);
  let approval:
    Extract<WorkflowAuthoringNodeV1, { readonly type: "approval" }> | undefined;
  let outcome:
    | Extract<WorkflowAuthoringNodeV1, { readonly type: "condition" }>
    | undefined;
  if (selected?.type === "approval") {
    approval = selected;
  } else if (selected?.type === "condition") {
    approval = graph.nodes.find(
      (
        node,
      ): node is Extract<
        WorkflowAuthoringNodeV1,
        { readonly type: "approval" }
      > => {
        return (
          node.type === "approval" &&
          isApprovalOutcomeNode(graph, node, selected)
        );
      },
    );
    if (approval) outcome = selected;
  }
  if (!outcome && approval) {
    const approvalNode = approval;
    outcome = graph.nodes.find(
      (
        node,
      ): node is Extract<
        WorkflowAuthoringNodeV1,
        { readonly type: "condition" }
      > => {
        return (
          node.type === "condition" &&
          isApprovalOutcomeNode(graph, approvalNode, node)
        );
      },
    );
  }
  const approvedCase = outcome?.cases.find(
    (item) => item.operator === "equals" && item.value === true,
  );
  if (outcome && approvedCase) {
    const approvedEdge = graph.edges.find(
      (edge) =>
        edge.source === outcome.id &&
        edge.sourcePort === `case:${approvedCase.id}`,
    );
    if (approvedEdge) return approvedEdge;
  }
  return (
    graph.edges.find(
      (edge) =>
        edge.source === selectedNodeId && selected?.type !== "condition",
    ) ??
    graph.edges.find((edge) => edge.target === workflowAuthoringOutputNodeId)
  );
}

interface WorkflowVariableSummary {
  readonly id: string;
  readonly label: string;
  readonly source: string;
  readonly type: string;
  readonly consumerCount: number;
}

function schemaProperties(schema: Readonly<Record<string, unknown>>) {
  const properties = schema.properties;
  return typeof properties === "object" &&
    properties !== null &&
    !Array.isArray(properties)
    ? (properties as Readonly<Record<string, unknown>>)
    : {};
}

function schemaType(value: unknown): string {
  return typeof value === "string" ? value : "value";
}

function bindingFieldCount(value: unknown): number {
  if (typeof value !== "object" || value === null || !("kind" in value))
    return 0;
  const binding = value as { readonly kind: string; readonly fields?: unknown };
  if (
    binding.kind !== "object" ||
    typeof binding.fields !== "object" ||
    binding.fields === null
  ) {
    return 1;
  }
  return Object.keys(binding.fields).length;
}

function bindingVariables(value: unknown): readonly {
  readonly source: string;
  readonly nodeKey?: string;
  readonly path: readonly string[];
}[] {
  if (typeof value !== "object" || value === null || !("kind" in value)) {
    return [];
  }
  const binding = value as {
    readonly kind: string;
    readonly variable?: {
      readonly source: string;
      readonly nodeKey?: string;
      readonly path: readonly string[];
    };
    readonly fields?: Readonly<Record<string, unknown>>;
    readonly items?: readonly unknown[];
    readonly variables?: readonly unknown[];
    readonly segments?: readonly unknown[];
  };
  if (binding.kind === "variable" && binding.variable)
    return [binding.variable];
  if (binding.kind === "object") {
    return Object.values(binding.fields ?? {}).flatMap(bindingVariables);
  }
  if (binding.kind === "array") {
    return (binding.items ?? []).flatMap(bindingVariables);
  }
  if (binding.kind === "coalesce") {
    return (binding.variables ?? []) as readonly {
      readonly source: string;
      readonly nodeKey?: string;
      readonly path: readonly string[];
    }[];
  }
  if (binding.kind === "text") {
    return (binding.segments ?? []).flatMap(bindingVariables);
  }
  return [];
}

function variableIdentity(variable: {
  readonly source: string;
  readonly nodeKey?: string;
  readonly path: readonly string[];
}): string {
  if (variable.source === "workflow_input") {
    return workflowVariableIdentity(
      workflowAuthoringInputNodeId,
      variable.path[0] ?? "",
    );
  }
  return `${variable.nodeKey ?? variable.source}:${variable.path[0] ?? ""}`;
}

function nodeBindings(node: WorkflowAuthoringNodeV1): readonly unknown[] {
  if (node.type === "output") return node.fields.map((field) => field.binding);
  if (node.type === "capability") return [node.input];
  if (node.type === "condition") return [node.value];
  if (node.type === "batch") {
    return [node.items, node.scopeKey, node.input];
  }
  if (node.type === "approval") return [node.request];
  return [];
}

function nodeKindLabelKey(node: WorkflowAuthoringNodeV1) {
  return `workflows.editor.authoringKinds.${node.type}`;
}

function nodeTitle(
  node: WorkflowAuthoringNodeV1,
  t: ReturnType<typeof useTranslation>["t"],
  capabilities: readonly WorkflowAuthoringCapability[],
  language: string,
) {
  if (node.type === "input" || node.type === "output") {
    return t(nodeKindLabelKey(node));
  }
  if (node.type === "capability" || node.type === "batch") {
    const capability = capabilities.find(
      (item) =>
        item.contractId === node.capability.contractId &&
        item.revision === node.capability.revision,
    );
    const localizedCapabilityName = [
      node.displayName,
      node.capability.contractId,
      capability?.contractId,
      capability?.contractKey,
    ]
      .filter((value): value is string => Boolean(value))
      .map((value) =>
        t(`workflows.editor.capabilityNames.${value}`, { defaultValue: "" }),
      )
      .find(Boolean);
    if (localizedCapabilityName) return localizedCapabilityName;
    if (workflowAuthoringNodeUsesCapabilityIdentity(node, capability)) {
      if (capability) {
        return workflowCapabilityText(
          capability.authoring.catalog.title,
          language,
        );
      }
      return t(
        `workflows.editor.capabilityNames.${node.capability.contractId}`,
        { defaultValue: t(nodeKindLabelKey(node)) },
      );
    }
  }
  return node.displayName === node.nodeKey
    ? t(nodeKindLabelKey(node))
    : node.displayName;
}

function nodeSummary({
  capabilities,
  node,
  t,
}: {
  readonly capabilities: readonly WorkflowAuthoringCapability[];
  readonly node: WorkflowAuthoringNodeV1;
  readonly t: ReturnType<typeof useTranslation>["t"];
}) {
  if (node.type === "input" || node.type === "output") {
    return t("workflows.editor.shell.fieldSummary", {
      count: node.fields.length,
    });
  }
  if (node.type === "condition") {
    return t("workflows.editor.shell.branchSummary", {
      count: node.cases.length + 1,
    });
  }
  if (node.type === "batch") {
    return t("workflows.editor.shell.batchSummary", {
      count: node.maxItems,
      concurrency: node.maxConcurrency,
    });
  }
  if (node.type === "approval") {
    return t("workflows.editor.shell.decisionSummary", {
      count: workflowSchemaFields(node.decisionSchema).length,
    });
  }
  const capability = capabilities.find(
    (item) =>
      item.contractId === node.capability.contractId &&
      item.revision === node.capability.revision,
  );
  const configuredInputKeys =
    node.input.kind === "object"
      ? new Set(Object.keys(node.input.fields))
      : new Set();
  const visibleInputs = capability?.authoring.parameters.filter(
    (parameter) =>
      parameter.exposurePolicy.default !== "hidden_derived" &&
      (configuredInputKeys.size === 0 ||
        configuredInputKeys.has(parameter.key)),
  ).length;
  const visibleOutputs = capability?.authoring.outputs.filter(
    (output) => output.visibility === "author",
  ).length;
  return t("workflows.editor.shell.mappingSummary", {
    inputs: visibleInputs ?? bindingFieldCount(node.input),
    outputs:
      visibleOutputs ??
      Object.keys(schemaProperties(capability?.outputSchema ?? {})).length,
  });
}

function sourcePorts(node: WorkflowAuthoringNodeV1) {
  if (node.type === "output") return [];
  if (node.type === "input") return [{ id: "start" }];
  if (node.type === "condition") {
    return [
      ...node.cases.map((item) => ({
        id: `case:${item.id}`,
        label: item.label,
      })),
      { id: "default", label: node.defaultLabel },
    ];
  }
  return [{ id: "out" }];
}

function schemaFieldLabels(
  schema: Readonly<Record<string, unknown>>,
): string[] {
  return Object.entries(schemaProperties(schema)).map(([key, value]) => {
    if (typeof value !== "object" || value === null) return key;
    const title = (value as Readonly<Record<string, unknown>>).title;
    return typeof title === "string" && title.trim() ? title : key;
  });
}

function nodeDataPreviews(
  node: WorkflowAuthoringNodeV1,
  capabilities: readonly WorkflowAuthoringCapability[],
  language: string,
  t: ReturnType<typeof useTranslation>["t"],
): { readonly inputs: readonly string[]; readonly outputs: readonly string[] } {
  if (node.type === "input") {
    return { inputs: [], outputs: node.fields.map((field) => field.label) };
  }
  if (node.type === "output") {
    return {
      inputs: node.fields
        .filter((field) => field.key !== "schemaVersion")
        .map((field) => field.label),
      outputs: [],
    };
  }
  if (node.type === "condition") {
    return { inputs: [], outputs: node.cases.map((item) => item.label) };
  }
  if (node.type === "approval") {
    return {
      inputs: [],
      outputs: workflowApprovalDecisionFields(
        node.decisionSchema,
        t("workflows.editor.approvalDecisionApprovedTitle"),
      ).map((field) => field.title),
    };
  }
  const capability = capabilities.find(
    (item) => item.contractId === node.capability.contractId,
  );
  const inputKeys =
    node.input.kind === "object" ? Object.keys(node.input.fields) : [];
  const declaredInputs = capability?.authoring.parameters
    .filter(
      (parameter) =>
        parameter.exposurePolicy.default !== "hidden_derived" &&
        (inputKeys.length === 0 || inputKeys.includes(parameter.key)),
    )
    .map((parameter) => workflowCapabilityText(parameter.label, language));
  const inputLabels =
    declaredInputs && declaredInputs.length > 0
      ? declaredInputs
      : schemaFieldLabels(capability?.inputSchema ?? {}).filter(
          (_label, index) =>
            inputKeys.length === 0 ||
            inputKeys.includes(
              schemaFieldsKey(capability?.inputSchema ?? {}, index),
            ),
        );
  const declaredOutputs = capability?.authoring.outputs
    .filter((output) => output.visibility === "author")
    .map((output) => workflowCapabilityText(output.label, language));
  return {
    inputs: inputLabels,
    outputs:
      declaredOutputs && declaredOutputs.length > 0
        ? declaredOutputs
        : schemaFieldLabels(capability?.outputSchema ?? {}),
  };
}

function schemaFieldsKey(
  schema: Readonly<Record<string, unknown>>,
  index: number,
): string {
  return Object.keys(schemaProperties(schema))[index] ?? "";
}

function buildFlow({
  capabilities,
  graph,
  issues,
  positions,
  t,
  language,
}: {
  readonly capabilities: readonly WorkflowAuthoringCapability[];
  readonly graph: WorkflowAuthoringGraphV1;
  readonly issues: readonly WorkflowAuthoringShellIssue[];
  readonly positions: Readonly<
    Record<string, { readonly x: number; readonly y: number }>
  >;
  readonly t: ReturnType<typeof useTranslation>["t"];
  readonly language: string;
}) {
  const fallbackPositions =
    defaultWorkflowAuthoringShellLayout(graph).positions;
  const nodes: WorkflowAuthoringReactFlowNodeV1[] = graph.nodes.map((node) => {
    const issueCount = issues.filter(
      (issue) => issue.nodeId === node.id,
    ).length;
    const previews = nodeDataPreviews(node, capabilities, language, t);
    const data: WorkflowAuthoringFlowNodeDataV1 = {
      kind: node.type,
      title: nodeTitle(node, t, capabilities, language),
      subtitle: t(nodeKindLabelKey(node)),
      summary: nodeSummary({ capabilities, node, t }),
      inputLabel: t("workflows.editor.inputConnection"),
      outputLabel: t("workflows.editor.outputConnection"),
      issueLabel: t("workflows.editor.issueCount", { count: issueCount }),
      issueCount,
      sourcePorts: sourcePorts(node),
      inputPreview: previews.inputs,
      outputPreview: previews.outputs,
      inputPreviewLabel: t("workflows.editor.shell.receives"),
      outputPreviewLabel: t("workflows.editor.shell.produces"),
    };
    return {
      id: node.id,
      type: "workflow-authoring-v1",
      data,
      position: positions[node.id] ??
        fallbackPositions[node.id] ?? { x: 0, y: 0 },
      draggable: true,
      deletable: false,
    };
  });
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const edges: Edge[] = graph.edges.map((edge) => {
    const sourceNode = nodeById.get(edge.source);
    const branch =
      sourceNode?.type === "condition"
        ? (sourceNode.cases.find(
            (item) => `case:${item.id}` === edge.sourcePort,
          )?.label ?? sourceNode.defaultLabel)
        : undefined;
    return {
      id: edge.id,
      source: edge.source,
      sourceHandle: edge.sourcePort,
      target: edge.target,
      type: "smoothstep",
      ...(branch ? { label: branch } : {}),
      labelStyle: { fill: "var(--muted)", fontSize: 10, fontWeight: 600 },
      style: { stroke: "var(--primary)", strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: "var(--primary)" },
      deletable: false,
    };
  });
  return { edges, nodes };
}

export function WorkflowReadonlyGraphV1({
  capabilities,
  graph,
}: {
  readonly capabilities: readonly WorkflowAuthoringCapability[];
  readonly graph: WorkflowAuthoringGraphV1;
}): React.JSX.Element {
  const { i18n, t } = useTranslation();
  const flow = useMemo(
    () =>
      buildFlow({
        capabilities,
        graph,
        issues: [],
        positions: {},
        t,
        language: i18n.resolvedLanguage ?? i18n.language,
      }),
    [capabilities, graph, i18n.language, i18n.resolvedLanguage, t],
  );

  return (
    <ReactFlow<WorkflowAuthoringReactFlowNodeV1>
      edges={flow.edges}
      elementsSelectable
      fitView
      maxZoom={1.25}
      minZoom={0.25}
      nodes={flow.nodes}
      nodesConnectable={false}
      nodesDraggable={false}
      nodesFocusable
      nodeTypes={nodeTypes}
    >
      <Background color="var(--line-strong)" gap={24} size={1} />
    </ReactFlow>
  );
}

function collectVariables({
  capabilities,
  graph,
  language,
  t,
}: {
  readonly capabilities: readonly WorkflowAuthoringCapability[];
  readonly graph: WorkflowAuthoringGraphV1;
  readonly language: string;
  readonly t: ReturnType<typeof useTranslation>["t"];
}): readonly WorkflowVariableSummary[] {
  const values: WorkflowVariableSummary[] = [];
  for (const node of graph.nodes) {
    if (node.type === "input") {
      for (const field of node.fields) {
        values.push({
          id: workflowVariableIdentity(node.id, field.key),
          label: field.label,
          source: t("workflows.editor.authoringKinds.input"),
          type: schemaType(field.schema.type),
          consumerCount: 0,
        });
      }
      continue;
    }
    if (node.type === "approval") {
      for (const field of workflowApprovalDecisionFields(
        node.decisionSchema,
        t("workflows.editor.approvalDecisionApprovedTitle"),
      )) {
        values.push({
          id: workflowVariableIdentity(node.id, field.key),
          label: field.title,
          source: nodeTitle(node, t, capabilities, language),
          type: field.type,
          consumerCount: 0,
        });
      }
      continue;
    }
    if (node.type !== "capability" && node.type !== "batch") continue;
    const reference = node.capability;
    const capability = capabilities.find(
      (item) =>
        item.contractId === reference.contractId &&
        item.revision === reference.revision,
    );
    for (const [key, schema] of Object.entries(
      schemaProperties(capability?.outputSchema ?? {}),
    )) {
      const value =
        typeof schema === "object" && schema !== null
          ? (schema as Readonly<Record<string, unknown>>)
          : {};
      values.push({
        id: workflowVariableIdentity(node.id, key),
        label:
          typeof value.title === "string" && value.title.trim()
            ? value.title
            : key,
        source: nodeTitle(node, t, capabilities, language),
        type: schemaType(value.type),
        consumerCount: 0,
      });
    }
  }
  const consumers = new Map<string, Set<string>>();
  for (const node of graph.nodes) {
    for (const binding of nodeBindings(node)) {
      for (const variable of bindingVariables(binding)) {
        const id = variableIdentity(variable);
        const nodeIds = consumers.get(id) ?? new Set<string>();
        nodeIds.add(node.id);
        consumers.set(id, nodeIds);
      }
    }
  }
  return values.map((value) => ({
    ...value,
    consumerCount: consumers.get(value.id)?.size ?? 0,
  }));
}

function collectVariableOptions({
  capabilities,
  graph,
  language,
  targetNodeId,
  t,
}: {
  readonly capabilities: readonly WorkflowAuthoringCapability[];
  readonly graph: WorkflowAuthoringGraphV1;
  readonly language: string;
  readonly targetNodeId: string;
  readonly t: ReturnType<typeof useTranslation>["t"];
}): readonly WorkflowAuthoringVariableOptionV1[] {
  const incoming = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const sources = incoming.get(edge.target) ?? [];
    sources.push(edge.source);
    incoming.set(edge.target, sources);
  }
  const ancestors = new Set<string>();
  const visit = (nodeId: string) => {
    for (const source of incoming.get(nodeId) ?? []) {
      if (ancestors.has(source)) continue;
      ancestors.add(source);
      visit(source);
    }
  };
  visit(targetNodeId);

  const options: WorkflowAuthoringVariableOptionV1[] = [];
  for (const node of graph.nodes) {
    if (!ancestors.has(node.id) && node.id !== workflowAuthoringInputNodeId) {
      continue;
    }
    if (node.type === "input") {
      for (const field of node.fields) {
        const semanticType = workflowInputSemanticType(field.schema);
        options.push({
          id: workflowVariableIdentity(node.id, field.key),
          label: field.label,
          sourceLabel: t("workflows.editor.workflowInputSource"),
          sourceNodeId: node.id,
          fieldKey: field.key,
          schema: field.schema,
          semanticType,
          variable: { source: "workflow_input", path: [field.key] },
        });
      }
      continue;
    }
    if (node.type === "approval") {
      for (const field of workflowApprovalDecisionFields(
        node.decisionSchema,
        t("workflows.editor.approvalDecisionApprovedTitle"),
      )) {
        options.push({
          id: workflowVariableIdentity(node.id, field.key),
          label: field.title,
          sourceLabel: nodeTitle(node, t, capabilities, language),
          sourceNodeId: node.id,
          fieldKey: field.key,
          schema: field.schema ?? { type: field.type },
          variable: {
            source: "node_output",
            nodeKey: node.nodeKey,
            scope: "root",
            path: [field.key],
          },
        });
      }
      continue;
    }
    if (node.type !== "capability" && node.type !== "batch") continue;
    const capability = capabilities.find(
      (item) => item.contractId === node.capability.contractId,
    );
    for (const [key, schema] of Object.entries(
      schemaProperties(capability?.outputSchema ?? {}),
    )) {
      const value =
        typeof schema === "object" && schema !== null
          ? (schema as Readonly<Record<string, unknown>>)
          : {};
      const declaration = workflowCapabilityOutput(capability, key);
      let label = key;
      if (typeof value.title === "string" && value.title.trim()) {
        label = value.title;
      }
      if (declaration) {
        label = workflowCapabilityText(declaration.label, language);
      }
      options.push({
        id: workflowVariableIdentity(node.id, key),
        label,
        sourceLabel: nodeTitle(node, t, capabilities, language),
        sourceNodeId: node.id,
        fieldKey: key,
        schema: value,
        ...(declaration ? { semanticType: declaration.semanticType } : {}),
        ...(declaration?.bundle ? { bundle: declaration.bundle } : {}),
        variable: {
          source: "node_output",
          nodeKey: node.nodeKey,
          scope: "root",
          path: [key],
        },
      });
    }
  }
  return options;
}

function RailButton({
  active,
  icon,
  label,
  onClick,
}: {
  readonly active: boolean;
  readonly icon: ReactNode;
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <Button
      aria-current={active ? "page" : undefined}
      block
      className="h-11 shrink-0 flex-col gap-0.5 rounded-lg px-0.5 py-1 font-medium transition-colors"
      color={active ? "primary" : "default"}
      onClick={onClick}
      type="text"
      variant={active ? "filled" : "text"}
    >
      <span className="text-base leading-none">{icon}</span>
      <span className="text-ui-caption">{label}</span>
    </Button>
  );
}

function WorkspacePanel({
  children,
  onClose,
  title,
}: {
  readonly children: ReactNode;
  readonly onClose: () => void;
  readonly title: string;
}) {
  const { t } = useTranslation();
  return (
    <section className="absolute top-0 bottom-0 left-[72px] z-40 grid w-80 grid-rows-[48px_minmax(0,1fr)] border-r border-[var(--canvas-panel-line)] bg-paper shadow-[10px_0_26px_rgb(26_28_38_/_0.055)]">
      <header className="flex items-center justify-between border-b border-[var(--canvas-panel-line)] px-3.5">
        <h2 className="m-0 text-[13px] font-semibold text-ink">{title}</h2>
        <Tooltip title={t("workflows.editor.shell.closePanel")}>
          <Button
            aria-label={t("workflows.editor.shell.closePanel")}
            icon={<CloseOutlined aria-hidden="true" />}
            onClick={onClose}
            shape="circle"
            size="small"
            type="text"
          />
        </Tooltip>
      </header>
      <div className="min-h-0 overflow-auto px-3.5 py-4">{children}</div>
    </section>
  );
}

function NodeInspector({
  capabilities,
  node,
  onClose,
  onEdit,
}: {
  readonly capabilities: readonly WorkflowAuthoringCapability[];
  readonly node: WorkflowAuthoringNodeV1;
  readonly onClose: () => void;
  readonly onEdit: () => void;
}) {
  const { i18n, t } = useTranslation();
  const rows: readonly { label: string; value: string }[] = (() => {
    if (node.type === "input" || node.type === "output") {
      return [
        {
          label: t("workflows.editor.shell.fields"),
          value: String(node.fields.length),
        },
      ];
    }
    if (node.type === "condition") {
      return [
        {
          label: t("workflows.editor.shell.branches"),
          value: String(node.cases.length + 1),
        },
      ];
    }
    if (node.type === "batch") {
      return [
        { label: t("workflows.editor.maxItems"), value: String(node.maxItems) },
        {
          label: t("workflows.editor.concurrency"),
          value: String(node.maxConcurrency),
        },
      ];
    }
    if (node.type === "approval") {
      return [
        {
          label: t("workflows.editor.shell.decisions"),
          value: String(workflowSchemaFields(node.decisionSchema).length),
        },
      ];
    }
    const capability = capabilities.find(
      (item) =>
        item.contractId === node.capability.contractId &&
        item.revision === node.capability.revision,
    );
    const visibleInputs = capability?.authoring.parameters.filter(
      (parameter) => parameter.exposurePolicy.default !== "hidden_derived",
    ).length;
    const visibleOutputs = capability?.authoring.outputs.filter(
      (output) => output.visibility === "author",
    ).length;
    return [
      {
        label: t("workflows.editor.shell.inputs"),
        value: String(visibleInputs ?? bindingFieldCount(node.input)),
      },
      {
        label: t("workflows.editor.shell.outputs"),
        value: String(
          visibleOutputs ??
            Object.keys(schemaProperties(capability?.outputSchema ?? {}))
              .length,
        ),
      },
    ];
  })();
  return (
    <section className="absolute top-3 right-3 z-40 grid w-80 overflow-hidden rounded-xl border border-[var(--canvas-panel-line)] bg-paper shadow-[0_12px_34px_rgb(28_30_45_/_13%)]">
      <header className="flex items-center justify-between border-b border-[var(--canvas-panel-line)] px-4 py-3">
        <div className="min-w-0">
          <h2 className="m-0 truncate text-[13px] font-semibold text-ink">
            {nodeTitle(node, t, capabilities, i18n.language)}
          </h2>
          {t(nodeKindLabelKey(node)) !==
          nodeTitle(node, t, capabilities, i18n.language) ? (
            <span className="text-[11px] text-muted">
              {t(nodeKindLabelKey(node))}
            </span>
          ) : null}
        </div>
        <Tooltip title={t("workflows.editor.shell.closePanel")}>
          <Button
            aria-label={t("workflows.editor.shell.closePanel")}
            icon={<CloseOutlined aria-hidden="true" />}
            onClick={onClose}
            shape="circle"
            size="small"
            type="text"
          />
        </Tooltip>
      </header>
      <div className="grid gap-3 p-4">
        {rows.map((row) => (
          <div
            className="flex items-center justify-between gap-4 rounded-lg bg-mist px-3 py-2"
            key={row.label}
          >
            <span className="text-xs text-muted">{row.label}</span>
            <strong className="text-xs text-ink">{row.value}</strong>
          </div>
        ))}
        <Button block onClick={onEdit} type="primary">
          {t("workflows.editor.configureNode")}
        </Button>
      </div>
    </section>
  );
}

function BottomWorkspace({
  active,
  issues,
  onClose,
  variables,
}: {
  readonly active: BottomPanel;
  readonly issues: readonly WorkflowAuthoringShellIssue[];
  readonly onClose: () => void;
  readonly variables: readonly WorkflowVariableSummary[];
}) {
  const { t } = useTranslation();
  let content: ReactNode;
  if (active === "problems") {
    content =
      issues.length > 0 ? (
        <div className="grid gap-2">
          {issues.map((issue) => (
            <div
              className="flex items-center gap-3 rounded-lg bg-danger-surface px-3 py-2 text-xs text-danger"
              key={issue.code}
            >
              <ExclamationCircleOutlined aria-hidden="true" />
              {t(`workflows.editor.shell.issues.${issue.code}`)}
            </div>
          ))}
        </div>
      ) : (
        <Empty description={t("workflows.editor.noProblems")} />
      );
  } else if (active === "variables") {
    content =
      variables.length > 0 ? (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
          {variables.map((variable) => (
            <div
              className="grid gap-1 rounded-lg border border-line bg-paper px-3 py-2"
              key={variable.id}
            >
              <strong className="truncate text-xs text-ink">
                {variable.label}
              </strong>
              <span className="truncate text-[11px] text-muted">
                {variable.source} · {variable.type}
              </span>
              <span className="text-[11px] text-muted">
                {t("workflows.editor.shell.consumerSummary", {
                  count: variable.consumerCount,
                })}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <Empty description={t("workflows.editor.shell.noVariables")} />
      );
  } else {
    content = <Empty description={t("workflows.editor.shell.noRuns")} />;
  }
  return (
    <section className="absolute right-4 bottom-4 left-20 z-30 grid max-h-[310px] grid-rows-[44px_minmax(0,1fr)] overflow-hidden rounded-xl border border-[var(--canvas-panel-line)] bg-[rgb(251_251_252_/_97%)] shadow-[0_12px_34px_rgb(28_30_45_/_14%)] backdrop-blur-xl">
      <header className="flex items-center justify-between border-b border-[var(--canvas-panel-line)] px-4">
        <strong className="text-xs text-ink">
          {t(`workflows.editor.shell.bottom.${active}`)}
        </strong>
        <Button
          aria-label={t("workflows.editor.shell.closePanel")}
          icon={<CloseOutlined aria-hidden="true" />}
          onClick={onClose}
          shape="circle"
          size="small"
          type="text"
        />
      </header>
      <div className="min-h-0 overflow-auto p-4">{content}</div>
    </section>
  );
}

interface WorkflowAuthoringConflictV1 {
  readonly source: "recovery" | "save";
  readonly latest?: WorkflowDraft;
  readonly loading: boolean;
  readonly open: boolean;
  readonly error?: string;
}

function WorkflowAuthoringConflictDialogV1({
  conflict,
  localDisplayName,
  localNodeCount,
  localVersion,
  onKeepLocal,
  onClose,
  onReadLatest,
  onUseLatest,
  resolving,
}: {
  readonly conflict: WorkflowAuthoringConflictV1 | undefined;
  readonly localDisplayName: string;
  readonly localNodeCount: number;
  readonly localVersion: number;
  readonly onKeepLocal: () => Promise<void>;
  readonly onClose: () => void;
  readonly onReadLatest: () => Promise<void>;
  readonly onUseLatest: () => void;
  readonly resolving?: "keep_local" | "use_latest";
}): React.JSX.Element {
  const { t } = useTranslation();
  const latest = conflict?.latest;
  const latestNodeCount = latest
    ? projectWorkflowAuthoringGraph(latest.draft.document).nodes.filter(
        (node) => node.type !== "input" && node.type !== "output",
      ).length
    : 0;
  function retryReadLatest(): void {
    void onReadLatest();
  }

  function keepLocal(): void {
    void onKeepLocal();
  }

  return (
    <Modal
      centered
      footer={null}
      mask={{ closable: false }}
      onCancel={onClose}
      open={Boolean(conflict?.open)}
      title={t("workflows.editor.conflict.title")}
      width={620}
    >
      <p className="mt-1 mb-5 text-sm leading-6 text-muted">
        {t(
          `workflows.editor.conflict.${conflict?.source ?? "save"}Description`,
        )}
      </p>
      {conflict?.loading ? <Skeleton active paragraph={{ rows: 3 }} /> : null}
      {conflict?.error ? (
        <div className="grid justify-items-start gap-3" role="alert">
          <span className="text-sm text-danger">{conflict.error}</span>
          <Button onClick={retryReadLatest}>
            {t("workflows.editor.conflict.retry")}
          </Button>
        </div>
      ) : null}
      {latest ? (
        <div className="grid divide-y divide-line">
          <section className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div>
              <strong className="text-sm text-ink">
                {t("workflows.editor.conflict.keepLocal")}
              </strong>
              <p className="mt-1 mb-0 text-xs leading-5 text-muted">
                {t("workflows.editor.conflict.localSummary", {
                  name: localDisplayName,
                  nodes: localNodeCount,
                  version: localVersion,
                })}
              </p>
            </div>
            <Button
              loading={resolving === "keep_local"}
              onClick={keepLocal}
              type="primary"
            >
              {t("workflows.editor.conflict.keepLocal")}
            </Button>
          </section>
          <section className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div>
              <strong className="text-sm text-ink">
                {t("workflows.editor.conflict.useLatest")}
              </strong>
              <p className="mt-1 mb-0 text-xs leading-5 text-muted">
                {t("workflows.editor.conflict.latestSummary", {
                  name: latest.definition.displayName,
                  nodes: latestNodeCount,
                  version: latest.draft.version,
                })}
              </p>
            </div>
            <Button
              disabled={Boolean(resolving)}
              loading={resolving === "use_latest"}
              onClick={onUseLatest}
            >
              {t("workflows.editor.conflict.useLatest")}
            </Button>
          </section>
        </div>
      ) : null}
    </Modal>
  );
}

export function WorkflowAuthoringWorkspaceV1({
  canAuthor,
  canPublish,
  canRun,
  csrfToken,
  embedded = false,
  onExit,
  exitLabel,
  workflowDefinitionId,
  workspaceId,
}: {
  readonly canAuthor: boolean;
  readonly canPublish: boolean;
  readonly canRun: boolean;
  readonly csrfToken: string;
  readonly embedded?: boolean;
  readonly onExit?: () => void;
  readonly exitLabel?: string;
  readonly workflowDefinitionId: string;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  useDocumentTitle(t("workflows.editor.documentTitle"));
  const draftQuery = useQuery({
    queryKey: ["workflow-draft", workspaceId, workflowDefinitionId],
    queryFn: () => fetchWorkflowDraft(workspaceId, workflowDefinitionId),
    retry: false,
  });
  const capabilitiesQuery = useQuery({
    queryKey: ["workflow-authoring-capabilities", workspaceId],
    queryFn: () => fetchWorkflowAuthoringCapabilities(workspaceId),
    retry: false,
  });
  if (draftQuery.isPending || capabilitiesQuery.isPending) {
    return (
      <div className="relative h-full bg-mist">
        {embedded && onExit ? (
          <Button
            aria-label={t("workflows.editor.closeWorkspace")}
            className="absolute top-3 right-3 z-10"
            icon={<CloseOutlined />}
            onClick={onExit}
          />
        ) : null}
        <PageLoading label={t("workflows.editor.loading")} />
      </div>
    );
  }
  if (draftQuery.isError || capabilitiesQuery.isError) {
    return (
      <div className="relative grid h-full place-items-center bg-paper">
        {embedded && onExit ? (
          <Button
            aria-label={t("workflows.editor.closeWorkspace")}
            className="absolute top-3 right-3 z-10"
            icon={<CloseOutlined />}
            onClick={onExit}
          />
        ) : null}
        <PageEmptyState
          action={() => {
            void Promise.all([
              draftQuery.refetch(),
              capabilitiesQuery.refetch(),
            ]);
          }}
          actionLabel={t("workflows.editor.reload")}
          title={t("workflows.editor.loadError")}
        >
          {t("workflows.editor.loadErrorDescription")}
        </PageEmptyState>
      </div>
    );
  }
  return (
    <LoadedWorkflowAuthoringWorkspaceV1
      canAuthor={canAuthor}
      canPublish={canPublish}
      canRun={canRun}
      capabilities={capabilitiesQuery.data.items}
      csrfToken={csrfToken}
      draft={draftQuery.data}
      embedded={embedded}
      {...(onExit ? { onExit } : {})}
      {...(exitLabel ? { exitLabel } : {})}
      workspaceId={workspaceId}
    />
  );
}

function LoadedWorkflowAuthoringWorkspaceV1({
  canAuthor,
  canPublish,
  canRun,
  capabilities,
  csrfToken,
  draft,
  embedded,
  onExit,
  exitLabel,
  workspaceId,
}: {
  readonly canAuthor: boolean;
  readonly canPublish: boolean;
  readonly canRun: boolean;
  readonly capabilities: readonly WorkflowAuthoringCapability[];
  readonly csrfToken: string;
  readonly draft: WorkflowDraft;
  readonly embedded: boolean;
  readonly onExit?: () => void;
  readonly exitLabel?: string;
  readonly workspaceId: string;
}) {
  const { i18n, t } = useTranslation();
  const { message } = AntApp.useApp();
  const [initialRecovery] = useState(() =>
    readWorkflowAuthoringRecovery(workspaceId, draft.draft.id),
  );
  const [recoveryBase, setRecoveryBase] = useState({
    definitionVersion:
      initialRecovery?.baseDefinitionVersion ?? draft.definition.version,
    draftVersion: initialRecovery?.baseDraftVersion ?? draft.draft.version,
  });
  const [serverDraft, setServerDraft] = useState(draft);
  const [graph, setGraph] = useState<WorkflowAuthoringGraphV1>(() =>
    localizeApprovalOutcomeGraph(
      initialRecovery?.graph ??
        projectWorkflowAuthoringGraph(draft.draft.document),
      t,
    ),
  );
  const [displayName, setDisplayName] = useState(
    initialRecovery?.displayName ?? draft.definition.displayName,
  );
  const [presentation, setPresentation] = useState<WorkflowPresentation>(() => {
    if (initialRecovery?.presentation) {
      return normalizeWorkflowPresentation(initialRecovery.presentation);
    }
    if (draft.draft.document.presentation) {
      return normalizeWorkflowPresentation(draft.draft.document.presentation);
    }
    return defaultWorkflowPresentation(draft);
  });
  const [presentationOpen, setPresentationOpen] = useState(false);
  const [presentationUploadBusy, setPresentationUploadBusy] = useState(false);
  const [dirty, setDirty] = useState(Boolean(initialRecovery));
  const [recoveryRestored, setRecoveryRestored] = useState(
    Boolean(initialRecovery),
  );
  const [exitConfirmationOpen, setExitConfirmationOpen] = useState(false);
  const [conflict, setConflict] = useState<
    WorkflowAuthoringConflictV1 | undefined
  >(() =>
    initialRecovery &&
    (initialRecovery.baseDefinitionVersion !== draft.definition.version ||
      initialRecovery.baseDraftVersion !== draft.draft.version)
      ? { source: "recovery", latest: draft, loading: false, open: true }
      : undefined,
  );
  const [conflictResolution, setConflictResolution] = useState<
    "keep_local" | "use_latest"
  >();
  const issues = useMemo(() => workflowAuthoringShellIssues(graph), [graph]);
  const variables = useMemo(
    () =>
      collectVariables({
        capabilities,
        graph,
        language: i18n.language,
        t,
      }),
    [capabilities, graph, i18n.language, t],
  );
  const layout = useMemo(
    () =>
      readWorkflowAuthoringShellLayout(draft.draft.id) ??
      defaultWorkflowAuthoringShellLayout(graph),
    [draft.draft.id, graph],
  );
  const initialFlow = useMemo(
    () =>
      buildFlow({
        capabilities,
        graph,
        issues,
        language: i18n.language,
        positions: layout.positions,
        t,
      }),
    [capabilities, graph, i18n.language, issues, layout.positions, t],
  );
  const [nodes, setNodes, onNodesChange] =
    useNodesState<WorkflowAuthoringReactFlowNodeV1>(initialFlow.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialFlow.edges);
  const [selectedId, setSelectedId] = useState(graph.nodes[0]?.id);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [nodeLibraryOpen, setNodeLibraryOpen] = useState(false);
  const [nodeLibrarySearch, setNodeLibrarySearch] = useState("");
  const [bottomPanel, setBottomPanel] = useState<BottomPanel>();
  const [candidateOpen, setCandidateOpen] = useState(false);
  const [candidateRunActive, setCandidateRunActive] = useState(false);
  const [candidateSection, setCandidateSection] =
    useState<WorkflowCandidatePanelSection>("test");
  const [editingNodeId, setEditingNodeId] = useState<string>();
  const currentSaveSnapshotRef = useRef<WorkflowAuthoringSaveSnapshot>({
    displayName,
    graph,
    presentation,
  });
  useLayoutEffect(() => {
    currentSaveSnapshotRef.current = { displayName, graph, presentation };
  }, [displayName, graph, presentation]);
  const authorableNodeLibraryCapabilities = useMemo(
    () => latestAuthoringCapabilities(capabilities),
    [capabilities],
  );
  const visibleNodeLibraryCapabilities = useMemo(() => {
    const query = nodeLibrarySearch.trim().toLocaleLowerCase();
    if (!query) return authorableNodeLibraryCapabilities;
    return authorableNodeLibraryCapabilities.filter((capability) => {
      const title = workflowCapabilityText(
        capability.authoring.catalog.title,
        i18n.language,
      );
      const description = capability.authoring.catalog.description
        ? workflowCapabilityText(
            capability.authoring.catalog.description,
            i18n.language,
          )
        : "";
      return `${title} ${description} ${capability.contractKey}`
        .toLocaleLowerCase()
        .includes(query);
    });
  }, [authorableNodeLibraryCapabilities, i18n.language, nodeLibrarySearch]);
  const nodeLibraryGroups = useMemo(
    () =>
      groupAuthoringCapabilities(visibleNodeLibraryCapabilities, i18n.language),
    [i18n.language, visibleNodeLibraryCapabilities],
  );
  const flowRef =
    useRef<ReactFlowInstance<WorkflowAuthoringReactFlowNodeV1>>(null);
  const selectedNode = graph.nodes.find((node) => node.id === selectedId);
  const editingNode = graph.nodes.find((node) => node.id === editingNodeId);
  const editorVariables = useMemo(
    () =>
      editingNode
        ? collectVariableOptions({
            capabilities,
            graph,
            language: i18n.language,
            targetNodeId: editingNode.id,
            t,
          })
        : [],
    [capabilities, editingNode, graph, i18n.language, t],
  );
  const saveMutation = useMutation({
    mutationFn: async ({
      baseDraft,
      snapshot,
    }: WorkflowAuthoringSaveRequest) => {
      const compiled = compileWorkflowAuthoringGraph(snapshot.graph);
      const document = {
        ...compiled,
        presentation: snapshot.presentation,
      };
      return updateWorkflowDraft(
        { csrfToken, workspaceId },
        baseDraft.definition.id,
        baseDraft.draft.id,
        {
          expectedDefinitionVersion: baseDraft.definition.version,
          expectedDraftVersion: baseDraft.draft.version,
          displayName: snapshot.displayName,
          ...(baseDraft.definition.description
            ? { description: baseDraft.definition.description }
            : {}),
          ...(baseDraft.definition.category
            ? { category: baseDraft.definition.category }
            : {}),
          document,
        },
      );
    },
    onError: (error) => {
      if (error instanceof ApiProblem && error.status === apiConflictStatus) {
        void message.warning(t("workflows.editor.saveConflict"));
        void readLatestForConflict("save");
        return;
      }
      void message.error(t("workflows.editor.saveFailed"));
    },
    onSuccess: (result, request) => {
      const savedPresentation = result.value.draft.document.presentation
        ? normalizeWorkflowPresentation(
            result.value.draft.document.presentation,
          )
        : defaultWorkflowPresentation(result.value);
      const currentSnapshot = currentSaveSnapshotRef.current;
      const reconciliation = reconcileWorkflowAuthoringSave(
        request.snapshot,
        currentSnapshot,
        savedPresentation,
      );
      setServerDraft(result.value);
      setRecoveryBase({
        definitionVersion: result.value.definition.version,
        draftVersion: result.value.draft.version,
      });
      setPresentation(reconciliation.presentation);
      setDirty(reconciliation.dirty);
      setRecoveryRestored(false);
      setConflict(undefined);
      if (reconciliation.clearRecovery) {
        clearWorkflowAuthoringRecovery(workspaceId, result.value.draft.id);
        void message.success(t("workflows.editor.savedToast"));
      } else {
        writeWorkflowAuthoringRecovery({
          schemaVersion: 1,
          workspaceId,
          draftId: result.value.draft.id,
          baseDefinitionVersion: result.value.definition.version,
          baseDraftVersion: result.value.draft.version,
          displayName: currentSnapshot.displayName,
          graph: currentSnapshot.graph,
          presentation: currentSnapshot.presentation,
          savedAt: new Date().toISOString(),
        });
      }
    },
  });

  useEffect(() => {
    if (!dirty) return;
    writeWorkflowAuthoringRecovery({
      schemaVersion: 1,
      workspaceId,
      draftId: serverDraft.draft.id,
      baseDefinitionVersion: recoveryBase.definitionVersion,
      baseDraftVersion: recoveryBase.draftVersion,
      displayName,
      graph,
      presentation,
      savedAt: new Date().toISOString(),
    });
  }, [
    dirty,
    displayName,
    graph,
    presentation,
    recoveryBase.definitionVersion,
    recoveryBase.draftVersion,
    serverDraft.draft.id,
    workspaceId,
  ]);
  const canExecute =
    canAuthor &&
    issues.length === 0 &&
    !dirty &&
    !conflict &&
    !saveMutation.isPending &&
    !presentationUploadBusy;
  let saveStatus = t("workflows.editor.saved");
  if (dirty) saveStatus = t("workflows.editor.unsaved");
  if (recoveryRestored) {
    saveStatus = t("workflows.editor.recoveredUnsaved");
  }
  if (saveMutation.isPending) saveStatus = t("workflows.editor.saving");
  const executionBlockLabel =
    issues.length > 0
      ? t("workflows.editor.shell.resolveProblemsFirst")
      : t("workflows.editor.shell.saveFirst");
  const requiredBrowserCapabilityKeys = useMemo(
    () =>
      graph.nodes.flatMap((node) =>
        node.type === "capability" || node.type === "batch"
          ? [node.capability.contractId]
          : [],
      ),
    [graph.nodes],
  );
  useCanvasBrowserRuntimesV1({
    canEdit:
      canRun &&
      candidateSection === "test" &&
      (candidateOpen || candidateRunActive),
    csrfToken,
    requiredCapabilityKeys: requiredBrowserCapabilityKeys,
    workspaceId,
  });

  useEffect(() => {
    setNodes((current) => {
      const positions = new Map(
        current.map((node) => [node.id, node.position]),
      );
      return initialFlow.nodes.map((node) => ({
        ...node,
        position: positions.get(node.id) ?? node.position,
      }));
    });
    setEdges(initialFlow.edges);
  }, [initialFlow.edges, initialFlow.nodes, setEdges, setNodes]);

  function selectNode(nodeId: string) {
    setSelectedId(nodeId);
    const instance = flowRef.current;
    const node = instance?.getNode(nodeId);
    if (instance && node) {
      void instance.setCenter(
        node.position.x + nodeCenterX,
        node.position.y + nodeCenterY,
        {
          duration: 240,
          zoom: Math.max(instance.getZoom(), minimumFocusZoom),
        },
      );
    }
  }

  function toggleBottom(panel: BottomPanel) {
    setBottomPanel((current) => (current === panel ? undefined : panel));
    setOutlineOpen(false);
    setNodeLibraryOpen(false);
    setPresentationOpen(false);
  }

  function updateAuthoringNode(node: WorkflowAuthoringNodeV1) {
    setGraph((current) => {
      let edges = current.edges;
      if (node.type === "condition") {
        const outgoing = current.edges.filter(
          (edge) => edge.source === node.id,
        );
        const fallbackTarget =
          outgoing.find((edge) => edge.sourcePort === "default")?.target ??
          outgoing[0]?.target ??
          workflowAuthoringOutputNodeId;
        const allowedPorts = new Set([
          "default",
          ...node.cases.map((item) => `case:${item.id}`),
        ]);
        edges = current.edges.filter(
          (edge) =>
            edge.source !== node.id || allowedPorts.has(edge.sourcePort),
        );
        for (const item of node.cases) {
          const port = `case:${item.id}` as const;
          if (
            !edges.some(
              (edge) => edge.source === node.id && edge.sourcePort === port,
            )
          ) {
            edges = [
              ...edges,
              {
                id: `${node.id}:${port}:${fallbackTarget}`,
                source: node.id,
                sourcePort: port,
                target: fallbackTarget,
              },
            ];
          }
        }
      }
      return {
        ...current,
        nodes: current.nodes.map((item) => (item.id === node.id ? node : item)),
        edges,
      };
    });
    setDirty(true);
  }

  function addAuthoringNode(
    kind: RuntimeAuthoringKind,
    capability = capabilities[0],
  ) {
    const node = createRuntimeAuthoringNode(kind, capability, i18n.language, t);
    if (!node) {
      void message.warning(t("workflows.editor.capabilityUnavailable"));
      return;
    }
    const approvalOutcome =
      node.type === "approval" ? createApprovalOutcomeNode(node, t) : undefined;
    setGraph((current) => {
      const insertionEdge = preferredAuthoringInsertionEdge(
        current,
        selectedId,
      );
      if (!insertionEdge) return current;
      if (node.type === "approval" && approvalOutcome) {
        return replaceAuthoringEdgeWithApprovalGate(
          current,
          insertionEdge,
          node,
          approvalOutcome,
        );
      }
      const nextEdges = current.edges.filter(
        (edge) => edge.id !== insertionEdge.id,
      );
      nextEdges.push({
        id: `${insertionEdge.source}:${insertionEdge.sourcePort}:${node.id}`,
        source: insertionEdge.source,
        sourcePort: insertionEdge.sourcePort,
        target: node.id,
      });
      if (node.type === "condition") {
        nextEdges.push(
          {
            id: `${node.id}:case:${node.cases[0]!.id}:${insertionEdge.target}`,
            source: node.id,
            sourcePort: `case:${node.cases[0]!.id}`,
            target: insertionEdge.target,
          },
          {
            id: `${node.id}:default:${insertionEdge.target}`,
            source: node.id,
            sourcePort: "default",
            target: insertionEdge.target,
          },
        );
      } else {
        nextEdges.push({
          id: `${node.id}:out:${insertionEdge.target}`,
          source: node.id,
          sourcePort: "out",
          target: insertionEdge.target,
        });
      }
      return {
        ...current,
        nodes: [...current.nodes, node],
        edges: nextEdges,
      };
    });
    setSelectedId(node.id);
    setEditingNodeId(node.id);
    setNodeLibraryOpen(false);
    setDirty(true);
  }

  function connectNodes(connection: Connection) {
    if (!connection.source || !connection.target || !connection.sourceHandle) {
      return;
    }
    setGraph((current) => ({
      ...current,
      edges: [
        ...current.edges.filter(
          (edge) =>
            !(
              edge.source === connection.source &&
              edge.sourcePort === connection.sourceHandle
            ),
        ),
        {
          id: `${connection.source}:${connection.sourceHandle}:${connection.target}`,
          source: connection.source,
          sourcePort:
            connection.sourceHandle as WorkflowAuthoringGraphV1["edges"][number]["sourcePort"],
          target: connection.target,
        },
      ],
    }));
    setDirty(true);
  }

  function validConnection(connection: Connection | Edge): boolean {
    if (!connection.source || !connection.target || !connection.sourceHandle) {
      return false;
    }
    if (
      connection.source === connection.target ||
      connection.target === workflowAuthoringInputNodeId
    ) {
      return false;
    }
    const source = graph.nodes.find((node) => node.id === connection.source);
    if (!source || source.type === "output") return false;
    if (
      source.type === "condition" &&
      connection.target === workflowAuthoringOutputNodeId
    ) {
      return false;
    }
    return true;
  }

  function updateDisplayName(event: ChangeEvent<HTMLInputElement>): void {
    setDisplayName(event.currentTarget.value);
    setDirty(true);
  }

  async function readLatestForConflict(
    source: WorkflowAuthoringConflictV1["source"] = conflict?.source ?? "save",
  ): Promise<void> {
    setConflict({ source, loading: true, open: true });
    try {
      const latest = await fetchWorkflowDraft(
        workspaceId,
        serverDraft.definition.id,
      );
      setConflict({ source, latest, loading: false, open: true });
    } catch {
      setConflict({
        source,
        loading: false,
        open: true,
        error: t("workflows.editor.conflict.loadLatestFailed"),
      });
    }
  }

  async function keepLocalAfterConflict(): Promise<void> {
    if (!conflict?.latest) return;
    setConflictResolution("keep_local");
    try {
      await saveMutation.mutateAsync({
        baseDraft: conflict.latest,
        snapshot: currentSaveSnapshotRef.current,
      });
    } catch {
      // The mutation keeps the local snapshot and reloads the newest base on 409.
    } finally {
      setConflictResolution(undefined);
    }
  }

  function applyLatestAfterConflict(): void {
    if (!conflict?.latest) return;
    setConflictResolution("use_latest");
    const latest = conflict.latest;
    const latestGraph = localizeApprovalOutcomeGraph(
      projectWorkflowAuthoringGraph(latest.draft.document),
      t,
    );
    setServerDraft(latest);
    setGraph(latestGraph);
    setDisplayName(latest.definition.displayName);
    setPresentation(
      latest.draft.document.presentation
        ? normalizeWorkflowPresentation(latest.draft.document.presentation)
        : defaultWorkflowPresentation(latest),
    );
    setSelectedId(latestGraph.nodes[0]?.id);
    setEditingNodeId(undefined);
    setRecoveryBase({
      definitionVersion: latest.definition.version,
      draftVersion: latest.draft.version,
    });
    setDirty(false);
    setRecoveryRestored(false);
    setConflict(undefined);
    setConflictResolution(undefined);
    clearWorkflowAuthoringRecovery(workspaceId, latest.draft.id);
  }

  function saveWorkflow(): void {
    if (conflict) {
      setConflict({ ...conflict, open: true });
      return;
    }
    saveMutation.mutate({
      baseDraft: serverDraft,
      snapshot: currentSaveSnapshotRef.current,
    });
  }

  function requestExit(): void {
    if (dirty || saveMutation.isPending) {
      setExitConfirmationOpen(true);
      return;
    }
    onExit?.();
  }

  function openTestCandidate(): void {
    setCandidateSection("test");
    setCandidateOpen(true);
  }

  function openPublishCandidate(): void {
    setCandidateSection("publish");
    setCandidateOpen(true);
  }

  function closeExitConfirmation(): void {
    setExitConfirmationOpen(false);
  }

  function confirmExit(): void {
    setExitConfirmationOpen(false);
    onExit?.();
  }

  function toggleNodeLibraryPanel(): void {
    setNodeLibraryOpen((current) => !current);
    setOutlineOpen(false);
    setPresentationOpen(false);
    setBottomPanel(undefined);
  }

  function toggleOutlinePanel(): void {
    setOutlineOpen((current) => !current);
    setNodeLibraryOpen(false);
    setPresentationOpen(false);
    setBottomPanel(undefined);
  }

  function togglePresentationPanel(): void {
    setPresentationOpen((current) => !current);
    setNodeLibraryOpen(false);
    setOutlineOpen(false);
    setBottomPanel(undefined);
  }

  return (
    <main
      className={cn(
        "grid h-[100dvh] min-w-0 grid-rows-[56px_minmax(0,1fr)] overflow-hidden bg-mist text-ink",
        embedded && "h-full",
      )}
    >
      <UnsavedChangesGuard
        actionLabel={t("workflows.editor.leave.action")}
        active={dirty || saveMutation.isPending}
        cancelLabel={t("workflows.editor.leave.keepEditing")}
        title={t("workflows.editor.leave.title")}
      >
        {t("workflows.editor.leave.description")}
      </UnsavedChangesGuard>
      <Modal
        cancelButtonProps={{ autoFocus: true }}
        cancelText={t("workflows.editor.leave.keepEditing")}
        centered
        mask={{ closable: false }}
        okButtonProps={{ danger: true }}
        okText={t("workflows.editor.leave.action")}
        onCancel={closeExitConfirmation}
        onOk={confirmExit}
        open={exitConfirmationOpen}
        title={t("workflows.editor.leave.title")}
      >
        <p className="mb-0 text-sm leading-6 text-muted">
          {t("workflows.editor.leave.description")}
        </p>
      </Modal>
      <WorkflowAuthoringConflictDialogV1
        conflict={conflict}
        localDisplayName={displayName}
        localNodeCount={
          graph.nodes.filter(
            (node) => node.type !== "input" && node.type !== "output",
          ).length
        }
        localVersion={recoveryBase.draftVersion}
        onClose={() =>
          setConflict((current) =>
            current ? { ...current, open: false } : undefined,
          )
        }
        onKeepLocal={keepLocalAfterConflict}
        onReadLatest={readLatestForConflict}
        onUseLatest={applyLatestAfterConflict}
        {...(conflictResolution ? { resolving: conflictResolution } : {})}
      />
      <ConfigProvider theme={kanvasInverseControlTheme}>
        <header className="relative z-[60] grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-white/10 bg-[linear-gradient(90deg,#3048f5_0%,#394cf1_55%,#3048f5_100%)] px-2 py-[7px] text-white sm:px-3">
          <div className="flex min-w-0 items-center gap-0.5 sm:gap-1">
            {onExit ? (
              <button
                className="inline-flex h-[34px] items-center gap-1.5 rounded-[7px] bg-transparent py-0 pr-[9px] pl-2 text-xs font-semibold text-white transition-[background-color,transform] duration-150 hover:bg-white/15 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white"
                onClick={requestExit}
                type="button"
              >
                {embedded ? (
                  <CloseOutlined aria-hidden="true" className="text-[15px]" />
                ) : (
                  <ArrowLeftOutlined
                    aria-hidden="true"
                    className="text-[15px]"
                  />
                )}
                <span className="hidden lg:inline">
                  {exitLabel ??
                    t(
                      embedded
                        ? "workflows.editor.closeWorkspace"
                        : "workflows.editor.back",
                    )}
                </span>
              </button>
            ) : (
              <Link
                className="inline-flex h-[34px] items-center gap-1.5 rounded-[7px] py-0 pr-[9px] pl-2 text-xs font-semibold text-white no-underline transition-[background-color,transform] duration-150 hover:bg-white/15 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white"
                params={{ workspaceId }}
                to="/w/$workspaceId/workflows"
              >
                <ArrowLeftOutlined aria-hidden="true" className="text-[15px]" />
                <span className="hidden lg:inline">
                  {t("workflows.editor.back")}
                </span>
              </Link>
            )}
            <Brand
              className="grid size-[34px] place-items-center text-white [&_.brand-mark]:size-[25px] [&_.brand-mark]:shadow-[0_0_0_2px_rgb(255_255_255_/_78%)]"
              compact
            />
            <span
              aria-hidden="true"
              className="mx-1 hidden h-[18px] w-px bg-white/25 sm:block"
            />
            <Input
              aria-label={t("workflows.editor.nameLabel")}
              className="!h-9 !w-[clamp(104px,22vw,320px)] !px-2.5 !font-semibold"
              disabled={!canAuthor}
              maxLength={240}
              onChange={updateDisplayName}
              value={displayName}
              variant="filled"
            />
            <span
              aria-live="polite"
              className="ml-1 hidden shrink-0 text-[11px] font-medium text-white/75 sm:inline"
              role="status"
            >
              {saveStatus}
            </span>
          </div>
          <div className="flex items-center gap-1 justify-self-end sm:gap-2">
            <Tooltip title={t("workflows.editor.undo")}>
              <Button
                aria-label={t("workflows.editor.undo")}
                className="!hidden !size-9 !p-0 sm:!inline-flex"
                disabled
                icon={<UndoOutlined aria-hidden="true" className="text-lg" />}
                type="text"
              />
            </Tooltip>
            <Button
              aria-label={t("workflows.editor.save")}
              className="!size-9 !p-0 !text-xs !font-semibold lg:!h-[38px] lg:!w-auto lg:!px-[13px]"
              disabled={
                !dirty ||
                !canAuthor ||
                saveMutation.isPending ||
                presentationUploadBusy
              }
              icon={<SaveOutlined aria-hidden="true" />}
              loading={saveMutation.isPending}
              onClick={saveWorkflow}
              variant="outlined"
            >
              <span className="hidden lg:inline">
                {t("workflows.editor.save")}
              </span>
            </Button>
            <Tooltip
              title={
                canExecute ? t("workflows.editor.testRun") : executionBlockLabel
              }
            >
              <Button
                aria-label={t("workflows.editor.testRun")}
                className="!size-9 !p-0 !text-xs !font-semibold lg:!h-[38px] lg:!w-auto lg:!px-[13px]"
                disabled={!canExecute || !canRun}
                icon={<ExperimentOutlined aria-hidden="true" />}
                onClick={openTestCandidate}
                variant="outlined"
              >
                <span className="hidden lg:inline">
                  {t("workflows.editor.testRun")}
                </span>
              </Button>
            </Tooltip>
            <Tooltip
              title={
                canExecute ? t("workflows.editor.publish") : executionBlockLabel
              }
            >
              <Button
                aria-label={t("workflows.editor.publish")}
                className="!size-9 !min-w-9 !p-0 !text-xs !font-bold lg:!h-[38px] lg:!w-auto lg:!min-w-[84px] lg:!px-[15px]"
                disabled={!canExecute || !canPublish}
                icon={<RocketOutlined aria-hidden="true" />}
                onClick={openPublishCandidate}
                type="primary"
              >
                <span className="hidden lg:inline">
                  {t("workflows.editor.publish")}
                </span>
              </Button>
            </Tooltip>
          </div>
        </header>
      </ConfigProvider>

      <section className="relative min-h-0 overflow-hidden bg-mist">
        <aside className="absolute top-0 bottom-0 left-0 z-50 flex w-[72px] flex-col gap-1 overflow-y-auto bg-[var(--canvas-panel-surface)] px-1.5 py-3 shadow-[1px_0_0_var(--canvas-panel-line)]">
          <RailButton
            active={nodeLibraryOpen}
            icon={<AppstoreAddOutlined aria-hidden="true" />}
            label={t("workflows.editor.nodeLibrary")}
            onClick={toggleNodeLibraryPanel}
          />
          <RailButton
            active={outlineOpen}
            icon={<ClusterOutlined aria-hidden="true" />}
            label={t("workflows.editor.shell.outline")}
            onClick={toggleOutlinePanel}
          />
          <RailButton
            active={presentationOpen}
            icon={<PictureOutlined aria-hidden="true" />}
            label={t("workflows.editor.presentation.title")}
            onClick={togglePresentationPanel}
          />
          <RailButton
            active={bottomPanel === "problems"}
            icon={<ExclamationCircleOutlined aria-hidden="true" />}
            label={t("workflows.editor.shell.bottom.problems")}
            onClick={() => toggleBottom("problems")}
          />
          <RailButton
            active={bottomPanel === "variables"}
            icon={<DatabaseOutlined aria-hidden="true" />}
            label={t("workflows.editor.shell.bottom.variables")}
            onClick={() => toggleBottom("variables")}
          />
          <RailButton
            active={bottomPanel === "runs"}
            icon={<PlayCircleOutlined aria-hidden="true" />}
            label={t("workflows.editor.shell.bottom.runs")}
            onClick={() => toggleBottom("runs")}
          />
        </aside>

        <div className="absolute top-0 right-0 bottom-0 left-[72px]">
          <ReactFlow<WorkflowAuthoringReactFlowNodeV1>
            edges={edges}
            fitView
            maxZoom={1.5}
            minZoom={0.35}
            nodeTypes={nodeTypes}
            nodes={nodes}
            nodesConnectable={canAuthor}
            nodesDraggable
            onEdgesChange={onEdgesChange}
            onInit={(instance) => {
              flowRef.current = instance;
            }}
            isValidConnection={validConnection}
            onConnect={connectNodes}
            onEdgesDelete={(deletedEdges) => {
              const deleted = new Set(deletedEdges.map((edge) => edge.id));
              setGraph((current) => ({
                ...current,
                edges: current.edges.filter((edge) => !deleted.has(edge.id)),
              }));
              setDirty(true);
            }}
            onNodeClick={(_event, node) => setSelectedId(node.id)}
            onNodeDoubleClick={(_event, node) => {
              setSelectedId(node.id);
              setEditingNodeId(node.id);
            }}
            onNodeDragStop={(_event, _node, currentNodes) => {
              const positions = Object.fromEntries(
                currentNodes.map((node) => [node.id, node.position]),
              );
              const viewport = flowRef.current?.getViewport();
              writeWorkflowAuthoringShellLayout(draft.draft.id, {
                schemaVersion: 1,
                positions,
                ...(viewport ? { viewport } : {}),
              });
            }}
            onNodesChange={onNodesChange}
          >
            <Background color="var(--line-strong)" gap={24} size={1} />
          </ReactFlow>
        </div>

        {nodeLibraryOpen ? (
          <WorkspacePanel
            onClose={() => setNodeLibraryOpen(false)}
            title={t("workflows.editor.nodeLibrary")}
          >
            <div className="grid gap-4">
              <Input
                allowClear
                onChange={(event) =>
                  setNodeLibrarySearch(event.currentTarget.value)
                }
                placeholder={t("workflows.editor.searchCapabilities")}
                prefix={<SearchOutlined aria-hidden="true" />}
                value={nodeLibrarySearch}
                variant="filled"
              />
              <section className="grid gap-2">
                <strong className="text-xs text-ink">
                  {nodeLibrarySearch.trim()
                    ? t("workflows.editor.searchResults")
                    : t("workflows.editor.capabilityCategories")}
                </strong>
                <div className="grid gap-2">
                  {nodeLibraryGroups.map((group) => (
                    <details
                      className="overflow-hidden rounded-xl bg-paper"
                      open={Boolean(nodeLibrarySearch.trim())}
                      key={`${nodeLibrarySearch}:${group.key}`}
                    >
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-3 text-xs font-bold text-ink marker:content-none">
                        <span>{group.label}</span>
                        <span className="rounded-full bg-mist px-2 py-0.5 text-[10px] text-muted">
                          {group.capabilities.length}
                        </span>
                      </summary>
                      <div className="grid gap-1 border-t border-[var(--canvas-panel-line)] p-1.5">
                        {group.capabilities.map((capability) => (
                          <button
                            className="grid gap-0.5 rounded-lg border-0 bg-transparent px-2.5 py-2.5 text-left transition-[background-color,transform] hover:bg-mist active:scale-[0.99] disabled:opacity-45"
                            disabled={!canAuthor}
                            key={`${capability.contractId}@${String(capability.revision)}`}
                            onClick={() =>
                              addAuthoringNode("capability", capability)
                            }
                            type="button"
                          >
                            <strong className="text-xs text-ink">
                              {workflowCapabilityText(
                                capability.authoring.catalog.title,
                                i18n.language,
                              )}
                            </strong>
                            <span className="line-clamp-2 text-[11px] leading-4 text-muted">
                              {capability.authoring.catalog.description
                                ? workflowCapabilityText(
                                    capability.authoring.catalog.description,
                                    i18n.language,
                                  )
                                : group.label}
                            </span>
                          </button>
                        ))}
                      </div>
                    </details>
                  ))}
                </div>
                {visibleNodeLibraryCapabilities.length === 0 ? (
                  <Empty
                    description={t("workflows.editor.noCapabilitiesFound")}
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                  />
                ) : null}
              </section>
              {!nodeLibrarySearch.trim() ? (
                <section className="grid gap-2 border-t border-[var(--canvas-panel-line)] pt-3">
                  <strong className="text-xs text-ink">
                    {t("workflows.editor.flowControls")}
                  </strong>
                  {(["condition", "batch", "approval"] as const).map((kind) => (
                    <button
                      className="grid gap-1 rounded-xl border-0 bg-paper px-3 py-3 text-left transition-[background-color,transform] hover:bg-mist active:scale-[0.99] disabled:opacity-45"
                      disabled={!canAuthor}
                      key={kind}
                      onClick={() => addAuthoringNode(kind)}
                      type="button"
                    >
                      <strong className="text-xs text-ink">
                        {t(`workflows.editor.authoringKinds.${kind}`)}
                      </strong>
                      <span className="text-[11px] leading-5 text-muted">
                        {t(`workflows.editor.authoringDescriptions.${kind}`)}
                      </span>
                    </button>
                  ))}
                </section>
              ) : null}
            </div>
          </WorkspacePanel>
        ) : null}

        {outlineOpen ? (
          <WorkspacePanel
            onClose={() => setOutlineOpen(false)}
            title={t("workflows.editor.shell.outline")}
          >
            <div className="grid gap-1">
              {graph.nodes.map((node) => (
                <button
                  className={cn(
                    "grid gap-0.5 rounded-lg border-0 bg-transparent px-3 py-2 text-left hover:bg-mist focus-visible:outline-3 focus-visible:outline-primary",
                    selectedId === node.id && "bg-primary-soft",
                  )}
                  key={node.id}
                  onClick={() => selectNode(node.id)}
                  type="button"
                >
                  <strong className="truncate text-xs text-ink">
                    {nodeTitle(node, t, capabilities, i18n.language)}
                  </strong>
                  <span className="truncate text-[11px] text-muted">
                    {t(nodeKindLabelKey(node))}
                  </span>
                </button>
              ))}
            </div>
          </WorkspacePanel>
        ) : null}

        {presentationOpen ? (
          <WorkspacePanel
            onClose={() => setPresentationOpen(false)}
            title={t("workflows.editor.presentation.title")}
          >
            <div className="grid gap-5">
              <p className="m-0 text-xs leading-5 text-muted">
                {t("workflows.editor.presentation.description")}
              </p>
              <label className="grid gap-2 text-xs font-bold text-ink">
                {t("workflows.editor.presentation.displayTitle")}
                <Input
                  maxLength={240}
                  onChange={(event) => {
                    const title = event.currentTarget.value;
                    setPresentation((current) =>
                      withOptionalPresentationText(current, "title", title),
                    );
                    setDirty(true);
                  }}
                  value={presentation.title ?? ""}
                  variant="filled"
                />
              </label>
              <label className="grid gap-2 text-xs font-bold text-ink">
                {t("workflows.editor.presentation.displayDescription")}
                <Input.TextArea
                  autoSize={{ minRows: 3, maxRows: 6 }}
                  maxLength={1000}
                  onChange={(event) => {
                    const description = event.currentTarget.value;
                    setPresentation((current) =>
                      withOptionalPresentationText(
                        current,
                        "description",
                        description,
                      ),
                    );
                    setDirty(true);
                  }}
                  value={presentation.description ?? ""}
                  variant="filled"
                />
              </label>
              <label className="grid gap-2 text-xs font-bold text-ink">
                {t("workflows.editor.presentation.category")}
                <Input
                  maxLength={120}
                  onChange={(event) => {
                    const category = event.currentTarget.value;
                    setPresentation((current) =>
                      withOptionalPresentationText(
                        current,
                        "category",
                        category,
                      ),
                    );
                    setDirty(true);
                  }}
                  value={presentation.category ?? ""}
                  variant="filled"
                />
              </label>
              <label className="grid gap-2 text-xs font-bold text-ink">
                {t("workflows.editor.presentation.tags")}
                <KanvasSelect
                  maxCount={20}
                  mode="tags"
                  onChange={(tags: string[]) => {
                    setPresentation((current) => ({ ...current, tags }));
                    setDirty(true);
                  }}
                  options={[]}
                  placeholder={t(
                    "workflows.editor.presentation.tagsPlaceholder",
                  )}
                  tokenSeparators={[",", "，"]}
                  value={presentation.tags}
                />
              </label>
              <section className="grid gap-3 border-t border-[var(--canvas-panel-line)] pt-4">
                <strong className="text-xs text-ink">
                  {t("workflows.editor.presentation.cover")}
                </strong>
                <WorkflowTestFileControl
                  csrfToken={csrfToken}
                  field={presentationCoverField}
                  onBusyChange={setPresentationUploadBusy}
                  onChange={(value) => {
                    const artifactId =
                      typeof value === "string" ? value : undefined;
                    setPresentation((current) =>
                      artifactId
                        ? {
                            ...current,
                            cover: {
                              artifactId,
                              alt:
                                current.cover?.alt ??
                                current.title ??
                                displayName,
                            },
                          }
                        : withoutPresentationCover(current),
                    );
                    setDirty(true);
                  }}
                  value={presentation.cover?.artifactId}
                  workspaceId={workspaceId}
                />
                {presentation.cover ? (
                  <label className="grid gap-2 text-xs font-bold text-ink">
                    {t("workflows.editor.presentation.coverAlt")}
                    <Input
                      maxLength={500}
                      onChange={(event) => {
                        const alt = event.currentTarget.value;
                        setPresentation((current) =>
                          current.cover
                            ? {
                                ...current,
                                cover: { ...current.cover, alt },
                              }
                            : current,
                        );
                        setDirty(true);
                      }}
                      value={presentation.cover.alt}
                      variant="filled"
                    />
                  </label>
                ) : null}
              </section>
              <section className="grid gap-3 border-t border-[var(--canvas-panel-line)] pt-4">
                <strong className="text-xs text-ink">
                  {t("workflows.editor.presentation.availability")}
                </strong>
                {(["standalone", "canvas", "directLink"] as const).map(
                  (key) => (
                    <label
                      className="flex min-h-9 items-center justify-between gap-3 text-xs text-ink"
                      key={key}
                    >
                      {t(`workflows.editor.presentation.paths.${key}`)}
                      <Switch
                        checked={presentation.availability[key]}
                        onChange={(checked) => {
                          setPresentation((current) => ({
                            ...current,
                            availability: {
                              ...current.availability,
                              [key]: checked,
                            },
                          }));
                          setDirty(true);
                        }}
                        size="small"
                      />
                    </label>
                  ),
                )}
              </section>
            </div>
          </WorkspacePanel>
        ) : null}

        {selectedNode ? (
          <NodeInspector
            capabilities={capabilities}
            node={selectedNode}
            onClose={() => setSelectedId(undefined)}
            onEdit={() => setEditingNodeId(selectedNode.id)}
          />
        ) : null}

        {bottomPanel ? (
          <BottomWorkspace
            active={bottomPanel}
            issues={issues}
            onClose={() => setBottomPanel(undefined)}
            variables={variables}
          />
        ) : null}

        <div className="pointer-events-auto absolute right-4 bottom-4 z-20 flex items-center gap-1 rounded-lg border border-[var(--canvas-panel-line)] bg-[rgb(251_251_252_/_94%)] p-1 shadow-[0_6px_18px_rgb(15_18_30_/_10%),0_1px_2px_rgb(15_18_30_/_6%)] backdrop-blur-xl">
          <Tooltip title={t("workflows.editor.shell.fitView")}>
            <Button
              aria-label={t("workflows.editor.shell.fitView")}
              icon={<FullscreenOutlined aria-hidden="true" />}
              onClick={() => void flowRef.current?.fitView({ duration: 220 })}
              size="small"
              type="text"
            />
          </Tooltip>
          <Tooltip title={t("workflows.editor.shell.zoomOut")}>
            <Button
              aria-label={t("workflows.editor.shell.zoomOut")}
              icon={<ZoomOutOutlined aria-hidden="true" />}
              onClick={() => void flowRef.current?.zoomOut({ duration: 160 })}
              size="small"
              type="text"
            />
          </Tooltip>
          <Tooltip title={t("workflows.editor.shell.zoomIn")}>
            <Button
              aria-label={t("workflows.editor.shell.zoomIn")}
              icon={<ZoomInOutlined aria-hidden="true" />}
              onClick={() => void flowRef.current?.zoomIn({ duration: 160 })}
              size="small"
              type="text"
            />
          </Tooltip>
        </div>
      </section>

      {editingNode ? (
        <WorkflowAuthoringNodeEditorV1
          capabilities={capabilities}
          key={editingNode.id}
          node={editingNode}
          onApply={updateAuthoringNode}
          onClose={() => setEditingNodeId(undefined)}
          open
          variables={editorVariables}
        />
      ) : null}

      <Drawer
        onClose={() => setCandidateOpen(false)}
        open={candidateOpen}
        placement="bottom"
        size="min(72dvh, 720px)"
        title={t("workflows.candidate.title")}
      >
        <Suspense fallback={<Skeleton active paragraph={{ rows: 7 }} />}>
          <WorkflowCandidatePanel
            activeSection={candidateSection}
            canAuthor={canAuthor}
            canPublish={canPublish}
            canRun={canRun}
            capabilities={capabilities}
            csrfToken={csrfToken}
            draft={serverDraft}
            graph={graph}
            hasUnsavedChanges={dirty || saveMutation.isPending}
            onRunActivityChange={setCandidateRunActive}
            onSectionChange={setCandidateSection}
            workspaceId={workspaceId}
          />
        </Suspense>
      </Drawer>
    </main>
  );
}
