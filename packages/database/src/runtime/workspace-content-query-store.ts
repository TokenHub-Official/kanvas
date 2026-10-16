import type {
  TrustedWorkspaceScope,
  WorkspacePermissionId,
} from "@kanvas/application";
import { unavailableEffectiveInvocationSchema } from "@kanvas/application";
import type {
  BrandKitLogo,
  CanvasBrandContext,
  EffectiveInvocationSchema,
  WorkflowCapabilityAuthoringDeclaration,
} from "@kanvas/contracts/api";
import {
  resolveLocalizedTextV1,
  type LocalizedTextV1,
} from "@kanvas/contracts/capability";
import { isWorkflowTopology } from "@kanvas/contracts/workflow";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

import type { EffectiveInvocationSchemaProjector } from "./effective-invocation-schema-store.js";

export interface WorkspaceAssetSummary {
  readonly id: string;
  readonly assetKey: string;
  readonly name: string;
  readonly assetType: string;
  readonly lifecycleStatus: "active" | "archived";
  readonly currentArtifact?: {
    readonly id: string;
    readonly artifactType: string;
    readonly displayFilename?: string;
    readonly mediaType?: string;
    readonly byteSize?: string;
    readonly availabilityStatus: string;
    readonly dataClassification: string;
    readonly brand?: CanvasBrandContext;
    readonly createdAt: Date;
  };
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface WorkspaceAssetList {
  readonly items: readonly WorkspaceAssetSummary[];
  readonly truncated: boolean;
  readonly facets?: {
    readonly assetTypes: readonly string[];
  };
  readonly nextCursor?: {
    readonly updatedAt: Date;
    readonly id: string;
  };
}

export interface WorkspaceAssetQuery {
  readonly search?: string;
  readonly mediaKind?: "image" | "video" | "audio" | "document";
  readonly assetType?: string;
  readonly ids?: readonly string[];
  readonly lifecycleStatus?: "active" | "archived";
  readonly cursor?: {
    readonly updatedAt: Date;
    readonly id: string;
  };
  readonly limit?: number;
}

export type WorkspaceAssetArtifactOrigin =
  | {
      readonly kind: "canvas_export";
      readonly canvasDraftId: string;
      readonly documentVersion: number;
      readonly pageId: string;
      readonly format: "jpeg" | "png" | "webp";
      readonly width: number;
      readonly height: number;
      readonly transparentBackground: boolean;
      readonly sourceArtifactCount: number;
    }
  | {
      readonly kind: "capability_result";
      readonly capabilityRunId: string;
    }
  | { readonly kind: "user_import" }
  | { readonly kind: "unknown" };

export interface WorkspaceAssetArtifactDetail {
  readonly id: string;
  readonly artifactType: string;
  readonly displayFilename?: string;
  readonly mediaType?: string;
  readonly byteSize?: string;
  readonly availabilityStatus: string;
  readonly dataClassification: string;
  readonly isCurrent: boolean;
  readonly brand?: CanvasBrandContext;
  readonly origin: WorkspaceAssetArtifactOrigin;
  readonly createdAt: Date;
}

export interface WorkspaceAssetLineageItem {
  readonly direction: "input" | "output";
  readonly relation:
    "derived_from" | "supersedes" | "composed_from" | "generated_from";
  readonly artifact: {
    readonly id: string;
    readonly artifactType: string;
    readonly displayFilename?: string;
    readonly mediaType?: string;
    readonly createdAt: Date;
  };
}

export interface WorkspaceAssetDetail {
  readonly id: string;
  readonly name: string;
  readonly assetType: string;
  readonly lifecycleStatus: "active" | "archived";
  readonly version: number;
  readonly currentArtifact?: WorkspaceAssetArtifactDetail;
  readonly artifacts: readonly WorkspaceAssetArtifactDetail[];
  readonly artifactsTruncated: boolean;
  readonly artifactsNextCursor?: WorkspaceAssetDetailCursor;
  readonly lineage: readonly WorkspaceAssetLineageItem[];
  readonly lineageTruncated: boolean;
  readonly lineageNextCursor?: WorkspaceAssetDetailCursor;
  readonly usedByBrands: readonly {
    readonly brandKitId: string;
    readonly name: string;
    readonly isDefault: boolean;
    readonly logoRole: BrandKitLogo["role"];
  }[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface WorkspaceAssetDetailCursor {
  readonly occurredAt: Date;
  readonly id: string;
  readonly currentRank?: 0 | 1;
}

export interface WorkspaceAssetDetailQuery {
  readonly artifactId?: string;
  readonly historyKind?: "artifacts" | "lineage";
  readonly cursor?: WorkspaceAssetDetailCursor;
  readonly limit?: number;
}

export type CreationEntrypointOutputPresentation =
  "board" | "single_review" | "batch_review" | "assets";

export interface WorkspaceCreationEntrypointSummary {
  readonly skillRevisionId: string;
  readonly skillKey: string;
  readonly skillRevision: number;
  readonly entrypointKey: string;
  readonly workflowRevisionId: string;
  readonly workflowRevision: number;
  readonly displayName: string;
  readonly description?: string;
  readonly category?: string;
  readonly nonProduction: boolean;
  readonly outputPresentation: CreationEntrypointOutputPresentation;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema: Readonly<Record<string, unknown>>;
  readonly effectiveInvocationSchema: EffectiveInvocationSchema;
  readonly inputUiSchema?: Readonly<Record<string, unknown>>;
  readonly capability?: {
    readonly contractKey: string;
    readonly revision: number;
    readonly canonicalDigest: string;
    readonly surfaces: readonly ("workflow" | "agent" | "canvas")[];
    readonly parameters: readonly {
      readonly key: string;
      readonly semanticType: string;
    }[];
    readonly outputs: readonly {
      readonly key: string;
      readonly semanticType: string;
      readonly primary: boolean;
    }[];
  };
}

export interface WorkspaceCreationEntrypointList {
  readonly items: readonly WorkspaceCreationEntrypointSummary[];
  readonly truncated: boolean;
}

export interface WorkspaceWorkflowRunArtifact {
  readonly id: string;
  readonly assetId?: string;
  readonly artifactType: string;
  readonly displayFilename?: string;
  readonly mediaType?: string;
  readonly availabilityStatus: string;
  readonly createdAt: Date;
}

export interface WorkspaceAgentAttachmentArtifact {
  readonly id: string;
  readonly assetId?: string;
  readonly artifactType: string;
  readonly displayFilename?: string;
  readonly mediaType?: string;
  readonly availabilityStatus: string;
  readonly createdAt: Date;
}

export interface WorkspaceContentQueryStore {
  getAgentAttachmentArtifact(
    authority: TrustedWorkspaceScope,
    artifactId: string,
    threadId?: string,
  ): Promise<WorkspaceAgentAttachmentArtifact>;
  listAssets(
    authority: TrustedWorkspaceScope,
    query?: WorkspaceAssetQuery,
  ): Promise<WorkspaceAssetList>;
  getAsset(
    authority: TrustedWorkspaceScope,
    assetId: string,
    query?: WorkspaceAssetDetailQuery,
  ): Promise<WorkspaceAssetDetail>;
  listCreationEntrypoints(
    authority: TrustedWorkspaceScope,
    locale?: string,
  ): Promise<WorkspaceCreationEntrypointList>;
  listWorkflowRunArtifacts(
    authority: TrustedWorkspaceScope,
    workflowRunId: string,
  ): Promise<readonly WorkspaceWorkflowRunArtifact[]>;
  listCapabilityRunArtifacts(
    authority: TrustedWorkspaceScope,
    capabilityRunId: string,
  ): Promise<readonly WorkspaceWorkflowRunArtifact[]>;
}

export type WorkspaceContentQueryStoreErrorCode =
  | "workspace_content.invalid_authority"
  | "workspace_content.invalid_query"
  | "workspace_content.forbidden"
  | "workspace_content.not_found";

export class WorkspaceContentQueryStoreError extends Error {
  public constructor(
    public readonly code: WorkspaceContentQueryStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WorkspaceContentQueryStoreError";
  }
}

interface AssetRow extends RowDataPacket {
  readonly id: string;
  readonly assetKey: string;
  readonly name: string;
  readonly assetType: string;
  readonly lifecycleStatus: WorkspaceAssetSummary["lifecycleStatus"];
  readonly currentArtifactId: string | null;
  readonly artifactType: string | null;
  readonly displayFilename: string | null;
  readonly mediaType: string | null;
  readonly byteSize: string | null;
  readonly availabilityStatus: string | null;
  readonly dataClassification: string | null;
  readonly artifactCreatedAt: Date | null;
  readonly brandKitRevisionId: string | null;
  readonly brandKitId: string | null;
  readonly brandName: string | null;
  readonly brandRevisionNumber: number | string | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

interface AssetArtifactDetailRow extends RowDataPacket {
  readonly id: string;
  readonly artifactType: string;
  readonly displayFilename: string | null;
  readonly mediaType: string | null;
  readonly byteSize: string | null;
  readonly availabilityStatus: string;
  readonly dataClassification: string;
  readonly createdByCapabilityRunId: string | null;
  readonly metadata: unknown;
  readonly isCurrent: number | string;
  readonly brandKitRevisionId: string | null;
  readonly brandKitId: string | null;
  readonly brandName: string | null;
  readonly brandRevisionNumber: number | string | null;
  readonly createdAt: Date;
}

interface AssetBrandUsageRow extends RowDataPacket {
  readonly brandKitId: string;
  readonly name: string;
  readonly isDefault: number | boolean;
  readonly logoRole: BrandKitLogo["role"];
}

interface AssetLineageRow extends RowDataPacket {
  readonly edgeId: string;
  readonly edgeCreatedAt: Date;
  readonly direction: "input" | "output";
  readonly relation: WorkspaceAssetLineageItem["relation"];
  readonly artifactId: string;
  readonly artifactType: string;
  readonly displayFilename: string | null;
  readonly mediaType: string | null;
  readonly artifactCreatedAt: Date;
}

interface AssetTypeRow extends RowDataPacket {
  readonly assetType: string;
}

interface CreationEntrypointRow extends RowDataPacket {
  readonly skillRevisionId: string;
  readonly skillKey: string;
  readonly skillRevision: number;
  readonly manifestDocument: unknown;
  readonly entrypointKey: string;
  readonly workflowRevisionId: string;
  readonly workflowRevision: number;
  readonly inputSchema: unknown;
  readonly outputSchema: unknown;
  readonly topology: unknown;
  readonly capabilityKey: string | null;
  readonly capabilityRevision: number | null;
  readonly capabilityCanonicalDigest: string | null;
  readonly capabilityAuthoring: WorkflowCapabilityAuthoringDeclaration | null;
}

interface WorkflowRunArtifactRow extends RowDataPacket {
  readonly id: string;
  readonly assetId: string | null;
  readonly artifactType: string;
  readonly displayFilename: string | null;
  readonly mediaType: string | null;
  readonly availabilityStatus: string;
  readonly createdAt: Date;
}

interface AgentAttachmentArtifactRow extends RowDataPacket {
  readonly id: string;
  readonly assetId: string | null;
  readonly artifactType: string;
  readonly displayFilename: string | null;
  readonly mediaType: string | null;
  readonly availabilityStatus: string;
  readonly createdAt: Date;
}

const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const assetLimit = 100;
const assetArtifactHistoryLimit = 20;
const assetLineageHistoryLimit = 40;
const creationEntrypointLimit = 100;
const workflowRunArtifactLimit = 32;

function invalidQuery(message: string): never {
  throw new WorkspaceContentQueryStoreError(
    "workspace_content.invalid_query",
    message,
  );
}

function normalizedAssetQuery(
  query: WorkspaceAssetQuery | undefined,
): Required<Pick<WorkspaceAssetQuery, "limit">> &
  Omit<WorkspaceAssetQuery, "limit"> {
  const limit = query?.limit ?? assetLimit;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > assetLimit ||
    (query?.search !== undefined &&
      (query.search.length < 1 || query.search.length > 120)) ||
    (query?.assetType !== undefined &&
      (query.assetType.length < 1 || query.assetType.length > 120)) ||
    (query?.ids !== undefined &&
      (query.ids.length < 1 ||
        query.ids.length > 24 ||
        new Set(query.ids).size !== query.ids.length ||
        query.ids.some((id) => !idPattern.test(id)))) ||
    (query?.ids !== undefined && query.cursor !== undefined) ||
    (query?.cursor !== undefined &&
      (!idPattern.test(query.cursor.id) ||
        !Number.isFinite(query.cursor.updatedAt.getTime())))
  ) {
    return invalidQuery("Workspace Asset query is invalid.");
  }
  return {
    ...(query ?? {}),
    limit,
  };
}

function normalizedAssetDetailQuery(
  query: WorkspaceAssetDetailQuery | undefined,
): WorkspaceAssetDetailQuery {
  const maximum = assetLineageHistoryLimit;
  if (
    (query?.artifactId !== undefined &&
      (!idPattern.test(query.artifactId) || query.cursor !== undefined)) ||
    (query?.limit !== undefined &&
      (!Number.isSafeInteger(query.limit) ||
        query.limit < 1 ||
        query.limit > maximum)) ||
    (query?.cursor !== undefined && query.historyKind === undefined) ||
    (query?.cursor !== undefined &&
      (!idPattern.test(query.cursor.id) ||
        !Number.isFinite(query.cursor.occurredAt.getTime()) ||
        (query.historyKind === "artifacts" &&
          query.cursor.currentRank !== 0 &&
          query.cursor.currentRank !== 1) ||
        (query.cursor.currentRank !== undefined &&
          query.historyKind !== "artifacts")))
  ) {
    return invalidQuery("Workspace Asset detail query is invalid.");
  }
  return {
    ...(query?.artifactId ? { artifactId: query.artifactId } : {}),
    ...(query?.historyKind ? { historyKind: query.historyKind } : {}),
    ...(query?.cursor ? { cursor: query.cursor } : {}),
    ...(query?.limit ? { limit: query.limit } : {}),
  };
}

function escapedLike(value: string): string {
  return `%${value.replace(/[\\%_]/gu, "\\$&")}%`;
}

function assertAuthority(
  authority: TrustedWorkspaceScope,
  permission: WorkspacePermissionId,
): void {
  if (
    authority.trusted !== true ||
    !idPattern.test(authority.workspaceId) ||
    !idPattern.test(authority.principalId)
  ) {
    throw new WorkspaceContentQueryStoreError(
      "workspace_content.invalid_authority",
      "Workspace content query authority is invalid.",
    );
  }
  if (!authority.effectivePermissions.includes(permission)) {
    throw new WorkspaceContentQueryStoreError(
      "workspace_content.forbidden",
      `Workspace content query authority is missing ${permission}.`,
    );
  }
}

function jsonRecord(value: unknown): Readonly<Record<string, unknown>> {
  const parsed =
    typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Readonly<Record<string, unknown>>)
    : Object.freeze({});
}

function boundedText(
  value: unknown,
  maximumLength: number,
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maximumLength
    ? normalized
    : undefined;
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): number | undefined {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
    ? value
    : undefined;
}

function assetArtifactOrigin(
  row: AssetArtifactDetailRow,
): WorkspaceAssetArtifactOrigin {
  const metadata = jsonRecord(row.metadata);
  const canvasExport = jsonRecord(metadata.canvasExport);
  const request = jsonRecord(canvasExport.request);
  const canvasDraftId = boundedText(request.canvasDraftId, 26);
  const pageId = boundedText(request.pageId, 160);
  const documentVersion = boundedInteger(
    request.documentVersion,
    1,
    4_294_967_295,
  );
  const width = boundedInteger(request.width, 1, 32_768);
  const height = boundedInteger(request.height, 1, 32_768);
  const sourceArtifactCount = boundedInteger(
    canvasExport.sourceArtifactCount,
    0,
    100_000,
  );
  if (
    canvasDraftId &&
    idPattern.test(canvasDraftId) &&
    pageId &&
    documentVersion &&
    width &&
    height &&
    sourceArtifactCount !== undefined &&
    (request.format === "png" ||
      request.format === "jpeg" ||
      request.format === "webp") &&
    typeof request.transparentBackground === "boolean"
  ) {
    return Object.freeze({
      kind: "canvas_export",
      canvasDraftId,
      documentVersion,
      pageId,
      format: request.format,
      width,
      height,
      transparentBackground: request.transparentBackground,
      sourceArtifactCount,
    });
  }
  if (
    row.createdByCapabilityRunId &&
    idPattern.test(row.createdByCapabilityRunId)
  ) {
    return Object.freeze({
      kind: "capability_result",
      capabilityRunId: row.createdByCapabilityRunId,
    });
  }
  if (metadata.importedFrom === "canvas-v1") {
    return Object.freeze({ kind: "user_import" });
  }
  return Object.freeze({ kind: "unknown" });
}

function assetBrandContext(row: {
  readonly brandKitRevisionId: string | null;
  readonly brandKitId: string | null;
  readonly brandName: string | null;
  readonly brandRevisionNumber: number | string | null;
}): CanvasBrandContext | undefined {
  if (
    !row.brandKitRevisionId ||
    !row.brandKitId ||
    !row.brandName ||
    row.brandRevisionNumber === null
  ) {
    return undefined;
  }
  return Object.freeze({
    brandKitId: row.brandKitId,
    brandKitRevisionId: row.brandKitRevisionId,
    name: row.brandName,
    revisionNumber: Number(row.brandRevisionNumber),
  });
}

function mapAssetArtifactDetail(
  row: AssetArtifactDetailRow,
): WorkspaceAssetArtifactDetail {
  const brand = assetBrandContext(row);
  return Object.freeze({
    id: row.id,
    artifactType: row.artifactType,
    ...(row.displayFilename ? { displayFilename: row.displayFilename } : {}),
    ...(row.mediaType ? { mediaType: row.mediaType } : {}),
    ...(row.byteSize ? { byteSize: row.byteSize } : {}),
    availabilityStatus: row.availabilityStatus,
    dataClassification: row.dataClassification,
    isCurrent: Number(row.isCurrent) === 1,
    ...(brand ? { brand } : {}),
    origin: assetArtifactOrigin(row),
    createdAt: row.createdAt,
  });
}

function entrypointDescriptor(
  manifest: Readonly<Record<string, unknown>>,
  entrypointKey: string,
): Readonly<Record<string, unknown>> {
  const entrypoints = manifest.entrypoints;
  if (!Array.isArray(entrypoints)) {
    return Object.freeze({});
  }
  for (const candidate of entrypoints) {
    const record = jsonRecord(candidate);
    if (record.entrypointKey === entrypointKey) {
      return record;
    }
  }
  return Object.freeze({});
}

function outputPresentation(
  value: unknown,
): CreationEntrypointOutputPresentation {
  return value === "board" || value === "batch_review" || value === "assets"
    ? value
    : "single_review";
}

function localizedText(value: unknown): LocalizedTextV1 | undefined {
  const candidate = jsonRecord(value);
  const values = jsonRecord(candidate.values);
  if (
    typeof candidate.defaultLocale !== "string" ||
    Object.keys(values).length < 1 ||
    Object.values(values).some((entry) => typeof entry !== "string")
  ) {
    return undefined;
  }
  return {
    defaultLocale: candidate.defaultLocale,
    values: values as Readonly<Record<string, string>>,
  };
}

function localizedField(
  container: unknown,
  field: string,
  locale: string,
): string | undefined {
  const value = localizedText(jsonRecord(container)[field]);
  return value ? resolveLocalizedTextV1(value, locale) : undefined;
}

function localizedUiSchema(
  descriptor: Readonly<Record<string, unknown>>,
  locale: string,
): Readonly<Record<string, unknown>> | undefined {
  const byLocale = jsonRecord(descriptor.inputUiSchemaByLocale);
  const exact = byLocale[locale];
  if (exact !== undefined) return jsonRecord(exact);
  const language = locale.split("-", 1)[0]?.toLowerCase();
  const match = Object.entries(byLocale).find(
    ([candidate]) => candidate.split("-", 1)[0]?.toLowerCase() === language,
  );
  if (match) return jsonRecord(match[1]);
  return descriptor.inputUiSchema === undefined
    ? undefined
    : jsonRecord(descriptor.inputUiSchema);
}

function capabilityText(
  value: WorkflowCapabilityAuthoringDeclaration["catalog"]["title"],
  locale: string,
): string {
  return locale.toLowerCase().startsWith("en")
    ? value["en-US"]
    : value["zh-CN"];
}

function mapCreationEntrypoint(
  row: CreationEntrypointRow,
  effectiveInvocationSchema: EffectiveInvocationSchema,
  locale = "zh-CN",
): WorkspaceCreationEntrypointSummary {
  const manifest = jsonRecord(row.manifestDocument);
  const descriptor = entrypointDescriptor(manifest, row.entrypointKey);
  const capability =
    row.capabilityKey &&
    row.capabilityRevision !== null &&
    row.capabilityCanonicalDigest &&
    row.capabilityAuthoring
      ? Object.freeze({
          contractKey: row.capabilityKey,
          revision: row.capabilityRevision,
          canonicalDigest: row.capabilityCanonicalDigest,
          surfaces: Object.freeze([
            ...(row.capabilityAuthoring.catalog.surfaces ?? []),
          ]),
          parameters: Object.freeze(
            row.capabilityAuthoring.parameters.map((parameter) =>
              Object.freeze({
                key: parameter.key,
                semanticType: parameter.semanticType,
              }),
            ),
          ),
          outputs: Object.freeze(
            row.capabilityAuthoring.outputs.map((output) =>
              Object.freeze({
                key: output.key,
                semanticType: output.semanticType,
                primary: output.primary,
              }),
            ),
          ),
        })
      : undefined;
  const displayName =
    (capability
      ? capabilityText(row.capabilityAuthoring!.catalog.title, locale)
      : undefined) ??
    localizedField(descriptor.i18n, "displayName", locale) ??
    localizedField(manifest.i18n, "displayName", locale) ??
    boundedText(descriptor.displayName, 240) ??
    boundedText(manifest.displayName, 240) ??
    row.skillKey;
  const description =
    (capability && row.capabilityAuthoring!.catalog.description
      ? capabilityText(row.capabilityAuthoring!.catalog.description, locale)
      : undefined) ??
    localizedField(descriptor.i18n, "description", locale) ??
    boundedText(descriptor.description, 500);
  const category =
    (capability
      ? capabilityText(row.capabilityAuthoring!.catalog.category, locale)
      : undefined) ??
    localizedField(descriptor.i18n, "category", locale) ??
    boundedText(descriptor.category, 120);
  const inputUiSchema = localizedUiSchema(descriptor, locale);

  return Object.freeze({
    skillRevisionId: row.skillRevisionId,
    skillKey: row.skillKey,
    skillRevision: row.skillRevision,
    entrypointKey: row.entrypointKey,
    workflowRevisionId: row.workflowRevisionId,
    workflowRevision: row.workflowRevision,
    displayName,
    ...(description ? { description } : {}),
    ...(category ? { category } : {}),
    nonProduction: manifest.nonProduction === true,
    outputPresentation: outputPresentation(descriptor.outputPresentation),
    inputSchema: jsonRecord(row.inputSchema),
    outputSchema: jsonRecord(row.outputSchema),
    effectiveInvocationSchema,
    ...(inputUiSchema ? { inputUiSchema } : {}),
    ...(capability ? { capability } : {}),
  });
}

export function createWorkspaceContentQueryStore(
  pool: Pool,
  options: {
    readonly effectiveInvocationSchemas?: EffectiveInvocationSchemaProjector;
    readonly now?: () => Date;
  } = {},
): WorkspaceContentQueryStore {
  return Object.freeze({
    async getAgentAttachmentArtifact(
      authority: TrustedWorkspaceScope,
      artifactId: string,
      threadId?: string,
    ): Promise<WorkspaceAgentAttachmentArtifact> {
      assertAuthority(authority, "agent.run");
      assertAuthority(authority, "artifact.download");
      if (
        !idPattern.test(artifactId) ||
        (threadId !== undefined && !idPattern.test(threadId))
      ) {
        return invalidQuery("Agent attachment Artifact ID is invalid.");
      }
      const [rows] = await pool.query<AgentAttachmentArtifactRow[]>(
        `SELECT
           artifact.id,
           artifact.asset_id AS assetId,
           artifact.artifact_type AS artifactType,
           artifact.display_filename AS displayFilename,
           object_fact.media_type AS mediaType,
           artifact.availability_status AS availabilityStatus,
           artifact.created_at AS createdAt
         FROM artifact
         LEFT JOIN capability_run capability
           ON capability.workspace_id = artifact.workspace_id
          AND capability.id = artifact.created_by_capability_run_id
         LEFT JOIN node_run node
           ON node.workspace_id = capability.workspace_id
          AND node.id = capability.node_run_id
         LEFT JOIN workflow_run workflow
           ON workflow.workspace_id = node.workspace_id
          AND workflow.id = node.workflow_run_id
         LEFT JOIN stored_object object_fact
           ON object_fact.workspace_id = artifact.workspace_id
          AND object_fact.id = artifact.stored_object_id
          AND object_fact.delete_state = 'active'
         WHERE artifact.workspace_id = ?
           AND artifact.id = ?
           AND (
             (artifact.created_by_principal_id = ?
              AND JSON_UNQUOTE(JSON_EXTRACT(artifact.metadata, '$.importedFrom')) = 'agent-composer')
             OR (
               ? IS NOT NULL
               AND EXISTS (
                 SELECT 1
                 FROM agent_action_receipt action
                 INNER JOIN agent_run agent_run
                   ON agent_run.workspace_id = action.workspace_id
                  AND agent_run.id = action.agent_run_id
                 INNER JOIN agent_thread thread
                   ON thread.workspace_id = agent_run.workspace_id
                  AND thread.id = agent_run.thread_id
                 WHERE action.workspace_id = artifact.workspace_id
                   AND agent_run.thread_id = ?
                   AND thread.created_by_principal_id = ?
                   AND action.lifecycle_status = 'succeeded'
                   AND (
                     (action.capability_run_id = capability.id
                      AND capability.invocation_kind = 'agent')
                     OR (action.workflow_run_id = node.workflow_run_id
                      AND workflow.idempotency_key = CONCAT('agent-workflow:', action.id))
                   )
               )
             )
           )
         LIMIT 1`,
        [
          authority.workspaceId,
          artifactId,
          authority.principalId,
          threadId ?? null,
          threadId ?? null,
          authority.principalId,
        ],
      );
      const artifact = rows[0];
      if (!artifact) {
        throw new WorkspaceContentQueryStoreError(
          "workspace_content.not_found",
          "Agent attachment Artifact was not found.",
        );
      }
      return Object.freeze({
        id: artifact.id,
        ...(artifact.assetId ? { assetId: artifact.assetId } : {}),
        artifactType: artifact.artifactType,
        ...(artifact.displayFilename
          ? { displayFilename: artifact.displayFilename }
          : {}),
        ...(artifact.mediaType ? { mediaType: artifact.mediaType } : {}),
        availabilityStatus: artifact.availabilityStatus,
        createdAt: artifact.createdAt,
      });
    },

    async listCapabilityRunArtifacts(
      authority: TrustedWorkspaceScope,
      capabilityRunId: string,
    ): Promise<readonly WorkspaceWorkflowRunArtifact[]> {
      assertAuthority(authority, "capability.run");
      assertAuthority(authority, "asset.read");
      if (!idPattern.test(capabilityRunId)) {
        return invalidQuery("Capability Run ID is invalid.");
      }
      const [rows] = await pool.query<WorkflowRunArtifactRow[]>(
        `SELECT
           artifact.id,
           artifact.asset_id AS assetId,
           artifact.artifact_type AS artifactType,
           artifact.display_filename AS displayFilename,
           object_fact.media_type AS mediaType,
           artifact.availability_status AS availabilityStatus,
           artifact.created_at AS createdAt
         FROM artifact
         INNER JOIN capability_run capability
           ON capability.workspace_id = artifact.workspace_id
          AND capability.id = artifact.created_by_capability_run_id
         LEFT JOIN node_run node
           ON node.workspace_id = capability.workspace_id
          AND node.id = capability.node_run_id
         LEFT JOIN workflow_run workflow
           ON workflow.workspace_id = node.workspace_id
          AND workflow.id = node.workflow_run_id
         LEFT JOIN stored_object object_fact
           ON object_fact.workspace_id = artifact.workspace_id
          AND object_fact.id = artifact.stored_object_id
          AND object_fact.delete_state = 'active'
         WHERE artifact.workspace_id = ?
           AND artifact.created_by_capability_run_id = ?
           AND (
             artifact.asset_id IS NOT NULL
             OR (
               (capability.invocation_kind <> 'agent' OR capability.created_by = ?)
               AND (workflow.idempotency_key IS NULL
                 OR workflow.idempotency_key NOT LIKE 'agent-workflow:%'
                 OR workflow.created_by = ?)
             )
           )
         ORDER BY artifact.created_at, artifact.id
         LIMIT ${String(workflowRunArtifactLimit)}`,
        [
          authority.workspaceId,
          capabilityRunId,
          authority.principalId,
          authority.principalId,
        ],
      );
      return Object.freeze(
        rows.map((row) =>
          Object.freeze({
            id: row.id,
            ...(row.assetId ? { assetId: row.assetId } : {}),
            artifactType: row.artifactType,
            ...(row.displayFilename
              ? { displayFilename: row.displayFilename }
              : {}),
            ...(row.mediaType ? { mediaType: row.mediaType } : {}),
            availabilityStatus: row.availabilityStatus,
            createdAt: row.createdAt,
          }),
        ),
      );
    },

    async listWorkflowRunArtifacts(
      authority: TrustedWorkspaceScope,
      workflowRunId: string,
    ): Promise<readonly WorkspaceWorkflowRunArtifact[]> {
      assertAuthority(authority, "workflow.read");
      assertAuthority(authority, "asset.read");
      if (!idPattern.test(workflowRunId)) {
        return invalidQuery("Workflow Run ID is invalid.");
      }
      const [rows] = await pool.query<WorkflowRunArtifactRow[]>(
        `SELECT
           artifact.id,
           artifact.asset_id AS assetId,
           artifact.artifact_type AS artifactType,
           artifact.display_filename AS displayFilename,
           object_fact.media_type AS mediaType,
           artifact.availability_status AS availabilityStatus,
           artifact.created_at AS createdAt
         FROM artifact
         INNER JOIN capability_run capability
           ON capability.workspace_id = artifact.workspace_id
          AND capability.id = artifact.created_by_capability_run_id
         INNER JOIN node_run node
           ON node.workspace_id = capability.workspace_id
          AND node.id = capability.node_run_id
         INNER JOIN workflow_run workflow
           ON workflow.workspace_id = node.workspace_id
          AND workflow.id = node.workflow_run_id
         LEFT JOIN stored_object object_fact
           ON object_fact.workspace_id = artifact.workspace_id
          AND object_fact.id = artifact.stored_object_id
          AND object_fact.delete_state = 'active'
         WHERE artifact.workspace_id = ?
           AND node.workflow_run_id = ?
           AND (
             artifact.asset_id IS NOT NULL
             OR workflow.idempotency_key NOT LIKE 'agent-workflow:%'
             OR workflow.created_by = ?
           )
         ORDER BY artifact.created_at, artifact.id
         LIMIT ${String(workflowRunArtifactLimit)}`,
        [authority.workspaceId, workflowRunId, authority.principalId],
      );
      return Object.freeze(
        rows.map((row) =>
          Object.freeze({
            id: row.id,
            ...(row.assetId ? { assetId: row.assetId } : {}),
            artifactType: row.artifactType,
            ...(row.displayFilename
              ? { displayFilename: row.displayFilename }
              : {}),
            ...(row.mediaType ? { mediaType: row.mediaType } : {}),
            availabilityStatus: row.availabilityStatus,
            createdAt: row.createdAt,
          }),
        ),
      );
    },

    async listAssets(
      authority: TrustedWorkspaceScope,
      requestedQuery?: WorkspaceAssetQuery,
    ): Promise<WorkspaceAssetList> {
      assertAuthority(authority, "asset.read");
      const query = normalizedAssetQuery(requestedQuery);
      const basePredicates = ["a.workspace_id = ?"];
      const baseParameters: unknown[] = [authority.workspaceId];
      if (query.search) {
        const pattern = escapedLike(query.search);
        basePredicates.push(
          "(a.name LIKE ? ESCAPE '\\\\' OR ar.display_filename LIKE ? ESCAPE '\\\\')",
        );
        baseParameters.push(pattern, pattern);
      }
      if (query.mediaKind) {
        if (query.mediaKind === "document") {
          basePredicates.push(
            "(so.media_type LIKE 'application/%' OR so.media_type LIKE 'text/%')",
          );
        } else {
          basePredicates.push("so.media_type LIKE ?");
          baseParameters.push(`${query.mediaKind}/%`);
        }
      }
      if (query.lifecycleStatus) {
        basePredicates.push("a.lifecycle_status = ?");
        baseParameters.push(query.lifecycleStatus);
      }
      const predicates = [...basePredicates];
      const parameters = [...baseParameters];
      if (query.assetType) {
        predicates.push("a.asset_type = ?");
        parameters.push(query.assetType);
      }
      if (query.ids) {
        predicates.push(`a.id IN (${query.ids.map(() => "?").join(", ")})`);
        parameters.push(...query.ids);
      }
      if (query.cursor) {
        predicates.push(
          "(a.updated_at < ? OR (a.updated_at = ? AND a.id < ?))",
        );
        parameters.push(
          query.cursor.updatedAt,
          query.cursor.updatedAt,
          query.cursor.id,
        );
      }
      parameters.push(query.limit + 1);
      const [rows] = await pool.query<AssetRow[]>(
        `
          SELECT
            a.id,
            a.asset_key AS assetKey,
            a.name,
            a.asset_type AS assetType,
            a.lifecycle_status AS lifecycleStatus,
            a.current_artifact_id AS currentArtifactId,
            ar.artifact_type AS artifactType,
            ar.display_filename AS displayFilename,
            so.media_type AS mediaType,
            so.byte_size AS byteSize,
            ar.availability_status AS availabilityStatus,
            ar.data_classification AS dataClassification,
            ar.created_at AS artifactCreatedAt,
            brand_revision.id AS brandKitRevisionId,
            brand_revision.brand_kit_id AS brandKitId,
            JSON_UNQUOTE(JSON_EXTRACT(brand_revision.content_document, '$.name')) AS brandName,
            brand_revision.revision_number AS brandRevisionNumber,
            a.version,
            a.created_at AS createdAt,
            a.updated_at AS updatedAt
          FROM asset a
          LEFT JOIN artifact ar
            ON ar.workspace_id = a.workspace_id
            AND ar.asset_id = a.id
            AND ar.id = a.current_artifact_id
          LEFT JOIN stored_object so
            ON so.workspace_id = ar.workspace_id
            AND so.id = ar.stored_object_id
          LEFT JOIN capability_run capability
            ON capability.workspace_id = ar.workspace_id
            AND capability.id = ar.created_by_capability_run_id
          LEFT JOIN node_run node
            ON node.workspace_id = capability.workspace_id
            AND node.id = capability.node_run_id
          LEFT JOIN workflow_run workflow
            ON workflow.workspace_id = node.workspace_id
            AND workflow.id = node.workflow_run_id
          LEFT JOIN canvas_draft canvas
            ON canvas.workspace_id = ar.workspace_id
            AND canvas.id = JSON_UNQUOTE(
              JSON_EXTRACT(ar.metadata, '$.canvasExport.request.canvasDraftId')
            )
          LEFT JOIN brand_kit_revision brand_revision
            ON brand_revision.workspace_id = ar.workspace_id
            AND brand_revision.id = COALESCE(
              workflow.brand_kit_revision_id,
              canvas.brand_kit_revision_id
            )
          WHERE ${predicates.join("\n            AND ")}
          ORDER BY a.updated_at DESC, a.id DESC
          LIMIT ?
        `,
        parameters,
      );
      let facetRows: AssetTypeRow[] = [];
      if (!query.cursor && !query.ids) {
        [facetRows] = await pool.query<AssetTypeRow[]>(
          `
            SELECT DISTINCT
              a.asset_type AS assetType
            FROM asset a
            LEFT JOIN artifact ar
              ON ar.workspace_id = a.workspace_id
              AND ar.asset_id = a.id
              AND ar.id = a.current_artifact_id
            LEFT JOIN stored_object so
              ON so.workspace_id = ar.workspace_id
              AND so.id = ar.stored_object_id
            WHERE ${basePredicates.join("\n              AND ")}
            ORDER BY a.asset_type ASC
            LIMIT 100
          `,
          baseParameters,
        );
      }
      const selected = rows.slice(0, query.limit);
      const last = selected.at(-1);

      return Object.freeze({
        items: Object.freeze(
          selected.map((asset) => {
            const brand = assetBrandContext(asset);
            return Object.freeze({
              id: asset.id,
              assetKey: asset.assetKey,
              name: asset.name,
              assetType: asset.assetType,
              lifecycleStatus: asset.lifecycleStatus,
              ...(asset.currentArtifactId &&
              asset.artifactType &&
              asset.availabilityStatus &&
              asset.dataClassification &&
              asset.artifactCreatedAt
                ? {
                    currentArtifact: Object.freeze({
                      id: asset.currentArtifactId,
                      artifactType: asset.artifactType,
                      ...(asset.displayFilename
                        ? {
                            displayFilename: asset.displayFilename,
                          }
                        : {}),
                      ...(asset.mediaType
                        ? { mediaType: asset.mediaType }
                        : {}),
                      ...(asset.byteSize ? { byteSize: asset.byteSize } : {}),
                      availabilityStatus: asset.availabilityStatus,
                      dataClassification: asset.dataClassification,
                      ...(brand ? { brand } : {}),
                      createdAt: asset.artifactCreatedAt,
                    }),
                  }
                : {}),
              version: asset.version,
              createdAt: asset.createdAt,
              updatedAt: asset.updatedAt,
            });
          }),
        ),
        truncated: rows.length > query.limit,
        ...(!query.cursor && !query.ids
          ? {
              facets: Object.freeze({
                assetTypes: Object.freeze(
                  facetRows.map((row) => row.assetType),
                ),
              }),
            }
          : {}),
        ...(rows.length > query.limit && last
          ? {
              nextCursor: Object.freeze({
                updatedAt: last.updatedAt,
                id: last.id,
              }),
            }
          : {}),
      });
    },

    async getAsset(
      authority: TrustedWorkspaceScope,
      assetId: string,
      requestedQuery?: WorkspaceAssetDetailQuery,
    ): Promise<WorkspaceAssetDetail> {
      assertAuthority(authority, "asset.read");
      if (!idPattern.test(assetId)) {
        return invalidQuery("Workspace Asset id is invalid.");
      }
      const query = normalizedAssetDetailQuery(requestedQuery);
      const artifactCursor =
        query.historyKind === "artifacts" ? query.cursor : undefined;
      const lineageCursor =
        query.historyKind === "lineage" ? query.cursor : undefined;
      const artifactPageLimit =
        query.historyKind === "artifacts"
          ? (query.limit ?? assetArtifactHistoryLimit)
          : assetArtifactHistoryLimit;
      const lineagePageLimit =
        query.historyKind === "lineage"
          ? (query.limit ?? assetLineageHistoryLimit)
          : assetLineageHistoryLimit;
      const [assetRows] = await pool.query<AssetRow[]>(
        `
          SELECT
            a.id,
            a.asset_key AS assetKey,
            a.name,
            a.asset_type AS assetType,
            a.lifecycle_status AS lifecycleStatus,
            a.current_artifact_id AS currentArtifactId,
            ar.artifact_type AS artifactType,
            ar.display_filename AS displayFilename,
            so.media_type AS mediaType,
            so.byte_size AS byteSize,
            ar.availability_status AS availabilityStatus,
            ar.data_classification AS dataClassification,
            ar.created_at AS artifactCreatedAt,
            a.version,
            a.created_at AS createdAt,
            a.updated_at AS updatedAt
          FROM asset a
          LEFT JOIN artifact ar
            ON ar.workspace_id = a.workspace_id
            AND ar.id = a.current_artifact_id
          LEFT JOIN stored_object so
            ON so.workspace_id = ar.workspace_id
            AND so.id = ar.stored_object_id
          WHERE a.workspace_id = ?
            AND a.id = ?
          LIMIT 1
        `,
        [authority.workspaceId, assetId],
      );
      const asset = assetRows[0];
      if (!asset) {
        throw new WorkspaceContentQueryStoreError(
          "workspace_content.not_found",
          "Workspace Asset was not found.",
        );
      }
      const [artifactRows] = await pool.query<AssetArtifactDetailRow[]>(
        `
            SELECT
              ar.id,
              ar.artifact_type AS artifactType,
              ar.display_filename AS displayFilename,
              so.media_type AS mediaType,
              CAST(so.byte_size AS CHAR) AS byteSize,
              ar.availability_status AS availabilityStatus,
              ar.data_classification AS dataClassification,
              ar.created_by_capability_run_id AS createdByCapabilityRunId,
              brand_revision.id AS brandKitRevisionId,
              brand_revision.brand_kit_id AS brandKitId,
              JSON_UNQUOTE(JSON_EXTRACT(brand_revision.content_document, '$.name')) AS brandName,
              brand_revision.revision_number AS brandRevisionNumber,
              ar.metadata,
              CASE WHEN ar.id = ? THEN 1 ELSE 0 END AS isCurrent,
              ar.created_at AS createdAt
            FROM artifact ar
            LEFT JOIN stored_object so
              ON so.workspace_id = ar.workspace_id
              AND so.id = ar.stored_object_id
            LEFT JOIN capability_run capability
              ON capability.workspace_id = ar.workspace_id
              AND capability.id = ar.created_by_capability_run_id
            LEFT JOIN node_run node
              ON node.workspace_id = capability.workspace_id
              AND node.id = capability.node_run_id
            LEFT JOIN workflow_run workflow
              ON workflow.workspace_id = node.workspace_id
              AND workflow.id = node.workflow_run_id
            LEFT JOIN canvas_draft canvas
              ON canvas.workspace_id = ar.workspace_id
              AND canvas.id = JSON_UNQUOTE(
                JSON_EXTRACT(ar.metadata, '$.canvasExport.request.canvasDraftId')
              )
            LEFT JOIN brand_kit_revision brand_revision
              ON brand_revision.workspace_id = ar.workspace_id
              AND brand_revision.id = COALESCE(
                workflow.brand_kit_revision_id,
                canvas.brand_kit_revision_id
              )
            WHERE ar.workspace_id = ?
              AND ar.asset_id = ?
              ${query.artifactId ? "AND ar.id = ?" : ""}
              ${
                artifactCursor
                  ? `AND (
                      CASE WHEN ar.id = ? THEN 1 ELSE 0 END < ?
                      OR (
                        CASE WHEN ar.id = ? THEN 1 ELSE 0 END = ?
                        AND (
                          ar.created_at < ?
                          OR (ar.created_at = ? AND ar.id < ?)
                        )
                      )
                    )`
                  : ""
              }
            ORDER BY isCurrent DESC, ar.created_at DESC, ar.id DESC
            LIMIT ?
          `,
        [
          asset.currentArtifactId ?? "",
          authority.workspaceId,
          assetId,
          ...(query.artifactId ? [query.artifactId] : []),
          ...(artifactCursor
            ? [
                asset.currentArtifactId ?? "",
                artifactCursor.currentRank,
                asset.currentArtifactId ?? "",
                artifactCursor.currentRank,
                artifactCursor.occurredAt,
                artifactCursor.occurredAt,
                artifactCursor.id,
              ]
            : []),
          artifactPageLimit + 1,
        ],
      );
      const selectedArtifactRows = artifactRows.slice(0, artifactPageLimit);
      const artifacts = Object.freeze(
        selectedArtifactRows.map(mapAssetArtifactDetail),
      );
      const currentArtifact = artifacts.find((artifact) => artifact.isCurrent);
      const [brandUsageRows] = await pool.query<AssetBrandUsageRow[]>(
        `SELECT
           kit.id AS brandKitId,
           kit.name,
           CASE WHEN kit.default_marker = TRUE THEN 1 ELSE 0 END AS isDefault,
           reference.reference_role AS logoRole
         FROM brand_kit_revision_artifact_reference AS reference
         INNER JOIN brand_kit AS kit
           ON kit.workspace_id = reference.workspace_id
           AND kit.latest_published_revision_id = reference.brand_kit_revision_id
         WHERE reference.workspace_id = ?
           AND reference.asset_id = ?
           AND kit.lifecycle_status = 'active'
         ORDER BY kit.default_marker DESC, kit.name ASC, kit.id ASC`,
        [authority.workspaceId, assetId],
      );
      let lineageRows: AssetLineageRow[] = [];
      if (asset.currentArtifactId) {
        [lineageRows] = await pool.query<AssetLineageRow[]>(
          `
              SELECT
                edge.id AS edgeId,
                edge.created_at AS edgeCreatedAt,
                CASE
                  WHEN edge.target_artifact_id = ? THEN 'input'
                  ELSE 'output'
                END AS direction,
                edge.relation,
                other.id AS artifactId,
                other.artifact_type AS artifactType,
                other.display_filename AS displayFilename,
                other_object.media_type AS mediaType,
                other.created_at AS artifactCreatedAt
              FROM artifact_edge edge
              INNER JOIN artifact other
                ON other.workspace_id = edge.workspace_id
                AND other.id = CASE
                  WHEN edge.target_artifact_id = ?
                    THEN edge.source_artifact_id
                  ELSE edge.target_artifact_id
                END
              LEFT JOIN stored_object other_object
                ON other_object.workspace_id = other.workspace_id
                AND other_object.id = other.stored_object_id
              WHERE edge.workspace_id = ?
                AND (
                  edge.source_artifact_id = ?
                  OR edge.target_artifact_id = ?
                )
                ${
                  lineageCursor
                    ? `AND (
                        edge.created_at < ?
                        OR (
                          edge.created_at = ?
                          AND edge.id < ?
                        )
                      )`
                    : ""
                }
              ORDER BY edge.created_at DESC, edge.id DESC
              LIMIT ?
            `,
          [
            asset.currentArtifactId,
            asset.currentArtifactId,
            authority.workspaceId,
            asset.currentArtifactId,
            asset.currentArtifactId,
            ...(lineageCursor
              ? [
                  lineageCursor.occurredAt,
                  lineageCursor.occurredAt,
                  lineageCursor.id,
                ]
              : []),
            lineagePageLimit + 1,
          ],
        );
      }
      return Object.freeze({
        id: asset.id,
        name: asset.name,
        assetType: asset.assetType,
        lifecycleStatus: asset.lifecycleStatus,
        version: asset.version,
        ...(currentArtifact ? { currentArtifact } : {}),
        artifacts,
        artifactsTruncated: artifactRows.length > artifactPageLimit,
        ...(artifactRows.length > artifactPageLimit &&
        selectedArtifactRows.at(-1)
          ? {
              artifactsNextCursor: {
                occurredAt: selectedArtifactRows.at(-1)!.createdAt,
                id: selectedArtifactRows.at(-1)!.id,
                currentRank:
                  Number(selectedArtifactRows.at(-1)!.isCurrent) === 1
                    ? (1 as const)
                    : (0 as const),
              },
            }
          : {}),
        lineage: Object.freeze(
          lineageRows.slice(0, lineagePageLimit).map((row) =>
            Object.freeze({
              direction: row.direction,
              relation: row.relation,
              artifact: Object.freeze({
                id: row.artifactId,
                artifactType: row.artifactType,
                ...(row.displayFilename
                  ? { displayFilename: row.displayFilename }
                  : {}),
                ...(row.mediaType ? { mediaType: row.mediaType } : {}),
                createdAt: row.artifactCreatedAt,
              }),
            }),
          ),
        ),
        lineageTruncated: lineageRows.length > lineagePageLimit,
        ...(lineageRows.length > lineagePageLimit &&
        lineageRows.at(lineagePageLimit - 1)
          ? {
              lineageNextCursor: {
                occurredAt: lineageRows[lineagePageLimit - 1]!.edgeCreatedAt,
                id: lineageRows[lineagePageLimit - 1]!.edgeId,
              },
            }
          : {}),
        usedByBrands: Object.freeze(
          brandUsageRows.map((row) =>
            Object.freeze({
              brandKitId: row.brandKitId,
              name: row.name,
              isDefault: Boolean(row.isDefault),
              logoRole: row.logoRole,
            }),
          ),
        ),
        createdAt: asset.createdAt,
        updatedAt: asset.updatedAt,
      });
    },

    async listCreationEntrypoints(
      authority: TrustedWorkspaceScope,
      locale = "zh-CN",
    ): Promise<WorkspaceCreationEntrypointList> {
      assertAuthority(authority, "capability.run");
      const loadRows = async (
        executor: Pool | PoolConnection,
      ): Promise<CreationEntrypointRow[]> => {
        const [rows] = await executor.query<CreationEntrypointRow[]>(
          `
          SELECT
            ranked.skillRevisionId,
            ranked.skillKey,
            ranked.skillRevision,
            ranked.manifestDocument,
            ranked.entrypointKey,
            ranked.workflowRevisionId,
            ranked.workflowRevision,
            ranked.inputSchema,
            ranked.outputSchema,
            ranked.topology,
            contract.contract_key AS capabilityKey,
            contract.revision AS capabilityRevision,
            contract.canonical_digest AS capabilityCanonicalDigest,
            declaration.declaration AS capabilityAuthoring
          FROM (
            SELECT
              skill.workspace_id AS workspaceId,
              skill.id AS skillRevisionId,
              skill.skill_key AS skillKey,
              skill.revision AS skillRevision,
              skill.manifest_document AS manifestDocument,
              entrypoint.entrypoint_key AS entrypointKey,
              workflow.id AS workflowRevisionId,
              workflow.revision AS workflowRevision,
              workflow.input_schema AS inputSchema,
              workflow.output_schema AS outputSchema,
              workflow.topology,
              ROW_NUMBER() OVER (
                PARTITION BY
                  skill.skill_key,
                  entrypoint.entrypoint_key
                ORDER BY
                  skill.revision DESC,
                  skill.id DESC
              ) AS rowNumber
            FROM skill_revision AS skill
            INNER JOIN skill_revision_activation AS skill_activation
              ON skill_activation.workspace_id = skill.workspace_id
              AND skill_activation.skill_revision_id = skill.id
              AND skill_activation.runtime_status = 'enabled'
            INNER JOIN skill_revision_workflow_entrypoint AS entrypoint
              ON entrypoint.workspace_id = skill.workspace_id
              AND entrypoint.skill_revision_id = skill.id
            INNER JOIN workflow_revision AS workflow
              ON workflow.workspace_id = entrypoint.workspace_id
              AND workflow.id = entrypoint.workflow_revision_id
              AND workflow.lifecycle_status = 'published'
            INNER JOIN workflow_revision_activation AS workflow_activation
              ON workflow_activation.workspace_id = workflow.workspace_id
              AND workflow_activation.workflow_revision_id = workflow.id
              AND workflow_activation.runtime_status = 'enabled'
            WHERE
              skill.workspace_id = ?
              AND skill.lifecycle_status = 'published'
          ) ranked
          LEFT JOIN capability_contract_revision AS contract
            ON contract.workspace_id = ranked.workspaceId
            AND contract.contract_key = JSON_UNQUOTE(JSON_EXTRACT(
              ranked.topology,
              '$.nodes[0].capability.contractId'
            ))
            AND contract.revision = CAST(JSON_UNQUOTE(JSON_EXTRACT(
              ranked.topology,
              '$.nodes[0].capability.revision'
            )) AS UNSIGNED)
            AND contract.canonical_digest = JSON_UNQUOTE(JSON_EXTRACT(
              ranked.topology,
              '$.nodes[0].capability.canonicalDigest'
            ))
            AND contract.lifecycle_status IN ('published', 'deprecated')
            AND JSON_LENGTH(JSON_EXTRACT(ranked.topology, '$.nodes')) = 1
            AND JSON_UNQUOTE(JSON_EXTRACT(
              ranked.topology,
              '$.nodes[0].kind'
            )) = 'invoke'
            AND JSON_CONTAINS(
              contract.supported_invokers,
              JSON_QUOTE('workflow')
            ) = 1
          LEFT JOIN capability_definition AS definition
            ON definition.workspace_id = contract.workspace_id
            AND definition.current_contract_revision_id = contract.id
            AND definition.lifecycle_status = 'active'
          LEFT JOIN capability_declaration_revision AS declaration
            ON declaration.workspace_id = definition.workspace_id
            AND declaration.capability_definition_id = definition.id
            AND declaration.id = definition.current_declaration_revision_id
            AND JSON_CONTAINS(
              JSON_EXTRACT(declaration.declaration, '$.catalog.surfaces'),
              JSON_QUOTE('canvas')
            ) = 1
          WHERE ranked.rowNumber = 1
          ORDER BY
            ranked.skillKey,
            ranked.entrypointKey
          LIMIT ?
        `,
          [authority.workspaceId, creationEntrypointLimit + 1],
        );
        return rows;
      };

      if (!options.effectiveInvocationSchemas) {
        const rows = await loadRows(pool);
        return Object.freeze({
          items: Object.freeze(
            rows
              .slice(0, creationEntrypointLimit)
              .map((row) =>
                mapCreationEntrypoint(
                  row,
                  unavailableEffectiveInvocationSchema("route_unavailable"),
                  locale,
                ),
              ),
          ),
          truncated: rows.length > creationEntrypointLimit,
        });
      }

      const connection: PoolConnection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const rows = await loadRows(connection);
        const projectedAt = options.now?.() ?? new Date();
        const items: WorkspaceCreationEntrypointSummary[] = [];
        for (const row of rows.slice(0, creationEntrypointLimit)) {
          const topology =
            typeof row.topology === "string"
              ? (JSON.parse(row.topology) as unknown)
              : row.topology;
          const effectiveInvocationSchema = isWorkflowTopology(topology)
            ? await options.effectiveInvocationSchemas.projectInTransaction(
                connection,
                {
                  workspaceId: authority.workspaceId,
                  workflowRevisionId: row.workflowRevisionId,
                  topology,
                  inputSchema: jsonRecord(row.inputSchema),
                  now: projectedAt,
                },
              )
            : unavailableEffectiveInvocationSchema("unsupported_topology");
          items.push(
            mapCreationEntrypoint(row, effectiveInvocationSchema, locale),
          );
        }
        await connection.commit();
        return Object.freeze({
          items: Object.freeze(items),
          truncated: rows.length > creationEntrypointLimit,
        });
      } catch (error) {
        try {
          await connection.rollback();
        } catch {
          // Preserve the original query/projection failure.
        }
        throw error;
      } finally {
        connection.release();
      }
    },
  });
}
