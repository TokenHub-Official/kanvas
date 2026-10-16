#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

import {
  parseModelProfileDocumentV1,
  parseProviderPricingDocumentV1,
} from "@kanvas/application";
import { createDatabaseRuntime } from "@kanvas/database";
import { digestProviderValue } from "@kanvas/database/runtime";
import {
  createPool,
  type Pool,
  type PoolConnection,
  type RowDataPacket,
} from "mysql2/promise";
import { ulid } from "ulid";

import { loadServerConfig } from "../config.js";

interface BootstrapDocument {
  readonly schemaVersion: 1;
  readonly providerSettingId: string;
  readonly bindingKey: string;
  readonly providerModelId: string;
  readonly displayName: string;
  readonly modelFamily: string;
  readonly apiSurface:
    | "chat.completions.v1"
    | "responses.v1"
    | "generate-content.v1"
    | "messages.v1";
  readonly protocolKind:
    | "openai_chat"
    | "deepseek_chat"
    | "openai_responses"
    | "gemini_generate_content"
    | "anthropic_messages";
  readonly supportsReasoning?: boolean;
  readonly supportsWebSearch?: boolean;
  readonly pricing: {
    readonly currencyCode: "USD";
    readonly inputPerMillion: string;
    readonly outputPerMillion: string;
    readonly sourceReference: string;
    readonly sourceDigest: string;
  };
  readonly maximumChargeAmount: string;
}

interface ProviderSettingRow extends RowDataPacket {
  readonly workspaceId: string;
  readonly organizationId: string;
  readonly providerEndpointId: string;
  readonly credentialId: string;
  readonly budgetAccountId: string;
  readonly endpointStatus: string;
  readonly endpointValidationStatus: string;
  readonly credentialStatus: string;
  readonly budgetStatus: string;
  readonly budgetCurrencyCode: string;
  readonly catalogDocument: unknown;
}

interface AdministratorRow extends RowDataPacket {
  readonly authSubjectId: string;
}

interface RevisionRow extends RowDataPacket {
  readonly id: string;
  readonly canonicalDigest: string;
}

interface DeploymentRow extends RowDataPacket {
  readonly id: string;
  readonly modelProfileRevisionId: string;
  readonly providerEndpointId: string;
  readonly providerModelId: string;
  readonly deploymentDigest: string;
}

interface BindingRow extends RowDataPacket {
  readonly id: string;
}

const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const keyPattern = /^[a-z0-9][a-z0-9._-]{0,95}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const decimalPattern = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,12})?$/u;

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1]?.trim() : undefined;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Agent text binding bootstrap config must be an object.");
  }
  return value as Readonly<Record<string, unknown>>;
}

function text(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string") throw new Error(`${label} is invalid.`);
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (normalized.length < 1 || normalized.length > maximum) {
    throw new Error(`${label} is invalid.`);
  }
  return normalized;
}

function protocolKind(
  value: unknown,
  apiSurface: unknown,
  modelFamily: string,
  providerModelId: string,
): BootstrapDocument["protocolKind"] {
  const allowed = new Set<BootstrapDocument["protocolKind"]>([
    "openai_chat",
    "deepseek_chat",
    "openai_responses",
    "gemini_generate_content",
    "anthropic_messages",
  ]);
  if (typeof value === "string") {
    if (allowed.has(value as BootstrapDocument["protocolKind"])) {
      return value as BootstrapDocument["protocolKind"];
    }
    throw new Error("Agent text binding protocol is invalid.");
  }
  if (value !== undefined) {
    throw new Error("Agent text binding protocol is invalid.");
  }
  if (apiSurface === "responses.v1") return "openai_responses";
  if (apiSurface === "generate-content.v1") {
    return "gemini_generate_content";
  }
  if (apiSurface === "messages.v1") return "anthropic_messages";
  return modelFamily.toLowerCase().startsWith("deepseek") ||
    providerModelId.toLowerCase().includes("deepseek")
    ? "deepseek_chat"
    : "openai_chat";
}

