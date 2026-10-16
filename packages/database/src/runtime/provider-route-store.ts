import {
  parseProviderPricingDocumentV1,
  parseProviderRouteSnapshot,
  type CurrentProviderRouteSnapshot,
} from "@kanvas/application";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

import {
  assertProviderRouteAllowed,
  parseProviderDeploymentHardBounds,
  resolveProviderConstraintIntersection,
  type ProviderDeploymentHardBounds,
} from "./configuration-policy.js";
import { resolveActiveProviderPolicySetInTransaction } from "./configuration-provider-store.js";
import { decimalToUnits, normalizeUnsignedDecimal } from "./fixed-decimal.js";
import { digestProviderValue } from "./provider-value-digest.js";

const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;

export interface ResolveProviderRouteOptions {
  readonly workspaceId: string;
  readonly capabilityBindingId: string;
  readonly requestScopeDigest: string;
  readonly now: Date;
}

export interface ProviderRouteStore {
  resolve(
    options: ResolveProviderRouteOptions,
  ): Promise<CurrentProviderRouteSnapshot>;
}

export interface CreateProviderRouteStoreOptions {
  /**
   * Process/deployment hard bounds. These are the first and strongest layer
   * in deployment -> instance -> workspace -> route intersection.
   */
  readonly deploymentHardBounds?: unknown;
}

export type ProviderRouteStoreErrorCode =
  | "provider_route.invalid_argument"
  | "provider_route.not_configured"
  | "provider_route.identity_conflict"
  | "provider_route.unavailable"
  | "provider_route.integrity_violation";

export type ProviderRouteAvailabilityReason =
  | "provider_unconfigured"
  | "provider_unavailable"
  | "credential_unavailable"
  | "budget_unavailable";

export class ProviderRouteStoreError extends Error {
  public constructor(
    public readonly code: ProviderRouteStoreErrorCode,
    message: string,
    options?: ErrorOptions & {
      readonly availabilityReason?: ProviderRouteAvailabilityReason;
    },
  ) {
    super(message, options);
    this.name = "ProviderRouteStoreError";
    this.availabilityReason = options?.availabilityReason;
  }

  public readonly availabilityReason:
    ProviderRouteAvailabilityReason | undefined;
}

interface BindingRouteRow extends RowDataPacket {
  readonly routePolicyRevisionId: string | null;
  readonly lifecycleStatus: string;
}

interface ProviderCandidateRow extends RowDataPacket {
  readonly endpointId: string;
  readonly adapterKind:
    | "openai_native"
    | "openrouter_native"
    | "openai_compatible"
    | "gemini_native"
    | "anthropic_native";
  readonly presetKind:
    | "none"
    | "openai"
    | "anthropic"
    | "openrouter"
    | "xai"
    | "gemini"
    | "newapi"
    | "tokenhub";
  readonly baseUrlDigest: string;
  readonly regionCode: string;
  readonly endpointLifecycleStatus: string;
  readonly endpointValidationStatus: string;
  readonly endpointValidationDigest: string | null;
  readonly credentialId: string;
  readonly providerKind: string;
  readonly credentialIdentityDigest: string;
  readonly credentialIdentityEpoch: number;
  readonly credentialMaterialGeneration: number;
  readonly credentialLifecycleStatus: string;
  readonly activeSecretVersionId: string | null;
  readonly secretVersionId: string;
  readonly secretMaterialGeneration: number;
  readonly secretMaterialFingerprint: string;
  readonly secretLifecycleStatus: string;
  readonly modelDeploymentId: string;
  readonly modelProfileRevisionId: string;
  readonly modelDeploymentDigest: string;
  readonly modelDeploymentLifecycleStatus: string;
  readonly modelProfileSchemaVersion: number;
  readonly modelProfileDocument: unknown;
  readonly modelProfileCanonicalDigest: string;
  readonly modelProfileLifecycleStatus: string;
  readonly pricingRevisionId: string;
  readonly pricingSchemaVersion: number;
  readonly pricingDocument: unknown;
  readonly pricingCanonicalDigest: string;
  readonly pricingCurrencyCode: string;
  readonly pricingLifecycleStatus: string;
  readonly pricingVerifiedAt: Date;
  readonly pricingEffectiveAt: Date;
  readonly budgetAccountId: string;
  readonly budgetCurrencyCode: string;
  readonly budgetPeriodStartAt: Date;
  readonly budgetPeriodEndAt: Date;
  readonly hardLimitAmount: string;
  readonly consumedAmount: string;
  readonly reservedAmount: string;
  readonly unknownHeldAmount: string;
  readonly budgetLifecycleStatus: string;
}

