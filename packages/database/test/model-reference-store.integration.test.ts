import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mysql2/promise";

import { buildModelsDevReferenceDocument } from "@kanvas/contracts/model-reference";

import { createModelReferenceStore } from "../src/runtime/model-reference-store.js";
import { digestProviderValue } from "../src/runtime/provider-value-digest.js";
import {
  createDisposableIntegrationPool,
  resetDisposableIntegrationDatabase,
} from "./disposable-integration-database.js";

const integrationEnabled =
  process.env.KANVAS_DATABASE_DISPOSABLE_INTEGRATION === "1";
const id = (value: number): string => `01K${String(value).padStart(23, "0")}`;
const observedAt = new Date("2026-08-27T00:00:00.000Z");

function document(
  sourceRevision: string,
  timestamp = observedAt.toISOString(),
) {
  return buildModelsDevReferenceDocument({
    modelCatalog: {
      "openai/gpt-test": {
        id: "openai/gpt-test",
        name: "GPT Test",
        description: "Canonical test model",
      },
    },
    providerCatalog: {
      openai: {
        id: "openai",
        name: "OpenAI",
        doc: "https://example.com/docs",
        models: {
          "gpt-test": {
            id: "gpt-test",
            name: "GPT Test",
            description: "Canonical test model",
            cost: { input: 1, output: 4 },
          },
        },
      },
    },
    sourceRevision,
    observedAt: timestamp,
  });
}

describe.skipIf(!integrationEnabled)(
  "model reference store against disposable MySQL",
  () => {
    let pool: Pool | undefined;

    beforeAll(async () => {
      pool = createDisposableIntegrationPool();
      const connection = await pool.getConnection();
      try {
        await resetDisposableIntegrationDatabase(connection);
        await connection.execute(
          `INSERT INTO principal (
             id, principal_type, status, version, created_at, updated_at
           ) VALUES (?, 'service', 'active', 1, ?, ?)`,
          [id(1), observedAt, observedAt],
        );
      } finally {
        connection.release();
      }
    });

    afterAll(async () => {
      await pool?.end();
    });

    it("publishes and replays one immutable last-known-good snapshot", async () => {
      const store = createModelReferenceStore(pool!);
      const reference = document("models.dev:test");
      const options = {
        id: id(2),
        sourceRevision: reference.sourceRevision,
        sourceDigest: digestProviderValue(reference),
        document: reference,
        fetchedAt: observedAt,
        publishedAt: new Date(observedAt.getTime() + 1_000),
        actorPrincipalId: id(1),
      };
      await expect(store.publish(options)).resolves.toMatchObject({
        replayed: false,
        snapshot: { id: id(2), revision: 1 },
      });
      await expect(
        store.publish({ ...options, id: id(3) }),
      ).resolves.toMatchObject({
        replayed: true,
        snapshot: { id: id(2), revision: 1 },
      });
      await expect(store.getCurrent()).resolves.toMatchObject({
        id: id(2),
        sourceRevision: "models.dev:test",
      });
      const conflicting = document(
        "models.dev:test",
        "2026-08-27T00:00:01.000Z",
      );
      await expect(
        store.publish({
          ...options,
          id: id(4),
          document: conflicting,
          sourceDigest: digestProviderValue(conflicting),
        }),
      ).rejects.toThrow(/conflicts with its digest/u);
      // A conflicting publish must leave the original snapshot intact.
      await expect(store.getCurrent()).resolves.toMatchObject({
        id: id(2),
        sourceRevision: options.sourceRevision,
        sourceDigest: options.sourceDigest,
      });
    });
  },
);