function parseDocument(value: unknown): BootstrapDocument {
  const candidate = record(value);
  const pricing = record(candidate.pricing);
  const providerSettingId = text(
    candidate.providerSettingId,
    "providerSettingId",
    26,
  );
  const bindingKey = text(candidate.bindingKey, "bindingKey", 96);
  const providerModelId = text(
    candidate.providerModelId,
    "providerModelId",
    512,
  );
  const displayName = text(candidate.displayName, "displayName", 160);
  const modelFamily = text(candidate.modelFamily, "modelFamily", 160);
  const inputPerMillion = text(pricing.inputPerMillion, "inputPerMillion", 48);
  const outputPerMillion = text(
    pricing.outputPerMillion,
    "outputPerMillion",
    48,
  );
  const sourceReference = text(pricing.sourceReference, "sourceReference", 500);
  const sourceDigest = text(pricing.sourceDigest, "sourceDigest", 71);
  const maximumChargeAmount = text(
    candidate.maximumChargeAmount,
    "maximumChargeAmount",
    48,
  );
  if (
    candidate.schemaVersion !== 1 ||
    !idPattern.test(providerSettingId) ||
    !keyPattern.test(bindingKey) ||
    ![
      "chat.completions.v1",
      "responses.v1",
      "generate-content.v1",
      "messages.v1",
    ].includes(String(candidate.apiSurface)) ||
    pricing.currencyCode !== "USD" ||
    !decimalPattern.test(inputPerMillion) ||
    !decimalPattern.test(outputPerMillion) ||
    !decimalPattern.test(maximumChargeAmount) ||
    !digestPattern.test(sourceDigest)
  ) {
    throw new Error("Agent text binding bootstrap config is invalid.");
  }
  const resolvedProtocolKind = protocolKind(
    candidate.protocolKind,
    candidate.apiSurface,
    modelFamily,
    providerModelId,
  );
  if (
    candidate.supportsWebSearch === true &&
    candidate.apiSurface !== "responses.v1" &&
    candidate.apiSurface !== "messages.v1"
  ) {
    throw new Error(
      "Agent Web Search requires a Provider-native search API surface.",
    );
  }
  return Object.freeze({
    schemaVersion: 1,
    providerSettingId,
    bindingKey,
    providerModelId,
    displayName,
    modelFamily,
    apiSurface: candidate.apiSurface as BootstrapDocument["apiSurface"],
    protocolKind: resolvedProtocolKind,
    ...(candidate.supportsReasoning === true
      ? { supportsReasoning: true }
      : {}),
    ...(candidate.supportsWebSearch === true
      ? { supportsWebSearch: true }
      : {}),
    pricing: Object.freeze({
      currencyCode: "USD",
      inputPerMillion,
      outputPerMillion,
      sourceReference,
      sourceDigest,
    }),
    maximumChargeAmount,
  });
}

async function providerSetting(
  pool: Pool,
  workspaceId: string,
  id: string,
): Promise<ProviderSettingRow> {
  const [rows] = await pool.execute<ProviderSettingRow[]>(
    `SELECT
       setting.workspace_id AS workspaceId,
       workspace.organization_id AS organizationId,
       setting.provider_endpoint_id AS providerEndpointId,
       setting.credential_id AS credentialId,
       setting.budget_account_id AS budgetAccountId,
       endpoint.lifecycle_status AS endpointStatus,
       endpoint.validation_status AS endpointValidationStatus,
       credential.lifecycle_status AS credentialStatus,
       budget.lifecycle_status AS budgetStatus,
       budget.currency_code AS budgetCurrencyCode,
       catalog.catalog_document AS catalogDocument
     FROM provider_setting AS setting
     INNER JOIN workspace ON workspace.id = setting.workspace_id
     INNER JOIN provider_endpoint AS endpoint
       ON endpoint.workspace_id = setting.workspace_id
      AND endpoint.id = setting.provider_endpoint_id
     INNER JOIN credential
       ON credential.workspace_id = setting.workspace_id
      AND credential.id = setting.credential_id
     INNER JOIN budget_account AS budget
       ON budget.workspace_id = setting.workspace_id
      AND budget.id = setting.budget_account_id
     INNER JOIN provider_model_catalog_snapshot AS catalog
       ON catalog.workspace_id = setting.workspace_id
      AND catalog.provider_setting_id = setting.id
      AND catalog.revision = (
        SELECT MAX(latest.revision)
        FROM provider_model_catalog_snapshot AS latest
        WHERE latest.workspace_id = setting.workspace_id
          AND latest.provider_setting_id = setting.id
      )
     WHERE setting.workspace_id = ? AND setting.id = ?
     LIMIT 1`,
    [workspaceId, id],
  );
  const row = rows[0];
  if (
    !row ||
    row.endpointStatus !== "active" ||
    row.endpointValidationStatus !== "passed" ||
    row.credentialStatus !== "active" ||
    row.budgetStatus !== "active" ||
    row.budgetCurrencyCode !== "USD"
  ) {
    throw new Error("Selected Provider Setting is not ready for Agent use.");
  }
  return row;
}

