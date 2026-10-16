import type {
  AgentActionReceiptRecord,
  AgentContextSnapshotV1,
  TrustedWorkspaceScope,
} from "@kanvas/application";
import {
  stableAgentRuntimeId,
  type CanvasAddResultImageToolInput,
  type CanvasCommandToolExecution,
  type CanvasCommandToolExecutors,
  type CanvasCreateToolInput,
  type CanvasEditTextToolInput,
  type CanvasInspectToolInput,
  type CanvasTextEditOperation,
} from "@kanvas/agent-runtime";
import type {
  EditorDraftContentV1,
  EditorImageNodeV1,
  EditorNodeV1,
  EditorTextNodeV1,
} from "@kanvas/contracts/editor";
import {
  CanvasDraftStoreError,
  digestProviderValue,
  type CanvasDraftRecord,
  type CanvasDraftStore,
} from "@kanvas/database/runtime";

import {
  AgentThreadResultError,
  type AgentThreadResultArtifact,
} from "./thread-agent-query-executor.js";

const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const nodeKeyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;

export class AgentCanvasCommandError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AgentCanvasCommandError";
  }
}

function fail(code: string, message: string): never {
  throw new AgentCanvasCommandError(code, message);
}

function mapStoreError(error: unknown): never {
  if (!(error instanceof CanvasDraftStoreError)) throw error;
  if (error.code === "canvas_draft.concurrent_change") {
    return fail("agent.canvas_changed", "The Canvas changed before this edit.");
  }
  if (error.code === "canvas_draft.forbidden") {
    return fail("agent.canvas_forbidden", "The Canvas cannot be changed.");
  }
  if (error.code === "canvas_draft.not_found") {
    return fail("agent.canvas_unavailable", "The Canvas is unavailable.");
  }
  if (error.code === "canvas_draft.invalid_argument") {
    return fail("agent.canvas_input_invalid", "The Canvas input is invalid.");
  }
  if (error.code === "canvas_draft.idempotency_conflict") {
    return fail(
      "agent.canvas_request_conflict",
      "The Canvas request conflicts with an earlier action.",
    );
  }
  return fail(
    "agent.canvas_command_failed",
    "The Canvas command was rejected.",
  );
}

function boundedText(value: unknown, maximum: number, label: string): string {
  if (typeof value !== "string")
    return fail("agent.canvas_input_invalid", `${label} is invalid.`);
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length > 0 && normalized.length <= maximum
    ? normalized
    : fail("agent.canvas_input_invalid", `${label} is invalid.`);
}

function dimension(value: unknown, label: string): number {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 64 &&
    value <= 32_768
    ? value
    : fail("agent.canvas_input_invalid", `${label} is invalid.`);
}

function currentCanvasId(context: AgentContextSnapshotV1): string | undefined {
  return context.resource?.kind === "canvas_draft"
    ? context.resource.resourceId
    : undefined;
}

type CanvasDraftSnapshot = Pick<CanvasDraftRecord, "document" | "version">;

function documentContent(draft: CanvasDraftSnapshot): EditorDraftContentV1 {
  if (draft.document.schemaVersion !== "kanvas.editor-document/v1") {
    return fail(
      "agent.canvas_version_unsupported",
      "This Canvas must be opened and saved before Agent editing.",
    );
  }
  return {
    schemaVersion: draft.document.schemaVersion,
    title: draft.document.title,
    pages: draft.document.pages,
    metadata: draft.document.metadata,
  };
}

