import type { TrustedWorkspaceScope } from "@kanvas/application";
import type { ProviderDefinitionSlug } from "@kanvas/contracts/provider-definition";
import {
  parseProviderModelCatalogDocument,
  type ProviderModelCatalogDocument,
  type ProviderModelOperationDefinition,
  type ProviderModelParameterDefinition,
} from "@kanvas/contracts/provider-model";
import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

import { revalidateTrustedWorkspaceScopeInTransaction } from "./authorization-store.js";
import {
  appendControlPlaneAuditEventInTransaction,
  type ControlPlaneAuditContext,
} from "./control-plane-audit.js";
import {
  parseProviderConstraintDocument,
  parseProviderRoutePolicyDocument,
} from "./configuration-policy.js";
import {
  reconcileProviderImageCapabilityBindingsInTransaction,
  reconcilePublishedProviderImageCapabilityBindingsInTransaction,
} from "./provider-setting-capability-reconciler.js";
import { normalizeUnsignedDecimal } from "./fixed-decimal.js";
import {
  buildProviderAgentTextControlPlaneDefinition,
  buildProviderSettingControlPlaneDefinition,
  loadProviderRuntimeAdapterProfilesInTransaction,
  parseProviderSettingModelPricingConfigurations,
  providerRuntimeAdaptersForRoute,
  type ProviderRuntimeAdapterProfile,
  type ProviderSettingControlPlaneDefinition,
  type ProviderSettingControlPlaneIds,
  type ProviderSettingModelPricingConfiguration,
  type ProviderAgentTextPricingConfiguration,
} from "./provider-setting-control-plane.js";
import { digestProviderValue } from "./provider-value-digest.js";
import {
  loadPinnedSecretVersionMetadataInTransaction,
  loadVerifiedSecretVersionMetadataForManagementInTransaction,
  type EncryptedSecretEnvelope,
  type PlaintextDatabaseSecret,
  type PinnedSecretVersionMetadata,
} from "./secret-version-store.js";

type ProviderSettingDatabaseSecretSource =
  | {
      readonly kind: "plaintext_database";
      readonly plaintext: PlaintextDatabaseSecret;
    }
  | {
      readonly kind: "encrypted_database";
      readonly envelope: EncryptedSecretEnvelope;
    };

export type ProviderSettingPreset = ProviderDefinitionSlug;