function catalogHasModel(catalogDocument: unknown, providerModelId: string) {
  const catalog =
    typeof catalogDocument === "string"
      ? record(JSON.parse(catalogDocument) as unknown)
      : record(catalogDocument);
  return (
    Array.isArray(catalog.models) &&
    catalog.models.some((value) => {
      const model = record(value);
      return model.providerModelId === providerModelId;
    })
  );
}

async function administratorSubject(
  pool: Pool,
  workspaceId: string,
): Promise<string> {
  const [rows] = await pool.execute<AdministratorRow[]>(
    `SELECT human.auth_subject_id AS authSubjectId
     FROM instance_administrator AS administrator
     INNER JOIN human_principal AS human
       ON human.principal_id = administrator.principal_id
     INNER JOIN workspace_membership AS membership
       ON membership.principal_id = administrator.principal_id
      AND membership.workspace_id = ?
      AND membership.status = 'active'
     WHERE administrator.status = 'active'
     ORDER BY administrator.principal_id
     LIMIT 1`,
    [workspaceId],
  );
  const authSubjectId = rows[0]?.authSubjectId;
  if (!authSubjectId) throw new Error("Workspace administrator is missing.");
  return authSubjectId;
}

async function readRevision(
  connection: PoolConnection,
  table: "model_profile_revision" | "pricing_revision",
  keyColumn: "profile_key" | "pricing_key",
  workspaceId: string,
  key: string,
): Promise<RevisionRow | undefined> {
  const [rows] = await connection.query<RevisionRow[]>(
    `SELECT id, canonical_digest AS canonicalDigest
     FROM ${table}
     WHERE workspace_id = ? AND ${keyColumn} = ? AND revision = 1
     LIMIT 1
     FOR UPDATE`,
    [workspaceId, key],
  );
  return rows[0];
}

