import { agentModelCallAdmitted } from "./agent-model-call-admission.js";
import {
  parseTextGenerationModelProfile,
  type TrustedWorkspaceScope,
  type AgentModelCallPurpose,
} from "@kanvas/application";
import {
  getProviderDefinition,
  type ProviderAgentTextTransport,
  type ProviderDefinitionSlug,
} from "@kanvas/contracts/provider-definition";
import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

import { revalidateTrustedWorkspaceScopeInTransaction } from "./authorization-store.js";
import { digestProviderValue } from "./provider-value-digest.js";
import { normalizeUnsignedDecimal } from "./fixed-decimal.js";
import {
  appendControlPlaneAuditEventInTransaction,
  type ControlPlaneAuditContext,
} from "./control-plane-audit.js";
import {
  loadPinnedSecretVersionMetadataInTransaction,
  type PinnedSecretVersionMetadata,
} from "./secret-version-store.js";

export type AgentModelProtocolKind =
  | "openai_chat"
  | "deepseek_chat"
  | "openai_responses"
  | "gemini_generate_content"
  | "anthropic_messages";

export type AgentModelApiSurface =
  | "chat.completions.v1"
  | "responses.v1"
  | "generate-content.v1"
  | "messages.v1";

export interface ResolveAgentModelBindingOptions {
  readonly purpose?: AgentModelCallPurpose;
  readonly workerClaim?: {
    readonly workerId: string;
    readonly claimTokenDigest: string;
  };
  readonly authority: TrustedWorkspaceScope;
  readonly agentRunId: string;
  readonly bindingKey: string;
  readonly now: Date;
}

export interface AgentModelBindingRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly bindingKey: string;
  readonly modelProfileRevisionId: string;
  readonly modelDeploymentId: string;
  readonly providerEndpointId: string;
  readonly credentialId: string;
  readonly pricingRevisionId: string;
  readonly budgetAccountId: string;
  readonly apiSurface: AgentModelApiSurface;
  readonly protocolKind: AgentModelProtocolKind;
  readonly maximumCharge: {
    readonly currencyCode: string;
    readonly amount: string;
  };
  readonly routeDigest: string;
  readonly lifecycleStatus: "enabled" | "disabled";
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly disabledAt?: Date;
}

export interface ConfigureAgentModelBindingOptions {
  readonly authority: TrustedWorkspaceScope;
  readonly bindingId: string;
  readonly bindingKey: string;
  readonly modelProfileRevisionId: string;
  readonly modelDeploymentId: string;
  readonly providerEndpointId: string;
  readonly credentialId: string;
  readonly pricingRevisionId: string;
  readonly budgetAccountId: string;
  readonly apiSurface: AgentModelApiSurface;
  readonly protocolKind: AgentModelProtocolKind;
  readonly maximumCharge: {
    readonly currencyCode: string;
    readonly amount: string;
  };
  readonly idempotencyKey: string;
  readonly now: Date;
  readonly audit: ControlPlaneAuditContext;
}

export interface DisableAgentModelBindingOptions {
  readonly authority: TrustedWorkspaceScope;
  readonly bindingKey: string;
  readonly expectedVersion: number;
  readonly now: Date;
  readonly audit: ControlPlaneAuditContext;
}

export interface ResolvedAgentModelBinding {
  readonly snapshot: Readonly<Record<string, unknown>>;
  readonly endpoint: {
    readonly id: string;
    readonly adapterKind: string;
    readonly presetKind: string;
    readonly baseUrl: string;
  };
  readonly apiSurface: AgentModelApiSurface;
  readonly protocolKind: AgentModelProtocolKind;
  readonly providerModelId: string;
  readonly modelProfile: Readonly<Record<string, unknown>>;
  readonly pricing: Readonly<Record<string, unknown>>;
  readonly budgetAccountId: string;
  readonly maximumCharge: {
    readonly currencyCode: string;
    readonly amount: string;
  };
  readonly secret: PinnedSecretVersionMetadata;
  readonly executionDeadlineAt: Date;
}

export interface AgentModelBindingStore {
  readonly configure: (
    options: ConfigureAgentModelBindingOptions,
  ) => Promise<AgentModelBindingRecord>;
  readonly disable: (
    options: DisableAgentModelBindingOptions,
  ) => Promise<AgentModelBindingRecord>;
  readonly resolve: (
    options: ResolveAgentModelBindingOptions,
  ) => Promise<ResolvedAgentModelBinding>;
}

export class AgentModelBindingStoreError extends Error {
  public constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AgentModelBindingStoreError";
  }
}

