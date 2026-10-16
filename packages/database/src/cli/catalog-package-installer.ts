import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";
import { monotonicFactory } from "ulid";

import {
  assertBoundedCapabilityJsonSchema,
  compileCapabilityMappingPlanV1,
  executeCapabilityMappingPlanV1,
  parseCapabilityBindingDefinitionV1,
  parseCapabilityCatalogRecommendationV1,
  parseCapabilityContractAssetV1,
  parseCapabilityDeclarationAssetV1,
  parseCapabilityImplementationDefinitionV1,
  parseModelResourceCatalogAssetV1,
  parseRuntimeAdapterDefinitionRevision,
  parseSkillCatalogAssetV1,
  parseWorkflowCatalogAssetV1,
  resolveLocalizedTextV1,
  type CapabilityBindingDefinitionV1,
  type CapabilityCatalogRecommendationV1,
  type CapabilityContractAssetV1,
  type CapabilityDeclarationAssetV1,
  type CapabilityImplementationDefinitionV1,
  type CompiledCapabilityMappingPlanV1,
  type ModelResourceCatalogAssetV1,
  type RuntimeAdapterDefinitionRevision,
  type SkillCatalogAssetV1,
  type WorkflowCatalogAssetV1,
} from "@kanvas/contracts/capability";
import type { WorkflowCapabilityAuthoringDeclaration } from "@kanvas/contracts/api";
import { isWorkflowTopology } from "@kanvas/contracts/workflow";

import {
  loadCatalogPackageV1,
  type LoadedCatalogPackageV1,
} from "./catalog-package-loader.js";
import { digestProviderValue } from "../runtime/provider-value-digest.js";

interface PreparedContract {
  readonly assetKey: string;
  readonly digest: string;
  readonly document: CapabilityContractAssetV1;
}

interface PreparedDeclaration {
  readonly assetKey: string;
  readonly digest: string;
  readonly document: CapabilityDeclarationAssetV1;
}

interface PreparedAdapter {
  readonly assetKey: string;
  readonly digest: string;
  readonly document: RuntimeAdapterDefinitionRevision;
}

interface PreparedModelResource {
  readonly assetKey: string;
  readonly digest: string;
  readonly document: ModelResourceCatalogAssetV1;
}

interface PreparedWorkflow {
  readonly assetKey: string;
  readonly digest: string;
  readonly document: WorkflowCatalogAssetV1;
}

interface PreparedSkill {
  readonly assetKey: string;
  readonly digest: string;
  readonly document: SkillCatalogAssetV1;
}

interface PreparedImplementation {
  readonly assetKey: string;
  readonly digest: string;
  readonly document: CapabilityImplementationDefinitionV1;
  readonly compiledInputMapping: CompiledCapabilityMappingPlanV1;
  readonly compiledInputMappingDigest: string;
  readonly compiledOutputMapping: CompiledCapabilityMappingPlanV1;
  readonly compiledOutputMappingDigest: string;
}

interface RawImplementation {
  readonly assetKey: string;
  readonly digest: string;
  readonly document: CapabilityImplementationDefinitionV1;
}

interface PreparedBinding {
  readonly assetKey: string;
  readonly digest: string;
  readonly document: CapabilityBindingDefinitionV1;
}

export interface PreparedCatalogPackageV1 {
  readonly loaded: LoadedCatalogPackageV1;
  readonly contracts: ReadonlyMap<string, PreparedContract>;
  readonly declarations: readonly PreparedDeclaration[];
  readonly adapters: ReadonlyMap<string, PreparedAdapter>;
  readonly modelResources: ReadonlyMap<string, PreparedModelResource>;
  readonly implementations: ReadonlyMap<string, PreparedImplementation>;
  readonly bindings: readonly PreparedBinding[];
  readonly workflows: ReadonlyMap<string, PreparedWorkflow>;
  readonly skills: readonly PreparedSkill[];
}

export function capabilityCatalogRecommendationFromPreparedPackageV1(
  prepared: PreparedCatalogPackageV1,
  input: {
    readonly recommendationKey: string;
    readonly defaultBindingAssetKey: string;
  },
): CapabilityCatalogRecommendationV1 {
  const binding = prepared.bindings.find(
    (item) => item.assetKey === input.defaultBindingAssetKey,
  );
  if (!binding) {
    return failReference(
      `Capability recommendation Binding ${input.defaultBindingAssetKey} is unavailable.`,
    );
  }
  const contract = prepared.contracts.get(
    revisionKey(binding.document.contract),
  );
  const implementation = prepared.implementations.get(
    revisionKey(binding.document.implementation),
  );
  if (!contract || !implementation) {
    return failReference(
      `Capability recommendation ${input.recommendationKey} lost its Contract or Implementation.`,
    );
  }
  const declaration = prepared.declarations.find(
    (item) =>
      revisionKey(item.document.contract) ===
      revisionKey(binding.document.contract),
  );
  const adapter = prepared.adapters.get(
    revisionKey({
      key: implementation.document.adapter.adapterKey,
      revision: implementation.document.adapter.revision,
      canonicalDigest: implementation.document.adapter.canonicalDigest,
    }),
  );
  const modelResource =
    implementation.document.source.kind === "model_resource"
      ? prepared.modelResources.get(
          revisionKey(implementation.document.source.resource),
        )
      : undefined;
  if (
    !declaration ||
    !adapter ||
    (implementation.document.source.kind === "model_resource" && !modelResource)
  ) {
    return failReference(
      `Capability recommendation ${input.recommendationKey} lost a declared default-route dependency.`,
    );
  }
  if (!binding.document.enabled) {
    return failReference(
      `Capability recommendation ${input.recommendationKey} default Binding is disabled.`,
    );
  }
  if (
    implementation.document.source.kind === "model_service" &&
    JSON.stringify(adapter.document.modelServiceSelector) !==
      JSON.stringify(implementation.document.source.selector)
  ) {
    return failReference(
      `Capability recommendation ${input.recommendationKey} model selector differs from its Runtime Adapter.`,
    );
  }
  const selectionPolicy = adapter.document.selectionPolicy;
  if (
    selectionPolicy?.scope === "capability_private" &&
    selectionPolicy.capabilityKey !== contract.document.contractKey
  ) {
    return failReference(
      `Capability recommendation ${input.recommendationKey} uses another Capability's private Runtime Adapter.`,
    );
  }
  if (
    implementation.document.source.kind === "plugin" &&
    adapter.document.executable.kind === "built_in" &&
    selectionPolicy?.scope !== "capability_private"
  ) {
    return failReference(
      `Capability recommendation ${input.recommendationKey} built-in algorithm has no owning Capability.`,
    );
  }
  const assetKeys = new Set([
    contract.assetKey,
    declaration.assetKey,
    adapter.assetKey,
    implementation.assetKey,
    binding.assetKey,
    ...(modelResource ? [modelResource.assetKey] : []),
  ]);
  const assets = prepared.loaded.assets.filter((asset) =>
    assetKeys.has(asset.descriptor.assetKey),
  );
  if (assets.length !== assetKeys.size) {
    return failReference(
      `Capability recommendation ${input.recommendationKey} could not snapshot its assets.`,
    );
  }
  return parseCapabilityCatalogRecommendationV1({
    schemaVersion: "kanvas.capability-catalog-recommendation/v1",
    recommendationKey: input.recommendationKey,
    package: {
      packageKey: prepared.loaded.manifest.packageKey,
      version: prepared.loaded.manifest.version,
      contentDigest: prepared.loaded.manifest.contentDigest,
      displayName: prepared.loaded.manifest.displayName,
      dependencies: prepared.loaded.manifest.dependencies,
    },
    defaultBindingAssetKey: binding.assetKey,
    assets,
  });
}

