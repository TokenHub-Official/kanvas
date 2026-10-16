import type {
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";
import { isWorkflowTopology } from "@kanvas/contracts/workflow";

interface WorkflowRow extends RowDataPacket {
  readonly id: string;
  readonly topology: unknown;
  readonly runtimeStatus: "enabled" | "disabled" | "revoked";
  readonly reasonCode: string | null;
  readonly version: number;
}

interface SkillRow extends RowDataPacket {
  readonly id: string;
  readonly runtimeStatus: "enabled" | "disabled" | "revoked";
  readonly reasonCode: string | null;
  readonly version: number;
  readonly unavailableWorkflowCount: number | string;
}

interface IdentityRow extends RowDataPacket {
  readonly id: string;
}

function requiredCapabilities(topologyValue: unknown): readonly Readonly<{
  key: string;
  revision: number;
  canonicalDigest: string;
}>[] {
  const topology =
    typeof topologyValue === "string"
      ? (JSON.parse(topologyValue) as unknown)
      : topologyValue;
  if (!isWorkflowTopology(topology)) return Object.freeze([]);
  const references = new Map<
    string,
    Readonly<{ key: string; revision: number; canonicalDigest: string }>
  >();
  for (const node of topology.nodes) {
    let capability:
      | Readonly<{
          contractId: string;
          revision: number;
          canonicalDigest: string;
        }>
      | undefined;
    if (node.kind === "invoke") {
      capability = node.capability;
    } else if (node.kind === "map") {
      capability = node.invoke.capability;
    }
    if (!capability) continue;
    const reference = Object.freeze({
      key: capability.contractId,
      revision: capability.revision,
      canonicalDigest: capability.canonicalDigest,
    });
    references.set(
      `${reference.key}:${String(reference.revision)}:${reference.canonicalDigest}`,
      reference,
    );
  }
  return Object.freeze([...references.values()]);
}

async function capabilityReady(
  connection: PoolConnection,
  workspaceId: string,
  required: ReturnType<typeof requiredCapabilities>[number],
): Promise<boolean> {
  const [rows] = await connection.execute<IdentityRow[]>(
    `SELECT binding.id
     FROM capability_contract_revision AS contract
     INNER JOIN capability_binding AS binding
       ON binding.workspace_id = contract.workspace_id
      AND binding.contract_revision_id = contract.id
      AND binding.lifecycle_status = 'active'
     WHERE contract.workspace_id = ? AND contract.contract_key = ?
       AND contract.revision = ? AND contract.canonical_digest = ?
       AND contract.lifecycle_status IN ('published', 'deprecated')
     LIMIT 1 FOR SHARE`,
    [workspaceId, required.key, required.revision, required.canonicalDigest],
  );
  return Boolean(rows[0]);
}

export interface CatalogRuntimeReconciliationResult {
  readonly workflowChanges: number;
  readonly skillChanges: number;
}

export async function reconcileCatalogRuntimeInTransaction(
  connection: PoolConnection,
  options: {
    readonly workspaceId: string;
    readonly actorPrincipalId: string;
    readonly now: Date;
  },
): Promise<CatalogRuntimeReconciliationResult> {
  let workflowChanges = 0;
  const [workflows] = await connection.execute<WorkflowRow[]>(
    `SELECT revision.id, revision.topology,
            activation.runtime_status AS runtimeStatus,
            activation.reason_code AS reasonCode, activation.version
     FROM workflow_revision AS revision
     INNER JOIN workflow_definition AS definition
       ON definition.workspace_id = revision.workspace_id
      AND definition.id = revision.workflow_definition_id
     INNER JOIN workflow_revision_activation AS activation
       ON activation.workspace_id = revision.workspace_id
      AND activation.workflow_revision_id = revision.id
     WHERE revision.workspace_id = ?
       AND revision.lifecycle_status = 'published'
       AND definition.creation_request_key LIKE 'catalog:%'
     ORDER BY revision.id FOR UPDATE`,
    [options.workspaceId],
  );
  for (const workflow of workflows) {
    const required = requiredCapabilities(workflow.topology);
    const ready =
      required.length > 0 &&
      (
        await Promise.all(
          required.map((item) =>
            capabilityReady(connection, options.workspaceId, item),
          ),
        )
      ).every(Boolean);
    const shouldEnable =
      ready &&
      workflow.runtimeStatus === "disabled" &&
      workflow.reasonCode === "required_capability_unavailable";
    const shouldDisable = !ready && workflow.runtimeStatus === "enabled";
    if (!shouldEnable && !shouldDisable) continue;
    const [updated] = await connection.execute<ResultSetHeader>(
      `UPDATE workflow_revision_activation
       SET runtime_status = ?, reason_code = ?, version = version + 1,
           updated_by_principal_id = ?, updated_at = ?
       WHERE workspace_id = ? AND workflow_revision_id = ? AND version = ?`,
      [
        shouldEnable ? "enabled" : "disabled",
        shouldEnable ? null : "required_capability_unavailable",
        options.actorPrincipalId,
        options.now,
        options.workspaceId,
        workflow.id,
        workflow.version,
      ],
    );
    workflowChanges += updated.affectedRows;
  }

  let skillChanges = 0;
  const [skills] = await connection.execute<SkillRow[]>(
    `SELECT skill.id, activation.runtime_status AS runtimeStatus,
            activation.reason_code AS reasonCode, activation.version,
            SUM(
              CASE WHEN workflow_activation.runtime_status = 'enabled'
                   THEN 0 ELSE 1 END
            ) AS unavailableWorkflowCount
     FROM skill_revision AS skill
     INNER JOIN skill_revision_activation AS activation
       ON activation.workspace_id = skill.workspace_id
      AND activation.skill_revision_id = skill.id
     INNER JOIN skill_revision_workflow_entrypoint AS entrypoint
       ON entrypoint.workspace_id = skill.workspace_id
      AND entrypoint.skill_revision_id = skill.id
     INNER JOIN workflow_revision_activation AS workflow_activation
       ON workflow_activation.workspace_id = entrypoint.workspace_id
      AND workflow_activation.workflow_revision_id = entrypoint.workflow_revision_id
     WHERE skill.workspace_id = ? AND skill.lifecycle_status = 'published'
       AND JSON_UNQUOTE(
         JSON_EXTRACT(skill.manifest_document, '$.i18n.displayName.defaultLocale')
       ) IS NOT NULL
     GROUP BY skill.id, activation.runtime_status,
              activation.reason_code, activation.version
     ORDER BY skill.id FOR UPDATE`,
    [options.workspaceId],
  );
  for (const skill of skills) {
    const ready = Number(skill.unavailableWorkflowCount) === 0;
    const shouldEnable =
      ready &&
      skill.runtimeStatus === "disabled" &&
      skill.reasonCode === "required_workflow_unavailable";
    const shouldDisable = !ready && skill.runtimeStatus === "enabled";
    if (!shouldEnable && !shouldDisable) continue;
    const [updated] = await connection.execute<ResultSetHeader>(
      `UPDATE skill_revision_activation
       SET runtime_status = ?, reason_code = ?, version = version + 1,
           updated_by_principal_id = ?, updated_at = ?
       WHERE workspace_id = ? AND skill_revision_id = ? AND version = ?`,
      [
        shouldEnable ? "enabled" : "disabled",
        shouldEnable ? null : "required_workflow_unavailable",
        options.actorPrincipalId,
        options.now,
        options.workspaceId,
        skill.id,
        skill.version,
      ],
    );
    skillChanges += updated.affectedRows;
  }
  return Object.freeze({ workflowChanges, skillChanges });
}