interface BindingRow extends RowDataPacket {
  readonly bindingId: string;
  readonly workspaceId: string;
  readonly bindingKey: string;
  readonly apiSurface: AgentModelApiSurface;
  readonly protocolKind: AgentModelProtocolKind;
  readonly routeDigest: string;
  readonly bindingStatus: string;
  readonly agentRunId: string;
  readonly actorPrincipalId: string;
  readonly agentRunStatus: string;
  readonly executionDeadlineAt: Date;
  readonly modelProfileRevisionId: string;
  readonly profileDocument: unknown;
  readonly profileDigest: string;
  readonly profileStatus: string;
  readonly modelDeploymentId: string;
  readonly modelProviderEndpointId: string;
  readonly providerModelId: string;
  readonly deploymentDigest: string;
  readonly deploymentStatus: string;
  readonly providerEndpointId: string;
  readonly endpointAdapterKind: string;
  readonly endpointPresetKind: string;
  readonly endpointBaseUrl: string;
  readonly endpointCanonicalOrigin: string;
  readonly endpointBaseUrlDigest: string;
  readonly endpointStatus: string;
  readonly endpointValidationStatus: string;
  readonly endpointValidationDigest: string | null;
  readonly credentialId: string;
  readonly credentialProviderKind: string;
  readonly credentialIdentityDigest: string;
  readonly credentialIdentityEpoch: number;
  readonly credentialStatus: string;
  readonly activeSecretVersionId: string | null;
  readonly pricingRevisionId: string;
  readonly pricingCurrencyCode: string;
  readonly pricingDocument: unknown;
  readonly pricingDigest: string;
  readonly pricingStatus: string;
  readonly pricingVerifiedAt: Date;
  readonly pricingEffectiveAt: Date;
  readonly budgetAccountId: string;
  readonly maximumChargeCurrencyCode: string;
  readonly maximumChargeAmount: string;
  readonly budgetStatus: string;
  readonly budgetPeriodStartAt: Date;
  readonly budgetPeriodEndAt: Date;
}

interface BindingConfigurationRow extends RowDataPacket {
  readonly modelProfileRevisionId: string;
  readonly profileDocument: unknown;
  readonly profileDigest: string;
  readonly profileStatus: string;
  readonly modelDeploymentId: string;
  readonly modelProviderEndpointId: string;
  readonly providerModelId: string;
  readonly deploymentStatus: string;
  readonly providerEndpointId: string;
  readonly endpointAdapterKind: string;
  readonly endpointPresetKind: string;
  readonly endpointBaseUrl: string;
  readonly endpointCanonicalOrigin: string;
  readonly endpointBaseUrlDigest: string;
  readonly endpointStatus: string;
  readonly endpointValidationStatus: string;
  readonly endpointValidationDigest: string | null;
  readonly credentialId: string;
  readonly credentialProviderEndpointId: string;
  readonly credentialStatus: string;
  readonly activeSecretVersionId: string | null;
  readonly pricingRevisionId: string;
  readonly pricingCurrencyCode: string;
  readonly pricingDocument: unknown;
  readonly pricingDigest: string;
  readonly pricingStatus: string;
  readonly pricingVerifiedAt: Date;
  readonly pricingEffectiveAt: Date;
  readonly pricingProviderEndpointId: string;
  readonly pricingModelDeploymentId: string;
  readonly budgetAccountId: string;
  readonly budgetCurrencyCode: string;
  readonly budgetStatus: string;
  readonly budgetPeriodStartAt: Date;
  readonly budgetPeriodEndAt: Date;
}

interface StoredBindingRow extends RowDataPacket {
  readonly id: string;
  readonly workspaceId: string;
  readonly bindingKey: string;
  readonly modelProfileRevisionId: string;
  readonly modelDeploymentId: string;
  readonly providerEndpointId: string;
  readonly credentialId: string;
  readonly pricingRevisionId: string;
  readonly budgetAccountId: string;
  readonly maximumChargeCurrencyCode: string;
  readonly maximumChargeAmount: string;
  readonly apiSurface: AgentModelApiSurface;
  readonly protocolKind: AgentModelProtocolKind;
  readonly lifecycleStatus: "enabled" | "disabled";
  readonly routeDigest: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly disabledAt: Date | null;
}

function fail(code: string, message: string): never {
  throw new AgentModelBindingStoreError(code, message);
}

function endpointAgentTextTransports(
  preset: string,
  adapterKind: string,
): readonly ProviderAgentTextTransport[] {
  let definition;
  try {
    definition = getProviderDefinition(preset as ProviderDefinitionSlug);
  } catch {
    return fail(
      "agent_model_binding.unavailable",
      "Provider has no supported Agent text protocol.",
    );
  }
  if (definition.adapterKind !== adapterKind) {
    return fail(
      "agent_model_binding.integrity",
      "Provider Agent text protocol does not match its endpoint.",
    );
  }
  return definition.agentTextTransports;
}

const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const bindingKeyPattern = /^[a-z0-9][a-z0-9._-]{0,95}$/u;
const currencyPattern = /^[A-Z]{3}$/u;

