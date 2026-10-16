import {
  digestProviderValue,
  type ProviderInvocationExecutionContext,
} from "@kanvas/database/runtime";

import type { GenerationTasksImageCommand } from "./generation-tasks-image-protocol.js";
import {
  type AuthorizedProviderInvocationRequest,
  type PreparedProviderRequest,
  ProviderAdapterContractError,
  type ProviderInvocationRequest,
  type ProviderRequestPreparationRequest,
} from "./provider-adapter.js";
import type {
  WorkerInputArtifactAccess,
  WorkerInputArtifactRead,
} from "../storage/worker-input-artifact-resolver.js";

export type GenerationTasksAtomicImageOperation =
  "image.generate" | "image.edit";

export interface GenerationTasksPreparedArtifact {
  readonly role: "source" | "reference";
  readonly artifactId: string;
  readonly inputPointer: string;
}

export interface GenerationTasksPreparedResult {
  readonly outputRole:
    "generated" | "edited" | "upscaled" | "expanded" | "repaired";
  readonly artifactType:
    | "image.generated"
    | "image.edited"
    | "image.upscaled"
    | "image.expanded"
    | "image.object-removed";
  readonly sourceArtifactId?: string;
}

export interface GenerationTasksPreparedSnapshot extends Readonly<
  Record<string, unknown>
> {
  readonly schemaVersion: "kanvas.generation-tasks-image-request/v1";
  readonly adapterKey: string;
  readonly method: "POST";
  readonly path: "/generation/tasks";
  readonly operation: GenerationTasksAtomicImageOperation;
  readonly provider: {
    readonly endpointId: string;
    readonly preset: "newapi" | "tokenhub";
    readonly apiSurface: "generation.tasks" | "generation.tasks.v1";
    readonly providerModelId: string;
    readonly modelDeploymentId: string;
    readonly modelProfileRevisionId: string;
    readonly routePolicyRevisionId: string;
  };
  readonly stableRequestKey: string;
  readonly requestFingerprint: string;
  readonly body: Readonly<Record<string, unknown>> & {
    readonly model: string;
    readonly prompt: string;
    readonly response_format: "url";
  };
  readonly adapterState?: Readonly<Record<string, unknown>>;
  readonly inputArtifacts: readonly GenerationTasksPreparedArtifact[];
  readonly result: GenerationTasksPreparedResult;
}

export interface GenerationTasksPreparedRequestOptions {
  readonly adapterKey: string;
  readonly operation: GenerationTasksAtomicImageOperation;
  readonly command: GenerationTasksImageCommand;
  readonly adapterState?: Readonly<Record<string, unknown>>;
  readonly inputArtifacts: readonly GenerationTasksPreparedArtifact[];
  readonly result: GenerationTasksPreparedResult;
}

const preparedSchemaVersion = "kanvas.generation-tasks-image-request/v1";
const ulidPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const visibleAsciiPattern = /^[\x21-\x7e]+$/u;
const maximumInputArtifactBytes = 37_748_736;
const maximumAggregateInputArtifactBytes = 50_331_648;
const maximumReferenceArtifacts = 14;
const providerReadUrlLifetimeSeconds = 900;
const allowedSnapshotKeys = new Set([
  "schemaVersion",
  "adapterKey",
  "method",
  "path",
  "operation",
  "provider",
  "stableRequestKey",
  "requestFingerprint",
  "body",
  "adapterState",
  "inputArtifacts",
  "result",
]);
const allowedProviderKeys = new Set([
  "endpointId",
  "preset",
  "apiSurface",
  "providerModelId",
  "modelDeploymentId",
  "modelProfileRevisionId",
  "routePolicyRevisionId",
]);
const allowedBodyKeys = new Set([
  "model",
  "prompt",
  "n",
  "output_format",
  "response_format",
  "size",
  "aspect_ratio",
  "resolution",
  "quality",
  "output_compression",
  "seed",
]);
const allowedArtifactKeys = new Set(["role", "artifactId", "inputPointer"]);
const allowedResultKeys = new Set([
  "outputRole",
  "artifactType",
  "sourceArtifactId",
]);

function contract(message: string): never {
  throw new ProviderAdapterContractError(message);
}