export interface InstallCatalogPackageOptions {
  readonly pool: Pool;
  readonly workspaceId: string;
  readonly actorPrincipalId: string;
  readonly packageRoot: string;
  readonly now?: Date;
  readonly nextId?: () => string;
}

export interface InstallPreparedCatalogPackageOptions extends Omit<
  InstallCatalogPackageOptions,
  "packageRoot"
> {
  readonly prepared: PreparedCatalogPackageV1;
  readonly providerRouteSelections?: ReadonlyMap<string, string>;
}

export interface InstallCatalogPackageResult {
  readonly packageKey: string;
  readonly packageVersion: string;
  readonly packageDigest: string;
  readonly installedAssets: number;
}

export class CatalogPackageInstallError extends Error {
  public constructor(
    readonly code:
      | "asset_reference_invalid"
      | "fixture_failed"
      | "installed_revision_conflict"
      | "unsupported_asset",
    message: string,
  ) {
    super(message);
    this.name = "CatalogPackageInstallError";
  }
}

interface IdentityRow extends RowDataPacket {
  readonly id: string;
  readonly canonicalDigest?: string;
  readonly currentRevisionId?: string | null;
  readonly contractRevisionId?: string;
  readonly implementationRevisionId?: string;
  readonly priority?: number;
}

function revisionKey(reference: {
  readonly key: string;
  readonly revision: number;
  readonly canonicalDigest: string;
}): string {
  return `${reference.key}\0${String(reference.revision)}\0${reference.canonicalDigest}`;
}

function authoringText(value: {
  readonly defaultLocale: string;
  readonly values: Readonly<Record<string, string>>;
}): Readonly<{ "zh-CN": string; "en-US": string }> {
  const zh = value.values["zh-CN"];
  const en = value.values["en-US"];
  if (!zh || !en) {
    throw new CatalogPackageInstallError(
      "asset_reference_invalid",
      "Catalog authoring text must provide zh-CN and en-US.",
    );
  }
  return Object.freeze({
    "zh-CN": zh,
    "en-US": en,
  });
}

function authoringDeclaration(
  asset: CapabilityDeclarationAssetV1,
): WorkflowCapabilityAuthoringDeclaration {
  const declaration = asset.declaration;
  return Object.freeze({
    schemaVersion: "kanvas.capability-declaration/v1" as const,
    origin: "declared" as const,
    catalog: Object.freeze({
      title: authoringText(declaration.catalog.title),
      ...(declaration.catalog.description
        ? { description: authoringText(declaration.catalog.description) }
        : {}),
      category: authoringText(declaration.catalog.category),
      sourceKind: declaration.catalog.sourceKind,
      tags: [...declaration.catalog.tags],
      surfaces: [...declaration.catalog.surfaces],
    }),
    parameters: declaration.parameters.map((parameter) =>
      Object.freeze({
        ...parameter,
        label: authoringText(parameter.label),
        ...(parameter.description
          ? { description: authoringText(parameter.description) }
          : {}),
      }),
    ) as WorkflowCapabilityAuthoringDeclaration["parameters"],
    outputs: declaration.outputs.map((output) =>
      Object.freeze({
        ...output,
        label: authoringText(output.label),
        ...(output.description
          ? { description: authoringText(output.description) }
          : {}),
      }),
    ) as WorkflowCapabilityAuthoringDeclaration["outputs"],
    ...(declaration.canvas ? { canvas: declaration.canvas } : {}),
  });
}

function failReference(message: string): never {
  throw new CatalogPackageInstallError("asset_reference_invalid", message);
}

function assertFixture(
  implementation: CapabilityImplementationDefinitionV1,
  input: CompiledCapabilityMappingPlanV1,
  output: CompiledCapabilityMappingPlanV1,
): void {
  for (const fixture of implementation.fixtures) {
    const adapterInput = executeCapabilityMappingPlanV1(input, {
      input: fixture.capabilityInput,
      configuration: fixture.configuration,
    });
    const capabilityOutput = executeCapabilityMappingPlanV1(output, {
      result: fixture.adapterResult,
    });
    if (
      digestProviderValue(adapterInput) !==
        digestProviderValue(fixture.expectedAdapterInput) ||
      digestProviderValue(capabilityOutput) !==
        digestProviderValue(fixture.expectedCapabilityOutput)
    ) {
      throw new CatalogPackageInstallError(
        "fixture_failed",
        `Capability Implementation ${implementation.implementationKey} fixture ${fixture.name} failed.`,
      );
    }
  }
}

