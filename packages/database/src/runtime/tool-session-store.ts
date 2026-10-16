import {
  appendAuditEventInTransaction,
  auditEventSchemaVersion,
} from "./audit-event-store.js";
import { createHash } from "node:crypto";
import type {
  TrustedInstanceAdministratorScope,
  TrustedWorkspaceScope,
} from "@kanvas/application";
import { htmlToolPolicyVersion, type ToolSession } from "@kanvas/contracts/api";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { ulid } from "ulid";
import { revalidateInstanceAdministratorInTransaction } from "./instance-access-store.js";
import { revalidateTrustedWorkspaceScopeInTransaction } from "./authorization-store.js";
import { digestProviderValue } from "./provider-value-digest.js";
import { SiteToolStoreError } from "./site-tool-store.js";

export type ToolSessionActor =
  | { kind: "use"; scope: TrustedWorkspaceScope }
  | { kind: "preview"; authority: TrustedInstanceAdministratorScope };
export interface ToolSessionRunContext {
  readonly sessionId: string;
  readonly requestKey: string;
}
export interface ToolSessionStore {
  create(
    actor: ToolSessionActor,
    toolId: string,
    revisionId: string,
    key: string,
  ): Promise<ToolSession>;
  get(actor: ToolSessionActor, sessionId: string): Promise<ToolSession>;
  document(actor: ToolSessionActor, sessionId: string): Promise<Buffer>;
  close(actor: ToolSessionActor, sessionId: string): Promise<ToolSession>;
  assertRun(
    actor: ToolSessionActor,
    sessionId: string,
    runId: string,
  ): Promise<void>;
}
function fail(
  message: string,
  code: SiteToolStoreError["code"] = "not_ready",
): never {
  throw new SiteToolStoreError(code, message);
}
function json<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}
function authority(actor: ToolSessionActor) {
  return actor.kind === "use" ? actor.scope : actor.authority;
}
export function toolSessionAuthenticationHash(reference: string): string {
  return createHash("sha256")
    .update("kanvas:tool-session:v1\0")
    .update(reference)
    .digest("hex");
}
interface SessionRow extends RowDataPacket {
  id: string;
  tool_id: string;
  revision_id: string;
  revision_digest: string;
  execution_epoch: number;
  current_epoch: number;
  deleted_at: Date | null;
  session_kind: "use" | "preview";
  state: string;
  maximum_runs: number;
  expires_at: Date;
  policy_version: string;
  allowed_contract_revision_ids: unknown;
  current_digest: string;
  check_status: string;
  check_policy_version: string | null;
  revision_status: string;
  current_draft_id: string | null;
  published_revision_id: string | null;
  usage_status: string;
}
async function revalidate(
  c: PoolConnection,
  actor: ToolSessionActor,
  instanceId: string,
  now: Date,
): Promise<void> {
  if (actor.kind === "preview")
    return revalidateInstanceAdministratorInTransaction(
      c,
      actor.authority,
      instanceId,
    );
  if (
    actor.scope.principalType !== "human" ||
    actor.scope.authenticationRefType !== "session"
  )
    fail("Tool sessions require a browser user.", "not_found");
  await revalidateTrustedWorkspaceScopeInTransaction(
    c,
    actor.scope,
    "workspace.read",
    now,
  );
}
async function lockInstance(
  c: PoolConnection,
  instanceId: string,
  write = false,
): Promise<void> {
  const [rows] = await c.execute<RowDataPacket[]>(
    `SELECT instance_id FROM instance_runtime_state WHERE instance_id=? ${write ? "FOR UPDATE" : "FOR SHARE"}`,
    [instanceId],
  );
  if (!rows.length) fail("Site is unavailable.", "not_found");
}
async function load(
  c: PoolConnection,
  actor: ToolSessionActor,
  instanceId: string,
  sessionId: string,
  lock = false,
): Promise<SessionRow> {
  if (!/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(sessionId))
    fail("Tool session is unavailable.", "not_found");
  const identity = authority(actor);
  const [rows] = await c.execute<SessionRow[]>(
    `SELECT session.*, tool.execution_epoch AS current_epoch, tool.deleted_at, tool.usage_status, tool.current_draft_id, tool.published_revision_id,
       revision.revision_digest AS current_digest, revision.check_status, revision.check_policy_version, revision.lifecycle_status AS revision_status
     FROM site_tool_session AS session
     INNER JOIN site_tool AS tool ON tool.instance_id=session.instance_id AND tool.id=session.tool_id
     INNER JOIN site_tool_revision AS revision ON revision.instance_id=session.instance_id AND revision.tool_id=session.tool_id AND revision.id=session.revision_id
     WHERE session.instance_id=? AND session.id=? AND session.principal_id=? AND session.authentication_ref_hash=?
       AND session.session_kind=? AND session.workspace_id <=> ? ${lock ? "FOR UPDATE" : ""}`,
    [
      instanceId,
      sessionId,
      identity.principalId,
      toolSessionAuthenticationHash(identity.authenticationRefId),
      actor.kind,
      actor.kind === "use" ? actor.scope.workspaceId : null,
    ],
  );
  return rows[0] ?? fail("Tool session is unavailable.", "not_found");
}
function unavailable(row: SessionRow, now: Date): string | null {
  if (row.state !== "active") return "closed";
  if (row.deleted_at) return "deleted";
  if (row.expires_at.getTime() <= now.getTime()) return "expired";
  if (
    row.policy_version !== htmlToolPolicyVersion ||
    row.check_policy_version !== htmlToolPolicyVersion
  )
    return "policy_changed";
  if (row.current_epoch !== row.execution_epoch) return "availability_changed";
  if (
    row.revision_digest !== row.current_digest ||
    row.check_status !== "passed"
  )
    return "revision_changed";
  if (
    row.session_kind === "use" &&
    (row.usage_status !== "enabled" || row.revision_status !== "published")
  )
    return "disabled";
  if (
    row.session_kind === "preview" &&
    row.current_draft_id !== row.revision_id &&
    row.published_revision_id !== row.revision_id
  )
    return "preview_replaced";
  return null;
}
async function sessionFrom(
  c: PoolConnection,
  row: SessionRow,
  now: Date,
): Promise<ToolSession> {
  const [runs] = await c.execute<
    (RowDataPacket & { capability_run_id: string })[]
  >(
    "SELECT capability_run_id FROM site_tool_session_run WHERE session_id=? ORDER BY created_at, capability_run_id LIMIT 10",
    [row.id],
  );
  const reason = unavailable(row, now);
  return {
    id: row.id,
    toolId: row.tool_id,
    revisionId: row.revision_id,
    revisionDigest: row.revision_digest,
    kind: row.session_kind,
    available: reason === null,
    unavailableReason: reason,
    expiresAt: row.expires_at.toISOString(),
    allowedContractRevisionIds: json<string[]>(
      row.allowed_contract_revision_ids,
    ),
    maximumRuns: row.maximum_runs,
    runIds: runs.map((r) => r.capability_run_id),
  };
}