function fail(
  code: ProviderRouteStoreErrorCode,
  message: string,
  cause?: unknown,
  availabilityReason?: ProviderRouteAvailabilityReason,
): never {
  throw new ProviderRouteStoreError(
    code,
    message,
    cause === undefined && availabilityReason === undefined
      ? undefined
      : {
          ...(cause === undefined ? {} : { cause }),
          ...(availabilityReason === undefined ? {} : { availabilityReason }),
        },
  );
}

function invalid(message: string): never {
  return fail("provider_route.invalid_argument", message);
}

function assertId(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !idPattern.test(value)) {
    invalid(`${label} must be a canonical uppercase ULID.`);
  }
}

function assertDigest(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !digestPattern.test(value)) {
    invalid(`${label} must be a canonical SHA-256 digest.`);
  }
}

function assertDate(value: unknown, label: string): asserts value is Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    invalid(`${label} must be a valid Date.`);
  }
}

function decodeJson(value: unknown, label: string): unknown {
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    return fail(
      "provider_route.integrity_violation",
      `${label} is not valid JSON.`,
      error,
    );
  }
}

export function validateProviderPricingForRoute(input: {
  readonly pricingDocument: unknown;
  readonly pricingCurrencyCode: string;
  readonly maximumChargeAmount: string;
  readonly providerPreset?: string;
  readonly apiSurface?: string;
}): void {
  let pricing;
  try {
    pricing = parseProviderPricingDocumentV1(
      decodeJson(input.pricingDocument, "Pricing document"),
    );
  } catch (error) {
    return fail(
      "provider_route.integrity_violation",
      "Provider pricing document is invalid.",
      error,
    );
  }
  if (pricing.billingMode === "unverified") {
    fail(
      "provider_route.unavailable",
      "Provider pricing is not verified for automatic settlement.",
    );
  }
  if (
    pricing.billingMode === "provider_reported" &&
    pricing.currencyCode !== input.pricingCurrencyCode
  ) {
    fail(
      "provider_route.integrity_violation",
      "Provider-reported pricing currency differs from its revision.",
    );
  }
  if (
    pricing.billingMode === "provider_reported" &&
    (input.providerPreset !== "tokenhub" ||
      input.apiSurface !== "generation.tasks.v1")
  ) {
    fail(
      "provider_route.unavailable",
      "Provider-reported pricing has no active exact-charge mapping.",
    );
  }
  if (
    pricing.billingMode === "fixed" &&
    decimalToUnits(pricing.fixedChargeAmount, "fixedChargeAmount") >
      decimalToUnits(input.maximumChargeAmount, "maximumChargeAmount")
  ) {
    fail(
      "provider_route.integrity_violation",
      "Provider fixed charge exceeds the route maximum.",
    );
  }
}

function verifyDocumentDigest(
  documentValue: unknown,
  expectedDigest: string,
  label: string,
): void {
  if (!digestPattern.test(expectedDigest)) {
    return fail(
      "provider_route.integrity_violation",
      `${label} has an invalid persisted digest.`,
    );
  }
  const document = decodeJson(documentValue, label);
  let digest: string;
  try {
    digest = digestProviderValue(document);
  } catch (error) {
    return fail(
      "provider_route.integrity_violation",
      `${label} is not canonical JSON data.`,
      error,
    );
  }
  if (digest !== expectedDigest) {
    fail(
      "provider_route.integrity_violation",
      `${label} differs from its canonical digest.`,
    );
  }
}

async function loadBindingRoutePolicyRevisionId(
  connection: PoolConnection,
  workspaceId: string,
  capabilityBindingId: string,
): Promise<string> {
  const [rows] = await connection.execute<BindingRouteRow[]>(
    `SELECT
       route_policy_revision_id AS routePolicyRevisionId,
       lifecycle_status AS lifecycleStatus
     FROM capability_binding
     WHERE workspace_id = ?
       AND id = ?
     LIMIT 1
     FOR SHARE`,
    [workspaceId, capabilityBindingId],
  );
  const row = rows[0];
  if (!row || row.lifecycleStatus !== "active" || !row.routePolicyRevisionId) {
    return fail(
      "provider_route.not_configured",
      "Capability binding has no active published route policy.",
    );
  }
  if (!idPattern.test(row.routePolicyRevisionId)) {
    return fail(
      "provider_route.integrity_violation",
      "Capability binding route policy identity is invalid.",
    );
  }
  return row.routePolicyRevisionId;
}