function isPlainObject(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function containsAsciiControl(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127;
  });
}

function contextFor(
  request: ProviderInvocationRequest | ProviderRequestPreparationRequest,
  operation: GenerationTasksAtomicImageOperation,
): ProviderInvocationExecutionContext {
  const context = (request as ProviderRequestPreparationRequest)
    .executionContext;
  if (!context) {
    return contract(
      "Generation Tasks request preparation requires a pinned execution context.",
    );
  }
  const requestRoute = request.route;
  const contextRoute = context.route;
  const preset = context.endpoint.presetKind;
  if (
    requestRoute.providerProtocolVersion !== 1 ||
    contextRoute.providerProtocolVersion !== 1 ||
    context.endpoint.adapterKind !== "openai_compatible" ||
    (preset !== "newapi" && preset !== "tokenhub") ||
    (requestRoute.apiSurface !== "generation.tasks" &&
      requestRoute.apiSurface !== "generation.tasks.v1") ||
    contextRoute.apiSurface !== requestRoute.apiSurface ||
    requestRoute.queryMode !== "provider_request_id" ||
    contextRoute.queryMode !== "provider_request_id" ||
    requestRoute.notFoundIsAuthoritative ||
    contextRoute.notFoundIsAuthoritative ||
    (requestRoute.modelOperation !== undefined &&
      requestRoute.modelOperation !== operation) ||
    (contextRoute.modelOperation !== undefined &&
      contextRoute.modelOperation !== operation) ||
    context.endpoint.id !== requestRoute.providerEndpointId ||
    contextRoute.providerEndpointId !== requestRoute.providerEndpointId ||
    context.model.deploymentId !== requestRoute.modelDeploymentId ||
    contextRoute.modelDeploymentId !== requestRoute.modelDeploymentId ||
    context.model.modelProfileRevisionId !==
      requestRoute.modelProfileRevisionId ||
    contextRoute.modelProfileRevisionId !==
      requestRoute.modelProfileRevisionId ||
    contextRoute.routePolicyRevisionId !== requestRoute.routePolicyRevisionId
  ) {
    return contract(
      "Generation Tasks request does not match the pinned endpoint, model operation, or API surface.",
    );
  }
  return context;
}

export function assertGenerationTasksEffectiveParameters(
  request: ProviderInvocationRequest | ProviderRequestPreparationRequest,
  operation: GenerationTasksAtomicImageOperation,
  supportedKeys: ReadonlySet<string>,
): void {
  const route = request.route;
  if (route.providerProtocolVersion !== 1) {
    return contract(
      "Generation Tasks atomic image requests require Provider protocol v1.",
    );
  }
  const hasDynamicContract =
    route.modelOperation !== undefined ||
    route.parameterPolicies !== undefined ||
    route.parameterPolicyDigest !== undefined;
  if (!hasDynamicContract) {
    if (
      request.effectiveParameters &&
      Object.keys(request.effectiveParameters).length > 0
    ) {
      return contract(
        "Resolved Generation Tasks parameters require a pinned parameter policy.",
      );
    }
    return;
  }
  if (
    route.modelOperation !== operation ||
    !route.parameterPolicies ||
    !route.parameterPolicyDigest
  ) {
    return contract(
      "Generation Tasks model operation and parameter policy are incomplete.",
    );
  }
  if (
    Object.keys(request.effectiveParameters ?? {}).some(
      (key) =>
        !supportedKeys.has(key) ||
        !Object.hasOwn(route.parameterPolicies!, key),
    )
  ) {
    return contract(
      "Resolved Generation Tasks parameters contain a field outside the pinned Adapter contract.",
    );
  }
}