export function prepareCatalogPackageV1(
  loaded: LoadedCatalogPackageV1,
): PreparedCatalogPackageV1 {
  const contracts = new Map<string, PreparedContract>();
  const declarations: PreparedDeclaration[] = [];
  const adapters = new Map<string, PreparedAdapter>();
  const modelResources = new Map<string, PreparedModelResource>();
  const rawImplementations: RawImplementation[] = [];
  const bindings: PreparedBinding[] = [];
  const workflows = new Map<string, PreparedWorkflow>();
  const skills: PreparedSkill[] = [];

  for (const asset of loaded.assets) {
    const digest = asset.descriptor.contentDigest;
    if (asset.descriptor.kind === "capability_contract") {
      const document = parseCapabilityContractAssetV1(asset.document);
      const prepared = Object.freeze({
        assetKey: asset.descriptor.assetKey,
        digest,
        document,
      });
      const key = revisionKey({
        key: document.contractKey,
        revision: document.revision,
        canonicalDigest: digest,
      });
      if (contracts.has(key)) {
        return failReference(
          `Capability Contract ${document.contractKey} is duplicated.`,
        );
      }
      contracts.set(key, prepared);
      continue;
    }
    if (asset.descriptor.kind === "capability_declaration") {
      declarations.push(
        Object.freeze({
          assetKey: asset.descriptor.assetKey,
          digest,
          document: parseCapabilityDeclarationAssetV1(asset.document),
        }),
      );
      continue;
    }
    if (asset.descriptor.kind === "runtime_adapter") {
      const document = parseRuntimeAdapterDefinitionRevision(asset.document);
      const prepared = Object.freeze({
        assetKey: asset.descriptor.assetKey,
        digest,
        document,
      });
      const key = revisionKey({
        key: document.adapterKey,
        revision: document.revision,
        canonicalDigest: digest,
      });
      if (adapters.has(key)) {
        return failReference(
          `Runtime Adapter ${document.adapterKey} is duplicated.`,
        );
      }
      adapters.set(key, prepared);
      continue;
    }
    if (asset.descriptor.kind === "model_resource") {
      const document = parseModelResourceCatalogAssetV1(asset.document);
      const manifest = {
        schemaVersion: "kanvas.model-resource/v1",
        family: document.family,
        variant: document.variant,
        format: document.format,
        executionTargets: [...document.executionTargets].toSorted(),
        sha256: document.expectedSha256,
        ...(document.expectedByteSize
          ? { byteSize: document.expectedByteSize }
          : {}),
        mediaType: document.mediaType,
        license: document.license,
        source: document.source,
        nativeInterface: document.nativeInterface,
        runtime: {},
      } as const;
      if (
        digestProviderValue({
          schemaVersion: 1,
          key: document.resourceKey,
          manifest,
        }) !== document.revisionDigest
      ) {
        failReference(
          `Model Resource ${document.resourceKey} has an invalid Revision digest.`,
        );
      }
      const key = revisionKey({
        key: document.resourceKey,
        revision: document.revision,
        canonicalDigest: document.revisionDigest,
      });
      if (modelResources.has(key)) {
        failReference(`Model Resource ${document.resourceKey} is duplicated.`);
      }
      modelResources.set(
        key,
        Object.freeze({
          assetKey: asset.descriptor.assetKey,
          digest: asset.descriptor.contentDigest,
          document,
        }),
      );
      continue;
    }
    if (asset.descriptor.kind === "capability_implementation") {
      const document = parseCapabilityImplementationDefinitionV1(
        asset.document,
      );
      rawImplementations.push({
        assetKey: asset.descriptor.assetKey,
        digest,
        document,
      });
      continue;
    }
    if (asset.descriptor.kind === "capability_binding") {
      bindings.push(
        Object.freeze({
          assetKey: asset.descriptor.assetKey,
          digest,
          document: parseCapabilityBindingDefinitionV1(asset.document),
        }),
      );
      continue;
    }
    if (asset.descriptor.kind === "workflow") {
      const document = parseWorkflowCatalogAssetV1(asset.document);
      if (!isWorkflowTopology(document.topology)) {
        failReference(
          `Workflow ${document.workflowKey} has an invalid bounded topology.`,
        );
      }
      const topologyCapabilities = document.topology.nodes.flatMap((node) => {
        if (node.kind === "invoke") return [node.capability];
        if (node.kind === "map") return [node.invoke.capability];
        return [];
      });
      const required = new Set(
        document.requiredCapabilities.map((reference) =>
          revisionKey(reference),
        ),
      );
      if (
        topologyCapabilities.length < 1 ||
        topologyCapabilities.some(
          (reference) =>
            !required.has(
              revisionKey({
                key: reference.contractId,
                revision: reference.revision,
                canonicalDigest: reference.canonicalDigest,
              }),
            ),
        ) ||
        [...required].some(
          (reference) =>
            !topologyCapabilities.some(
              (candidate) =>
                revisionKey({
                  key: candidate.contractId,
                  revision: candidate.revision,
                  canonicalDigest: candidate.canonicalDigest,
                }) === reference,
            ),
        )
      ) {
        failReference(
          `Workflow ${document.workflowKey} Capability pins do not match its declared dependencies.`,
        );
      }
      assertBoundedCapabilityJsonSchema(document.inputSchema);
      assertBoundedCapabilityJsonSchema(document.outputSchema);
      if (
        digestProviderValue({
          schemaVersion: 1,
          topology: document.topology,
          inputSchema: document.inputSchema,
          outputSchema: document.outputSchema,
        }) !== document.canonicalDigest
      ) {
        failReference(
          `Workflow ${document.workflowKey} has an invalid canonical digest.`,
        );
      }
      const key = revisionKey({
        key: document.workflowKey,
        revision: document.revision,
        canonicalDigest: document.canonicalDigest,
      });
      if (workflows.has(key)) {
        failReference(`Workflow ${document.workflowKey} is duplicated.`);
      }
      workflows.set(
        key,
        Object.freeze({
          assetKey: asset.descriptor.assetKey,
          digest: asset.descriptor.contentDigest,
          document,
        }),
      );
      continue;
    }
    if (asset.descriptor.kind === "skill") {
      skills.push(
        Object.freeze({
          assetKey: asset.descriptor.assetKey,
          digest: asset.descriptor.contentDigest,
          document: parseSkillCatalogAssetV1(asset.document),
        }),
      );
      continue;
    }
    throw new CatalogPackageInstallError(
      "unsupported_asset",
      `Catalog asset kind ${String(asset.descriptor.kind)} is not installed by this control-plane slice.`,
    );
  }

  for (const declaration of declarations) {
    if (!contracts.has(revisionKey(declaration.document.contract))) {
      failReference(
        `Capability Declaration ${declaration.assetKey} references an unavailable Contract.`,
      );
    }
  }

  const implementations = new Map<string, PreparedImplementation>();
  for (const raw of rawImplementations) {
    const contract = contracts.get(revisionKey(raw.document.contract));
    const adapter = adapters.get(
      revisionKey({
        key: raw.document.adapter.adapterKey,
        revision: raw.document.adapter.revision,
        canonicalDigest: raw.document.adapter.canonicalDigest,
      }),
    );
    if (!contract || !adapter) {
      failReference(
        `Capability Implementation ${raw.document.implementationKey} references an unavailable Contract or Adapter.`,
      );
    }
    if (!adapter.document.sourceKinds.includes(raw.document.source.kind)) {
      failReference(
        `Runtime Adapter ${adapter.document.adapterKey} does not support source ${raw.document.source.kind}.`,
      );
    }
    if (
      raw.document.source.kind === "model_resource" &&
      !modelResources.has(revisionKey(raw.document.source.resource))
    ) {
      failReference(
        `Capability Implementation ${raw.document.implementationKey} references an unavailable Model Resource.`,
      );
    }
    if (raw.document.source.kind === "model_resource") {
      const modelResource = modelResources.get(
        revisionKey(raw.document.source.resource),
      )!;
      if (
        !adapter.document.supportedModelFormats.includes(
          modelResource.document.format,
        ) ||
        adapter.document.executionTarget === "provider" ||
        !modelResource.document.executionTargets.includes(
          adapter.document.executionTarget,
        )
      ) {
        failReference(
          `Runtime Adapter ${adapter.document.adapterKey} does not support this Model Resource release.`,
        );
      }
    }
    const compiledInputMapping = compileCapabilityMappingPlanV1({
      document: raw.document.inputMapping,
      sourceSchemas: {
        input: contract.document.inputSchema,
        configuration: adapter.document.configurationSchema,
      },
      targetSchema: adapter.document.invocationInputSchema,
    });
    const compiledOutputMapping = compileCapabilityMappingPlanV1({
      document: raw.document.outputMapping,
      sourceSchemas: {
        result: adapter.document.invocationOutputSchema,
      },
      targetSchema: contract.document.outputSchema,
    });
    assertFixture(raw.document, compiledInputMapping, compiledOutputMapping);
    const prepared = Object.freeze({
      assetKey: raw.assetKey,
      digest: raw.digest,
      document: raw.document,
      compiledInputMapping,
      compiledInputMappingDigest: digestProviderValue(compiledInputMapping),
      compiledOutputMapping,
      compiledOutputMappingDigest: digestProviderValue(compiledOutputMapping),
    });
    const key = revisionKey({
      key: raw.document.implementationKey,
      revision: raw.document.revision,
      canonicalDigest: raw.digest,
    });
    if (implementations.has(key)) {
      failReference(
        `Capability Implementation ${raw.document.implementationKey} is duplicated.`,
      );
    }
    implementations.set(key, prepared);
  }

  for (const binding of bindings) {
    if (
      !contracts.has(revisionKey(binding.document.contract)) ||
      !implementations.has(revisionKey(binding.document.implementation))
    ) {
      failReference(
        `Capability Binding ${binding.document.bindingKey} references an unavailable revision.`,
      );
    }
  }
  for (const workflow of workflows.values()) {
    for (const required of workflow.document.requiredCapabilities) {
      if (!contracts.has(revisionKey(required))) {
        failReference(
          `Workflow ${workflow.document.workflowKey} references an unavailable Capability Contract.`,
        );
      }
    }
  }
  for (const skill of skills) {
    for (const entrypoint of skill.document.entrypoints) {
      if (!workflows.has(revisionKey(entrypoint.workflow))) {
        failReference(
          `Skill ${skill.document.skillKey} references an unavailable Workflow.`,
        );
      }
    }
  }

  const prepared = Object.freeze({
    loaded,
    contracts,
    declarations: Object.freeze(declarations),
    adapters,
    modelResources,
    implementations,
    bindings: Object.freeze(bindings),
    workflows,
    // Catalog Workflow wrappers are execution metadata, not instruction-backed
    // product Skills. Real Skills enter through the Agent Foundation package or
    // the Skill publication pipeline with a SKILL.md resource.
    skills: Object.freeze([]),
  });
  const recommendationKeys = new Set<string>();
  const recommendedContracts = new Set<string>();
  for (const recommendation of loaded.manifest.recommendations) {
    if (recommendationKeys.has(recommendation.recommendationKey)) {
      failReference(
        `Capability recommendation ${recommendation.recommendationKey} is duplicated.`,
      );
    }
    const document = capabilityCatalogRecommendationFromPreparedPackageV1(
      prepared,
      recommendation,
    );
    const contract = document.assets.find(
      (asset) => asset.descriptor.kind === "capability_contract",
    );
    if (!contract) {
      failReference(
        `Capability recommendation ${recommendation.recommendationKey} lost its Contract.`,
      );
    }
    const contractKey = parseCapabilityContractAssetV1(
      contract.document,
    ).contractKey;
    if (recommendedContracts.has(contractKey)) {
      failReference(
        `Capability ${contractKey} has more than one recommended default route.`,
      );
    }
    recommendationKeys.add(recommendation.recommendationKey);
    recommendedContracts.add(contractKey);
  }
  return prepared;
}

