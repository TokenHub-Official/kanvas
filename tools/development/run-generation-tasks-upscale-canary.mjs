import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { GenerationTasksReconstructiveUpscaleProviderAdapter } from "../../apps/worker/dist/provider/generation-tasks-image-upscale-provider.js";
import { createProviderHttpTransport } from "../../apps/worker/dist/provider/provider-http-transport.js";

const id = (value) => `01K${String(value).padStart(23, "0")}`;
const digest = (character) => `sha256:${character.repeat(64)}`;

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required canary configuration: ${name}`);
  }
  return value;
}

function exactOrigin(value, name) {
  const parsed = new URL(value);
  if (
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    parsed.protocol !== "https:"
  ) {
    throw new Error(`${name} must be an exact HTTPS origin.`);
  }
  return parsed.origin;
}

function boolean(value, name) {
  if (value === undefined || value === "false") {
    return false;
  }
  if (value === "true") {
    return true;
  }
  throw new Error(`${name} must be true or false.`);
}

const sourcePathArgument = process.argv[2]?.trim();
if (!sourcePathArgument) {
  throw new Error(
    "Usage: pnpm canary:generation-tasks-upscale -- <input-path>",
  );
}
const sourcePath = path.resolve(sourcePathArgument);
const apiOrigin = exactOrigin(
  process.env.GENERATION_TASKS_API_ORIGIN?.trim() ??
    "https://us-api.tokenhub.com",
  "GENERATION_TASKS_API_ORIGIN",
);
const assetOrigin = exactOrigin(
  required("GENERATION_TASKS_ASSET_ORIGIN"),
  "GENERATION_TASKS_ASSET_ORIGIN",
);
const providerKey =
  process.env.GENERATION_TASKS_PROVIDER_KEY?.trim() ?? "tokenhub";
const presetKind =
  process.env.GENERATION_TASKS_PRESET_KIND?.trim() ?? "tokenhub";
const modelId = process.env.GENERATION_TASKS_MODEL_ID?.trim() ?? "gpt-image-2";
if (!["newapi", "tokenhub"].includes(presetKind)) {
  throw new Error("GENERATION_TASKS_PRESET_KIND must be newapi or tokenhub.");
}
const allowPrivateNetworks = boolean(
  process.env.GENERATION_TASKS_ALLOW_PRIVATE_NETWORKS,
  "GENERATION_TASKS_ALLOW_PRIVATE_NETWORKS",
);
const credential = Buffer.from(required("GENERATION_TASKS_API_KEY"), "utf8");
const source = await readFile(sourcePath);
const currentRoute = {
  providerProtocolVersion: 1,
  providerKey,
  apiSurface: "generation.tasks.v1",
  providerEndpointId: id(1),
  credentialIdentityId: id(2),
  credentialIdentityEpoch: 1,
  pinnedSecretVersionId: id(3),
  credentialIdentityDigest: digest("a"),
  instancePolicyRevisionId: id(4),
  workspacePolicyRevisionId: id(5),
  routePolicyRevisionId: id(6),
  modelProfileRevisionId: id(7),
  modelDeploymentId: id(8),
  pricingRevisionId: id(9),
  budgetAccountId: id(10),
  routingMode: "kanvas_fixed",
  executionTransparency: "partial",
  maximumCharge: {
    currencyCode: "USD",
    amount: "1",
  },
  routeCandidateDigest: digest("b"),
  requestScopeDigest: digest("c"),
  queryMode: "provider_request_id",
  notFoundIsAuthoritative: true,
};
const executionContext = {
  invocationId: id(11),
  workspaceId: id(12),
  route: currentRoute,
  implementationConfiguration: {},
  endpoint: {
    id: currentRoute.providerEndpointId,
    adapterKind: "openai_compatible",
    presetKind,
    baseUrl: apiOrigin,
    canonicalOrigin: apiOrigin,
    regionCode: "us",
    networkPolicy: {},
    dataPolicy: {},
  },
  model: {
    deploymentId: currentRoute.modelDeploymentId,
    providerModelId: modelId,
    modelProfileRevisionId: currentRoute.modelProfileRevisionId,
    modelProfile: {},
  },
  pricing: {
    revisionId: currentRoute.pricingRevisionId,
    currencyCode: "USD",
    pricing: {
      schemaVersion: 1,
      billingMode: "fixed",
      fixedChargeAmount: "0.72",
    },
  },
  secret: {
    id: currentRoute.pinnedSecretVersionId,
    workspaceId: id(12),
    credentialId: currentRoute.credentialIdentityId,
    version: 1,
    materialGeneration: 1,
    sourceKind: "deployment_reference",
    lifecycleStatus: "active",
    aadDigest: digest("d"),
    materialFingerprint: digest("e"),
    formatVersion: 1,
    drainDeadlineAt: null,
    deploymentReference: "deployment://provider/generation-tasks",
  },
};
const transport = createProviderHttpTransport({
  allowedOrigins: [apiOrigin, assetOrigin],
  allowPrivateNetworks,
  allowHttp: false,
  maximumRequestBytes: 67_108_864,
  maximumResponseBytes: 16_777_216,
});
const adapter = new GenerationTasksReconstructiveUpscaleProviderAdapter(
  transport,
);
const input = {
  sourceArtifactId: id(20),
  qualityIntent: "reconstructive",
  scaleFactor: 2,
  guidance:
    "Preserve the source composition, identity, text and clean geometric edges. Do not add any new object.",
};
const baseRequest = {
  route: currentRoute,
  stableRequestKey: "kanvas:canary:generation-tasks-upscale:1",
  requestFingerprint: `sha256:${createHash("sha256")
    .update(source)
    .update(JSON.stringify(input))
    .digest("hex")}`,
  input,
  executionContext,
  credential,
  inputArtifacts: {
    open: async () => ({
      artifactId: id(20),
      storedObjectId: id(21),
      artifactType: "image.source",
      dataClassification: "confidential",
      byteSize: String(source.byteLength),
      sha256: createHash("sha256").update(source).digest("hex"),
      mediaType: "image/png",
      body: (async function* () {
        await Promise.resolve();
        yield source;
      })(),
    }),
  },
};

const startedAt = Date.now();
try {
  let taskId = process.env.GENERATION_TASKS_TASK_ID?.trim();
  if (taskId) {
    console.log(
      JSON.stringify(
        {
          phase: "adapter-resume",
          providerRequestId: taskId,
          elapsedMs: Date.now() - startedAt,
        },
        null,
        2,
      ),
    );
  } else {
    const submitted = await adapter.submit(
      {
        ...baseRequest,
        deadlineAt: new Date(Date.now() + 60_000),
      },
      new AbortController().signal,
    );
    console.log(
      JSON.stringify(
        {
          phase: "adapter-submit",
          status: submitted.status,
          providerRequestId: submitted.providerRequestId ?? null,
          stableErrorCode: submitted.stableErrorCode ?? null,
          elapsedMs: Date.now() - startedAt,
        },
        null,
        2,
      ),
    );
    if (!submitted.providerRequestId) {
      throw new Error("Generation Tasks submit did not return a task ID.");
    }
    taskId = submitted.providerRequestId;
  }
  let succeeded;
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    if (attempt > 1) {
      await new Promise((resolve) => setTimeout(resolve, 4_000));
    }
    const pollStartedAt = Date.now();
    try {
      const observed = await adapter.query(
        {
          ...baseRequest,
          providerRequestId: taskId,
          deadlineAt: new Date(Date.now() + 20_000),
        },
        new AbortController().signal,
      );
      console.log(
        JSON.stringify(
          {
            phase: "adapter-query",
            attempt,
            status: observed.status,
            stableErrorCode: observed.stableErrorCode ?? null,
            elapsedMs: Date.now() - pollStartedAt,
          },
          null,
          2,
        ),
      );
      if (observed.status === "succeeded") {
        succeeded = observed;
        break;
      }
      if (["failed", "cancelled", "not_found"].includes(observed.status)) {
        throw new Error(`Generation Tasks reached ${observed.status}.`);
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === "ProviderAdapterContractError"
      ) {
        throw error;
      }
      console.log(
        JSON.stringify(
          {
            phase: "adapter-query",
            attempt,
            status: "transport-error",
            stableErrorCode: error?.stableErrorCode ?? "unclassified",
            effect: error?.effect ?? null,
            elapsedMs: Date.now() - pollStartedAt,
          },
          null,
          2,
        ),
      );
    }
  }
  if (!succeeded) {
    throw new Error("Generation Tasks canary did not reach success.");
  }
  const output = succeeded.outputs?.[0];
  if (!output) {
    throw new Error("Generation Tasks canary output is missing.");
  }
  const chunks = [];
  for await (const chunk of output.body) {
    chunks.push(Buffer.from(chunk));
  }
  const bytes = Buffer.concat(chunks);
  const png =
    bytes.length >= 24 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const dimensions = png
    ? {
        width: bytes.readUInt32BE(16),
        height: bytes.readUInt32BE(20),
      }
    : null;
  const outputDirectory = path.resolve(
    "artifacts/atom-batch-01/generation-tasks",
  );
  await mkdir(outputDirectory, { recursive: true });
  const outputPath = path.join(outputDirectory, `${taskId}-upscale.png`);
  await writeFile(outputPath, bytes, { mode: 0o600 });
  console.log(
    JSON.stringify(
      {
        phase: "adapter-output",
        taskId,
        status: succeeded.status,
        mediaType: output.mediaType,
        byteSize: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        dimensions,
        outputPath,
        totalElapsedMs: Date.now() - startedAt,
        contractOutput: succeeded.output,
      },
      null,
      2,
    ),
  );
} catch (error) {
  const adapterError =
    error instanceof Error &&
    (error.name === "ProviderAdapterCallError" ||
      error.name === "ProviderAdapterContractError");
  console.error(
    JSON.stringify(
      {
        phase: "adapter-failure",
        errorClass: adapterError ? error.name : "CanaryExecutionError",
        stableErrorCode:
          adapterError &&
          "stableErrorCode" in error &&
          typeof error.stableErrorCode === "string"
            ? error.stableErrorCode
            : adapterError && "code" in error && typeof error.code === "string"
              ? error.code
              : "canary.execution_failed",
        effect:
          adapterError &&
          "effect" in error &&
          (error.effect === "not_started" || error.effect === "unknown")
            ? error.effect
            : null,
        totalElapsedMs: Date.now() - startedAt,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
} finally {
  credential.fill(0);
  source.fill(0);
}