function canonicalBody(
  operation: GenerationTasksAtomicImageOperation,
  providerModelId: string,
  command: GenerationTasksImageCommand,
): GenerationTasksPreparedSnapshot["body"] {
  if (
    providerModelId.length < 1 ||
    providerModelId.length > 512 ||
    containsAsciiControl(providerModelId) ||
    command.prompt.length < 1 ||
    command.prompt.length > 32_000 ||
    command.image !== undefined ||
    command.images !== undefined ||
    (operation === "image.edit" &&
      (command.size !== undefined || command.numberOfImages !== undefined)) ||
    (command.size !== undefined &&
      !["auto", "1024x1024", "1536x1024", "1024x1536"].includes(
        command.size,
      )) ||
    (command.aspectRatio !== undefined &&
      ![
        "auto",
        "1:1",
        "3:2",
        "2:3",
        "4:3",
        "3:4",
        "4:5",
        "5:4",
        "16:9",
        "9:16",
        "21:9",
      ].includes(command.aspectRatio)) ||
    (command.resolution !== undefined &&
      !["1k", "2k", "4k"].includes(command.resolution)) ||
    (command.quality !== undefined &&
      !["auto", "low", "medium", "high"].includes(command.quality)) ||
    (command.outputFormat !== undefined &&
      !["png", "jpeg", "webp"].includes(command.outputFormat)) ||
    (command.outputCompression !== undefined &&
      (!Number.isSafeInteger(command.outputCompression) ||
        command.outputCompression < 0 ||
        command.outputCompression > 100)) ||
    (command.seed !== undefined &&
      (!Number.isSafeInteger(command.seed) ||
        command.seed < 0 ||
        command.seed > 4_294_967_295)) ||
    (command.numberOfImages !== undefined &&
      (!Number.isSafeInteger(command.numberOfImages) ||
        command.numberOfImages < 1 ||
        command.numberOfImages > 4))
  ) {
    return contract(
      "Generation Tasks scalar image command is outside the bounded protocol.",
    );
  }
  return Object.freeze({
    model: providerModelId,
    prompt: command.prompt,
    ...(command.numberOfImages === undefined
      ? {}
      : { n: command.numberOfImages }),
    ...(command.outputFormat === undefined
      ? {}
      : { output_format: command.outputFormat }),
    response_format: "url" as const,
    ...(command.size === undefined || command.size === "auto"
      ? {}
      : { size: command.size }),
    ...(command.aspectRatio === undefined || command.aspectRatio === "auto"
      ? {}
      : { aspect_ratio: command.aspectRatio }),
    ...(command.resolution === undefined
      ? {}
      : { resolution: command.resolution }),
    ...(command.quality === undefined ? {} : { quality: command.quality }),
    ...(command.outputCompression === undefined
      ? {}
      : { output_compression: command.outputCompression }),
    ...(command.seed === undefined ? {} : { seed: command.seed }),
  });
}

function assertCommandPolicyCoverage(
  request: ProviderInvocationRequest | ProviderRequestPreparationRequest,
  operation: GenerationTasksAtomicImageOperation,
  command: GenerationTasksImageCommand,
): void {
  const route = request.route;
  if (route.providerProtocolVersion !== 1 || !route.parameterPolicies) {
    return;
  }
  const parameterPolicies = route.parameterPolicies;
  const parameters = [
    ["size", command.size],
    ["aspectRatio", command.aspectRatio],
    ["resolution", command.resolution],
    ["quality", command.quality],
    ["outputFormat", command.outputFormat],
    ["outputCompression", command.outputCompression],
    ["numberOfImages", command.numberOfImages],
    ["seed", command.seed],
  ] as const;
  if (
    parameters.some(
      ([key, value]) =>
        value !== undefined && !Object.hasOwn(parameterPolicies, key),
    )
  ) {
    return contract(
      `Persisted Generation Tasks ${operation} request contains a scalar outside the pinned Route policy.`,
    );
  }
}