async function loadCandidate(
  connection: PoolConnection,
  options: ResolveProviderRouteOptions,
  route: {
    readonly providerEndpointId: string;
    readonly credentialId: string;
    readonly modelDeploymentId: string;
    readonly pricingRevisionId: string;
    readonly budgetAccountId: string;
  },
): Promise<ProviderCandidateRow> {
  const [rows] = await connection.execute<ProviderCandidateRow[]>(
    `SELECT
       endpoint.id AS endpointId,
       endpoint.adapter_kind AS adapterKind,
       endpoint.preset_kind AS presetKind,
       endpoint.base_url_digest AS baseUrlDigest,
       endpoint.region_code AS regionCode,
       endpoint.lifecycle_status AS endpointLifecycleStatus,
       endpoint.validation_status AS endpointValidationStatus,
       endpoint.validation_digest AS endpointValidationDigest,
       credential.id AS credentialId,
       credential.provider_kind AS providerKind,
       credential.identity_digest AS credentialIdentityDigest,
       credential.identity_epoch AS credentialIdentityEpoch,
       credential.material_generation AS credentialMaterialGeneration,
       credential.lifecycle_status AS credentialLifecycleStatus,
       credential.active_secret_version_id AS activeSecretVersionId,
       secret_version.id AS secretVersionId,
       secret_version.material_generation AS secretMaterialGeneration,
       secret_version.material_fingerprint AS secretMaterialFingerprint,
       secret_version.lifecycle_status AS secretLifecycleStatus,
       model_deployment.id AS modelDeploymentId,
       model_deployment.model_profile_revision_id AS modelProfileRevisionId,
       model_deployment.deployment_digest AS modelDeploymentDigest,
       model_deployment.lifecycle_status AS modelDeploymentLifecycleStatus,
       model_profile_revision.schema_version AS modelProfileSchemaVersion,
       model_profile_revision.profile_document AS modelProfileDocument,
       model_profile_revision.canonical_digest AS modelProfileCanonicalDigest,
       model_profile_revision.lifecycle_status AS modelProfileLifecycleStatus,
       pricing_revision.id AS pricingRevisionId,
       pricing_revision.schema_version AS pricingSchemaVersion,
       pricing_revision.pricing_document AS pricingDocument,
       pricing_revision.canonical_digest AS pricingCanonicalDigest,
       pricing_revision.currency_code AS pricingCurrencyCode,
       pricing_revision.lifecycle_status AS pricingLifecycleStatus,
       pricing_revision.verified_at AS pricingVerifiedAt,
       pricing_revision.effective_at AS pricingEffectiveAt,
       budget_account.id AS budgetAccountId,
       budget_account.currency_code AS budgetCurrencyCode,
       budget_account.period_start_at AS budgetPeriodStartAt,
       budget_account.period_end_at AS budgetPeriodEndAt,
       budget_account.hard_limit_amount AS hardLimitAmount,
       budget_account.consumed_amount AS consumedAmount,
       budget_account.reserved_amount AS reservedAmount,
       budget_account.unknown_held_amount AS unknownHeldAmount,
       budget_account.lifecycle_status AS budgetLifecycleStatus
     FROM provider_endpoint AS endpoint
     INNER JOIN credential
       ON credential.workspace_id = endpoint.workspace_id
      AND credential.provider_endpoint_id = endpoint.id
      AND credential.id = ?
     INNER JOIN secret_version
       ON secret_version.workspace_id = credential.workspace_id
      AND secret_version.credential_id = credential.id
      AND secret_version.id = credential.active_secret_version_id
     INNER JOIN model_deployment
       ON model_deployment.workspace_id = endpoint.workspace_id
      AND model_deployment.provider_endpoint_id = endpoint.id
      AND model_deployment.id = ?
     INNER JOIN model_profile_revision
       ON model_profile_revision.workspace_id =
            model_deployment.workspace_id
      AND model_profile_revision.id =
            model_deployment.model_profile_revision_id
     INNER JOIN pricing_revision
       ON pricing_revision.workspace_id = endpoint.workspace_id
      AND pricing_revision.provider_endpoint_id = endpoint.id
      AND pricing_revision.model_deployment_id =
            model_deployment.id
      AND pricing_revision.id = ?
     INNER JOIN budget_account
       ON budget_account.workspace_id = endpoint.workspace_id
      AND budget_account.id = ?
     WHERE endpoint.workspace_id = ?
       AND endpoint.id = ?
     LIMIT 1
     FOR SHARE`,
    [
      route.credentialId,
      route.modelDeploymentId,
      route.pricingRevisionId,
      route.budgetAccountId,
      options.workspaceId,
      route.providerEndpointId,
    ],
  );
  const candidate = rows[0];
  if (!candidate) {
    return fail(
      "provider_route.not_configured",
      "Route candidate references missing or cross-workspace resources.",
    );
  }
  return candidate;
}

