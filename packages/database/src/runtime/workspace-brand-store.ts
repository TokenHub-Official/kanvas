import {
  DomainError,
  normalizeBrandKitDocument,
  type BrandAuditContext,
  type BrandKitDocument,
  type BrandKitDraftRecord,
  type BrandKitRevisionRecord,
  type BrandKitSummaryRecord,
  type TrustedWorkspaceScope,
  type WorkspaceBrandRepository,
} from "@kanvas/application";
import type {
  BrandKitColor,
  BrandKitGuidelines,
  BrandKitLogo,
  BrandKitReferenceImage,
  BrandKitTextStyle,
} from "@kanvas/contracts/api";
import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

import { revalidateTrustedWorkspaceScopeInTransaction } from "./authorization-store.js";
import {
  appendControlPlaneAuditEventInTransaction,
  type ControlPlaneAuditContext,
} from "./control-plane-audit.js";
import {
  canonicalizeProviderValue,
  digestProviderValue,
} from "./provider-value-digest.js";

interface BrandKitRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly description: string | null;
  readonly lifecycleStatus: "active" | "archived";
  readonly isDefault: number | null;
  readonly latestPublishedRevisionId: string | null;
  readonly creationRequestKey: string;
  readonly creationRequestHash: string;
  readonly version: number;
  readonly createdByPrincipalId: string;
  readonly updatedByPrincipalId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly draftSchemaVersion: number;
  readonly draftDocument: unknown;
  readonly draftContentDigest: string;
  readonly draftVersion: number;
  readonly draftCreatedByPrincipalId: string;
  readonly draftUpdatedByPrincipalId: string;
  readonly draftCreatedAt: Date;
  readonly draftUpdatedAt: Date;
  readonly latestRevisionNumber: number | null;
  readonly latestRevisionPublishedAt: Date | null;
}

interface BrandKitRevisionRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly brandKitId: string;
  readonly revisionNumber: number;
  readonly schemaVersion: number;
  readonly contentDocument: unknown;
  readonly contentDigest: string;
  readonly publicationRequestKey: string;
  readonly publicationRequestHash: string;
  readonly publishedByPrincipalId: string;
  readonly publishedAt: Date;
}

interface BrandKitLockRow extends RowDataPacket {
  readonly id: string;
}

interface BrandLogoArtifactRow extends RowDataPacket {
  readonly artifactId: string;
}

const brandKitSelect = `SELECT
  kit.id,
  kit.workspace_id AS workspaceId,
  kit.name,
  kit.description,
  kit.lifecycle_status AS lifecycleStatus,
  kit.default_marker AS isDefault,
  kit.latest_published_revision_id AS latestPublishedRevisionId,
  kit.creation_request_key AS creationRequestKey,
  kit.creation_request_hash AS creationRequestHash,
  kit.version,
  kit.created_by_principal_id AS createdByPrincipalId,
  kit.updated_by_principal_id AS updatedByPrincipalId,
  kit.created_at AS createdAt,
  kit.updated_at AS updatedAt,
  draft.schema_version AS draftSchemaVersion,
  draft.content_document AS draftDocument,
  draft.content_digest AS draftContentDigest,
  draft.version AS draftVersion,
  draft.created_by_principal_id AS draftCreatedByPrincipalId,
  draft.updated_by_principal_id AS draftUpdatedByPrincipalId,
  draft.created_at AS draftCreatedAt,
  draft.updated_at AS draftUpdatedAt,
  latest.revision_number AS latestRevisionNumber,
  latest.published_at AS latestRevisionPublishedAt
FROM brand_kit AS kit
INNER JOIN brand_kit_draft AS draft
  ON draft.workspace_id = kit.workspace_id
  AND draft.brand_kit_id = kit.id
LEFT JOIN brand_kit_revision AS latest
  ON latest.workspace_id = kit.workspace_id
  AND latest.brand_kit_id = kit.id
  AND latest.id = kit.latest_published_revision_id`;

function invalid(code: string, message: string): never {
  throw new DomainError(code, message);
}

