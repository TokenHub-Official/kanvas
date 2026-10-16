import type { CurrentProviderRouteSnapshot } from "@kanvas/application";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

import type { ProviderInvocationClaim } from "./provider-invocation-contract.js";
import {
  digestProviderValue,
  ProviderValueCanonicalizationError,
} from "./provider-value-digest.js";
import {
  loadPinnedSecretVersionMetadataInTransaction,
  type PinnedSecretVersionMetadata,
} from "./secret-version-store.js";

const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;

export type ProviderExecutionAdapterKind =
  | "openai_native"
  | "openrouter_native"
  | "openai_compatible"
  | "gemini_native"
  | "anthropic_native";

export type ProviderExecutionPresetKind =
  | "none"
  | "openai"
  | "anthropic"
  | "openrouter"
  | "xai"
  | "gemini"
  | "newapi"
  | "tokenhub";

export interface ProviderEndpointExecutionContext {
  readonly id: string;
  readonly adapterKind: ProviderExecutionAdapterKind;
  readonly presetKind: ProviderExecutionPresetKind;
  readonly baseUrl: string;
  readonly canonicalOrigin: string;
  readonly regionCode: string;
  readonly networkPolicy: Readonly<Record<string, unknown>>;
  readonly dataPolicy: Readonly<Record<string, unknown>>;
}

export interface ProviderModelExecutionContext {
  readonly deploymentId: string;
  readonly providerModelId: string;
  readonly modelProfileRevisionId: string;
  readonly modelProfile: Readonly<Record<string, unknown>>;
}

export interface ProviderPricingExecutionContext {
  readonly revisionId: string;
  readonly currencyCode: string;
  readonly pricing: Readonly<Record<string, unknown>>;
}

export interface ProviderInvocationExecutionContext {
  readonly invocationId: string;
  readonly workspaceId: string;
  readonly route: CurrentProviderRouteSnapshot;
  readonly implementationConfiguration: Readonly<Record<string, unknown>>;
  readonly endpoint: ProviderEndpointExecutionContext;
  readonly model: ProviderModelExecutionContext;
  readonly pricing: ProviderPricingExecutionContext;
  readonly secret: PinnedSecretVersionMetadata;
  readonly budgetReservationId?: string;
}

export interface ResolveProviderInvocationExecutionContextOptions {
  readonly claim: ProviderInvocationClaim;
  readonly now: Date;
}

export interface ProviderExecutionContextStore {
  resolve(
    options: ResolveProviderInvocationExecutionContextOptions,
  ): Promise<ProviderInvocationExecutionContext>;
}

export type ProviderExecutionContextStoreErrorCode =
  | "provider_execution_context.invalid_argument"
  | "provider_execution_context.not_found"
  | "provider_execution_context.identity_conflict"
  | "provider_execution_context.unavailable"
  | "provider_execution_context.integrity_violation";

export class ProviderExecutionContextStoreError extends Error {
  public constructor(
    public readonly code: ProviderExecutionContextStoreErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ProviderExecutionContextStoreError";
  }
}

interface ExecutionContextRow extends RowDataPacket {
  readonly invocationId: string;
  readonly invocationWorkspaceId: string;
  readonly invocationAttemptId: string;
  readonly invocationImplementationRevisionId: string;
  readonly invocationProviderEndpointId: string;
  readonly invocationCredentialIdentityId: string;
  readonly invocationCredentialIdentityEpoch: number;
  readonly invocationPinnedSecretVersionId: string | null;
  readonly invocationModelDeploymentId: string | null;
  readonly invocationPricingRevisionId: string | null;
  readonly invocationBudgetReservationId: string | null;
  readonly invocationRouteCandidateDigest: string;
  readonly invocationRequestFingerprint: string;
  readonly invocationWorkState: string;
  readonly implementationWorkspaceId: string;
  readonly implementationExecutionTarget: string;
  readonly implementationAdapterKey: string;
  readonly implementationCanonicalDigest: string;
  readonly implementationLifecycleStatus: string;
  readonly implementationConfiguration: unknown;
  readonly endpointId: string;
  readonly endpointAdapterKind: ProviderExecutionAdapterKind;
  readonly endpointPresetKind: ProviderExecutionPresetKind;
  readonly endpointBaseUrl: string;
  readonly endpointCanonicalOrigin: string;
  readonly endpointBaseUrlDigest: string;
  readonly endpointRegionCode: string;
  readonly endpointNetworkPolicy: unknown;
  readonly endpointDataPolicy: unknown;
  readonly endpointLifecycleStatus: string;
  readonly endpointValidationStatus: string;
  readonly endpointValidationDigest: string | null;
  readonly credentialProviderKind: string;
  readonly credentialIdentityDigest: string;
  readonly credentialIdentityEpoch: number;
  readonly credentialLifecycleStatus: string;
  readonly modelDeploymentId: string;
  readonly modelProviderEndpointId: string;
  readonly modelProfileRevisionId: string;
  readonly providerModelId: string;
  readonly modelDeploymentDigest: string;
  readonly modelDeploymentLifecycleStatus: string;
  readonly modelProfileDocument: unknown;
  readonly modelProfileCanonicalDigest: string;
  readonly modelProfileLifecycleStatus: string;
  readonly pricingRevisionId: string;
  readonly pricingProviderEndpointId: string;
  readonly pricingModelDeploymentId: string | null;
  readonly pricingCurrencyCode: string;
  readonly pricingDocument: unknown;
  readonly pricingCanonicalDigest: string;
  readonly pricingLifecycleStatus: string;
  readonly pricingVerifiedAt: Date;
  readonly pricingEffectiveAt: Date;
  readonly budgetReservationWorkspaceId: string | null;
  readonly budgetReservationAttemptId: string | null;
  readonly budgetReservationPricingRevisionId: string | null;
  readonly budgetReservationCurrencyCode: string | null;
  readonly budgetReservationLifecycleStatus: string | null;
  readonly hasConfirmedResult?: number | boolean;
}

