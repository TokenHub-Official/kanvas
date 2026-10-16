import { createHash } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { TrustedWorkspaceScope } from "@kanvas/application";
import type {
  CapabilityBindingMutationResult,
  PublishCapabilityImplementationRevisionBody,
} from "@kanvas/contracts/api";
import {
  CapabilityMappingError,
  compileCapabilityMappingPlanV1,
  executeCapabilityMappingPlanV1,
  isAttemptOutputArtifactReferenceV1,
  resolveAttemptOutputArtifactReferences,
} from "@kanvas/contracts/capability";
import {
  CapabilityImplementationAdminStoreError,
  digestProviderValue,
  type CapabilityDefinitionMutation,
  type ControlPlaneAuditContext,
  type CreateCapabilityDefinitionOptions,
  type PublishCapabilityImplementationRevisionOptions,
} from "@kanvas/database/runtime";
import { Ajv2020 } from "ajv/dist/2020.js";
import { monotonicFactory } from "ulid";

import type { ServerDatabaseRuntime } from "../app.module.js";
import { DATABASE_RUNTIME } from "../tokens.js";

const nextUlid = monotonicFactory();

function authenticationReferenceHash(value: string): string {
  return `sha256:${createHash("sha256")
    .update("kanvas:capability-implementation-auth-ref:v1\0")
    .update(value)
    .digest("hex")}`;
}

function auditFor(
  scope: TrustedWorkspaceScope,
  requestId: string | undefined,
): ControlPlaneAuditContext {
  return Object.freeze({
    auditEventId: nextUlid(),
    actorPrincipalId: scope.principalId,
    actorType: scope.principalType,
    authenticationRefType: scope.authenticationRefType,
    authenticationRefHash: authenticationReferenceHash(
      scope.authenticationRefId,
    ),
    authorityType: scope.authorityType,
    authorityId: scope.authorityId,
    authorityVersion: scope.authorityVersion,
    ...(requestId ? { requestId } : {}),
  });
}

function requireIdempotencyKey(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 160) {
    throw new BadRequestException("A valid Idempotency-Key is required.");
  }
  return normalized;
}

function stableKey(
  base: string,
  role: "implementation" | "route",
  seed: string,
): string {
  const suffix = createHash("sha256").update(seed).digest("hex").slice(0, 16);
  const room = 160 - role.length - suffix.length - 2;
  const prefix = base.slice(0, room).replace(/[._:-]+$/u, "");
  return `${prefix}.${role}.${suffix}`;
}

function validator(
  schema: Readonly<Record<string, unknown>>,
): (value: unknown) => boolean {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    validateFormats: false,
  });
  const validate = ajv.compile(schema);
  return (value) => Boolean(validate(value));
}

function fixtureOutputForValidation(value: unknown): unknown {
  const coordinates = new Map<
    string,
    { outputRole: string; outputIndex: number }
  >();
  const visit = (candidate: unknown): void => {
    if (isAttemptOutputArtifactReferenceV1(candidate)) {
      coordinates.set(
        `${candidate.outputRole}\0${String(candidate.outputIndex)}`,
        {
          outputRole: candidate.outputRole,
          outputIndex: candidate.outputIndex,
        },
      );
      return;
    }
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    if (candidate && typeof candidate === "object") {
      Object.values(candidate).forEach(visit);
    }
  };
  visit(value);
  return resolveAttemptOutputArtifactReferences(
    value,
    [...coordinates.values()].map((coordinate, index) => ({
      ...coordinate,
      artifactId: `01K${String(index + 1).padStart(23, "0")}`,
    })),
  );
}

function mapError(error: unknown): never {
  if (error instanceof CapabilityMappingError) {
    throw new BadRequestException(error.message);
  }
  if (error instanceof CapabilityImplementationAdminStoreError) {
    if (error.code === "capability_implementation.not_found") {
      throw new NotFoundException(error.message);
    }
    if (
      error.code === "capability_implementation.idempotency_conflict" ||
      error.code === "capability_implementation.version_conflict" ||
      error.code === "capability_implementation.lifecycle_conflict" ||
      error.code === "capability_implementation.priority_conflict"
    ) {
      throw new ConflictException(error.message);
    }
    throw new BadRequestException(error.message);
  }
  throw error;
}

@Injectable()
export class CapabilityImplementationService {
  public constructor(
    @Inject(DATABASE_RUNTIME)
    private readonly database: ServerDatabaseRuntime,
  ) {}

  public async publish(
    scope: TrustedWorkspaceScope,
    definitionId: string,
    idempotencyKeyValue: string,
    body: PublishCapabilityImplementationRevisionBody,
    requestId?: string,
  ): Promise<CapabilityBindingMutationResult> {
    return (
      await this.persist(
        scope,
        definitionId,
        idempotencyKeyValue,
        body,
        requestId,
      )
    ).binding;
  }