function finiteNumber(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function canvasEditOperations(
  value: unknown,
): readonly CanvasTextEditOperation[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
    return fail("agent.canvas_input_invalid", "Canvas edit is invalid.");
  }
  const valid = value.every((candidate: unknown) => {
    if (
      !candidate ||
      typeof candidate !== "object" ||
      Array.isArray(candidate)
    ) {
      return false;
    }
    const operation = candidate as Readonly<Record<string, unknown>>;
    const fontSize =
      operation.fontSize === undefined ||
      finiteNumber(operation.fontSize, 1, 2_048);
    const color =
      operation.color === undefined ||
      (typeof operation.color === "string" &&
        operation.color.length > 0 &&
        operation.color.length <= 120);
    if (!fontSize || !color) return false;
    if (operation.type === "add_text") {
      return (
        typeof operation.text === "string" &&
        operation.text.trim().length > 0 &&
        operation.text.length <= 20_000 &&
        finiteNumber(operation.x, -10_000_000, 10_000_000) &&
        finiteNumber(operation.y, -10_000_000, 10_000_000) &&
        finiteNumber(operation.width, Number.MIN_VALUE, 32_768) &&
        finiteNumber(operation.height, Number.MIN_VALUE, 32_768)
      );
    }
    return (
      operation.type === "update_text" &&
      typeof operation.elementKey === "string" &&
      operation.elementKey.length > 0 &&
      operation.elementKey.length <= 160 &&
      (operation.text === undefined ||
        (typeof operation.text === "string" &&
          operation.text.trim().length > 0 &&
          operation.text.length <= 20_000)) &&
      (operation.text !== undefined ||
        operation.fontSize !== undefined ||
        operation.color !== undefined)
    );
  });
  return valid
    ? (value as CanvasTextEditOperation[])
    : fail("agent.canvas_input_invalid", "Canvas edit is invalid.");
}

function textValue(node: EditorTextNodeV1): string {
  return node.content.paragraphs
    .map((paragraph) => paragraph.runs.map((run) => run.text).join(""))
    .join("\n")
    .slice(0, 2_000);
}

function collectTextNodes(
  nodes: readonly EditorNodeV1[],
  output: EditorTextNodeV1[],
): void {
  for (const node of nodes) {
    if (output.length >= 200) return;
    if (node.kind === "text") output.push(node);
    if (node.kind === "group") collectTextNodes(node.children, output);
  }
}

function collectImageNodes(
  nodes: readonly EditorNodeV1[],
  output: EditorImageNodeV1[],
): void {
  for (const node of nodes) {
    if (output.length >= 200) return;
    if (node.kind === "image") output.push(node);
    if (node.kind === "group") collectImageNodes(node.children, output);
  }
}

function canvasSummary(draft: CanvasDraftSnapshot) {
  const content = documentContent(draft);
  return Object.freeze({
    title: content.title,
    version: draft.version,
    pages: Object.freeze(
      content.pages.map((page) => {
        const textNodes: EditorTextNodeV1[] = [];
        const imageNodes: EditorImageNodeV1[] = [];
        collectTextNodes(page.nodes, textNodes);
        collectImageNodes(page.nodes, imageNodes);
        return Object.freeze({
          pageKey: page.id,
          name: page.name,
          width: page.width,
          height: page.height,
          textElements: Object.freeze(
            textNodes.map((node) => {
              const run = node.content.paragraphs[0]?.runs[0];
              return Object.freeze({
                elementKey: node.id,
                name: node.name,
                text: textValue(node),
                locked: node.locked,
                ...(run ? { fontSize: run.fontSize } : {}),
                ...(run?.fill.kind === "solid"
                  ? { color: run.fill.color }
                  : {}),
              });
            }),
          ),
          imageElements: Object.freeze(
            imageNodes.map((node) =>
              Object.freeze({
                elementKey: node.id,
                name: node.name,
                artifactId: node.image.source.artifactId,
                width: node.transform.width,
                height: node.transform.height,
              }),
            ),
          ),
        });
      }),
    ),
  });
}

function updateTextNode(
  nodes: readonly EditorNodeV1[],
  elementKey: string,
  update: (node: EditorTextNodeV1) => EditorTextNodeV1,
): { readonly nodes: readonly EditorNodeV1[]; readonly matched: boolean } {
  let matched = false;
  const next = nodes.map((node): EditorNodeV1 => {
    if (node.kind === "text" && node.id === elementKey) {
      matched = true;
      if (node.locked) {
        return fail(
          "agent.canvas_target_locked",
          "The selected text is locked.",
        );
      }
      return update(node);
    }
    if (node.kind !== "group") return node;
    const child = updateTextNode(node.children, elementKey, update);
    matched ||= child.matched;
    return child.matched ? { ...node, children: [...child.nodes] } : node;
  });
  return { nodes: next, matched };
}

