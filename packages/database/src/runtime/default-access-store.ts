import {
  authorizationModelVersion,
  type TrustedInstanceAdministratorScope,
} from "@kanvas/application";
import type {
  DefaultAccessPolicy,
  DefaultAccessStatus,
  DefaultAccessPreview,
  AppliedDefaultAccess,
} from "@kanvas/contracts/api";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { ulid } from "ulid";
import {
  appendAuditEventInTransaction,
  auditEventSchemaVersion,
} from "./audit-event-store.js";
import {
  inTransaction,
  validateAuthority,
  requireCurrentAdministrator,
  InstanceAccessStoreError,
  type InstanceAccessAuditContext,
} from "./instance-access-store.js";

export const emptyDefaultAccessPolicy: DefaultAccessPolicy = {
  enabled: false,
  workspaceId: null,
  role: "operator",
  oidcProviderIds: [],
  verifiedDomains: [],
  version: 0,
};
const excluded: DefaultAccessStatus = {
  state: "excluded",
  reason: "not_eligible",
};
interface PolicyRow extends RowDataPacket {
  policy: DefaultAccessPolicy | string;
}
interface Enrollment extends RowDataPacket {
  source: string;
  providerId: string | null;
  policy: DefaultAccessPolicy | string;
  state: DefaultAccessStatus["state"];
  reason: DefaultAccessStatus["reason"];
}
interface Person extends RowDataPacket {
  principalId: string;
  authSubjectId: string;
  displayName: string;
  email: string;
  verified: number;
  status: string;
  version: number;
}
const parsePolicy = (
  value: DefaultAccessPolicy | string,
): DefaultAccessPolicy =>
  typeof value === "string"
    ? (JSON.parse(value) as DefaultAccessPolicy)
    : value;
