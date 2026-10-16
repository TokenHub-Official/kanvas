import type {
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";
import { ulid } from "ulid";

import { parseProviderRoutePolicyDocument } from "./configuration-policy.js";
import { reconcileCatalogRuntimeInTransaction } from "./catalog-runtime-reconciler.js";
import type {
  ImageCapabilityKey,
  ProviderSettingRouteDefinition,
} from "./provider-setting-control-plane.js";
import type { ProviderSettingPreset } from "./provider-settings-store.js";

interface BindingTemplateRow extends RowDataPacket {
  readonly id: string;
  readonly bindingKey: string;
  readonly lifecycleStatus: "active" | "disabled";
  readonly version: number;
  readonly contractRevisionId: string;
  readonly implementationRevisionId: string;
  readonly priority: number;
  readonly routePolicy: unknown;
  readonly routePolicyRevisionId: string | null;
}

interface PriorityRow extends RowDataPacket {
  readonly priority: number;
}

interface ReconciliationRoute {
  readonly routePolicyRevisionId: string;
  readonly capabilityKey: ImageCapabilityKey;
  readonly apiSurface: ProviderSettingRouteDefinition["apiSurface"];
}

export interface ProviderImageCapabilityBindingReconciliation {
  readonly affectedBindingIds: readonly string[];
  readonly existingBindingCount: number;
  readonly reboundTemplateCount: number;
  readonly createdBindingCount: number;
  readonly unmatchedRouteCount: number;
}

function jsonValue(value: unknown): unknown {
  return typeof value === "string" ? (JSON.parse(value) as unknown) : value;
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  const parsed = jsonValue(value);
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Readonly<Record<string, unknown>>)
    : undefined;
}

function routePolicyJson(value: unknown, dependencyReady = true): string {
  const parsed = record(value);
  if (!parsed) {
    throw new Error("Provider Capability Binding route policy is invalid.");
  }
  return JSON.stringify({ ...parsed, dependencyReady });
}

function routedBindingKey(templateKey: string, bindingId: string): string {
  const suffix = bindingId.toLowerCase();
  const prefix = templateKey
    .slice(0, 160 - suffix.length - 1)
    .replace(/[._:-]+$/u, "");
  return `${prefix}.${suffix}`;
}

async function bindingTemplates(
  connection: PoolConnection,
  workspaceId: string,
  operation: ImageCapabilityKey,
  apiSurface: ProviderSettingRouteDefinition["apiSurface"],
  preset: ProviderSettingPreset,
): Promise<readonly BindingTemplateRow[]> {
  const [rows] = await connection.query<BindingTemplateRow[]>(
    `SELECT
       binding.id,
       binding.binding_key AS bindingKey,
       binding.lifecycle_status AS lifecycleStatus,
       binding.version,
       binding.contract_revision_id AS contractRevisionId,
       binding.implementation_revision_id AS implementationRevisionId,
       binding.priority,
       binding.route_policy AS routePolicy,
       binding.route_policy_revision_id AS routePolicyRevisionId,
       implementation.source_reference AS sourceReference
     FROM capability_binding AS binding
     INNER JOIN capability_implementation_revision AS implementation
       ON implementation.workspace_id = binding.workspace_id
      AND implementation.id = binding.implementation_revision_id
      AND implementation.lifecycle_status = 'published'
      AND implementation.execution_target = 'provider'
     INNER JOIN capability_contract_revision AS contract
       ON contract.workspace_id = binding.workspace_id
      AND contract.id = binding.contract_revision_id
      AND contract.lifecycle_status = 'published'
     WHERE binding.workspace_id = ?
       AND (
         binding.lifecycle_status = 'active'
         OR (
           binding.lifecycle_status = 'disabled'
           AND JSON_EXTRACT(
             binding.route_policy,
             '$.catalogDesiredEnabled'
           ) = TRUE
         )
       )
       AND implementation.source_kind = 'model_service'
       AND JSON_UNQUOTE(
         JSON_EXTRACT(implementation.source_reference, '$.selector.operation')
       ) = ?
       AND JSON_UNQUOTE(
         JSON_EXTRACT(implementation.source_reference, '$.selector.apiSurface')
       ) = ?
       AND (
         JSON_EXTRACT(
           implementation.source_reference,
           '$.selector.providerPreset'
         ) IS NULL
         OR JSON_UNQUOTE(
           JSON_EXTRACT(
             implementation.source_reference,
             '$.selector.providerPreset'
           )
         ) = ?
       )
     ORDER BY
       binding.contract_revision_id,
       binding.implementation_revision_id,
       binding.priority,
       binding.id
     FOR UPDATE`,
    [workspaceId, operation, apiSurface, preset],
  );
  return Object.freeze(rows);
}