export function providerRouteModelProfileSchemaSupported(
  schemaVersion: number,
): boolean {
  return schemaVersion === 1;
}

function validateCandidate(
  candidate: ProviderCandidateRow,
  route: {
    readonly providerKey: string;
    readonly apiSurface: string;
    readonly maximumCharge: {
      readonly currencyCode: string;
      readonly amount: string;
    };
  },
  now: Date,
): void {
  const endpointReady =
    candidate.endpointLifecycleStatus === "active" &&
    candidate.endpointValidationStatus === "passed" &&
    candidate.endpointValidationDigest !== null;
  const credentialReady =
    candidate.credentialLifecycleStatus === "active" &&
    candidate.providerKind === route.providerKey &&
    candidate.activeSecretVersionId === candidate.secretVersionId &&
    candidate.secretLifecycleStatus === "active" &&
    candidate.credentialMaterialGeneration ===
      candidate.secretMaterialGeneration;
  const modelReady =
    candidate.modelDeploymentLifecycleStatus === "active" &&
    providerRouteModelProfileSchemaSupported(
      candidate.modelProfileSchemaVersion,
    ) &&
    candidate.modelProfileLifecycleStatus === "published";
  const pricingReady =
    candidate.pricingSchemaVersion === 1 &&
    candidate.pricingLifecycleStatus === "published" &&
    candidate.pricingVerifiedAt.getTime() <= now.getTime() &&
    candidate.pricingEffectiveAt.getTime() <= now.getTime();
  const currencyReady =
    route.maximumCharge.currencyCode === candidate.pricingCurrencyCode &&
    candidate.pricingCurrencyCode === candidate.budgetCurrencyCode;
  const budgetReady =
    candidate.budgetLifecycleStatus === "active" &&
    candidate.budgetPeriodStartAt.getTime() <= now.getTime() &&
    candidate.budgetPeriodEndAt.getTime() > now.getTime();
  if (!credentialReady) {
    fail(
      "provider_route.unavailable",
      "A pinned provider credential is not currently dispatchable.",
      undefined,
      "credential_unavailable",
    );
  }
  if (!budgetReady) {
    fail(
      "provider_route.unavailable",
      "A pinned provider budget is not currently available.",
      undefined,
      "budget_unavailable",
    );
  }
  if (!endpointReady || !modelReady || !pricingReady || !currencyReady) {
    fail(
      "provider_route.unavailable",
      "A pinned provider resource is not currently dispatchable.",
      undefined,
      "provider_unavailable",
    );
  }
  verifyDocumentDigest(
    candidate.modelProfileDocument,
    candidate.modelProfileCanonicalDigest,
    "Model profile document",
  );
  verifyDocumentDigest(
    candidate.pricingDocument,
    candidate.pricingCanonicalDigest,
    "Pricing document",
  );
  validateProviderPricingForRoute({
    pricingDocument: candidate.pricingDocument,
    pricingCurrencyCode: candidate.pricingCurrencyCode,
    maximumChargeAmount: route.maximumCharge.amount,
    providerPreset: candidate.presetKind,
    apiSurface: route.apiSurface,
  });
  if (
    !digestPattern.test(candidate.baseUrlDigest) ||
    !digestPattern.test(candidate.endpointValidationDigest ?? "") ||
    !digestPattern.test(candidate.credentialIdentityDigest) ||
    !digestPattern.test(candidate.secretMaterialFingerprint) ||
    !digestPattern.test(candidate.modelDeploymentDigest)
  ) {
    fail(
      "provider_route.integrity_violation",
      "Provider candidate contains an invalid persisted digest.",
    );
  }
  const hard = decimalToUnits(candidate.hardLimitAmount, "hardLimitAmount");
  const consumed = decimalToUnits(candidate.consumedAmount, "consumedAmount");
  const reserved = decimalToUnits(candidate.reservedAmount, "reservedAmount");
  const unknown = decimalToUnits(
    candidate.unknownHeldAmount,
    "unknownHeldAmount",
  );
  const maximumCharge = decimalToUnits(
    route.maximumCharge.amount,
    "maximumCharge",
  );
  if (consumed + reserved + unknown + maximumCharge > hard) {
    fail(
      "provider_route.unavailable",
      "Budget cannot cover the route's maximum charge.",
      undefined,
      "budget_unavailable",
    );
  }
}

