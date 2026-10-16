import type { TrustedInstanceAdministratorScope } from "@kanvas/application";
import type { RuntimeConfigurationDocument } from "@kanvas/contracts/api";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { ulid } from "ulid";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import {
  createDisposableIntegrationPool,
  disposableIntegrationDatabase,
} from "./disposable-integration-database.js";
import {
  createRuntimeConfigurationStore,
  type RuntimeConfigurationStore,
} from "../src/runtime/runtime-configuration-store.js";

describe.skipIf(!disposableIntegrationDatabase)(
  "runtime configuration lifecycle on MySQL",
  () => {
    let pool: Pool;
    let store: RuntimeConfigurationStore;
    const instanceId = `runtime-config-${ulid()}`;
    const admin = ulid();
    const now = new Date();
    const authority: TrustedInstanceAdministratorScope = {
      instanceId,
      principalId: admin,
      principalType: "human",
      authenticationRefType: "session",
      authenticationRefId: "test",
      authorityType: "instance_administrator",
      authorityId: admin,
      authorityVersion: 1,
      authorizationModelVersion: 1,
      trusted: true,
    };
    const audit = () => ({
      auditEventId: ulid(),
      authenticationRefHash: `sha256:${"a".repeat(64)}`,
    });
    const document: RuntimeConfigurationDocument = {
      activated: false,
      agent: {
        maximumModelCalls: 50,
        maximumToolCalls: 100,
        timeoutSeconds: 600,
      },
      downloads: {
        defaults: {
          enabled: true,
          allowedOrigins: ["https://results.example"],
        },
        providers: [],
      },
    };
    beforeAll(async () => {
      pool = createDisposableIntegrationPool(4);
      store = createRuntimeConfigurationStore(pool, instanceId);
      await pool.execute(
        "INSERT INTO instance_runtime_state (instance_id,state,execution_generation,state_version,reason,changed_by,changed_at) VALUES (?,'ACTIVE',1,1,'test','test',?)",
        [instanceId, now],
      );
      await pool.execute(
        "INSERT INTO principal (id,principal_type,status,version,created_at,updated_at) VALUES (?,'human','active',1,?,?)",
        [admin, now, now],
      );
      await pool.execute(
        "INSERT INTO human_principal (principal_id,auth_subject_id,created_at) VALUES (?,?,?)",
        [admin, ulid(), now],
      );
      await pool.execute(
        "INSERT INTO instance_administrator (principal_id,status,version,created_at,updated_at) VALUES (?,'active',1,?,?)",
        [admin, now, now],
      );
    });
    afterAll(async () => {
      await pool?.end();
    });
    it("imports without activation, publishes atomically, restores as a new audited version", async () => {
      expect(await store.read()).toBeNull();
      await store.publish(
        authority,
        { document, expectedVersion: 0, reason: "import" },
        audit(),
      );
      await expect(
        store.publish(
          authority,
          { document, expectedVersion: 0, reason: "stale" },
          audit(),
        ),
      ).rejects.toMatchObject({ code: "runtime_configuration.conflict" });
      const activated = { ...document, activated: true };
      await store.publish(
        authority,
        { document: activated, expectedVersion: 1, reason: "activate" },
        audit(),
      );
      await store.publish(
        authority,
        {
          document: {
            ...activated,
            agent: { ...activated.agent, maximumModelCalls: 40 },
          },
          expectedVersion: 2,
          reason: "reduce",
        },
        audit(),
      );
      const restored = await store.restore(
        authority,
        { expectedVersion: 3, sourceVersion: 2, reason: "restore" },
        audit(),
      );
      expect(restored).toMatchObject({
        version: 4,
        restoredFromVersion: 2,
        document: { agent: { maximumModelCalls: 50 } },
      });
      await expect(
        store.restore(
          authority,
          {
            expectedVersion: 4,
            sourceVersion: 1,
            reason: "unsafe legacy fallback",
          },
          audit(),
        ),
      ).rejects.toMatchObject({ code: "runtime_configuration.invalid" });
      expect((await store.history(authority)).items).toHaveLength(4);
      const [events] = await pool.execute<RowDataPacket[]>(
        "SELECT COUNT(*) AS count FROM audit_event WHERE actor_principal_id = ? AND resource_type = 'runtime_configuration'",
        [admin],
      );
      expect(Number(events[0]?.count)).toBe(4);
    });
    it("serializes concurrent publication and revalidates administrator authority", async () => {
      const results = await Promise.allSettled([
        store.publish(
          authority,
          {
            expectedVersion: 4,
            document: { ...document, activated: true },
            reason: "one",
          },
          audit(),
        ),
        store.publish(
          authority,
          {
            expectedVersion: 4,
            document: { ...document, activated: true },
            reason: "two",
          },
          audit(),
        ),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      await pool.execute(
        "UPDATE instance_administrator SET status='revoked',version=version+1 WHERE principal_id=?",
        [admin],
      );
      await expect(
        store.publish(
          authority,
          { expectedVersion: 5, document, reason: "revoked" },
          audit(),
        ),
      ).rejects.toBeDefined();
      await expect(store.history(authority)).rejects.toBeDefined();
    });
  },
);