/** Called inside createDirect's transaction before any run or dispatch is written. */
export async function authorizeToolSessionRunInTransaction(
  c: PoolConnection,
  instanceId: string,
  scope: TrustedWorkspaceScope,
  context: ToolSessionRunContext,
  contractRevisionId: string,
  now: Date,
): Promise<void> {
  if (!/^[A-Za-z0-9-]{1,80}$/.test(context.requestKey))
    fail("Invalid tool request identity.", "invalid");
  await lockInstance(c, instanceId);
  const row = await load(
    c,
    { kind: "use", scope },
    instanceId,
    context.sessionId,
    true,
  );
  const reason = unavailable(row, now);
  if (reason) fail(`Tool session is unavailable: ${reason}.`);
  if (
    !json<string[]>(row.allowed_contract_revision_ids).includes(
      contractRevisionId,
    )
  )
    fail("This capability was not granted to the tool.");
  const [runs] = await c.execute<RowDataPacket[]>(
    "SELECT request_key FROM site_tool_session_run WHERE session_id=?",
    [row.id],
  );
  if (
    !runs.some((r) => r.request_key === context.requestKey) &&
    runs.length >= row.maximum_runs
  )
    fail("This tool session has reached its execution limit.", "limit");
}

async function auditSession(
  c: PoolConnection,
  actor: ToolSessionActor,
  row: SessionRow,
  action: "opened" | "closed",
  time: Date,
): Promise<void> {
  const identity = authority(actor);
  await appendAuditEventInTransaction(c, {
    id: ulid(),
    schemaVersion: auditEventSchemaVersion,
    organizationId: actor.kind === "use" ? actor.scope.organizationId : null,
    workspaceId: actor.kind === "use" ? actor.scope.workspaceId : null,
    actorPrincipalId: identity.principalId,
    actorType: "human",
    authenticationRefType: "session",
    authenticationRefHash: `sha256:${toolSessionAuthenticationHash(identity.authenticationRefId)}`,
    authorityType: identity.authorityType,
    authorityId: identity.authorityId,
    authorityVersion: identity.authorityVersion,
    authorizationModelVersion: identity.authorizationModelVersion,
    authorizationDecision: {
      action: `tool_usage.${action}`,
      toolId: row.tool_id,
      revisionId: row.revision_id,
      kind: actor.kind,
    },
    eventType: `tool_usage.${action}`,
    action: `tool_usage.${action}`,
    resourceType: "tool_usage",
    resourceId: row.id,
    outcome: "succeeded",
    decisionReasonCode: "tool_usage.authorized",
    severity: "info",
    requestId: null,
    traceId: null,
    details: {
      toolId: row.tool_id,
      revisionId: row.revision_id,
      maximumRuns: row.maximum_runs,
    },
    occurredAt: time,
    recordedAt: time,
  });
}

