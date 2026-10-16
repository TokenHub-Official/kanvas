import { resolve } from "node:path";
import { createHash } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, type Pool, type RowDataPacket } from "mysql2/promise";

import { loadDatabaseConnectionConfig } from "../src/configuration/database-config.js";
import { readMigrationInventory } from "../src/migrator/migration-inventory.js";
import type { ControlPlaneAuditContext } from "../src/runtime/control-plane-audit.js";
import { createPublicationGovernanceStore } from "../src/runtime/publication-governance-store.js";
import { createDefaultPublicationValidationPort } from "../src/runtime/publication-validation.js";
import { digestProviderValue } from "../src/runtime/provider-value-digest.js";
import { createSkillPackageImportStore } from "../src/runtime/skill-package-import-store.js";
import type { ExtractedSkillPackageArchive } from "../src/runtime/skill-package-archive.js";

const integrationEnabled =
  process.env.KANVAS_DATABASE_DISPOSABLE_INTEGRATION === "1";
const createdAt = new Date("2026-07-27T12:00:00.000Z");
const now = new Date("2026-07-28T12:00:00.000Z");
const id = (value: number): string => `01M${String(value).padStart(23, "0")}`;
const organizationId = id(1);
const workspaceId = id(2);
const principalId = id(3);
const uploadId = id(4);
const storedObjectId = id(5);
const storageProfileId = id(6);
const importId = id(7);
const rejectedImportId = id(8);
const skillDraftId = id(9);
const skillCandidateId = id(10);
const archiveSha256 = "b".repeat(64);
const skillMarkdown = new Uint8Array([35, 32, 83, 107, 105, 108, 108]);
const manifest = new Uint8Array([115, 99, 104, 101, 109, 97]);
const skillMarkdownSha256 = createHash("sha256")
  .update(skillMarkdown)
  .digest("hex");
const manifestSha256 = createHash("sha256").update(manifest).digest("hex");

interface CountRow extends RowDataPacket {
  readonly count: number | string;
}

interface ImportStateRow extends RowDataPacket {
  readonly state: string;
  readonly version: number;
}

function databaseName(): string {
  const name = `kanvas_skill_import_${String(process.pid)}_${String(Date.now())}`;
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
      session: "skill-import-integration",
    }),
    authorityType: "human_membership",
    authorityId: workspaceId,
    authorityVersion: 1,
  });
}

function extractedArchive(): ExtractedSkillPackageArchive {
  const inventory = Object.freeze([
    Object.freeze({
      path: "SKILL.md",
      byteSize: skillMarkdown.byteLength,
      sha256: skillMarkdownSha256,
      mediaType: "text/markdown" as const,
      bytes: skillMarkdown,
    }),
    Object.freeze({
      path: "scripts/保留.py",
      byteSize: manifest.byteLength,
      sha256: manifestSha256,
      mediaType: "text/plain" as const,
      bytes: manifest,
    }),
  ]);
  return Object.freeze({
    archiveSha256,
    logicalPackageDigest: digestProviderValue(
      inventory.map(({ path, byteSize, sha256, mediaType }) => ({
        path,
        byteSize,
        sha256,
        mediaType,
      })),
    ),
    entries: inventory,
  });
}

