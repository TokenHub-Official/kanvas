import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, type Pool, type RowDataPacket } from "mysql2/promise";

import { loadDatabaseConnectionConfig } from "../src/configuration/database-config.js";
import { readMigrationInventory } from "../src/migrator/migration-inventory.js";
import type { ControlPlaneAuditContext } from "../src/runtime/control-plane-audit.js";
import {
  createPublicationGovernanceStore,
  type PublicationCheckKind,
} from "../src/runtime/publication-governance-store.js";
import { createDefaultPublicationValidationPort } from "../src/runtime/publication-validation.js";
import { digestProviderValue } from "../src/runtime/provider-value-digest.js";
import { insertCapabilityImplementationFixture } from "./capability-runtime-fixture.js";

const integrationEnabled =
  process.env.KANVAS_DATABASE_DISPOSABLE_INTEGRATION === "1";
const createdAt = new Date("2026-07-27T12:00:00.000Z");
const now = new Date("2026-07-28T12:00:00.000Z");
const id = (value: number): string => `01P${String(value).padStart(23, "0")}`;
const organizationId = id(1);
const workspaceId = id(2);
const principalId = id(3);
const workflowDraftId = id(4);
const workflowCandidateId = id(5);
const workflowRevisionId = id(6);
const skillDraftId = id(7);
const skillCandidateId = id(8);
const skillRevisionId = id(9);
const uploadId = id(10);
const storedObjectId = id(11);
const storageProfileId = id(12);
const workflowDefinitionId = id(13);
const capabilityContractRevisionId = id(190);
const capabilityImplementationRevisionId = id(191);
const adapterDefinitionId = id(192);
const adapterRevisionId = id(193);
const markdownSha = "a".repeat(64);
const checkKinds = Object.freeze<readonly PublicationCheckKind[]>([
  "schema",
  "resources",
  "security",
  "compatibility",
  "eval",
]);

interface CountRow extends RowDataPacket {
  readonly count: number | string;
}

interface WorkflowRevisionRow extends RowDataPacket {
  readonly topology: unknown;
  readonly presentation: unknown;
  readonly canonicalDigest: string;
}

function databaseName(): string {
  const name = `kanvas_publication_${String(process.pid)}_${String(Date.now())}`;
  if (!/^[a-z0-9_]{1,64}$/u.test(name)) {
    throw new Error("Disposable database name is not safe.");
  }
  return name;
}

function createAdminPool(): Pool {
  const socketPath = process.env.KANVAS_DATABASE_SOCKET?.trim();
  if (socketPath) {
    return createPool({
      socketPath,
      user: process.env.KANVAS_DATABASE_USER ?? "root",
      password: process.env.KANVAS_DATABASE_PASSWORD ?? "",
      connectionLimit: 2,
      multipleStatements: true,
      timezone: "Z",
      decimalNumbers: false,
    });
  }
  const config = loadDatabaseConnectionConfig(process.env);
  return createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    connectionLimit: 2,
    multipleStatements: true,
    timezone: "Z",
    decimalNumbers: false,
  });
}

function createTestPool(name: string): Pool {
  const socketPath = process.env.KANVAS_DATABASE_SOCKET?.trim();
  if (socketPath) {
    return createPool({
      socketPath,
      database: name,
      user: process.env.KANVAS_DATABASE_USER ?? "root",
      password: process.env.KANVAS_DATABASE_PASSWORD ?? "",
      connectionLimit: 6,
      timezone: "Z",
      decimalNumbers: false,
    });
  }
  const config = loadDatabaseConnectionConfig(process.env);
  return createPool({
    host: config.host,
    port: config.port,
    database: name,
    user: config.user,
    password: config.password,
    connectionLimit: 6,
    timezone: "Z",
    decimalNumbers: false,
  });
}

function audit(auditEventId: string): ControlPlaneAuditContext {
  return Object.freeze({
    auditEventId,
    actorPrincipalId: principalId,
    actorType: "human",
    authenticationRefType: "session",
    authenticationRefHash: digestProviderValue({
      session: "publication-integration",
    }),
    authorityType: "human_membership",
    authorityId: workspaceId,
    authorityVersion: 1,
  });
}