async function transaction<T>(
  pool: Pool,
  operation: (connection: PoolConnection) => Promise<T>,
): Promise<T> {
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

function requestKey(
  packageKey: string,
  version: string,
  assetKey: string,
): string {
  return `catalog:${packageKey}:${version}:${assetKey}`.slice(0, 160);
}

function requestHash(packageDigest: string, assetDigest: string): string {
  return digestProviderValue({ packageDigest, assetDigest });
}

function routePolicy(
  binding: CapabilityBindingDefinitionV1,
  executionTarget: "browser" | "provider" | "worker",
  dependencyReady: boolean,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    retryPolicy: Object.freeze({
      maxAttempts: 1,
      backoff: "fixed",
      initialDelayMs: 0,
      maxDelayMs: 0,
    }),
    attemptTimeoutMs: executionTarget === "provider" ? 240_000 : 120_000,
    fallbackOn:
      binding.fallbackOn.length > 0 ? Object.freeze(["not_started"]) : [],
    eligibility: binding.eligibility,
    catalogDesiredEnabled: binding.enabled,
    dependencyReady,
  });
}

interface ModelRevisionRow extends RowDataPacket {
  readonly id: string;
}

interface ProviderRouteRevisionRow extends RowDataPacket {
  readonly id: string;
}

interface WorkflowIdentityRow extends RowDataPacket {
  readonly id: string;
  readonly canonicalDigest?: string;
}

async function workflowDependenciesReady(
  connection: PoolConnection,
  workspaceId: string,
  contractRevisionIds: readonly string[],
): Promise<boolean> {
  for (const contractRevisionId of contractRevisionIds) {
    const [rows] = await connection.execute<IdentityRow[]>(
      `SELECT id
       FROM capability_binding
       WHERE workspace_id = ? AND contract_revision_id = ?
         AND lifecycle_status = 'active'
       LIMIT 1 FOR SHARE`,
      [workspaceId, contractRevisionId],
    );
    if (!rows[0]) return false;
  }
  return true;
}

async function resolveProviderRoute(
  connection: PoolConnection,
  workspaceId: string,
  source: Extract<
    CapabilityImplementationDefinitionV1["source"],
    { readonly kind: "model_service" }
  >,
  selectedRoutePolicyRevisionId?: string,
): Promise<string | undefined> {
  const [rows] = await connection.execute<ProviderRouteRevisionRow[]>(
    `SELECT route.id
     FROM route_policy_revision AS route
     INNER JOIN model_deployment AS deployment
       ON deployment.workspace_id = route.workspace_id
      AND deployment.id = JSON_UNQUOTE(
        JSON_EXTRACT(route.route_document, '$.modelDeploymentId')
      )
     INNER JOIN provider_endpoint AS endpoint
       ON endpoint.workspace_id = deployment.workspace_id
      AND endpoint.id = deployment.provider_endpoint_id
     WHERE route.workspace_id = ?
       AND (? IS NULL OR route.id = ?)
       AND route.lifecycle_status = 'published'
       AND deployment.lifecycle_status = 'active'
       AND endpoint.lifecycle_status = 'active'
       AND JSON_UNQUOTE(JSON_EXTRACT(route.route_document, '$.capabilityKey')) = ?
       AND (? IS NULL OR JSON_UNQUOTE(JSON_EXTRACT(route.route_document, '$.apiSurface')) = ?)
       AND (? IS NULL OR endpoint.preset_kind = ?)
     ORDER BY route.revision DESC, route.published_at DESC, route.id DESC
     LIMIT 1`,
    [
      workspaceId,
      selectedRoutePolicyRevisionId ?? null,
      selectedRoutePolicyRevisionId ?? null,
      source.selector.operation,
      source.selector.apiSurface ?? null,
      source.selector.apiSurface ?? null,
      source.selector.providerPreset ?? null,
      source.selector.providerPreset ?? null,
    ],
  );
  return rows[0]?.id;
}

function conflict(message: string): never {
  throw new CatalogPackageInstallError("installed_revision_conflict", message);
}

export async function installPreparedCatalogRuntimeAdaptersInTransaction(
  connection: PoolConnection,
  options: {
    readonly workspaceId: string;
    readonly prepared: PreparedCatalogPackageV1;
    readonly now: Date;
    readonly nextId: () => string;
    readonly preserveCurrentRevision?: boolean;
  },
  adapterIds: Map<string, string> = new Map(),
): Promise<void> {
  const initializedDefinitions = new Set<string>();
  const adapters = [...options.prepared.adapters.values()].sort(
    (left, right) => left.document.revision - right.document.revision,
  );
  for (const adapter of adapters) {
    const [definitionRows] = await connection.execute<IdentityRow[]>(
      `SELECT id, current_revision_id AS currentRevisionId
       FROM runtime_adapter_definition
       WHERE workspace_id = ? AND adapter_key = ?
       LIMIT 1 FOR UPDATE`,
      [options.workspaceId, adapter.document.adapterKey],
    );
    let definitionId = definitionRows[0]?.id;
    if (!definitionId) {
      definitionId = options.nextId();
      await connection.execute<ResultSetHeader>(
        `INSERT INTO runtime_adapter_definition (
           id, workspace_id, adapter_key, lifecycle_status,
           current_revision_id, version, created_at, updated_at
         ) VALUES (?, ?, ?, 'active', NULL, 1, ?, ?)`,
        [
          definitionId,
          options.workspaceId,
          adapter.document.adapterKey,
          options.now,
          options.now,
        ],
      );
    }
    if (!definitionRows[0]?.currentRevisionId)
      initializedDefinitions.add(definitionId);
    const [revisionRows] = await connection.execute<IdentityRow[]>(
      `SELECT id, canonical_digest AS canonicalDigest
       FROM runtime_adapter_revision
       WHERE workspace_id = ? AND runtime_adapter_definition_id = ? AND revision = ?
       LIMIT 1 FOR UPDATE`,
      [options.workspaceId, definitionId, adapter.document.revision],
    );
    let adapterRevisionId = revisionRows[0]?.id;
    if (revisionRows[0] && revisionRows[0].canonicalDigest !== adapter.digest) {
      conflict(
        `Installed Runtime Adapter ${adapter.document.adapterKey} differs from the Catalog Package.`,
      );
    }
    if (!adapterRevisionId) {
      adapterRevisionId = options.nextId();
      await connection.execute<ResultSetHeader>(
        `INSERT INTO runtime_adapter_revision (
           id, workspace_id, runtime_adapter_definition_id, revision,
           lifecycle_status, execution_target, canonical_digest, document,
           created_at, published_at
         ) VALUES (?, ?, ?, ?, 'published', ?, ?, ?, ?, ?)`,
        [
          adapterRevisionId,
          options.workspaceId,
          definitionId,
          adapter.document.revision,
          adapter.document.executionTarget,
          adapter.digest,
          JSON.stringify(adapter.document),
          options.now,
          options.now,
        ],
      );
    }
    if (
      definitionRows[0]?.currentRevisionId !== adapterRevisionId &&
      (!options.preserveCurrentRevision ||
        initializedDefinitions.has(definitionId))
    ) {
      await connection.execute<ResultSetHeader>(
        `UPDATE runtime_adapter_definition
         SET current_revision_id = ?, version = version + 1, updated_at = ?
         WHERE workspace_id = ? AND id = ?`,
        [adapterRevisionId, options.now, options.workspaceId, definitionId],
      );
    }
    adapterIds.set(
      revisionKey({
        key: adapter.document.adapterKey,
        revision: adapter.document.revision,
        canonicalDigest: adapter.digest,
      }),
      adapterRevisionId,
    );
  }
}

