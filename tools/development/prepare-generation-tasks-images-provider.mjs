#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

const commandArguments = process.argv
  .slice(2)
  .filter((value) => value !== "--");
const keyFileArgument = commandArguments[0];
const mapFileArgument =
  commandArguments.length >= 3 ? commandArguments[1] : undefined;
const validationTaskId =
  (commandArguments.length >= 3 ? commandArguments[2] : commandArguments[1]) ??
  process.env.KANVAS_GENERATION_TASKS_VALIDATION_TASK_ID?.trim();
const presetKind =
  process.env.KANVAS_GENERATION_TASKS_IMAGES_PRESET_KIND?.trim() ?? "tokenhub";
const providerKey =
  process.env.KANVAS_GENERATION_TASKS_IMAGES_PROVIDER_KEY?.trim() ?? presetKind;
const providerModelId =
  process.env.KANVAS_GENERATION_TASKS_IMAGES_MODEL_ID?.trim() ?? "gpt-image-2";
const regionCode =
  process.env.KANVAS_GENERATION_TASKS_IMAGES_REGION_CODE?.trim() ??
  (presetKind === "tokenhub" ? "us" : "private");
const deploymentReference =
  process.env.KANVAS_GENERATION_TASKS_IMAGES_DEPLOYMENT_REFERENCE?.trim() ??
  `deployment://${providerKey}/images-primary`;
const apiOrigin = new URL(
  process.env.KANVAS_GENERATION_TASKS_IMAGES_API_ORIGIN?.trim() ??
    "https://us-api.tokenhub.com",
);
const fixedChargeAmount =
  process.env.KANVAS_GENERATION_TASKS_IMAGES_FIXED_CHARGE_AMOUNT?.trim();
const fixedPricingEvidenceReference =
  process.env.KANVAS_GENERATION_TASKS_IMAGES_PRICING_EVIDENCE_REFERENCE?.trim();
const fixedPricingEvidenceDigest =
  process.env.KANVAS_GENERATION_TASKS_IMAGES_PRICING_EVIDENCE_DIGEST?.trim();

if (
  !keyFileArgument ||
  !validationTaskId ||
  !["newapi", "tokenhub"].includes(presetKind)
) {
  throw new Error(
    "Usage: prepare:generation-tasks-images -- /absolute/path/api-key [absolute/path/secret-map.json] validation-task-id",
  );
}
if (
  !fixedChargeAmount ||
  !/^(?:0|[1-9][0-9]{0,23})(?:\.[0-9]{1,12})?$/u.test(fixedChargeAmount) ||
  fixedChargeAmount === "0" ||
  !fixedPricingEvidenceReference ||
  !/^[\x20-\x7e]{1,512}$/u.test(fixedPricingEvidenceReference) ||
  !fixedPricingEvidenceDigest ||
  !/^sha256:[0-9a-f]{64}$/u.test(fixedPricingEvidenceDigest)
) {
  throw new Error(
    "Generation Tasks preparation requires a positive fixed charge and canonical pricing evidence.",
  );
}