export interface ProviderSettingRecord {
  readonly id: string;
  readonly displayName: string;
  readonly preset: ProviderSettingPreset;
  readonly baseUrl: string;
  readonly modelKeys: readonly string[];
  readonly modelCatalog?: {
    readonly revision: number;
    readonly activatedRevision?: number;
    readonly discoveredAt: Date;
    readonly sourceDigest: string;
    readonly discoveryMethod: string;
    readonly changesPendingReview: boolean;
  };
  readonly lifecycle: "draft" | "active" | "disabled" | "revoked";
  readonly validation: "pending" | "passed" | "failed";
  readonly secretConfigured: boolean;
  readonly canRefreshModelCatalog: boolean;
  readonly secretFingerprintSuffix?: string;
  readonly secretRotatedAt?: Date;
  readonly validatedAt?: Date;
  readonly activatedAt?: Date;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateProviderSettingOptions {
  readonly scope: TrustedWorkspaceScope;
  readonly settingId: string;
  readonly endpointId: string;
  readonly credentialId: string;
  readonly secretVersionId: string;
  readonly displayName: string;
  readonly preset: ProviderSettingPreset;
  readonly adapterKind:
    | "openai_native"
    | "openrouter_native"
    | "openai_compatible"
    | "gemini_native"
    | "anthropic_native";
  readonly baseUrl: string;
  readonly canonicalOrigin: string;
  readonly regionCode: "global" | "us" | "private";
  readonly baseUrlDigest: string;
  readonly modelKeys: readonly string[];
  readonly modelCatalog: {
    readonly snapshotId: string;
    readonly document: ProviderModelCatalogDocument;
    readonly discoveredAt: Date;
  };
  readonly idempotencyKey: string;
  readonly requestDigest: string;
  readonly providerKind: string;
  readonly authorityDigest: string;
  readonly billingIdentityDigest: string;
  readonly egressIdentityDigest: string;
  readonly credentialIdentityDigest: string;
  readonly secretAadDigest: string;
  readonly secretMaterialFingerprint: string;
  readonly secretSource: ProviderSettingDatabaseSecretSource;
  readonly validationDigest: string;
  readonly validatedAt: Date;
  readonly createdAt: Date;
  readonly audit: ControlPlaneAuditContext;
  readonly secretAuditEventId: string;
}

export function providerSettingValidationDigest(input: {
  readonly providerSettingId: string;
  readonly providerEndpointId: string;
  readonly preset: ProviderSettingPreset;
  readonly baseUrlDigest: string;
  readonly modelCatalogDigest: string;
  readonly modelCatalogSourceDigest: string;
  readonly selectedModelKeys: readonly string[];
  readonly secretMaterialFingerprint: string;
  readonly validatedAt: Date;
}): string {
  return digestProviderValue({
    domain: "kanvas.provider-setting-validation.v1",
    providerSettingId: input.providerSettingId,
    providerEndpointId: input.providerEndpointId,
    preset: input.preset,
    baseUrlDigest: input.baseUrlDigest,
    modelCatalogDigest: input.modelCatalogDigest,
    modelCatalogSourceDigest: input.modelCatalogSourceDigest,
    selectedModelKeys: input.selectedModelKeys,
    secretMaterialFingerprint: input.secretMaterialFingerprint,
    validatedAt: input.validatedAt.toISOString(),
  });
}

export interface ProviderSettingsStore {
  list(
    scope: TrustedWorkspaceScope,
    now: Date,
  ): Promise<readonly ProviderSettingRecord[]>;
  rename(options: RenameProviderSettingOptions): Promise<ProviderSettingRecord>;
  resolveSecretWriteIdentity(
    scope: TrustedWorkspaceScope,
    settingId: string,
    now: Date,
  ): Promise<{
    readonly credentialId: string;
    readonly providerKind: ProviderSettingPreset;
  }>;
  resolveValidationIdentity(
    scope: TrustedWorkspaceScope,
    settingId: string,
    now: Date,
  ): Promise<{
    readonly preset: ProviderSettingPreset;
    readonly baseUrl: string;
    readonly modelKeys: readonly string[];
    readonly secretMaterialFingerprint: string;
  }>;
  resolveModelCatalogRefreshIdentity(
    scope: TrustedWorkspaceScope,
    settingId: string,
    now: Date,
  ): Promise<{
    readonly mode: "active" | "staged";
    readonly preset: ProviderSettingPreset;
    readonly baseUrl: string;
    readonly modelKeys: readonly string[];
    readonly secret: PinnedSecretVersionMetadata;
  }>;
  getModelCatalogReview(
    scope: TrustedWorkspaceScope,
    settingId: string,
    now: Date,
  ): Promise<ProviderModelCatalogReviewRecord>;
  resolveModelCatalogAdoptionIdentity(
    scope: TrustedWorkspaceScope,
    settingId: string,
    now: Date,
  ): Promise<{
    readonly preset: ProviderSettingPreset;
    readonly baseUrl: string;
    readonly modelKeys: readonly string[];
    readonly currentRevision: number;
    readonly activatedRevision: number;
    readonly currentSourceDigest: string;
    readonly currentRuntimeDigest: string;
    readonly secret: PinnedSecretVersionMetadata;
  }>;
  create(options: CreateProviderSettingOptions): Promise<{
    readonly provider: ProviderSettingRecord;
    readonly result: "created" | "replayed";
  }>;
  createAgentTextModel(
    options: CreateProviderAgentTextModelOptions,
  ): Promise<CreateProviderAgentTextModelResult>;
  validate(
    options: ProviderSettingLifecycleOptions,
  ): Promise<ProviderSettingMutation>;
  activate(
    options: ActivateProviderSettingOptions,
  ): Promise<ProviderSettingMutation>;
  rotateSecret(
    options: RotateProviderSettingSecretOptions,
  ): Promise<ProviderSettingMutation>;
  disable(
    options: ProviderSettingLifecycleOptions,
  ): Promise<ProviderSettingMutation>;
  delete(
    options: ProviderSettingLifecycleOptions,
  ): Promise<ProviderSettingMutation>;
  refreshModelCatalog(
    options: RefreshProviderModelCatalogOptions,
  ): Promise<ProviderModelCatalogRefreshMutation>;
  adoptModelCatalog(
    options: AdoptProviderModelCatalogOptions,
  ): Promise<ProviderModelCatalogAdoptionMutation>;
}

export interface CreateProviderAgentTextModelOptions {
  readonly scope: TrustedWorkspaceScope;
  readonly settingId: string;
  readonly providerModelId: string;
  readonly displayName: string;
  readonly pricing: ProviderAgentTextPricingConfiguration;
  readonly bindingId: string;
  readonly modelProfileRevisionId: string;
  readonly modelDeploymentId: string;
  readonly pricingRevisionId: string;
  readonly idempotencyKey: string;
  readonly requestDigest: string;
  readonly now: Date;
  readonly audit: ControlPlaneAuditContext;
}

export interface CreateProviderAgentTextModelResult {
  readonly bindingId: string;
  readonly bindingKey: string;
  readonly replayed: boolean;
}

export interface ProviderSettingMutation {
  readonly provider: ProviderSettingRecord;
  readonly result:
    "validated" | "activated" | "rotated" | "disabled" | "deleted" | "replayed";
}

export interface RenameProviderSettingOptions {
  readonly scope: TrustedWorkspaceScope;
  readonly settingId: string;
  readonly expectedVersion: number;
  readonly displayName: string;
  readonly now: Date;
  readonly audit: ControlPlaneAuditContext;
}

export interface ProviderSettingLifecycleOptions {
  readonly scope: TrustedWorkspaceScope;
  readonly settingId: string;
  readonly expectedVersion: number;
  readonly idempotencyKey: string;
  readonly requestDigest: string;
  readonly now: Date;
  readonly audit: ControlPlaneAuditContext;
  readonly relatedAuditEventIds: readonly string[];
}

export interface RefreshProviderModelCatalogOptions extends ProviderSettingLifecycleOptions {
  readonly snapshotId: string;
  readonly document: ProviderModelCatalogDocument;
  readonly discoveredAt: Date;
  readonly expectedActiveSecretVersionId: string;
  readonly expectedSecretMaterialGeneration: number;
}

export interface ProviderModelCatalogRefreshMutation {
  readonly provider: ProviderSettingRecord;
  readonly result: "refreshed" | "replayed";
  readonly changesPendingReview: boolean;
}

export type ProviderModelCatalogChange =
  "unchanged" | "added" | "removed" | "changed";

export type ProviderModelCatalogBlockerCode =
  | "not_activated"
  | "no_pending_changes"
  | "selected_model_removed"
  | "selected_model_identity_only"
  | "selected_model_no_image_output"
  | "selected_model_no_image_operation"
  | "selected_model_operation_removed"
  | "selected_model_unsupported_route";

export interface ProviderModelCatalogBlocker {
  readonly code: ProviderModelCatalogBlockerCode;
  readonly providerModelId?: string;
  readonly capabilityKey?: "image.generate" | "image.edit";
  readonly apiSurface?: string;
}

export interface ProviderModelCatalogReviewRecord {
  readonly providerSettingId: string;
  readonly version: number;
  readonly current: {
    readonly snapshotId: string;
    readonly revision: number;
    readonly canonicalDigest: string;
    readonly sourceDigest: string;
  };
  readonly activated?: {
    readonly snapshotId: string;
    readonly revision: number;
    readonly canonicalDigest: string;
    readonly sourceDigest: string;
  };
  readonly selectedModels: readonly {
    readonly providerModelId: string;
    readonly change: ProviderModelCatalogChange;
    readonly displayName: {
      readonly before?: string;
      readonly after?: string;
    };
    readonly completeness: {
      readonly before?: "identity_only" | "partial" | "complete";
      readonly after?: "identity_only" | "partial" | "complete";
    };
    readonly inputModalities: {
      readonly added: readonly ("text" | "image" | "mask")[];
      readonly removed: readonly ("text" | "image" | "mask")[];
    };
    readonly outputModalities: {
      readonly added: readonly ("text" | "image" | "mask")[];
      readonly removed: readonly ("text" | "image" | "mask")[];
    };
    readonly operations: readonly {
      readonly capabilityKey: "image.generate" | "image.edit";
      readonly change: ProviderModelCatalogChange;
      readonly apiSurfaces: {
        readonly added: readonly string[];
        readonly removed: readonly string[];
      };
      readonly parameters: readonly {
        readonly key: string;
        readonly change: ProviderModelCatalogChange;
        readonly changedFields: readonly (
          | "valueType"
          | "required"
          | "values"
          | "minimum"
          | "maximum"
          | "step"
          | "maxLength"
        )[];
        readonly before?: ProviderModelParameterDefinition;
        readonly after?: ProviderModelParameterDefinition;
      }[];
    }[];
    readonly blockers: readonly ProviderModelCatalogBlocker[];
  }[];
  readonly blockers: readonly ProviderModelCatalogBlocker[];
  readonly canAdopt: boolean;
}

export interface AdoptProviderModelCatalogOptions extends ProviderSettingLifecycleOptions {
  readonly expectedCurrentRevision: number;
  readonly expectedActivatedRevision: number;
  readonly rediscoveredSourceDigest: string;
  readonly rediscoveredRuntimeDigest: string;
  readonly expectedActiveSecretVersionId: string;
  readonly expectedSecretMaterialGeneration: number;
  readonly resources: {
    readonly models: readonly Omit<
      ProviderSettingControlPlaneIds,
      "endpointId" | "credentialId" | "budgetAccountId"
    >[];
  };
}

export interface ProviderModelCatalogAdoptionMutation {
  readonly provider: ProviderSettingRecord;
  readonly result: "adopted" | "replayed";
  readonly adoptedRevision: number;
}

export interface ActivateProviderSettingOptions extends ProviderSettingLifecycleOptions {
  readonly hardLimitAmount: string;
  readonly modelPricingConfigurations?: readonly ProviderSettingModelPricingConfiguration[];
  readonly resources: {
    readonly budgetAccountId: string;
    readonly models: readonly Omit<
      ProviderSettingControlPlaneIds,
      "endpointId" | "credentialId" | "budgetAccountId"
    >[];
    readonly workspacePolicyRevisionId: string;
  };
}

export interface RotateProviderSettingSecretOptions extends ProviderSettingLifecycleOptions {
  readonly secretVersionId: string;
  readonly secretAadDigest: string;
  readonly secretMaterialFingerprint: string;
  readonly secretSource: ProviderSettingDatabaseSecretSource;
  readonly mode: "graceful" | "revoke_immediately";
  readonly drainDeadlineAt: Date;
}

interface ProviderSettingRow extends RowDataPacket {
  readonly id: string;
  readonly displayName: string;
  readonly preset: ProviderSettingPreset;
  readonly baseUrl: string;
  readonly modelKeys: unknown;
  readonly modelCatalogDocument: unknown;
  readonly modelCatalogRevision: number | null;
  readonly activatedModelCatalogRevision: number | null;
  readonly modelCatalogChangesPendingReview: number | boolean;
  readonly modelCatalogDiscoveredAt: Date | null;
  readonly modelCatalogSourceDigest: string | null;
  readonly modelCatalogDiscoveryMethod: string | null;
  readonly modelDeploymentId: string | null;
  readonly budgetAccountId: string | null;
  readonly activatedModelCatalogSnapshotId: string | null;
  readonly endpointLifecycle: string;
  readonly validation: "pending" | "passed" | "failed";
  readonly credentialLifecycle: string;
  readonly activeSecretVersionId: string | null;
  readonly secretVersionId: string | null;
  readonly materialFingerprint: string | null;
  readonly secretLifecycle: string | null;
  readonly secretCreatedAt: Date | null;
  readonly validatedAt: Date | null;
  readonly activatedAt: Date | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

interface IdempotencyRow extends RowDataPacket {
  readonly id: string;
  readonly requestDigest: string;
}

interface OperationRow extends RowDataPacket {
  readonly providerSettingId: string;
  readonly operationKind: string;
  readonly requestDigest: string;
  readonly resultVersion: number;
}

interface AggregateRow extends RowDataPacket {
  readonly settingId: string;
  readonly settingVersion: number;
  readonly modelDeploymentId: string | null;
  readonly budgetAccountId: string | null;
  readonly preset: ProviderSettingPreset;
  readonly baseUrl: string;
  readonly modelKeys: unknown;
  readonly modelPricingConfigurations: unknown;
  readonly modelCatalogDocument: unknown;
  readonly modelCatalogSnapshotId: string;
  readonly modelCatalogRevision: number;
  readonly modelCatalogCanonicalDigest: string;
  readonly modelCatalogSourceDigest: string;
  readonly activatedModelCatalogSnapshotId: string | null;
  readonly activatedModelCatalogRevision: number | null;
  readonly activatedModelCatalogDocument: unknown;
  readonly activatedModelCatalogCanonicalDigest: string | null;
  readonly activatedModelCatalogSourceDigest: string | null;
  readonly modelCatalogChangesPendingReview: number | boolean;
  readonly endpointId: string;
  readonly endpointVersion: number;
  readonly endpointLifecycle: string;
  readonly validationStatus: string;
  readonly credentialId: string;
  readonly credentialVersion: number;
  readonly credentialLifecycle: string;
  readonly credentialIdentityEpoch: number;
  readonly credentialIdentityDigest: string;
  readonly credentialMaterialGeneration: number;
  readonly activeSecretVersionId: string | null;
  readonly secretVersionId: string;
  readonly secretMaterialGeneration: number;
  readonly secretLifecycle: string;
}

interface WorkspacePolicyRow extends RowDataPacket {
  readonly bindingVersion: number;
  readonly revisionId: string;
  readonly revision: number;
  readonly policyDocument: unknown;
}

interface IdRow extends RowDataPacket {
  readonly id: string;
}

interface AgentTextBindingRow extends RowDataPacket {
  readonly id: string;
  readonly bindingKey: string;
  readonly providerEndpointId: string;
  readonly credentialId: string;
  readonly budgetAccountId: string;
  readonly apiSurface: string;
  readonly protocolKind: string;
  readonly maximumChargeAmount: string;
  readonly routeDigest: string;
  readonly profileDigest: string;
  readonly deploymentDigest: string;
  readonly pricingDigest: string;
  readonly idempotencyKey: string;
  readonly requestDigest: string;
}

interface SecretWriteIdentityRow extends RowDataPacket {
  readonly credentialId: string;
  readonly providerKind: ProviderSettingPreset;
}

interface ValidationIdentityRow extends RowDataPacket {
  readonly preset: ProviderSettingPreset;
  readonly baseUrl: string;
  readonly modelKeys: unknown;
  readonly secretMaterialFingerprint: string;
}

interface ModelCatalogRefreshIdentityRow extends RowDataPacket {
  readonly preset: ProviderSettingPreset;
  readonly baseUrl: string;
  readonly modelKeys: unknown;
  readonly modelDeploymentId: string | null;
  readonly budgetAccountId: string | null;
  readonly activatedModelCatalogSnapshotId: string | null;
  readonly activatedModelCatalogRevision: number | null;
  readonly endpointLifecycle: string;
  readonly validationStatus: string;
  readonly credentialId: string;
  readonly credentialLifecycle: string;
  readonly credentialIdentityEpoch: number;
  readonly credentialIdentityDigest: string;
  readonly providerEndpointId: string;
  readonly activeSecretVersionId: string | null;
  readonly latestSecretVersionId: string;
  readonly latestSecretLifecycle: string;
}

interface ActiveModelDeploymentRow extends RowDataPacket {
  readonly id: string;
  readonly providerModelId: string;
  readonly generation: number;
}

interface DeploymentRouteRow extends RowDataPacket {
  readonly id: string;
  readonly modelDeploymentId: string;
  readonly routeDocument: unknown;
}

function parseModelKeys(value: unknown): readonly string[] {
  const parsed =
    typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (
    !Array.isArray(parsed) ||
    parsed.length > 2_000 ||
    parsed.some(
      (item) =>
        typeof item !== "string" || item.length < 1 || item.length > 255,
    )
  ) {
    throw new Error("Persisted Provider setting model keys are invalid.");
  }
  const values: unknown[] = parsed;
  return Object.freeze(
    values.map((item) => {
      if (typeof item !== "string") {
        throw new Error("Persisted Provider setting model keys are invalid.");
      }
      return item;
    }),
  );
}

function assertSelectedCatalogModels(
  catalog: ProviderModelCatalogDocument,
  modelKeys: readonly string[],
): void {
  const models = new Map(
    catalog.models.map((model) => [model.providerModelId, model]),
  );
  for (const modelKey of modelKeys) {
    const model = models.get(modelKey);
    if (!model) {
      throw new Error(
        "A selected Provider model is absent from the refreshed catalog.",
      );
    }
    if (
      model.completeness === "identity_only" ||
      !model.outputModalities.includes("image") ||
      (!model.operations["image.generate"] && !model.operations["image.edit"])
    ) {
      throw new Error(
        "A selected Provider model lost its evidenced image operation.",
      );
    }
  }
}

function parameterRuntimeProjection(
  parameter: ProviderModelParameterDefinition,
): Readonly<Record<string, unknown>> {
  const common = {
    key: parameter.key,
    label: parameter.label,
    ...(parameter.description ? { description: parameter.description } : {}),
    required: parameter.required,
    valueType: parameter.valueType,
  };
  if (parameter.valueType === "enum") {
    return Object.freeze({
      ...common,
      values: [...parameter.values],
    });
  }
  if (parameter.valueType === "integer") {
    return Object.freeze({
      ...common,
      minimum: parameter.minimum,
      maximum: parameter.maximum,
      ...(parameter.step === undefined ? {} : { step: parameter.step }),
    });
  }
  if (parameter.valueType === "string") {
    return Object.freeze({
      ...common,
      maxLength: parameter.maxLength,
    });
  }
  return Object.freeze(common);
}

export function selectedCatalogRuntimeDigest(
  catalog: ProviderModelCatalogDocument,
  modelKeys: readonly string[],
): string {
  const models = new Map(
    catalog.models.map((model) => [model.providerModelId, model]),
  );
  return digestProviderValue(
    modelKeys.map((modelKey) => {
      const model = models.get(modelKey);
      if (!model || model.completeness === "identity_only") {
        throw new Error(
          "Selected Provider model runtime projection is unavailable.",
        );
      }
      const projectOperation = (
        operation: ProviderModelOperationDefinition | undefined,
      ) =>
        operation
          ? {
              apiSurfaces: [...operation.apiSurfaces],
              parameters: operation.parameters.map(parameterRuntimeProjection),
            }
          : undefined;
      const generate = projectOperation(model.operations["image.generate"]);
      const edit = projectOperation(model.operations["image.edit"]);
      return {
        providerModelId: model.providerModelId,
        displayName: model.displayName,
        inputModalities: [...model.inputModalities],
        outputModalities: [...model.outputModalities],
        completeness: model.completeness,
        operations: {
          ...(generate ? { "image.generate": generate } : {}),
          ...(edit ? { "image.edit": edit } : {}),
        },
      };
    }),
  );
}

function setDifference<T extends string>(
  left: readonly T[],
  right: readonly T[],
): readonly T[] {
  const rightSet = new Set(right);
  return Object.freeze(left.filter((value) => !rightSet.has(value)).sort());
}

function parameterChangedFields(
  before: ProviderModelParameterDefinition,
  after: ProviderModelParameterDefinition,
): readonly (
  | "valueType"
  | "required"
  | "values"
  | "minimum"
  | "maximum"
  | "step"
  | "maxLength"
)[] {
  const fields: (
    | "valueType"
    | "required"
    | "values"
    | "minimum"
    | "maximum"
    | "step"
    | "maxLength"
  )[] = [];
  if (before.valueType !== after.valueType) {
    fields.push("valueType");
  }
  if (before.required !== after.required) {
    fields.push("required");
  }
  if (
    before.valueType === "enum" &&
    after.valueType === "enum" &&
    digestProviderValue(before.values) !== digestProviderValue(after.values)
  ) {
    fields.push("values");
  }
  if (before.valueType === "integer" && after.valueType === "integer") {
    if (before.minimum !== after.minimum) {
      fields.push("minimum");
    }
    if (before.maximum !== after.maximum) {
      fields.push("maximum");
    }
    if (before.step !== after.step) {
      fields.push("step");
    }
  }
  if (
    before.valueType === "string" &&
    after.valueType === "string" &&
    before.maxLength !== after.maxLength
  ) {
    fields.push("maxLength");
  }
  return Object.freeze(fields);
}

function parameterDiffs(
  before: ProviderModelOperationDefinition | undefined,
  after: ProviderModelOperationDefinition | undefined,
): ProviderModelCatalogReviewRecord["selectedModels"][number]["operations"][number]["parameters"] {
  const beforeByKey = new Map(
    (before?.parameters ?? []).map((parameter) => [parameter.key, parameter]),
  );
  const afterByKey = new Map(
    (after?.parameters ?? []).map((parameter) => [parameter.key, parameter]),
  );
  return Object.freeze(
    [...new Set([...beforeByKey.keys(), ...afterByKey.keys()])]
      .sort()
      .map((key) => {
        const previous = beforeByKey.get(key);
        const current = afterByKey.get(key);
        if (previous === undefined && current !== undefined) {
          return Object.freeze({
            key,
            change: "added" as const,
            changedFields: Object.freeze([]),
            after: current,
          });
        }
        if (previous !== undefined && current === undefined) {
          return Object.freeze({
            key,
            change: "removed" as const,
            changedFields: Object.freeze([]),
            before: previous,
          });
        }
        if (previous === undefined || current === undefined) {
          throw new Error(
            "Provider model catalog parameter diff lost both parameter facts.",
          );
        }
        const changed =
          digestProviderValue(parameterRuntimeProjection(previous)) !==
          digestProviderValue(parameterRuntimeProjection(current));
        return Object.freeze({
          key,
          change: changed ? ("changed" as const) : ("unchanged" as const),
          changedFields: parameterChangedFields(previous, current),
          before: previous,
          after: current,
        });
      }),
  );
}

function operationDiffs(
  before:
    | Readonly<
        Partial<
          Record<
            "image.generate" | "image.edit",
            ProviderModelOperationDefinition
          >
        >
      >
    | undefined,
  after:
    | Readonly<
        Partial<
          Record<
            "image.generate" | "image.edit",
            ProviderModelOperationDefinition
          >
        >
      >
    | undefined,
): ProviderModelCatalogReviewRecord["selectedModels"][number]["operations"] {
  return Object.freeze(
    (["image.generate", "image.edit"] as const).map((capabilityKey) => {
      const previous = before?.[capabilityKey];
      const current = after?.[capabilityKey];
      const added = setDifference(
        current?.apiSurfaces ?? [],
        previous?.apiSurfaces ?? [],
      );
      const removed = setDifference(
        previous?.apiSurfaces ?? [],
        current?.apiSurfaces ?? [],
      );
      const parameters = parameterDiffs(previous, current);
      let change: ProviderModelCatalogChange = "unchanged";
      if (!previous && current) {
        change = "added";
      } else if (previous && !current) {
        change = "removed";
      } else if (
        previous &&
        current &&
        (added.length > 0 ||
          removed.length > 0 ||
          parameters.some((parameter) => parameter.change !== "unchanged"))
      ) {
        change = "changed";
      }
      return Object.freeze({
        capabilityKey,
        change,
        apiSurfaces: Object.freeze({ added, removed }),
        parameters,
      });
    }),
  );
}

function selectedModelBlockers(
  preset: ProviderSettingPreset,
  providerModelId: string,
  model: ProviderModelCatalogDocument["models"][number] | undefined,
  runtimeAdapters: readonly ProviderRuntimeAdapterProfile[],
): readonly ProviderModelCatalogBlocker[] {
  if (!model) {
    return Object.freeze([
      Object.freeze({
        code: "selected_model_removed" as const,
        providerModelId,
      }),
    ]);
  }
  const blockers: ProviderModelCatalogBlocker[] = [];
  if (model.completeness === "identity_only") {
    blockers.push({
      code: "selected_model_identity_only",
      providerModelId,
    });
  }
  if (!model.outputModalities.includes("image")) {
    blockers.push({
      code: "selected_model_no_image_output",
      providerModelId,
    });
  }
  const operations = (["image.generate", "image.edit"] as const).flatMap(
    (capabilityKey) => {
      const operation = model.operations[capabilityKey];
      return operation ? [[capabilityKey, operation] as const] : [];
    },
  );
  if (operations.length < 1) {
    blockers.push({
      code: "selected_model_no_image_operation",
      providerModelId,
    });
  }
  for (const [capabilityKey, operation] of operations) {
    for (const apiSurface of operation.apiSurfaces) {
      if (
        providerRuntimeAdaptersForRoute(runtimeAdapters, {
          preset,
          capabilityKey,
          apiSurface: apiSurface as Parameters<
            typeof providerRuntimeAdaptersForRoute
          >[1]["apiSurface"],
        }).length === 0
      ) {
        blockers.push({
          code: "selected_model_unsupported_route",
          providerModelId,
          capabilityKey,
          apiSurface,
        });
      }
    }
  }
  return Object.freeze(blockers.map((blocker) => Object.freeze(blocker)));
}

function modelRuntimeProjection(
  model: ProviderModelCatalogDocument["models"][number] | undefined,
): unknown {
  if (!model) {
    return null;
  }
  const operation = (capabilityKey: "image.generate" | "image.edit") => {
    const item = model.operations[capabilityKey];
    return item
      ? {
          apiSurfaces: [...item.apiSurfaces].sort(),
          parameters: item.parameters.map(parameterRuntimeProjection),
        }
      : null;
  };
  return {
    providerModelId: model.providerModelId,
    displayName: model.displayName,
    completeness: model.completeness,
    inputModalities: [...model.inputModalities].sort(),
    outputModalities: [...model.outputModalities].sort(),
    operations: {
      "image.generate": operation("image.generate"),
      "image.edit": operation("image.edit"),
    },
  };
}

export function buildProviderModelCatalogReview(input: {
  readonly providerSettingId: string;
  readonly version: number;
  readonly preset: ProviderSettingPreset;
  readonly modelKeys: readonly string[];
  readonly changesPendingReview: boolean;
  readonly runtimeAdapters: readonly ProviderRuntimeAdapterProfile[];
  readonly current: {
    readonly snapshotId: string;
    readonly revision: number;
    readonly canonicalDigest: string;
    readonly sourceDigest: string;
    readonly catalog: ProviderModelCatalogDocument;
  };
  readonly activated?: {
    readonly snapshotId: string;
    readonly revision: number;
    readonly canonicalDigest: string;
    readonly sourceDigest: string;
    readonly catalog: ProviderModelCatalogDocument;
  };
}): ProviderModelCatalogReviewRecord {
  const currentModels = new Map(
    input.current.catalog.models.map((model) => [model.providerModelId, model]),
  );
  const activatedModels = new Map(
    (input.activated?.catalog.models ?? []).map((model) => [
      model.providerModelId,
      model,
    ]),
  );
  const selectedModels = Object.freeze(
    input.modelKeys.map((providerModelId) => {
      const before = activatedModels.get(providerModelId);
      const after = currentModels.get(providerModelId);
      const blockers = Object.freeze([
        ...selectedModelBlockers(
          input.preset,
          providerModelId,
          after,
          input.runtimeAdapters,
        ),
        ...(["image.generate", "image.edit"] as const).flatMap(
          (capabilityKey) =>
            before?.operations[capabilityKey] &&
            !after?.operations[capabilityKey]
              ? [
                  Object.freeze({
                    code: "selected_model_operation_removed" as const,
                    providerModelId,
                    capabilityKey,
                  }),
                ]
              : [],
        ),
      ]);
      const beforeProjection = modelRuntimeProjection(before);
      const afterProjection = modelRuntimeProjection(after);
      let change: ProviderModelCatalogChange = "changed";
      if (!before && after) {
        change = "added";
      } else if (before && !after) {
        change = "removed";
      } else if (
        digestProviderValue(beforeProjection) ===
        digestProviderValue(afterProjection)
      ) {
        change = "unchanged";
      }
      return Object.freeze({
        providerModelId,
        change,
        displayName: Object.freeze({
          ...(before ? { before: before.displayName } : {}),
          ...(after ? { after: after.displayName } : {}),
        }),
        completeness: Object.freeze({
          ...(before ? { before: before.completeness } : {}),
          ...(after ? { after: after.completeness } : {}),
        }),
        inputModalities: Object.freeze({
          added: setDifference(
            after?.inputModalities ?? [],
            before?.inputModalities ?? [],
          ),
          removed: setDifference(
            before?.inputModalities ?? [],
            after?.inputModalities ?? [],
          ),
        }),
        outputModalities: Object.freeze({
          added: setDifference(
            after?.outputModalities ?? [],
            before?.outputModalities ?? [],
          ),
          removed: setDifference(
            before?.outputModalities ?? [],
            after?.outputModalities ?? [],
          ),
        }),
        operations: operationDiffs(before?.operations, after?.operations),
        blockers,
      });
    }),
  );
  const blockers: ProviderModelCatalogBlocker[] = [
    ...(input.activated ? [] : [{ code: "not_activated" as const }]),
    ...(input.changesPendingReview
      ? []
      : [{ code: "no_pending_changes" as const }]),
    ...selectedModels.flatMap((model) => model.blockers),
  ];
  return Object.freeze({
    providerSettingId: input.providerSettingId,
    version: input.version,
    current: Object.freeze({
      snapshotId: input.current.snapshotId,
      revision: input.current.revision,
      canonicalDigest: input.current.canonicalDigest,
      sourceDigest: input.current.sourceDigest,
    }),
    ...(input.activated
      ? {
          activated: Object.freeze({
            snapshotId: input.activated.snapshotId,
            revision: input.activated.revision,
            canonicalDigest: input.activated.canonicalDigest,
            sourceDigest: input.activated.sourceDigest,
          }),
        }
      : {}),
    selectedModels,
    blockers: Object.freeze(blockers.map((blocker) => Object.freeze(blocker))),
    canAdopt: blockers.length === 0,
  });
}

function reviewFromAggregate(
  aggregate: AggregateRow,
  runtimeAdapters: readonly ProviderRuntimeAdapterProfile[],
): ProviderModelCatalogReviewRecord {
  const current = parseProviderModelCatalogDocument(
    decodeJson(aggregate.modelCatalogDocument),
  );
  const activated =
    aggregate.activatedModelCatalogSnapshotId &&
    aggregate.activatedModelCatalogRevision &&
    aggregate.activatedModelCatalogDocument &&
    aggregate.activatedModelCatalogCanonicalDigest &&
    aggregate.activatedModelCatalogSourceDigest
      ? {
          snapshotId: aggregate.activatedModelCatalogSnapshotId,
          revision: aggregate.activatedModelCatalogRevision,
          canonicalDigest: aggregate.activatedModelCatalogCanonicalDigest,
          sourceDigest: aggregate.activatedModelCatalogSourceDigest,
          catalog: parseProviderModelCatalogDocument(
            decodeJson(aggregate.activatedModelCatalogDocument),
          ),
        }
      : undefined;
  return buildProviderModelCatalogReview({
    providerSettingId: aggregate.settingId,
    version: aggregate.settingVersion,
    preset: aggregate.preset,
    modelKeys: parseModelKeys(aggregate.modelKeys),
    changesPendingReview: Boolean(aggregate.modelCatalogChangesPendingReview),
    runtimeAdapters,
    current: {
      snapshotId: aggregate.modelCatalogSnapshotId,
      revision: aggregate.modelCatalogRevision,
      canonicalDigest: aggregate.modelCatalogCanonicalDigest,
      sourceDigest: aggregate.modelCatalogSourceDigest,
      catalog: current,
    },
    ...(activated ? { activated } : {}),
  });
}

function lifecycleFrom(
  row: ProviderSettingRow,
): ProviderSettingRecord["lifecycle"] {
  if (row.endpointLifecycle === "revoked") {
    return "revoked";
  }
  if (row.endpointLifecycle === "active") {
    return "active";
  }
  if (row.endpointLifecycle === "disabled" && row.validation === "pending") {
    return "draft";
  }
  return "disabled";
}

function canRefreshModelCatalogFrom(row: ProviderSettingRow): boolean {
  const active =
    row.endpointLifecycle === "active" &&
    row.validation === "passed" &&
    row.credentialLifecycle === "active" &&
    row.secretLifecycle === "active" &&
    row.activeSecretVersionId !== null &&
    row.activeSecretVersionId === row.secretVersionId;
  const staged =
    row.modelDeploymentId === null &&
    row.budgetAccountId === null &&
    row.activatedModelCatalogSnapshotId === null &&
    row.activatedModelCatalogRevision === null &&
    row.endpointLifecycle === "disabled" &&
    row.validation === "passed" &&
    row.credentialLifecycle === "disabled" &&
    row.activeSecretVersionId === null &&
    row.secretLifecycle === "verified";
  return active || staged;
}

function recordFrom(row: ProviderSettingRow): ProviderSettingRecord {
  const fingerprint = row.materialFingerprint;
  return Object.freeze({
    id: row.id,
    displayName: row.displayName,
    preset: row.preset,
    baseUrl: row.baseUrl,
    modelKeys: parseModelKeys(row.modelKeys),
    ...(row.modelCatalogRevision &&
    row.modelCatalogDiscoveredAt &&
    row.modelCatalogSourceDigest &&
    row.modelCatalogDiscoveryMethod
      ? {
          modelCatalog: Object.freeze({
            revision: row.modelCatalogRevision,
            ...(row.activatedModelCatalogRevision
              ? {
                  activatedRevision: row.activatedModelCatalogRevision,
                }
              : {}),
            discoveredAt: new Date(row.modelCatalogDiscoveredAt),
            sourceDigest: row.modelCatalogSourceDigest,
            discoveryMethod: row.modelCatalogDiscoveryMethod,
            changesPendingReview: Boolean(row.modelCatalogChangesPendingReview),
          }),
        }
      : {}),
    lifecycle: lifecycleFrom(row),
    validation: row.validation,
    secretConfigured:
      fingerprint !== null && row.secretLifecycle !== "destroyed",
    canRefreshModelCatalog: canRefreshModelCatalogFrom(row),
    ...(fingerprint
      ? {
          secretFingerprintSuffix: fingerprint.slice(-12),
        }
      : {}),
    ...(row.secretCreatedAt
      ? { secretRotatedAt: new Date(row.secretCreatedAt) }
      : {}),
    ...(row.validatedAt ? { validatedAt: new Date(row.validatedAt) } : {}),
    ...(row.activatedAt ? { activatedAt: new Date(row.activatedAt) } : {}),
    version: row.version,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  });
}

async function readOne(
  connection: PoolConnection,
  workspaceId: string,
  settingId: string,
): Promise<ProviderSettingRecord> {
  const [rows] = await connection.execute<ProviderSettingRow[]>(
    `SELECT
       setting.id,
       setting.display_name AS displayName,
       endpoint.preset_kind AS preset,
       endpoint.base_url AS baseUrl,
       COALESCE(
         (
           SELECT JSON_ARRAYAGG(provider_model.upstream_model_id)
           FROM provider_model
           WHERE provider_model.workspace_id = setting.workspace_id
             AND provider_model.provider_setting_id = setting.id
             AND provider_model.lifecycle_status <> 'removed'
         ),
         setting.requested_model_keys
       ) AS modelKeys,
       catalog.catalog_document AS modelCatalogDocument,
       catalog.revision AS modelCatalogRevision,
       setting.activated_model_catalog_revision
         AS activatedModelCatalogRevision,
       setting.model_catalog_changes_pending_review
         AS modelCatalogChangesPendingReview,
       catalog.discovered_at AS modelCatalogDiscoveredAt,
       catalog.source_digest AS modelCatalogSourceDigest,
       catalog.discovery_method AS modelCatalogDiscoveryMethod,
       setting.model_deployment_id AS modelDeploymentId,
       setting.budget_account_id AS budgetAccountId,
       setting.activated_model_catalog_snapshot_id
         AS activatedModelCatalogSnapshotId,
       setting.activated_model_catalog_revision
         AS activatedModelCatalogRevision,
       endpoint.lifecycle_status AS endpointLifecycle,
       endpoint.validation_status AS validation,
       credential.lifecycle_status AS credentialLifecycle,
       credential.active_secret_version_id
         AS activeSecretVersionId,
       secret.id AS secretVersionId,
       secret.material_fingerprint AS materialFingerprint,
       secret.lifecycle_status AS secretLifecycle,
       secret.created_at AS secretCreatedAt,
       endpoint.validated_at AS validatedAt,
       setting.activated_at AS activatedAt,
       setting.version,
       setting.created_at AS createdAt,
       setting.updated_at AS updatedAt
     FROM provider_setting AS setting
     INNER JOIN provider_endpoint AS endpoint
       ON endpoint.workspace_id = setting.workspace_id
      AND endpoint.id = setting.provider_endpoint_id
     INNER JOIN credential
       ON credential.workspace_id = setting.workspace_id
      AND credential.id = setting.credential_id
     LEFT JOIN secret_version AS secret
       ON secret.workspace_id = credential.workspace_id
      AND secret.credential_id = credential.id
      AND secret.version = (
        SELECT MAX(candidate.version)
        FROM secret_version AS candidate
        WHERE candidate.credential_id = credential.id
      )
     LEFT JOIN provider_model_catalog_snapshot AS catalog
       ON catalog.workspace_id = setting.workspace_id
      AND catalog.provider_setting_id = setting.id
      AND catalog.id = setting.model_catalog_snapshot_id
      AND catalog.revision = setting.model_catalog_revision
     WHERE setting.workspace_id = ?
       AND setting.id = ?
     LIMIT 1`,
    [workspaceId, settingId],
  );
  const row = rows[0];
  if (!row) {
    throw new Error("Created Provider setting could not be read.");
  }
  return recordFrom(row);
}

async function lockAggregate(
  connection: PoolConnection,
  workspaceId: string,
  settingId: string,
): Promise<AggregateRow> {
  const [rows] = await connection.execute<AggregateRow[]>(
    `SELECT
       setting.id AS settingId,
       setting.version AS settingVersion,
       setting.model_deployment_id AS modelDeploymentId,
       setting.budget_account_id AS budgetAccountId,
       setting.requested_model_keys AS modelKeys,
       setting.model_pricing_configurations AS modelPricingConfigurations,
       catalog.catalog_document AS modelCatalogDocument,
       catalog.id AS modelCatalogSnapshotId,
       catalog.revision AS modelCatalogRevision,
       catalog.canonical_digest AS modelCatalogCanonicalDigest,
       catalog.source_digest AS modelCatalogSourceDigest,
       setting.activated_model_catalog_snapshot_id
         AS activatedModelCatalogSnapshotId,
       setting.activated_model_catalog_revision
         AS activatedModelCatalogRevision,
       activated_catalog.catalog_document
         AS activatedModelCatalogDocument,
       activated_catalog.canonical_digest
         AS activatedModelCatalogCanonicalDigest,
       activated_catalog.source_digest
         AS activatedModelCatalogSourceDigest,
       setting.model_catalog_changes_pending_review
         AS modelCatalogChangesPendingReview,
       endpoint.preset_kind AS preset,
       endpoint.base_url AS baseUrl,
       endpoint.id AS endpointId,
       endpoint.version AS endpointVersion,
       endpoint.lifecycle_status AS endpointLifecycle,
       endpoint.validation_status AS validationStatus,
       credential.id AS credentialId,
       credential.version AS credentialVersion,
       credential.lifecycle_status AS credentialLifecycle,
       credential.identity_epoch AS credentialIdentityEpoch,
       credential.identity_digest AS credentialIdentityDigest,
       credential.material_generation
         AS credentialMaterialGeneration,
       credential.active_secret_version_id
         AS activeSecretVersionId,
       candidate.id AS secretVersionId,
       candidate.material_generation
         AS secretMaterialGeneration,
       candidate.lifecycle_status AS secretLifecycle
     FROM provider_setting AS setting
     INNER JOIN provider_endpoint AS endpoint
       ON endpoint.workspace_id = setting.workspace_id
      AND endpoint.id = setting.provider_endpoint_id
     INNER JOIN credential
       ON credential.workspace_id = setting.workspace_id
      AND credential.id = setting.credential_id
     INNER JOIN secret_version AS candidate
       ON candidate.workspace_id = credential.workspace_id
      AND candidate.credential_id = credential.id
      AND candidate.version = (
        SELECT MAX(versioned.version)
        FROM secret_version AS versioned
        WHERE versioned.credential_id = credential.id
      )
     INNER JOIN provider_model_catalog_snapshot AS catalog
       ON catalog.workspace_id = setting.workspace_id
      AND catalog.provider_setting_id = setting.id
      AND catalog.id = setting.model_catalog_snapshot_id
      AND catalog.revision = setting.model_catalog_revision
     LEFT JOIN provider_model_catalog_snapshot AS activated_catalog
       ON activated_catalog.workspace_id = setting.workspace_id
      AND activated_catalog.provider_setting_id = setting.id
      AND activated_catalog.id =
          setting.activated_model_catalog_snapshot_id
      AND activated_catalog.revision =
          setting.activated_model_catalog_revision
     WHERE setting.workspace_id = ?
       AND setting.id = ?
     LIMIT 1
     FOR UPDATE`,
    [workspaceId, settingId],
  );
  const row = rows[0];
  if (!row) {
    throw new Error("Provider setting was not found.");
  }
  return row;
}

function assertExpectedVersion(
  aggregate: AggregateRow,
  expectedVersion: number,
): void {
  if (aggregate.settingVersion !== expectedVersion) {
    throw new Error("Provider setting changed before this operation.");
  }
}

async function replayOperation(
  connection: PoolConnection,
  options: ProviderSettingLifecycleOptions,
  operationKind: string,
): Promise<ProviderSettingMutation | undefined> {
  const [rows] = await connection.execute<OperationRow[]>(
    `SELECT
       provider_setting_id AS providerSettingId,
       operation_kind AS operationKind,
       request_digest AS requestDigest,
       result_version AS resultVersion
     FROM provider_setting_operation
     WHERE workspace_id = ?
       AND idempotency_key = ?
     LIMIT 1
     FOR SHARE`,
    [options.scope.workspaceId, options.idempotencyKey],
  );
  const row = rows[0];
  if (!row) {
    return undefined;
  }
  if (
    row.providerSettingId !== options.settingId ||
    row.operationKind !== operationKind ||
    row.requestDigest !== options.requestDigest
  ) {
    throw new Error(
      "Provider setting operation idempotency key was reused with different input.",
    );
  }
  return Object.freeze({
    provider: await readOne(
      connection,
      options.scope.workspaceId,
      options.settingId,
    ),
    result: "replayed",
  });
}

async function replayModelCatalogRefresh(
  connection: PoolConnection,
  options: RefreshProviderModelCatalogOptions,
): Promise<ProviderModelCatalogRefreshMutation | undefined> {
  const [rows] = await connection.execute<OperationRow[]>(
    `SELECT
       provider_setting_id AS providerSettingId,
       operation_kind AS operationKind,
       request_digest AS requestDigest,
       result_version AS resultVersion
     FROM provider_setting_operation
     WHERE workspace_id = ?
       AND idempotency_key = ?
     LIMIT 1
     FOR SHARE`,
    [options.scope.workspaceId, options.idempotencyKey],
  );
  const row = rows[0];
  if (!row) {
    return undefined;
  }
  if (
    row.providerSettingId !== options.settingId ||
    row.operationKind !== "refresh_model_catalog" ||
    row.requestDigest !== options.requestDigest
  ) {
    throw new Error(
      "Provider setting operation idempotency key was reused with different input.",
    );
  }
  const provider = await readOne(
    connection,
    options.scope.workspaceId,
    options.settingId,
  );
  return Object.freeze({
    provider,
    result: "replayed" as const,
    changesPendingReview: provider.modelCatalog?.changesPendingReview ?? false,
  });
}

async function replayModelCatalogAdoption(
  connection: PoolConnection,
  options: AdoptProviderModelCatalogOptions,
): Promise<ProviderModelCatalogAdoptionMutation | undefined> {
  const [rows] = await connection.execute<OperationRow[]>(
    `SELECT
       provider_setting_id AS providerSettingId,
       operation_kind AS operationKind,
       request_digest AS requestDigest,
       result_version AS resultVersion
     FROM provider_setting_operation
     WHERE workspace_id = ?
       AND idempotency_key = ?
     LIMIT 1
     FOR SHARE`,
    [options.scope.workspaceId, options.idempotencyKey],
  );
  const row = rows[0];
  if (!row) {
    return undefined;
  }
  if (
    row.providerSettingId !== options.settingId ||
    row.operationKind !== "adopt_model_catalog" ||
    row.requestDigest !== options.requestDigest
  ) {
    throw new Error(
      "Provider setting operation idempotency key was reused with different input.",
    );
  }
  const provider = await readOne(
    connection,
    options.scope.workspaceId,
    options.settingId,
  );
  const adoptedRevision = provider.modelCatalog?.activatedRevision;
  if (!adoptedRevision) {
    throw new Error(
      "Replayed Provider model catalog adoption has no activated revision.",
    );
  }
  return Object.freeze({
    provider,
    result: "replayed" as const,
    adoptedRevision,
  });
}

async function recordOperation(
  connection: PoolConnection,
  options: ProviderSettingLifecycleOptions,
  operationKind: string,
  resultVersion: number,
): Promise<void> {
  await connection.execute(
    `INSERT INTO provider_setting_operation (
       workspace_id, idempotency_key, provider_setting_id,
       operation_kind, request_digest, result_version, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      options.scope.workspaceId,
      options.idempotencyKey,
      options.settingId,
      operationKind,
      options.requestDigest,
      resultVersion,
      options.now,
    ],
  );
}

function authorizationDecision(scope: TrustedWorkspaceScope): {
  readonly permission: "credential.manage";
  readonly authorityVersion: number;
} {
  return Object.freeze({
    permission: "credential.manage",
    authorityVersion: scope.authorityVersion,
  });
}

async function appendSettingAudit(
  connection: PoolConnection,
  options: Pick<
    ProviderSettingLifecycleOptions,
    "scope" | "settingId" | "audit" | "now"
  >,
  event: {
    readonly eventType: string;
    readonly action: string;
    readonly outcome: string;
    readonly details: Readonly<Record<string, string | number>>;
  },
): Promise<void> {
  await appendControlPlaneAuditEventInTransaction(connection, options.audit, {
    organizationId: options.scope.organizationId,
    workspaceId: options.scope.workspaceId,
    eventType: event.eventType,
    action: event.action,
    resourceType: "provider_setting",
    resourceId: options.settingId,
    outcome: "succeeded",
    decisionReasonCode: event.outcome,
    severity: event.action === "disable" ? "warning" : "info",
    authorizationDecision: authorizationDecision(options.scope),
    details: event.details,
    occurredAt: options.now,
  });
}

async function appendRelatedAudit(
  connection: PoolConnection,
  options: ProviderSettingLifecycleOptions,
  index: number,
  event: {
    readonly eventType: string;
    readonly action: string;
    readonly resourceType: string;
    readonly resourceId: string;
    readonly outcome: string;
    readonly details: Readonly<Record<string, string | number>>;
  },
): Promise<void> {
  const auditEventId = options.relatedAuditEventIds[index];
  if (!auditEventId) {
    throw new Error("Provider setting lifecycle audit identity is missing.");
  }
  await appendControlPlaneAuditEventInTransaction(
    connection,
    {
      ...options.audit,
      auditEventId,
    },
    {
      organizationId: options.scope.organizationId,
      workspaceId: options.scope.workspaceId,
      eventType: event.eventType,
      action: event.action,
      resourceType: event.resourceType,
      resourceId: event.resourceId,
      outcome: "succeeded",
      decisionReasonCode: event.outcome,
      severity: event.action === "revoke" ? "high" : "info",
      authorizationDecision: authorizationDecision(options.scope),
      details: event.details,
      occurredAt: options.now,
    },
  );
}

function decodeJson(value: unknown): unknown {
  return typeof value === "string" ? (JSON.parse(value) as unknown) : value;
}

async function assertInstancePolicyAllowsEndpoint(
  connection: PoolConnection,
  endpointId: string,
): Promise<void> {
  const [rows] = await connection.execute<
    (RowDataPacket & { readonly policyDocument: unknown })[]
  >(
    `SELECT revision.policy_document AS policyDocument
     FROM instance_policy_binding AS binding
     INNER JOIN instance_policy_revision AS revision
       ON revision.id = binding.active_revision_id
     WHERE binding.singleton_id = 1
       AND revision.lifecycle_status = 'published'
     LIMIT 1
     FOR SHARE`,
  );
  const row = rows[0];
  if (!row) {
    throw new Error("Instance Provider policy is not configured.");
  }
  const policy = parseProviderConstraintDocument(
    decodeJson(row.policyDocument),
    "Active Instance Provider policy",
  );
  if (
    policy.allowedProviderEndpointIds &&
    !policy.allowedProviderEndpointIds.includes(endpointId)
  ) {
    throw new Error(
      "Active Instance Provider policy still uses a fixed Endpoint allowlist; publish the dynamic Provider baseline before activation.",
    );
  }
}

async function publishWorkspacePolicyForEndpoint(
  connection: PoolConnection,
  options: ActivateProviderSettingOptions,
  endpointId: string,
): Promise<void> {
  const [rows] = await connection.execute<WorkspacePolicyRow[]>(
    `SELECT
       binding.version AS bindingVersion,
       revision.id AS revisionId,
       revision.revision,
       revision.policy_document AS policyDocument
     FROM workspace_policy_binding AS binding
     INNER JOIN workspace_policy_revision AS revision
       ON revision.workspace_id = binding.workspace_id
      AND revision.id = binding.active_revision_id
     WHERE binding.workspace_id = ?
       AND revision.lifecycle_status = 'published'
     LIMIT 1
     FOR UPDATE`,
    [options.scope.workspaceId],
  );
  const current = rows[0];
  if (!current) {
    throw new Error("Workspace Provider policy is not configured.");
  }
  const policy = parseProviderConstraintDocument(
    decodeJson(current.policyDocument),
    "Active Workspace Provider policy",
  );
  if (!policy.allowedProviderEndpointIds) {
    return;
  }
  const allowedProviderEndpointIds = Object.freeze(
    [...new Set([...policy.allowedProviderEndpointIds, endpointId])].sort(),
  );
  if (policy.allowedProviderEndpointIds.includes(endpointId)) {
    return;
  }
  const nextDocument = parseProviderConstraintDocument(
    {
      ...policy,
      allowedProviderEndpointIds,
    },
    "Next Workspace Provider policy",
  );
  const nextDigest = digestProviderValue(nextDocument);
  await connection.execute(
    `INSERT INTO workspace_policy_revision (
       id, workspace_id, revision, schema_version,
       policy_document, canonical_digest, lifecycle_status,
       supersedes_revision_id, created_by_principal_id,
       published_by_principal_id, created_at, published_at
     ) VALUES (?, ?, ?, 1, ?, ?, 'published', ?, ?, ?, ?, ?)`,
    [
      options.resources.workspacePolicyRevisionId,
      options.scope.workspaceId,
      current.revision + 1,
      JSON.stringify(nextDocument),
      nextDigest,
      current.revisionId,
      options.scope.principalId,
      options.scope.principalId,
      options.now,
      options.now,
    ],
  );
  await connection.execute(
    `UPDATE workspace_policy_binding
     SET active_revision_id = ?,
         version = version + 1,
         updated_by_principal_id = ?,
         updated_at = ?
     WHERE workspace_id = ?
       AND active_revision_id = ?
       AND version = ?`,
    [
      options.resources.workspacePolicyRevisionId,
      options.scope.principalId,
      options.now,
      options.scope.workspaceId,
      current.revisionId,
      current.bindingVersion,
    ],
  );
}

async function inTransaction<TResult>(
  pool: Pool,
  use: (connection: PoolConnection) => Promise<TResult>,
): Promise<TResult> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await use(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export function createProviderSettingsStore(pool: Pool): ProviderSettingsStore {
  return Object.freeze({
    async list(
      scope: TrustedWorkspaceScope,
      now: Date,
    ): Promise<readonly ProviderSettingRecord[]> {
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          scope,
          "credential.manage",
          now,
        );
        const [rows] = await connection.execute<ProviderSettingRow[]>(
          `SELECT
               setting.id,
               setting.display_name AS displayName,
               endpoint.preset_kind AS preset,
               endpoint.base_url AS baseUrl,
               COALESCE(
                 (
                   SELECT JSON_ARRAYAGG(provider_model.upstream_model_id)
                   FROM provider_model
                   WHERE provider_model.workspace_id = setting.workspace_id
                     AND provider_model.provider_setting_id = setting.id
                     AND provider_model.lifecycle_status <> 'removed'
                 ),
                 setting.requested_model_keys
               ) AS modelKeys,
               catalog.catalog_document AS modelCatalogDocument,
               catalog.revision AS modelCatalogRevision,
               setting.activated_model_catalog_revision
                 AS activatedModelCatalogRevision,
               setting.model_catalog_changes_pending_review
                 AS modelCatalogChangesPendingReview,
               catalog.discovered_at AS modelCatalogDiscoveredAt,
               catalog.source_digest AS modelCatalogSourceDigest,
               catalog.discovery_method AS modelCatalogDiscoveryMethod,
               setting.model_deployment_id AS modelDeploymentId,
               setting.budget_account_id AS budgetAccountId,
               setting.activated_model_catalog_snapshot_id
                 AS activatedModelCatalogSnapshotId,
               setting.activated_model_catalog_revision
                 AS activatedModelCatalogRevision,
               endpoint.lifecycle_status AS endpointLifecycle,
               endpoint.validation_status AS validation,
               credential.lifecycle_status AS credentialLifecycle,
               credential.active_secret_version_id
                 AS activeSecretVersionId,
               secret.id AS secretVersionId,
               secret.material_fingerprint AS materialFingerprint,
               secret.lifecycle_status AS secretLifecycle,
               secret.created_at AS secretCreatedAt,
               endpoint.validated_at AS validatedAt,
               setting.activated_at AS activatedAt,
               setting.version,
               setting.created_at AS createdAt,
               setting.updated_at AS updatedAt
             FROM provider_setting AS setting
             INNER JOIN provider_endpoint AS endpoint
               ON endpoint.workspace_id = setting.workspace_id
              AND endpoint.id = setting.provider_endpoint_id
             INNER JOIN credential
               ON credential.workspace_id = setting.workspace_id
              AND credential.id = setting.credential_id
             LEFT JOIN secret_version AS secret
               ON secret.workspace_id = credential.workspace_id
              AND secret.credential_id = credential.id
              AND secret.version = (
                SELECT MAX(candidate.version)
                FROM secret_version AS candidate
                WHERE candidate.credential_id = credential.id
              )
             LEFT JOIN provider_model_catalog_snapshot AS catalog
               ON catalog.workspace_id = setting.workspace_id
              AND catalog.provider_setting_id = setting.id
              AND catalog.id = setting.model_catalog_snapshot_id
              AND catalog.revision =
                  setting.model_catalog_revision
             WHERE setting.workspace_id = ?
               AND setting.deleted_at IS NULL
             ORDER BY setting.updated_at DESC, setting.id`,
          [scope.workspaceId],
        );
        return Object.freeze(rows.map(recordFrom));
      });
    },

    async resolveSecretWriteIdentity(
      scope: TrustedWorkspaceScope,
      settingId: string,
      now: Date,
    ): Promise<{
      readonly credentialId: string;
      readonly providerKind: ProviderSettingPreset;
    }> {
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          scope,
          "credential.manage",
          now,
        );
        const [rows] = await connection.execute<SecretWriteIdentityRow[]>(
          `SELECT
               credential.id AS credentialId,
               credential.provider_kind AS providerKind
             FROM provider_setting AS setting
             INNER JOIN credential
               ON credential.workspace_id = setting.workspace_id
              AND credential.id = setting.credential_id
             WHERE setting.workspace_id = ?
               AND setting.id = ?
             LIMIT 1
             FOR SHARE`,
          [scope.workspaceId, settingId],
        );
        const row = rows[0];
        if (!row) {
          throw new Error("Provider setting was not found.");
        }
        return Object.freeze({
          credentialId: row.credentialId,
          providerKind: row.providerKind,
        });
      });
    },

    async resolveValidationIdentity(
      scope: TrustedWorkspaceScope,
      settingId: string,
      now: Date,
    ) {
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          scope,
          "credential.manage",
          now,
        );
        const [rows] = await connection.execute<ValidationIdentityRow[]>(
          `SELECT
               endpoint.preset_kind AS preset,
               endpoint.base_url AS baseUrl,
               setting.requested_model_keys AS modelKeys,
               secret.material_fingerprint
                 AS secretMaterialFingerprint
             FROM provider_setting AS setting
             INNER JOIN provider_endpoint AS endpoint
               ON endpoint.workspace_id = setting.workspace_id
              AND endpoint.id = setting.provider_endpoint_id
             INNER JOIN credential
               ON credential.workspace_id = setting.workspace_id
              AND credential.id = setting.credential_id
             INNER JOIN secret_version AS secret
               ON secret.workspace_id = credential.workspace_id
              AND secret.credential_id = credential.id
              AND secret.version = (
                SELECT MAX(candidate.version)
                FROM secret_version AS candidate
                WHERE candidate.credential_id = credential.id
              )
             WHERE setting.workspace_id = ?
               AND setting.id = ?
             LIMIT 1
             FOR SHARE`,
          [scope.workspaceId, settingId],
        );
        const row = rows[0];
        if (!row) {
          throw new Error("Provider setting was not found.");
        }
        return Object.freeze({
          preset: row.preset,
          baseUrl: row.baseUrl,
          modelKeys: parseModelKeys(row.modelKeys),
          secretMaterialFingerprint: row.secretMaterialFingerprint,
        });
      });
    },

    async resolveModelCatalogRefreshIdentity(
      scope: TrustedWorkspaceScope,
      settingId: string,
      now: Date,
    ) {
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          scope,
          "credential.manage",
          now,
        );
        const [rows] = await connection.execute<
          ModelCatalogRefreshIdentityRow[]
        >(
          `SELECT
               endpoint.preset_kind AS preset,
               endpoint.base_url AS baseUrl,
               endpoint.lifecycle_status AS endpointLifecycle,
               endpoint.validation_status AS validationStatus,
               setting.requested_model_keys AS modelKeys,
               setting.model_deployment_id AS modelDeploymentId,
               setting.budget_account_id AS budgetAccountId,
               setting.activated_model_catalog_snapshot_id
                 AS activatedModelCatalogSnapshotId,
               setting.activated_model_catalog_revision
                 AS activatedModelCatalogRevision,
               credential.id AS credentialId,
               credential.lifecycle_status
                 AS credentialLifecycle,
               credential.identity_epoch
                 AS credentialIdentityEpoch,
               credential.identity_digest
                 AS credentialIdentityDigest,
               credential.provider_endpoint_id
                 AS providerEndpointId,
               credential.active_secret_version_id
                 AS activeSecretVersionId,
               candidate.id AS latestSecretVersionId,
               candidate.lifecycle_status
                 AS latestSecretLifecycle
             FROM provider_setting AS setting
             INNER JOIN provider_endpoint AS endpoint
               ON endpoint.workspace_id = setting.workspace_id
              AND endpoint.id = setting.provider_endpoint_id
             INNER JOIN credential
               ON credential.workspace_id = setting.workspace_id
              AND credential.id = setting.credential_id
             INNER JOIN secret_version AS candidate
               ON candidate.workspace_id = credential.workspace_id
              AND candidate.credential_id = credential.id
              AND candidate.version = (
                SELECT MAX(versioned.version)
                FROM secret_version AS versioned
                WHERE versioned.credential_id = credential.id
              )
             WHERE setting.workspace_id = ?
               AND setting.id = ?
             LIMIT 1
             FOR SHARE`,
          [scope.workspaceId, settingId],
        );
        const row = rows[0];
        if (!row) {
          throw new Error("Provider setting was not found.");
        }
        const active =
          row.endpointLifecycle === "active" &&
          row.validationStatus === "passed" &&
          row.credentialLifecycle === "active" &&
          row.activeSecretVersionId !== null;
        const staged =
          row.modelDeploymentId === null &&
          row.budgetAccountId === null &&
          row.activatedModelCatalogSnapshotId === null &&
          row.activatedModelCatalogRevision === null &&
          row.endpointLifecycle === "disabled" &&
          row.validationStatus === "passed" &&
          row.credentialLifecycle === "disabled" &&
          row.activeSecretVersionId === null &&
          row.latestSecretLifecycle === "verified";
        if (!active && !staged) {
          throw new Error(
            "Only an active or validated never-activated Provider setting can refresh its model catalog.",
          );
        }
        const secretOptions = {
          workspaceId: scope.workspaceId,
          credentialId: row.credentialId,
          pinnedSecretVersionId: active
            ? row.activeSecretVersionId
            : row.latestSecretVersionId,
          expectedCredentialIdentityEpoch: row.credentialIdentityEpoch,
          expectedCredentialIdentityDigest: row.credentialIdentityDigest,
          expectedProviderEndpointId: row.providerEndpointId,
          now,
        };
        const secret = active
          ? await loadPinnedSecretVersionMetadataInTransaction(
              connection,
              secretOptions,
            )
          : await loadVerifiedSecretVersionMetadataForManagementInTransaction(
              connection,
              secretOptions,
            );
        return Object.freeze({
          mode: active ? ("active" as const) : ("staged" as const),
          preset: row.preset,
          baseUrl: row.baseUrl,
          modelKeys: parseModelKeys(row.modelKeys),
          secret,
        });
      });
    },

    async getModelCatalogReview(
      scope: TrustedWorkspaceScope,
      settingId: string,
      now: Date,
    ): Promise<ProviderModelCatalogReviewRecord> {
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          scope,
          "credential.manage",
          now,
        );
        const aggregate = await lockAggregate(
          connection,
          scope.workspaceId,
          settingId,
        );
        const runtimeAdapters =
          await loadProviderRuntimeAdapterProfilesInTransaction(
            connection,
            scope.workspaceId,
          );
        return reviewFromAggregate(aggregate, runtimeAdapters);
      });
    },

    async resolveModelCatalogAdoptionIdentity(
      scope: TrustedWorkspaceScope,
      settingId: string,
      now: Date,
    ) {
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          scope,
          "credential.manage",
          now,
        );
        const aggregate = await lockAggregate(
          connection,
          scope.workspaceId,
          settingId,
        );
        const runtimeAdapters =
          await loadProviderRuntimeAdapterProfilesInTransaction(
            connection,
            scope.workspaceId,
          );
        const review = reviewFromAggregate(aggregate, runtimeAdapters);
        if (!review.canAdopt || !review.activated) {
          throw new Error("Provider model catalog is not ready for adoption.");
        }
        if (
          aggregate.endpointLifecycle !== "active" ||
          aggregate.validationStatus !== "passed" ||
          aggregate.credentialLifecycle !== "active" ||
          aggregate.secretLifecycle !== "active" ||
          aggregate.activeSecretVersionId !== aggregate.secretVersionId
        ) {
          throw new Error(
            "Only an active Provider setting can adopt a model catalog.",
          );
        }
        const secret = await loadPinnedSecretVersionMetadataInTransaction(
          connection,
          {
            workspaceId: scope.workspaceId,
            credentialId: aggregate.credentialId,
            pinnedSecretVersionId: aggregate.secretVersionId,
            expectedCredentialIdentityEpoch: aggregate.credentialIdentityEpoch,
            expectedCredentialIdentityDigest:
              aggregate.credentialIdentityDigest,
            expectedProviderEndpointId: aggregate.endpointId,
            now,
          },
        );
        const current = parseProviderModelCatalogDocument(
          decodeJson(aggregate.modelCatalogDocument),
        );
        const modelKeys = parseModelKeys(aggregate.modelKeys);
        return Object.freeze({
          preset: aggregate.preset,
          baseUrl: aggregate.baseUrl,
          modelKeys,
          currentRevision: aggregate.modelCatalogRevision,
          activatedRevision: aggregate.activatedModelCatalogRevision!,
          currentSourceDigest: aggregate.modelCatalogSourceDigest,
          currentRuntimeDigest: selectedCatalogRuntimeDigest(
            current,
            modelKeys,
          ),
          secret,
        });
      });
    },

    async rename(
      options: RenameProviderSettingOptions,
    ): Promise<ProviderSettingRecord> {
      const displayName = options.displayName.trim();
      if (!displayName || displayName.length > 160) {
        throw new Error(
          "Provider display name must contain between 1 and 160 characters.",
        );
      }
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.scope,
          "credential.manage",
          options.now,
        );
        const aggregate = await lockAggregate(
          connection,
          options.scope.workspaceId,
          options.settingId,
        );
        assertExpectedVersion(aggregate, options.expectedVersion);
        if (aggregate.endpointLifecycle === "revoked") {
          throw new Error(
            "Only a non-deleted Provider setting can be renamed.",
          );
        }
        const current = await readOne(
          connection,
          options.scope.workspaceId,
          options.settingId,
        );
        if (current.displayName === displayName) return current;
        await connection.execute(
          `UPDATE provider_setting SET display_name = ?, version = version + 1, updated_at = ?
           WHERE workspace_id = ? AND id = ? AND version = ?`,
          [
            displayName,
            options.now,
            options.scope.workspaceId,
            options.settingId,
            options.expectedVersion,
          ],
        );
        await appendSettingAudit(connection, options, {
          eventType: "provider_setting.renamed",
          action: "rename",
          outcome: "provider_setting.renamed",
          details: {
            previousName: current.displayName,
            displayName,
            version: options.expectedVersion + 1,
          },
        });
        return readOne(
          connection,
          options.scope.workspaceId,
          options.settingId,
        );
      });
    },

    async create(options: CreateProviderSettingOptions): Promise<{
      readonly provider: ProviderSettingRecord;
      readonly result: "created" | "replayed";
    }> {
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.scope,
          "credential.manage",
          options.createdAt,
        );
        const [idempotencyRows] = await connection.execute<IdempotencyRow[]>(
          `SELECT id, request_digest AS requestDigest
             FROM provider_setting
             WHERE workspace_id = ?
               AND idempotency_key = ?
             LIMIT 1
             FOR SHARE`,
          [options.scope.workspaceId, options.idempotencyKey],
        );
        const replay = idempotencyRows[0];
        if (replay) {
          if (replay.requestDigest !== options.requestDigest) {
            throw new Error(
              "Provider setting idempotency key was reused with different input.",
            );
          }
          return Object.freeze({
            provider: await readOne(
              connection,
              options.scope.workspaceId,
              replay.id,
            ),
            result: "replayed" as const,
          });
        }
        const [stagedRows] = await connection.execute<IdRow[]>(
          `SELECT setting.id
           FROM provider_setting AS setting
           INNER JOIN provider_endpoint AS endpoint
             ON endpoint.workspace_id = setting.workspace_id
            AND endpoint.id = setting.provider_endpoint_id
           INNER JOIN credential
             ON credential.workspace_id = setting.workspace_id
            AND credential.id = setting.credential_id
           INNER JOIN secret_version AS secret
             ON secret.workspace_id = credential.workspace_id
            AND secret.credential_id = credential.id
            AND secret.version = (
              SELECT MAX(candidate.version)
              FROM secret_version AS candidate
              WHERE candidate.credential_id = credential.id
            )
           WHERE setting.workspace_id = ?
             AND setting.display_name = ?
             AND setting.activated_at IS NULL
             AND setting.deleted_at IS NULL
             AND endpoint.preset_kind = ?
             AND endpoint.base_url = ?
             AND secret.material_fingerprint = ?
           ORDER BY setting.created_at DESC
           LIMIT 1
           FOR SHARE`,
          [
            options.scope.workspaceId,
            options.displayName,
            options.preset,
            options.baseUrl,
            options.secretMaterialFingerprint,
          ],
        );
        const staged = stagedRows[0];
        if (staged) {
          return Object.freeze({
            provider: await readOne(
              connection,
              options.scope.workspaceId,
              staged.id,
            ),
            result: "replayed" as const,
          });
        }
        const catalog = parseProviderModelCatalogDocument(
          options.modelCatalog.document,
        );
        if (
          catalog.providerPreset !== options.preset ||
          options.modelCatalog.discoveredAt > options.createdAt ||
          options.modelKeys.some(
            (modelKey) =>
              !catalog.models.some(
                (model) => model.providerModelId === modelKey,
              ),
          )
        ) {
          throw new Error("Provider model catalog does not match the setting.");
        }
        const catalogDigest = digestProviderValue(catalog);
        const expectedValidationDigest = providerSettingValidationDigest({
          providerSettingId: options.settingId,
          providerEndpointId: options.endpointId,
          preset: options.preset,
          baseUrlDigest: options.baseUrlDigest,
          modelCatalogDigest: catalogDigest,
          modelCatalogSourceDigest: catalog.sourceDigest,
          selectedModelKeys: options.modelKeys,
          secretMaterialFingerprint: options.secretMaterialFingerprint,
          validatedAt: options.validatedAt,
        });
        if (
          options.validationDigest !== expectedValidationDigest ||
          options.validatedAt.getTime() !== options.createdAt.getTime()
        ) {
          throw new Error(
            "Provider setting validation evidence does not match the setting.",
          );
        }
        const networkPolicy = JSON.stringify({
          allowRedirects: false,
          canonicalOrigin: options.canonicalOrigin,
        });
        const dataPolicy = JSON.stringify({
          classification: "workspace_configured",
          outboundImagesAllowed: true,
        });
        await connection.execute(
          `INSERT INTO provider_endpoint (
             id, workspace_id, endpoint_key, adapter_kind, preset_kind,
             base_url, canonical_origin, base_url_digest, region_code,
             network_policy, data_policy, lifecycle_status,
             validation_status, validation_digest, validated_at, version,
             created_by_principal_id, created_at, updated_at
           ) VALUES (
             ?, ?, ?, ?, ?, ?, ?, ?, ?,
             ?, ?, 'disabled', 'passed', ?, ?, 1, ?, ?, ?
           )`,
          [
            options.endpointId,
            options.scope.workspaceId,
            `provider-setting-${options.settingId}`,
            options.adapterKind,
            options.preset,
            options.baseUrl,
            options.canonicalOrigin,
            options.baseUrlDigest,
            options.regionCode,
            networkPolicy,
            dataPolicy,
            options.validationDigest,
            options.validatedAt,
            options.scope.principalId,
            options.createdAt,
            options.createdAt,
          ],
        );
        await connection.execute(
          `INSERT INTO credential (
             id, workspace_id, provider_endpoint_id, credential_key,
             provider_kind, authority_digest, billing_identity_digest,
             egress_identity_digest, identity_digest, identity_epoch,
             material_generation, active_secret_version_id,
             lifecycle_status, version, created_by_principal_id,
             created_at, updated_at
           ) VALUES (
             ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, NULL,
             'disabled', 1, ?, ?, ?
           )`,
          [
            options.credentialId,
            options.scope.workspaceId,
            options.endpointId,
            `provider-setting-${options.settingId}`,
            options.providerKind,
            options.authorityDigest,
            options.billingIdentityDigest,
            options.egressIdentityDigest,
            options.credentialIdentityDigest,
            options.scope.principalId,
            options.createdAt,
            options.createdAt,
          ],
        );
        const plaintext =
          options.secretSource.kind === "plaintext_database"
            ? options.secretSource.plaintext
            : undefined;
        const envelope =
          options.secretSource.kind === "encrypted_database"
            ? options.secretSource.envelope
            : undefined;
        await connection.execute(
          `INSERT INTO secret_version (
             id, workspace_id, credential_id, version,
             material_generation, source_kind, lifecycle_status,
             material_plaintext_base64,
             material_ciphertext_base64, material_nonce_base64,
             material_auth_tag_base64, wrapped_dek_base64,
             wrap_nonce_base64, wrap_auth_tag_base64, kek_version,
             aad_digest, deployment_reference, material_fingerprint,
             format_version, drain_deadline_at, verified_at,
             activated_at, retired_at, revoked_at, destroyed_at,
             created_by_principal_id, created_at
           ) VALUES (
             ?, ?, ?, 1, 1, ?, 'verified',
             ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 1,
             NULL, ?, NULL, NULL, NULL, NULL, ?, ?
           )`,
          [
            options.secretVersionId,
            options.scope.workspaceId,
            options.credentialId,
            options.secretSource.kind,
            plaintext?.materialPlaintextBase64 ?? null,
            envelope?.materialCiphertextBase64 ?? null,
            envelope?.materialNonceBase64 ?? null,
            envelope?.materialAuthTagBase64 ?? null,
            envelope?.wrappedDekBase64 ?? null,
            envelope?.wrapNonceBase64 ?? null,
            envelope?.wrapAuthTagBase64 ?? null,
            envelope?.kekVersion ?? null,
            options.secretAadDigest,
            options.secretMaterialFingerprint,
            options.validatedAt,
            options.scope.principalId,
            options.createdAt,
          ],
        );
        await connection.execute(
          `INSERT INTO provider_setting (
             id, workspace_id, display_name, provider_endpoint_id,
             credential_id, requested_model_keys, idempotency_key,
             request_digest, version,
             created_by_principal_id, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
          [
            options.settingId,
            options.scope.workspaceId,
            options.displayName,
            options.endpointId,
            options.credentialId,
            JSON.stringify(options.modelKeys),
            options.idempotencyKey,
            options.requestDigest,
            options.scope.principalId,
            options.createdAt,
            options.createdAt,
          ],
        );
        await connection.execute(
          `INSERT INTO provider_model_catalog_snapshot (
             id, workspace_id, provider_setting_id,
             provider_endpoint_id, revision, schema_version,
             discovery_method, source_digest, catalog_document,
             canonical_digest, discovered_at,
             created_by_principal_id, created_at
           ) VALUES (?, ?, ?, ?, 1, 1, ?, ?, ?, ?, ?, ?, ?)`,
          [
            options.modelCatalog.snapshotId,
            options.scope.workspaceId,
            options.settingId,
            options.endpointId,
            catalog.discoveryMethod,
            catalog.sourceDigest,
            JSON.stringify(catalog),
            catalogDigest,
            options.modelCatalog.discoveredAt,
            options.scope.principalId,
            options.createdAt,
          ],
        );
        await connection.execute(
          `UPDATE provider_setting
           SET model_catalog_snapshot_id = ?,
               model_catalog_revision = 1
           WHERE workspace_id = ?
             AND id = ?
             AND version = 1
             AND model_catalog_snapshot_id IS NULL
             AND model_catalog_revision IS NULL`,
          [
            options.modelCatalog.snapshotId,
            options.scope.workspaceId,
            options.settingId,
          ],
        );
        const authorizationDecision = {
          permission: "credential.manage",
          authorityVersion: options.scope.authorityVersion,
        } as const;
        await appendControlPlaneAuditEventInTransaction(
          connection,
          options.audit,
          {
            organizationId: options.scope.organizationId,
            workspaceId: options.scope.workspaceId,
            eventType: "provider_setting.created",
            action: "create",
            resourceType: "provider_setting",
            resourceId: options.settingId,
            outcome: "succeeded",
            decisionReasonCode: "provider_setting.created",
            severity: "info",
            authorizationDecision,
            details: {
              preset: options.preset,
              modelCount: options.modelKeys.length,
              modelCatalogDigest: catalogDigest,
              modelCatalogSourceDigest: catalog.sourceDigest,
              lifecycleStatus: "draft",
              validationStatus: "passed",
              validationDigest: options.validationDigest,
              validatedAt: options.validatedAt.toISOString(),
            },
            occurredAt: options.createdAt,
          },
        );
        await appendControlPlaneAuditEventInTransaction(
          connection,
          {
            ...options.audit,
            auditEventId: options.secretAuditEventId,
          },
          {
            organizationId: options.scope.organizationId,
            workspaceId: options.scope.workspaceId,
            eventType: "secret_version.created",
            action: "create",
            resourceType: "secret_version",
            resourceId: options.secretVersionId,
            outcome: "succeeded",
            decisionReasonCode: "secret_version.created",
            severity: "info",
            authorizationDecision,
            details: {
              sourceKind: options.secretSource.kind,
              lifecycleStatus: "verified",
              verifiedAt: options.validatedAt.toISOString(),
              version: 1,
              materialGeneration: 1,
              formatVersion: 1,
            },
            occurredAt: options.createdAt,
          },
        );
        return Object.freeze({
          provider: await readOne(
            connection,
            options.scope.workspaceId,
            options.settingId,
          ),
          result: "created" as const,
        });
      });
    },

