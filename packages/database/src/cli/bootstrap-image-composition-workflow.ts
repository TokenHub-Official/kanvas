import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { PoolConnection, RowDataPacket } from "mysql2/promise";

import { digestProviderValue } from "../runtime/provider-value-digest.js";

interface ContractRow extends RowDataPacket {
  readonly id: string;
}

interface WorkflowDraftRow extends RowDataPacket {
  readonly canonicalDigest: string;
}

export interface RequiredCapability {
  readonly canonicalDigest: string;
  readonly contractId: string;
  readonly revision: number;
}

export interface ImageCompositionWorkflowDescriptor {
  readonly authoring?: {
    readonly category: string;
    readonly definitionId: string;
    readonly description: string;
    readonly displayName: string;
  };
  readonly entrypointKey: string;
  readonly ids: {
    readonly sourceDraft: string;
    readonly workflowRevision: string;
  };
  readonly packRoot: string;
  readonly revision: number;
  readonly scenarioKey: string;
  readonly workflowFile: string;
  readonly workflowKey: string;
}

function record(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

async function json(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

function requiredCapabilities(value: unknown): readonly RequiredCapability[] {
  if (!Array.isArray(value) || value.length < 1) {
    throw new TypeError("Composition Workflow requires existing Capabilities.");
  }
  return Object.freeze(
    value.map((item) => {
      const required = record(item, "required Capability");
      if (
        typeof required.contractId !== "string" ||
        typeof required.revision !== "number" ||
        !Number.isSafeInteger(required.revision) ||
        required.revision < 1 ||
        typeof required.canonicalDigest !== "string" ||
        !/^sha256:[0-9a-f]{64}$/u.test(required.canonicalDigest)
      ) {
        throw new TypeError("Composition Workflow Capability pin is invalid.");
      }
      return Object.freeze({
        contractId: required.contractId,
        revision: required.revision,
        canonicalDigest: required.canonicalDigest,
      });
    }),
  );
}

export async function loadImageCompositionWorkflowSeed(
  descriptor: ImageCompositionWorkflowDescriptor,
) {
  const [manifestValue, topologyValue, skillValue, inputSchema, outputSchema] =
    await Promise.all([
      json(resolve(descriptor.packRoot, "manifest.json")),
      json(resolve(descriptor.packRoot, "workflows", descriptor.workflowFile)),
      json(resolve(descriptor.packRoot, "skill/manifest.json")),
      json(resolve(descriptor.packRoot, "schemas/input.json")),
      json(resolve(descriptor.packRoot, "schemas/output.json")),
    ]);
  const manifest = record(manifestValue, "pack manifest");
  const topology = record(topologyValue, "Workflow topology");
  const skill = record(skillValue, "Skill manifest");
  const pins = requiredCapabilities(manifest.requiredCapabilities);
  const nodes = Array.isArray(topology.nodes) ? topology.nodes : [];
  const nodePins = nodes.flatMap((node) => {
    const workflowNode = record(node, "Workflow node");
    let capabilityValue: unknown;
    if (workflowNode.kind === "invoke") {
      capabilityValue = workflowNode.capability;
    } else if (workflowNode.kind === "map") {
      capabilityValue = record(
        workflowNode.invoke,
        "Workflow map invoke",
      ).capability;
    }
    if (capabilityValue === undefined) return [];
    const capability = record(capabilityValue, "Workflow node Capability");
    return `${String(capability.contractId)}:${String(
      capability.revision,
    )}:${String(capability.canonicalDigest)}`;
  });
  const requiredPins = pins.map(
    (pin) => `${pin.contractId}:${String(pin.revision)}:${pin.canonicalDigest}`,
  );
  if (
    manifest.packId !== descriptor.scenarioKey ||
    !Array.isArray(manifest.capabilities) ||
    manifest.capabilities.length !== 0 ||
    topology.key !== descriptor.workflowKey ||
    skill.skillKey !== descriptor.scenarioKey ||
    skill.nonProduction !== false ||
    requiredPins.some((pin) => !nodePins.includes(pin)) ||
    nodePins.some((pin) => !requiredPins.includes(pin))
  ) {
    throw new Error(
      `${descriptor.scenarioKey} composition identity or Capability pins are invalid.`,
    );
  }
  const workflowDefinition = Object.freeze({
    schemaVersion: 1,
    topology,
    inputSchema,
    outputSchema,
  });
  return Object.freeze({
    manifest: skill,
    topology,
    inputSchema,
    outputSchema,
    requiredCapabilities: pins,
    workflowDigest: digestProviderValue(workflowDefinition),
  });
}

async function capabilityReady(
  connection: PoolConnection,
  workspaceId: string,
  required: RequiredCapability,
): Promise<boolean> {
  const [contracts] = await connection.query<ContractRow[]>(
    `SELECT id
     FROM capability_contract_revision
     WHERE workspace_id = ?
       AND contract_key = ?
       AND revision = ?
       AND canonical_digest = ?
       AND lifecycle_status = 'published'
     LIMIT 1`,
    [
      workspaceId,
      required.contractId,
      required.revision,
      required.canonicalDigest,
    ],
  );
  const contractId = contracts[0]?.id;
  if (!contractId) {
    return false;
  }
  const [bindings] = await connection.query<RowDataPacket[]>(
    `SELECT id
     FROM capability_binding
     WHERE workspace_id = ?
       AND contract_revision_id = ?
       AND lifecycle_status = 'active'
     LIMIT 1`,
    [workspaceId, contractId],
  );
  return bindings.length === 1;
}

export async function bootstrapImageCompositionWorkflow(
  connection: PoolConnection,
  options: {
    readonly actorId: string;
    readonly descriptor: ImageCompositionWorkflowDescriptor;
    readonly workspaceId: string;
  },
) {
  const seed = await loadImageCompositionWorkflowSeed(options.descriptor);
  let ready = true;
  for (const required of seed.requiredCapabilities) {
    if (!(await capabilityReady(connection, options.workspaceId, required))) {
      ready = false;
    }
  }
  const { ids } = options.descriptor;
  if (options.descriptor.authoring) {
    await connection.execute(
      `INSERT INTO workflow_definition (
         id, workspace_id, workflow_key, display_name, description,
         category, lifecycle_status, version,
         created_by_principal_id, updated_by_principal_id,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'active', 1, ?, ?,
         UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE
         display_name = VALUES(display_name),
         description = VALUES(description),
         category = VALUES(category),
         lifecycle_status = 'active',
         updated_by_principal_id = VALUES(updated_by_principal_id),
         updated_at = VALUES(updated_at)`,
      [
        options.descriptor.authoring.definitionId,
        options.workspaceId,
        options.descriptor.workflowKey,
        options.descriptor.authoring.displayName,
        options.descriptor.authoring.description,
        options.descriptor.authoring.category,
        options.actorId,
        options.actorId,
      ],
    );
    const [draftRows] = await connection.query<WorkflowDraftRow[]>(
      `SELECT canonical_digest AS canonicalDigest
       FROM workflow_draft
       WHERE workspace_id = ? AND id = ?
       LIMIT 1
       FOR UPDATE`,
      [options.workspaceId, ids.sourceDraft],
    );
    if (draftRows[0]?.canonicalDigest !== seed.workflowDigest) {
      await connection.execute(
        `INSERT INTO workflow_draft (
         id, workspace_id, workflow_definition_id, workflow_key,
         schema_version, content_document, canonical_digest,
         lifecycle_status, version, created_by_principal_id,
         updated_by_principal_id, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 1, ?, ?, 'active', 1, ?, ?,
         UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE
         workflow_definition_id = VALUES(workflow_definition_id),
         version = IF(
           canonical_digest <> VALUES(canonical_digest),
           version + 1,
           version
         ),
         content_document = VALUES(content_document),
         canonical_digest = VALUES(canonical_digest),
         lifecycle_status = 'active',
         updated_by_principal_id = VALUES(updated_by_principal_id),
         updated_at = VALUES(updated_at)`,
        [
          ids.sourceDraft,
          options.workspaceId,
          options.descriptor.authoring.definitionId,
          options.descriptor.workflowKey,
          JSON.stringify({
            schemaVersion: 1,
            topology: seed.topology,
            inputSchema: seed.inputSchema,
            outputSchema: seed.outputSchema,
          }),
          seed.workflowDigest,
          options.actorId,
          options.actorId,
        ],
      );
    }
  }
  await connection.execute(
    `INSERT IGNORE INTO workflow_revision (
       id, workspace_id, workflow_definition_id, workflow_key,
       revision, lifecycle_status,
       canonical_digest, topology, input_schema, output_schema,
       created_at, published_at
     ) VALUES (?, ?, ?, ?, ?, 'published', ?, ?, ?, ?,
       UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE
       workflow_definition_id = COALESCE(
         workflow_definition_id,
         VALUES(workflow_definition_id)
       )`,
    [
      ids.workflowRevision,
      options.workspaceId,
      options.descriptor.authoring?.definitionId ?? null,
      options.descriptor.workflowKey,
      options.descriptor.revision,
      seed.workflowDigest,
      JSON.stringify(seed.topology),
      JSON.stringify(seed.inputSchema),
      JSON.stringify(seed.outputSchema),
    ],
  );
  await connection.execute(
    `INSERT IGNORE INTO workflow_revision_activation (
       workspace_id, workflow_revision_id, runtime_status,
       reason_code, version, updated_by_principal_id, updated_at
    ) VALUES (?, ?, ?, ?, 1, ?, UTC_TIMESTAMP(3))
    ON DUPLICATE KEY UPDATE
      version = version + 1,
      runtime_status = VALUES(runtime_status),
      reason_code = VALUES(reason_code),
      updated_by_principal_id = VALUES(updated_by_principal_id),
      updated_at = VALUES(updated_at)`,
    [
      options.workspaceId,
      ids.workflowRevision,
      ready ? "enabled" : "disabled",
      ready ? null : "required_capability_unavailable",
      options.actorId,
    ],
  );
  return Object.freeze({
    scenarioKey: options.descriptor.scenarioKey,
    workflowRevisionId: ids.workflowRevision,
    workflowRevision: options.descriptor.revision,
    ready,
    requiredCapabilities: seed.requiredCapabilities,
  });
}