function canonicalArtifacts(
  operation: GenerationTasksAtomicImageOperation,
  values: readonly GenerationTasksPreparedArtifact[],
): readonly GenerationTasksPreparedArtifact[] {
  if (
    values.length > maximumReferenceArtifacts ||
    values.some(
      (value) =>
        !ulidPattern.test(value.artifactId) ||
        !value.inputPointer.startsWith("/") ||
        value.inputPointer.length > 512,
    ) ||
    new Set(values.map(({ artifactId }) => artifactId)).size !== values.length
  ) {
    return contract("Generation Tasks input Artifact references are invalid.");
  }
  if (
    operation === "image.edit" &&
    (values.length < 1 ||
      values[0]?.role !== "source" ||
      values[0]?.inputPointer !== "/sourceArtifactId" ||
      values
        .slice(1)
        .some(
          (value, index) =>
            value.role !== "reference" ||
            value.inputPointer !== `/referenceArtifactIds/${String(index)}`,
        ))
  ) {
    return contract(
      "Generation Tasks image.edit requires one canonical source Artifact.",
    );
  }
  if (
    operation === "image.generate" &&
    values.some(
      (value, index) =>
        value.role !== "reference" ||
        value.inputPointer !== `/referenceArtifactIds/${String(index)}`,
    )
  ) {
    return contract(
      "Generation Tasks image.generate reference Artifacts are not canonical.",
    );
  }
  return Object.freeze(
    values.map((value) =>
      Object.freeze({
        role: value.role,
        artifactId: value.artifactId,
        inputPointer: value.inputPointer,
      }),
    ),
  );
}

function canonicalResult(
  operation: GenerationTasksAtomicImageOperation,
  result: GenerationTasksPreparedResult,
  inputArtifacts: readonly GenerationTasksPreparedArtifact[],
): GenerationTasksPreparedResult {
  const validEditResults = new Map([
    ["edited", "image.edited"],
    ["upscaled", "image.upscaled"],
    ["expanded", "image.expanded"],
    ["repaired", "image.object-removed"],
  ]);
  const editArtifactRoles = new Set([
    "edited",
    "upscaled",
    "expanded",
    "repaired",
  ]);
  if (
    (operation === "image.generate" &&
      (result.outputRole !== "generated" ||
        result.artifactType !== "image.generated" ||
        result.sourceArtifactId !== undefined)) ||
    (operation === "image.edit" &&
      (!editArtifactRoles.has(result.outputRole) ||
        validEditResults.get(result.outputRole) !== result.artifactType ||
        result.sourceArtifactId !== inputArtifacts[0]?.artifactId))
  ) {
    return contract(
      "Generation Tasks output semantics do not match the image operation.",
    );
  }
  return Object.freeze({
    outputRole: result.outputRole,
    artifactType: result.artifactType,
    ...(result.sourceArtifactId
      ? { sourceArtifactId: result.sourceArtifactId }
      : {}),
  });
}

function canonicalAdapterState(
  value: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isPlainObject(value) || Object.keys(value).length > 64) {
    return contract(
      "Generation Tasks Adapter state is outside the bounded snapshot contract.",
    );
  }
  try {
    digestProviderValue(value);
    if (JSON.stringify(value).length > 65_536) {
      return contract(
        "Generation Tasks Adapter state exceeds the persisted snapshot limit.",
      );
    }
  } catch (error) {
    if (error instanceof ProviderAdapterContractError) {
      throw error;
    }
    return contract("Generation Tasks Adapter state is not canonical JSON.");
  }
  return Object.freeze({ ...value });
}

function snapshotFor(
  request: ProviderInvocationRequest | ProviderRequestPreparationRequest,
  options: GenerationTasksPreparedRequestOptions,
): GenerationTasksPreparedSnapshot {
  if (
    options.adapterKey.length < 1 ||
    options.adapterKey.length > 160 ||
    !visibleAsciiPattern.test(options.adapterKey) ||
    request.stableRequestKey.length < 1 ||
    request.stableRequestKey.length > 512 ||
    !visibleAsciiPattern.test(request.stableRequestKey) ||
    request.requestFingerprint.length < 1 ||
    request.requestFingerprint.length > 512 ||
    !visibleAsciiPattern.test(request.requestFingerprint)
  ) {
    return contract(
      "Generation Tasks request identity is outside the bounded contract.",
    );
  }
  const context = contextFor(request, options.operation);
  if (request.route.providerProtocolVersion !== 1) {
    return contract(
      "Generation Tasks prepared request requires Provider protocol v1.",
    );
  }
  const route = request.route;
  const inputArtifacts = canonicalArtifacts(
    options.operation,
    options.inputArtifacts,
  );
  const result = canonicalResult(
    options.operation,
    options.result,
    inputArtifacts,
  );
  const adapterState = canonicalAdapterState(options.adapterState);
  assertCommandPolicyCoverage(request, options.operation, options.command);
  return Object.freeze({
    schemaVersion: preparedSchemaVersion,
    adapterKey: options.adapterKey,
    method: "POST",
    path: "/generation/tasks",
    operation: options.operation,
    provider: Object.freeze({
      endpointId: context.endpoint.id,
      preset: context.endpoint.presetKind as "newapi" | "tokenhub",
      apiSurface: request.route.apiSurface as
        "generation.tasks" | "generation.tasks.v1",
      providerModelId: context.model.providerModelId,
      modelDeploymentId: context.model.deploymentId,
      modelProfileRevisionId: context.model.modelProfileRevisionId,
      routePolicyRevisionId: route.routePolicyRevisionId,
    }),
    stableRequestKey: request.stableRequestKey,
    requestFingerprint: request.requestFingerprint,
    body: canonicalBody(
      options.operation,
      context.model.providerModelId,
      options.command,
    ),
    ...(adapterState ? { adapterState } : {}),
    inputArtifacts,
    result,
  });
}

