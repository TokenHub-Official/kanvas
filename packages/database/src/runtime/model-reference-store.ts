import type { ModelReferenceDocumentV1 } from "@kanvas/contracts/model-reference";
import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

import { digestProviderValue } from "./provider-value-digest.js";

const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;

export interface ModelReferenceSnapshotRecord {
  readonly id: string;
  readonly revision: number;
  readonly sourceRevision: string;
  readonly sourceDigest: string;
  readonly document: ModelReferenceDocumentV1;
  readonly fetchedAt: Date;
  readonly publishedAt: Date;
}

export interface PublishModelReferenceSnapshotOptions {
  readonly id: string;
  readonly sourceRevision: string;
  readonly sourceDigest: string;
  readonly document: ModelReferenceDocumentV1;
  readonly fetchedAt: Date;
  readonly publishedAt: Date;
  readonly actorPrincipalId: string;
}

export interface ModelReferenceStore {
  getCurrent(): Promise<ModelReferenceSnapshotRecord | undefined>;
  publish(options: PublishModelReferenceSnapshotOptions): Promise<{
    readonly snapshot: ModelReferenceSnapshotRecord;
    readonly replayed: boolean;
  }>;
}

interface SnapshotRow extends RowDataPacket {
  readonly id: string;
  readonly revision: string | number;
  readonly sourceRevision: string;
  readonly sourceDigest: string;
  readonly referenceDocument: unknown;
  readonly fetchedAt: Date;
  readonly publishedAt: Date;
}

function invalid(message: string): never {
  throw new TypeError(message);
}

function documentFrom(value: unknown): ModelReferenceDocumentV1 {
  const document =
    typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (
    !document ||
    typeof document !== "object" ||
    Array.isArray(document) ||
    (document as Readonly<Record<string, unknown>>).schemaVersion !== 1 ||
    (document as Readonly<Record<string, unknown>>).source !== "models.dev"
  ) {
    return invalid("Stored model reference document is invalid.");
  }
  return document as ModelReferenceDocumentV1;
}

function recordFrom(row: SnapshotRow): ModelReferenceSnapshotRecord {
  const revision = Number(row.revision);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    return invalid("Stored model reference revision is invalid.");
  }
  return Object.freeze({
    id: row.id,
    revision,
    sourceRevision: row.sourceRevision,
    sourceDigest: row.sourceDigest,
    document: documentFrom(row.referenceDocument),
    fetchedAt: new Date(row.fetchedAt),
    publishedAt: new Date(row.publishedAt),
  });
}

async function readCurrent(
  connection: Pick<PoolConnection, "execute"> | Pool,
): Promise<ModelReferenceSnapshotRecord | undefined> {
  const [rows] = await connection.execute<SnapshotRow[]>(
    `SELECT
       id,
       revision,
       source_revision AS sourceRevision,
       source_digest AS sourceDigest,
       reference_document AS referenceDocument,
       fetched_at AS fetchedAt,
       published_at AS publishedAt
     FROM model_reference_snapshot
     WHERE revision = (SELECT MAX(revision) FROM model_reference_snapshot)
     LIMIT 1`,
  );
  return rows[0] ? recordFrom(rows[0]) : undefined;
}

function validate(options: PublishModelReferenceSnapshotOptions): void {
  if (
    !idPattern.test(options.id) ||
    !idPattern.test(options.actorPrincipalId)
  ) {
    invalid("Model reference snapshot IDs must be canonical ULIDs.");
  }
  if (
    options.sourceRevision.length < 1 ||
    options.sourceRevision.length > 160 ||
    options.sourceRevision !== options.sourceRevision.trim()
  ) {
    invalid("Model reference source revision is invalid.");
  }
  if (!digestPattern.test(options.sourceDigest)) {
    invalid("Model reference source digest is invalid.");
  }
  if (digestProviderValue(options.document) !== options.sourceDigest) {
    invalid("Model reference source digest does not match its document.");
  }
  if (
    options.document.sourceRevision !== options.sourceRevision ||
    options.publishedAt < options.fetchedAt
  ) {
    invalid("Model reference snapshot facts are inconsistent.");
  }
}

export function createModelReferenceStore(pool: Pool): ModelReferenceStore {
  return Object.freeze({
    getCurrent: () => readCurrent(pool),

    async publish(options: PublishModelReferenceSnapshotOptions) {
      validate(options);
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [existingRows] = await connection.execute<SnapshotRow[]>(
          `SELECT
             id,
             revision,
             source_revision AS sourceRevision,
             source_digest AS sourceDigest,
             reference_document AS referenceDocument,
             fetched_at AS fetchedAt,
             published_at AS publishedAt
           FROM model_reference_snapshot
           WHERE source_digest = ? OR source_revision = ?
           LIMIT 2
           FOR SHARE`,
          [options.sourceDigest, options.sourceRevision],
        );
        const conflict = existingRows.find(
          (row) =>
            row.sourceDigest !== options.sourceDigest ||
            row.sourceRevision !== options.sourceRevision,
        );
        if (conflict) {
          invalid("Model reference source revision conflicts with its digest.");
        }
        const existing = existingRows[0];
        if (existing) {
          await connection.commit();
          return Object.freeze({
            snapshot: recordFrom(existing),
            replayed: true,
          });
        }
        await connection.execute<ResultSetHeader>(
          `INSERT INTO model_reference_snapshot (
             id, schema_version, source_kind, source_revision, source_digest,
             reference_document, fetched_at, published_at,
             created_by_principal_id, created_at
           ) VALUES (?, 1, 'models_dev', ?, ?, ?, ?, ?, ?, ?)`,
          [
            options.id,
            options.sourceRevision,
            options.sourceDigest,
            JSON.stringify(options.document),
            options.fetchedAt,
            options.publishedAt,
            options.actorPrincipalId,
            options.publishedAt,
          ],
        );
        const snapshot = await readCurrent(connection);
        if (!snapshot || snapshot.id !== options.id) {
          invalid("Published model reference snapshot could not be read.");
        }
        await connection.commit();
        return Object.freeze({ snapshot, replayed: false });
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    },
  });
}