function candidateDigestFor(value: {
  readonly policy: {
    readonly instanceId: string;
    readonly instanceDigest: string;
    readonly workspaceId: string;
    readonly workspaceDigest: string;
    readonly routeId: string;
    readonly routeDigest: string;
  };
  readonly candidate: ProviderCandidateRow;
  readonly providerKey: string;
  readonly apiSurface: string;
  readonly routingMode: string;
  readonly executionTransparency: string;
  readonly maximumCharge: {
    readonly currencyCode: string;
    readonly amount: string;
  };
  readonly queryMode: string;
  readonly notFoundIsAuthoritative: boolean;
}): string {
  return digestProviderValue({
    schemaVersion: 1,
    domain: "kanvas.provider-route-candidate.v1",
    providerKey: value.providerKey,
    apiSurface: value.apiSurface,
    providerEndpointId: value.candidate.endpointId,
    endpointBaseUrlDigest: value.candidate.baseUrlDigest,
    endpointValidationDigest: value.candidate.endpointValidationDigest,
    credentialIdentityId: value.candidate.credentialId,
    credentialIdentityEpoch: value.candidate.credentialIdentityEpoch,
    credentialIdentityDigest: value.candidate.credentialIdentityDigest,
    pinnedSecretVersionId: value.candidate.secretVersionId,
    secretMaterialFingerprint: value.candidate.secretMaterialFingerprint,
    modelProfileRevisionId: value.candidate.modelProfileRevisionId,
    modelProfileCanonicalDigest: value.candidate.modelProfileCanonicalDigest,
    modelDeploymentId: value.candidate.modelDeploymentId,
    modelDeploymentDigest: value.candidate.modelDeploymentDigest,
    pricingRevisionId: value.candidate.pricingRevisionId,
    pricingCanonicalDigest: value.candidate.pricingCanonicalDigest,
    budgetAccountId: value.candidate.budgetAccountId,
    instancePolicyRevisionId: value.policy.instanceId,
    instancePolicyDigest: value.policy.instanceDigest,
    workspacePolicyRevisionId: value.policy.workspaceId,
    workspacePolicyDigest: value.policy.workspaceDigest,
    routePolicyRevisionId: value.policy.routeId,
    routePolicyDigest: value.policy.routeDigest,
    routingMode: value.routingMode,
    executionTransparency: value.executionTransparency,
    maximumCharge: value.maximumCharge,
    queryMode: value.queryMode,
    notFoundIsAuthoritative: value.notFoundIsAuthoritative,
  });
}