export function prepareGenerationTasksImageRequest(
  request: ProviderRequestPreparationRequest,
  options: GenerationTasksPreparedRequestOptions,
): PreparedProviderRequest {
  return Object.freeze({
    snapshot: snapshotFor(request, options),
  });
}

function parsedArtifacts(
  value: unknown,
): readonly GenerationTasksPreparedArtifact[] {
  if (!Array.isArray(value)) {
    return contract("Persisted Generation Tasks input Artifacts are invalid.");
  }
  const candidates: readonly unknown[] = value;
  const artifacts: GenerationTasksPreparedArtifact[] = [];
  for (const candidate of candidates) {
    if (
      !isPlainObject(candidate) ||
      !exactKeys(candidate, allowedArtifactKeys) ||
      (candidate.role !== "source" && candidate.role !== "reference") ||
      typeof candidate.artifactId !== "string" ||
      typeof candidate.inputPointer !== "string"
    ) {
      return contract(
        "Persisted Generation Tasks input Artifacts are invalid.",
      );
    }
    artifacts.push(
      Object.freeze({
        role: candidate.role,
        artifactId: candidate.artifactId,
        inputPointer: candidate.inputPointer,
      }),
    );
  }
  return Object.freeze(artifacts);
}

function parsedResult(value: unknown): GenerationTasksPreparedResult {
  if (
    !isPlainObject(value) ||
    !exactKeys(value, allowedResultKeys) ||
    !["generated", "edited", "upscaled", "expanded", "repaired"].includes(
      value.outputRole as string,
    ) ||
    ![
      "image.generated",
      "image.edited",
      "image.upscaled",
      "image.expanded",
      "image.object-removed",
    ].includes(value.artifactType as string) ||
    (value.sourceArtifactId !== undefined &&
      typeof value.sourceArtifactId !== "string")
  ) {
    return contract("Persisted Generation Tasks output semantics are invalid.");
  }
  return value as unknown as GenerationTasksPreparedResult;
}

function commandFromBody(
  body: Readonly<Record<string, unknown>>,
): GenerationTasksImageCommand {
  return Object.freeze({
    prompt: body.prompt as string,
    ...(typeof body.n === "number" ? { numberOfImages: body.n } : {}),
    ...(typeof body.output_format === "string"
      ? {
          outputFormat: body.output_format as Exclude<
            GenerationTasksImageCommand["outputFormat"],
            undefined
          >,
        }
      : {}),
    ...(typeof body.size === "string" ? { size: body.size } : {}),
    ...(typeof body.aspect_ratio === "string"
      ? { aspectRatio: body.aspect_ratio }
      : {}),
    ...(typeof body.resolution === "string"
      ? {
          resolution: body.resolution as Exclude<
            GenerationTasksImageCommand["resolution"],
            undefined
          >,
        }
      : {}),
    ...(typeof body.quality === "string"
      ? {
          quality: body.quality as Exclude<
            GenerationTasksImageCommand["quality"],
            undefined
          >,
        }
      : {}),
    ...(typeof body.output_compression === "number"
      ? { outputCompression: body.output_compression }
      : {}),
    ...(typeof body.seed === "number" ? { seed: body.seed } : {}),
  });
}