async function seedAuthorityAndArchive(pool: Pool): Promise<void> {
  await pool.execute(
    `INSERT INTO organization (
       id, slug, name, status, version, created_at, updated_at
     )
     VALUES (?, 'skill-import-org', 'Skill Import',
             'active', 1, ?, ?)`,
    [organizationId, createdAt, createdAt],
  );
  await pool.execute(
    `INSERT INTO workspace (
       id, organization_id, slug, name, status, version,
       created_at, updated_at
     )
     VALUES (?, ?, 'skill-import', 'Skill Import',
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
     VALUES (?, 'skill-import-subject', ?)`,
    [principalId, createdAt],
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
       'skill-import-test', 'imports/package.zip', 'single_put',
       'conditional_create', 'verified', 1, ?, ?, 'none',
       512, ?, 'application/zip', 'zip-profile-v1', NULL,
       ?, ?, NULL
     )`,
    [
      uploadId,
      workspaceId,
      storageProfileId,
      new Date("2026-07-29T12:00:00.000Z"),
      new Date("2026-07-30T12:00:00.000Z"),
      archiveSha256,
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
     VALUES (?, ?, ?, ?, 'skill-import-test',
             'imports/package.zip', 512, ?,
             'application/zip', 'active', ?)`,
    [
      storedObjectId,
      workspaceId,
      uploadId,
      storageProfileId,
      archiveSha256,
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
  "Skill package import state chain against disposable MySQL 8.0",
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
      await seedAuthorityAndArchive(pool);
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

    it("keeps quarantine, validation, Draft and Candidate links atomic", async () => {
      const imports = createSkillPackageImportStore(pool);
      const publications = createPublicationGovernanceStore(
        pool,
        createDefaultPublicationValidationPort(),
      );
      const quarantined = await imports.createQuarantine({
        importId,
        workspaceId,
        sourceStoredObjectId: storedObjectId,
        rawArchiveSha256: archiveSha256,
        parserProfileVersion: "restricted-zip-v1",
        actorPrincipalId: principalId,
        now,
        audit: audit(id(100)),
      });
      expect(quarantined).toMatchObject({
        state: "quarantined",
        version: 1,
        inventorySummary: null,
      });

      const validArchive = extractedArchive();
      const firstEntry = validArchive.entries[0];
      if (!firstEntry) {
        throw new Error("Skill package fixture has no first entry.");
      }
      await expect(
        imports.recordValidated({
          importId,
          workspaceId,
          expectedVersion: 1,
          archive: {
            ...validArchive,
            entries: [
              {
                ...firstEntry,
                bytes: new Uint8Array(firstEntry.byteSize),
              },
              ...validArchive.entries.slice(1),
            ],
          },
          actorPrincipalId: principalId,
          now: new Date(now.getTime() + 1),
          audit: audit(id(99)),
        }),
      ).rejects.toMatchObject({
        code: "skill_import.invalid_argument",
      });

      await expect(
        imports.recordValidated({
          importId,
          workspaceId,
          expectedVersion: 1,
          archive: validArchive,
          actorPrincipalId: principalId,
          now: new Date(now.getTime() + 1),
          audit: audit(id(100)),
        }),
      ).rejects.toMatchObject({
        code: "ER_DUP_ENTRY",
      });
      const [rolledBackRows] = await pool.execute<ImportStateRow[]>(
        `SELECT state, version
           FROM skill_package_import
           WHERE id = ?`,
        [importId],
      );
      expect(rolledBackRows[0]).toMatchObject({
        state: "quarantined",
        version: 1,
      });

      const validated = await imports.recordValidated({
        importId,
        workspaceId,
        expectedVersion: 1,
        archive: validArchive,
        actorPrincipalId: principalId,
        now: new Date(now.getTime() + 2),
        audit: audit(id(101)),
      });
      expect(validated).toMatchObject({
        state: "validated",
        version: 2,
        logicalPackageDigest: validArchive.logicalPackageDigest,
      });

      const skillDocument = Object.freeze({
        schemaVersion: 1,
        manifest: Object.freeze({
          key: "imported-skill",
          title: "Imported Skill",
        }),
        resources: Object.freeze([
          Object.freeze({
            path: "SKILL.md",
            resourceKind: "instructions",
            storedObjectId,
            contentDigest: `sha256:${skillMarkdownSha256}`,
            mediaType: "text/markdown",
            byteSize: skillMarkdown.byteLength,
          }),
        ]),
        workflowEntrypoints: Object.freeze([]),
      });
      const draft = await publications.saveDraft({
        draftId: skillDraftId,
        workspaceId,
        subjectKind: "skill",
        subjectKey: "imported-skill",
        contentDocument: skillDocument,
        expectedVersion: 0,
        actorPrincipalId: principalId,
        now: new Date(now.getTime() + 3),
        audit: audit(id(102)),
      });
      const adopted = await imports.linkDraft({
        importId,
        workspaceId,
        expectedVersion: validated.version,
        skillDraftId,
        actorPrincipalId: principalId,
        now: new Date(now.getTime() + 4),
        audit: audit(id(103)),
      });
      expect(adopted).toMatchObject({
        state: "draft_adopted",
        version: 3,
        adoptedSkillDraftId: skillDraftId,
      });

      await publications.submitCandidate({
        candidateId: skillCandidateId,
        draftId: skillDraftId,
        workspaceId,
        subjectKind: "skill",
        expectedDraftVersion: draft.version,
        parserProfileVersion: "kanvas-skill-v1",
        actorPrincipalId: principalId,
        now: new Date(now.getTime() + 5),
        audit: audit(id(104)),
      });
      const linked = await imports.linkCandidate({
        importId,
        workspaceId,
        expectedVersion: adopted.version,
        publicationCandidateId: skillCandidateId,
        actorPrincipalId: principalId,
        now: new Date(now.getTime() + 6),
        audit: audit(id(105)),
      });
      expect(linked).toMatchObject({
        state: "candidate_linked",
        version: 4,
        adoptedSkillDraftId: skillDraftId,
        adoptedPublicationCandidateId: skillCandidateId,
      });

      await expect(
        pool.execute(
          `UPDATE skill_package_import
           SET state = 'validated',
               version = version + 1
           WHERE id = ?`,
          [importId],
        ),
      ).rejects.toMatchObject({
        code: "ER_CHECK_CONSTRAINT_VIOLATED",
      });
      const [auditCounts] = await pool.execute<CountRow[]>(
        `SELECT COUNT(*) AS count
         FROM audit_event
         WHERE resource_type = 'skill_package_import'
           AND resource_id = ?`,
        [importId],
      );
      expect(Number(auditCounts[0]?.count)).toBe(4);
    }, 60_000);

    it("persists terminal rejection without adopting content", async () => {
      const imports = createSkillPackageImportStore(pool);
      const quarantined = await imports.createQuarantine({
        importId: rejectedImportId,
        workspaceId,
        sourceStoredObjectId: storedObjectId,
        rawArchiveSha256: archiveSha256,
        parserProfileVersion: "restricted-zip-v1-reject",
        actorPrincipalId: principalId,
        now: new Date(now.getTime() + 10),
        audit: audit(id(110)),
      });
      const rejected = await imports.reject({
        importId: rejectedImportId,
        workspaceId,
        expectedVersion: quarantined.version,
        rejectionCode: "skill_archive.content_rejected",
        actorPrincipalId: principalId,
        now: new Date(now.getTime() + 11),
        audit: audit(id(111)),
      });
      expect(rejected).toMatchObject({
        state: "rejected",
        version: 2,
        rejectionCode: "skill_archive.content_rejected",
        adoptedSkillDraftId: null,
        adoptedPublicationCandidateId: null,
      });
      await expect(
        imports.linkDraft({
          importId: rejectedImportId,
          workspaceId,
          expectedVersion: rejected.version,
          skillDraftId,
          actorPrincipalId: principalId,
          now: new Date(now.getTime() + 12),
          audit: audit(id(112)),
        }),
      ).rejects.toMatchObject({
        code: "skill_import.lifecycle_conflict",
      });
    }, 30_000);
  },
);