function fail(
  code: ProviderExecutionContextStoreErrorCode,
  message: string,
  cause?: unknown,
): never {
  throw new ProviderExecutionContextStoreError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}

function assertId(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !idPattern.test(value)) {
    fail(
      "provider_execution_context.invalid_argument",
      `${label} must be a canonical uppercase ULID.`,
    );
  }
}

function assertDate(value: unknown, label: string): asserts value is Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    fail(
      "provider_execution_context.invalid_argument",
      `${label} must be a valid Date.`,
    );
  }
}

function decodeObject(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> {
  let decoded = value;
  if (typeof decoded === "string") {
    try {
      decoded = JSON.parse(decoded) as unknown;
    } catch (error) {
      return fail(
        "provider_execution_context.integrity_violation",
        `${label} is not valid JSON.`,
        error,
      );
    }
  }
  if (
    decoded === null ||
    typeof decoded !== "object" ||
    Array.isArray(decoded) ||
    Object.getPrototypeOf(decoded) !== Object.prototype
  ) {
    return fail(
      "provider_execution_context.integrity_violation",
      `${label} must be a plain JSON object.`,
    );
  }
  return decoded as Readonly<Record<string, unknown>>;
}

function verifyDocumentDigest(
  document: Readonly<Record<string, unknown>>,
  expectedDigest: string,
  label: string,
): void {
  if (!digestPattern.test(expectedDigest)) {
    fail(
      "provider_execution_context.integrity_violation",
      `${label} has an invalid persisted digest.`,
    );
  }
  let actualDigest: string;
  try {
    actualDigest = digestProviderValue(document);
  } catch (error) {
    if (error instanceof ProviderValueCanonicalizationError) {
      return fail(
        "provider_execution_context.integrity_violation",
        `${label} is not canonical JSON.`,
        error,
      );
    }
    throw error;
  }
  if (actualDigest !== expectedDigest) {
    fail(
      "provider_execution_context.integrity_violation",
      `${label} differs from its persisted digest.`,
    );
  }
}

function verifyBaseUrl(row: ExecutionContextRow): void {
  let parsed: URL;
  try {
    parsed = new URL(row.endpointBaseUrl);
  } catch (error) {
    return fail(
      "provider_execution_context.integrity_violation",
      "Provider endpoint base URL is invalid.",
      error,
    );
  }
  if (
    !["https:", "http:"].includes(parsed.protocol) ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.origin !== row.endpointCanonicalOrigin ||
    digestProviderValue({ baseUrl: row.endpointBaseUrl }) !==
      row.endpointBaseUrlDigest
  ) {
    fail(
      "provider_execution_context.integrity_violation",
      "Provider endpoint URL facts are inconsistent.",
    );
  }
}

async function loadContext(
  connection: PoolConnection,
  claim: ProviderInvocationClaim,
): Promise<ExecutionContextRow> {
  const [rows] = await connection.execute<ExecutionContextRow[]>(
    `SELECT
       invocation.id AS invocationId,
       invocation.workspace_id AS invocationWorkspaceId,
       invocation.capability_attempt_id AS invocationAttemptId,
       invocation.implementation_revision_id
         AS invocationImplementationRevisionId,
       invocation.provider_endpoint_id
         AS invocationProviderEndpointId,
       invocation.credential_identity_id
         AS invocationCredentialIdentityId,
       invocation.credential_identity_epoch
         AS invocationCredentialIdentityEpoch,
       invocation.pinned_secret_version_id
         AS invocationPinnedSecretVersionId,
       invocation.model_deployment_id
         AS invocationModelDeploymentId,
       invocation.pricing_revision_id
         AS invocationPricingRevisionId,
       invocation.budget_reservation_id
         AS invocationBudgetReservationId,
       invocation.route_candidate_digest
         AS invocationRouteCandidateDigest,
       invocation.request_fingerprint
         AS invocationRequestFingerprint,
       invocation.work_state AS invocationWorkState,
       implementation.workspace_id AS implementationWorkspaceId,
       implementation.execution_target
         AS implementationExecutionTarget,
       implementation.adapter_key AS implementationAdapterKey,
       implementation.canonical_digest
         AS implementationCanonicalDigest,
       implementation.lifecycle_status
         AS implementationLifecycleStatus,
       implementation.configuration
         AS implementationConfiguration,
       endpoint.id AS endpointId,
       endpoint.adapter_kind AS endpointAdapterKind,
       endpoint.preset_kind AS endpointPresetKind,
       endpoint.base_url AS endpointBaseUrl,
       endpoint.canonical_origin AS endpointCanonicalOrigin,
       endpoint.base_url_digest AS endpointBaseUrlDigest,
       endpoint.region_code AS endpointRegionCode,
       endpoint.network_policy AS endpointNetworkPolicy,
       endpoint.data_policy AS endpointDataPolicy,
       endpoint.lifecycle_status AS endpointLifecycleStatus,
       endpoint.validation_status AS endpointValidationStatus,
       endpoint.validation_digest AS endpointValidationDigest,
       credential.provider_kind AS credentialProviderKind,
       credential.identity_digest AS credentialIdentityDigest,
       credential.identity_epoch AS credentialIdentityEpoch,
       credential.lifecycle_status AS credentialLifecycleStatus,
       model_deployment.id AS modelDeploymentId,
       model_deployment.provider_endpoint_id
         AS modelProviderEndpointId,
       model_deployment.model_profile_revision_id
         AS modelProfileRevisionId,
       model_deployment.provider_model_id AS providerModelId,
       model_deployment.deployment_digest
         AS modelDeploymentDigest,
       model_deployment.lifecycle_status
         AS modelDeploymentLifecycleStatus,
       model_profile.profile_document AS modelProfileDocument,
       model_profile.canonical_digest
         AS modelProfileCanonicalDigest,
       model_profile.lifecycle_status
         AS modelProfileLifecycleStatus,
       pricing.id AS pricingRevisionId,
       pricing.provider_endpoint_id
         AS pricingProviderEndpointId,
       pricing.model_deployment_id
         AS pricingModelDeploymentId,
       pricing.currency_code AS pricingCurrencyCode,
       pricing.pricing_document AS pricingDocument,
       pricing.canonical_digest AS pricingCanonicalDigest,
       pricing.lifecycle_status AS pricingLifecycleStatus,
       pricing.verified_at AS pricingVerifiedAt,
       pricing.effective_at AS pricingEffectiveAt,
       reservation.workspace_id
         AS budgetReservationWorkspaceId,
       reservation.capability_attempt_id
         AS budgetReservationAttemptId,
       reservation.pricing_revision_id
         AS budgetReservationPricingRevisionId,
       reservation.currency_code
         AS budgetReservationCurrencyCode,
       reservation.lifecycle_status
         AS budgetReservationLifecycleStatus,
       EXISTS (SELECT 1 FROM provider_invocation_observation AS observed
         WHERE observed.provider_invocation_id = invocation.id AND observed.workspace_id = invocation.workspace_id
           AND observed.result_facts IS NOT NULL AND observed.normalized_status = 'succeeded' AND observed.adoption_outcome = 'applied') AS hasConfirmedResult
     FROM provider_invocation AS invocation
     INNER JOIN capability_implementation_revision AS implementation
       ON implementation.id =
            invocation.implementation_revision_id
     INNER JOIN provider_endpoint AS endpoint
       ON endpoint.workspace_id = invocation.workspace_id
      AND endpoint.id = invocation.provider_endpoint_id
     INNER JOIN credential
       ON credential.workspace_id = invocation.workspace_id
      AND credential.id = invocation.credential_identity_id
      AND credential.provider_endpoint_id = endpoint.id
     INNER JOIN model_deployment
       ON model_deployment.workspace_id = invocation.workspace_id
      AND model_deployment.id = invocation.model_deployment_id
     INNER JOIN model_profile_revision AS model_profile
       ON model_profile.workspace_id = invocation.workspace_id
      AND model_profile.id =
            model_deployment.model_profile_revision_id
     INNER JOIN pricing_revision AS pricing
       ON pricing.workspace_id = invocation.workspace_id
      AND pricing.id = invocation.pricing_revision_id
     LEFT JOIN budget_reservation AS reservation
       ON reservation.workspace_id = invocation.workspace_id
      AND reservation.id = invocation.budget_reservation_id
     WHERE invocation.workspace_id = ?
       AND invocation.id = ?
       AND invocation.capability_attempt_id = ?
     LIMIT 1
     FOR SHARE`,
    [claim.workspaceId, claim.invocationId, claim.attemptId],
  );
  const row = rows[0];
  if (!row) {
    return fail(
      "provider_execution_context.not_found",
      "Pinned Provider execution context does not exist.",
    );
  }
  return row;
}

function validateIdentity(
  row: ExecutionContextRow,
  claim: ProviderInvocationClaim,
  route: CurrentProviderRouteSnapshot,
): void {
  const expectedWorkState =
    claim.workKind === "submit" ? "submit_leased" : "query_leased";
  if (
    row.invocationId !== claim.invocationId ||
    row.invocationWorkspaceId !== claim.workspaceId ||
    row.invocationAttemptId !== claim.attemptId ||
    row.invocationImplementationRevisionId !== claim.implementationRevisionId ||
    row.invocationProviderEndpointId !== route.providerEndpointId ||
    row.invocationCredentialIdentityId !== route.credentialIdentityId ||
    row.invocationCredentialIdentityEpoch !== route.credentialIdentityEpoch ||
    row.invocationPinnedSecretVersionId !== route.pinnedSecretVersionId ||
    row.invocationModelDeploymentId !== route.modelDeploymentId ||
    row.invocationPricingRevisionId !== route.pricingRevisionId ||
    row.invocationRouteCandidateDigest !== route.routeCandidateDigest ||
    row.invocationRequestFingerprint !== claim.requestFingerprint ||
    row.invocationWorkState !== expectedWorkState ||
    row.implementationWorkspaceId !== claim.workspaceId ||
    row.implementationExecutionTarget !== "provider" ||
    row.implementationAdapterKey !== claim.adapterKey ||
    row.implementationCanonicalDigest !== claim.implementationDigest ||
    !["published", "deprecated"].includes(row.implementationLifecycleStatus) ||
    row.endpointId !== route.providerEndpointId ||
    row.credentialProviderKind !== route.providerKey ||
    row.credentialIdentityDigest !== route.credentialIdentityDigest ||
    row.credentialIdentityEpoch !== route.credentialIdentityEpoch ||
    row.credentialLifecycleStatus !== "active" ||
    row.modelDeploymentId !== route.modelDeploymentId ||
    row.modelProviderEndpointId !== route.providerEndpointId ||
    row.modelProfileRevisionId !== route.modelProfileRevisionId ||
    row.pricingRevisionId !== route.pricingRevisionId ||
    row.pricingProviderEndpointId !== route.providerEndpointId ||
    row.pricingModelDeploymentId !== route.modelDeploymentId ||
    row.pricingCurrencyCode !== route.maximumCharge.currencyCode
  ) {
    fail(
      "provider_execution_context.identity_conflict",
      "Provider execution facts differ from the pinned invocation.",
    );
  }
}

function validateAvailability(
  row: ExecutionContextRow,
  claim: ProviderInvocationClaim,
  now: Date,
): void {
  const endpointAllowed =
    claim.workKind === "submit"
      ? row.endpointLifecycleStatus === "active"
      : ["active", "draining"].includes(row.endpointLifecycleStatus);
  const modelAllowed =
    claim.workKind === "submit"
      ? ["active", "superseded"].includes(row.modelDeploymentLifecycleStatus)
      : ["active", "superseded", "draining"].includes(
          row.modelDeploymentLifecycleStatus,
        );
  if (
    !endpointAllowed ||
    row.endpointValidationStatus !== "passed" ||
    row.endpointValidationDigest === null ||
    !modelAllowed ||
    row.modelProfileLifecycleStatus !== "published" ||
    row.pricingLifecycleStatus !== "published" ||
    row.pricingVerifiedAt.getTime() > now.getTime() ||
    row.pricingEffectiveAt.getTime() > now.getTime()
  ) {
    fail(
      "provider_execution_context.unavailable",
      "Pinned Provider resources are not executable.",
    );
  }
  if (row.invocationBudgetReservationId !== null) {
    if (
      row.budgetReservationWorkspaceId !== claim.workspaceId ||
      row.budgetReservationAttemptId !== claim.attemptId ||
      row.budgetReservationPricingRevisionId !== row.pricingRevisionId ||
      row.budgetReservationCurrencyCode !== row.pricingCurrencyCode ||
      !(
        row.budgetReservationLifecycleStatus === "reserved" ||
        (claim.workKind === "query" &&
          row.hasConfirmedResult &&
          ["settled", "unknown"].includes(
            row.budgetReservationLifecycleStatus ?? "",
          ))
      )
    ) {
      fail(
        "provider_execution_context.identity_conflict",
        "Provider budget reservation does not match the invocation.",
      );
    }
  }
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
      // Preserve the original failure.
    }
    throw error;
  } finally {
    connection.release();
  }
}