export function consumeGenerationTasksImageRequest(
  request: ProviderInvocationRequest,
  options: Pick<
    GenerationTasksPreparedRequestOptions,
    "adapterKey" | "operation"
  >,
): GenerationTasksPreparedSnapshot {
  const value = request.preparedRequestSnapshot;
  if (
    !isPlainObject(value) ||
    !exactKeys(value, allowedSnapshotKeys) ||
    value.schemaVersion !== preparedSchemaVersion ||
    value.adapterKey !== options.adapterKey ||
    value.method !== "POST" ||
    value.path !== "/generation/tasks" ||
    value.operation !== options.operation ||
    value.stableRequestKey !== request.stableRequestKey ||
    value.requestFingerprint !== request.requestFingerprint ||
    !isPlainObject(value.provider) ||
    !exactKeys(value.provider, allowedProviderKeys) ||
    !isPlainObject(value.body) ||
    !exactKeys(value.body, allowedBodyKeys) ||
    (value.adapterState !== undefined && !isPlainObject(value.adapterState)) ||
    !isPlainObject(value.result) ||
    typeof request.preparedRequestDigest !== "string" ||
    digestProviderValue(value) !== request.preparedRequestDigest
  ) {
    return contract(
      "Persisted Generation Tasks image request is invalid or differs from its digest.",
    );
  }
  const context = contextFor(request, options.operation);
  if (request.route.providerProtocolVersion !== 1) {
    return contract(
      "Generation Tasks persisted request requires Provider protocol v1.",
    );
  }
  const route = request.route;
  if (
    value.provider.endpointId !== context.endpoint.id ||
    value.provider.preset !== context.endpoint.presetKind ||
    value.provider.apiSurface !== request.route.apiSurface ||
    value.provider.providerModelId !== context.model.providerModelId ||
    value.provider.modelDeploymentId !== context.model.deploymentId ||
    value.provider.modelProfileRevisionId !==
      context.model.modelProfileRevisionId ||
    value.provider.routePolicyRevisionId !== route.routePolicyRevisionId ||
    value.body.model !== context.model.providerModelId ||
    value.body.response_format !== "url" ||
    typeof value.body.prompt !== "string"
  ) {
    return contract(
      "Persisted Generation Tasks image request does not match the pinned execution context.",
    );
  }
  const inputArtifacts = parsedArtifacts(value.inputArtifacts);
  const result = parsedResult(value.result);
  const reconstructed = snapshotFor(
    Object.freeze({
      ...request,
      stableRequestKey: value.stableRequestKey,
      requestFingerprint: value.requestFingerprint,
    }),
    {
      adapterKey: options.adapterKey,
      operation: options.operation,
      command: commandFromBody(value.body),
      ...(value.adapterState === undefined
        ? {}
        : { adapterState: value.adapterState }),
      inputArtifacts,
      result,
    },
  );
  if (digestProviderValue(reconstructed) !== digestProviderValue(value)) {
    return contract(
      "Persisted Generation Tasks image request is not a canonical Adapter mapping.",
    );
  }
  return value as unknown as GenerationTasksPreparedSnapshot;
}

function supportedMediaType(
  artifact: WorkerInputArtifactRead,
): "image/png" | "image/jpeg" | "image/webp" {
  if (
    artifact.mediaType === "image/png" ||
    artifact.mediaType === "image/jpeg" ||
    artifact.mediaType === "image/webp"
  ) {
    return artifact.mediaType;
  }
  return contract("Generation Tasks input Artifact media type is unsupported.");
}

function boundedArtifactByteSize(artifact: WorkerInputArtifactRead): number {
  if (!/^(?:0|[1-9][0-9]{0,19})$/u.test(artifact.byteSize)) {
    return contract("Generation Tasks input Artifact byte size is invalid.");
  }
  const value = BigInt(artifact.byteSize);
  if (value < 1n || value > BigInt(maximumInputArtifactBytes)) {
    return contract(
      "Generation Tasks input Artifact exceeds its bounded limit.",
    );
  }
  return Number(value);
}