export function createToolSessionStore(
  pool: Pool,
  instanceId: string,
  now: () => Date = () => new Date(),
): ToolSessionStore {
  async function transaction<T>(
    actor: ToolSessionActor,
    write: boolean,
    action: (c: PoolConnection, time: Date) => Promise<T>,
  ): Promise<T> {
    const c = await pool.getConnection();
    try {
      await c.beginTransaction();
      const time = now();
      await revalidate(c, actor, instanceId, time);
      await lockInstance(c, instanceId, write);
      const result = await action(c, time);
      await c.commit();
      return result;
    } catch (error) {
      await c.rollback();
      throw error;
    } finally {
      c.release();
    }
  }
  return {
    create(actor, toolId, revisionId, key) {
      if (!/^[A-Za-z0-9:_-]{1,160}$/.test(key))
        fail("A bounded operation key is required.", "invalid");
      const identity = authority(actor);
      const requestHash = digestProviderValue({
        kind: "tool-session.create",
        mode: actor.kind,
        toolId,
        revisionId,
        principalId: identity.principalId,
        authenticationHash: toolSessionAuthenticationHash(
          identity.authenticationRefId,
        ),
        workspaceId: actor.kind === "use" ? actor.scope.workspaceId : null,
      });
      return transaction(actor, true, async (c, time) => {
        const [receipts] = await c.execute<RowDataPacket[]>(
          "SELECT request_hash, result FROM site_tool_operation WHERE instance_id=? AND idempotency_key=?",
          [instanceId, key],
        );
        if (receipts[0]) {
          if (receipts[0].request_hash !== requestHash)
            fail("Operation key was used for a different session.", "conflict");
          const receipt = json<{ sessionId: string }>(receipts[0].result);
          return sessionFrom(
            c,
            await load(c, actor, instanceId, receipt.sessionId),
            time,
          );
        }
        const [tools] = await c.execute<
          (RowDataPacket & {
            execution_epoch: number;
            usage_status: string;
            current_draft_id: string | null;
            published_revision_id: string | null;
          })[]
        >(
          "SELECT execution_epoch, usage_status, current_draft_id, published_revision_id FROM site_tool WHERE instance_id=? AND id=? AND deleted_at IS NULL",
          [instanceId, toolId],
        );
        const tool = tools[0] ?? fail("Tool is unavailable.", "not_found");
        if (actor.kind === "use" && tool.usage_status !== "enabled")
          fail("Tool has been disabled.");
        const selectable =
          actor.kind === "use"
            ? [tool.published_revision_id]
            : [tool.current_draft_id, tool.published_revision_id];
        if (!selectable.includes(revisionId))
          fail(
            "The tool version changed. Reload before opening it.",
            "conflict",
          );
        const [versions] = await c.execute<
          (RowDataPacket & {
            revision_digest: string;
            allowed_contract_revision_ids: unknown;
          })[]
        >(
          "SELECT revision_digest, allowed_contract_revision_ids FROM site_tool_revision WHERE instance_id=? AND tool_id=? AND id=? AND check_status='passed' AND check_policy_version=? AND lifecycle_status=?",
          [
            instanceId,
            toolId,
            revisionId,
            htmlToolPolicyVersion,
            revisionId === tool.published_revision_id ? "published" : "draft",
          ],
        );
        const version =
          versions[0] ?? fail("Check the selected revision before opening it.");
        const grants: string[] = [];
        if (actor.kind === "use") {
          for (const reference of json<string[]>(
            version.allowed_contract_revision_ids,
          )) {
            const [contracts] = await c.execute<
              (RowDataPacket & { id: string })[]
            >(
              `SELECT target.id FROM capability_contract_revision AS source
               INNER JOIN capability_contract_revision AS target ON target.contract_key=source.contract_key AND target.canonical_digest=source.canonical_digest
               WHERE source.id=? AND source.lifecycle_status='published' AND target.workspace_id=? AND target.lifecycle_status='published'
                 AND JSON_CONTAINS(target.supported_invokers, JSON_QUOTE('user'))=1 LIMIT 1 FOR SHARE`,
              [reference, actor.scope.workspaceId],
            );
            const contract =
              contracts[0] ??
              fail(
                "This Workspace does not provide a required tool capability.",
              );
            if (!grants.includes(contract.id)) grants.push(contract.id);
          }
          if (grants.length)
            await revalidateTrustedWorkspaceScopeInTransaction(
              c,
              actor.scope,
              "capability.run",
              time,
            );
        }
        const [counts] = await c.execute<RowDataPacket[]>(
          "SELECT COUNT(*) AS total FROM site_tool_session WHERE instance_id=? AND principal_id=? AND state='active' AND expires_at>?",
          [instanceId, identity.principalId, time],
        );
        if (Number(counts[0]?.total) >= 20)
          fail("Close an existing tool before opening another.", "limit");
        const sessionId = ulid();
        await c.execute(
          "INSERT INTO site_tool_session (id, instance_id, workspace_id, tool_id, revision_id, revision_digest, principal_id, authentication_ref_hash, execution_epoch, session_kind, maximum_runs, policy_version, allowed_contract_revision_ids, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [
            sessionId,
            instanceId,
            actor.kind === "use" ? actor.scope.workspaceId : null,
            toolId,
            revisionId,
            version.revision_digest,
            identity.principalId,
            toolSessionAuthenticationHash(identity.authenticationRefId),
            tool.execution_epoch,
            actor.kind,
            grants.length ? 3 : 0,
            htmlToolPolicyVersion,
            JSON.stringify(grants),
            time,
            new Date(time.getTime() + 60 * 60 * 1000),
          ],
        );
        await c.execute(
          "INSERT INTO site_tool_operation (instance_id, idempotency_key, request_hash, result, created_at) VALUES (?, ?, ?, ?, ?)",
          [instanceId, key, requestHash, JSON.stringify({ sessionId }), time],
        );
        const created = await load(c, actor, instanceId, sessionId);
        await auditSession(c, actor, created, "opened", time);
        return sessionFrom(c, created, time);
      });
    },
    get(actor, sessionId) {
      return transaction(actor, false, async (c, time) =>
        sessionFrom(c, await load(c, actor, instanceId, sessionId), time),
      );
    },
    document(actor, sessionId) {
      return transaction(actor, false, async (c, time) => {
        const row = await load(c, actor, instanceId, sessionId);
        if (unavailable(row, time))
          fail("The tool session is no longer available.");
        const [sources] = await c.execute<
          (RowDataPacket & { source_bytes: Buffer })[]
        >(
          "SELECT source_bytes FROM site_tool_revision WHERE instance_id=? AND id=?",
          [instanceId, row.revision_id],
        );
        return sources[0]!.source_bytes;
      });
    },
    close(actor, sessionId) {
      return transaction(actor, true, async (c, time) => {
        const row = await load(c, actor, instanceId, sessionId);
        await c.execute(
          "UPDATE site_tool_session SET state='closed' WHERE id=?",
          [row.id],
        );
        if (row.state !== "closed")
          await auditSession(c, actor, row, "closed", time);
        row.state = "closed";
        return sessionFrom(c, row, time);
      });
    },
    assertRun(actor, sessionId, runId) {
      return transaction(actor, false, async (c) => {
        const row = await load(c, actor, instanceId, sessionId);
        const [runs] = await c.execute<RowDataPacket[]>(
          "SELECT capability_run_id FROM site_tool_session_run WHERE session_id=? AND capability_run_id=?",
          [row.id, runId],
        );
        if (!runs.length)
          fail("This run does not belong to the tool session.", "not_found");
      });
    },
  };
}