export async function installCatalogRuntimeAdaptersV1(options: {
  readonly pool: Pool;
  readonly workspaceId: string;
  readonly packageRoot: string;
  readonly now?: Date;
  readonly nextId?: () => string;
}): Promise<{ readonly installed: number }> {
  const prepared = prepareCatalogPackageV1(
    await loadCatalogPackageV1(options.packageRoot),
  );
  await transaction(options.pool, async (connection) => {
    await installPreparedCatalogRuntimeAdaptersInTransaction(
      connection,
      {
        workspaceId: options.workspaceId,
        prepared,
        now: options.now ?? new Date(),
        nextId: options.nextId ?? monotonicFactory(),
      },
      new Map(),
    );
  });
  return Object.freeze({ installed: prepared.adapters.size });
}

export async function installCatalogPackageV1(
  options: InstallCatalogPackageOptions,
): Promise<InstallCatalogPackageResult> {
  const prepared = prepareCatalogPackageV1(
    await loadCatalogPackageV1(options.packageRoot),
  );
  return installPreparedCatalogPackageV1({
    pool: options.pool,
    workspaceId: options.workspaceId,
    actorPrincipalId: options.actorPrincipalId,
    prepared,
    ...(options.now ? { now: options.now } : {}),
    ...(options.nextId ? { nextId: options.nextId } : {}),
  });
}