function invalid(message: string): never {
  throw new InstanceAccessStoreError(
    "instance_access.invalid_argument",
    message,
  );
}
function conflict(): never {
  throw new InstanceAccessStoreError(
    "instance_access.concurrent_change",
    "Default access policy changed. Reload the preview.",
  );
}
export function normalizeDefaultAccessPolicy(
  policy: DefaultAccessPolicy,
): DefaultAccessPolicy {
  const domains = [
    ...new Set(
      policy.verifiedDomains.map((domain) => domain.trim().toLowerCase()),
    ),
  ].sort();
  if (
    domains.length > 20 ||
    domains.some(
      (domain) =>
        !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u.test(
          domain,
        ) || domain.length > 253,
    )
  )
    invalid("Use exact DNS domains, without @ or wildcards.");
  if (
    !["viewer", "operator", "editor"].includes(policy.role) ||
    typeof policy.enabled !== "boolean" ||
    !Number.isSafeInteger(policy.version) ||
    policy.version < 0
  )
    invalid("Invalid default access policy.");
  if (
    policy.workspaceId !== null &&
    !/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u.test(policy.workspaceId)
  )
    invalid("Invalid Workspace.");
  if (
    policy.oidcProviderIds.length > 20 ||
    policy.oidcProviderIds.some((id) => !/^[a-z][a-z0-9-]{0,63}$/u.test(id))
  )
    invalid("Invalid identity provider.");
  const oidcProviderIds = [...new Set(policy.oidcProviderIds)].sort();
  if (
    policy.enabled &&
    (!policy.workspaceId || !(domains.length || oidcProviderIds.length))
  )
    invalid("Choose a Workspace and at least one trusted identity condition.");
  return { ...policy, verifiedDomains: domains, oidcProviderIds };
}
export function defaultAccessIdentityMatches(
  policy: DefaultAccessPolicy,
  email: string,
  verified: boolean,
  providerId: string | null,
): boolean {
  if (!policy.enabled) return false;
  return (
    Boolean(
      providerId && verified && policy.oidcProviderIds.includes(providerId),
    ) ||
    (verified &&
      policy.verifiedDomains.includes(
        email.trim().toLowerCase().split("@")[1] ?? "",
      ))
  );
}
export interface DefaultAccessStore {
  readPolicy(): Promise<DefaultAccessPolicy>;
  updatePolicy(
    authority: TrustedInstanceAdministratorScope,
    policy: DefaultAccessPolicy,
    audit: InstanceAccessAuditContext,
  ): Promise<DefaultAccessPolicy>;
  recordRegistration(
    authSubjectId: string,
    source: "self" | "invitation" | "managed",
    providerId: string | null,
  ): Promise<void>;
  readStatus(authSubjectId: string): Promise<DefaultAccessStatus>;
  process(authSubjectId: string): Promise<DefaultAccessStatus>;
  preview(
    authority: TrustedInstanceAdministratorScope,
  ): Promise<DefaultAccessPreview>;
  apply(
    authority: TrustedInstanceAdministratorScope,
    expectedVersion: number,
    principalIds: readonly string[],
    audit: InstanceAccessAuditContext,
  ): Promise<AppliedDefaultAccess>;
}
export function createDefaultAccessStore(
  pool: Pool,
  instanceId: string,
): DefaultAccessStore {
  async function policy(
    connection: PoolConnection,
  ): Promise<DefaultAccessPolicy> {
    const [rows] = await connection.execute<PolicyRow[]>(
      "SELECT policy FROM instance_default_access_policy WHERE instance_id = ?",
      [instanceId],
    );
    return rows[0]
      ? parsePolicy(rows[0].policy)
      : { ...emptyDefaultAccessPolicy };
  }
  async function enrollment(
    connection: PoolConnection,
    subject: string,
    lock = true,
  ): Promise<Enrollment | undefined> {
    const [rows] = await connection.execute<Enrollment[]>(
      `SELECT source, provider_id AS providerId, policy_snapshot AS policy, state, reason FROM default_access_enrollment WHERE auth_subject_id = ? AND instance_id = ?${lock ? " FOR UPDATE" : ""}`,
      [subject, instanceId],
    );
    return rows[0];
  }
  async function person(
    connection: PoolConnection,
    subject: string,
  ): Promise<Person | undefined> {
    const [rows] = await connection.execute<Person[]>(
      `SELECT p.id AS principalId, h.auth_subject_id AS authSubjectId, u.name AS displayName, u.email, u.email_verified AS verified, p.status, p.version
   FROM principal p JOIN human_principal h ON h.principal_id = p.id JOIN auth_user u ON u.id = h.auth_subject_id WHERE h.auth_subject_id = ? FOR UPDATE`,
      [subject],
    );
    return rows[0];
  }
  async function eligible(
    connection: PoolConnection,
    p: Person,
    entry?: Enrollment,
  ): Promise<boolean> {
    if (
      p.status !== "active" ||
      p.version !== 1 ||
      (entry && entry.source !== "self") ||
      entry?.state === "granted"
    )
      return false;
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT id FROM workspace_membership WHERE principal_id = ?
   UNION ALL SELECT id FROM organization_membership WHERE principal_id = ? AND status <> 'active'
   UNION ALL SELECT id FROM invitation WHERE target_email_normalized = ? AND ? = 1 LIMIT 1`,
      [
        p.principalId,
        p.principalId,
        p.email.trim().toLowerCase(),
        entry ? 0 : 1,
      ],
    );
    return rows.length === 0;
  }
  async function audit(
    connection: PoolConnection,
    event: string,
    details: {
      [key: string]: string | number | boolean | null | readonly string[];
    },
    authority?: TrustedInstanceAdministratorScope,
    context?: InstanceAccessAuditContext,
  ): Promise<void> {
    const now = new Date();
    await appendAuditEventInTransaction(connection, {
      id: ulid(),
      schemaVersion: auditEventSchemaVersion,
      organizationId: null,
      workspaceId: null,
      actorPrincipalId: authority?.principalId ?? null,
      actorType: authority ? "human" : "system",
      authenticationRefType: authority ? "session" : "none",
      authenticationRefHash: context?.authenticationRefHash ?? null,
      authorityType: authority ? "instance_administrator" : "system",
      authorityId: authority?.authorityId ?? null,
      authorityVersion: authority?.authorityVersion ?? null,
      authorizationModelVersion,
      authorizationDecision: { action: event, instanceId, ...details },
      eventType: event,
      action: event,
      resourceType: "default_workspace_access",
      resourceId: null,
      outcome: details.state === "failed" ? "failed" : "succeeded",
      decisionReasonCode:
        typeof details.reason === "string"
          ? `default_access.${details.reason}`
          : "default_access.policy",
      severity: "info",
      requestId: context?.requestId ?? null,
      traceId: context?.traceId ?? null,
      details: { instanceId, ...details },
      occurredAt: now,
      recordedAt: now,
    });
  }
  async function setStatus(
    connection: PoolConnection,
    subject: string,
    status: DefaultAccessStatus,
    p: Person,
    snapshot: DefaultAccessPolicy,
    authority?: TrustedInstanceAdministratorScope,
    context?: InstanceAccessAuditContext,
  ): Promise<DefaultAccessStatus> {
    await connection.execute(
      "UPDATE default_access_enrollment SET state = ?, reason = ?, updated_at = ? WHERE auth_subject_id = ? AND instance_id = ?",
      [status.state, status.reason, new Date(), subject, instanceId],
    );
    await audit(
      connection,
      "instance.default_access.processed",
      {
        targetPrincipalId: p.principalId,
        policyVersion: snapshot.version,
        workspaceId: snapshot.workspaceId,
        role: snapshot.role,
        state: status.state,
        reason: status.reason,
      },
      authority,
      context,
    );
    return status;
  }
  async function grant(
    connection: PoolConnection,
    p: Person,
    entry: Enrollment,
    snapshot: DefaultAccessPolicy,
    authority?: TrustedInstanceAdministratorScope,
    context?: InstanceAccessAuditContext,
  ): Promise<DefaultAccessStatus> {
    if (!(await eligible(connection, p, entry)))
      return setStatus(
        connection,
        p.authSubjectId,
        excluded,
        p,
        snapshot,
        authority,
        context,
      );
    if (
      !defaultAccessIdentityMatches(
        snapshot,
        p.email,
        Boolean(p.verified),
        entry.providerId,
      )
    ) {
      const status: DefaultAccessStatus =
        !p.verified && snapshot.enabled
          ? { state: "pending", reason: "awaiting_verification" }
          : excluded;
      if (entry.state === status.state && entry.reason === status.reason)
        return status;
      return setStatus(
        connection,
        p.authSubjectId,
        status,
        p,
        snapshot,
        authority,
        context,
      );
    }
    const [spaces] = await connection.execute<RowDataPacket[]>(
      `SELECT w.organization_id AS organizationId FROM workspace w JOIN organization o ON o.id = w.organization_id WHERE w.id = ? AND w.status = 'active' AND o.status = 'active' FOR SHARE`,
      [snapshot.workspaceId],
    );
    const space = spaces[0];
    if (!space)
      return setStatus(
        connection,
        p.authSubjectId,
        { state: "failed", reason: "workspace_unavailable" },
        p,
        snapshot,
        authority,
        context,
      );
    const now = new Date();
    await connection.execute(
      `INSERT INTO organization_membership (id, organization_id, principal_id, role, status, version, created_at, updated_at)
   SELECT ?, ?, ?, 'member', 'active', 1, ?, ? WHERE NOT EXISTS (SELECT 1 FROM organization_membership WHERE organization_id = ? AND principal_id = ?)`,
      [
        ulid(),
        space.organizationId,
        p.principalId,
        now,
        now,
        space.organizationId,
        p.principalId,
      ],
    );
    await connection.execute(
      `INSERT INTO workspace_membership (id, organization_id, workspace_id, principal_id, role, status, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', 1, ?, ?)`,
      [
        ulid(),
        space.organizationId,
        snapshot.workspaceId,
        p.principalId,
        snapshot.role,
        now,
        now,
      ],
    );
    return setStatus(
      connection,
      p.authSubjectId,
      { state: "granted", reason: "assigned" },
      p,
      snapshot,
      authority,
      context,
    );
  }
  async function trusted(
    connection: PoolConnection,
    authority: TrustedInstanceAdministratorScope,
  ): Promise<void> {
    validateAuthority(authority, instanceId);
    await requireCurrentAdministrator(connection, authority);
  }
  return {
    readPolicy: () => inTransaction(pool, policy),
    updatePolicy: (authority, input, context) =>
      inTransaction(pool, async (connection) => {
        await trusted(connection, authority);
        // Serialize creation of the first policy as well as subsequent versions.
        await connection.execute(
          "SELECT instance_id FROM instance_runtime_state WHERE instance_id = ? FOR UPDATE",
          [instanceId],
        );
        const current = await policy(connection);
        if (current.version !== input.version) conflict();
        const next = normalizeDefaultAccessPolicy({
          ...input,
          version: current.version + 1,
        });
        if (next.enabled) {
          const [rows] = await connection.execute<RowDataPacket[]>(
            "SELECT w.id FROM workspace w JOIN organization o ON o.id = w.organization_id WHERE w.id = ? AND w.status = 'active' AND o.status = 'active' FOR SHARE",
            [next.workspaceId],
          );
          if (!rows.length) invalid("Choose an active Workspace.");
        }
        await connection.execute(
          `INSERT INTO instance_default_access_policy (instance_id, policy, version, updated_by_principal_id, updated_at) VALUES (?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE policy = VALUES(policy), version = VALUES(version), updated_by_principal_id = VALUES(updated_by_principal_id), updated_at = VALUES(updated_at)`,
          [
            instanceId,
            JSON.stringify(next),
            next.version,
            authority.principalId,
            new Date(),
          ],
        );
        await audit(
          connection,
          "instance.default_access.policy_updated",
          {
            policyVersion: next.version,
            enabled: next.enabled,
            workspaceId: next.workspaceId,
            role: next.role,
            trustedDomains: next.verifiedDomains,
            trustedProviders: next.oidcProviderIds,
          },
          authority,
          context,
        );
        return next;
      }),
    recordRegistration: (subject, source, providerId) =>
      inTransaction(pool, async (connection) => {
        const snapshot = await policy(connection);
        const status: DefaultAccessStatus =
          source === "self" && snapshot.enabled
            ? { state: "pending", reason: "awaiting_verification" }
            : excluded;
        await connection.execute(
          `INSERT INTO default_access_enrollment (auth_subject_id, instance_id, source, provider_id, policy_snapshot, state, reason, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE auth_subject_id = VALUES(auth_subject_id)`,
          [
            subject,
            instanceId,
            source,
            providerId,
            JSON.stringify(snapshot),
            status.state,
            status.reason,
            new Date(),
            new Date(),
          ],
        );
      }),
    readStatus: (subject) =>
      inTransaction(pool, async (connection) => {
        const entry = await enrollment(connection, subject, false);
        return entry ? { state: entry.state, reason: entry.reason } : excluded;
      }),
    process: async (subject) => {
      try {
        return await inTransaction(pool, async (connection) => {
          const p = await person(connection, subject);
          const entry = await enrollment(connection, subject);
          if (!p || !entry) return excluded;
          if (entry.state === "granted" || entry.state === "excluded")
            return { state: entry.state, reason: entry.reason };
          return grant(connection, p, entry, parsePolicy(entry.policy));
        });
      } catch {
        const failed = {
          state: "failed",
          reason: "temporary_failure",
        } as const;
        try {
          await inTransaction(pool, async (connection) => {
            const p = await person(connection, subject);
            const entry = await enrollment(connection, subject);
            if (
              p &&
              entry &&
              entry.state !== "granted" &&
              entry.state !== "excluded"
            )
              await setStatus(
                connection,
                subject,
                failed,
                p,
                parsePolicy(entry.policy),
              );
          });
        } catch {
          /* Preserve the durable pending record when the database is unavailable. */
        }
        return failed;
      }
    },
    preview: (authority) =>
      inTransaction(pool, async (connection) => {
        await trusted(connection, authority);
        const current = await policy(connection);
        const [people] = await connection.execute<
          (Person &
            RowDataPacket & {
              source: string | null;
              providerId: string | null;
              allocationState: DefaultAccessStatus["state"] | null;
              allocationReason: DefaultAccessStatus["reason"] | null;
              targetWorkspaceName: string | null;
              hasMembership: number | string;
              hasInactiveOrganization: number | string;
              hasInvitation: number | string;
              providers: string | string[] | null;
            })[]
        >(
          `SELECT p.id AS principalId, h.auth_subject_id AS authSubjectId,
          u.name AS displayName, u.email, u.email_verified AS verified, p.status, p.version,
          e.source, e.provider_id AS providerId, e.state AS allocationState, e.reason AS allocationReason,
          w.name AS targetWorkspaceName,
          EXISTS(SELECT 1 FROM workspace_membership m WHERE m.principal_id=p.id) AS hasMembership,
          EXISTS(SELECT 1 FROM organization_membership m WHERE m.principal_id=p.id AND m.status<>'active') AS hasInactiveOrganization,
          EXISTS(SELECT 1 FROM invitation i WHERE i.target_email_normalized=u.email) AS hasInvitation,
          (SELECT JSON_ARRAYAGG(a.provider_id) FROM auth_account a WHERE a.user_id=u.id) AS providers
          FROM principal p JOIN human_principal h ON h.principal_id=p.id
          JOIN auth_user u ON u.id=h.auth_subject_id
          LEFT JOIN default_access_enrollment e ON e.auth_subject_id=u.id AND e.instance_id=?
          LEFT JOIN workspace w ON w.id=JSON_UNQUOTE(JSON_EXTRACT(e.policy_snapshot,'$.workspaceId'))
          ORDER BY p.created_at,p.id`,
          [instanceId],
        );
        const candidates: DefaultAccessPreview["candidates"] = [];
        const failures: DefaultAccessPreview["failures"] = [];
        for (const p of people) {
          if (
            p.allocationState === "failed" ||
            (p.allocationState === "pending" && p.verified)
          ) {
            failures.push({
              principalId: p.principalId,
              displayName: p.displayName,
              email: p.email,
              workspaceName: p.targetWorkspaceName,
              reason:
                p.allocationState === "pending"
                  ? "temporary_failure"
                  : (p.allocationReason ?? "temporary_failure"),
            });
          }
          if (
            p.status !== "active" ||
            p.version !== 1 ||
            Number(p.hasMembership) !== 0 ||
            Number(p.hasInactiveOrganization) !== 0 ||
            (p.source && p.source !== "self") ||
            (!p.source && Number(p.hasInvitation) !== 0) ||
            p.allocationState === "granted" ||
            p.allocationState === "pending" ||
            p.allocationState === "failed"
          )
            continue;
          const providers =
            typeof p.providers === "string"
              ? (JSON.parse(p.providers) as string[])
              : (p.providers ?? []);
          if (
            defaultAccessIdentityMatches(
              current,
              p.email,
              Boolean(p.verified),
              p.providerId,
            ) ||
            (!p.source &&
              providers.some((provider) =>
                defaultAccessIdentityMatches(
                  current,
                  p.email,
                  Boolean(p.verified),
                  provider,
                ),
              ))
          ) {
            candidates.push({
              principalId: p.principalId,
              displayName: p.displayName,
              email: p.email,
            });
          }
        }
        return { policy: current, candidates, failures };
      }),
    apply: (authority, expectedVersion, ids, context) =>
      inTransaction(pool, async (connection) => {
        await trusted(connection, authority);
        if (
          !ids.length ||
          ids.length > 100 ||
          new Set(ids).size !== ids.length ||
          ids.some((id) => !/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u.test(id))
        )
          invalid("Choose 1 to 100 distinct accounts.");
        await connection.execute(
          "SELECT instance_id FROM instance_runtime_state WHERE instance_id = ? FOR SHARE",
          [instanceId],
        );
        const current = await policy(connection);
        if (!current.enabled || current.version !== expectedVersion) conflict();
        const results: AppliedDefaultAccess["results"] = [];
        for (const id of [...ids].sort()) {
          const [rows] = await connection.execute<RowDataPacket[]>(
            "SELECT auth_subject_id AS subject FROM human_principal WHERE principal_id = ?",
            [id],
          );
          const subject = rows[0]?.subject as string | undefined;
          if (!subject) {
            results.push({ principalId: id, ...excluded });
            continue;
          }
          const p = await person(connection, subject);
          const entry = await enrollment(connection, subject);
          if (
            !p ||
            entry?.state === "pending" ||
            entry?.state === "failed" ||
            !(await eligible(connection, p, entry))
          ) {
            results.push({ principalId: id, ...excluded });
            continue;
          }
          const [accounts] = await connection.execute<RowDataPacket[]>(
            "SELECT provider_id AS providerId FROM auth_account WHERE user_id = ?",
            [subject],
          );
          const providerId =
            entry?.providerId ??
            (!entry
              ? (accounts.find((a) =>
                  current.oidcProviderIds.includes(String(a.providerId)),
                )?.providerId as string | undefined)
              : undefined) ??
            null;
          if (
            !defaultAccessIdentityMatches(
              current,
              p.email,
              Boolean(p.verified),
              providerId,
            )
          ) {
            results.push({ principalId: id, ...excluded });
            continue;
          }
          await connection.execute(
            `INSERT INTO default_access_enrollment (auth_subject_id, instance_id, source, provider_id, policy_snapshot, state, reason, created_at, updated_at) VALUES (?, ?, 'self', ?, ?, 'pending', 'awaiting_verification', ?, ?)
     ON DUPLICATE KEY UPDATE policy_snapshot = VALUES(policy_snapshot), state = 'pending', reason = 'awaiting_verification'`,
            [
              subject,
              instanceId,
              providerId,
              JSON.stringify(current),
              new Date(),
              new Date(),
            ],
          );
          const status = await grant(
            connection,
            p,
            {
              source: "self",
              providerId,
              policy: current,
              state: "pending",
              reason: "awaiting_verification",
            } as Enrollment,
            current,
            authority,
            context,
          );
          results.push({ principalId: id, ...status });
        }
        return { results };
      }),
  };
}