async function readBounded(
  artifact: WorkerInputArtifactRead,
  signal: AbortSignal,
): Promise<Buffer> {
  const expectedBytes = boundedArtifactByteSize(artifact);
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of artifact.body) {
      signal.throwIfAborted();
      total += chunk.byteLength;
      if (total > maximumInputArtifactBytes) {
        return contract(
          "Generation Tasks input Artifact exceeded its bounded read limit.",
        );
      }
      chunks.push(Buffer.from(chunk));
    }
    if (total !== expectedBytes) {
      return contract(
        "Generation Tasks input Artifact body length differs from its immutable metadata.",
      );
    }
    const result = Buffer.concat(chunks, total);
    for (const chunk of chunks) {
      chunk.fill(0);
    }
    return result;
  } catch (error) {
    for (const chunk of chunks) {
      chunk.fill(0);
    }
    throw error;
  }
}

function providerHttpsReference(value: string): string {
  if (value.length < 1 || value.length > 8_192) {
    return contract("TokenHub Artifact URL is outside its bounded contract.");
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return contract("TokenHub Artifact URL is invalid.");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.hash
  ) {
    return contract(
      "TokenHub Artifact URL must be credential-free HTTPS without a fragment.",
    );
  }
  return parsed.toString();
}

function artifactAccess(
  request: AuthorizedProviderInvocationRequest,
): WorkerInputArtifactAccess {
  if (!request.inputArtifacts) {
    return contract("Generation Tasks image request requires Artifact access.");
  }
  return request.inputArtifacts;
}

export async function materializeGenerationTasksInputArtifacts(
  request: AuthorizedProviderInvocationRequest,
  snapshot: GenerationTasksPreparedSnapshot,
  signal: AbortSignal,
): Promise<{
  readonly references: readonly string[];
  readonly dispose: () => void;
}> {
  if (snapshot.inputArtifacts.length < 1) {
    return Object.freeze({
      references: Object.freeze([]),
      dispose() {},
    });
  }
  const access = artifactAccess(request);
  const sensitiveBuffers: Buffer[] = [];
  const references: string[] = [];
  let aggregateBytes = 0;
  let aggregateDeclaredBytes = 0;
  try {
    for (const expected of snapshot.inputArtifacts) {
      signal.throwIfAborted();
      const artifact = await access.open({
        inputPointer: expected.inputPointer,
      });
      if (artifact.artifactId !== expected.artifactId) {
        return contract(
          "Generation Tasks input Artifact identity differs from the persisted request snapshot.",
        );
      }
      aggregateDeclaredBytes += boundedArtifactByteSize(artifact);
      if (aggregateDeclaredBytes > maximumAggregateInputArtifactBytes) {
        return contract(
          "Generation Tasks input Artifacts exceed the aggregate request limit.",
        );
      }
      const mediaType = supportedMediaType(artifact);
      if (snapshot.provider.preset === "tokenhub") {
        const providerUrl = await artifact.createProviderReadUrl?.(
          providerReadUrlLifetimeSeconds,
        );
        if (!providerUrl) {
          return contract(
            "TokenHub image request requires a short-lived source Artifact URL.",
          );
        }
        references.push(providerHttpsReference(providerUrl));
        continue;
      }
      const bytes = await readBounded(artifact, signal);
      sensitiveBuffers.push(bytes);
      aggregateBytes += bytes.byteLength;
      if (aggregateBytes > maximumAggregateInputArtifactBytes) {
        return contract(
          "Generation Tasks input Artifacts exceed the aggregate request limit.",
        );
      }
      references.push(`data:${mediaType};base64,${bytes.toString("base64")}`);
    }
    return Object.freeze({
      references: Object.freeze(references),
      dispose() {
        for (const bytes of sensitiveBuffers) {
          bytes.fill(0);
        }
      },
    });
  } catch (error) {
    for (const bytes of sensitiveBuffers) {
      bytes.fill(0);
    }
    throw error;
  }
}

export function generationTasksCommandFromSnapshot(
  snapshot: GenerationTasksPreparedSnapshot,
  references: readonly string[],
): GenerationTasksImageCommand {
  const command = commandFromBody(snapshot.body);
  return Object.freeze({
    ...command,
    ...(references.length < 1
      ? {}
      : { images: Object.freeze([...references]) }),
  });
}