function paragraphsWithText(
  templates: EditorTextNodeV1["content"]["paragraphs"],
  text: string,
): EditorTextNodeV1["content"]["paragraphs"] {
  const lines = text.replaceAll(/\r\n?/gu, "\n").split("\n");
  if (lines.length > 2_000) {
    return fail(
      "agent.canvas_input_invalid",
      "Text content has too many paragraphs.",
    );
  }
  const firstParagraph = templates[0]!;
  const firstRun = firstParagraph.runs[0]!;
  return lines.map((line, index) => {
    const paragraph = templates[index] ?? firstParagraph;
    return {
      ...paragraph,
      runs: [{ ...(paragraph.runs[0] ?? firstRun), text: line }],
    };
  });
}

function changedTextNode(
  node: EditorTextNodeV1,
  operation: Extract<
    CanvasEditTextToolInput["operations"][number],
    { readonly type: "update_text" }
  >,
): EditorTextNodeV1 {
  const hasChange =
    operation.text !== undefined ||
    operation.fontSize !== undefined ||
    operation.color !== undefined;
  if (!hasChange) {
    return fail("agent.canvas_input_invalid", "Text edit is empty.");
  }
  const paragraphs = node.content.paragraphs.map((paragraph) => ({
    ...paragraph,
    runs: paragraph.runs.map((run) => ({
      ...run,
      ...(operation.fontSize !== undefined
        ? { fontSize: operation.fontSize }
        : {}),
      ...(operation.color !== undefined
        ? { fill: { kind: "solid" as const, color: operation.color } }
        : {}),
    })),
  }));
  if (operation.text !== undefined) {
    return {
      ...node,
      content: {
        ...node.content,
        paragraphs: paragraphsWithText(paragraphs, operation.text),
      },
    };
  }
  return {
    ...node,
    content: { ...node.content, paragraphs },
  };
}

function newTextNode(
  elementKey: string,
  operation: Extract<
    CanvasEditTextToolInput["operations"][number],
    { readonly type: "add_text" }
  >,
): EditorTextNodeV1 {
  const paragraph: EditorTextNodeV1["content"]["paragraphs"][number] = {
    align: "left",
    direction: "auto",
    lineHeight: 1.2,
    spaceBefore: 0,
    spaceAfter: 0,
    runs: [
      {
        text: "",
        font: {
          source: "builtin",
          fontId: "noto-sans-sc",
          family: "Noto Sans SC",
        },
        fontSize: operation.fontSize ?? 48,
        fontWeight: 700,
        fontStyle: "normal",
        letterSpacing: 0,
        fill: {
          kind: "solid",
          color: operation.color ?? "#151515",
        },
        decoration: { underline: false, strikeThrough: false },
      },
    ],
  };
  return {
    id: elementKey,
    name: operation.text.slice(0, 80),
    kind: "text",
    transform: {
      x: operation.x,
      y: operation.y,
      width: operation.width,
      height: operation.height,
      rotation: 0,
      flipX: false,
      flipY: false,
    },
    opacity: 1,
    blendMode: "normal",
    visible: true,
    locked: false,
    content: {
      paragraphs: paragraphsWithText([paragraph], operation.text),
      verticalAlign: "top",
      resizeMode: "fixed",
    },
    effects: [],
  };
}