function assertId(value: string, label: string): void {
  if (!idPattern.test(value)) {
    fail("agent_model_binding.invalid", `${label} is invalid.`);
  }
}

function assertBindingKey(value: string): void {
  if (!bindingKeyPattern.test(value)) {
    fail("agent_model_binding.invalid", "Binding key is invalid.");
  }
}

function objectDocument(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> {
  let decoded = value;
  if (typeof decoded === "string") {
    try {
      decoded = JSON.parse(decoded) as unknown;
    } catch {
      return fail("agent_model_binding.integrity", `${label} is invalid JSON.`);
    }
  }
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    return fail("agent_model_binding.integrity", `${label} must be an object.`);
  }
  return decoded as Readonly<Record<string, unknown>>;
}

function verifyUrl(row: BindingRow): void {
  let url: URL;
  try {
    url = new URL(row.endpointBaseUrl);
  } catch {
    return fail("agent_model_binding.integrity", "Endpoint URL is invalid.");
  }
  if (
    url.origin !== row.endpointCanonicalOrigin ||
    digestProviderValue({ baseUrl: row.endpointBaseUrl }) !==
      row.endpointBaseUrlDigest
  ) {
    fail("agent_model_binding.integrity", "Endpoint URL facts differ.");
  }
}

function bindingRecord(row: StoredBindingRow): AgentModelBindingRecord {
  return Object.freeze({
    id: row.id,
    workspaceId: row.workspaceId,
    bindingKey: row.bindingKey,
    modelProfileRevisionId: row.modelProfileRevisionId,
    modelDeploymentId: row.modelDeploymentId,
    providerEndpointId: row.providerEndpointId,
    credentialId: row.credentialId,
    pricingRevisionId: row.pricingRevisionId,
    budgetAccountId: row.budgetAccountId,
    apiSurface: row.apiSurface,
    protocolKind: row.protocolKind,
    maximumCharge: Object.freeze({
      currencyCode: row.maximumChargeCurrencyCode,
      amount: normalizeUnsignedDecimal(
        row.maximumChargeAmount,
        "Agent maximum charge",
      ),
    }),
    routeDigest: row.routeDigest,
    lifecycleStatus: row.lifecycleStatus,
    version: row.version,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
    ...(row.disabledAt ? { disabledAt: new Date(row.disabledAt) } : {}),
  });
}

async function readStoredBindings(
  connection: PoolConnection,
  workspaceId: string,
  options: {
    readonly bindingKey?: string;
    readonly idempotencyKey?: string;
  },
  lock: boolean,
): Promise<readonly StoredBindingRow[]> {
  const clauses: string[] = [];
  const values: string[] = [workspaceId];
  if (options.bindingKey) {
    clauses.push("binding_key = ?");
    values.push(options.bindingKey);
  }
  if (options.idempotencyKey) {
    clauses.push("idempotency_key = ?");
    values.push(options.idempotencyKey);
  }
  if (clauses.length === 0) {
    return fail("agent_model_binding.invalid", "Binding selector is empty.");
  }
  const [rows] = await connection.execute<StoredBindingRow[]>(
    `SELECT
       id,
       workspace_id AS workspaceId,
       binding_key AS bindingKey,
       model_profile_revision_id AS modelProfileRevisionId,
       model_deployment_id AS modelDeploymentId,
       provider_endpoint_id AS providerEndpointId,
       credential_id AS credentialId,
       pricing_revision_id AS pricingRevisionId,
       budget_account_id AS budgetAccountId,
       maximum_charge_currency_code AS maximumChargeCurrencyCode,
       maximum_charge_amount AS maximumChargeAmount,
       api_surface AS apiSurface,
       protocol_kind AS protocolKind,
       lifecycle_status AS lifecycleStatus,
       route_digest AS routeDigest,
       idempotency_key AS idempotencyKey,
       request_hash AS requestHash,
       version,
       created_at AS createdAt,
       updated_at AS updatedAt,
       disabled_at AS disabledAt
     FROM agent_model_binding
     WHERE workspace_id = ? AND (${clauses.join(" OR ")})
     ORDER BY id
     ${lock ? "FOR UPDATE" : "FOR SHARE"}`,
    values,
  );
  return rows;
}