export async function installPreparedCatalogPackageV1(
  options: InstallPreparedCatalogPackageOptions,
): Promise<InstallCatalogPackageResult> {
  const prepared = options.prepared;
  const nextId = options.nextId ?? monotonicFactory();
  const now = options.now ?? new Date();
  const packageKey = prepared.loaded.manifest.packageKey;
  const packageVersion = prepared.loaded.manifest.version;
  const packageDigest = prepared.loaded.manifest.contentDigest;
  if (!/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u.test(options.actorPrincipalId)) {
    failReference("Catalog Package actor Principal is invalid.");
  }

  return transaction(options.pool, async (connection) => {
    const contractIds = new Map<string, string>();
    const capabilityDefinitionIds = new Map<string, string>();
    const adapterIds = new Map<string, string>();
    const modelResourceRevisionIds = new Map<string, string>();
    const implementationIds = new Map<string, string>();
    const implementationDependencyReady = new Map<string, boolean>();
    const implementationRouteIds = new Map<string, string>();
    const workflowRevisionIds = new Map<string, string>();
    const workflowDraftIds = new Map<string, string>();
    const workflowReadiness = new Map<string, boolean>();

    for (const contract of prepared.contracts.values()) {
      const [rows] = await connection.execute<IdentityRow[]>(
        `SELECT id, canonical_digest AS canonicalDigest
         FROM capability_contract_revision
         WHERE workspace_id = ? AND contract_key = ? AND revision = ?
         LIMIT 1 FOR UPDATE`,
        [
          options.workspaceId,
          contract.document.contractKey,
          contract.document.revision,
        ],
      );
      let contractRevisionId = rows[0]?.id;
      if (rows[0] && rows[0].canonicalDigest !== contract.digest) {
        conflict(
          `Installed Capability Contract ${contract.document.contractKey} differs from the Catalog Package.`,
        );
      }
      if (!contractRevisionId) {
        contractRevisionId = nextId();
        await connection.execute<ResultSetHeader>(
          `INSERT INTO capability_contract_revision (
             id, workspace_id, contract_key, revision, lifecycle_status,
             canonical_digest, input_schema, output_schema, presentation,
             idempotency_mode, supported_invokers, created_at, published_at
           ) VALUES (?, ?, ?, ?, 'published', ?, ?, ?, NULL, ?, ?, ?, ?)`,
          [
            contractRevisionId,
            options.workspaceId,
            contract.document.contractKey,
            contract.document.revision,
            contract.digest,
            JSON.stringify(contract.document.inputSchema),
            JSON.stringify(contract.document.outputSchema),
            contract.document.idempotencyMode,
            JSON.stringify(contract.document.supportedInvokers),
            now,
            now,
          ],
        );
      }
      contractIds.set(
        revisionKey({
          key: contract.document.contractKey,
          revision: contract.document.revision,
          canonicalDigest: contract.digest,
        }),
        contractRevisionId,
      );

      const [definitionRows] = await connection.execute<IdentityRow[]>(
        `SELECT id, current_contract_revision_id AS contractRevisionId
         FROM capability_definition
         WHERE workspace_id = ? AND capability_key = ?
         LIMIT 1 FOR UPDATE`,
        [options.workspaceId, contract.document.contractKey],
      );
      let definitionId = definitionRows[0]?.id;
      if (!definitionId) {
        definitionId = nextId();
        const key = requestKey(packageKey, packageVersion, contract.assetKey);
        await connection.execute<ResultSetHeader>(
          `INSERT INTO capability_definition (
             id, workspace_id, capability_key, lifecycle_status,
             current_contract_revision_id, current_declaration_revision_id,
             create_request_key, create_request_hash, version,
             created_at, updated_at, archived_at
           ) VALUES (?, ?, ?, 'active', ?, NULL, ?, ?, 1, ?, ?, NULL)`,
          [
            definitionId,
            options.workspaceId,
            contract.document.contractKey,
            contractRevisionId,
            key,
            requestHash(packageDigest, contract.digest),
            now,
            now,
          ],
        );
      } else if (definitionRows[0]?.contractRevisionId !== contractRevisionId) {
        await connection.execute<ResultSetHeader>(
          `UPDATE capability_definition
           SET current_contract_revision_id = ?, version = version + 1,
               updated_at = ?
           WHERE workspace_id = ? AND id = ?`,
          [contractRevisionId, now, options.workspaceId, definitionId],
        );
      }
      capabilityDefinitionIds.set(contract.document.contractKey, definitionId);
    }

    for (const declaration of prepared.declarations) {
      const contractRevisionId = contractIds.get(
        revisionKey(declaration.document.contract),
      );
      const definitionId = capabilityDefinitionIds.get(
        declaration.document.contract.key,
      );
      if (!contractRevisionId || !definitionId) {
        failReference(
          `Capability Declaration ${declaration.assetKey} lost its Contract.`,
        );
      }
      const projectedDeclaration = authoringDeclaration(declaration.document);
      const declarationDigest = digestProviderValue(projectedDeclaration);
      const [rows] = await connection.execute<IdentityRow[]>(
        `SELECT id, canonical_digest AS canonicalDigest
         FROM capability_declaration_revision
         WHERE workspace_id = ? AND capability_definition_id = ? AND revision = ?
         LIMIT 1 FOR UPDATE`,
        [
          options.workspaceId,
          definitionId,
          declaration.document.contract.revision,
        ],
      );
      let declarationRevisionId = rows[0]?.id;
      if (rows[0] && rows[0].canonicalDigest !== declarationDigest) {
        conflict(
          `Installed Capability Declaration ${declaration.assetKey} differs from the Catalog Package.`,
        );
      }
      if (!declarationRevisionId) {
        declarationRevisionId = nextId();
        const key = requestKey(
          packageKey,
          packageVersion,
          declaration.assetKey,
        );
        await connection.execute<ResultSetHeader>(
          `INSERT INTO capability_declaration_revision (
             id, workspace_id, capability_definition_id, contract_revision_id,
             revision, lifecycle_status, schema_version, canonical_digest,
             declaration, publication_request_key, publication_request_hash,
             created_at, published_at
           ) VALUES (?, ?, ?, ?, ?, 'published', 1, ?, ?, ?, ?, ?, ?)`,
          [
            declarationRevisionId,
            options.workspaceId,
            definitionId,
            contractRevisionId,
            declaration.document.contract.revision,
            declarationDigest,
            JSON.stringify(projectedDeclaration),
            key,
            requestHash(packageDigest, declaration.digest),
            now,
            now,
          ],
        );
      }
      await connection.execute<ResultSetHeader>(
        `UPDATE capability_definition
         SET current_contract_revision_id = ?, current_declaration_revision_id = ?,
             version = version + 1, updated_at = ?
         WHERE workspace_id = ? AND id = ?
           AND (current_declaration_revision_id IS NULL OR current_declaration_revision_id <> ?)`,
        [
          contractRevisionId,
          declarationRevisionId,
          now,
          options.workspaceId,
          definitionId,
          declarationRevisionId,
        ],
      );
    }

    for (const modelResource of prepared.modelResources.values()) {
      const [entryRows] = await connection.execute<IdentityRow[]>(
        `SELECT id, canonical_digest AS canonicalDigest
         FROM model_resource_catalog_entry
         WHERE workspace_id = ? AND asset_key = ?
         LIMIT 1 FOR UPDATE`,
        [options.workspaceId, modelResource.assetKey],
      );
      if (
        entryRows[0] &&
        entryRows[0].canonicalDigest !== modelResource.digest
      ) {
        conflict(
          `Installed Model Resource Catalog entry ${modelResource.document.resourceKey} differs from the Catalog Package.`,
        );
      }
      if (!entryRows[0]) {
        await connection.execute<ResultSetHeader>(
          `INSERT INTO model_resource_catalog_entry (
             id, workspace_id, asset_key, resource_key, revision,
             canonical_digest, document, lifecycle_status, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
          [
            nextId(),
            options.workspaceId,
            modelResource.assetKey,
            modelResource.document.resourceKey,
            modelResource.document.revision,
            modelResource.digest,
            JSON.stringify(modelResource.document),
            now,
            now,
          ],
        );
      }
      const reference = revisionKey({
        key: modelResource.document.resourceKey,
        revision: modelResource.document.revision,
        canonicalDigest: modelResource.document.revisionDigest,
      });
      const [revisionRows] = await connection.execute<ModelRevisionRow[]>(
        `SELECT revision.id
         FROM model_resource_revision AS revision
         INNER JOIN model_resource AS resource
           ON resource.workspace_id = revision.workspace_id
          AND resource.id = revision.model_resource_id
         WHERE revision.workspace_id = ?
           AND resource.resource_key = ?
           AND revision.revision = ?
           AND revision.canonical_digest = ?
           AND resource.lifecycle_status = 'active'
           AND revision.lifecycle_status IN ('published', 'deprecated')
         LIMIT 1 FOR SHARE`,
        [
          options.workspaceId,
          modelResource.document.resourceKey,
          modelResource.document.revision,
          modelResource.document.revisionDigest,
        ],
      );
      if (revisionRows[0]) {
        modelResourceRevisionIds.set(reference, revisionRows[0].id);
      }
    }

    await installPreparedCatalogRuntimeAdaptersInTransaction(
      connection,
      { workspaceId: options.workspaceId, prepared, now, nextId },
      adapterIds,
    );

    for (const implementation of prepared.implementations.values()) {
      const contractRevisionId = contractIds.get(
        revisionKey(implementation.document.contract),
      );
      const runtimeAdapterRevisionId = adapterIds.get(
        revisionKey({
          key: implementation.document.adapter.adapterKey,
          revision: implementation.document.adapter.revision,
          canonicalDigest: implementation.document.adapter.canonicalDigest,
        }),
      );
      if (!contractRevisionId || !runtimeAdapterRevisionId) {
        failReference(
          `Capability Implementation ${implementation.document.implementationKey} lost its dependency.`,
        );
      }
      const source = implementation.document.source;
      const modelResourceRevisionId =
        source.kind === "model_resource"
          ? modelResourceRevisionIds.get(revisionKey(source.resource))
          : undefined;
      const routePolicyRevisionId =
        source.kind === "model_service"
          ? await resolveProviderRoute(
              connection,
              options.workspaceId,
              source,
              options.providerRouteSelections?.get(implementation.assetKey),
            )
          : undefined;
      let dependencyReady = true;
      if (source.kind === "model_resource") {
        dependencyReady = modelResourceRevisionId !== undefined;
      } else if (source.kind === "model_service") {
        dependencyReady = routePolicyRevisionId !== undefined;
      }
      const [rows] = await connection.execute<IdentityRow[]>(
        `SELECT id, canonical_digest AS canonicalDigest
         FROM capability_implementation_revision
         WHERE workspace_id = ? AND implementation_key = ? AND revision = ?
         LIMIT 1 FOR UPDATE`,
        [
          options.workspaceId,
          implementation.document.implementationKey,
          implementation.document.revision,
        ],
      );
      let implementationRevisionId = rows[0]?.id;
      if (rows[0] && rows[0].canonicalDigest !== implementation.digest) {
        conflict(
          `Installed Capability Implementation ${implementation.document.implementationKey} differs from the Catalog Package.`,
        );
      }
      if (!implementationRevisionId) {
        implementationRevisionId = nextId();
        const adapter = prepared.adapters.get(
          revisionKey({
            key: implementation.document.adapter.adapterKey,
            revision: implementation.document.adapter.revision,
            canonicalDigest: implementation.document.adapter.canonicalDigest,
          }),
        )!;
        await connection.execute<ResultSetHeader>(
          `INSERT INTO capability_implementation_revision (
             id, workspace_id, implementation_key, display_name, description,
             revision, lifecycle_status,
             contract_revision_id, runtime_adapter_revision_id,
             execution_target, adapter_key, source_kind, source_reference,
             canonical_digest, publication_request_key,
             publication_request_hash, configuration,
             input_mapping, input_mapping_digest, compiled_input_mapping,
             output_mapping, output_mapping_digest, compiled_output_mapping,
             fixture_suite, created_at, published_at
           ) VALUES (
             ?, ?, ?, ?, ?, ?, 'published', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
           )`,
          [
            implementationRevisionId,
            options.workspaceId,
            implementation.document.implementationKey,
            JSON.stringify(implementation.document.displayName),
            implementation.document.description
              ? JSON.stringify(implementation.document.description)
              : null,
            implementation.document.revision,
            contractRevisionId,
            runtimeAdapterRevisionId,
            adapter.document.executionTarget,
            adapter.document.adapterKey,
            implementation.document.source.kind,
            JSON.stringify(implementation.document.source),
            implementation.digest,
            requestKey(packageKey, packageVersion, implementation.assetKey),
            requestHash(packageDigest, implementation.digest),
            JSON.stringify(implementation.document.configuration),
            JSON.stringify(implementation.document.inputMapping),
            implementation.compiledInputMappingDigest,
            JSON.stringify(implementation.compiledInputMapping),
            JSON.stringify(implementation.document.outputMapping),
            implementation.compiledOutputMappingDigest,
            JSON.stringify(implementation.compiledOutputMapping),
            JSON.stringify(implementation.document.fixtures),
            now,
            now,
          ],
        );
      }
      implementationIds.set(
        revisionKey({
          key: implementation.document.implementationKey,
          revision: implementation.document.revision,
          canonicalDigest: implementation.digest,
        }),
        implementationRevisionId,
      );
      const implementationReference = revisionKey({
        key: implementation.document.implementationKey,
        revision: implementation.document.revision,
        canonicalDigest: implementation.digest,
      });
      implementationDependencyReady.set(
        implementationReference,
        dependencyReady,
      );
      if (routePolicyRevisionId) {
        implementationRouteIds.set(
          implementationReference,
          routePolicyRevisionId,
        );
      }
      if (modelResourceRevisionId) {
        await connection.execute<ResultSetHeader>(
          `INSERT IGNORE INTO capability_implementation_model_resource (
             workspace_id, implementation_revision_id,
             model_resource_revision_id, resource_role, created_at
           ) VALUES (?, ?, ?, 'primary', ?)`,
          [
            options.workspaceId,
            implementationRevisionId,
            modelResourceRevisionId,
            now,
          ],
        );
      }
    }

    for (const binding of prepared.bindings) {
      const contractRevisionId = contractIds.get(
        revisionKey(binding.document.contract),
      );
      const implementationRevisionId = implementationIds.get(
        revisionKey(binding.document.implementation),
      );
      const implementation = prepared.implementations.get(
        revisionKey(binding.document.implementation),
      );
      if (!contractRevisionId || !implementationRevisionId || !implementation) {
        failReference(
          `Capability Binding ${binding.document.bindingKey} lost its dependency.`,
        );
      }
      const adapter = prepared.adapters.get(
        revisionKey({
          key: implementation.document.adapter.adapterKey,
          revision: implementation.document.adapter.revision,
          canonicalDigest: implementation.document.adapter.canonicalDigest,
        }),
      )!;
      const implementationReference = revisionKey(
        binding.document.implementation,
      );
      const dependencyReady =
        implementationDependencyReady.get(implementationReference) ?? false;
      const routePolicyRevisionId = implementationRouteIds.get(
        implementationReference,
      );
      const [rows] = await connection.execute<IdentityRow[]>(
        `SELECT id, contract_revision_id AS contractRevisionId,
                implementation_revision_id AS implementationRevisionId, priority
         FROM capability_binding
         WHERE workspace_id = ? AND binding_key = ?
         LIMIT 1 FOR UPDATE`,
        [options.workspaceId, binding.document.bindingKey],
      );
      if (
        rows[0] &&
        (rows[0].contractRevisionId !== contractRevisionId ||
          rows[0].implementationRevisionId !== implementationRevisionId ||
          rows[0].priority !== binding.document.priority)
      ) {
        conflict(
          `Installed Capability Binding ${binding.document.bindingKey} differs from the Catalog Package.`,
        );
      }
      if (!rows[0]) {
        await connection.execute<ResultSetHeader>(
          `INSERT INTO capability_binding (
             id, workspace_id, binding_key, contract_revision_id,
             implementation_revision_id, lifecycle_status, priority, version,
             route_policy, route_policy_revision_id, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
          [
            nextId(),
            options.workspaceId,
            binding.document.bindingKey,
            contractRevisionId,
            implementationRevisionId,
            binding.document.enabled && dependencyReady ? "active" : "disabled",
            binding.document.priority,
            JSON.stringify(
              routePolicy(
                binding.document,
                adapter.document.executionTarget,
                dependencyReady,
              ),
            ),
            routePolicyRevisionId ?? null,
            now,
            now,
          ],
        );
      }
    }

    for (const workflow of prepared.workflows.values()) {
      const document = workflow.document;
      const reference = revisionKey({
        key: document.workflowKey,
        revision: document.revision,
        canonicalDigest: document.canonicalDigest,
      });
      const requiredContractIds = document.requiredCapabilities.map(
        (required) => contractIds.get(revisionKey(required))!,
      );
      const ready = await workflowDependenciesReady(
        connection,
        options.workspaceId,
        requiredContractIds,
      );
      const [definitionRows] = await connection.execute<WorkflowIdentityRow[]>(
        `SELECT id
         FROM workflow_definition
         WHERE workspace_id = ? AND workflow_key = ?
         LIMIT 1 FOR UPDATE`,
        [options.workspaceId, document.workflowKey],
      );
      let definitionId = definitionRows[0]?.id;
      if (!definitionId) {
        definitionId = nextId();
        await connection.execute<ResultSetHeader>(
          `INSERT INTO workflow_definition (
             id, workspace_id, workflow_key, display_name, description,
             category, lifecycle_status, creation_request_key,
             creation_request_hash, version, created_by_principal_id,
             updated_by_principal_id, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, 1, ?, ?, ?, ?)`,
          [
            definitionId,
            options.workspaceId,
            document.workflowKey,
            resolveLocalizedTextV1(document.displayName, "zh-CN"),
            document.description
              ? resolveLocalizedTextV1(document.description, "zh-CN")
              : null,
            document.category
              ? resolveLocalizedTextV1(document.category, "zh-CN")
              : null,
            requestKey(packageKey, packageVersion, workflow.assetKey),
            requestHash(packageDigest, workflow.digest),
            options.actorPrincipalId,
            options.actorPrincipalId,
            now,
            now,
          ],
        );
      }
      const [revisionRows] = await connection.execute<WorkflowIdentityRow[]>(
        `SELECT id, canonical_digest AS canonicalDigest
         FROM workflow_revision
         WHERE workspace_id = ? AND workflow_key = ? AND revision = ?
         LIMIT 1 FOR UPDATE`,
        [options.workspaceId, document.workflowKey, document.revision],
      );
      let workflowRevisionId = revisionRows[0]?.id;
      if (
        revisionRows[0] &&
        revisionRows[0].canonicalDigest !== document.canonicalDigest
      ) {
        conflict(
          `Installed Workflow ${document.workflowKey} differs from the Catalog Package.`,
        );
      }
      const draftId = nextId();
      if (!workflowRevisionId) {
        workflowRevisionId = nextId();
        await connection.execute<ResultSetHeader>(
          `INSERT INTO workflow_draft (
             id, workspace_id, workflow_definition_id, workflow_key,
             schema_version, content_document, canonical_digest,
             lifecycle_status, derived_from_workflow_revision_id, version,
             created_by_principal_id, updated_by_principal_id,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, 1, ?, ?, 'active', NULL, 1, ?, ?, ?, ?)`,
          [
            draftId,
            options.workspaceId,
            definitionId,
            document.workflowKey,
            JSON.stringify({
              schemaVersion: 1,
              topology: document.topology,
              inputSchema: document.inputSchema,
              outputSchema: document.outputSchema,
            }),
            document.canonicalDigest,
            options.actorPrincipalId,
            options.actorPrincipalId,
            now,
            now,
          ],
        );
        await connection.execute<ResultSetHeader>(
          `INSERT INTO workflow_revision (
             id, workspace_id, workflow_definition_id, workflow_key,
             revision, lifecycle_status, canonical_digest, topology,
             input_schema, output_schema, created_at, published_at
           ) VALUES (?, ?, ?, ?, ?, 'published', ?, ?, ?, ?, ?, ?)`,
          [
            workflowRevisionId,
            options.workspaceId,
            definitionId,
            document.workflowKey,
            document.revision,
            document.canonicalDigest,
            JSON.stringify(document.topology),
            JSON.stringify(document.inputSchema),
            JSON.stringify(document.outputSchema),
            now,
            now,
          ],
        );
        await connection.execute<ResultSetHeader>(
          `INSERT INTO workflow_revision_activation (
             workspace_id, workflow_revision_id, runtime_status,
             reason_code, version, updated_by_principal_id, updated_at
           ) VALUES (?, ?, ?, ?, 1, ?, ?)`,
          [
            options.workspaceId,
            workflowRevisionId,
            ready ? "enabled" : "disabled",
            ready ? null : "required_capability_unavailable",
            options.actorPrincipalId,
            now,
          ],
        );
      } else {
        const [draftRows] = await connection.execute<WorkflowIdentityRow[]>(
          `SELECT id
           FROM workflow_draft
           WHERE workspace_id = ? AND workflow_key = ?
           LIMIT 1 FOR SHARE`,
          [options.workspaceId, document.workflowKey],
        );
        if (!draftRows[0]) {
          conflict(
            `Installed Workflow ${document.workflowKey} lost its draft.`,
          );
        }
        workflowDraftIds.set(reference, draftRows[0].id);
      }
      workflowRevisionIds.set(reference, workflowRevisionId);
      if (!workflowDraftIds.has(reference)) {
        workflowDraftIds.set(reference, draftId);
      }
      workflowReadiness.set(reference, ready);
    }

    for (const skill of prepared.skills) {
      const document = skill.document;
      const workflowReferences = document.entrypoints.map((entrypoint) =>
        revisionKey(entrypoint.workflow),
      );
      const ready = workflowReferences.every(
        (reference) => workflowReadiness.get(reference) === true,
      );
      const [rows] = await connection.execute<WorkflowIdentityRow[]>(
        `SELECT id, canonical_digest AS canonicalDigest
         FROM skill_revision
         WHERE workspace_id = ? AND skill_key = ? AND revision = ?
         LIMIT 1 FOR UPDATE`,
        [options.workspaceId, document.skillKey, document.revision],
      );
      if (rows[0] && rows[0].canonicalDigest !== skill.digest) {
        conflict(
          `Installed Skill ${document.skillKey} differs from the Catalog Package.`,
        );
      }
      if (rows[0]) continue;
      const skillRevisionId = nextId();
      const publicationCandidateId = nextId();
      const manifestDocument = {
        schemaVersion: 1,
        skillKey: document.skillKey,
        displayName: resolveLocalizedTextV1(document.displayName, "zh-CN"),
        i18n: { displayName: document.displayName },
        nonProduction: document.nonProduction,
        entrypoints: document.entrypoints.map((entrypoint) => ({
          entrypointKey: entrypoint.entrypointKey,
          displayName: resolveLocalizedTextV1(entrypoint.displayName, "zh-CN"),
          ...(entrypoint.description
            ? {
                description: resolveLocalizedTextV1(
                  entrypoint.description,
                  "zh-CN",
                ),
              }
            : {}),
          ...(entrypoint.category
            ? {
                category: resolveLocalizedTextV1(entrypoint.category, "zh-CN"),
              }
            : {}),
          i18n: {
            displayName: entrypoint.displayName,
            ...(entrypoint.description
              ? { description: entrypoint.description }
              : {}),
            ...(entrypoint.category ? { category: entrypoint.category } : {}),
          },
          outputPresentation: entrypoint.outputPresentation,
          ...(entrypoint.inputUiSchema
            ? { inputUiSchema: entrypoint.inputUiSchema }
            : {}),
          ...(entrypoint.inputUiSchemaByLocale
            ? { inputUiSchemaByLocale: entrypoint.inputUiSchemaByLocale }
            : {}),
        })),
      };
      const candidateDocument = {
        schemaVersion: 1,
        manifest: manifestDocument,
        resources: [],
        workflowEntrypoints: document.entrypoints.map((entrypoint) => ({
          entrypointKey: entrypoint.entrypointKey,
          workflowRevisionId: workflowRevisionIds.get(
            revisionKey(entrypoint.workflow),
          )!,
        })),
      };
      const candidateDigest = digestProviderValue(candidateDocument);
      await connection.execute<ResultSetHeader>(
        `INSERT INTO publication_candidate (
           id, workspace_id, subject_kind, subject_key,
           source_draft_id, source_draft_version, schema_version,
           content_document, canonical_digest, parser_profile_version,
           created_by_principal_id, created_at
         ) VALUES (?, ?, 'skill', ?, ?, 1, 1, ?, ?,
           'catalog-package-v1', ?, ?)`,
        [
          publicationCandidateId,
          options.workspaceId,
          document.skillKey,
          workflowDraftIds.get(workflowReferences[0]!)!,
          JSON.stringify(candidateDocument),
          candidateDigest,
          options.actorPrincipalId,
          now,
        ],
      );
      await connection.execute<ResultSetHeader>(
        `INSERT INTO skill_revision (
           id, workspace_id, skill_key, revision, lifecycle_status,
           publication_candidate_id, schema_version, manifest_document,
           canonical_digest, package_digest, parser_profile_version,
           created_by_principal_id, published_by_principal_id,
           created_at, published_at
         ) VALUES (?, ?, ?, ?, 'published', ?, 1, ?, ?, ?,
           'catalog-package-v1', ?, ?, ?, ?)`,
        [
          skillRevisionId,
          options.workspaceId,
          document.skillKey,
          document.revision,
          publicationCandidateId,
          JSON.stringify(manifestDocument),
          skill.digest,
          skill.digest,
          options.actorPrincipalId,
          options.actorPrincipalId,
          now,
          now,
        ],
      );
      await connection.execute<ResultSetHeader>(
        `INSERT INTO skill_revision_activation (
           workspace_id, skill_revision_id, runtime_status, reason_code,
           version, updated_by_principal_id, updated_at
         ) VALUES (?, ?, ?, ?, 1, ?, ?)`,
        [
          options.workspaceId,
          skillRevisionId,
          ready ? "enabled" : "disabled",
          ready ? null : "required_workflow_unavailable",
          options.actorPrincipalId,
          now,
        ],
      );
      for (const [ordinal, entrypoint] of document.entrypoints.entries()) {
        await connection.execute<ResultSetHeader>(
          `INSERT INTO skill_revision_workflow_entrypoint (
             skill_revision_id, workspace_id, entrypoint_key,
             workflow_revision_id, ordinal
           ) VALUES (?, ?, ?, ?, ?)`,
          [
            skillRevisionId,
            options.workspaceId,
            entrypoint.entrypointKey,
            workflowRevisionIds.get(revisionKey(entrypoint.workflow))!,
            ordinal,
          ],
        );
      }
    }

    return Object.freeze({
      packageKey,
      packageVersion,
      packageDigest,
      installedAssets: prepared.loaded.assets.length,
    });
  });
}