async function nextPriority(
  connection: PoolConnection,
  workspaceId: string,
  contractRevisionId: string,
): Promise<number> {
  const [rows] = await connection.execute<PriorityRow[]>(
    `SELECT priority
     FROM capability_binding
     WHERE workspace_id = ?
       AND contract_revision_id = ?
     ORDER BY priority DESC
     LIMIT 1
     FOR UPDATE`,
    [workspaceId, contractRevisionId],
  );
  const priority = (rows[0]?.priority ?? 0) + 1;
  if (!Number.isSafeInteger(priority) || priority > 4_294_967_295) {
    throw new Error("Provider Capability Binding priority space is exhausted.");
  }
  return priority;
}

function templateGroups(
  rows: readonly BindingTemplateRow[],
): readonly (readonly BindingTemplateRow[])[] {
  const groups = new Map<string, BindingTemplateRow[]>();
  for (const row of rows) {
    const key = [row.contractRevisionId, row.implementationRevisionId].join(
      ":",
    );
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return Object.freeze(
    [...groups.values()].map((group) => Object.freeze(group)),
  );
}

export async function reconcileProviderImageCapabilityBindingsInTransaction(
  connection: PoolConnection,
  options: {
    readonly workspaceId: string;
    readonly actorPrincipalId: string;
    readonly preset: ProviderSettingPreset;
    readonly routes: readonly ReconciliationRoute[];
    readonly now: Date;
  },
): Promise<ProviderImageCapabilityBindingReconciliation> {
  let existingBindingCount = 0;
  let reboundTemplateCount = 0;
  let createdBindingCount = 0;
  let unmatchedRouteCount = 0;
  const affectedBindingIds: string[] = [];

  for (const route of options.routes) {
    const rows = await bindingTemplates(
      connection,
      options.workspaceId,
      route.capabilityKey,
      route.apiSurface,
      options.preset,
    );
    const groups = templateGroups(rows);
    if (groups.length === 0) {
      unmatchedRouteCount += 1;
      continue;
    }
    for (const group of groups) {
      const alreadyBound = group.find(
        (row) => row.routePolicyRevisionId === route.routePolicyRevisionId,
      );
      if (alreadyBound) {
        if (alreadyBound.lifecycleStatus === "disabled") {
          await connection.execute<ResultSetHeader>(
            `UPDATE capability_binding
             SET lifecycle_status = 'active',
                 route_policy = JSON_SET(
                   route_policy,
                   '$.dependencyReady',
                   TRUE
                 ),
                 version = version + 1, updated_at = ?
             WHERE workspace_id = ? AND id = ? AND version = ?
               AND lifecycle_status = 'disabled'`,
            [
              options.now,
              options.workspaceId,
              alreadyBound.id,
              alreadyBound.version,
            ],
          );
          affectedBindingIds.push(alreadyBound.id);
        }
        existingBindingCount += 1;
        continue;
      }
      const unbound = group.find((row) => row.routePolicyRevisionId === null);
      if (unbound) {
        const [updated] = await connection.execute<ResultSetHeader>(
          `UPDATE capability_binding
           SET route_policy_revision_id = ?,
               lifecycle_status = 'active',
               route_policy = JSON_SET(
                 route_policy,
                 '$.dependencyReady',
                 TRUE
               ),
               version = version + 1,
               updated_at = ?
           WHERE workspace_id = ?
             AND id = ?
             AND version = ?
             AND lifecycle_status IN ('active', 'disabled')
             AND route_policy_revision_id IS NULL`,
          [
            route.routePolicyRevisionId,
            options.now,
            options.workspaceId,
            unbound.id,
            unbound.version,
          ],
        );
        if (updated.affectedRows !== 1) {
          throw new Error(
            "Provider Capability Binding changed during activation.",
          );
        }
        reboundTemplateCount += 1;
        affectedBindingIds.push(unbound.id);
        continue;
      }
      const source = group[0]!;
      const priority = await nextPriority(
        connection,
        options.workspaceId,
        source.contractRevisionId,
      );
      const bindingId = ulid();
      await connection.execute(
        `INSERT INTO capability_binding (
           id, workspace_id, binding_key, contract_revision_id,
           implementation_revision_id, lifecycle_status,
           priority, version, route_policy,
           route_policy_revision_id, created_at, updated_at
         ) VALUES (
           ?, ?, ?, ?, ?, 'active', ?, 1, ?, ?, ?, ?
         )`,
        [
          bindingId,
          options.workspaceId,
          routedBindingKey(source.bindingKey, bindingId),
          source.contractRevisionId,
          source.implementationRevisionId,
          priority,
          routePolicyJson(source.routePolicy),
          route.routePolicyRevisionId,
          options.now,
          options.now,
        ],
      );
      createdBindingCount += 1;
      affectedBindingIds.push(bindingId);
    }
  }

  if (affectedBindingIds.length > 0) {
    await reconcileCatalogRuntimeInTransaction(connection, {
      workspaceId: options.workspaceId,
      actorPrincipalId: options.actorPrincipalId,
      now: options.now,
    });
  }
  return Object.freeze({
    affectedBindingIds: Object.freeze([...affectedBindingIds].sort()),
    existingBindingCount,
    reboundTemplateCount,
    createdBindingCount,
    unmatchedRouteCount,
  });
}

interface PublishedProviderRouteRow extends RowDataPacket {
  readonly routePolicyRevisionId: string;
  readonly routeDocument: unknown;
  readonly preset: ProviderSettingPreset;
}

export async function reconcilePublishedProviderImageCapabilityBindingsInTransaction(
  connection: PoolConnection,
  options: {
    readonly workspaceId: string;
    readonly actorPrincipalId: string;
    readonly now: Date;
  },
): Promise<ProviderImageCapabilityBindingReconciliation> {
  const [rows] = await connection.execute<PublishedProviderRouteRow[]>(
    `SELECT
         route.id AS routePolicyRevisionId,
         route.route_document AS routeDocument,
         endpoint.preset_kind AS preset
       FROM route_policy_revision AS route
       INNER JOIN model_deployment AS deployment
         ON deployment.workspace_id = route.workspace_id
        AND deployment.id = JSON_UNQUOTE(
          JSON_EXTRACT(
            route.route_document,
            '$.modelDeploymentId'
          )
        )
        AND deployment.lifecycle_status = 'active'
       INNER JOIN provider_endpoint AS endpoint
         ON endpoint.workspace_id = deployment.workspace_id
        AND endpoint.id = deployment.provider_endpoint_id
        AND endpoint.lifecycle_status = 'active'
       WHERE route.workspace_id = ?
         AND route.lifecycle_status = 'published'
         AND route.revision = 1
       ORDER BY route.published_at, route.id
       FOR SHARE`,
    [options.workspaceId],
  );
  const totals = {
    affectedBindingIds: [] as string[],
    existingBindingCount: 0,
    reboundTemplateCount: 0,
    createdBindingCount: 0,
    unmatchedRouteCount: 0,
  };
  for (const row of rows) {
    const route = parseProviderRoutePolicyDocument(
      jsonValue(row.routeDocument),
    );
    if (
      route.capabilityKey !== "image.generate" &&
      route.capabilityKey !== "image.edit"
    ) {
      continue;
    }
    const result = await reconcileProviderImageCapabilityBindingsInTransaction(
      connection,
      {
        workspaceId: options.workspaceId,
        actorPrincipalId: options.actorPrincipalId,
        preset: row.preset,
        routes: Object.freeze([
          Object.freeze({
            routePolicyRevisionId: row.routePolicyRevisionId,
            capabilityKey: route.capabilityKey,
            apiSurface:
              route.apiSurface as ProviderSettingRouteDefinition["apiSurface"],
          }),
        ]),
        now: options.now,
      },
    );
    totals.existingBindingCount += result.existingBindingCount;
    totals.reboundTemplateCount += result.reboundTemplateCount;
    totals.createdBindingCount += result.createdBindingCount;
    totals.unmatchedRouteCount += result.unmatchedRouteCount;
    totals.affectedBindingIds.push(...result.affectedBindingIds);
  }
  return Object.freeze({
    ...totals,
    affectedBindingIds: Object.freeze([...totals.affectedBindingIds].sort()),
  });
}