    async createAgentTextModel(
      options: CreateProviderAgentTextModelOptions,
    ): Promise<CreateProviderAgentTextModelResult> {
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.scope,
          "credential.manage",
          options.now,
        );
        const aggregate = await lockAggregate(
          connection,
          options.scope.workspaceId,
          options.settingId,
        );
        if (
          aggregate.endpointLifecycle !== "active" ||
          aggregate.validationStatus !== "passed" ||
          aggregate.credentialLifecycle !== "active" ||
          aggregate.secretLifecycle !== "active" ||
          aggregate.activeSecretVersionId !== aggregate.secretVersionId ||
          !aggregate.budgetAccountId
        ) {
          throw new Error(
            "Only an active Provider setting can publish an Agent text model.",
          );
        }
        const catalog = parseProviderModelCatalogDocument(
          decodeJson(aggregate.modelCatalogDocument),
        );
        if (
          catalog.providerPreset !== aggregate.preset ||
          !catalog.models.some(
            (model) => model.providerModelId === options.providerModelId,
          )
        ) {
          throw new Error(
            "Selected Agent model is absent from the current Provider catalog.",
          );
        }
        let control = buildProviderAgentTextControlPlaneDefinition({
          providerSettingId: options.settingId,
          providerEndpointId: aggregate.endpointId,
          credentialId: aggregate.credentialId,
          budgetAccountId: aggregate.budgetAccountId,
          bindingId: options.bindingId,
          modelProfileRevisionId: options.modelProfileRevisionId,
          modelDeploymentId: options.modelDeploymentId,
          pricingRevisionId: options.pricingRevisionId,
          preset: aggregate.preset,
          providerModelId: options.providerModelId,
          displayName: options.displayName,
          pricing: options.pricing,
          observedAt: options.now,
        });
        const [existingRows] = await connection.execute<AgentTextBindingRow[]>(
          `SELECT
             binding.id,
             binding.binding_key AS bindingKey,
             binding.provider_endpoint_id AS providerEndpointId,
             binding.credential_id AS credentialId,
             binding.budget_account_id AS budgetAccountId,
             binding.api_surface AS apiSurface,
             binding.protocol_kind AS protocolKind,
             binding.maximum_charge_amount AS maximumChargeAmount,
             binding.route_digest AS routeDigest,
             binding.idempotency_key AS idempotencyKey,
             binding.request_hash AS requestDigest,
             profile.canonical_digest AS profileDigest,
             deployment.deployment_digest AS deploymentDigest,
             pricing.canonical_digest AS pricingDigest
           FROM agent_model_binding AS binding
           INNER JOIN model_profile_revision AS profile
             ON profile.workspace_id = binding.workspace_id
            AND profile.id = binding.model_profile_revision_id
           INNER JOIN model_deployment AS deployment
             ON deployment.workspace_id = binding.workspace_id
            AND deployment.id = binding.model_deployment_id
           INNER JOIN pricing_revision AS pricing
             ON pricing.workspace_id = binding.workspace_id
            AND pricing.id = binding.pricing_revision_id
           WHERE binding.workspace_id = ?
             AND (binding.idempotency_key = ? OR binding.binding_key = ?)
           ORDER BY binding.idempotency_key = ? DESC
           LIMIT 1
           FOR UPDATE`,
          [
            options.scope.workspaceId,
            options.idempotencyKey,
            control.bindingKey,
            options.idempotencyKey,
          ],
        );
        const existing = existingRows[0];
        if (existing) {
          if (
            existing.idempotencyKey === options.idempotencyKey &&
            existing.requestDigest !== options.requestDigest
          ) {
            throw new Error(
              "Agent text model idempotency key was reused with a different request.",
            );
          }
          if (
            existing.providerEndpointId !== aggregate.endpointId ||
            existing.credentialId !== aggregate.credentialId ||
            existing.budgetAccountId !== aggregate.budgetAccountId ||
            existing.apiSurface !== control.apiSurface ||
            existing.protocolKind !== control.protocolKind ||
            normalizeUnsignedDecimal(existing.maximumChargeAmount) !==
              control.maximumCharge.amount ||
            existing.profileDigest !== control.modelProfileDigest ||
            existing.pricingDigest !== control.pricingDigest
          ) {
            throw new Error(
              "Existing Agent text model binding conflicts with its content identity.",
            );
          }
          return Object.freeze({
            bindingId: existing.id,
            bindingKey: existing.bindingKey,
            replayed: true,
          });
        }
        const [profileRows] = await connection.execute<IdRow[]>(
          `SELECT id FROM model_profile_revision
           WHERE workspace_id = ? AND canonical_digest = ?
             AND lifecycle_status = 'published'
           LIMIT 1 FOR SHARE`,
          [options.scope.workspaceId, control.modelProfileDigest],
        );
        const modelProfileRevisionId =
          profileRows[0]?.id ?? options.modelProfileRevisionId;
        if (modelProfileRevisionId !== options.modelProfileRevisionId) {
          control = buildProviderAgentTextControlPlaneDefinition({
            providerSettingId: options.settingId,
            providerEndpointId: aggregate.endpointId,
            credentialId: aggregate.credentialId,
            budgetAccountId: aggregate.budgetAccountId,
            bindingId: options.bindingId,
            modelProfileRevisionId,
            modelDeploymentId: options.modelDeploymentId,
            pricingRevisionId: options.pricingRevisionId,
            preset: aggregate.preset,
            providerModelId: options.providerModelId,
            displayName: options.displayName,
            pricing: options.pricing,
            observedAt: options.now,
          });
        } else {
          await connection.execute(
            `INSERT INTO model_profile_revision (
               id, workspace_id, profile_key, revision, schema_version,
               profile_document, canonical_digest, lifecycle_status,
               created_by_principal_id, published_by_principal_id,
               created_at, published_at
             ) VALUES (?, ?, ?, 1, 1, ?, ?, 'published', ?, ?, ?, ?)`,
            [
              modelProfileRevisionId,
              options.scope.workspaceId,
              control.bindingKey,
              JSON.stringify(control.modelProfileDocument),
              control.modelProfileDigest,
              options.scope.principalId,
              options.scope.principalId,
              options.now,
              options.now,
            ],
          );
        }
        await connection.execute(
          `INSERT INTO model_deployment (
             id, workspace_id, provider_endpoint_id,
             model_profile_revision_id, deployment_key, provider_model_id,
             deployment_digest, lifecycle_status, version,
             created_by_principal_id, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?, ?)`,
          [
            options.modelDeploymentId,
            options.scope.workspaceId,
            aggregate.endpointId,
            modelProfileRevisionId,
            control.bindingKey,
            options.providerModelId,
            control.modelDeploymentDigest,
            options.scope.principalId,
            options.now,
            options.now,
          ],
        );
        await connection.execute(
          `INSERT INTO pricing_revision (
             id, workspace_id, provider_endpoint_id, model_deployment_id,
             pricing_key, revision, schema_version, currency_code,
             pricing_document, canonical_digest, lifecycle_status, source_kind,
             verified_at, effective_at, created_by_principal_id,
             published_by_principal_id, created_at, published_at
           ) VALUES (?, ?, ?, ?, ?, 1, 1, 'USD', ?, ?, 'published',
                     'contract', ?, ?, ?, ?, ?, ?)`,
          [
            options.pricingRevisionId,
            options.scope.workspaceId,
            aggregate.endpointId,
            options.modelDeploymentId,
            control.bindingKey,
            JSON.stringify(control.pricingDocument),
            control.pricingDigest,
            options.now,
            options.now,
            options.scope.principalId,
            options.scope.principalId,
            options.now,
            options.now,
          ],
        );
        await connection.execute(
          `INSERT INTO agent_model_binding (
             id, workspace_id, binding_key, model_profile_revision_id,
             model_deployment_id, provider_endpoint_id, credential_id,
             budget_account_id, maximum_charge_currency_code,
             maximum_charge_amount, pricing_revision_id, api_surface,
             protocol_kind,
             lifecycle_status, route_digest, idempotency_key, request_hash,
             version, created_by_principal_id, updated_by_principal_id,
             created_at, updated_at, disabled_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'USD', ?, ?, ?, ?, 'enabled',
                     ?, ?, ?, 1, ?, ?, ?, ?, NULL)`,
          [
            options.bindingId,
            options.scope.workspaceId,
            control.bindingKey,
            modelProfileRevisionId,
            options.modelDeploymentId,
            aggregate.endpointId,
            aggregate.credentialId,
            aggregate.budgetAccountId,
            control.maximumCharge.amount,
            options.pricingRevisionId,
            control.apiSurface,
            control.protocolKind,
            control.routeDigest,
            options.idempotencyKey,
            options.requestDigest,
            options.scope.principalId,
            options.scope.principalId,
            options.now,
            options.now,
          ],
        );
        await appendControlPlaneAuditEventInTransaction(
          connection,
          options.audit,
          {
            organizationId: options.scope.organizationId,
            workspaceId: options.scope.workspaceId,
            eventType: "provider_setting.agent_text_model_published",
            action: "publish_agent_text_model",
            resourceType: "agent_model_binding",
            resourceId: options.bindingId,
            outcome: "succeeded",
            decisionReasonCode: "provider_setting.agent_text_model_published",
            severity: "info",
            authorizationDecision: authorizationDecision(options.scope),
            details: {
              providerSettingId: options.settingId,
              providerModelId: options.providerModelId,
              bindingKey: control.bindingKey,
              pricingDigest: control.pricingDigest,
            },
            occurredAt: options.now,
          },
        );
        return Object.freeze({
          bindingId: options.bindingId,
          bindingKey: control.bindingKey,
          replayed: false,
        });
      });
    },

    async validate(
      options: ProviderSettingLifecycleOptions,
    ): Promise<ProviderSettingMutation> {
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.scope,
          "credential.manage",
          options.now,
        );
        const replay = await replayOperation(connection, options, "validate");
        if (replay) {
          return replay;
        }
        const aggregate = await lockAggregate(
          connection,
          options.scope.workspaceId,
          options.settingId,
        );
        assertExpectedVersion(aggregate, options.expectedVersion);
        if (
          aggregate.endpointLifecycle !== "disabled" ||
          !["pending", "failed"].includes(aggregate.validationStatus) ||
          !["created", "active"].includes(aggregate.secretLifecycle)
        ) {
          throw new Error("Only a staged Provider setting can be validated.");
        }
        const validationDigest = digestProviderValue({
          domain: "kanvas.provider-setting-validation.v1",
          providerSettingId: options.settingId,
          providerEndpointId: aggregate.endpointId,
          preset: aggregate.preset,
          validatedAt: options.now.toISOString(),
        });
        await connection.execute(
          `UPDATE provider_endpoint
           SET validation_status = 'passed',
               validation_digest = ?,
               validated_at = ?,
               version = version + 1,
               updated_at = ?
           WHERE workspace_id = ?
             AND id = ?
             AND version = ?
             AND lifecycle_status = 'disabled'
             AND validation_status IN ('pending', 'failed')`,
          [
            validationDigest,
            options.now,
            options.now,
            options.scope.workspaceId,
            aggregate.endpointId,
            aggregate.endpointVersion,
          ],
        );
        if (aggregate.secretLifecycle === "created") {
          await connection.execute(
            `UPDATE secret_version
             SET lifecycle_status = 'verified',
                 verified_at = ?
             WHERE workspace_id = ?
               AND credential_id = ?
               AND id = ?
               AND lifecycle_status = 'created'`,
            [
              options.now,
              options.scope.workspaceId,
              aggregate.credentialId,
              aggregate.secretVersionId,
            ],
          );
        }
        const nextVersion = aggregate.settingVersion + 1;
        await connection.execute(
          `UPDATE provider_setting
           SET version = ?, updated_at = ?
           WHERE workspace_id = ?
             AND id = ?
             AND version = ?`,
          [
            nextVersion,
            options.now,
            options.scope.workspaceId,
            options.settingId,
            aggregate.settingVersion,
          ],
        );
        await recordOperation(connection, options, "validate", nextVersion);
        await appendSettingAudit(connection, options, {
          eventType: "provider_setting.validated",
          action: "validate",
          outcome: "provider_setting.validated",
          details: {
            preset: aggregate.preset,
            validationStatus: "passed",
            version: nextVersion,
          },
        });
        await appendRelatedAudit(connection, options, 0, {
          eventType: "secret_version.verified",
          action: "verify",
          resourceType: "secret_version",
          resourceId: aggregate.secretVersionId,
          outcome: "secret_version.verified",
          details: {
            lifecycleStatus: "verified",
            materialGeneration: aggregate.secretMaterialGeneration,
          },
        });
        return Object.freeze({
          provider: await readOne(
            connection,
            options.scope.workspaceId,
            options.settingId,
          ),
          result: "validated" as const,
        });
      });
    },

    async activate(
      options: ActivateProviderSettingOptions,
    ): Promise<ProviderSettingMutation> {
      return inTransaction(pool, async (connection) => {
        const hardLimitAmount = normalizeUnsignedDecimal(
          options.hardLimitAmount,
          "hardLimitAmount",
        );
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.scope,
          "credential.manage",
          options.now,
        );
        const replay = await replayOperation(connection, options, "activate");
        if (replay) {
          return replay;
        }
        const aggregate = await lockAggregate(
          connection,
          options.scope.workspaceId,
          options.settingId,
        );
        assertExpectedVersion(aggregate, options.expectedVersion);
        const canReactivate =
          (aggregate.endpointLifecycle === "disabled" ||
            aggregate.endpointLifecycle === "draining") &&
          aggregate.validationStatus === "passed" &&
          (aggregate.credentialLifecycle === "disabled" ||
            aggregate.credentialLifecycle === "active") &&
          aggregate.secretLifecycle === "active" &&
          aggregate.activeSecretVersionId === aggregate.secretVersionId &&
          Boolean(aggregate.budgetAccountId);
        if (canReactivate) {
          await assertInstancePolicyAllowsEndpoint(
            connection,
            aggregate.endpointId,
          );
          await connection.execute(
            `UPDATE model_deployment
             SET lifecycle_status = 'active',
                 version = version + 1,
                 updated_at = ?
             WHERE workspace_id = ?
               AND provider_endpoint_id = ?
               AND lifecycle_status IN ('disabled', 'draining')`,
            [options.now, options.scope.workspaceId, aggregate.endpointId],
          );
          const [budgetResult] = await connection.execute<ResultSetHeader>(
            `UPDATE budget_account
             SET lifecycle_status = 'active',
                 hard_limit_amount = ?,
                 version = version + 1,
                 updated_at = ?
             WHERE workspace_id = ?
               AND id = ?
               AND lifecycle_status IN ('active', 'frozen')
               AND ? >= (
                 consumed_amount + reserved_amount + unknown_held_amount
               )`,
            [
              hardLimitAmount,
              options.now,
              options.scope.workspaceId,
              aggregate.budgetAccountId,
              hardLimitAmount,
            ],
          );
          if (budgetResult.affectedRows !== 1) {
            throw new Error(
              "Provider budget limit cannot be lower than committed usage.",
            );
          }
          await connection.execute(
            `UPDATE credential
             SET lifecycle_status = 'active',
                 version = version + 1,
                 updated_at = ?
             WHERE workspace_id = ?
               AND id = ?
               AND lifecycle_status = 'disabled'`,
            [options.now, options.scope.workspaceId, aggregate.credentialId],
          );
          await connection.execute(
            `UPDATE provider_endpoint
             SET lifecycle_status = 'active',
                 version = version + 1,
                 updated_at = ?
             WHERE workspace_id = ?
               AND id = ?
               AND lifecycle_status IN ('disabled', 'draining')
               AND validation_status = 'passed'`,
            [options.now, options.scope.workspaceId, aggregate.endpointId],
          );
          const nextVersion = aggregate.settingVersion + 1;
          await connection.execute(
            `UPDATE provider_setting
             SET activated_at = ?,
                 disabled_at = NULL,
                 version = ?,
                 updated_at = ?
             WHERE workspace_id = ?
               AND id = ?
               AND version = ?`,
            [
              options.now,
              nextVersion,
              options.now,
              options.scope.workspaceId,
              options.settingId,
              aggregate.settingVersion,
            ],
          );
          await recordOperation(connection, options, "activate", nextVersion);
          await appendSettingAudit(connection, options, {
            eventType: "provider_setting.activated",
            action: "activate",
            outcome: "provider_setting.reactivated",
            details: {
              hardLimitAmount,
              lifecycleStatus: "active",
              reactivation: "true",
              version: nextVersion,
            },
          });
          return Object.freeze({
            provider: await readOne(
              connection,
              options.scope.workspaceId,
              options.settingId,
            ),
            result: "activated" as const,
          });
        }
        if (
          aggregate.endpointLifecycle !== "disabled" ||
          aggregate.validationStatus !== "passed" ||
          aggregate.credentialLifecycle !== "disabled" ||
          aggregate.secretLifecycle !== "verified"
        ) {
          throw new Error(
            "Only a validated Provider setting can be activated.",
          );
        }
        await assertInstancePolicyAllowsEndpoint(
          connection,
          aggregate.endpointId,
        );
        const modelKeys = parseModelKeys(aggregate.modelKeys);
        const modelPricingConfigurations =
          parseProviderSettingModelPricingConfigurations(
            options.modelPricingConfigurations,
            modelKeys,
          );
        const pricingByModel = new Map(
          modelPricingConfigurations.map((configuration) => [
            configuration.providerModelId,
            configuration,
          ]),
        );
        const modelCatalog = parseProviderModelCatalogDocument(
          decodeJson(aggregate.modelCatalogDocument),
        );
        if (modelCatalog.providerPreset !== aggregate.preset) {
          throw new Error(
            "Provider setting model catalog no longer matches its endpoint.",
          );
        }
        const catalogModels = new Map(
          modelCatalog.models.map((model) => [model.providerModelId, model]),
        );
        const runtimeAdapters =
          await loadProviderRuntimeAdapterProfilesInTransaction(
            connection,
            options.scope.workspaceId,
          );
        if (options.resources.models.length < modelKeys.length) {
          throw new Error(
            "Provider setting activation is missing model deployment identities.",
          );
        }
        await connection.execute(
          `INSERT INTO budget_account (
             id, workspace_id, account_key, currency_code,
             period_start_at, period_end_at, hard_limit_amount,
             consumed_amount, reserved_amount, unknown_held_amount,
             lifecycle_status, version, created_by_principal_id,
             created_at, updated_at
           ) VALUES (
             ?, ?, ?, 'USD', ?, ?, ?, 0, 0, 0,
             'active', 1, ?, ?, ?
           )`,
          [
            options.resources.budgetAccountId,
            options.scope.workspaceId,
            `provider-setting-${options.settingId}`,
            options.now,
            new Date(options.now.getTime() + 10 * 365 * 24 * 60 * 60 * 1_000),
            hardLimitAmount,
            options.scope.principalId,
            options.now,
            options.now,
          ],
        );
        const activatedModels: {
          readonly control: ProviderSettingControlPlaneDefinition;
          readonly modelProfileRevisionId: string;
          readonly resources: Omit<
            ProviderSettingControlPlaneIds,
            "endpointId" | "credentialId" | "budgetAccountId"
          >;
        }[] = [];
        for (const [index, providerModelId] of modelKeys.entries()) {
          const resources = options.resources.models[index]!;
          const catalogEntry = catalogModels.get(providerModelId);
          if (!catalogEntry || catalogEntry.completeness === "identity_only") {
            throw new Error(
              "Provider setting activation requires evidenced image model capabilities.",
            );
          }
          let control = buildProviderSettingControlPlaneDefinition({
            ids: {
              endpointId: aggregate.endpointId,
              credentialId: aggregate.credentialId,
              ...resources,
              budgetAccountId: options.resources.budgetAccountId,
            },
            providerSettingId: options.settingId,
            preset: aggregate.preset,
            providerModelId,
            catalogEntry,
            pricingConfiguration: pricingByModel.get(providerModelId)!,
            runtimeAdapters,
            observedAt: options.now,
          });
          const [profileRows] = await connection.execute<IdRow[]>(
            `SELECT id
               FROM model_profile_revision
               WHERE workspace_id = ?
                 AND canonical_digest = ?
                 AND lifecycle_status = 'published'
               LIMIT 1
               FOR SHARE`,
            [options.scope.workspaceId, control.modelProfileDigest],
          );
          const modelProfileRevisionId =
            profileRows[0]?.id ?? resources.modelProfileRevisionId;
          if (modelProfileRevisionId !== resources.modelProfileRevisionId) {
            control = buildProviderSettingControlPlaneDefinition({
              ids: {
                endpointId: aggregate.endpointId,
                credentialId: aggregate.credentialId,
                ...resources,
                modelProfileRevisionId,
                budgetAccountId: options.resources.budgetAccountId,
              },
              providerSettingId: options.settingId,
              preset: aggregate.preset,
              providerModelId,
              catalogEntry,
              pricingConfiguration: pricingByModel.get(providerModelId)!,
              runtimeAdapters,
              observedAt: options.now,
            });
          } else {
            await connection.execute(
              `INSERT INTO model_profile_revision (
                 id, workspace_id, profile_key, revision,
                 schema_version, profile_document, canonical_digest,
                 lifecycle_status, created_by_principal_id,
                 published_by_principal_id, created_at, published_at
               ) VALUES (?, ?, ?, 1, 1, ?, ?, 'published', ?, ?, ?, ?)`,
              [
                modelProfileRevisionId,
                options.scope.workspaceId,
                `provider-setting-${options.settingId}-${String(index + 1)}`,
                JSON.stringify(control.modelProfileDocument),
                control.modelProfileDigest,
                options.scope.principalId,
                options.scope.principalId,
                options.now,
                options.now,
              ],
            );
          }
          await connection.execute(
            `INSERT INTO model_deployment (
               id, workspace_id, provider_endpoint_id,
               model_profile_revision_id, deployment_key,
               provider_model_id, deployment_digest,
               lifecycle_status, version, created_by_principal_id,
               created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?, ?)`,
            [
              resources.modelDeploymentId,
              options.scope.workspaceId,
              aggregate.endpointId,
              modelProfileRevisionId,
              `provider-setting-${options.settingId}-${String(index + 1)}`,
              providerModelId,
              control.modelDeploymentDigest,
              options.scope.principalId,
              options.now,
              options.now,
            ],
          );
          await connection.execute(
            `INSERT INTO pricing_revision (
               id, workspace_id, provider_endpoint_id,
               model_deployment_id, pricing_key, revision,
               schema_version, currency_code, pricing_document,
               canonical_digest, lifecycle_status, source_kind,
               verified_at, effective_at, created_by_principal_id,
               published_by_principal_id, created_at, published_at
             ) VALUES (
               ?, ?, ?, ?, ?, 1, 1, 'USD', ?, ?, 'published',
               ?, ?, ?, ?, ?, ?, ?
             )`,
            [
              resources.pricingRevisionId,
              options.scope.workspaceId,
              aggregate.endpointId,
              resources.modelDeploymentId,
              `provider-setting-${options.settingId}-${String(index + 1)}`,
              JSON.stringify(control.pricingDocument),
              control.pricingDigest,
              control.pricingRevisionSourceKind,
              options.now,
              options.now,
              options.scope.principalId,
              options.scope.principalId,
              options.now,
              options.now,
            ],
          );
          for (const [routeIndex, route] of control.routes.entries()) {
            await connection.execute(
              `INSERT INTO route_policy_revision (
                 id, workspace_id, route_key, revision,
                 schema_version, route_document, canonical_digest,
                 lifecycle_status, created_by_principal_id,
                 published_by_principal_id, created_at, published_at
               ) VALUES (?, ?, ?, 1, 1, ?, ?, 'published', ?, ?, ?, ?)`,
              [
                route.routePolicyRevisionId,
                options.scope.workspaceId,
                `provider-setting-${options.settingId}-${String(
                  index + 1,
                )}-${String(routeIndex + 1)}`,
                JSON.stringify(route.routePolicyDocument),
                route.routePolicyDigest,
                options.scope.principalId,
                options.scope.principalId,
                options.now,
                options.now,
              ],
            );
          }
          activatedModels.push({
            control,
            modelProfileRevisionId,
            resources,
          });
        }
        const primaryModel = activatedModels[0];
        const primaryRoute = primaryModel?.control.routes[0];
        await publishWorkspacePolicyForEndpoint(
          connection,
          options,
          aggregate.endpointId,
        );
        await connection.execute(
          `UPDATE secret_version
           SET lifecycle_status = 'active',
               activated_at = ?
           WHERE workspace_id = ?
             AND credential_id = ?
             AND id = ?
             AND lifecycle_status = 'verified'`,
          [
            options.now,
            options.scope.workspaceId,
            aggregate.credentialId,
            aggregate.secretVersionId,
          ],
        );
        await connection.execute(
          `UPDATE credential
           SET lifecycle_status = 'active',
               active_secret_version_id = ?,
               material_generation = ?,
               version = version + 1,
               updated_at = ?
           WHERE workspace_id = ?
             AND id = ?
             AND version = ?
             AND lifecycle_status = 'disabled'`,
          [
            aggregate.secretVersionId,
            aggregate.secretMaterialGeneration,
            options.now,
            options.scope.workspaceId,
            aggregate.credentialId,
            aggregate.credentialVersion,
          ],
        );
        await connection.execute(
          `UPDATE provider_endpoint
           SET lifecycle_status = 'active',
               version = version + 1,
               updated_at = ?
           WHERE workspace_id = ?
             AND id = ?
             AND lifecycle_status = 'disabled'
             AND validation_status = 'passed'`,
          [options.now, options.scope.workspaceId, aggregate.endpointId],
        );
        const bindingReconciliation =
          await reconcilePublishedProviderImageCapabilityBindingsInTransaction(
            connection,
            {
              workspaceId: options.scope.workspaceId,
              actorPrincipalId: options.scope.principalId,
              now: options.now,
            },
          );
        const nextVersion = aggregate.settingVersion + 1;
        await connection.execute(
          `UPDATE provider_setting
           SET model_pricing_configurations = ?,
               model_profile_revision_id = ?,
               model_deployment_id = ?,
               pricing_revision_id = ?,
               route_policy_revision_id = ?,
               budget_account_id = ?,
               activated_model_catalog_snapshot_id =
                 model_catalog_snapshot_id,
               activated_model_catalog_revision =
                 model_catalog_revision,
               model_catalog_changes_pending_review = 0,
               activated_at = ?,
               disabled_at = NULL,
               version = ?,
               updated_at = ?
           WHERE workspace_id = ?
             AND id = ?
             AND version = ?`,
          [
            JSON.stringify(modelPricingConfigurations),
            primaryModel?.modelProfileRevisionId ?? null,
            primaryModel?.resources.modelDeploymentId ?? null,
            primaryModel?.resources.pricingRevisionId ?? null,
            primaryRoute?.routePolicyRevisionId ?? null,
            options.resources.budgetAccountId,
            options.now,
            nextVersion,
            options.now,
            options.scope.workspaceId,
            options.settingId,
            aggregate.settingVersion,
          ],
        );
        await recordOperation(connection, options, "activate", nextVersion);
        await appendSettingAudit(connection, options, {
          eventType: "provider_setting.activated",
          action: "activate",
          outcome: "provider_setting.activated",
          details: {
            hardLimitAmount,
            preset: aggregate.preset,
            ...(primaryRoute ? { apiSurface: primaryRoute.apiSurface } : {}),
            modelCount: modelKeys.length,
            capabilityBindingsCreated:
              bindingReconciliation.createdBindingCount,
            capabilityBindingTemplatesRebound:
              bindingReconciliation.reboundTemplateCount,
            unmatchedCapabilityRoutes:
              bindingReconciliation.unmatchedRouteCount,
            capabilityBindingReconciliationDigest: digestProviderValue(
              bindingReconciliation,
            ),
            version: nextVersion,
          },
        });
        await appendRelatedAudit(connection, options, 0, {
          eventType: "secret_version.activated",
          action: "activate",
          resourceType: "secret_version",
          resourceId: aggregate.secretVersionId,
          outcome: "secret_version.activated",
          details: {
            lifecycleStatus: "active",
            materialGeneration: aggregate.secretMaterialGeneration,
          },
        });
        return Object.freeze({
          provider: await readOne(
            connection,
            options.scope.workspaceId,
            options.settingId,
          ),
          result: "activated" as const,
        });
      });
    },

    async rotateSecret(
      options: RotateProviderSettingSecretOptions,
    ): Promise<ProviderSettingMutation> {
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.scope,
          "credential.manage",
          options.now,
        );
        const replay = await replayOperation(
          connection,
          options,
          "rotate_secret",
        );
        if (replay) {
          return replay;
        }
        const aggregate = await lockAggregate(
          connection,
          options.scope.workspaceId,
          options.settingId,
        );
        assertExpectedVersion(aggregate, options.expectedVersion);
        if (
          aggregate.endpointLifecycle !== "active" ||
          aggregate.credentialLifecycle !== "active" ||
          aggregate.secretLifecycle !== "active" ||
          aggregate.activeSecretVersionId !== aggregate.secretVersionId
        ) {
          throw new Error(
            "Only an active Provider setting can rotate its key.",
          );
        }
        if (
          options.mode === "graceful" &&
          options.drainDeadlineAt.getTime() <= options.now.getTime()
        ) {
          throw new Error(
            "Provider secret drain deadline must be in the future.",
          );
        }
        const nextMaterialGeneration = aggregate.secretMaterialGeneration + 1;
        const plaintext =
          options.secretSource.kind === "plaintext_database"
            ? options.secretSource.plaintext
            : undefined;
        const envelope =
          options.secretSource.kind === "encrypted_database"
            ? options.secretSource.envelope
            : undefined;
        await connection.execute(
          `INSERT INTO secret_version (
             id, workspace_id, credential_id, version,
             material_generation, source_kind, lifecycle_status,
             material_plaintext_base64,
             material_ciphertext_base64, material_nonce_base64,
             material_auth_tag_base64, wrapped_dek_base64,
             wrap_nonce_base64, wrap_auth_tag_base64, kek_version,
             aad_digest, deployment_reference, material_fingerprint,
             format_version, drain_deadline_at, verified_at,
             activated_at, retired_at, revoked_at, destroyed_at,
             created_by_principal_id, created_at
           ) VALUES (
             ?, ?, ?, ?, ?, ?, 'active',
             ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 1,
             NULL, ?, ?, NULL, NULL, NULL, ?, ?
           )`,
          [
            options.secretVersionId,
            options.scope.workspaceId,
            aggregate.credentialId,
            nextMaterialGeneration,
            nextMaterialGeneration,
            options.secretSource.kind,
            plaintext?.materialPlaintextBase64 ?? null,
            envelope?.materialCiphertextBase64 ?? null,
            envelope?.materialNonceBase64 ?? null,
            envelope?.materialAuthTagBase64 ?? null,
            envelope?.wrappedDekBase64 ?? null,
            envelope?.wrapNonceBase64 ?? null,
            envelope?.wrapAuthTagBase64 ?? null,
            envelope?.kekVersion ?? null,
            options.secretAadDigest,
            options.secretMaterialFingerprint,
            options.now,
            options.now,
            options.scope.principalId,
            options.now,
          ],
        );
        if (options.mode === "graceful") {
          await connection.execute(
            `UPDATE secret_version
             SET lifecycle_status = 'draining',
                 drain_deadline_at = ?
             WHERE workspace_id = ?
               AND credential_id = ?
               AND id = ?
               AND lifecycle_status = 'active'`,
            [
              options.drainDeadlineAt,
              options.scope.workspaceId,
              aggregate.credentialId,
              aggregate.secretVersionId,
            ],
          );
        } else {
          await connection.execute(
            `UPDATE secret_version
             SET lifecycle_status = 'revoked',
                 revoked_at = ?,
                 drain_deadline_at = NULL
             WHERE workspace_id = ?
               AND credential_id = ?
               AND id = ?
               AND lifecycle_status = 'active'`,
            [
              options.now,
              options.scope.workspaceId,
              aggregate.credentialId,
              aggregate.secretVersionId,
            ],
          );
        }
        await connection.execute(
          `UPDATE credential
           SET active_secret_version_id = ?,
               material_generation = ?,
               version = version + 1,
               updated_at = ?
           WHERE workspace_id = ?
             AND id = ?
             AND version = ?
             AND lifecycle_status = 'active'
             AND active_secret_version_id = ?`,
          [
            options.secretVersionId,
            nextMaterialGeneration,
            options.now,
            options.scope.workspaceId,
            aggregate.credentialId,
            aggregate.credentialVersion,
            aggregate.secretVersionId,
          ],
        );
        const nextVersion = aggregate.settingVersion + 1;
        await connection.execute(
          `UPDATE provider_setting
           SET version = ?, updated_at = ?
           WHERE workspace_id = ?
             AND id = ?
             AND version = ?`,
          [
            nextVersion,
            options.now,
            options.scope.workspaceId,
            options.settingId,
            aggregate.settingVersion,
          ],
        );
        await recordOperation(
          connection,
          options,
          "rotate_secret",
          nextVersion,
        );
        await appendSettingAudit(connection, options, {
          eventType: "provider_setting.secret_rotated",
          action: "rotate",
          outcome: "provider_setting.secret_rotated",
          details: {
            mode: options.mode,
            materialGeneration: nextMaterialGeneration,
            version: nextVersion,
          },
        });
        await appendRelatedAudit(connection, options, 0, {
          eventType: "secret_version.created",
          action: "create",
          resourceType: "secret_version",
          resourceId: options.secretVersionId,
          outcome: "secret_version.created",
          details: {
            sourceKind: options.secretSource.kind,
            lifecycleStatus: "active",
            materialGeneration: nextMaterialGeneration,
          },
        });
        await appendRelatedAudit(connection, options, 1, {
          eventType: "secret_version.rotated",
          action: "rotate",
          resourceType: "secret_version",
          resourceId: options.secretVersionId,
          outcome: "secret_version.rotated",
          details: {
            lifecycleStatus: "active",
            previousMode: options.mode === "graceful" ? "draining" : "revoked",
            materialGeneration: nextMaterialGeneration,
          },
        });
        return Object.freeze({
          provider: await readOne(
            connection,
            options.scope.workspaceId,
            options.settingId,
          ),
          result: "rotated" as const,
        });
      });
    },

    async refreshModelCatalog(
      options: RefreshProviderModelCatalogOptions,
    ): Promise<ProviderModelCatalogRefreshMutation> {
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.scope,
          "credential.manage",
          options.now,
        );
        const replay = await replayModelCatalogRefresh(connection, options);
        if (replay) {
          return replay;
        }
        const aggregate = await lockAggregate(
          connection,
          options.scope.workspaceId,
          options.settingId,
        );
        assertExpectedVersion(aggregate, options.expectedVersion);
        const exactSecret =
          aggregate.secretVersionId !== options.expectedActiveSecretVersionId
            ? false
            : aggregate.secretMaterialGeneration ===
              options.expectedSecretMaterialGeneration;
        const activeAuthority =
          exactSecret &&
          aggregate.endpointLifecycle === "active" &&
          aggregate.validationStatus === "passed" &&
          aggregate.credentialLifecycle === "active" &&
          aggregate.secretLifecycle === "active" &&
          aggregate.activeSecretVersionId === aggregate.secretVersionId;
        const stagedAuthority =
          exactSecret &&
          aggregate.modelDeploymentId === null &&
          aggregate.budgetAccountId === null &&
          aggregate.activatedModelCatalogSnapshotId === null &&
          aggregate.activatedModelCatalogRevision === null &&
          aggregate.endpointLifecycle === "disabled" &&
          aggregate.validationStatus === "passed" &&
          aggregate.credentialLifecycle === "disabled" &&
          aggregate.activeSecretVersionId === null &&
          aggregate.secretLifecycle === "verified";
        if (!activeAuthority && !stagedAuthority) {
          throw new Error(
            "Provider refresh credential changed before model catalog refresh.",
          );
        }
        if (
          aggregate.secretMaterialGeneration !==
          options.expectedSecretMaterialGeneration
        ) {
          throw new Error(
            "Provider refresh credential changed before model catalog refresh.",
          );
        }
        const catalog = parseProviderModelCatalogDocument(options.document);
        const modelKeys = parseModelKeys(aggregate.modelKeys);
        if (
          catalog.providerPreset !== aggregate.preset ||
          options.discoveredAt.getTime() > options.now.getTime()
        ) {
          throw new Error(
            "Refreshed Provider model catalog does not match the setting.",
          );
        }
        if (stagedAuthority) {
          assertSelectedCatalogModels(catalog, modelKeys);
        }
        const changesPendingReview =
          aggregate.modelDeploymentId !== null &&
          (aggregate.activatedModelCatalogDocument === null ||
            (() => {
              try {
                return (
                  selectedCatalogRuntimeDigest(catalog, modelKeys) !==
                  selectedCatalogRuntimeDigest(
                    parseProviderModelCatalogDocument(
                      decodeJson(aggregate.activatedModelCatalogDocument),
                    ),
                    modelKeys,
                  )
                );
              } catch {
                return true;
              }
            })());
        const nextRevision = aggregate.modelCatalogRevision + 1;
        if (
          !Number.isSafeInteger(nextRevision) ||
          nextRevision > 4_294_967_295
        ) {
          throw new Error("Provider model catalog revision is exhausted.");
        }
        const catalogDigest = digestProviderValue(catalog);
        await connection.execute(
          `INSERT INTO provider_model_catalog_snapshot (
             id, workspace_id, provider_setting_id,
             provider_endpoint_id, revision, schema_version,
             discovery_method, source_digest, catalog_document,
             canonical_digest, discovered_at,
             created_by_principal_id, created_at
           ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
          [
            options.snapshotId,
            options.scope.workspaceId,
            options.settingId,
            aggregate.endpointId,
            nextRevision,
            catalog.discoveryMethod,
            catalog.sourceDigest,
            JSON.stringify(catalog),
            catalogDigest,
            options.discoveredAt,
            options.scope.principalId,
            options.now,
          ],
        );
        const nextVersion = aggregate.settingVersion + 1;
        const [updated] = await connection.execute<ResultSetHeader>(
          `UPDATE provider_setting AS setting
             INNER JOIN provider_endpoint AS endpoint
               ON endpoint.workspace_id = setting.workspace_id
              AND endpoint.id = setting.provider_endpoint_id
             INNER JOIN credential
               ON credential.workspace_id = setting.workspace_id
              AND credential.id = setting.credential_id
             INNER JOIN secret_version AS candidate
               ON candidate.workspace_id = credential.workspace_id
              AND candidate.credential_id = credential.id
              AND candidate.id = ?
              AND candidate.material_generation = ?
             SET setting.activated_model_catalog_snapshot_id =
                   CASE
                     WHEN setting.model_deployment_id IS NOT NULL
                       AND setting.activated_model_catalog_snapshot_id
                         IS NULL
                     THEN setting.model_catalog_snapshot_id
                     ELSE setting.activated_model_catalog_snapshot_id
                   END,
                 setting.activated_model_catalog_revision =
                   CASE
                     WHEN setting.model_deployment_id IS NOT NULL
                       AND setting.activated_model_catalog_revision
                         IS NULL
                     THEN setting.model_catalog_revision
                     ELSE setting.activated_model_catalog_revision
                   END,
                 setting.model_catalog_snapshot_id = ?,
                 setting.model_catalog_revision = ?,
                 setting.model_catalog_changes_pending_review = ?,
                 setting.version = ?,
                 setting.updated_at = ?
             WHERE setting.workspace_id = ?
               AND setting.id = ?
               AND setting.version = ?
               AND setting.model_catalog_snapshot_id = ?
               AND setting.model_catalog_revision = ?
               AND (
                 (
                   endpoint.lifecycle_status = 'active'
                   AND endpoint.validation_status = 'passed'
                   AND credential.lifecycle_status = 'active'
                   AND credential.active_secret_version_id =
                     candidate.id
                   AND candidate.lifecycle_status = 'active'
                 )
                 OR (
                   setting.model_deployment_id IS NULL
                   AND setting.budget_account_id IS NULL
                   AND setting.activated_model_catalog_snapshot_id
                     IS NULL
                   AND setting.activated_model_catalog_revision
                     IS NULL
                   AND endpoint.lifecycle_status = 'disabled'
                   AND endpoint.validation_status = 'passed'
                   AND credential.lifecycle_status = 'disabled'
                   AND credential.active_secret_version_id IS NULL
                   AND candidate.lifecycle_status = 'verified'
                   AND candidate.version = (
                     SELECT MAX(versioned.version)
                     FROM secret_version AS versioned
                     WHERE versioned.credential_id = credential.id
                   )
                 )
               )`,
          [
            options.expectedActiveSecretVersionId,
            options.expectedSecretMaterialGeneration,
            options.snapshotId,
            nextRevision,
            changesPendingReview,
            nextVersion,
            options.now,
            options.scope.workspaceId,
            options.settingId,
            aggregate.settingVersion,
            aggregate.modelCatalogSnapshotId,
            aggregate.modelCatalogRevision,
          ],
        );
        if (updated.affectedRows !== 1) {
          throw new Error(
            "Provider setting changed before model catalog refresh.",
          );
        }
        await recordOperation(
          connection,
          options,
          "refresh_model_catalog",
          nextVersion,
        );
        await appendSettingAudit(connection, options, {
          eventType: "provider_setting.model_catalog_refreshed",
          action: "refresh",
          outcome: "provider_setting.model_catalog_refreshed",
          details: {
            revision: nextRevision,
            sourceDigest: catalog.sourceDigest,
            canonicalDigest: catalogDigest,
            discoveryMethod: catalog.discoveryMethod,
            changesPendingReview: changesPendingReview ? "true" : "false",
            version: nextVersion,
          },
        });
        return Object.freeze({
          provider: await readOne(
            connection,
            options.scope.workspaceId,
            options.settingId,
          ),
          result: "refreshed" as const,
          changesPendingReview,
        });
      });
    },

    async adoptModelCatalog(
      options: AdoptProviderModelCatalogOptions,
    ): Promise<ProviderModelCatalogAdoptionMutation> {
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.scope,
          "credential.manage",
          options.now,
        );
        const replay = await replayModelCatalogAdoption(connection, options);
        if (replay) {
          return replay;
        }
        const aggregate = await lockAggregate(
          connection,
          options.scope.workspaceId,
          options.settingId,
        );
        assertExpectedVersion(aggregate, options.expectedVersion);
        if (
          aggregate.modelCatalogRevision !== options.expectedCurrentRevision ||
          aggregate.activatedModelCatalogRevision !==
            options.expectedActivatedRevision
        ) {
          throw new Error(
            "Provider model catalog revisions changed before adoption.",
          );
        }
        const exactSecret =
          aggregate.secretVersionId === options.expectedActiveSecretVersionId &&
          aggregate.secretMaterialGeneration ===
            options.expectedSecretMaterialGeneration &&
          aggregate.endpointLifecycle === "active" &&
          aggregate.validationStatus === "passed" &&
          aggregate.credentialLifecycle === "active" &&
          aggregate.secretLifecycle === "active" &&
          aggregate.activeSecretVersionId === aggregate.secretVersionId;
        if (!exactSecret) {
          throw new Error(
            "Provider credential changed before model catalog adoption.",
          );
        }
        const runtimeAdapters =
          await loadProviderRuntimeAdapterProfilesInTransaction(
            connection,
            options.scope.workspaceId,
          );
        const review = reviewFromAggregate(aggregate, runtimeAdapters);
        if (
          !review.canAdopt ||
          !review.activated ||
          review.current.revision !== options.expectedCurrentRevision ||
          review.activated.revision !== options.expectedActivatedRevision
        ) {
          throw new Error("Provider model catalog has adoption blockers.");
        }
        const modelKeys = parseModelKeys(aggregate.modelKeys);
        const modelPricingConfigurations =
          parseProviderSettingModelPricingConfigurations(
            aggregate.modelPricingConfigurations,
            modelKeys,
          );
        const pricingByModel = new Map(
          modelPricingConfigurations.map((configuration) => [
            configuration.providerModelId,
            configuration,
          ]),
        );
        const currentCatalog = parseProviderModelCatalogDocument(
          decodeJson(aggregate.modelCatalogDocument),
        );
        const currentRuntimeDigest = selectedCatalogRuntimeDigest(
          currentCatalog,
          modelKeys,
        );
        if (options.rediscoveredRuntimeDigest !== currentRuntimeDigest) {
          throw new Error(
            "Provider model facts changed after review; refresh the catalog before adoption.",
          );
        }
        if (options.resources.models.length < modelKeys.length) {
          throw new Error(
            "Provider model catalog adoption is missing immutable resource identities.",
          );
        }
        const placeholders = modelKeys.map(() => "?").join(", ");
        const [oldDeploymentRows] = await connection.query<
          ActiveModelDeploymentRow[]
        >(
          `SELECT
               id,
               provider_model_id AS providerModelId,
               generation
             FROM model_deployment
             WHERE workspace_id = ?
               AND provider_endpoint_id = ?
               AND provider_model_id IN (${placeholders})
               AND lifecycle_status = 'active'
             ORDER BY provider_model_id
             FOR UPDATE`,
          [options.scope.workspaceId, aggregate.endpointId, ...modelKeys],
        );
        const oldDeployments = new Map(
          oldDeploymentRows.map((deployment) => [
            deployment.providerModelId,
            deployment,
          ]),
        );
        if (modelKeys.some((modelKey) => !oldDeployments.has(modelKey))) {
          throw new Error(
            "Provider model catalog adoption found an incomplete active deployment generation.",
          );
        }
        const catalogModels = new Map(
          currentCatalog.models.map((model) => [model.providerModelId, model]),
        );
        const adoptedModels: {
          readonly control: ProviderSettingControlPlaneDefinition;
          readonly modelProfileRevisionId: string;
          readonly resources: Omit<
            ProviderSettingControlPlaneIds,
            "endpointId" | "credentialId" | "budgetAccountId"
          >;
          readonly oldDeployment: ActiveModelDeploymentRow;
        }[] = [];
        for (const [index, providerModelId] of modelKeys.entries()) {
          const resources = options.resources.models[index]!;
          const oldDeployment = oldDeployments.get(providerModelId)!;
          const catalogEntry = catalogModels.get(providerModelId);
          if (!catalogEntry || catalogEntry.completeness === "identity_only") {
            throw new Error(
              "Provider model catalog adoption requires evidenced image model capabilities.",
            );
          }
          let control = buildProviderSettingControlPlaneDefinition({
            ids: {
              endpointId: aggregate.endpointId,
              credentialId: aggregate.credentialId,
              ...resources,
              budgetAccountId: aggregate.budgetAccountId!,
            },
            providerSettingId: options.settingId,
            preset: aggregate.preset,
            providerModelId,
            catalogEntry,
            pricingConfiguration: pricingByModel.get(providerModelId)!,
            runtimeAdapters,
            observedAt: options.now,
          });
          const [profileRows] = await connection.execute<IdRow[]>(
            `SELECT id
               FROM model_profile_revision
               WHERE workspace_id = ?
                 AND canonical_digest = ?
                 AND lifecycle_status = 'published'
               LIMIT 1
               FOR SHARE`,
            [options.scope.workspaceId, control.modelProfileDigest],
          );
          const modelProfileRevisionId =
            profileRows[0]?.id ?? resources.modelProfileRevisionId;
          if (modelProfileRevisionId !== resources.modelProfileRevisionId) {
            control = buildProviderSettingControlPlaneDefinition({
              ids: {
                endpointId: aggregate.endpointId,
                credentialId: aggregate.credentialId,
                ...resources,
                modelProfileRevisionId,
                budgetAccountId: aggregate.budgetAccountId!,
              },
              providerSettingId: options.settingId,
              preset: aggregate.preset,
              providerModelId,
              catalogEntry,
              pricingConfiguration: pricingByModel.get(providerModelId)!,
              runtimeAdapters,
              observedAt: options.now,
            });
          } else {
            await connection.execute(
              `INSERT INTO model_profile_revision (
                 id, workspace_id, profile_key, revision,
                 schema_version, profile_document, canonical_digest,
                 lifecycle_status, created_by_principal_id,
                 published_by_principal_id, created_at, published_at
               ) VALUES (?, ?, ?, 1, 1, ?, ?, 'published', ?, ?, ?, ?)`,
              [
                modelProfileRevisionId,
                options.scope.workspaceId,
                `provider-setting-${options.settingId}-${String(
                  index + 1,
                )}-generation-${String(oldDeployment.generation + 1)}`,
                JSON.stringify(control.modelProfileDocument),
                control.modelProfileDigest,
                options.scope.principalId,
                options.scope.principalId,
                options.now,
                options.now,
              ],
            );
          }
          const generation = oldDeployment.generation + 1;
          await connection.execute(
            `INSERT INTO model_deployment (
               id, workspace_id, provider_endpoint_id,
               model_profile_revision_id, deployment_key,
               provider_model_id, generation,
               supersedes_model_deployment_id,
               deployment_digest, lifecycle_status, version,
               created_by_principal_id, created_at, updated_at
             ) VALUES (
               ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?, ?
             )`,
            [
              resources.modelDeploymentId,
              options.scope.workspaceId,
              aggregate.endpointId,
              modelProfileRevisionId,
              `provider-setting-${options.settingId}-${String(
                index + 1,
              )}-generation-${String(generation)}`,
              providerModelId,
              generation,
              oldDeployment.id,
              control.modelDeploymentDigest,
              options.scope.principalId,
              options.now,
              options.now,
            ],
          );
          await connection.execute(
            `INSERT INTO pricing_revision (
               id, workspace_id, provider_endpoint_id,
               model_deployment_id, pricing_key, revision,
               schema_version, currency_code, pricing_document,
               canonical_digest, lifecycle_status, source_kind,
               verified_at, effective_at, created_by_principal_id,
               published_by_principal_id, created_at, published_at
             ) VALUES (
               ?, ?, ?, ?, ?, 1, 1, 'USD', ?, ?, 'published',
               ?, ?, ?, ?, ?, ?, ?
             )`,
            [
              resources.pricingRevisionId,
              options.scope.workspaceId,
              aggregate.endpointId,
              resources.modelDeploymentId,
              `provider-setting-${options.settingId}-${String(
                index + 1,
              )}-generation-${String(generation)}`,
              JSON.stringify(control.pricingDocument),
              control.pricingDigest,
              control.pricingRevisionSourceKind,
              options.now,
              options.now,
              options.scope.principalId,
              options.scope.principalId,
              options.now,
              options.now,
            ],
          );
          for (const [routeIndex, route] of control.routes.entries()) {
            await connection.execute(
              `INSERT INTO route_policy_revision (
                 id, workspace_id, route_key, revision,
                 schema_version, route_document, canonical_digest,
                 lifecycle_status, created_by_principal_id,
                 published_by_principal_id, created_at, published_at
               ) VALUES (?, ?, ?, 1, 1, ?, ?, 'published', ?, ?, ?, ?)`,
              [
                route.routePolicyRevisionId,
                options.scope.workspaceId,
                `provider-setting-${options.settingId}-${String(
                  index + 1,
                )}-generation-${String(generation)}-${String(routeIndex + 1)}`,
                JSON.stringify(route.routePolicyDocument),
                route.routePolicyDigest,
                options.scope.principalId,
                options.scope.principalId,
                options.now,
                options.now,
              ],
            );
          }
          adoptedModels.push({
            control,
            modelProfileRevisionId,
            resources,
            oldDeployment,
          });
        }
        const oldIds = adoptedModels.map((model) => model.oldDeployment.id);
        const routePlaceholders = oldIds.map(() => "?").join(", ");
        const [oldRouteRows] = await connection.query<DeploymentRouteRow[]>(
          `SELECT
               id,
               JSON_UNQUOTE(
                 JSON_EXTRACT(
                   route_document,
                   '$.modelDeploymentId'
                 )
               ) AS modelDeploymentId,
               route_document AS routeDocument
             FROM route_policy_revision
             WHERE workspace_id = ?
               AND lifecycle_status = 'published'
               AND JSON_UNQUOTE(
                 JSON_EXTRACT(
                   route_document,
                   '$.modelDeploymentId'
                 )
               ) IN (${routePlaceholders})
             FOR UPDATE`,
          [options.scope.workspaceId, ...oldIds],
        );
        const newRoutesByIdentity = new Map(
          adoptedModels.flatMap((model) =>
            model.control.routes.map((route) => [
              [
                model.oldDeployment.providerModelId,
                route.capabilityKey,
                route.apiSurface,
              ].join("\u0000"),
              route,
            ]),
          ),
        );
        for (const oldRoute of oldRouteRows) {
          const deployment = adoptedModels.find(
            (model) => model.oldDeployment.id === oldRoute.modelDeploymentId,
          );
          if (!deployment) {
            throw new Error(
              "Provider adoption route references an unknown deployment.",
            );
          }
          const parsed = parseProviderRoutePolicyDocument(
            decodeJson(oldRoute.routeDocument),
          );
          const replacement = newRoutesByIdentity.get(
            [
              deployment.oldDeployment.providerModelId,
              parsed.capabilityKey,
              parsed.apiSurface,
            ].join("\u0000"),
          );
          if (replacement) {
            await connection.execute(
              `UPDATE capability_binding
               SET route_policy_revision_id = ?,
                   version = version + 1,
                   updated_at = ?
               WHERE workspace_id = ?
                 AND route_policy_revision_id = ?
                 AND lifecycle_status = 'active'`,
              [
                replacement.routePolicyRevisionId,
                options.now,
                options.scope.workspaceId,
                oldRoute.id,
              ],
            );
          } else {
            await connection.execute(
              `UPDATE capability_binding
               SET lifecycle_status = 'disabled',
                   version = version + 1,
                   updated_at = ?
               WHERE workspace_id = ?
                 AND route_policy_revision_id = ?
                 AND lifecycle_status = 'active'`,
              [options.now, options.scope.workspaceId, oldRoute.id],
            );
          }
        }
        await connection.query(
          `UPDATE route_policy_revision
           SET lifecycle_status = 'deprecated'
           WHERE workspace_id = ?
             AND id IN (${oldRouteRows.map(() => "?").join(", ")})
             AND lifecycle_status = 'published'`,
          [options.scope.workspaceId, ...oldRouteRows.map((route) => route.id)],
        );
        await connection.query(
          `UPDATE model_deployment
           SET lifecycle_status = 'superseded',
               version = version + 1,
               updated_at = ?
           WHERE workspace_id = ?
             AND id IN (${oldIds.map(() => "?").join(", ")})
             AND lifecycle_status = 'active'`,
          [options.now, options.scope.workspaceId, ...oldIds],
        );
        const newRoutes = adoptedModels.flatMap((model) =>
          model.control.routes.map((route) => ({
            routePolicyRevisionId: route.routePolicyRevisionId,
            capabilityKey: route.capabilityKey,
            apiSurface: route.apiSurface,
          })),
        );
        const bindingReconciliation =
          await reconcileProviderImageCapabilityBindingsInTransaction(
            connection,
            {
              workspaceId: options.scope.workspaceId,
              actorPrincipalId: options.scope.principalId,
              preset: aggregate.preset,
              routes: newRoutes,
              now: options.now,
            },
          );
        const primaryModel = adoptedModels[0];
        const primaryRoute = primaryModel?.control.routes[0];
        if (!primaryModel || !primaryRoute) {
          throw new Error(
            "Provider model catalog adoption produced no active route.",
          );
        }
        const nextVersion = aggregate.settingVersion + 1;
        const [updated] = await connection.execute<ResultSetHeader>(
          `UPDATE provider_setting
             SET model_profile_revision_id = ?,
                 model_deployment_id = ?,
                 pricing_revision_id = ?,
                 route_policy_revision_id = ?,
                 activated_model_catalog_snapshot_id =
                   model_catalog_snapshot_id,
                 activated_model_catalog_revision =
                   model_catalog_revision,
                 model_catalog_changes_pending_review = 0,
                 version = ?,
                 updated_at = ?
             WHERE workspace_id = ?
               AND id = ?
               AND version = ?
               AND model_catalog_revision = ?
               AND activated_model_catalog_revision = ?`,
          [
            primaryModel.modelProfileRevisionId,
            primaryModel.resources.modelDeploymentId,
            primaryModel.resources.pricingRevisionId,
            primaryRoute.routePolicyRevisionId,
            nextVersion,
            options.now,
            options.scope.workspaceId,
            options.settingId,
            aggregate.settingVersion,
            options.expectedCurrentRevision,
            options.expectedActivatedRevision,
          ],
        );
        if (updated.affectedRows !== 1) {
          throw new Error(
            "Provider setting changed before model catalog adoption.",
          );
        }
        await recordOperation(
          connection,
          options,
          "adopt_model_catalog",
          nextVersion,
        );
        await appendSettingAudit(connection, options, {
          eventType: "provider_setting.model_catalog_adopted",
          action: "adopt",
          outcome: "provider_setting.model_catalog_adopted",
          details: {
            previousRevision: options.expectedActivatedRevision,
            adoptedRevision: options.expectedCurrentRevision,
            reviewedSourceDigest: aggregate.modelCatalogSourceDigest,
            rediscoveredSourceDigest: options.rediscoveredSourceDigest,
            runtimeDigest: currentRuntimeDigest,
            modelCount: adoptedModels.length,
            capabilityBindingsCreated:
              bindingReconciliation.createdBindingCount,
            capabilityBindingsRebound:
              bindingReconciliation.reboundTemplateCount,
            version: nextVersion,
          },
        });
        return Object.freeze({
          provider: await readOne(
            connection,
            options.scope.workspaceId,
            options.settingId,
          ),
          result: "adopted" as const,
          adoptedRevision: options.expectedCurrentRevision,
        });
      });
    },

    async disable(
      options: ProviderSettingLifecycleOptions,
    ): Promise<ProviderSettingMutation> {
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.scope,
          "credential.manage",
          options.now,
        );
        const replay = await replayOperation(connection, options, "disable");
        if (replay) {
          return replay;
        }
        const aggregate = await lockAggregate(
          connection,
          options.scope.workspaceId,
          options.settingId,
        );
        assertExpectedVersion(aggregate, options.expectedVersion);
        if (
          aggregate.endpointLifecycle !== "active" ||
          aggregate.credentialLifecycle !== "active" ||
          !aggregate.budgetAccountId
        ) {
          throw new Error("Only an active Provider setting can be disabled.");
        }
        await connection.execute(
          `UPDATE provider_endpoint
           SET lifecycle_status = 'draining',
               version = version + 1,
               updated_at = ?
           WHERE workspace_id = ?
             AND id = ?
             AND lifecycle_status = 'active'`,
          [options.now, options.scope.workspaceId, aggregate.endpointId],
        );
        await connection.execute(
          `UPDATE model_deployment
           SET lifecycle_status = 'draining',
               version = version + 1,
               updated_at = ?
           WHERE workspace_id = ?
             AND provider_endpoint_id = ?
             AND lifecycle_status = 'active'`,
          [options.now, options.scope.workspaceId, aggregate.endpointId],
        );
        const nextVersion = aggregate.settingVersion + 1;
        await connection.execute(
          `UPDATE provider_setting
           SET disabled_at = ?,
               version = ?,
               updated_at = ?
           WHERE workspace_id = ?
             AND id = ?
             AND version = ?`,
          [
            options.now,
            nextVersion,
            options.now,
            options.scope.workspaceId,
            options.settingId,
            aggregate.settingVersion,
          ],
        );
        await recordOperation(connection, options, "disable", nextVersion);
        await appendSettingAudit(connection, options, {
          eventType: "provider_setting.disabled",
          action: "disable",
          outcome: "provider_setting.disabled",
          details: {
            lifecycleStatus: "draining",
            blocksNewSubmissions: "true",
            permitsPinnedTaskReconciliation: "true",
            version: nextVersion,
          },
        });
        return Object.freeze({
          provider: await readOne(
            connection,
            options.scope.workspaceId,
            options.settingId,
          ),
          result: "disabled" as const,
        });
      });
    },

    async delete(
      options: ProviderSettingLifecycleOptions,
    ): Promise<ProviderSettingMutation> {
      return inTransaction(pool, async (connection) => {
        await revalidateTrustedWorkspaceScopeInTransaction(
          connection,
          options.scope,
          "credential.manage",
          options.now,
        );
        const replay = await replayOperation(connection, options, "delete");
        if (replay) return replay;
        const aggregate = await lockAggregate(
          connection,
          options.scope.workspaceId,
          options.settingId,
        );
        assertExpectedVersion(aggregate, options.expectedVersion);

        await connection.execute(
          `UPDATE capability_binding AS binding
           INNER JOIN route_policy_revision AS route
             ON route.workspace_id = binding.workspace_id
            AND route.id = binding.route_policy_revision_id
           INNER JOIN model_deployment AS deployment
             ON deployment.workspace_id = route.workspace_id
            AND deployment.id = JSON_UNQUOTE(
              JSON_EXTRACT(route.route_document, '$.modelDeploymentId')
            )
           SET binding.lifecycle_status = 'disabled',
               binding.version = binding.version + 1,
               binding.updated_at = ?
           WHERE binding.workspace_id = ?
             AND deployment.provider_endpoint_id = ?
             AND binding.lifecycle_status = 'active'`,
          [options.now, options.scope.workspaceId, aggregate.endpointId],
        );
        await connection.execute(
          `UPDATE agent_model_binding
           SET lifecycle_status = 'disabled',
               disabled_at = COALESCE(disabled_at, ?),
               version = version + 1,
               updated_by_principal_id = ?,
               updated_at = ?
           WHERE workspace_id = ?
             AND provider_endpoint_id = ?
             AND lifecycle_status = 'enabled'`,
          [
            options.now,
            options.scope.principalId,
            options.now,
            options.scope.workspaceId,
            aggregate.endpointId,
          ],
        );
        await connection.execute(
          `UPDATE route_policy_revision AS route
           INNER JOIN model_deployment AS deployment
             ON deployment.workspace_id = route.workspace_id
            AND deployment.id = JSON_UNQUOTE(
              JSON_EXTRACT(route.route_document, '$.modelDeploymentId')
            )
           SET route.lifecycle_status = 'deprecated'
           WHERE route.workspace_id = ?
             AND deployment.provider_endpoint_id = ?
             AND route.lifecycle_status = 'published'`,
          [options.scope.workspaceId, aggregate.endpointId],
        );
        await connection.execute(
          `UPDATE model_deployment
           SET lifecycle_status = 'revoked',
               version = version + 1,
               updated_at = ?
           WHERE workspace_id = ?
             AND provider_endpoint_id = ?
             AND lifecycle_status IN ('active', 'draining')`,
          [options.now, options.scope.workspaceId, aggregate.endpointId],
        );
        await connection.execute(
          `UPDATE provider_model
           SET lifecycle_status = 'removed',
               version = version + 1,
               updated_at = ?
           WHERE workspace_id = ?
             AND provider_setting_id = ?
             AND lifecycle_status <> 'removed'`,
          [options.now, options.scope.workspaceId, options.settingId],
        );
        await connection.execute(
          `UPDATE budget_account
           SET lifecycle_status = 'closed',
               version = version + 1,
               updated_at = ?
           WHERE workspace_id = ?
             AND id = ?
             AND lifecycle_status IN ('active', 'frozen', 'exhausted')`,
          [options.now, options.scope.workspaceId, aggregate.budgetAccountId],
        );
        await connection.execute(
          `UPDATE secret_version
           SET lifecycle_status = 'revoked',
               drain_deadline_at = NULL,
               revoked_at = COALESCE(revoked_at, ?)
           WHERE workspace_id = ?
             AND credential_id = ?
             AND lifecycle_status IN ('verified', 'active', 'draining')`,
          [options.now, options.scope.workspaceId, aggregate.credentialId],
        );
        await connection.execute(
          `UPDATE credential
           SET lifecycle_status = 'revoked',
               active_secret_version_id = NULL,
               version = version + 1,
               updated_at = ?
           WHERE workspace_id = ?
             AND id = ?
             AND lifecycle_status IN ('disabled', 'active', 'draining')`,
          [options.now, options.scope.workspaceId, aggregate.credentialId],
        );
        await connection.execute(
          `UPDATE provider_endpoint
           SET lifecycle_status = 'revoked',
               version = version + 1,
               updated_at = ?
           WHERE workspace_id = ?
             AND id = ?
             AND lifecycle_status <> 'revoked'`,
          [options.now, options.scope.workspaceId, aggregate.endpointId],
        );
        const nextVersion = aggregate.settingVersion + 1;
        await connection.execute(
          `UPDATE provider_setting
           SET deleted_at = ?,
               disabled_at = COALESCE(disabled_at, ?),
               version = ?,
               updated_at = ?
           WHERE workspace_id = ?
             AND id = ?
             AND version = ?`,
          [
            options.now,
            options.now,
            nextVersion,
            options.now,
            options.scope.workspaceId,
            options.settingId,
            aggregate.settingVersion,
          ],
        );
        await recordOperation(connection, options, "delete", nextVersion);
        await appendSettingAudit(connection, options, {
          eventType: "provider_setting.deleted",
          action: "delete",
          outcome: "provider_setting.deleted",
          details: { version: nextVersion },
        });
        return Object.freeze({
          provider: await readOne(
            connection,
            options.scope.workspaceId,
            options.settingId,
          ),
          result: "deleted" as const,
        });
      });
    },
  });
}