function resultImageInput(input: CanvasAddResultImageToolInput): {
  readonly expectedVersion: number;
  readonly pageKey: string;
  readonly workflowRunId?: string;
  readonly capabilityRunId?: string;
  readonly brandLogoKey?: string;
  readonly skillRevisionId?: string;
  readonly skillResourcePath?: string;
  readonly libraryId?: string;
  readonly libraryEntryId?: string;
  readonly artifactId: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly fit: "contain" | "cover" | "fill";
  readonly altText?: string;
} {
  const skillSourceFieldCount = [
    input.skillRevisionId,
    input.skillResourcePath,
  ].filter((value) => value !== undefined).length;
  const librarySourceFieldCount = [
    input.libraryId,
    input.libraryEntryId,
  ].filter((value) => value !== undefined).length;
  const sourceCount = [
    input.workflowRunId,
    input.capabilityRunId,
    input.brandLogoKey,
    skillSourceFieldCount > 0 ? "skill" : undefined,
    librarySourceFieldCount > 0 ? "library" : undefined,
  ].filter((value) => value !== undefined).length;
  const validFit =
    input.fit === undefined ||
    input.fit === "contain" ||
    input.fit === "cover" ||
    input.fit === "fill";
  const validAltText =
    input.altText === undefined ||
    (typeof input.altText === "string" &&
      input.altText.trim().length > 0 &&
      input.altText.length <= 2_000);
  if (
    !Number.isSafeInteger(input.expectedVersion) ||
    input.expectedVersion < 1 ||
    typeof input.pageKey !== "string" ||
    input.pageKey.length < 1 ||
    input.pageKey.length > 160 ||
    !nodeKeyPattern.test(input.pageKey) ||
    sourceCount !== 1 ||
    (librarySourceFieldCount !== 0 && librarySourceFieldCount !== 2) ||
    (input.libraryId !== undefined && !idPattern.test(input.libraryId)) ||
    (input.libraryEntryId !== undefined &&
      !idPattern.test(input.libraryEntryId)) ||
    (skillSourceFieldCount !== 0 && skillSourceFieldCount !== 2) ||
    (input.workflowRunId !== undefined &&
      !idPattern.test(input.workflowRunId)) ||
    (input.capabilityRunId !== undefined &&
      !idPattern.test(input.capabilityRunId)) ||
    (input.brandLogoKey !== undefined &&
      (typeof input.brandLogoKey !== "string" ||
        !input.brandLogoKey.trim() ||
        input.brandLogoKey.length > 160)) ||
    (input.skillRevisionId !== undefined &&
      !idPattern.test(input.skillRevisionId)) ||
    (input.skillResourcePath !== undefined &&
      (typeof input.skillResourcePath !== "string" ||
        input.skillResourcePath.length < 1 ||
        input.skillResourcePath.length > 512)) ||
    !idPattern.test(input.artifactId) ||
    !finiteNumber(input.x, -10_000_000, 10_000_000) ||
    !finiteNumber(input.y, -10_000_000, 10_000_000) ||
    !finiteNumber(input.width, Number.MIN_VALUE, 32_768) ||
    !finiteNumber(input.height, Number.MIN_VALUE, 32_768) ||
    !validFit ||
    !validAltText
  ) {
    return fail("agent.canvas_input_invalid", "Result placement is invalid.");
  }
  return Object.freeze({
    expectedVersion: input.expectedVersion,
    pageKey: input.pageKey,
    ...(input.workflowRunId ? { workflowRunId: input.workflowRunId } : {}),
    ...(input.capabilityRunId
      ? { capabilityRunId: input.capabilityRunId }
      : {}),
    ...(input.brandLogoKey ? { brandLogoKey: input.brandLogoKey } : {}),
    ...(input.skillRevisionId
      ? { skillRevisionId: input.skillRevisionId }
      : {}),
    ...(input.skillResourcePath
      ? { skillResourcePath: input.skillResourcePath }
      : {}),
    ...(input.libraryId
      ? { libraryId: input.libraryId, libraryEntryId: input.libraryEntryId! }
      : {}),
    artifactId: input.artifactId,
    x: input.x,
    y: input.y,
    width: input.width,
    height: input.height,
    fit: input.fit ?? "contain",
    ...(input.altText ? { altText: input.altText.trim() } : {}),
  });
}

function newResultImageNode(
  elementKey: string,
  artifact: AgentThreadResultArtifact,
  placement: ReturnType<typeof resultImageInput>,
): EditorImageNodeV1 {
  const name = artifact.displayFilename?.trim().slice(0, 240) || "制作结果";
  return {
    id: elementKey,
    name,
    kind: "image",
    transform: {
      x: placement.x,
      y: placement.y,
      width: placement.width,
      height: placement.height,
      rotation: 0,
      flipX: false,
      flipY: false,
    },
    opacity: 1,
    blendMode: "normal",
    visible: true,
    locked: false,
    image: {
      source: { kind: "artifact", artifactId: artifact.id },
      mediaType: artifact.mediaType,
      crop: { x: 0, y: 0, width: 1, height: 1 },
      fit: placement.fit,
      focalPoint: { x: 0.5, y: 0.5 },
    },
    cornerRadius: 0,
    ...(placement.altText ? { altText: placement.altText } : {}),
  };
}

function reasonCode(error: unknown): string {
  if (error instanceof AgentCanvasCommandError) return error.code;
  const message =
    error && typeof error === "object" && "sqlMessage" in error
      ? String(error.sqlMessage)
      : "";
  const constraint = /constraint '([a-z0-9_]+)'/iu.exec(message)?.[1];
  if (constraint && constraint.length <= 80) {
    return `agent.canvas_constraint_${constraint.toLowerCase()}`;
  }
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
          .toLowerCase()
          .replace(/[^a-z0-9_-]/gu, "_")
      : "";
  return code.length > 0 && code.length <= 80
    ? `agent.canvas_${code}`
    : "agent.canvas_command_failed";
}