export function createProviderExecutionContextStore(
  pool: Pool,
): ProviderExecutionContextStore {
  return Object.freeze({
    async resolve(
      options: ResolveProviderInvocationExecutionContextOptions,
    ): Promise<ProviderInvocationExecutionContext> {
      assertDate(options.now, "now");
      assertId(options.claim.invocationId, "claim.invocationId");
      const route = options.claim.route;
      return inReadTransaction(pool, async (connection) => {
        // Secret read-for-use preserves the global Credential -> Secret lock
        // order before any other mutable Provider fact is inspected.
        const secret = await loadPinnedSecretVersionMetadataInTransaction(
          connection,
          {
            workspaceId: options.claim.workspaceId,
            credentialId: route.credentialIdentityId,
            pinnedSecretVersionId: route.pinnedSecretVersionId,
            expectedCredentialIdentityEpoch: route.credentialIdentityEpoch,
            expectedCredentialIdentityDigest: route.credentialIdentityDigest,
            expectedProviderEndpointId: route.providerEndpointId,
            now: options.now,
          },
        );
        const row = await loadContext(connection, options.claim);
        validateIdentity(row, options.claim, route);
        validateAvailability(row, options.claim, options.now);
        verifyBaseUrl(row);
        if (
          !digestPattern.test(row.endpointValidationDigest ?? "") ||
          !digestPattern.test(row.modelDeploymentDigest)
        ) {
          return fail(
            "provider_execution_context.integrity_violation",
            "Provider validation or deployment digest is invalid.",
          );
        }
        const implementationConfiguration = decodeObject(
          row.implementationConfiguration,
          "Implementation configuration",
        );
        const networkPolicy = decodeObject(
          row.endpointNetworkPolicy,
          "Endpoint network policy",
        );
        const dataPolicy = decodeObject(
          row.endpointDataPolicy,
          "Endpoint data policy",
        );
        const modelProfile = decodeObject(
          row.modelProfileDocument,
          "Model profile",
        );
        const pricing = decodeObject(row.pricingDocument, "Pricing revision");
        verifyDocumentDigest(
          modelProfile,
          row.modelProfileCanonicalDigest,
          "Model profile",
        );
        verifyDocumentDigest(
          pricing,
          row.pricingCanonicalDigest,
          "Pricing revision",
        );

        return Object.freeze({
          invocationId: options.claim.invocationId,
          workspaceId: options.claim.workspaceId,
          route,
          implementationConfiguration,
          endpoint: Object.freeze({
            id: row.endpointId,
            adapterKind: row.endpointAdapterKind,
            presetKind: row.endpointPresetKind,
            baseUrl: row.endpointBaseUrl,
            canonicalOrigin: row.endpointCanonicalOrigin,
            regionCode: row.endpointRegionCode,
            networkPolicy,
            dataPolicy,
          }),
          model: Object.freeze({
            deploymentId: row.modelDeploymentId,
            providerModelId: row.providerModelId,
            modelProfileRevisionId: row.modelProfileRevisionId,
            modelProfile,
          }),
          pricing: Object.freeze({
            revisionId: row.pricingRevisionId,
            currencyCode: row.pricingCurrencyCode,
            pricing,
          }),
          secret,
          ...(row.invocationBudgetReservationId
            ? {
                budgetReservationId: row.invocationBudgetReservationId,
              }
            : {}),
        });
      });
    },
  });
}