async function seedAuthorityAndResource(pool: Pool): Promise<void> {
  await pool.execute(
    `INSERT INTO organization (
       id, slug, name, status, version, created_at, updated_at
     )
     VALUES (?, 'publication-test-org', 'Publication Test',
             'active', 1, ?, ?)`,
    [organizationId, createdAt, createdAt],
  );
  await pool.execute(
    `INSERT INTO workspace (
       id, organization_id, slug, name, status, version,
       created_at, updated_at
     )
     VALUES (?, ?, 'publication-test', 'Publication Test',
             'active', 1, ?, ?)`,
    [workspaceId, organizationId, createdAt, createdAt],
  );
  await pool.execute(
    `INSERT INTO principal (
       id, principal_type, status, version, created_at, updated_at
     )
     VALUES (?, 'human', 'active', 1, ?, ?)`,
    [principalId, createdAt, createdAt],
  );
  await pool.execute(
    `INSERT INTO human_principal (
       principal_id, auth_subject_id, created_at
     )
     VALUES (?, 'publication-test-subject', ?)`,
    [principalId, createdAt],
  );
  await pool.execute(
    `INSERT INTO workflow_definition (
       id, workspace_id, workflow_key, display_name, description, category,
       lifecycle_status, creation_request_key, creation_request_hash, version,
       created_by_principal_id, updated_by_principal_id, created_at, updated_at
     )
     VALUES (?, ?, 'publication-probe', 'Publication Probe', NULL, NULL,
             'active', NULL, NULL, 1, ?, ?, ?, ?)`,
    [
      workflowDefinitionId,
      workspaceId,
      principalId,
      principalId,
      createdAt,
      createdAt,
    ],
  );
  await pool.execute(
    `INSERT INTO upload_session (
       id, workspace_id, attempt_id, purpose, output_role,
       output_index, storage_profile_id, container, object_key,
       upload_mode, write_protection_mode, state, version,
       expires_at, cleanup_eligible_at, cleanup_state,
       verified_size, verified_sha256, detected_media_type,
       verification_profile_version, committed_stored_object_id,
       created_at, updated_at, committed_at
     )
     VALUES (
       ?, ?, NULL, 'skill_package_import', NULL, NULL, ?,
       'publication-test', 'skill/SKILL.md', 'single_put',
       'conditional_create', 'verified', 1, ?, ?, 'none',
       128, ?, 'text/markdown', 'skill-profile-v1', NULL,
       ?, ?, NULL
     )`,
    [
      uploadId,
      workspaceId,
      storageProfileId,
      new Date("2026-07-29T12:00:00.000Z"),
      new Date("2026-07-30T12:00:00.000Z"),
      markdownSha,
      createdAt,
      createdAt,
    ],
  );
  await pool.execute(
    `INSERT INTO stored_object (
       id, workspace_id, created_from_upload_session_id,
       storage_profile_id, container, object_key, byte_size,
       sha256, media_type, delete_state, created_at
     )
     VALUES (?, ?, ?, ?, 'publication-test', 'skill/SKILL.md',
             128, ?, 'text/markdown', 'active', ?)`,
    [
      storedObjectId,
      workspaceId,
      uploadId,
      storageProfileId,
      markdownSha,
      createdAt,
    ],
  );
  await pool.execute(
    `UPDATE upload_session
     SET state = 'committed',
         committed_stored_object_id = ?,
         committed_at = ?,
         updated_at = ?,
         version = version + 1
     WHERE id = ?`,
    [storedObjectId, createdAt, createdAt, uploadId],
  );
}