if (
  apiOrigin.protocol !== "https:" ||
  apiOrigin.username ||
  apiOrigin.password ||
  apiOrigin.pathname !== "/" ||
  apiOrigin.search ||
  apiOrigin.hash
) {
  throw new Error("Generation Tasks API origin must be an exact HTTPS origin.");
}
if (
  !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(providerKey) ||
  !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(providerModelId) ||
  !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u.test(regionCode) ||
  !/^deployment:\/\/[A-Za-z0-9][A-Za-z0-9._/-]{0,479}$/u.test(
    deploymentReference,
  ) ||
  !/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/u.test(validationTaskId)
) {
  throw new Error(
    "Generation Tasks provider identity, deployment reference, or validation task ID is invalid.",
  );
}
if (!isAbsolute(keyFileArgument)) {
  throw new Error("The Generation Tasks API key file path must be absolute.");
}
const keyFile = resolve(keyFileArgument);
const keyStat = await stat(keyFile);
if (!keyStat.isFile() || (keyStat.mode & 0o077) !== 0) {
  throw new Error(
    "The Generation Tasks API key must be a regular mode-0600 file.",
  );
}
const keyBytes = await readFile(keyFile);
let start = 0;
let end = keyBytes.length;
while (start < end && [9, 10, 13, 32].includes(keyBytes[start])) {
  start += 1;
}
while (end > start && [9, 10, 13, 32].includes(keyBytes[end - 1])) {
  end -= 1;
}
const secret = keyBytes.subarray(start, end);
if (
  secret.byteLength < 20 ||
  secret.byteLength > 4_096 ||
  [...secret].some((byte) => byte < 0x21 || byte > 0x7e)
) {
  keyBytes.fill(0);
  throw new Error(
    "The Generation Tasks API key must contain one bounded printable ASCII secret.",
  );
}
const secretMaterialFingerprint = `sha256:${createHash("sha256")
  .update(secret)
  .digest("hex")}`;
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 30_000);
let response;
try {
  response = await fetch(
    `${apiOrigin.origin}/generation/tasks/${encodeURIComponent(
      validationTaskId,
    )}`,
    {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${secret.toString("ascii")}`,
      },
      redirect: "error",
      signal: controller.signal,
    },
  );
} finally {
  clearTimeout(timeout);
  keyBytes.fill(0);
}
const responseBytes = Buffer.from(await response.arrayBuffer());
if (responseBytes.byteLength > 1_048_576) {
  responseBytes.fill(0);
  throw new Error("Generation Tasks validation response exceeded 1 MiB.");
}
let responseBody;
try {
  responseBody = JSON.parse(responseBytes.toString("utf8"));
} catch {
  responseBytes.fill(0);
  throw new Error(
    `Generation Tasks validation returned non-JSON status ${String(
      response.status,
    )}.`,
  );
}
responseBytes.fill(0);
const taskData =
  responseBody &&
  typeof responseBody === "object" &&
  !Array.isArray(responseBody) &&
  responseBody.code === "success" &&
  responseBody.data &&
  typeof responseBody.data === "object" &&
  !Array.isArray(responseBody.data)
    ? responseBody.data
    : undefined;
if (
  !response.ok ||
  !taskData ||
  taskData.task_id !== validationTaskId ||
  !["queued", "processing", "succeeded", "failed"].includes(taskData.status)
) {
  throw new Error(
    `Generation Tasks credential validation failed with status ${String(
      response.status,
    )}.`,
  );
}
function collectResultOrigins(value, origins) {
  if (typeof value === "string") {
    try {
      const url = new URL(value);
      if (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        url.origin !== apiOrigin.origin
      ) {
        origins.add(url.origin);
      }
    } catch {
      // Non-URL response strings are ignored.
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectResultOrigins(item, origins);
    }
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      collectResultOrigins(item, origins);
    }
  }
}

const resultOrigins = new Set();
collectResultOrigins(taskData, resultOrigins);
const configuredResultOrigins = (
  process.env.KANVAS_GENERATION_TASKS_RESULT_ORIGINS?.trim() ?? ""
)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
for (const value of configuredResultOrigins) {
  const origin = new URL(value);
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  ) {
    throw new Error(
      "Configured Generation Tasks result origins must be exact HTTPS origins.",
    );
  }
  resultOrigins.add(origin.origin);
}
if (taskData.status === "succeeded" && resultOrigins.size < 1) {
  throw new Error(
    "A succeeded validation task must expose or configure at least one exact result origin.",
  );
}

function canonicalJson(value) {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  throw new Error(`Unsupported validation evidence value: ${typeof value}`);
}

const validatedAt = new Date();
const validationEvidence = {
  domain: "kanvas.generation-tasks-images-endpoint-validation/v1",
  apiOrigin: apiOrigin.origin,
  operation: "generation.tasks.retrieve",
  presetKind,
  providerKey,
  validationTaskId,
  observedStatus: taskData.status,
  statusCode: response.status,
  resultOrigins: [...resultOrigins].sort(),
  validatedAt: validatedAt.toISOString(),
};
const endpointValidationDigest = `sha256:${createHash("sha256")
  .update(canonicalJson(validationEvidence))
  .digest("hex")}`;
let secretMapFile;
if (mapFileArgument) {
  if (!isAbsolute(mapFileArgument)) {
    throw new Error("The Provider secret-map path must be absolute.");
  }
  secretMapFile = resolve(mapFileArgument);
  await mkdir(dirname(secretMapFile), {
    recursive: true,
    mode: 0o700,
  });
} else {
  const directory = await mkdtemp(
    join(tmpdir(), "kanvas-generation-tasks-images-"),
  );
  await chmod(directory, 0o700);
  secretMapFile = join(directory, "secret-map.json");
}
await writeFile(
  secretMapFile,
  `${JSON.stringify(
    {
      [deploymentReference]: keyFile,
    },
    null,
    2,
  )}\n`,
  {
    encoding: "utf8",
    mode: 0o600,
  },
);
await chmod(secretMapFile, 0o600);

process.stdout.write(
  `${JSON.stringify(
    {
      schemaVersion: 1,
      validationEvidence,
      environment: {
        KANVAS_GENERATION_TASKS_IMAGES_CONTROL_PLANE_ENABLED: "true",
        KANVAS_GENERATION_TASKS_IMAGES_PRESET_KIND: presetKind,
        KANVAS_GENERATION_TASKS_IMAGES_PROVIDER_KEY: providerKey,
        KANVAS_GENERATION_TASKS_IMAGES_API_ORIGIN: apiOrigin.origin,
        KANVAS_GENERATION_TASKS_IMAGES_REGION_CODE: regionCode,
        KANVAS_GENERATION_TASKS_IMAGES_MODEL_ID: providerModelId,
        KANVAS_GENERATION_TASKS_IMAGES_DEPLOYMENT_REFERENCE:
          deploymentReference,
        KANVAS_GENERATION_TASKS_IMAGES_SECRET_FINGERPRINT:
          secretMaterialFingerprint,
        KANVAS_GENERATION_TASKS_IMAGES_ENDPOINT_VALIDATION_DIGEST:
          endpointValidationDigest,
        KANVAS_GENERATION_TASKS_IMAGES_ENDPOINT_VALIDATED_AT:
          validatedAt.toISOString(),
        KANVAS_GENERATION_TASKS_IMAGES_FIXED_CHARGE_AMOUNT: fixedChargeAmount,
        KANVAS_GENERATION_TASKS_IMAGES_PRICING_EVIDENCE_REFERENCE:
          fixedPricingEvidenceReference,
        KANVAS_GENERATION_TASKS_IMAGES_PRICING_EVIDENCE_DIGEST:
          fixedPricingEvidenceDigest,
        KANVAS_PROVIDER_DEPLOYMENT_SECRET_MAP_FILE: secretMapFile,
        KANVAS_PROVIDER_ALLOWED_ORIGINS: apiOrigin.origin,
        KANVAS_PROVIDER_RESULT_DOWNLOADS_ENABLED: "true",
        KANVAS_PROVIDER_RESULT_ALLOWED_ORIGINS: resultOrigins.join(","),
        KANVAS_PROVIDER_ADAPTER_KEYS:
          "generation-tasks.image.upscale.reconstructive.v1,generation-tasks.image.canvas-expand.v1,generation-tasks.image.object-remove.v1",
        KANVAS_PROVIDER_DEPLOYMENT_HARD_BOUNDS_JSON: JSON.stringify({
          allowedAdapterKinds: ["openai_compatible"],
          allowedPresetKinds: [presetKind],
          allowedRegionCodes: [regionCode],
          allowedProviderEndpointIds: ["01K0000000000000000000004C"],
          allowedRoutingModes: ["gateway_managed"],
          allowedExecutionTransparencies: ["partial"],
          maximumCharge: {
            currencyCode: "USD",
            amount: "1",
          },
          maxProviderRequestSeconds: 300,
        }),
        KANVAS_ENABLED_EXECUTION_TARGETS: "worker,browser,provider",
      },
      providerWorkerCommand:
        "KANVAS_WORKER_HEALTH_PORT=3002 node --env-file-if-exists=.env.local --env-file-if-exists=apps/worker/.env.local apps/worker/dist/main.js --roles=provider-execution,reconciler",
    },
    null,
    2,
  )}\n`,
);