  public async create(
    scope: TrustedWorkspaceScope,
    definition: CreateCapabilityDefinitionOptions,
    idempotencyKeyValue: string,
    body: PublishCapabilityImplementationRevisionBody,
    requestId?: string,
  ): Promise<
    Readonly<{
      definition: CapabilityDefinitionMutation;
      binding: CapabilityBindingMutationResult;
    }>
  > {
    const result = await this.persist(
      scope,
      definition.definitionId,
      idempotencyKeyValue,
      body,
      requestId,
      definition,
    );
    if (!result.definition) {
      throw new Error("Atomic Capability creation lost its Definition result.");
    }
    return Object.freeze({
      definition: result.definition,
      binding: result.binding,
    });
  }

  private async persist(
    scope: TrustedWorkspaceScope,
    definitionId: string,
    idempotencyKeyValue: string,
    body: PublishCapabilityImplementationRevisionBody,
    requestId?: string,
    creation?: CreateCapabilityDefinitionOptions,
  ): Promise<
    Readonly<{
      definition?: CapabilityDefinitionMutation;
      binding: CapabilityBindingMutationResult;
    }>
  > {
    const idempotencyKey = requireIdempotencyKey(idempotencyKeyValue);
    try {
      const now = new Date();
      const [definitions, adapters, bindings] = await Promise.all([
        creation
          ? Promise.resolve([])
          : this.database.capabilityDefinitions.list(scope, now),
        this.database.modelResourceImports.listPublishedRuntimeAdapters(
          scope.workspaceId,
        ),
        creation
          ? Promise.resolve([])
          : this.database.capabilityBindingAdmin.list(scope, now),
      ]);
      const definition = creation
        ? Object.freeze({
            id: creation.definitionId,
            key: creation.key,
            version: 1,
            contractRevisionId: creation.contractRevisionId,
            contractRevision: 1,
            contractDigest: creation.contractDigest,
            inputSchema: creation.inputSchema,
            outputSchema: creation.outputSchema,
          })
        : definitions.find((item) => item.id === definitionId);
      if (!definition) throw new NotFoundException("Capability was not found.");
      if (definition.version !== body.expectedDefinitionVersion) {
        throw new ConflictException(
          "Capability changed before its implementation was published.",
        );
      }
      const contract = Object.freeze({
        id: definition.contractRevisionId,
        revision: definition.contractRevision,
        canonicalDigest: definition.contractDigest,
        inputSchema: definition.inputSchema,
        outputSchema: definition.outputSchema,
      });
      const adapter = adapters.find(
        (item) => item.id === body.runtimeAdapterRevisionId,
      );
      if (!adapter) {
        throw new NotFoundException("Runtime Adapter was not found.");
      }
      if (adapter.document.selectionPolicy?.scope === "capability_private") {
        throw new BadRequestException(
          "Private Runtime Adapter cannot be selected for a manual run method.",
        );
      }

      let sourceReference: Readonly<Record<string, unknown>>;
      let sourceDigest: string;
      let modelResourceRevisionId: string | undefined;
      let expectedModelResourceRevisionDigest: string | undefined;
      let routePolicyRevisionId: string | undefined;
      const source = body.source;
      if (source.kind === "model_resource") {
        const resources = await this.database.modelResources.list(scope, now);
        const resource = resources.find(
          (item) =>
            item.revisionId === source.modelResourceRevisionId &&
            item.status === "active",
        );
        if (!resource) {
          throw new NotFoundException("Model resource revision was not found.");
        }
        if (
          !adapter.document.sourceKinds.includes("model_resource") ||
          !adapter.document.supportedModelFormats.includes(
            resource.manifest.format,
          ) ||
          !resource.manifest.nativeInterface ||
          !adapter.document.modelResourceInterfaceDigest ||
          digestProviderValue(resource.manifest.nativeInterface) !==
            adapter.document.modelResourceInterfaceDigest ||
          adapter.document.executionTarget === "provider" ||
          !resource.manifest.executionTargets.includes(
            adapter.document.executionTarget,
          )
        ) {
          throw new BadRequestException(
            "Runtime Adapter does not support this model resource interface.",
          );
        }
        modelResourceRevisionId = resource.revisionId;
        expectedModelResourceRevisionDigest = resource.revisionDigest;
        sourceDigest = resource.revisionDigest;
        sourceReference = Object.freeze({
          kind: "model_resource",
          resource: Object.freeze({
            id: resource.revisionId,
            key: resource.key,
            revision: resource.revision,
            canonicalDigest: resource.revisionDigest,
          }),
        });
      } else if (source.kind === "model_service") {
        const routes =
          await this.database.capabilityBindingAdmin.listProviderRoutes(
            scope,
            now,
          );
        const route = routes.find(
          (item) => item.routePolicyRevisionId === source.routePolicyRevisionId,
        );
        if (!route || route.availabilityReason !== "ready") {
          throw new NotFoundException("Model service route was not found.");
        }
        if (
          adapter.document.executionTarget !== "provider" ||
          !adapter.document.sourceKinds.includes("model_service")
        ) {
          throw new BadRequestException(
            "Runtime Adapter does not support model services.",
          );
        }
        const selector = adapter.document.modelServiceSelector;
        if (
          !selector ||
          selector.operation !== route.modelOperation ||
          (selector.apiSurface !== undefined &&
            selector.apiSurface !== route.apiSurface) ||
          (selector.providerPreset !== undefined &&
            selector.providerPreset !== route.providerPreset)
        ) {
          throw new BadRequestException(
            "Runtime Adapter does not support this model service operation.",
          );
        }
        routePolicyRevisionId = route.routePolicyRevisionId;
        sourceDigest = digestProviderValue({
          routePolicyRevisionId: route.routePolicyRevisionId,
          providerModelId: route.providerModelId,
          apiSurface: route.apiSurface,
          modelOperation: route.modelOperation ?? null,
        });
        sourceReference = Object.freeze({
          kind: "model_service",
          routePolicyRevisionId: route.routePolicyRevisionId,
          selector: Object.freeze({
            operation: route.modelOperation ?? definition.key,
            apiSurface: route.apiSurface,
          }),
        });
      } else {
        if (!adapter.document.sourceKinds.includes("plugin")) {
          throw new BadRequestException(
            "Runtime Adapter does not provide a built-in or plugin implementation.",
          );
        }
        const executable = adapter.document.executable;
        sourceDigest = executable.releaseDigest;
        sourceReference = Object.freeze({
          kind: "plugin",
          plugin: Object.freeze({
            key: executable.packageKey,
            revision: 1,
            canonicalDigest: executable.releaseDigest,
          }),
        });
      }

      if (
        !validator(adapter.document.configurationSchema)(body.configuration)
      ) {
        throw new BadRequestException(
          "Runtime configuration does not match the selected Adapter.",
        );
      }
      if (!validator(contract.inputSchema)(body.sampleCapabilityInput)) {
        throw new BadRequestException(
          "Capability test input does not match its public interface.",
        );
      }
      if (
        !validator(adapter.document.invocationOutputSchema)(
          body.sampleAdapterResult,
        )
      ) {
        throw new BadRequestException(
          "Adapter test result does not match its output interface.",
        );
      }

      const compiledInputMapping = compileCapabilityMappingPlanV1({
        document: body.inputMapping,
        sourceSchemas: {
          input: contract.inputSchema,
          configuration: adapter.document.configurationSchema,
        },
        targetSchema: adapter.document.invocationInputSchema,
      });
      const compiledOutputMapping = compileCapabilityMappingPlanV1({
        document: body.outputMapping,
        sourceSchemas: {
          result: adapter.document.invocationOutputSchema,
          configuration: adapter.document.configurationSchema,
        },
        targetSchema: contract.outputSchema,
      });
      const expectedAdapterInput = executeCapabilityMappingPlanV1(
        compiledInputMapping,
        {
          input: body.sampleCapabilityInput,
          configuration: body.configuration,
        },
      );
      const expectedCapabilityOutput = executeCapabilityMappingPlanV1(
        compiledOutputMapping,
        {
          result: body.sampleAdapterResult,
          configuration: body.configuration,
        },
      );
      if (
        !validator(adapter.document.invocationInputSchema)(
          expectedAdapterInput,
        ) ||
        !validator(contract.outputSchema)(
          fixtureOutputForValidation(expectedCapabilityOutput),
        )
      ) {
        throw new BadRequestException(
          "Field mapping test does not satisfy the selected interfaces.",
        );
      }

      const replacement = body.replaceBinding
        ? bindings.find(
            (binding) =>
              binding.id === body.replaceBinding?.bindingId &&
              binding.contractRevisionId === contract.id,
          )
        : undefined;
      if (body.replaceBinding && !replacement) {
        throw new NotFoundException("Capability run method was not found.");
      }
      if (
        replacement &&
        replacement.version !== body.replaceBinding?.expectedVersion
      ) {
        throw new ConflictException(
          "Capability run method changed before publication.",
        );
      }
      const implementationRevision = replacement
        ? replacement.implementationRevision + 1
        : 1;
      const implementationKey =
        replacement?.implementationKey ??
        stableKey(definition.key, "implementation", idempotencyKey);
      const bindingKey = stableKey(
        definition.key,
        "route",
        body.replaceBinding?.bindingId ?? idempotencyKey,
      );
      const priority = replacement?.priority ?? body.priority;
      const fixtureSuite = Object.freeze([
        Object.freeze({
          name: "publication sample",
          capabilityInput: body.sampleCapabilityInput,
          configuration: body.configuration,
          expectedAdapterInput,
          adapterResult: body.sampleAdapterResult,
          expectedCapabilityOutput,
        }),
      ]);
      const inputMappingDigest = digestProviderValue(compiledInputMapping);
      const outputMappingDigest = digestProviderValue(compiledOutputMapping);
      const implementationMaterial = Object.freeze({
        schemaVersion: "kanvas.capability-implementation/v1",
        implementationKey,
        revision: implementationRevision,
        displayName: body.displayName,
        ...(body.description ? { description: body.description } : {}),
        contract: Object.freeze({
          key: definition.key,
          revision: contract.revision,
          canonicalDigest: contract.canonicalDigest,
        }),
        adapter: Object.freeze({
          adapterKey: adapter.adapterKey,
          revision: adapter.revision,
          canonicalDigest: adapter.canonicalDigest,
        }),
        source: sourceReference,
        configuration: body.configuration,
        inputMapping: body.inputMapping,
        outputMapping: body.outputMapping,
        fixtures: fixtureSuite,
      });
      const canonicalDigest = digestProviderValue(implementationMaterial);
      const publicationRequestHash = digestProviderValue({
        operation: "capability_implementation.publish",
        definitionId,
        expectedDefinitionVersion: body.expectedDefinitionVersion,
        contractDigest: contract.canonicalDigest,
        adapterDigest: adapter.canonicalDigest,
        sourceDigest,
        implementation: implementationMaterial,
        priority,
        eligibility: body.eligibility,
        fallbackOn: body.fallbackOn,
        replaceBinding: body.replaceBinding ?? null,
      });
      const routePolicy = Object.freeze({
        retryPolicy: Object.freeze({
          maxAttempts: 1,
          backoff: "fixed",
          initialDelayMs: 0,
          maxDelayMs: 0,
        }),
        attemptTimeoutMs:
          adapter.document.executionTarget === "provider" ? 240_000 : 120_000,
        fallbackOn:
          body.fallbackOn.length > 0 ? Object.freeze(["not_started"]) : [],
        eligibility: body.eligibility,
      });
      const implementationOptions: PublishCapabilityImplementationRevisionOptions =
        {
          scope,
          definitionId,
          expectedDefinitionVersion: body.expectedDefinitionVersion,
          contractRevisionId: contract.id,
          runtimeAdapterRevisionId: adapter.id,
          expectedRuntimeAdapterDigest: adapter.canonicalDigest,
          implementationRevisionId: nextUlid(),
          implementationKey,
          implementationRevision,
          displayName: body.displayName,
          ...(body.description ? { description: body.description } : {}),
          executionTarget: adapter.document.executionTarget,
          adapterKey: adapter.adapterKey,
          sourceKind: source.kind,
          sourceReference,
          ...(modelResourceRevisionId ? { modelResourceRevisionId } : {}),
          ...(expectedModelResourceRevisionDigest
            ? { expectedModelResourceRevisionDigest }
            : {}),
          ...(routePolicyRevisionId ? { routePolicyRevisionId } : {}),
          canonicalDigest,
          publicationRequestKey: idempotencyKey,
          publicationRequestHash,
          configuration: body.configuration,
          inputMapping: body.inputMapping,
          inputMappingDigest,
          compiledInputMapping,
          outputMapping: body.outputMapping,
          outputMappingDigest,
          compiledOutputMapping,
          fixtureSuite,
          bindingId: nextUlid(),
          bindingKey,
          priority,
          routePolicy,
          ...(body.replaceBinding
            ? { replaceBinding: body.replaceBinding }
            : {}),
          now,
          audit: auditFor(scope, requestId),
        };
      if (creation) {
        const result =
          await this.database.capabilityDefinitions.createWithImplementation(
            creation,
            implementationOptions,
          );
        return Object.freeze({
          definition: result.definition,
          binding: Object.freeze({
            bindingId: result.implementation.bindingId,
            version: result.implementation.version,
          }),
        });
      }
      const result = await this.database.capabilityImplementations.publish(
        implementationOptions,
      );
      return Object.freeze({
        binding: Object.freeze({
          bindingId: result.bindingId,
          version: result.version,
        }),
      });
    } catch (error) {
      return mapError(error);
    }
  }
}