export async function resolveProviderRouteInTransaction(
  connection: PoolConnection,
  deploymentHardBounds: ProviderDeploymentHardBounds | undefined,
  options: ResolveProviderRouteOptions,
): Promise<CurrentProviderRouteSnapshot> {
  assertId(options.workspaceId, "workspaceId");
  assertId(options.capabilityBindingId, "capabilityBindingId");
  assertDigest(options.requestScopeDigest, "requestScopeDigest");
  assertDate(options.now, "now");

  const routePolicyRevisionId = await loadBindingRoutePolicyRevisionId(
    connection,
    options.workspaceId,
    options.capabilityBindingId,
  );
  const policy = await resolveActiveProviderPolicySetInTransaction(
    connection,
    options.workspaceId,
    routePolicyRevisionId,
  );
  const route = policy.route.route;
  const candidate = await loadCandidate(connection, options, route);
  // With no operator overlay, evaluate this exact persisted route against all
  // instance/workspace/route restrictions. Never invent an unrestricted policy.
  const constraints = resolveProviderConstraintIntersection(
    deploymentHardBounds ?? {
      allowedAdapterKinds: [candidate.adapterKind],
      allowedPresetKinds: [candidate.presetKind],
      allowedRegionCodes: [candidate.regionCode],
      allowedProviderEndpointIds: [candidate.endpointId],
      allowedRoutingModes: [route.routingMode],
      allowedExecutionTransparencies: [route.executionTransparency],
      maximumCharge: route.maximumCharge,
      maxProviderRequestSeconds: route.requestTimeoutSeconds,
    },
    policy.instance.policyRevision.policy,
    policy.workspace.policyRevision.policy,
    route.constraints,
  );
  assertProviderRouteAllowed(
    route,
    {
      id: candidate.endpointId,
      adapterKind: candidate.adapterKind,
      presetKind: candidate.presetKind,
      regionCode: candidate.regionCode,
    },
    constraints,
  );
  validateCandidate(candidate, route, options.now);

  const maximumCharge = Object.freeze({
    currencyCode: route.maximumCharge.currencyCode,
    amount: normalizeUnsignedDecimal(
      route.maximumCharge.amount,
      "maximumCharge.amount",
    ),
  });
  const routeCandidateDigest = candidateDigestFor({
    policy: {
      instanceId: policy.instance.policyRevision.id,
      instanceDigest: policy.instance.policyRevision.canonicalDigest,
      workspaceId: policy.workspace.policyRevision.id,
      workspaceDigest: policy.workspace.policyRevision.canonicalDigest,
      routeId: policy.route.id,
      routeDigest: policy.route.canonicalDigest,
    },
    candidate,
    providerKey: route.providerKey,
    apiSurface: route.apiSurface,
    routingMode: route.routingMode,
    executionTransparency: route.executionTransparency,
    maximumCharge,
    queryMode: route.queryMode,
    notFoundIsAuthoritative: route.notFoundIsAuthoritative,
  });
  const parsed = parseProviderRouteSnapshot({
    providerProtocolVersion: 1,
    providerKey: route.providerKey,
    apiSurface: route.apiSurface,
    providerEndpointId: candidate.endpointId,
    credentialIdentityId: candidate.credentialId,
    credentialIdentityEpoch: candidate.credentialIdentityEpoch,
    pinnedSecretVersionId: candidate.secretVersionId,
    credentialIdentityDigest: candidate.credentialIdentityDigest,
    instancePolicyRevisionId: policy.instance.policyRevision.id,
    workspacePolicyRevisionId: policy.workspace.policyRevision.id,
    routePolicyRevisionId: policy.route.id,
    modelProfileRevisionId: candidate.modelProfileRevisionId,
    modelDeploymentId: candidate.modelDeploymentId,
    pricingRevisionId: candidate.pricingRevisionId,
    budgetAccountId: candidate.budgetAccountId,
    routingMode: route.routingMode,
    executionTransparency: route.executionTransparency,
    maximumCharge,
    ...(route.capabilityKey && route.parameterPolicies
      ? {
          modelOperation:
            route.capabilityKey === "image.generate" ||
            route.capabilityKey === "image.edit"
              ? route.capabilityKey
              : fail(
                  "provider_route.integrity_violation",
                  "Provider image route contains an unsupported model operation.",
                ),
          parameterPolicies: route.parameterPolicies,
          parameterPolicyDigest: digestProviderValue(route.parameterPolicies),
        }
      : {}),
    routeCandidateDigest,
    requestScopeDigest: options.requestScopeDigest,
    queryMode: route.queryMode,
    notFoundIsAuthoritative: route.notFoundIsAuthoritative,
  });
  if (parsed.providerProtocolVersion !== 1) {
    return fail(
      "provider_route.integrity_violation",
      "Application route parser did not return protocol v1.",
    );
  }
  return parsed;
}

async function inReadTransaction<TResult>(
  pool: Pool,
  work: (connection: PoolConnection) => Promise<TResult>,
): Promise<TResult> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Preserve the original domain/database failure.
    }
    throw error;
  } finally {
    connection.release();
  }
}

export function createProviderRouteStore(
  pool: Pool,
  options: CreateProviderRouteStoreOptions,
): ProviderRouteStore {
  const deploymentHardBounds =
    options.deploymentHardBounds === undefined
      ? undefined
      : parseProviderDeploymentHardBounds(options.deploymentHardBounds);
  return Object.freeze({
    async resolve(
      resolveOptions: ResolveProviderRouteOptions,
    ): Promise<CurrentProviderRouteSnapshot> {
      return inReadTransaction(pool, (connection) =>
        resolveProviderRouteInTransaction(
          connection,
          deploymentHardBounds,
          resolveOptions,
        ),
      );
    },
  });
}