const server = loadServerConfig(process.env, []);
if (server.environment !== "development") {
  throw new Error("Agent text binding bootstrap is development-only.");
}
const configPath = argument("--config");
if (!configPath || !isAbsolute(configPath)) {
  throw new Error("Pass an absolute bootstrap JSON file with --config.");
}
const document = parseDocument(
  JSON.parse(await readFile(configPath, "utf8")) as unknown,
);
const database = createDatabaseRuntime({
  connection: server.database,
  instanceId: server.instanceId,
  enabledExecutionTargets: server.enabledExecutionTargets,
  ...(server.agentDevelopmentSkillFiles
    ? { agentDevelopmentSkillFiles: server.agentDevelopmentSkillFiles }
    : {}),
});
const pool = createPool({
  ...server.database,
  connectionLimit: 2,
  timezone: "Z",
  decimalNumbers: false,
  supportBigNumbers: true,
  bigNumberStrings: true,
});
try {
  const now = new Date();
  const setting = await providerSetting(
    pool,
    server.demo.workspaceId,
    document.providerSettingId,
  );
  if (!catalogHasModel(setting.catalogDocument, document.providerModelId)) {
    throw new Error("Selected Agent model is absent from the latest catalog.");
  }
  const authSubjectId = await administratorSubject(pool, setting.workspaceId);
  const resolution = await database.authorization.resolveHumanWorkspaceScope({
    authSubjectId,
    sessionId: "agent-text-binding-bootstrap",
    requestedWorkspaceId: setting.workspaceId,
    requiredPermission: "workspace.manage",
    now,
  });
  if (resolution.status !== "authorized") {
    throw new Error("Agent text binding bootstrap is not authorized.");
  }
  const sourceEvidence = Object.freeze([
    Object.freeze({
      kind: "administrator" as const,
      reference: document.pricing.sourceReference,
      observedAt: now.toISOString(),
      sourceDigest: document.pricing.sourceDigest,
      confidence: "high" as const,
      claim: "supported" as const,
    }),
  ]);
  const modelProfileDocument = parseModelProfileDocumentV1({
    schemaVersion: 1,
    model: {
      displayName: document.displayName,
      family: document.modelFamily,
      inputModalities: ["text"],
      outputModalities: ["text"],
      ...(document.supportsReasoning ? { reasoning: true } : {}),
      toolCall: true,
    },
    operations: {
      "text.generate": {
        parameters: [
          ...(document.supportsReasoning
            ? [
                {
                  key: "reasoningEffort",
                  label: "Reasoning effort",
                  description:
                    "Controls the bounded reasoning effort used by the Agent model.",
                  valueType: "enum" as const,
                  values: ["low", "medium", "high"],
                  required: false,
                  evidence: sourceEvidence,
                },
              ]
            : []),
          ...(document.supportsWebSearch
            ? [
                {
                  key: "webSearch",
                  label: "Web search",
                  description:
                    "Allows current public web research with structured citations.",
                  valueType: "boolean" as const,
                  required: false,
                  evidence: sourceEvidence,
                },
              ]
            : []),
        ],
        evidence: sourceEvidence,
      },
    },
    sources: [
      {
        kind: "manual",
        reference: document.pricing.sourceReference,
        observedAt: now.toISOString(),
        sourceDigest: document.pricing.sourceDigest,
      },
    ],
  });
  const pricingDocument = parseProviderPricingDocumentV1({
    schemaVersion: 1,
    billingMode: "metered",
    rates: [
      {
        metricKey: "input_text_tokens",
        unitCode: "token",
        quantity: "1000000",
        amount: document.pricing.inputPerMillion,
      },
      {
        metricKey: "output_text_tokens",
        unitCode: "token",
        quantity: "1000000",
        amount: document.pricing.outputPerMillion,
      },
    ],
    evidence: {
      priceVerified: true,
      sourceKind: "provider_documentation",
      sourceReference: document.pricing.sourceReference,
      observedAt: now.toISOString(),
      sourceDigest: document.pricing.sourceDigest,
    },
  });
  const profileKey = document.bindingKey;
  const modelKeySuffix = digestProviderValue({
    providerModelId: document.providerModelId,
  }).slice(7, 15);
  const deploymentKey = `${document.bindingKey}.deployment.${modelKeySuffix}`;
  const pricingKey = `${document.bindingKey}.pricing.${modelKeySuffix}`;
  const modelProfileDigest = digestProviderValue(modelProfileDocument);
  const deploymentDigest = digestProviderValue({
    providerEndpointId: setting.providerEndpointId,
    providerModelId: document.providerModelId,
    modelProfileDigest,
  });
  const pricingDigest = digestProviderValue(pricingDocument);
  const connection = await pool.getConnection();
  let modelProfileRevisionId: string;
  let modelDeploymentId: string;
  let pricingRevisionId: string;
  try {
    await connection.beginTransaction();
    const existingProfile = await readRevision(
      connection,
      "model_profile_revision",
      "profile_key",
      setting.workspaceId,
      profileKey,
    );
    if (
      existingProfile &&
      existingProfile.canonicalDigest !== modelProfileDigest
    ) {
      throw new Error("Agent Model Profile immutable identity conflicts.");
    }
    modelProfileRevisionId = existingProfile?.id ?? ulid();
    if (!existingProfile) {
      await connection.execute(
        `INSERT INTO model_profile_revision (
           id, workspace_id, profile_key, revision, schema_version,
           profile_document, canonical_digest, lifecycle_status,
           created_by_principal_id, published_by_principal_id,
           created_at, published_at
         ) VALUES (?, ?, ?, 1, 1, ?, ?, 'published', ?, ?, ?, ?)`,
        [
          modelProfileRevisionId,
          setting.workspaceId,
          profileKey,
          JSON.stringify(modelProfileDocument),
          modelProfileDigest,
          resolution.scope.principalId,
          resolution.scope.principalId,
          now,
          now,
        ],
      );
    }
    const [deploymentRows] = await connection.execute<DeploymentRow[]>(
      `SELECT id, model_profile_revision_id AS modelProfileRevisionId,
              provider_endpoint_id AS providerEndpointId,
              provider_model_id AS providerModelId,
              deployment_digest AS deploymentDigest
       FROM model_deployment
       WHERE workspace_id = ? AND deployment_key = ?
       LIMIT 1 FOR UPDATE`,
      [setting.workspaceId, deploymentKey],
    );
    const existingDeployment = deploymentRows[0];
    if (
      existingDeployment &&
      (existingDeployment.modelProfileRevisionId !== modelProfileRevisionId ||
        existingDeployment.providerEndpointId !== setting.providerEndpointId ||
        existingDeployment.providerModelId !== document.providerModelId ||
        existingDeployment.deploymentDigest !== deploymentDigest)
    ) {
      throw new Error("Agent Model Deployment immutable identity conflicts.");
    }
    modelDeploymentId = existingDeployment?.id ?? ulid();
    if (!existingDeployment) {
      await connection.execute(
        `INSERT INTO model_deployment (
           id, workspace_id, provider_endpoint_id, model_profile_revision_id,
           deployment_key, provider_model_id, deployment_digest,
           lifecycle_status, version, created_by_principal_id,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?, ?)`,
        [
          modelDeploymentId,
          setting.workspaceId,
          setting.providerEndpointId,
          modelProfileRevisionId,
          deploymentKey,
          document.providerModelId,
          deploymentDigest,
          resolution.scope.principalId,
          now,
          now,
        ],
      );
    }
    const existingPricing = await readRevision(
      connection,
      "pricing_revision",
      "pricing_key",
      setting.workspaceId,
      pricingKey,
    );
    if (existingPricing && existingPricing.canonicalDigest !== pricingDigest) {
      throw new Error("Agent Pricing immutable identity conflicts.");
    }
    pricingRevisionId = existingPricing?.id ?? ulid();
    if (!existingPricing) {
      await connection.execute(
        `INSERT INTO pricing_revision (
           id, workspace_id, provider_endpoint_id, model_deployment_id,
           pricing_key, revision, schema_version, currency_code,
           pricing_document, canonical_digest, lifecycle_status, source_kind,
           verified_at, effective_at, created_by_principal_id,
           published_by_principal_id, created_at, published_at
         ) VALUES (?, ?, ?, ?, ?, 1, 1, 'USD', ?, ?, 'published',
                   'provider_documentation', ?, ?, ?, ?, ?, ?)`,
        [
          pricingRevisionId,
          setting.workspaceId,
          setting.providerEndpointId,
          modelDeploymentId,
          pricingKey,
          JSON.stringify(pricingDocument),
          pricingDigest,
          now,
          now,
          resolution.scope.principalId,
          resolution.scope.principalId,
          now,
          now,
        ],
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  const [bindingRows] = await pool.execute<BindingRow[]>(
    `SELECT id FROM agent_model_binding
     WHERE workspace_id = ? AND binding_key = ? LIMIT 1`,
    [setting.workspaceId, document.bindingKey],
  );
  const binding = await database.agentModelBindings.configure({
    authority: resolution.scope,
    bindingId: bindingRows[0]?.id ?? ulid(),
    bindingKey: document.bindingKey,
    modelProfileRevisionId,
    modelDeploymentId,
    providerEndpointId: setting.providerEndpointId,
    credentialId: setting.credentialId,
    pricingRevisionId,
    budgetAccountId: setting.budgetAccountId,
    apiSurface: document.apiSurface,
    protocolKind: document.protocolKind,
    maximumCharge: {
      currencyCode: "USD",
      amount: document.maximumChargeAmount,
    },
    idempotencyKey: `agent-text-binding:${document.bindingKey}:r1`,
    now,
    audit: {
      auditEventId: ulid(),
      actorPrincipalId: resolution.scope.principalId,
      actorType: resolution.scope.principalType,
      authenticationRefType: resolution.scope.authenticationRefType,
      authenticationRefHash: digestProviderValue({
        session: "agent-text-binding-bootstrap",
      }),
      authorityType: resolution.scope.authorityType,
      authorityId: resolution.scope.authorityId,
      authorityVersion: resolution.scope.authorityVersion,
      requestId: "agent-text-binding-bootstrap",
    },
  });
  process.stdout.write(
    `${JSON.stringify({
      workspaceId: setting.workspaceId,
      bindingKey: binding.bindingKey,
      model: document.providerModelId,
      lifecycleStatus: binding.lifecycleStatus,
      maximumCharge: binding.maximumCharge,
    })}\n`,
  );
} finally {
  await pool.end();
  await database.close();
}
