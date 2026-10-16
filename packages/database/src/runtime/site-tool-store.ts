import { revalidateTrustedWorkspaceScopeInTransaction } from "./authorization-store.js";
import { createHash } from "node:crypto";
import type {
  TrustedWorkspaceScope,
  TrustedInstanceAdministratorScope,
} from "@kanvas/application";
import {
  isVisualIdentitySymbol,
  htmlToolMaximumBytes,
  htmlToolPolicyVersion,
  type ToolPresentation,
  type ToolSource,
  type ToolIntegrationCatalog,
  type ToolIntegrationQuery,
  type ToolCatalogueItem,
  type ToolUsageDetail,
  type SiteTool,
  type SiteToolDetail,
  type ToolRevision,
  type ToolCheckReport,
  type ConfigureToolDraftBody,
} from "@kanvas/contracts/api";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { ulid } from "ulid";
import { revalidateInstanceAdministratorInTransaction } from "./instance-access-store.js";
import {
  appendAuditEventInTransaction,
  auditEventSchemaVersion,
} from "./audit-event-store.js";
import { digestProviderValue } from "./provider-value-digest.js";

export class SiteToolStoreError extends Error {
  public constructor(
    public readonly code:
      "invalid" | "not_found" | "conflict" | "not_ready" | "limit",
    message: string,
  ) {
    super(message);
    this.name = "SiteToolStoreError";
  }
}
function fail(code: SiteToolStoreError["code"], message: string): never {
  throw new SiteToolStoreError(code, message);
}
const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const reservedSlugs = new Set([
  "new",
  "admin",
  "settings",
  "runtime",
  "sessions",
  "images",
  "manage",
]);
function assertId(id: string): void {
  if (!idPattern.test(id)) fail("invalid", "Invalid tool identifier.");
}
function sha(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
function json<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

interface ToolRow extends RowDataPacket {
  id: string;
  slug: string;
  display_name: string;
  summary: string;
  description_markdown: string;
  logo_image_id: string | null;
  visual_symbol: unknown;
  cover_image_id: string | null;
  category: string;
  tags: unknown;
  created_by_principal_id: string;
  usage_status: "enabled" | "disabled";
  current_draft_id: string | null;
  published_revision_id: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}
interface RevisionRow extends RowDataPacket {
  id: string;
  tool_id: string;
  revision_number: number | null;
  version_label: string;
  release_notes: string;
  source_filename: string;
  source_sha256: string;
  byte_size: number;
  allowed_contract_revision_ids: unknown;
  revision_digest: string;
  check_status: ToolRevision["checkStatus"];
  check_policy_version: string | null;
  check_result: unknown;
  lifecycle_status: ToolRevision["lifecycleStatus"];
  created_at: Date;
  published_at: Date | null;
}
function revision(row: RevisionRow): ToolRevision {
  return {
    id: row.id,
    toolId: row.tool_id,
    revisionNumber: row.revision_number,
    versionLabel: row.version_label,
    releaseNotes: row.release_notes,
    filename: row.source_filename,
    byteSize: row.byte_size,
    digest: row.revision_digest,
    allowedContractRevisionIds: json<string[]>(
      row.allowed_contract_revision_ids,
    ),
    checkStatus: row.check_status,
    check: json<ToolCheckReport | null>(row.check_result),
    lifecycleStatus: row.lifecycle_status,
    createdAt: row.created_at.toISOString(),
    publishedAt: row.published_at?.toISOString() ?? null,
  };
}
export type SiteToolCommand =
  | { kind: "create"; presentation: ToolPresentation }
  | {
      kind: "update";
      toolId: string;
      expectedVersion: number;
      presentation: ToolPresentation;
    }
  | {
      kind: "upload";
      toolId: string;
      expectedVersion: number;
      filename: string;
      bytes: Uint8Array;
    }
  | {
      kind: "configure";
      toolId: string;
      config: ConfigureToolDraftBody;
      expectedVersion: number;
    }
  | {
      kind: "check";
      toolId: string;
      expectedVersion: number;
    }
  | { kind: "delete"; toolId: string; expectedVersion: number }
  | { kind: "discard"; toolId: string; expectedVersion: number }
  | { kind: "publish"; toolId: string; expectedVersion: number }
  | {
      kind: "availability";
      toolId: string;
      expectedVersion: number;
      enabled: boolean;
    };
export interface SiteToolMutation {
  toolId: string;
  version: number;
}
export interface SiteToolStore {
  integrations(
    authority: TrustedInstanceAdministratorScope,
    query: ToolIntegrationQuery,
    locale: "zh-CN" | "en-US",
  ): Promise<ToolIntegrationCatalog>;
  catalogue(
    scope: TrustedWorkspaceScope,
  ): Promise<readonly ToolCatalogueItem[]>;
  usageDetail(
    scope: TrustedWorkspaceScope,
    slug: string,
  ): Promise<ToolUsageDetail>;
  list(
    authority: TrustedInstanceAdministratorScope,
  ): Promise<readonly SiteTool[]>;
  detail(
    authority: TrustedInstanceAdministratorScope,
    toolId: string,
  ): Promise<SiteToolDetail>;
  source(
    authority: TrustedInstanceAdministratorScope,
    toolId: string,
    revisionId?: string,
  ): Promise<ToolSource>;
  draft(
    authority: TrustedInstanceAdministratorScope,
    toolId: string,
  ): Promise<{ revision: ToolRevision; bytes: Buffer; version: number }>;
  mutate(
    authority: TrustedInstanceAdministratorScope,
    key: string,
    command: SiteToolCommand,
    inspect?: (input: {
      bytes: Buffer;
      filename: string;
      digest: string;
      now: Date;
    }) => ToolCheckReport,
  ): Promise<SiteToolMutation>;
}
export function createSiteToolStore(
  pool: Pool,
  options: { instanceId: string; now?: () => Date; nextId?: () => string },
): SiteToolStore {
  const nextId = options.nextId ?? ulid;
  const now = options.now ?? (() => new Date());
  async function transaction<T>(
    authority: TrustedInstanceAdministratorScope,
    write: boolean,
    action: (connection: PoolConnection) => Promise<T>,
  ): Promise<T> {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await revalidateInstanceAdministratorInTransaction(
        connection,
        authority,
        options.instanceId,
      );
      // Serializes site maintenance, including quotas and idempotent creates.
      const [site] = await connection.execute<RowDataPacket[]>(
        `SELECT instance_id FROM instance_runtime_state WHERE instance_id = ? ${write ? "FOR UPDATE" : "FOR SHARE"}`,
        [options.instanceId],
      );
      if (!site.length) fail("not_found", "Site does not exist.");
      const result = await action(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ER_DUP_ENTRY"
      )
        fail("conflict", "A tool with this slug already exists.");
      throw error;
    } finally {
      connection.release();
    }
  }
  async function loadTool(c: PoolConnection, toolId: string): Promise<ToolRow> {
    assertId(toolId);
    const [rows] = await c.execute<ToolRow[]>(
      "SELECT * FROM site_tool WHERE instance_id = ? AND id = ? AND deleted_at IS NULL",
      [options.instanceId, toolId],
    );
    return rows[0] ?? fail("not_found", "Tool not found.");
  }
  async function revisions(
    c: PoolConnection,
    toolId: string,
  ): Promise<RevisionRow[]> {
    const [rows] = await c.execute<RevisionRow[]>(
      "SELECT id, tool_id, revision_number, version_label, release_notes, source_filename, source_sha256, byte_size, allowed_contract_revision_ids, revision_digest, check_status, check_policy_version, check_result, lifecycle_status, created_at, published_at FROM site_tool_revision WHERE instance_id = ? AND tool_id = ? ORDER BY created_at DESC, id DESC LIMIT 100",
      [options.instanceId, toolId],
    );
    return rows;
  }
  async function detail(
    c: PoolConnection,
    row: ToolRow,
  ): Promise<SiteToolDetail> {
    const versions = (await revisions(c, row.id)).map(revision);
    const publicationState = row.published_revision_id ? "enabled" : "draft";
    return {
      tool: {
        id: row.id,
        slug: row.slug,
        displayName: row.display_name,
        summary: row.summary,
        descriptionMarkdown: row.description_markdown,
        logoImageId: row.logo_image_id,
        symbol:
          row.visual_symbol == null
            ? null
            : json<NonNullable<ToolPresentation["symbol"]>>(row.visual_symbol),
        coverImageId: row.cover_image_id,
        category: row.category,
        tags: json<string[]>(row.tags),
        createdByPrincipalId: row.created_by_principal_id,
        state: row.usage_status === "disabled" ? "disabled" : publicationState,
        version: row.version,
        draft: versions.find((v) => v.id === row.current_draft_id) ?? null,
        publishedRevision:
          versions.find((v) => v.id === row.published_revision_id) ?? null,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      },
      revisions: versions,
    };
  }
  async function presentation(
    c: PoolConnection,
    p: ToolPresentation,
  ): Promise<void> {
    if (p.symbol && (p.logoImageId || !isVisualIdentitySymbol(p.symbol)))
      fail("invalid", "Tool symbol is invalid or conflicts with an image.");
    if (
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(p.slug) ||
      p.slug.length < 3 ||
      p.slug.length > 80 ||
      reservedSlugs.has(p.slug) ||
      !p.displayName.trim() ||
      p.displayName.length > 160 ||
      p.summary.length > 600 ||
      p.descriptionMarkdown.length > 32768 ||
      p.category.length > 80 ||
      p.tags.length > 12 ||
      p.tags.some((t) => !t || t.length > 40)
    )
      fail("invalid", "Tool presentation is invalid.");
    for (const imageId of [p.logoImageId, p.coverImageId]) {
      if (!imageId) continue;
      assertId(imageId);
      const [rows] = await c.execute<RowDataPacket[]>(
        "SELECT id FROM site_tool_image WHERE instance_id = ? AND id = ? AND retired_at IS NULL",
        [options.instanceId, imageId],
      );
      if (!rows.length)
        fail("invalid", "Upload the image to this site before selecting it.");
    }
  }
  function presentationValues(p: ToolPresentation) {
    return [
      p.slug,
      p.displayName.trim(),
      p.summary,
      p.descriptionMarkdown,
      p.logoImageId,
      p.symbol ? JSON.stringify(p.symbol) : null,
      p.coverImageId,
      p.category,
      JSON.stringify(p.tags),
    ];
  }
  async function activeDraft(
    c: PoolConnection,
    tool: ToolRow,
  ): Promise<RevisionRow> {
    const rows = await revisions(c, tool.id);
    const row = rows.find(
      (r) => r.id === tool.current_draft_id && r.lifecycle_status === "draft",
    );
    return row ?? fail("not_ready", "Upload an HTML draft first.");
  }
  async function integrations(
    c: PoolConnection,
    ids: readonly string[],
  ): Promise<void> {
    if (ids.length > 32 || new Set(ids).size !== ids.length)
      fail("invalid", "Select at most 32 distinct integrations.");
    for (const contractId of ids) {
      assertId(contractId);
      const [rows] = await c.execute<RowDataPacket[]>(
        "SELECT supported_invokers FROM capability_contract_revision WHERE id = ? AND lifecycle_status = 'published' FOR SHARE",
        [contractId],
      );
      if (
        !rows[0] ||
        !json<string[]>(rows[0].supported_invokers).includes("user")
      )
        fail(
          "not_ready",
          "An integration is not published for user invocation.",
        );
    }
  }
  async function audit(
    c: PoolConnection,
    authority: TrustedInstanceAdministratorScope,
    command: SiteToolCommand,
    result: SiteToolMutation,
    time: Date,
  ) {
    await appendAuditEventInTransaction(c, {
      id: nextId(),
      schemaVersion: auditEventSchemaVersion,
      organizationId: null,
      workspaceId: null,
      actorPrincipalId: authority.principalId,
      actorType: "human",
      authenticationRefType: "session",
      authenticationRefHash: `sha256:${sha(Buffer.from(authority.authenticationRefId))}`,
      authorityType: "instance_administrator",
      authorityId: authority.authorityId,
      authorityVersion: authority.authorityVersion,
      authorizationModelVersion: authority.authorizationModelVersion,
      authorizationDecision: {
        action: `site_tool.${command.kind}`,
        instanceId: options.instanceId,
        authorityId: authority.authorityId,
      },
      eventType: `site_tool.${command.kind}`,
      action: `site_tool.${command.kind}`,
      resourceType: "site_tool",
      resourceId: result.toolId,
      outcome: "succeeded",
      decisionReasonCode: "instance_administrator.active",
      severity: "info",
      requestId: null,
      traceId: null,
      details: { version: result.version },
      occurredAt: time,
      recordedAt: time,
    });
  }
  async function userQuery(
    scope: TrustedWorkspaceScope,
    slug?: string,
  ): Promise<readonly ToolUsageDetail[]> {
    if (
      scope.principalType !== "human" ||
      scope.authenticationRefType !== "session"
    )
      fail("not_found", "Tools require a signed-in user.");
    const c = await pool.getConnection();
    try {
      await c.beginTransaction();
      await revalidateTrustedWorkspaceScopeInTransaction(
        c,
        scope,
        "workspace.read",
        now(),
      );
      const [rows] = await c.execute<(RowDataPacket & ToolUsageDetail)[]>(
        `SELECT tool.id, tool.slug, tool.display_name AS displayName, tool.logo_image_id AS logoImageId, tool.visual_symbol AS symbol, tool.cover_image_id AS coverImageId,
          tool.description_markdown AS descriptionMarkdown, published.id AS publishedRevisionId
         FROM site_tool AS tool INNER JOIN site_tool_revision AS published
           ON published.instance_id=tool.instance_id AND published.tool_id=tool.id AND published.id=tool.published_revision_id
         WHERE tool.instance_id=? AND tool.deleted_at IS NULL AND tool.usage_status='enabled' AND published.lifecycle_status='published'
           AND published.check_status='passed' AND published.check_policy_version=?
           ${slug === undefined ? "" : "AND tool.slug=?"}
         ORDER BY tool.display_name, tool.id LIMIT 200`,
        [
          options.instanceId,
          htmlToolPolicyVersion,
          ...(slug === undefined ? [] : [slug]),
        ],
      );
      await c.commit();
      return rows.map((row) => ({
        ...row,
        symbol:
          row.symbol == null
            ? null
            : json<NonNullable<ToolPresentation["symbol"]>>(row.symbol),
      }));
    } catch (error) {
      await c.rollback();
      throw error;
    } finally {
      c.release();
    }
  }
  return {
    integrations(authority, query, locale) {
      if (query.workspaceId) assertId(query.workspaceId);
      if ((query.query?.length ?? 0) > 120)
        fail("invalid", "Search text is too long.");
      return transaction(authority, false, async (c) => {
        const [rows] = await c.execute<
          (RowDataPacket & ToolIntegrationCatalog["items"][number])[]
        >(
          `SELECT contract.id AS contractRevisionId, workspace.id AS workspaceId, workspace.name AS workspaceName,
             definition.capability_key AS capabilityKey,
             COALESCE(JSON_UNQUOTE(JSON_EXTRACT(declaration.declaration, ?)), CONVERT(definition.capability_key USING utf8mb4) COLLATE utf8mb4_bin) AS displayName,
             contract.contract_key AS contractKey, contract.canonical_digest AS contractDigest, contract.revision
           FROM capability_definition AS definition
           INNER JOIN workspace ON workspace.id=definition.workspace_id AND workspace.status='active'
           INNER JOIN capability_contract_revision AS contract ON contract.workspace_id=definition.workspace_id AND contract.id=definition.current_contract_revision_id
           INNER JOIN capability_declaration_revision AS declaration ON declaration.workspace_id=definition.workspace_id AND declaration.id=definition.current_declaration_revision_id
           WHERE definition.lifecycle_status='active' AND contract.lifecycle_status='published' AND declaration.lifecycle_status='published'
             AND JSON_CONTAINS(contract.supported_invokers, JSON_QUOTE('user'))=1
             ${query.workspaceId ? "AND workspace.id=?" : ""}
             AND (LOCATE(?, definition.capability_key)>0 OR LOCATE(?, workspace.name)>0)
           ORDER BY workspace.name, definition.capability_key, contract.id LIMIT 201`,
          [
            `$.catalog.title."${locale === "en-US" ? "en-US" : "zh-CN"}"`,
            ...(query.workspaceId ? [query.workspaceId] : []),
            query.query ?? "",
            query.query ?? "",
          ],
        );
        return { items: rows.slice(0, 200), truncated: rows.length > 200 };
      });
    },
    async catalogue(scope) {
      return (await userQuery(scope)).map((row) => ({
        id: row.id,
        slug: row.slug,
        displayName: row.displayName,
        logoImageId: row.logoImageId,
        symbol: row.symbol ?? null,
        coverImageId: row.coverImageId,
      }));
    },
    async usageDetail(scope, slug) {
      return (
        (await userQuery(scope, slug))[0] ??
        fail("not_found", "This tool is unavailable.")
      );
    },
    list(authority) {
      return transaction(authority, false, async (c) => {
        const [rows] = await c.execute<ToolRow[]>(
          "SELECT * FROM site_tool WHERE instance_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC, id DESC LIMIT 200",
          [options.instanceId],
        );
        return Promise.all(
          rows.map(async (row) => (await detail(c, row)).tool),
        );
      });
    },
    detail(authority, toolId) {
      return transaction(authority, false, async (c) =>
        detail(c, await loadTool(c, toolId)),
      );
    },
    source(authority, toolId, revisionId) {
      return transaction(authority, false, async (c) => {
        const tool = await loadTool(c, toolId);
        const selected =
          revisionId ?? tool.current_draft_id ?? tool.published_revision_id;
        if (
          !selected ||
          (selected !== tool.current_draft_id &&
            selected !== tool.published_revision_id)
        )
          fail("not_found", "Current tool source is unavailable.");
        const [rows] = await c.execute<
          (RowDataPacket & { source_bytes: Buffer; source_filename: string })[]
        >(
          "SELECT source_bytes, source_filename FROM site_tool_revision WHERE instance_id=? AND tool_id=? AND id=?",
          [options.instanceId, toolId, selected],
        );
        const row = rows[0] ?? fail("not_found", "Tool source is unavailable.");
        return {
          revisionId: selected,
          filename: row.source_filename,
          content: row.source_bytes.toString("utf8"),
          version: tool.version,
        };
      });
    },
    draft(authority, toolId) {
      return transaction(authority, false, async (c) => {
        const tool = await loadTool(c, toolId);
        const row = await activeDraft(c, tool);
        const [sources] = await c.execute<
          (RowDataPacket & { source_bytes: Buffer })[]
        >(
          "SELECT source_bytes FROM site_tool_revision WHERE id = ? AND instance_id = ?",
          [row.id, options.instanceId],
        );
        return {
          revision: revision(row),
          bytes: sources[0]!.source_bytes,
          version: tool.version,
        };
      });
    },
    mutate(authority, key, command, inspect) {
      if (!/^[A-Za-z0-9:_-]{1,160}$/.test(key))
        fail("invalid", "A bounded idempotency key is required.");
      const requestHash = digestProviderValue({
        actor: authority.principalId,
        command:
          command.kind === "upload"
            ? { ...command, bytes: sha(command.bytes) }
            : command,
      });
      return transaction(authority, true, async (c) => {
        const [receipts] = await c.execute<RowDataPacket[]>(
          "SELECT request_hash, result FROM site_tool_operation WHERE instance_id = ? AND idempotency_key = ?",
          [options.instanceId, key],
        );
        if (receipts[0]) {
          if (receipts[0].request_hash !== requestHash)
            fail(
              "conflict",
              "Idempotency key was already used for a different operation.",
            );
          return json<SiteToolMutation>(receipts[0].result);
        }
        const time = now();
        let result: SiteToolMutation;
        if (command.kind === "create") {
          await presentation(c, command.presentation);
          const [count] = await c.execute<RowDataPacket[]>(
            "SELECT COUNT(*) AS total FROM site_tool WHERE instance_id = ?",
            [options.instanceId],
          );
          if (Number(count[0]?.total) >= 200)
            fail("limit", "This site has reached the 200-tool limit.");
          const toolId = nextId();
          await c.execute(
            "INSERT INTO site_tool (id, instance_id, slug, display_name, summary, description_markdown, logo_image_id, visual_symbol, cover_image_id, category, tags, created_by_principal_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
              toolId,
              options.instanceId,
              ...presentationValues(command.presentation),
              authority.principalId,
              time,
              time,
            ],
          );
          result = { toolId, version: 1 };
        } else {
          const tool = await loadTool(c, command.toolId);
          if (tool.version !== command.expectedVersion)
            fail("conflict", "The tool changed. Reload it before continuing.");
          if (command.kind === "update") {
            await presentation(c, command.presentation);
            if (
              tool.published_revision_id &&
              tool.slug !== command.presentation.slug
            )
              fail("conflict", "The slug is stable after first publication.");
            await c.execute(
              "UPDATE site_tool SET slug=?, display_name=?, summary=?, description_markdown=?, logo_image_id=?, visual_symbol=?, cover_image_id=?, category=?, tags=? WHERE id=? AND instance_id=?",
              [
                ...presentationValues(command.presentation),
                tool.id,
                options.instanceId,
              ],
            );
          } else if (command.kind === "delete") {
            if (tool.usage_status !== "disabled")
              fail("conflict", "Disable the tool before deleting it.");
            await c.execute(
              "UPDATE site_tool SET deleted_at=?, execution_epoch=execution_epoch+1 WHERE instance_id=? AND id=?",
              [time, options.instanceId, tool.id],
            );
          } else if (command.kind === "discard") {
            if (!tool.current_draft_id)
              fail("conflict", "There is no draft to discard.");
            await c.execute(
              "UPDATE site_tool SET current_draft_id=NULL WHERE instance_id=? AND id=?",
              [options.instanceId, tool.id],
            );
          } else if (command.kind === "upload") {
            if (
              !command.bytes.byteLength ||
              command.bytes.byteLength > htmlToolMaximumBytes ||
              !/\.html?$/i.test(command.filename) ||
              command.filename.length > 160
            )
              fail("invalid", "Upload a bounded HTML document.");
            const versions = await revisions(c, tool.id);
            if (versions.length >= 100)
              fail("limit", "This tool has reached the revision limit.");
            const revisionId = nextId();
            const sourceSha = sha(command.bytes);
            const digest = digestProviderValue({
              sourceSha256: sourceSha,
              allowedContractRevisionIds: [],
            });
            await c.execute(
              "INSERT INTO site_tool_revision (id, instance_id, tool_id, release_notes, source_filename, source_bytes, source_sha256, byte_size, allowed_contract_revision_ids, revision_digest, created_by_principal_id, created_at) VALUES (?, ?, ?, '', ?, ?, ?, ?, '[]', ?, ?, ?)",
              [
                revisionId,
                options.instanceId,
                tool.id,
                command.filename,
                Buffer.from(command.bytes),
                sourceSha,
                command.bytes.byteLength,
                digest,
                authority.principalId,
                time,
              ],
            );
            await c.execute(
              "UPDATE site_tool SET current_draft_id = ? WHERE id = ?",
              [revisionId, tool.id],
            );
          } else if (command.kind === "availability") {
            if (command.enabled) {
              const published = (await revisions(c, tool.id)).find(
                (r) => r.id === tool.published_revision_id,
              );
              if (
                !published ||
                published.check_policy_version !== htmlToolPolicyVersion ||
                published.check_status !== "passed"
              )
                fail(
                  "not_ready",
                  "A checked current publication is required to enable this tool.",
                );
              await integrations(
                c,
                json<string[]>(published.allowed_contract_revision_ids),
              );
            }
            await c.execute(
              "UPDATE site_tool SET usage_status = ?, execution_epoch = execution_epoch + 1 WHERE id = ?",
              [command.enabled ? "enabled" : "disabled", tool.id],
            );
          } else {
            const draft = await activeDraft(c, tool);
            if (command.kind === "configure") {
              const config = command.config;
              if (
                config.versionLabel.length > 80 ||
                config.releaseNotes.length > 8000
              )
                fail("invalid", "Revision labels or notes are too long.");
              await integrations(c, config.allowedContractRevisionIds);
              const allowed = [...config.allowedContractRevisionIds].sort();
              const digest = digestProviderValue({
                sourceSha256: draft.source_sha256,
                allowedContractRevisionIds: allowed,
              });
              await c.execute(
                "UPDATE site_tool_revision SET version_label=?, release_notes=?, allowed_contract_revision_ids=?, revision_digest=?, check_status='unchecked', check_policy_version=NULL, check_result=NULL WHERE id=?",
                [
                  config.versionLabel,
                  config.releaseNotes,
                  JSON.stringify(allowed),
                  digest,
                  draft.id,
                ],
              );
            } else if (command.kind === "check") {
              if (!inspect) fail("invalid", "Server inspection is required.");
              const [sources] = await c.execute<
                (RowDataPacket & { source_bytes: Buffer })[]
              >("SELECT source_bytes FROM site_tool_revision WHERE id=?", [
                draft.id,
              ]);
              const report = inspect({
                bytes: sources[0]!.source_bytes,
                filename: draft.source_filename,
                digest: draft.revision_digest,
                now: time,
              });
              if (
                report.checkedDigest !== draft.revision_digest ||
                report.policyVersion !== htmlToolPolicyVersion ||
                report.passed ===
                  report.issues.some((i) => i.severity === "error")
              )
                fail(
                  "conflict",
                  "The inspection does not match the current draft.",
                );
              await integrations(
                c,
                json<string[]>(draft.allowed_contract_revision_ids),
              );
              await c.execute(
                "UPDATE site_tool_revision SET check_status=?, check_policy_version=?, check_result=? WHERE id=?",
                [
                  report.passed ? "passed" : "failed",
                  htmlToolPolicyVersion,
                  JSON.stringify(report),
                  draft.id,
                ],
              );
            } else {
              if (
                draft.check_status !== "passed" ||
                draft.check_policy_version !== htmlToolPolicyVersion ||
                json<ToolCheckReport | null>(draft.check_result)
                  ?.checkedDigest !== draft.revision_digest
              )
                fail(
                  "not_ready",
                  "Check the current draft before publishing it.",
                );
              await integrations(
                c,
                json<string[]>(draft.allowed_contract_revision_ids),
              );
              const [numbers] = await c.execute<RowDataPacket[]>(
                "SELECT COALESCE(MAX(revision_number), 0) + 1 AS next_number FROM site_tool_revision WHERE instance_id=? AND tool_id=?",
                [options.instanceId, tool.id],
              );
              await c.execute(
                "UPDATE site_tool_revision SET lifecycle_status='published', revision_number=?, published_by_principal_id=?, published_at=? WHERE id=?",
                [
                  numbers[0]?.next_number,
                  authority.principalId,
                  time,
                  draft.id,
                ],
              );
              await c.execute(
                "UPDATE site_tool SET published_revision_id=?, current_draft_id=NULL WHERE id=?",
                [draft.id, tool.id],
              );
            }
          }
          await c.execute(
            "UPDATE site_tool SET version=version+1, updated_at=? WHERE id=?",
            [time, tool.id],
          );
          result = { toolId: tool.id, version: tool.version + 1 };
        }
        await audit(c, authority, command, result, time);
        await c.execute(
          "INSERT INTO site_tool_operation (instance_id, idempotency_key, request_hash, result, created_at) VALUES (?, ?, ?, ?, ?)",
          [options.instanceId, key, requestHash, JSON.stringify(result), time],
        );
        return result;
      });
    },
  };
}
