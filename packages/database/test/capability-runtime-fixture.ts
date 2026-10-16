import type { Pool, PoolConnection } from "mysql2/promise";
import { digestProviderValue } from "../src/runtime/provider-value-digest.js";

function digest(value: unknown): string {
  return digestProviderValue(value);
}

const inputMapping = Object.freeze({
  schemaVersion: "kanvas.capability-mapping/v1",
  direction: "input",
  expression: Object.freeze({ op: "source", root: "input", pointer: "" }),
});
const compiledInputMapping = Object.freeze({
  schemaVersion: "kanvas.compiled-capability-mapping/v1",
  direction: "input",
  expression: Object.freeze({ op: "source", root: "input", path: [] }),
});
const outputMapping = Object.freeze({
  schemaVersion: "kanvas.capability-mapping/v1",
  direction: "output",
  expression: Object.freeze({ op: "source", root: "result", pointer: "" }),
});
const compiledOutputMapping = Object.freeze({
  schemaVersion: "kanvas.compiled-capability-mapping/v1",
  direction: "output",
  expression: Object.freeze({ op: "source", root: "result", path: [] }),
});

export async function insertCapabilityImplementationFixture(
  connection: Pool | PoolConnection,
  options: Readonly<{
    workspaceId: string;
    contractRevisionId: string;
    adapterDefinitionId: string;
    adapterRevisionId: string;
    adapterKey: string;
    executionTarget: "browser" | "provider" | "worker";
    implementationId: string;
    implementationKey: string;
    canonicalDigest: string;
    configuration?: Readonly<Record<string, unknown>>;
    createdAt: Date;
  }>,
): Promise<void> {
  const adapterDigest = digest({
    adapterKey: options.adapterKey,
    adapterRevisionId: options.adapterRevisionId,
  });
  const adapterDocument = Object.freeze({
    schemaVersion: "kanvas.runtime-adapter-definition/v1",
    adapterKey: options.adapterKey,
    revision: 1,
    displayName: Object.freeze({
      defaultLocale: "en-US",
      values: Object.freeze({
        "en-US": options.adapterKey,
        "zh-CN": options.adapterKey,
      }),
    }),
    executionTarget: options.executionTarget,
    sourceKinds: Object.freeze(["plugin"]),
    supportedModelFormats: Object.freeze([]),
    invocationInputSchema: Object.freeze({ type: "object" }),
    invocationOutputSchema: Object.freeze({ type: "object" }),
    configurationSchema: Object.freeze({ type: "object" }),
    artifactInputs: Object.freeze([]),
    executable: Object.freeze({
      kind: "built_in",
      packageKey: "kanvas.test-runtime",
      packageVersion: "1",
      entrypoint: options.adapterKey,
      releaseDigest: adapterDigest,
    }),
  });
  await connection.execute(
    `INSERT INTO runtime_adapter_definition (
       id, workspace_id, adapter_key, lifecycle_status,
       current_revision_id, version, created_at, updated_at
     ) VALUES (?, ?, ?, 'active', NULL, 1, ?, ?)`,
    [
      options.adapterDefinitionId,
      options.workspaceId,
      options.adapterKey,
      options.createdAt,
      options.createdAt,
    ],
  );
  await connection.execute(
    `INSERT INTO runtime_adapter_revision (
       id, workspace_id, runtime_adapter_definition_id, revision,
       lifecycle_status, execution_target, canonical_digest, document,
       created_at, published_at
     ) VALUES (?, ?, ?, 1, 'published', ?, ?, ?, ?, ?)`,
    [
      options.adapterRevisionId,
      options.workspaceId,
      options.adapterDefinitionId,
      options.executionTarget,
      adapterDigest,
      JSON.stringify(adapterDocument),
      options.createdAt,
      options.createdAt,
    ],
  );
  await connection.execute(
    `UPDATE runtime_adapter_definition
     SET current_revision_id = ?, version = 2, updated_at = ?
     WHERE workspace_id = ? AND id = ?`,
    [
      options.adapterRevisionId,
      options.createdAt,
      options.workspaceId,
      options.adapterDefinitionId,
    ],
  );
  await connection.execute(
    `INSERT INTO capability_implementation_revision (
       id, workspace_id, implementation_key, display_name, description,
       revision, lifecycle_status, contract_revision_id,
       runtime_adapter_revision_id, execution_target, adapter_key,
       source_kind, source_reference, canonical_digest,
       publication_request_key, publication_request_hash, configuration,
       input_mapping, input_mapping_digest, compiled_input_mapping,
       output_mapping, output_mapping_digest, compiled_output_mapping,
       fixture_suite, created_at, published_at
     ) VALUES (?, ?, ?, ?, NULL, 1, 'published', ?, ?, ?, ?, 'plugin', ?, ?,
       ?, ?, ?, ?, ?, ?, ?, ?, ?, JSON_ARRAY(), ?, ?)`,
    [
      options.implementationId,
      options.workspaceId,
      options.implementationKey,
      JSON.stringify({
        defaultLocale: "en-US",
        values: {
          "en-US": options.implementationKey,
          "zh-CN": options.implementationKey,
        },
      }),
      options.contractRevisionId,
      options.adapterRevisionId,
      options.executionTarget,
      options.adapterKey,
      JSON.stringify({
        kind: "plugin",
        plugin: {
          key: options.adapterKey,
          revision: 1,
          canonicalDigest: adapterDigest,
        },
      }),
      options.canonicalDigest,
      `fixture:${digest(options.implementationKey).slice(7)}`,
      digest({ implementationKey: options.implementationKey }),
      JSON.stringify(options.configuration ?? {}),
      JSON.stringify(inputMapping),
      digest(compiledInputMapping),
      JSON.stringify(compiledInputMapping),
      JSON.stringify(outputMapping),
      digest(compiledOutputMapping),
      JSON.stringify(compiledOutputMapping),
      options.createdAt,
      options.createdAt,
    ],
  );
}
