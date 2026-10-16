import { createDatabaseRuntime } from "../src/runtime/database-runtime.js";
import { loadDatabaseConnectionConfig } from "../src/configuration/database-config.js";
import type { TrustedInstanceAdministratorScope } from "@kanvas/application";
import type { DefaultAccessPolicy } from "@kanvas/contracts/api";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { ulid } from "ulid";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import {
  createDisposableIntegrationPool,
  disposableIntegrationDatabase,
} from "./disposable-integration-database.js";
import {
  createDefaultAccessStore,
  type DefaultAccessStore,
} from "../src/runtime/default-access-store.js";

describe.skipIf(!disposableIntegrationDatabase)(
  "default access lifecycle on MySQL",
  () => {
    let pool: Pool;
    let store: DefaultAccessStore;
    let policy: DefaultAccessPolicy;
    const instanceId = `default-access-${ulid()}`;
    const admin = ulid();
    const org = ulid();
    const workspace = ulid();
    const alternate = ulid();
    const now = new Date();
    const audit = {
      auditEventId: ulid(),
      authenticationRefHash: `sha256:${"a".repeat(64)}`,
    };
    const authority: TrustedInstanceAdministratorScope = {
      instanceId,
      principalId: admin,
      principalType: "human",
      authenticationRefType: "session",
      authenticationRefId: "test-session",
      authorityType: "instance_administrator",
      authorityId: admin,
      authorityVersion: 1,
      authorizationModelVersion: 1,
      trusted: true,
    };
    async function user(
      verified = true,
      domain = "company.test",
      principalId = ulid(),
    ) {
      const subject = ulid();
      const email = `${subject.toLowerCase()}@${domain}`;
      await pool.execute(
        "INSERT INTO auth_user (id,name,email,email_verified,created_at,updated_at) VALUES (?, 'New member', ?, ?, ?, ?)",
        [subject, email, verified, now, now],
      );
      await pool.execute(
        "INSERT INTO principal (id,principal_type,status,version,created_at,updated_at) VALUES (?, 'human','active',1,?,?)",
        [principalId, now, now],
      );
      await pool.execute(
        "INSERT INTO human_principal (principal_id,auth_subject_id,created_at) VALUES (?,?,?)",
        [principalId, subject, now],
      );
      return { subject, principalId, email };
    }
    async function memberships(id: string) {
      const [rows] = await pool.execute<RowDataPacket[]>(
        "SELECT workspace_id AS workspaceId, role, status FROM workspace_membership WHERE principal_id = ?",
        [id],
      );
      return rows;
    }
    beforeAll(async () => {
      pool = createDisposableIntegrationPool(8);
      store = createDefaultAccessStore(pool, instanceId);
      await pool.execute(
        "INSERT INTO instance_runtime_state (instance_id,state,execution_generation,state_version,reason,changed_by,changed_at) VALUES (?,'ACTIVE',1,1,'integration','test',?)",
        [instanceId, now],
      );
      await user(true, "admin.test", admin);
      await pool.execute(
        "INSERT INTO instance_administrator (principal_id,status,version,created_at,updated_at) VALUES (?,'active',1,?,?)",
        [admin, now, now],
      );
      await pool.execute(
        "INSERT INTO organization (id,slug,name,status,version,created_at,updated_at) VALUES (?,?,'Company','active',1,?,?)",
        [org, org.toLowerCase(), now, now],
      );
      for (const space of [workspace, alternate])
        await pool.execute(
          "INSERT INTO workspace (id,organization_id,slug,name,status,version,created_at,updated_at) VALUES (?,?,?,'Public','active',1,?,?)",
          [space, org, space.toLowerCase(), now, now],
        );
      expect(await store.readPolicy()).toMatchObject({
        enabled: false,
        role: "operator",
        version: 0,
      });
      policy = await store.updatePolicy(
        authority,
        {
          enabled: true,
          workspaceId: workspace,
          role: "operator",
          oidcProviderIds: ["company"],
          verifiedDomains: ["company.test"],
          version: 0,
        },
        audit,
      );
    }, 30000);
    afterAll(async () => {
      await pool?.end();
    });
    it("grants once under concurrent delivery and never reverses a downgrade or revocation", async () => {
      const u = await user();
      await store.recordRegistration(u.subject, "self", null);
      const statuses = await Promise.all([
        store.process(u.subject),
        store.process(u.subject),
      ]);
      expect(statuses.every((s) => s.state === "granted")).toBe(true);
      expect(await memberships(u.principalId)).toEqual([
        expect.objectContaining({
          workspaceId: workspace,
          role: "operator",
          status: "active",
        }),
      ]);
      await pool.execute(
        "UPDATE workspace_membership SET role='viewer', version=version+1 WHERE principal_id=?",
        [u.principalId],
      );
      await store.process(u.subject);
      expect((await memberships(u.principalId))[0]?.role).toBe("viewer");
      await pool.execute(
        "UPDATE workspace_membership SET status='revoked', version=version+1 WHERE principal_id=?",
        [u.principalId],
      );
      await store.process(u.subject);
      expect((await memberships(u.principalId))[0]?.status).toBe("revoked");
      expect(
        (await store.preview(authority)).candidates.some(
          (c) => c.principalId === u.principalId,
        ),
      ).toBe(false);
    });
    it("waits for proof; OIDC and verified domain independently qualify", async () => {
      const u = await user(false);
      await store.recordRegistration(u.subject, "self", null);
      expect(await store.process(u.subject)).toEqual({
        state: "pending",
        reason: "awaiting_verification",
      });
      expect(await memberships(u.principalId)).toHaveLength(0);
      await pool.execute("UPDATE auth_user SET email_verified=1 WHERE id=?", [
        u.subject,
      ]);
      expect((await store.process(u.subject)).state).toBe("granted");
      const oidc = await user(true, "outside.test");
      await store.recordRegistration(oidc.subject, "self", "company");
      expect((await store.process(oidc.subject)).state).toBe("granted");
      const other = await user(true, "outside.test");
      await store.recordRegistration(other.subject, "self", "other");
      expect((await store.process(other.subject)).state).toBe("excluded");
    });
    it("permanently excludes invited/setup accounts even if they match company identity", async () => {
      for (const source of ["invitation", "managed"] as const) {
        const u = await user();
        await store.recordRegistration(u.subject, source, "company");
        await store.recordRegistration(u.subject, "self", "company");
        expect((await store.process(u.subject)).state).toBe("excluded");
        expect(await memberships(u.principalId)).toHaveLength(0);
        expect(
          (await store.preview(authority)).candidates.some(
            (c) => c.principalId === u.principalId,
          ),
        ).toBe(false);
      }
    });
    it("retains the registration snapshot across policy changes and does not enroll old users on login", async () => {
      const u = await user();
      const old = await user();
      await store.recordRegistration(u.subject, "self", null);
      policy = await store.updatePolicy(
        authority,
        { ...policy, workspaceId: alternate, role: "viewer" },
        audit,
      );
      expect((await store.process(u.subject)).state).toBe("granted");
      expect((await memberships(u.principalId))[0]).toMatchObject({
        workspaceId: workspace,
        role: "operator",
      });
      expect((await store.process(old.subject)).state).toBe("excluded");
      expect(await memberships(old.principalId)).toHaveLength(0);
      policy = await store.updatePolicy(
        authority,
        { ...policy, enabled: false },
        audit,
      );
      const disabled = await user();
      await store.recordRegistration(disabled.subject, "self", null);
      policy = await store.updatePolicy(
        authority,
        { ...policy, enabled: true, workspaceId: workspace, role: "operator" },
        audit,
      );
      expect((await store.process(disabled.subject)).state).toBe("excluded");
    });
    it("keeps an unavailable destination recoverable and records the grant atomically", async () => {
      const u = await user();
      await store.recordRegistration(u.subject, "self", null);
      await pool.execute(
        "UPDATE workspace SET status='archived',version=version+1 WHERE id=?",
        [workspace],
      );
      expect(await store.process(u.subject)).toEqual({
        state: "failed",
        reason: "workspace_unavailable",
      });
      expect(await memberships(u.principalId)).toHaveLength(0);
      expect((await store.preview(authority)).failures).toContainEqual(
        expect.objectContaining({
          principalId: u.principalId,
          displayName: "New member",
          email: u.email,
          workspaceName: "Public",
          reason: "workspace_unavailable",
        }),
      );
      await pool.execute(
        "UPDATE workspace SET status='active',version=version+1 WHERE id=?",
        [workspace],
      );
      expect((await store.process(u.subject)).state).toBe("granted");
      const [events] = await pool.execute<RowDataPacket[]>(
        "SELECT details FROM audit_event WHERE event_type='instance.default_access.processed' AND JSON_UNQUOTE(JSON_EXTRACT(details,'$.targetPrincipalId'))=?",
        [u.principalId],
      );
      expect(events).toHaveLength(2);
    });
    it("requires a current preview version, rechecks candidates, and excludes previously suspended users", async () => {
      const legacy = await user();
      const suspended = await user();
      await pool.execute(
        "UPDATE principal SET status='active',version=3 WHERE id=?",
        [suspended.principalId],
      );
      const preview = await store.preview(authority);
      expect(preview.candidates.map((c) => c.principalId)).toContain(
        legacy.principalId,
      );
      expect(preview.candidates.map((c) => c.principalId)).not.toContain(
        suspended.principalId,
      );
      await expect(
        store.apply(authority, policy.version - 1, [legacy.principalId], audit),
      ).rejects.toMatchObject({ code: "instance_access.concurrent_change" });
      const result = await store.apply(
        authority,
        preview.policy.version,
        [legacy.principalId, suspended.principalId],
        audit,
      );
      expect(result.results).toContainEqual({
        principalId: legacy.principalId,
        state: "granted",
        reason: "assigned",
      });
      expect(result.results).toContainEqual({
        principalId: suspended.principalId,
        state: "excluded",
        reason: "not_eligible",
      });
      await store.apply(authority, policy.version, [legacy.principalId], audit);
      expect(await memberships(legacy.principalId)).toHaveLength(1);
    });
    it("rejects stale administrator authority and policy writes", async () => {
      await expect(
        store.updatePolicy(
          { ...authority, authorityVersion: 2 },
          policy,
          audit,
        ),
      ).rejects.toMatchObject({ code: "instance_access.forbidden" });
      await expect(
        store.updatePolicy(authority, { ...policy, version: 0 }, audit),
      ).rejects.toMatchObject({ code: "instance_access.concurrent_change" });
    });
    it("rolls back partial membership writes and safely retries a transient database failure", async () => {
      const u = await user();
      await store.recordRegistration(u.subject, "self", null);
      let failNextInsert = true;
      const faultPool = {
        getConnection: async () => {
          const connection = await pool.getConnection();
          const execute = connection.execute.bind(connection);
          return new Proxy(connection, {
            get(target, key): unknown {
              if (key === "execute")
                return (sql: string, values: unknown) => {
                  if (
                    failNextInsert &&
                    sql.includes("INSERT INTO workspace_membership")
                  ) {
                    failNextInsert = false;
                    throw new Error("simulated transient storage failure");
                  }
                  return Reflect.apply(execute, target, [
                    sql,
                    values,
                  ]) as unknown;
                };
              const value: unknown = Reflect.get(target, key);
              return typeof value === "function"
                ? (value.bind(target) as unknown)
                : value;
            },
          });
        },
      } as Pool;
      const faultStore = createDefaultAccessStore(faultPool, instanceId);
      expect(await faultStore.process(u.subject)).toEqual({
        state: "failed",
        reason: "temporary_failure",
      });
      expect(await store.readStatus(u.subject)).toEqual({
        state: "failed",
        reason: "temporary_failure",
      });
      expect(await memberships(u.principalId)).toHaveLength(0);
      const [organizations] = await pool.execute<RowDataPacket[]>(
        "SELECT id FROM organization_membership WHERE principal_id=?",
        [u.principalId],
      );
      expect(organizations).toHaveLength(0);
      expect((await store.process(u.subject)).state).toBe("granted");
      expect(await memberships(u.principalId)).toHaveLength(1);
    });
    it("keeps registration provenance scoped to the logical instance", async () => {
      const u = await user();
      const otherInstance = `other-${ulid()}`;
      await pool.execute(
        "INSERT INTO instance_runtime_state (instance_id,state,execution_generation,state_version,reason,changed_by,changed_at) VALUES (?,'ACTIVE',1,1,'integration','test',?)",
        [otherInstance, new Date()],
      );
      const other = createDefaultAccessStore(pool, otherInstance);
      await store.recordRegistration(u.subject, "self", null);
      await other.recordRegistration(u.subject, "managed", null);
      expect((await other.readStatus(u.subject)).state).toBe("excluded");
      expect((await store.process(u.subject)).state).toBe("granted");
      expect((await other.readStatus(u.subject)).state).toBe("excluded");
    });
    it("previews eligible users with the production BIGINT string configuration", async () => {
      const u = await user();
      const runtime = createDatabaseRuntime({
        connection: loadDatabaseConnectionConfig(process.env),
        instanceId,
        enabledExecutionTargets: ["worker"],
      });
      try {
        const preview = await runtime.defaultAccess.preview(authority);
        expect(
          preview.candidates.map((candidate) => candidate.principalId),
        ).toContain(u.principalId);
      } finally {
        await runtime.close();
      }
    });
  },
);