async function inTransaction<TResult>(
  pool: Pool,
  operation: (connection: PoolConnection) => Promise<TResult>,
): Promise<TResult> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await operation(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function readBindingConfiguration(
  connection: PoolConnection,
  options: ConfigureAgentModelBindingOptions,
): Promise<BindingConfigurationRow> {
  const [rows] = await connection.execute<BindingConfigurationRow[]>(
    `SELECT
       profile.id AS modelProfileRevisionId,
       profile.profile_document AS profileDocument,
       profile.canonical_digest AS profileDigest,
       profile.lifecycle_status AS profileStatus,
       deployment.id AS modelDeploymentId,
       deployment.provider_endpoint_id AS modelProviderEndpointId,
       deployment.provider_model_id AS providerModelId,
       deployment.lifecycle_status AS deploymentStatus,
       endpoint.id AS providerEndpointId,
       endpoint.adapter_kind AS endpointAdapterKind,
       endpoint.preset_kind AS endpointPresetKind,
       endpoint.base_url AS endpointBaseUrl,
       endpoint.canonical_origin AS endpointCanonicalOrigin,
       endpoint.base_url_digest AS endpointBaseUrlDigest,
       endpoint.lifecycle_status AS endpointStatus,
       endpoint.validation_status AS endpointValidationStatus,
       endpoint.validation_digest AS endpointValidationDigest,
       credential.id AS credentialId,
       credential.provider_endpoint_id AS credentialProviderEndpointId,
       credential.lifecycle_status AS credentialStatus,
       credential.active_secret_version_id AS activeSecretVersionId,
       pricing.id AS pricingRevisionId,
       pricing.currency_code AS pricingCurrencyCode,
       pricing.pricing_document AS pricingDocument,
       pricing.canonical_digest AS pricingDigest,
       pricing.lifecycle_status AS pricingStatus,
       pricing.verified_at AS pricingVerifiedAt,
       pricing.effective_at AS pricingEffectiveAt,
       pricing.provider_endpoint_id AS pricingProviderEndpointId,
       pricing.model_deployment_id AS pricingModelDeploymentId,
       budget.id AS budgetAccountId,
       budget.currency_code AS budgetCurrencyCode,
       budget.lifecycle_status AS budgetStatus,
       budget.period_start_at AS budgetPeriodStartAt,
       budget.period_end_at AS budgetPeriodEndAt
     FROM model_profile_revision AS profile
     INNER JOIN model_deployment AS deployment
       ON deployment.workspace_id = profile.workspace_id
      AND deployment.id = ?
      AND deployment.model_profile_revision_id = profile.id
     INNER JOIN provider_endpoint AS endpoint
       ON endpoint.workspace_id = profile.workspace_id
      AND endpoint.id = ?
     INNER JOIN credential
       ON credential.workspace_id = profile.workspace_id
      AND credential.id = ?
     INNER JOIN pricing_revision AS pricing
       ON pricing.workspace_id = profile.workspace_id
      AND pricing.id = ?
     INNER JOIN budget_account AS budget
       ON budget.workspace_id = profile.workspace_id
      AND budget.id = ?
     WHERE profile.workspace_id = ?
       AND profile.id = ?
     LIMIT 1
     FOR SHARE`,
    [
      options.modelDeploymentId,
      options.providerEndpointId,
      options.credentialId,
      options.pricingRevisionId,
      options.budgetAccountId,
      options.authority.workspaceId,
      options.modelProfileRevisionId,
    ],
  );
  const row = rows[0];
  if (!row) {
    return fail(
      "agent_model_binding.reference_not_found",
      "Agent Model Binding references were not found in this Workspace.",
    );
  }
  return row;
}

function configurationRouteFacts(
  options: ConfigureAgentModelBindingOptions,
  row: BindingConfigurationRow,
): Readonly<Record<string, unknown>> {
  const profile = objectDocument(row.profileDocument, "Model Profile");
  parseTextGenerationModelProfile(profile);
  const pricing = objectDocument(row.pricingDocument, "Pricing");
  const transports = endpointAgentTextTransports(
    row.endpointPresetKind,
    row.endpointAdapterKind,
  );
  const maximumChargeAmount = normalizeUnsignedDecimal(
    options.maximumCharge.amount,
    "Agent maximum charge",
  );
  let endpointUrl: URL;
  try {
    endpointUrl = new URL(row.endpointBaseUrl);
  } catch {
    return fail("agent_model_binding.integrity", "Endpoint URL is invalid.");
  }
  if (
    row.profileStatus !== "published" ||
    digestProviderValue(profile) !== row.profileDigest ||
    row.deploymentStatus !== "active" ||
    row.modelProviderEndpointId !== row.providerEndpointId ||
    row.credentialProviderEndpointId !== row.providerEndpointId ||
    row.credentialStatus !== "active" ||
    !row.activeSecretVersionId ||
    row.endpointStatus !== "active" ||
    row.endpointValidationStatus !== "passed" ||
    !row.endpointValidationDigest ||
    endpointUrl.origin !== row.endpointCanonicalOrigin ||
    digestProviderValue({ baseUrl: row.endpointBaseUrl }) !==
      row.endpointBaseUrlDigest ||
    row.pricingStatus !== "published" ||
    digestProviderValue(pricing) !== row.pricingDigest ||
    row.pricingProviderEndpointId !== row.providerEndpointId ||
    row.pricingModelDeploymentId !== row.modelDeploymentId ||
    row.pricingVerifiedAt.getTime() > options.now.getTime() ||
    row.pricingEffectiveAt.getTime() > options.now.getTime() ||
    row.budgetStatus !== "active" ||
    row.budgetPeriodStartAt.getTime() > options.now.getTime() ||
    row.budgetPeriodEndAt.getTime() <= options.now.getTime() ||
    options.maximumCharge.currencyCode !== row.pricingCurrencyCode ||
    options.maximumCharge.currencyCode !== row.budgetCurrencyCode ||
    !transports.some(
      (transport) =>
        options.apiSurface === transport.apiSurface &&
        options.protocolKind === transport.protocolKind,
    )
  ) {
    return fail(
      "agent_model_binding.unavailable",
      "Agent Model Binding references are not currently executable.",
    );
  }
  return Object.freeze({
    schemaVersion: 1,
    bindingId: options.bindingId,
    bindingKey: options.bindingKey,
    modelProfileRevisionId: row.modelProfileRevisionId,
    modelDeploymentId: row.modelDeploymentId,
    providerEndpointId: row.providerEndpointId,
    credentialId: row.credentialId,
    pricingRevisionId: row.pricingRevisionId,
    budgetAccountId: row.budgetAccountId,
    maximumCharge: Object.freeze({
      currencyCode: options.maximumCharge.currencyCode,
      amount: maximumChargeAmount,
    }),
    apiSurface: options.apiSurface,
    protocolKind: options.protocolKind,
    providerModelId: row.providerModelId,
  });
}

export function createAgentModelBindingStore(
  pool: Pool,
): AgentModelBindingStore {
  return Object.freeze({
    async configure(
      options: ConfigureAgentModelBindingOptions,
    ): Promise<AgentModelBindingRecord> {
      assertId(options.bindingId, "bindingId");
      assertBindingKey(options.bindingKey);
      assertId(options.modelProfileRevisionId, "modelProfileRevisionId");
      assertId(options.modelDeploymentId, "modelDeploymentId");
      assertId(options.providerEndpointId, "providerEndpointId");
      assertId(options.credentialId, "credentialId");
      assertId(options.pricingRevisionId, "pricingRevisionId");
      assertId(options.budgetAccountId, "budgetAccountId");
      if (
        !currencyPattern.test(options.maximumCharge.currencyCode) ||
        options.idempotencyKey.length < 1 ||
        options.idempotencyKey.length > 160
      ) {
        return fail(
          "agent_model_binding.invalid",
          "Agent Model Binding configuration is invalid.",
        );
      }
      if (
        (options.protocolKind === "openai_chat" &&
          options.apiSurface !== "chat.completions.v1") ||
        (options.protocolKind === "deepseek_chat" &&
          options.apiSurface !== "chat.completions.v1") ||
        (options.protocolKind === "openai_responses" &&
          options.apiSurface !== "responses.v1") ||
        (options.protocolKind === "gemini_generate_content" &&
          options.apiSurface !== "generate-content.v1") ||
        (options.protocolKind === "anthropic_messages" &&
          options.apiSurface !== "messages.v1")
      ) {
        return fail(
          "agent_model_binding.invalid",
          "Agent Model protocol does not match its API surface.",
        );
      }
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.authority,
          "workspace.manage",
          options.now,
        );
        const configuration = await readBindingConfiguration(
          connection,
          options,
        );
        const routeFacts = configurationRouteFacts(options, configuration);
        const routeDigest = digestProviderValue(routeFacts);
        const requestHash = digestProviderValue({
          routeDigest,
          configuredBy: options.authority.principalId,
        });
        const existing = await readStoredBindings(
          connection,
          options.authority.workspaceId,
          {
            bindingKey: options.bindingKey,
            idempotencyKey: options.idempotencyKey,
          },
          true,
        );
        if (existing.length > 0) {
          const replay = existing[0];
          if (
            existing.length !== 1 ||
            !replay ||
            replay.id !== options.bindingId ||
            replay.protocolKind !== options.protocolKind ||
            replay.requestHash !== requestHash ||
            replay.routeDigest !== routeDigest
          ) {
            return fail(
              "agent_model_binding.identity_conflict",
              "Agent Model Binding identity conflicts with existing facts.",
            );
          }
          return bindingRecord(replay);
        }
        const maximumChargeAmount = normalizeUnsignedDecimal(
          options.maximumCharge.amount,
          "Agent maximum charge",
        );
        const [inserted] = await connection.execute<ResultSetHeader>(
          `INSERT INTO agent_model_binding (
             id, workspace_id, binding_key, model_profile_revision_id,
             model_deployment_id, provider_endpoint_id, credential_id,
             budget_account_id, maximum_charge_currency_code,
             maximum_charge_amount, pricing_revision_id, api_surface,
             protocol_kind,
             lifecycle_status, route_digest, idempotency_key, request_hash,
             version, created_by_principal_id, updated_by_principal_id,
             created_at, updated_at, disabled_at
           ) VALUES (
             ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'enabled', ?, ?, ?, 1,
             ?, ?, ?, ?, NULL
           )`,
          [
            options.bindingId,
            options.authority.workspaceId,
            options.bindingKey,
            options.modelProfileRevisionId,
            options.modelDeploymentId,
            options.providerEndpointId,
            options.credentialId,
            options.budgetAccountId,
            options.maximumCharge.currencyCode,
            maximumChargeAmount,
            options.pricingRevisionId,
            options.apiSurface,
            options.protocolKind,
            routeDigest,
            options.idempotencyKey,
            requestHash,
            options.authority.principalId,
            options.authority.principalId,
            options.now,
            options.now,
          ],
        );
        if (inserted.affectedRows !== 1) {
          return fail(
            "agent_model_binding.identity_conflict",
            "Agent Model Binding could not be configured.",
          );
        }
        await appendControlPlaneAuditEventInTransaction(
          connection,
          options.audit,
          {
            organizationId: options.authority.organizationId,
            workspaceId: options.authority.workspaceId,
            eventType: "agent_model_binding.configured",
            action: "configure",
            resourceType: "agent_model_binding",
            resourceId: options.bindingId,
            outcome: "succeeded",
            decisionReasonCode: "agent_model_binding.configured",
            severity: "info",
            authorizationDecision: {
              authorized: true,
              permission: "workspace.manage",
            },
            details: {
              bindingKey: options.bindingKey,
              routeDigest,
              maximumChargeCurrencyCode: options.maximumCharge.currencyCode,
              maximumChargeAmount,
            },
            occurredAt: options.now,
          },
        );
        return Object.freeze({
          id: options.bindingId,
          workspaceId: options.authority.workspaceId,
          bindingKey: options.bindingKey,
          modelProfileRevisionId: options.modelProfileRevisionId,
          modelDeploymentId: options.modelDeploymentId,
          providerEndpointId: options.providerEndpointId,
          credentialId: options.credentialId,
          pricingRevisionId: options.pricingRevisionId,
          budgetAccountId: options.budgetAccountId,
          apiSurface: options.apiSurface,
          protocolKind: options.protocolKind,
          maximumCharge: Object.freeze({
            currencyCode: options.maximumCharge.currencyCode,
            amount: maximumChargeAmount,
          }),
          routeDigest,
          lifecycleStatus: "enabled",
          version: 1,
          createdAt: new Date(options.now),
          updatedAt: new Date(options.now),
        });
      });
    },

    async disable(
      options: DisableAgentModelBindingOptions,
    ): Promise<AgentModelBindingRecord> {
      assertBindingKey(options.bindingKey);
      if (options.expectedVersion < 1) {
        return fail("agent_model_binding.invalid", "Version is invalid.");
      }
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.authority,
          "workspace.manage",
          options.now,
        );
        const rows = await readStoredBindings(
          connection,
          options.authority.workspaceId,
          { bindingKey: options.bindingKey },
          true,
        );
        const binding = rows[0];
        if (!binding) {
          return fail(
            "agent_model_binding.not_found",
            "Agent Model Binding was not found.",
          );
        }
        if (
          binding.lifecycleStatus === "disabled" &&
          binding.version === options.expectedVersion + 1
        ) {
          return bindingRecord(binding);
        }
        if (
          binding.lifecycleStatus !== "enabled" ||
          binding.version !== options.expectedVersion
        ) {
          return fail(
            "agent_model_binding.state_conflict",
            "Agent Model Binding changed before it was disabled.",
          );
        }
        const [updated] = await connection.execute<ResultSetHeader>(
          `UPDATE agent_model_binding
             SET lifecycle_status = 'disabled', version = version + 1,
                 updated_by_principal_id = ?, updated_at = ?, disabled_at = ?
             WHERE workspace_id = ? AND id = ? AND version = ?
               AND lifecycle_status = 'enabled'`,
          [
            options.authority.principalId,
            options.now,
            options.now,
            options.authority.workspaceId,
            binding.id,
            binding.version,
          ],
        );
        if (updated.affectedRows !== 1) {
          return fail(
            "agent_model_binding.state_conflict",
            "Agent Model Binding disable lost optimistic concurrency.",
          );
        }
        await appendControlPlaneAuditEventInTransaction(
          connection,
          options.audit,
          {
            organizationId: options.authority.organizationId,
            workspaceId: options.authority.workspaceId,
            eventType: "agent_model_binding.disabled",
            action: "disable",
            resourceType: "agent_model_binding",
            resourceId: binding.id,
            outcome: "succeeded",
            decisionReasonCode: "agent_model_binding.disabled",
            severity: "info",
            authorizationDecision: {
              authorized: true,
              permission: "workspace.manage",
            },
            details: { bindingKey: binding.bindingKey },
            occurredAt: options.now,
          },
        );
        return bindingRecord({
          ...binding,
          lifecycleStatus: "disabled",
          version: binding.version + 1,
          updatedAt: options.now,
          disabledAt: options.now,
        });
      });
    },

    async resolve(
      options: ResolveAgentModelBindingOptions,
    ): Promise<ResolvedAgentModelBinding> {
      assertBindingKey(options.bindingKey);
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.authority,
          "agent.run",
          options.now,
        );
        const [rows] = await connection.execute<BindingRow[]>(
          `SELECT
             binding.id AS bindingId,
             binding.workspace_id AS workspaceId,
             binding.binding_key AS bindingKey,
             binding.api_surface AS apiSurface,
             binding.protocol_kind AS protocolKind,
             binding.route_digest AS routeDigest,
             binding.lifecycle_status AS bindingStatus,
             agent_run.id AS agentRunId,
             agent_run.actor_principal_id AS actorPrincipalId,
             agent_run.lifecycle_status AS agentRunStatus,
             agent_run.execution_deadline_at AS executionDeadlineAt,
             profile.id AS modelProfileRevisionId,
             profile.profile_document AS profileDocument,
             profile.canonical_digest AS profileDigest,
             profile.lifecycle_status AS profileStatus,
             deployment.id AS modelDeploymentId,
             deployment.provider_endpoint_id AS modelProviderEndpointId,
             deployment.provider_model_id AS providerModelId,
             deployment.deployment_digest AS deploymentDigest,
             deployment.lifecycle_status AS deploymentStatus,
             endpoint.id AS providerEndpointId,
             endpoint.adapter_kind AS endpointAdapterKind,
             endpoint.preset_kind AS endpointPresetKind,
             endpoint.base_url AS endpointBaseUrl,
             endpoint.canonical_origin AS endpointCanonicalOrigin,
             endpoint.base_url_digest AS endpointBaseUrlDigest,
             endpoint.lifecycle_status AS endpointStatus,
             endpoint.validation_status AS endpointValidationStatus,
             endpoint.validation_digest AS endpointValidationDigest,
             credential.id AS credentialId,
             credential.provider_kind AS credentialProviderKind,
             credential.identity_digest AS credentialIdentityDigest,
             credential.identity_epoch AS credentialIdentityEpoch,
             credential.lifecycle_status AS credentialStatus,
             credential.active_secret_version_id AS activeSecretVersionId,
             pricing.id AS pricingRevisionId,
             pricing.currency_code AS pricingCurrencyCode,
             pricing.pricing_document AS pricingDocument,
             pricing.canonical_digest AS pricingDigest,
             pricing.lifecycle_status AS pricingStatus,
             pricing.verified_at AS pricingVerifiedAt,
             pricing.effective_at AS pricingEffectiveAt,
             budget.id AS budgetAccountId,
             binding.maximum_charge_currency_code AS maximumChargeCurrencyCode,
             binding.maximum_charge_amount AS maximumChargeAmount,
             budget.lifecycle_status AS budgetStatus,
             budget.period_start_at AS budgetPeriodStartAt,
             budget.period_end_at AS budgetPeriodEndAt
           FROM agent_model_binding AS binding
           INNER JOIN agent_run
             ON agent_run.workspace_id = binding.workspace_id
            AND agent_run.id = ?
           INNER JOIN model_profile_revision AS profile
             ON profile.workspace_id = binding.workspace_id
            AND profile.id = binding.model_profile_revision_id
           INNER JOIN model_deployment AS deployment
             ON deployment.workspace_id = binding.workspace_id
            AND deployment.id = binding.model_deployment_id
           INNER JOIN provider_endpoint AS endpoint
             ON endpoint.workspace_id = binding.workspace_id
            AND endpoint.id = binding.provider_endpoint_id
           INNER JOIN credential
             ON credential.workspace_id = binding.workspace_id
            AND credential.id = binding.credential_id
           INNER JOIN pricing_revision AS pricing
             ON pricing.workspace_id = binding.workspace_id
            AND pricing.id = binding.pricing_revision_id
           INNER JOIN budget_account AS budget
             ON budget.workspace_id = binding.workspace_id
            AND budget.id = binding.budget_account_id
           WHERE binding.workspace_id = ?
             AND binding.binding_key = ?
           LIMIT 1
           FOR SHARE`,
          [
            options.agentRunId,
            options.authority.workspaceId,
            options.bindingKey,
          ],
        );
        const row = rows[0];
        if (!row) {
          return fail(
            "agent_model_binding.not_found",
            "Agent Model Binding was not found.",
          );
        }
        if (
          row.bindingStatus !== "enabled" ||
          row.agentRunId !== options.agentRunId ||
          row.actorPrincipalId !== options.authority.principalId ||
          !(await agentModelCallAdmitted(connection, {
            ...options,
            workspaceId: options.authority.workspaceId,
            lifecycleStatus: row.agentRunStatus,
            executionDeadlineAt: row.executionDeadlineAt,
          })) ||
          row.profileStatus !== "published" ||
          row.deploymentStatus !== "active" ||
          row.modelProviderEndpointId !== row.providerEndpointId ||
          row.endpointStatus !== "active" ||
          row.endpointValidationStatus !== "passed" ||
          !row.endpointValidationDigest ||
          row.credentialStatus !== "active" ||
          !row.activeSecretVersionId ||
          row.pricingStatus !== "published" ||
          row.pricingVerifiedAt.getTime() > options.now.getTime() ||
          row.pricingEffectiveAt.getTime() > options.now.getTime() ||
          row.budgetStatus !== "active" ||
          row.budgetPeriodStartAt.getTime() > options.now.getTime() ||
          row.budgetPeriodEndAt.getTime() <= options.now.getTime()
        ) {
          return fail(
            "agent_model_binding.unavailable",
            "Agent Model Binding is not currently executable.",
          );
        }
        const profile = objectDocument(row.profileDocument, "Model Profile");
        parseTextGenerationModelProfile(profile);
        if (digestProviderValue(profile) !== row.profileDigest) {
          return fail(
            "agent_model_binding.integrity",
            "Agent Model Profile does not support the bound text surface.",
          );
        }
        const pricing = objectDocument(row.pricingDocument, "Pricing");
        const transports = endpointAgentTextTransports(
          row.endpointPresetKind,
          row.endpointAdapterKind,
        );
        const maximumChargeAmount = normalizeUnsignedDecimal(
          row.maximumChargeAmount,
          "Agent maximum charge",
        );
        if (
          digestProviderValue(pricing) !== row.pricingDigest ||
          row.maximumChargeCurrencyCode !== row.pricingCurrencyCode
        ) {
          return fail(
            "agent_model_binding.integrity",
            "Agent Model pricing differs from its digest.",
          );
        }
        verifyUrl(row);
        if (
          !transports.some(
            (transport) =>
              row.apiSurface === transport.apiSurface &&
              row.protocolKind === transport.protocolKind,
          )
        ) {
          return fail(
            "agent_model_binding.integrity",
            "Agent Model protocol does not match its Provider endpoint.",
          );
        }
        const routeFacts = Object.freeze({
          schemaVersion: 1,
          bindingId: row.bindingId,
          bindingKey: row.bindingKey,
          modelProfileRevisionId: row.modelProfileRevisionId,
          modelDeploymentId: row.modelDeploymentId,
          providerEndpointId: row.providerEndpointId,
          credentialId: row.credentialId,
          pricingRevisionId: row.pricingRevisionId,
          budgetAccountId: row.budgetAccountId,
          maximumCharge: Object.freeze({
            currencyCode: row.maximumChargeCurrencyCode,
            amount: maximumChargeAmount,
          }),
          apiSurface: row.apiSurface,
          protocolKind: row.protocolKind,
          providerModelId: row.providerModelId,
        });
        if (digestProviderValue(routeFacts) !== row.routeDigest) {
          return fail(
            "agent_model_binding.integrity",
            "Agent Model Binding differs from its route digest.",
          );
        }
        const snapshot = Object.freeze({
          ...routeFacts,
          routeDigest: row.routeDigest,
        });
        const secret = await loadPinnedSecretVersionMetadataInTransaction(
          connection,
          {
            workspaceId: row.workspaceId,
            credentialId: row.credentialId,
            pinnedSecretVersionId: row.activeSecretVersionId,
            expectedCredentialIdentityEpoch: row.credentialIdentityEpoch,
            expectedCredentialIdentityDigest: row.credentialIdentityDigest,
            expectedProviderEndpointId: row.providerEndpointId,
            now: options.now,
          },
        );
        return Object.freeze({
          snapshot,
          endpoint: Object.freeze({
            id: row.providerEndpointId,
            adapterKind: row.endpointAdapterKind,
            presetKind: row.endpointPresetKind,
            baseUrl: row.endpointBaseUrl,
          }),
          apiSurface: row.apiSurface,
          protocolKind: row.protocolKind,
          providerModelId: row.providerModelId,
          modelProfile: profile,
          pricing,
          budgetAccountId: row.budgetAccountId,
          maximumCharge: Object.freeze({
            currencyCode: row.maximumChargeCurrencyCode,
            amount: maximumChargeAmount,
          }),
          secret,
          executionDeadlineAt: new Date(row.executionDeadlineAt),
        });
      });
    },
  });
}