describe.skipIf(!integrationEnabled)(
  "Workflow and Skill publication governance against disposable MySQL 8.0",
  () => {
    const disposableName = databaseName();
    let adminPool!: Pool;
    let pool!: Pool;

    beforeAll(async () => {
      adminPool = createAdminPool();
      await adminPool.query(
        `CREATE DATABASE \`${disposableName}\`
         CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
      );
      const inventory = await readMigrationInventory(
        resolve(import.meta.dirname, "../migrations"),
      );
      const connection = await adminPool.getConnection();
      try {
        await connection.query(`USE \`${disposableName}\``);
        for (const migration of inventory) {
          await connection.query(migration.sql);
        }
      } finally {
        connection.release();
      }
      pool = createTestPool(disposableName);
      await seedAuthorityAndResource(pool);
    }, 120_000);

    afterAll(async () => {
      if (pool) {
        await pool.end();
      }
      if (adminPool) {
        await adminPool.query(`DROP DATABASE IF EXISTS \`${disposableName}\``);
        await adminPool.end();
      }
    }, 30_000);

    it("freezes Candidates and publishes immutable Workflow and Skill Revisions", async () => {
      const store = createPublicationGovernanceStore(
        pool,
        createDefaultPublicationValidationPort(),
      );
      const workflowDocument = Object.freeze({
        schemaVersion: 1,
        topology: Object.freeze({
          schemaVersion: 1,
          key: "publication_probe",
          entryNodeKey: "prepare",
          limits: Object.freeze({
            maxNodeRuns: 10,
            timeoutMs: 60_000,
          }),
          nodes: Object.freeze([
            Object.freeze({
              key: "prepare",
              kind: "invoke",
              capability: Object.freeze({
                contractId: "publication.probe",
                revision: 1,
                canonicalDigest: digestProviderValue({
                  capability: "publication.probe",
                  revision: 1,
                }),
              }),
              input: Object.freeze({ source: "workflow_input" }),
              next: Object.freeze([]),
            }),
          ]),
          outputs: Object.freeze({}),
        }),
        inputSchema: Object.freeze({
          type: "object",
          additionalProperties: false,
        }),
        outputSchema: Object.freeze({
          type: "object",
          additionalProperties: false,
        }),
        presentation: Object.freeze({
          schemaVersion: 1,
          title: "商品海报",
          description: "根据商品素材生成推广图片。",
          category: "海报制作",
          tags: Object.freeze(["商品", "广告"]),
          availability: Object.freeze({
            standalone: true,
            canvas: true,
            directLink: true,
          }),
        }),
      });
      const workflowDraft = await store.saveDraft({
        draftId: workflowDraftId,
        workspaceId,
        subjectKind: "workflow",
        subjectKey: "publication-probe",
        contentDocument: workflowDocument,
        expectedVersion: 0,
        actorPrincipalId: principalId,
        now,
        audit: audit(id(100)),
      });
      const workflowCandidate = await store.submitCandidate({
        candidateId: workflowCandidateId,
        draftId: workflowDraftId,
        workspaceId,
        subjectKind: "workflow",
        expectedDraftVersion: workflowDraft.version,
        parserProfileVersion: "workflow-v1",
        actorPrincipalId: principalId,
        now,
        audit: audit(id(101)),
      });
      for (const [index, checkKind] of checkKinds.entries()) {
        await store.recordCheck({
          checkId: id(110 + index),
          candidateId: workflowCandidateId,
          workspaceId,
          checkKind,
          checkProfileVersion: `${checkKind}-v1`,
          outcome: "passed",
          evidenceSummary: Object.freeze({
            fixture: "publication-integration",
          }),
          expectedCandidateDigest: workflowCandidate.canonicalDigest,
          actorPrincipalId: principalId,
          now,
          audit: audit(id(120 + index)),
        });
      }
      await store.reviewCandidate({
        reviewDecisionId: id(130),
        candidateId: workflowCandidateId,
        workspaceId,
        decision: "approved",
        expectedCandidateDigest: workflowCandidate.canonicalDigest,
        actorPrincipalId: principalId,
        now,
        audit: audit(id(131)),
      });
      await store.saveDraft({
        draftId: workflowDraftId,
        workspaceId,
        subjectKind: "workflow",
        subjectKey: "publication-probe",
        contentDocument: {
          ...workflowDocument,
          topology: {
            ...workflowDocument.topology,
            key: "edited_after_review",
          },
        },
        expectedVersion: 1,
        actorPrincipalId: principalId,
        now: new Date(now.getTime() + 1),
        audit: audit(id(132)),
      });
      const workflowRevision = await store.publishWorkflow({
        candidateId: workflowCandidateId,
        workflowRevisionId,
        workspaceId,
        expectedCandidateDigest: workflowCandidate.canonicalDigest,
        actorPrincipalId: principalId,
        now: new Date(now.getTime() + 2),
        audit: audit(id(133)),
      });
      expect(workflowRevision).toMatchObject({
        revision: 1,
        runtimeStatus: "enabled",
        canonicalDigest: workflowCandidate.canonicalDigest,
      });
      const [workflowRows] = await pool.execute<WorkflowRevisionRow[]>(
        `SELECT
           topology,
           presentation,
           canonical_digest AS canonicalDigest
         FROM workflow_revision
         WHERE id = ?`,
        [workflowRevisionId],
      );
      expect(workflowRows[0]?.topology).toMatchObject({
        key: "publication_probe",
      });
      expect(workflowRows[0]?.presentation).toMatchObject({
        title: "商品海报",
        tags: ["商品", "广告"],
      });
      await expect(
        store.publishWorkflow({
          candidateId: workflowCandidateId,
          workflowRevisionId,
          workspaceId,
          expectedCandidateDigest: "sha256:" + "f".repeat(64),
          actorPrincipalId: principalId,
          now,
          audit: audit(id(134)),
        }),
      ).rejects.toMatchObject({ code: "publication.identity_conflict" });
      const [retainedWorkflowRows] = await pool.execute<WorkflowRevisionRow[]>(
        "SELECT topology, presentation, canonical_digest AS canonicalDigest FROM workflow_revision WHERE id = ?",
        [workflowRevisionId],
      );
      expect(retainedWorkflowRows).toEqual(workflowRows);

      const skillDocument = Object.freeze({
        schemaVersion: 1,
        manifest: Object.freeze({
          key: "publication-skill",
          title: "Publication Skill",
        }),
        resources: Object.freeze([
          Object.freeze({
            path: "SKILL.md",
            resourceKind: "instructions",
            storedObjectId,
            contentDigest: `sha256:${markdownSha}`,
            mediaType: "text/markdown",
            byteSize: 128,
          }),
        ]),
        workflowEntrypoints: Object.freeze([
          Object.freeze({
            entrypointKey: "default",
            workflowRevisionId,
          }),
        ]),
      });
      const skillDraft = await store.saveDraft({
        draftId: skillDraftId,
        workspaceId,
        subjectKind: "skill",
        subjectKey: "publication-skill",
        contentDocument: skillDocument,
        expectedVersion: 0,
        actorPrincipalId: principalId,
        now,
        audit: audit(id(140)),
      });
      const skillCandidate = await store.submitCandidate({
        candidateId: skillCandidateId,
        draftId: skillDraftId,
        workspaceId,
        subjectKind: "skill",
        expectedDraftVersion: skillDraft.version,
        parserProfileVersion: "kanvas-skill-v1",
        actorPrincipalId: principalId,
        now,
        audit: audit(id(141)),
      });
      // Every automatic check is required; a trial run is optional for Skills.
      const skillChecks = checkKinds.filter((kind) => kind !== "eval");
      for (const [index, checkKind] of skillChecks.entries()) {
        await expect(
          store.publishSkill({
            candidateId: skillCandidateId,
            skillRevisionId,
            workspaceId,
            expectedCandidateDigest: skillCandidate.canonicalDigest,
            actorPrincipalId: principalId,
            now,
            audit: audit(id(170)),
          }),
        ).rejects.toMatchObject({ code: "publication.checks_incomplete" });
        await store.recordCheck({
          checkId: id(150 + index),
          candidateId: skillCandidateId,
          workspaceId,
          checkKind,
          checkProfileVersion: `${checkKind}-v1`,
          outcome: "passed",
          evidenceSummary: Object.freeze({
            fixture: "publication-integration",
          }),
          expectedCandidateDigest: skillCandidate.canonicalDigest,
          actorPrincipalId: principalId,
          now,
          audit: audit(id(160 + index)),
        });
      }
      const skillRevision = await store.publishSkill({
        candidateId: skillCandidateId,
        skillRevisionId,
        workspaceId,
        expectedCandidateDigest: skillCandidate.canonicalDigest,
        actorPrincipalId: principalId,
        now: new Date(now.getTime() + 3),
        audit: audit(id(170)),
      });
      expect(skillRevision).toMatchObject({
        revision: 1,
        runtimeStatus: "enabled",
      });
      const [resourceCounts] = await pool.execute<CountRow[]>(
        `SELECT COUNT(*) AS count
         FROM skill_revision_resource
         WHERE skill_revision_id = ?`,
        [skillRevisionId],
      );
      const [entrypointCounts] = await pool.execute<CountRow[]>(
        `SELECT COUNT(*) AS count
         FROM skill_revision_workflow_entrypoint
         WHERE skill_revision_id = ?`,
        [skillRevisionId],
      );
      expect(Number(resourceCounts[0]?.count)).toBe(1);
      expect(Number(entrypointCounts[0]?.count)).toBe(1);

      const revoked = await store.changeRuntimeStatus({
        workspaceId,
        subjectKind: "workflow",
        revisionId: workflowRevisionId,
        expectedVersion: 1,
        runtimeStatus: "revoked",
        reasonCode: "security.test_revocation",
        actorPrincipalId: principalId,
        now: new Date(now.getTime() + 4),
        audit: audit(id(180)),
      });
      expect(revoked).toMatchObject({
        runtimeStatus: "revoked",
        version: 2,
      });
      await expect(
        store.changeRuntimeStatus({
          workspaceId,
          subjectKind: "workflow",
          revisionId: workflowRevisionId,
          expectedVersion: 2,
          runtimeStatus: "enabled",
          actorPrincipalId: principalId,
          now: new Date(now.getTime() + 5),
          audit: audit(id(181)),
        }),
      ).rejects.toMatchObject({
        code: "publication.lifecycle_conflict",
      });
      await expect(
        store.submitCandidate({
          candidateId: workflowCandidateId,
          draftId: workflowDraftId,
          workspaceId,
          subjectKind: "workflow",
          expectedDraftVersion: workflowDraft.version + 1,
          parserProfileVersion: "workflow-v1",
          actorPrincipalId: principalId,
          now,
          audit: audit(id(182)),
        }),
      ).rejects.toMatchObject({ code: "publication.identity_conflict" });
      const retainedDraft = await store.getDraft(
        workspaceId,
        "skill",
        skillDraftId,
      );
      if (!retainedDraft?.skillDefinitionId)
        throw new Error("Missing Skill definition");
      await pool.execute(
        "UPDATE skill_definition SET lifecycle_status = 'archived', usage_status = 'disabled', archived_at = ? WHERE workspace_id = ? AND id = ?",
        [now, workspaceId, retainedDraft.skillDefinitionId],
      );
      await expect(
        store.saveDraft({
          draftId: skillDraftId,
          workspaceId,
          subjectKind: "skill",
          subjectKey: "publication-skill",
          contentDocument: retainedDraft.contentDocument,
          expectedVersion: retainedDraft.version,
          actorPrincipalId: principalId,
          now,
          audit: audit(id(900)),
        }),
      ).rejects.toThrow("This Skill was deleted");
    }, 60_000);

    it("retains relational and value constraints without privileged triggers", async () => {
      await pool.execute(
        `INSERT INTO capability_contract_revision (
           id, workspace_id, contract_key, revision,
           lifecycle_status, canonical_digest, input_schema,
           output_schema, idempotency_mode, supported_invokers,
           created_at, published_at
         ) VALUES (
           ?, ?, 'image.foundation.probe', 1, 'published', ?,
           JSON_OBJECT('type', 'object'),
           JSON_OBJECT('type', 'object'), 'keyed',
           JSON_ARRAY('workflow'), ?, ?
         )`,
        [
          capabilityContractRevisionId,
          workspaceId,
          digestProviderValue({
            capability: "image.foundation.probe",
            revision: 1,
          }),
          createdAt,
          now,
        ],
      );
      await insertCapabilityImplementationFixture(pool, {
        workspaceId,
        contractRevisionId: capabilityContractRevisionId,
        adapterDefinitionId,
        adapterRevisionId,
        adapterKey: "foundation.probe",
        executionTarget: "worker",
        implementationId: capabilityImplementationRevisionId,
        implementationKey: "foundation.probe.worker",
        canonicalDigest: digestProviderValue({
          implementation: "foundation.probe.worker",
          revision: 1,
        }),
        configuration: { profile: "v1" },
        createdAt,
      });

      await expect(
        pool.execute(
          "UPDATE capability_contract_revision SET lifecycle_status = 'invalid' WHERE id = ?",
          [capabilityContractRevisionId],
        ),
      ).rejects.toMatchObject({ code: "ER_CHECK_CONSTRAINT_VIOLATED" });
      await expect(
        pool.execute(
          "UPDATE capability_implementation_revision SET contract_revision_id = ? WHERE id = ?",
          [id(999999), capabilityImplementationRevisionId],
        ),
      ).rejects.toMatchObject({ code: "ER_NO_REFERENCED_ROW_2" });
      await expect(
        pool.execute("DELETE FROM capability_contract_revision WHERE id = ?", [
          capabilityContractRevisionId,
        ]),
      ).rejects.toMatchObject({ code: "ER_ROW_IS_REFERENCED_2" });
    }, 30_000);
  },
);