export function createAgentCanvasCommandExecutors(options: {
  readonly authority: TrustedWorkspaceScope;
  readonly context: AgentContextSnapshotV1;
  readonly canvasDrafts: CanvasDraftStore;
  readonly exportCanvas?: (
    input: {
      readonly canvasDraftId: string;
      readonly documentVersion: number;
      readonly pageId: string;
    },
    action: AgentActionReceiptRecord,
  ) => Promise<CanvasCommandToolExecution>;
  readonly nextId: () => string;
  readonly now: () => Date;
  readonly resolveResultArtifact: (input: {
    readonly workflowRunId?: string;
    readonly capabilityRunId?: string;
    readonly brandLogoKey?: string;
    readonly skillRevisionId?: string;
    readonly skillResourcePath?: string;
    readonly libraryId?: string;
    readonly libraryEntryId?: string;
    readonly artifactId: string;
  }) => Promise<AgentThreadResultArtifact>;
  readonly executeWithReceipt: (
    toolKey: string,
    input: unknown,
    operation: (
      action: AgentActionReceiptRecord,
    ) => Promise<CanvasCommandToolExecution>,
    failureReason: (error: unknown) => string,
  ) => Promise<CanvasCommandToolExecution>;
}): CanvasCommandToolExecutors {
  let canvasDraftId = currentCanvasId(options.context);
  const selectedElementKeys = new Set(
    options.context.selectedElementKeys ?? [],
  );
  const audit = (actionReceiptId: string) => ({
    auditEventId: stableAgentRuntimeId(
      "canvas-command-audit",
      actionReceiptId,
      1,
    ),
    authenticationRefHash: digestProviderValue({
      source: "agent-canvas-command",
      authenticationRefId: options.authority.authenticationRefId,
    }),
    requestId: actionReceiptId,
  });
  const recover = async (
    actionReceiptId: string,
    expectedKind: "create" | "update",
  ): Promise<CanvasCommandToolExecution | undefined> => {
    try {
      const recovered = await options.canvasDrafts.recoverMutation(
        options.authority,
        stableAgentRuntimeId("canvas-command-audit", actionReceiptId, 1),
      );
      if (!recovered) return undefined;
      if (recovered.kind !== expectedKind) {
        return fail(
          "agent.canvas_request_conflict",
          "The Canvas action identity conflicts with an earlier command.",
        );
      }
      canvasDraftId = recovered.revision.canvasDraftId;
      return {
        modelOutput: canvasSummary({
          document: recovered.revision.document,
          version: recovered.afterVersion,
        }),
        outcomeReference: {
          kind: "canvas_command",
          canvasDraftId,
          beforeVersion: recovered.beforeVersion,
          afterVersion: recovered.afterVersion,
        },
      };
    } catch (error) {
      return mapStoreError(error);
    }
  };
  const currentDraft = async (): Promise<CanvasDraftRecord> => {
    if (!canvasDraftId) {
      return fail(
        "agent.canvas_context_required",
        "No Canvas is attached to this work yet.",
      );
    }
    try {
      return (
        (await options.canvasDrafts.get(options.authority, canvasDraftId)) ??
        fail("agent.canvas_unavailable", "The Canvas is unavailable.")
      );
    } catch (error) {
      return mapStoreError(error);
    }
  };

  return Object.freeze({
    ...(options.exportCanvas
      ? {
          exportPng: (input: { expectedVersion: number; pageKey: string }) =>
            options.executeWithReceipt(
              "canvas.export-png",
              input,
              async (action) => {
                const draft = await currentDraft();
                if (draft.version !== input.expectedVersion)
                  return fail(
                    "agent.canvas_changed",
                    "The Canvas changed before export.",
                  );
                if (
                  !draft.document.pages.some(
                    (page) => page.id === input.pageKey,
                  )
                )
                  return fail(
                    "agent.canvas_input_invalid",
                    "The requested page is unavailable.",
                  );
                return options.exportCanvas!(
                  {
                    canvasDraftId: draft.id,
                    documentVersion: draft.version,
                    pageId: input.pageKey,
                  },
                  action,
                );
              },
              reasonCode,
            ),
        }
      : {}),
    create: (input: CanvasCreateToolInput) =>
      options.executeWithReceipt(
        "canvas.create",
        input,
        async (action) => {
          const replay = await recover(action.id, "create");
          if (replay) return replay;
          const title = boundedText(input.title, 240, "Canvas title");
          const width = dimension(input.width, "Canvas width");
          const height = dimension(input.height, "Canvas height");
          const draftId = stableAgentRuntimeId("canvas-draft", action.id, 1);
          try {
            const result = await options.canvasDrafts.create({
              authority: options.authority,
              canvasDraftId: draftId,
              idempotencyKey: `agent-canvas:${action.id}`,
              document: {
                schemaVersion: "kanvas.editor-document/v1",
                title,
                pages: [
                  {
                    id: "page-1",
                    name: "页面 1",
                    width,
                    height,
                    background: {
                      kind: "paint",
                      paint: { kind: "solid", color: "#ffffff" },
                    },
                    nodes: [],
                  },
                ],
                metadata: { createdWith: "kanvas-agent" },
              },
              ...(options.context.brandKitRevisionId
                ? { brandKitRevisionId: options.context.brandKitRevisionId }
                : {}),
              now: options.now(),
              audit: audit(action.id),
            });
            canvasDraftId = result.draft.id;
            return {
              modelOutput: canvasSummary(result.draft),
              outcomeReference: {
                kind: "canvas_command",
                canvasDraftId: result.draft.id,
                beforeVersion: 0,
                afterVersion: result.draft.version,
              },
            };
          } catch (error) {
            return mapStoreError(error);
          }
        },
        reasonCode,
      ),
    inspect: (input: CanvasInspectToolInput) =>
      options.executeWithReceipt(
        "canvas.inspect",
        input,
        async () => {
          const draft = await currentDraft();
          return {
            modelOutput: canvasSummary(draft),
            outcomeReference: {
              kind: "query",
              resultCount: draft.document.pages.length,
            },
          };
        },
        reasonCode,
      ),
    addResultImage: (input: CanvasAddResultImageToolInput) =>
      options.executeWithReceipt(
        "canvas.add-result-image",
        input,
        async (action) => {
          const replay = await recover(action.id, "update");
          if (replay) return replay;
          if (selectedElementKeys.size > 0) {
            return fail(
              "agent.canvas_selection_mismatch",
              "A fixed Canvas selection cannot receive a new image.",
            );
          }
          const placement = resultImageInput(input);
          let artifact: AgentThreadResultArtifact;
          try {
            artifact = await options.resolveResultArtifact({
              ...(placement.workflowRunId
                ? { workflowRunId: placement.workflowRunId }
                : {}),
              ...(placement.capabilityRunId
                ? { capabilityRunId: placement.capabilityRunId }
                : {}),
              ...(placement.brandLogoKey
                ? { brandLogoKey: placement.brandLogoKey }
                : {}),
              ...(placement.skillRevisionId
                ? { skillRevisionId: placement.skillRevisionId }
                : {}),
              ...(placement.skillResourcePath
                ? { skillResourcePath: placement.skillResourcePath }
                : {}),
              ...(placement.libraryId
                ? {
                    libraryId: placement.libraryId,
                    libraryEntryId: placement.libraryEntryId!,
                  }
                : {}),
              artifactId: placement.artifactId,
            });
          } catch (error) {
            if (!(error instanceof AgentThreadResultError)) throw error;
            if (error.code === "agent.result_not_image") {
              return fail(
                "agent.canvas_result_not_image",
                "The selected result is not an image.",
              );
            }
            return fail(
              "agent.canvas_result_unavailable",
              "The selected image result is unavailable.",
            );
          }
          const current = await currentDraft();
          if (current.version !== placement.expectedVersion) {
            return fail(
              "agent.canvas_changed",
              "The Canvas changed before this edit.",
            );
          }
          const content = documentContent(current);
          const pageIndex = content.pages.findIndex(
            (page) => page.id === placement.pageKey,
          );
          if (pageIndex < 0) {
            return fail(
              "agent.canvas_page_unavailable",
              "The Canvas page changed.",
            );
          }
          const page = content.pages[pageIndex]!;
          if (page.nodes.length >= 5_000) {
            return fail(
              "agent.canvas_page_full",
              "The Canvas page cannot receive more content.",
            );
          }
          if (!canvasDraftId) {
            return fail(
              "agent.canvas_context_required",
              "No Canvas is attached to this work yet.",
            );
          }
          const pages = [...content.pages];
          pages[pageIndex] = {
            ...page,
            nodes: [
              ...page.nodes,
              newResultImageNode(
                stableAgentRuntimeId("canvas-result-node", action.id, 1),
                artifact,
                placement,
              ),
            ],
          };
          try {
            const result = await options.canvasDrafts.update({
              authority: options.authority,
              canvasDraftId,
              expectedVersion: current.version,
              document: { ...content, pages },
              now: options.now(),
              audit: audit(action.id),
              ...(placement.libraryId
                ? {
                    libraryInput: {
                      actionReceiptId: action.id,
                      artifactId: placement.artifactId,
                      libraryId: placement.libraryId,
                      entryId: placement.libraryEntryId!,
                    },
                  }
                : {}),
            });
            return {
              modelOutput: canvasSummary(result.draft),
              outcomeReference: {
                kind: "canvas_command",
                canvasDraftId,
                beforeVersion: current.version,
                afterVersion: result.draft.version,
              },
            };
          } catch (error) {
            return mapStoreError(error);
          }
        },
        reasonCode,
      ),
    editText: (input: CanvasEditTextToolInput) =>
      options.executeWithReceipt(
        "canvas.edit-text",
        input,
        async (action) => {
          const replay = await recover(action.id, "update");
          if (replay) return replay;
          if (
            !Number.isSafeInteger(input.expectedVersion) ||
            input.expectedVersion < 1 ||
            input.operations.length < 1 ||
            input.operations.length > 20
          ) {
            return fail(
              "agent.canvas_input_invalid",
              "Canvas edit is invalid.",
            );
          }
          const pageKey = boundedText(input.pageKey, 160, "Canvas page");
          const current = await currentDraft();
          if (current.version !== input.expectedVersion) {
            return fail(
              "agent.canvas_changed",
              "The Canvas changed before this edit.",
            );
          }
          const content = documentContent(current);
          const pageIndex = content.pages.findIndex(
            (page) => page.id === pageKey,
          );
          if (pageIndex < 0) {
            return fail(
              "agent.canvas_page_unavailable",
              "The Canvas page changed.",
            );
          }
          const pages = [...content.pages];
          let nodes: readonly EditorNodeV1[] = pages[pageIndex]!.nodes;
          for (const operation of canvasEditOperations(input.operations)) {
            if (operation.type === "add_text") {
              if (selectedElementKeys.size > 0) {
                return fail(
                  "agent.canvas_selection_mismatch",
                  "A fixed Canvas selection cannot be used to add new text.",
                );
              }
              boundedText(operation.text, 20_000, "Text content");
              nodes = [...nodes, newTextNode(options.nextId(), operation)];
              continue;
            }
            const elementKey = boundedText(
              operation.elementKey,
              160,
              "Text element",
            );
            if (
              selectedElementKeys.size > 0 &&
              !selectedElementKeys.has(elementKey)
            ) {
              return fail(
                "agent.canvas_selection_mismatch",
                "The requested text is outside the fixed Canvas selection.",
              );
            }
            const changed = updateTextNode(nodes, elementKey, (node) =>
              changedTextNode(node, operation),
            );
            if (!changed.matched) {
              return fail(
                "agent.canvas_target_unavailable",
                "The requested text is no longer available.",
              );
            }
            nodes = changed.nodes;
          }
          pages[pageIndex] = { ...pages[pageIndex]!, nodes: [...nodes] };
          if (!canvasDraftId) {
            return fail(
              "agent.canvas_context_required",
              "No Canvas is attached to this work yet.",
            );
          }
          try {
            const result = await options.canvasDrafts.update({
              authority: options.authority,
              canvasDraftId,
              expectedVersion: current.version,
              document: { ...content, pages },
              now: options.now(),
              audit: audit(action.id),
            });
            return {
              modelOutput: canvasSummary(result.draft),
              outcomeReference: {
                kind: "canvas_command",
                canvasDraftId,
                beforeVersion: current.version,
                afterVersion: result.draft.version,
              },
            };
          } catch (error) {
            return mapStoreError(error);
          }
        },
        reasonCode,
      ),
  });
}