function assertIdempotencyKey(value: string): void {
  if (value.length < 1 || value.length > 160) {
    invalid(
      "brand.invalid_argument",
      "idempotencyKey must contain between 1 and 160 characters.",
    );
  }
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function parseDocument(value: unknown): BrandKitDocument {
  const candidate = record(value);
  if (
    !candidate ||
    candidate.schemaVersion !== 1 ||
    typeof candidate.name !== "string" ||
    (candidate.description !== undefined &&
      typeof candidate.description !== "string") ||
    !Array.isArray(candidate.colors) ||
    !Array.isArray(candidate.logos) ||
    (candidate.referenceImages !== undefined &&
      !Array.isArray(candidate.referenceImages)) ||
    !Array.isArray(candidate.textStyles) ||
    !record(candidate.guidelines)
  ) {
    return invalid(
      "brand.integrity_violation",
      "Stored Brand Kit document does not match schema version 1.",
    );
  }
  const colors: BrandKitColor[] = candidate.colors.map((value) => {
    const color = record(value);
    if (
      !color ||
      typeof color.key !== "string" ||
      typeof color.name !== "string" ||
      typeof color.role !== "string" ||
      typeof color.value !== "string" ||
      typeof color.position !== "number"
    ) {
      return invalid(
        "brand.integrity_violation",
        "Stored Brand Kit color is invalid.",
      );
    }
    return {
      key: color.key,
      name: color.name,
      role: color.role as BrandKitColor["role"],
      value: color.value,
      position: color.position,
    };
  });
  const logos: BrandKitLogo[] = candidate.logos.map((value) => {
    const logo = record(value);
    if (
      !logo ||
      typeof logo.key !== "string" ||
      typeof logo.name !== "string" ||
      typeof logo.role !== "string" ||
      typeof logo.assetId !== "string" ||
      typeof logo.artifactId !== "string" ||
      typeof logo.position !== "number"
    ) {
      return invalid(
        "brand.integrity_violation",
        "Stored Brand Kit logo is invalid.",
      );
    }
    return {
      key: logo.key,
      name: logo.name,
      role: logo.role as BrandKitLogo["role"],
      assetId: logo.assetId,
      artifactId: logo.artifactId,
      position: logo.position,
    };
  });
  const referenceImages: BrandKitReferenceImage[] = (
    candidate.referenceImages ?? []
  ).map((value) => {
    const reference = record(value);
    if (
      !reference ||
      typeof reference.key !== "string" ||
      typeof reference.name !== "string" ||
      (reference.description !== undefined &&
        typeof reference.description !== "string") ||
      typeof reference.assetId !== "string" ||
      typeof reference.artifactId !== "string" ||
      typeof reference.position !== "number"
    ) {
      return invalid(
        "brand.integrity_violation",
        "Stored Brand Kit reference image is invalid.",
      );
    }
    return {
      key: reference.key,
      name: reference.name,
      ...(typeof reference.description === "string"
        ? { description: reference.description }
        : {}),
      assetId: reference.assetId,
      artifactId: reference.artifactId,
      position: reference.position,
    };
  });
  const textStyles: BrandKitTextStyle[] = candidate.textStyles.map((value) => {
    const style = record(value);
    if (
      !style ||
      typeof style.key !== "string" ||
      typeof style.name !== "string" ||
      typeof style.role !== "string" ||
      typeof style.fontId !== "string" ||
      typeof style.fontRevision !== "string" ||
      typeof style.fontFamily !== "string" ||
      typeof style.fontSize !== "number" ||
      typeof style.fontWeight !== "number" ||
      typeof style.lineHeight !== "number" ||
      typeof style.letterSpacing !== "number" ||
      (style.colorKey !== undefined && typeof style.colorKey !== "string") ||
      typeof style.position !== "number"
    ) {
      return invalid(
        "brand.integrity_violation",
        "Stored Brand Kit text style is invalid.",
      );
    }
    return {
      key: style.key,
      name: style.name,
      role: style.role as BrandKitTextStyle["role"],
      fontId: style.fontId,
      fontRevision: style.fontRevision,
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      lineHeight: style.lineHeight,
      letterSpacing: style.letterSpacing,
      ...(typeof style.colorKey === "string"
        ? { colorKey: style.colorKey }
        : {}),
      position: style.position,
    };
  });
  const guidelineRecord = record(candidate.guidelines);
  if (
    !guidelineRecord ||
    (guidelineRecord.voice !== undefined &&
      typeof guidelineRecord.voice !== "string") ||
    !Array.isArray(guidelineRecord.principles) ||
    !guidelineRecord.principles.every((value) => typeof value === "string") ||
    !Array.isArray(guidelineRecord.avoid) ||
    !guidelineRecord.avoid.every((value) => typeof value === "string")
  ) {
    return invalid(
      "brand.integrity_violation",
      "Stored Brand Kit guidelines are invalid.",
    );
  }
  const guidelines: BrandKitGuidelines = {
    ...(typeof guidelineRecord.voice === "string"
      ? { voice: guidelineRecord.voice }
      : {}),
    principles: guidelineRecord.principles,
    avoid: guidelineRecord.avoid,
  };
  return normalizeBrandKitDocument({
    name: candidate.name,
    ...(typeof candidate.description === "string"
      ? { description: candidate.description }
      : {}),
    colors,
    logos,
    referenceImages,
    textStyles,
    guidelines,
  });
}

function revisionSummary(row: BrandKitRow) {
  return row.latestPublishedRevisionId &&
    row.latestRevisionNumber !== null &&
    row.latestRevisionPublishedAt
    ? Object.freeze({
        id: row.latestPublishedRevisionId,
        revisionNumber: row.latestRevisionNumber,
        publishedAt: new Date(row.latestRevisionPublishedAt),
      })
    : undefined;
}

function summaryFrom(row: BrandKitRow): BrandKitSummaryRecord {
  const latestPublishedRevision = revisionSummary(row);
  return Object.freeze({
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    ...(row.description ? { description: row.description } : {}),
    lifecycleStatus: row.lifecycleStatus,
    isDefault: row.isDefault === 1,
    version: row.version,
    draftVersion: row.draftVersion,
    ...(latestPublishedRevision ? { latestPublishedRevision } : {}),
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  });
}

function draftFrom(row: BrandKitRow): BrandKitDraftRecord {
  if (row.draftSchemaVersion !== 1) {
    return invalid(
      "brand.integrity_violation",
      "Stored Brand Kit Draft schema version is unsupported.",
    );
  }
  const latestPublishedRevision = revisionSummary(row);
  return Object.freeze({
    brandKitId: row.id,
    workspaceId: row.workspaceId,
    lifecycleStatus: row.lifecycleStatus,
    isDefault: row.isDefault === 1,
    brandKitVersion: row.version,
    draftVersion: row.draftVersion,
    document: parseDocument(row.draftDocument),
    contentDigest: row.draftContentDigest,
    ...(latestPublishedRevision ? { latestPublishedRevision } : {}),
    createdByPrincipalId: row.draftCreatedByPrincipalId,
    updatedByPrincipalId: row.draftUpdatedByPrincipalId,
    createdAt: new Date(row.draftCreatedAt),
    updatedAt: new Date(row.draftUpdatedAt),
  });
}

function revisionFrom(row: BrandKitRevisionRow): BrandKitRevisionRecord {
  if (row.schemaVersion !== 1) {
    return invalid(
      "brand.integrity_violation",
      "Stored Brand Kit Revision schema version is unsupported.",
    );
  }
  return Object.freeze({
    id: row.id,
    workspaceId: row.workspaceId,
    brandKitId: row.brandKitId,
    revisionNumber: row.revisionNumber,
    document: parseDocument(row.contentDocument),
    contentDigest: row.contentDigest,
    publishedByPrincipalId: row.publishedByPrincipalId,
    publishedAt: new Date(row.publishedAt),
  });
}

async function inTransaction<TResult>(
  pool: Pool,
  operation: (connection: PoolConnection) => Promise<TResult>,
): Promise<TResult> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await operation(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function readBrandKit(
  connection: PoolConnection,
  workspaceId: string,
  brandKitId: string,
  lock: boolean,
): Promise<BrandKitRow | undefined> {
  const [rows] = await connection.execute<BrandKitRow[]>(
    `${brandKitSelect}
     WHERE kit.workspace_id = ?
       AND kit.id = ?
     LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [workspaceId, brandKitId],
  );
  return rows[0];
}

async function readRevision(
  connection: PoolConnection,
  workspaceId: string,
  brandKitId: string | undefined,
  brandKitRevisionId: string,
): Promise<BrandKitRevisionRow | undefined> {
  const [rows] = await connection.execute<BrandKitRevisionRow[]>(
    `SELECT
       id,
       workspace_id AS workspaceId,
       brand_kit_id AS brandKitId,
       revision_number AS revisionNumber,
       schema_version AS schemaVersion,
       content_document AS contentDocument,
       content_digest AS contentDigest,
       publication_request_key AS publicationRequestKey,
       publication_request_hash AS publicationRequestHash,
       published_by_principal_id AS publishedByPrincipalId,
       published_at AS publishedAt
     FROM brand_kit_revision
     WHERE workspace_id = ?
       ${brandKitId === undefined ? "" : "AND brand_kit_id = ?"}
       AND id = ?
     LIMIT 1`,
    [
      workspaceId,
      ...(brandKitId === undefined ? [] : [brandKitId]),
      brandKitRevisionId,
    ],
  );
  return rows[0];
}

async function validateImageReferences(
  connection: PoolConnection,
  authority: TrustedWorkspaceScope,
  logos: readonly BrandKitLogo[],
  referenceImages: readonly BrandKitReferenceImage[],
  now: Date,
): Promise<void> {
  const references = [...logos, ...referenceImages];
  if (references.length === 0) return;
  await revalidateTrustedWorkspaceScopeInTransaction(
    connection,
    authority,
    "asset.read",
    now,
  );
  for (const reference of references) {
    const [rows] = await connection.execute<BrandLogoArtifactRow[]>(
      `SELECT artifact.id AS artifactId
       FROM asset
       INNER JOIN artifact
         ON artifact.workspace_id = asset.workspace_id
         AND artifact.asset_id = asset.id
       WHERE asset.workspace_id = ?
         AND asset.id = ?
         AND asset.lifecycle_status = 'active'
         AND artifact.id = ?
         AND artifact.availability_status = 'available'
         AND artifact.artifact_type LIKE 'image.%'
       LIMIT 1
       FOR SHARE`,
      [authority.workspaceId, reference.assetId, reference.artifactId],
    );
    if (!rows[0]) {
      return invalid(
        "brand.image_reference_unavailable",
        "One selected Brand image is no longer available in this Workspace.",
      );
    }
  }
}

async function insertPublishedImageReferences(
  connection: PoolConnection,
  workspaceId: string,
  brandKitRevisionId: string,
  logos: readonly BrandKitLogo[],
  referenceImages: readonly BrandKitReferenceImage[],
  now: Date,
): Promise<void> {
  for (const logo of logos) {
    await connection.execute<ResultSetHeader>(
      `INSERT INTO brand_kit_revision_artifact_reference (
         workspace_id,
         brand_kit_revision_id,
         reference_key,
         reference_role,
         asset_id,
         artifact_id,
         position,
         created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        workspaceId,
        brandKitRevisionId,
        logo.key,
        logo.role,
        logo.assetId,
        logo.artifactId,
        logo.position,
        now,
      ],
    );
  }
  for (const reference of referenceImages) {
    await connection.execute<ResultSetHeader>(
      `INSERT INTO brand_kit_revision_artifact_reference (
         workspace_id,
         brand_kit_revision_id,
         reference_key,
         reference_role,
         asset_id,
         artifact_id,
         position,
         created_at
       ) VALUES (?, ?, ?, 'reference', ?, ?, ?, ?)`,
      [
        workspaceId,
        brandKitRevisionId,
        reference.key,
        reference.assetId,
        reference.artifactId,
        100 + reference.position,
        now,
      ],
    );
  }
}

function auditContext(
  authority: TrustedWorkspaceScope,
  audit: BrandAuditContext,
): ControlPlaneAuditContext {
  return Object.freeze({
    auditEventId: audit.auditEventId,
    actorPrincipalId: authority.principalId,
    actorType: authority.principalType,
    authenticationRefType: authority.authenticationRefType,
    authenticationRefHash: audit.authenticationRefHash,
    authorityType: authority.authorityType,
    authorityId: authority.authorityId,
    authorityVersion: authority.authorityVersion,
    ...(audit.requestId ? { requestId: audit.requestId } : {}),
    ...(audit.traceId ? { traceId: audit.traceId } : {}),
  });
}

async function appendBrandAudit(
  connection: PoolConnection,
  options: {
    readonly authority: TrustedWorkspaceScope;
    readonly audit: BrandAuditContext;
    readonly now: Date;
  },
  event: {
    readonly eventType: string;
    readonly reason: string;
    readonly brandKitId: string;
    readonly details: Readonly<
      Record<string, string | number | boolean | null>
    >;
  },
): Promise<void> {
  await appendControlPlaneAuditEventInTransaction(
    connection,
    auditContext(options.authority, options.audit),
    {
      organizationId: options.authority.organizationId,
      workspaceId: options.authority.workspaceId,
      eventType: event.eventType,
      action: event.eventType,
      resourceType: "brand_kit",
      resourceId: event.brandKitId,
      outcome: "succeeded",
      decisionReasonCode: event.reason,
      severity: "info",
      authorizationDecision: Object.freeze({
        permission: "brand.manage",
        authorityVersion: options.authority.authorityVersion,
      }),
      details: Object.freeze(event.details),
      occurredAt: options.now,
    },
  );
}

export function createWorkspaceBrandStore(
  pool: Pool,
): WorkspaceBrandRepository {
  const store: WorkspaceBrandRepository = {
    list(authority, options) {
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          authority,
          "brand.read",
          options.now,
        );
        const [rows] = await connection.execute<BrandKitRow[]>(
          `${brandKitSelect}
           WHERE kit.workspace_id = ?
             AND kit.lifecycle_status = ?
           ORDER BY kit.default_marker DESC, kit.updated_at DESC, kit.id
           LIMIT 100`,
          [authority.workspaceId, options.lifecycleStatus],
        );
        return Object.freeze(rows.map(summaryFrom));
      });
    },

    getDraft(authority, brandKitId, now) {
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          authority,
          "brand.manage",
          now,
        );
        const row = await readBrandKit(
          connection,
          authority.workspaceId,
          brandKitId,
          false,
        );
        return row ? draftFrom(row) : undefined;
      });
    },

    getRevision(authority, brandKitId, brandKitRevisionId, now) {
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          authority,
          "brand.read",
          now,
        );
        const row = await readRevision(
          connection,
          authority.workspaceId,
          brandKitId,
          brandKitRevisionId,
        );
        return row ? revisionFrom(row) : undefined;
      });
    },

    listRevisions(authority, brandKitId, now) {
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          authority,
          "brand.read",
          now,
        );
        const kit = await readBrandKit(
          connection,
          authority.workspaceId,
          brandKitId,
          false,
        );
        if (!kit) {
          return invalid("brand.not_found", "Brand Kit was not found.");
        }
        const [rows] = await connection.execute<BrandKitRevisionRow[]>(
          `SELECT
             id,
             workspace_id AS workspaceId,
             brand_kit_id AS brandKitId,
             revision_number AS revisionNumber,
             schema_version AS schemaVersion,
             content_document AS contentDocument,
             content_digest AS contentDigest,
             publication_request_key AS publicationRequestKey,
             publication_request_hash AS publicationRequestHash,
             published_by_principal_id AS publishedByPrincipalId,
             published_at AS publishedAt
           FROM brand_kit_revision
           WHERE workspace_id = ?
             AND brand_kit_id = ?
           ORDER BY revision_number DESC
           LIMIT 50`,
          [authority.workspaceId, brandKitId],
        );
        return Object.freeze(
          rows.map((row) =>
            Object.freeze({
              id: row.id,
              revisionNumber: row.revisionNumber,
              publishedAt: new Date(row.publishedAt),
            }),
          ),
        );
      });
    },

    getDefaultRevision(authority, now) {
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          authority,
          "brand.read",
          now,
        );
        const [rows] = await connection.execute<BrandKitRevisionRow[]>(
          `SELECT
             revision.id,
             revision.workspace_id AS workspaceId,
             revision.brand_kit_id AS brandKitId,
             revision.revision_number AS revisionNumber,
             revision.schema_version AS schemaVersion,
             revision.content_document AS contentDocument,
             revision.content_digest AS contentDigest,
             revision.publication_request_key AS publicationRequestKey,
             revision.publication_request_hash AS publicationRequestHash,
             revision.published_by_principal_id AS publishedByPrincipalId,
             revision.published_at AS publishedAt
           FROM brand_kit AS kit
           INNER JOIN brand_kit_revision AS revision
             ON revision.workspace_id = kit.workspace_id
             AND revision.brand_kit_id = kit.id
             AND revision.id = kit.latest_published_revision_id
           WHERE kit.workspace_id = ?
             AND kit.default_marker = TRUE
             AND kit.lifecycle_status = 'active'
           LIMIT 1`,
          [authority.workspaceId],
        );
        return rows[0] ? revisionFrom(rows[0]) : undefined;
      });
    },

    create(options) {
      assertIdempotencyKey(options.idempotencyKey);
      const document = normalizeBrandKitDocument(options.document);
      const canonicalText = canonicalizeProviderValue(document);
      const contentDigest = digestProviderValue(document);
      const requestHash = digestProviderValue({ document });
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.authority,
          "brand.manage",
          options.now,
        );
        const [replayRows] = await connection.execute<BrandKitRow[]>(
          `${brandKitSelect}
           WHERE kit.workspace_id = ?
             AND kit.creation_request_key = ?
           LIMIT 1
           FOR UPDATE`,
          [options.authority.workspaceId, options.idempotencyKey],
        );
        const replay = replayRows[0];
        if (replay) {
          if (replay.creationRequestHash !== requestHash) {
            return invalid(
              "brand.idempotency_conflict",
              "Idempotency key is already bound to another Brand Kit request.",
            );
          }
          return Object.freeze({
            value: draftFrom(replay),
            replayed: true,
          });
        }
        await connection.execute<ResultSetHeader>(
          `INSERT INTO brand_kit (
             id, workspace_id, name, description, lifecycle_status,
             default_marker, latest_published_revision_id,
             creation_request_key, creation_request_hash, version,
             created_by_principal_id, updated_by_principal_id,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, 'active', NULL, NULL, ?, ?, 1, ?, ?, ?, ?)`,
          [
            options.brandKitId,
            options.authority.workspaceId,
            document.name,
            document.description ?? null,
            options.idempotencyKey,
            requestHash,
            options.actorPrincipalId,
            options.actorPrincipalId,
            options.now,
            options.now,
          ],
        );
        await connection.execute<ResultSetHeader>(
          `INSERT INTO brand_kit_draft (
             workspace_id, brand_kit_id, schema_version, content_document,
             content_digest, version, created_by_principal_id,
             updated_by_principal_id, created_at, updated_at
           ) VALUES (?, ?, 1, CAST(? AS JSON), ?, 1, ?, ?, ?, ?)`,
          [
            options.authority.workspaceId,
            options.brandKitId,
            canonicalText,
            contentDigest,
            options.actorPrincipalId,
            options.actorPrincipalId,
            options.now,
            options.now,
          ],
        );
        await appendBrandAudit(connection, options, {
          eventType: "brand.kit.created",
          reason: "brand_kit_created",
          brandKitId: options.brandKitId,
          details: Object.freeze({
            draftVersion: 1,
            contentDigest,
            colorCount: document.colors.length,
            logoCount: document.logos.length,
            textStyleCount: document.textStyles.length,
          }),
        });
        const created = await readBrandKit(
          connection,
          options.authority.workspaceId,
          options.brandKitId,
          false,
        );
        if (!created) {
          return invalid(
            "brand.integrity_violation",
            "Created Brand Kit cannot be read back.",
          );
        }
        return Object.freeze({ value: draftFrom(created), replayed: false });
      });
    },

    updateDraft(options) {
      const document = normalizeBrandKitDocument(options.document);
      const canonicalText = canonicalizeProviderValue(document);
      const contentDigest = digestProviderValue(document);
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.authority,
          "brand.manage",
          options.now,
        );
        await validateImageReferences(
          connection,
          options.authority,
          document.logos,
          document.referenceImages,
          options.now,
        );
        const current = await readBrandKit(
          connection,
          options.authority.workspaceId,
          options.brandKitId,
          true,
        );
        if (!current) {
          return invalid("brand.not_found", "Brand Kit was not found.");
        }
        if (current.lifecycleStatus !== "active") {
          return invalid(
            "brand.invalid_state",
            "Archived Brand Kit cannot be edited.",
          );
        }
        if (current.draftVersion !== options.expectedDraftVersion) {
          return invalid(
            "brand.version_conflict",
            "Brand Kit Draft changed before this operation.",
          );
        }
        if (current.draftContentDigest === contentDigest) {
          return draftFrom(current);
        }
        const [draftUpdate] = await connection.execute<ResultSetHeader>(
          `UPDATE brand_kit_draft
           SET content_document = CAST(? AS JSON),
               content_digest = ?,
               version = version + 1,
               updated_by_principal_id = ?,
               updated_at = ?
           WHERE workspace_id = ?
             AND brand_kit_id = ?
             AND version = ?`,
          [
            canonicalText,
            contentDigest,
            options.actorPrincipalId,
            options.now,
            options.authority.workspaceId,
            options.brandKitId,
            current.draftVersion,
          ],
        );
        if (draftUpdate.affectedRows !== 1) {
          return invalid(
            "brand.version_conflict",
            "Brand Kit Draft changed before this operation.",
          );
        }
        const [kitUpdate] = await connection.execute<ResultSetHeader>(
          `UPDATE brand_kit
           SET name = ?,
               description = ?,
               version = version + 1,
               updated_by_principal_id = ?,
               updated_at = ?
           WHERE workspace_id = ?
             AND id = ?
             AND version = ?`,
          [
            document.name,
            document.description ?? null,
            options.actorPrincipalId,
            options.now,
            options.authority.workspaceId,
            options.brandKitId,
            current.version,
          ],
        );
        if (kitUpdate.affectedRows !== 1) {
          return invalid(
            "brand.version_conflict",
            "Brand Kit changed before this operation.",
          );
        }
        await appendBrandAudit(connection, options, {
          eventType: "brand.draft.updated",
          reason: "brand_draft_updated",
          brandKitId: options.brandKitId,
          details: Object.freeze({
            previousDraftVersion: current.draftVersion,
            nextDraftVersion: current.draftVersion + 1,
            contentDigest,
            colorCount: document.colors.length,
            logoCount: document.logos.length,
            textStyleCount: document.textStyles.length,
          }),
        });
        const updated = await readBrandKit(
          connection,
          options.authority.workspaceId,
          options.brandKitId,
          false,
        );
        if (!updated) {
          return invalid(
            "brand.integrity_violation",
            "Updated Brand Kit cannot be read back.",
          );
        }
        return draftFrom(updated);
      });
    },

    publish(options) {
      assertIdempotencyKey(options.idempotencyKey);
      const requestHash = digestProviderValue({
        brandKitId: options.brandKitId,
        expectedDraftVersion: options.expectedDraftVersion,
      });
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.authority,
          "brand.manage",
          options.now,
        );
        const [replayRows] = await connection.execute<BrandKitRevisionRow[]>(
          `SELECT
             id, workspace_id AS workspaceId, brand_kit_id AS brandKitId,
             revision_number AS revisionNumber, schema_version AS schemaVersion,
             content_document AS contentDocument, content_digest AS contentDigest,
             publication_request_key AS publicationRequestKey,
             publication_request_hash AS publicationRequestHash,
             published_by_principal_id AS publishedByPrincipalId,
             published_at AS publishedAt
           FROM brand_kit_revision
           WHERE workspace_id = ?
             AND publication_request_key = ?
           LIMIT 1
           FOR UPDATE`,
          [options.authority.workspaceId, options.idempotencyKey],
        );
        const replay = replayRows[0];
        if (replay) {
          if (
            replay.publicationRequestHash !== requestHash ||
            replay.brandKitId !== options.brandKitId
          ) {
            return invalid(
              "brand.idempotency_conflict",
              "Idempotency key is already bound to another Brand publication.",
            );
          }
          return Object.freeze({ value: revisionFrom(replay), replayed: true });
        }
        const current = await readBrandKit(
          connection,
          options.authority.workspaceId,
          options.brandKitId,
          true,
        );
        if (!current) {
          return invalid("brand.not_found", "Brand Kit was not found.");
        }
        if (current.lifecycleStatus !== "active") {
          return invalid(
            "brand.invalid_state",
            "Archived Brand Kit cannot be published.",
          );
        }
        if (current.draftVersion !== options.expectedDraftVersion) {
          return invalid(
            "brand.version_conflict",
            "Brand Kit Draft changed before publication.",
          );
        }
        const document = parseDocument(current.draftDocument);
        if (
          document.colors.length < 1 ||
          document.logos.length < 1 ||
          document.textStyles.length < 1
        ) {
          return invalid(
            "brand.publication_blocked",
            "Brand Kit must contain a logo, color, and text style before publication.",
          );
        }
        await validateImageReferences(
          connection,
          options.authority,
          document.logos,
          document.referenceImages,
          options.now,
        );
        if (
          current.latestPublishedRevisionId &&
          current.draftContentDigest ===
            (
              await readRevision(
                connection,
                options.authority.workspaceId,
                options.brandKitId,
                current.latestPublishedRevisionId,
              )
            )?.contentDigest
        ) {
          return invalid(
            "brand.no_changes",
            "Brand Kit Draft does not contain unpublished changes.",
          );
        }
        const revisionNumber = (current.latestRevisionNumber ?? 0) + 1;
        const canonicalText = canonicalizeProviderValue(document);
        await connection.execute<ResultSetHeader>(
          `INSERT INTO brand_kit_revision (
             id, workspace_id, brand_kit_id, revision_number, schema_version,
             content_document, content_digest, publication_request_key,
             publication_request_hash, published_by_principal_id, published_at
           ) VALUES (?, ?, ?, ?, 1, CAST(? AS JSON), ?, ?, ?, ?, ?)`,
          [
            options.brandKitRevisionId,
            options.authority.workspaceId,
            options.brandKitId,
            revisionNumber,
            canonicalText,
            current.draftContentDigest,
            options.idempotencyKey,
            requestHash,
            options.actorPrincipalId,
            options.now,
          ],
        );
        await insertPublishedImageReferences(
          connection,
          options.authority.workspaceId,
          options.brandKitRevisionId,
          document.logos,
          document.referenceImages,
          options.now,
        );
        const [kitUpdate] = await connection.execute<ResultSetHeader>(
          `UPDATE brand_kit
           SET latest_published_revision_id = ?,
               version = version + 1,
               updated_by_principal_id = ?,
               updated_at = ?
           WHERE workspace_id = ?
             AND id = ?
             AND version = ?`,
          [
            options.brandKitRevisionId,
            options.actorPrincipalId,
            options.now,
            options.authority.workspaceId,
            options.brandKitId,
            current.version,
          ],
        );
        if (kitUpdate.affectedRows !== 1) {
          return invalid(
            "brand.version_conflict",
            "Brand Kit changed before publication.",
          );
        }
        await appendBrandAudit(connection, options, {
          eventType: "brand.revision.published",
          reason: "brand_revision_published",
          brandKitId: options.brandKitId,
          details: Object.freeze({
            brandKitRevisionId: options.brandKitRevisionId,
            revisionNumber,
            sourceDraftVersion: current.draftVersion,
            contentDigest: current.draftContentDigest,
            colorCount: document.colors.length,
            logoCount: document.logos.length,
            textStyleCount: document.textStyles.length,
          }),
        });
        const published = await readRevision(
          connection,
          options.authority.workspaceId,
          options.brandKitId,
          options.brandKitRevisionId,
        );
        if (!published) {
          return invalid(
            "brand.integrity_violation",
            "Published Brand Kit Revision cannot be read back.",
          );
        }
        return Object.freeze({
          value: revisionFrom(published),
          replayed: false,
        });
      });
    },

    setDefault(options) {
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.authority,
          "brand.manage",
          options.now,
        );
        await connection.execute<BrandKitLockRow[]>(
          `SELECT id
           FROM brand_kit
           WHERE workspace_id = ?
           ORDER BY id
           FOR UPDATE`,
          [options.authority.workspaceId],
        );
        const current = await readBrandKit(
          connection,
          options.authority.workspaceId,
          options.brandKitId,
          false,
        );
        if (!current) {
          return invalid("brand.not_found", "Brand Kit was not found.");
        }
        if (current.lifecycleStatus !== "active") {
          return invalid(
            "brand.invalid_state",
            "Archived Brand Kit cannot become the default.",
          );
        }
        if (!current.latestPublishedRevisionId) {
          return invalid(
            "brand.publication_required",
            "Brand Kit must be published before becoming the default.",
          );
        }
        if (current.version !== options.expectedBrandKitVersion) {
          return invalid(
            "brand.version_conflict",
            "Brand Kit changed before this operation.",
          );
        }
        if (current.isDefault === 1) {
          return summaryFrom(current);
        }
        await connection.execute<ResultSetHeader>(
          `UPDATE brand_kit
           SET default_marker = NULL,
               version = version + 1,
               updated_by_principal_id = ?,
               updated_at = ?
           WHERE workspace_id = ?
             AND default_marker = TRUE`,
          [
            options.actorPrincipalId,
            options.now,
            options.authority.workspaceId,
          ],
        );
        const [targetUpdate] = await connection.execute<ResultSetHeader>(
          `UPDATE brand_kit
           SET default_marker = TRUE,
               version = version + 1,
               updated_by_principal_id = ?,
               updated_at = ?
           WHERE workspace_id = ?
             AND id = ?
             AND version = ?
             AND lifecycle_status = 'active'
             AND latest_published_revision_id IS NOT NULL`,
          [
            options.actorPrincipalId,
            options.now,
            options.authority.workspaceId,
            options.brandKitId,
            current.version,
          ],
        );
        if (targetUpdate.affectedRows !== 1) {
          return invalid(
            "brand.version_conflict",
            "Brand Kit changed before this operation.",
          );
        }
        await appendBrandAudit(connection, options, {
          eventType: "brand.kit.default_changed",
          reason: "brand_default_changed",
          brandKitId: options.brandKitId,
          details: Object.freeze({
            brandKitRevisionId: current.latestPublishedRevisionId,
            previousBrandKitVersion: current.version,
            nextBrandKitVersion: current.version + 1,
          }),
        });
        const updated = await readBrandKit(
          connection,
          options.authority.workspaceId,
          options.brandKitId,
          false,
        );
        if (!updated) {
          return invalid(
            "brand.integrity_violation",
            "Default Brand Kit cannot be read back.",
          );
        }
        return summaryFrom(updated);
      });
    },
  };
  return Object.freeze(store);
}
