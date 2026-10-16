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

const deploymentReference = "deployment://openai/images-primary";
const providerModelId =
  process.env.KANVAS_OPENAI_IMAGES_MODEL_ID?.trim() || "gpt-image-1.5";
const keyFileArgument = process.argv[2];
const mapFileArgument = process.argv[3];

if (!keyFileArgument) {
  throw new Error(
    "Usage: pnpm prepare:openai-images -- /absolute/path/openai-api-key [absolute/path/secret-map.json]",
  );
}

const keyFile = resolve(keyFileArgument);
if (!isAbsolute(keyFileArgument)) {
  throw new Error("The OpenAI API key file path must be absolute.");
}
const keyStat = await stat(keyFile);
if (!keyStat.isFile() || (keyStat.mode & 0o077) !== 0) {
  throw new Error(
    "The OpenAI API key must be a regular file with no group or other permissions (for example chmod 600).",
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
    "The OpenAI API key file must contain one bounded printable ASCII secret.",
  );
}
const secretMaterialFingerprint = `sha256:${createHash("sha256").update(secret).digest("hex")}`;
const authorization = `Bearer ${secret.toString("ascii")}`;
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 30_000);
let response;
try {
  response = await fetch(
    `https://api.openai.com/v1/models/${encodeURIComponent(providerModelId)}`,
    {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization,
      },
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
  throw new Error("OpenAI model validation response exceeded 1 MiB.");
}
let responseBody;
try {
  responseBody = JSON.parse(responseBytes.toString("utf8"));
} catch {
  responseBytes.fill(0);
  throw new Error(
    `OpenAI model validation returned non-JSON status ${String(response.status)}.`,
  );
}
responseBytes.fill(0);
if (
  !response.ok ||
  !responseBody ||
  typeof responseBody !== "object" ||
  Array.isArray(responseBody) ||
  responseBody.id !== providerModelId
) {
  const errorCode =
    responseBody &&
    typeof responseBody === "object" &&
    !Array.isArray(responseBody) &&
    responseBody.error &&
    typeof responseBody.error === "object" &&
    !Array.isArray(responseBody.error) &&
    typeof responseBody.error.code === "string"
      ? responseBody.error.code
      : "unavailable";
  throw new Error(
    `OpenAI model validation failed with status ${String(response.status)} and code ${errorCode}.`,
  );
}
const providerRequestId = response.headers.get("x-request-id")?.trim();
if (
  providerRequestId !== undefined &&
  providerRequestId !== null &&
  (providerRequestId.length < 1 ||
    providerRequestId.length > 512 ||
    /[^\x21-\x7e]/u.test(providerRequestId))
) {
  throw new Error(
    "OpenAI model validation returned an invalid request identity.",
  );
}
const validatedAt = new Date();

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
  if (typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  throw new Error(`Unsupported validation evidence value: ${typeof value}`);
}

const validationEvidence = Object.freeze({
  domain: "kanvas.openai-images-endpoint-validation/v1",
  endpointBaseUrl: "https://api.openai.com/v1",
  operation: "models.retrieve",
  providerModelId,
  statusCode: response.status,
  ...(providerRequestId ? { providerRequestId } : {}),
  validatedAt: validatedAt.toISOString(),
});
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
  const directory = await mkdtemp(join(tmpdir(), "kanvas-openai-images-"));
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
        KANVAS_OPENAI_IMAGES_CONTROL_PLANE_ENABLED: "true",
        KANVAS_OPENAI_IMAGES_DEPLOYMENT_REFERENCE: deploymentReference,
        KANVAS_OPENAI_IMAGES_SECRET_FINGERPRINT: secretMaterialFingerprint,
        KANVAS_OPENAI_IMAGES_ENDPOINT_VALIDATION_DIGEST:
          endpointValidationDigest,
        KANVAS_OPENAI_IMAGES_ENDPOINT_VALIDATED_AT: validatedAt.toISOString(),
        KANVAS_OPENAI_IMAGES_MODEL_ID: providerModelId,
        KANVAS_PROVIDER_DEPLOYMENT_SECRET_MAP_FILE: secretMapFile,
        KANVAS_PROVIDER_ALLOWED_ORIGINS: "https://api.openai.com",
        KANVAS_PROVIDER_ADAPTER_KEYS:
          "openai.image.upscale.reconstructive.v1,openai.image.canvas-expand.v1",
        KANVAS_PROVIDER_DEPLOYMENT_HARD_BOUNDS_JSON: JSON.stringify({
          allowedAdapterKinds: ["openai_native"],
          allowedPresetKinds: ["openai"],
          allowedRegionCodes: ["global"],
          allowedProviderEndpointIds: ["01K0000000000000000000003C"],
          allowedRoutingModes: ["kanvas_fixed"],
          allowedExecutionTransparencies: ["full"],
          maximumCharge: {
            currencyCode: "USD",
            amount: "2",
          },
          maxProviderRequestSeconds: 180,
        }),
        KANVAS_ENABLED_EXECUTION_TARGETS: "worker,browser,provider",
      },
      providerWorkerCommand:
        "node --env-file-if-exists=.env.local --env-file-if-exists=apps/worker/.env.local apps/worker/dist/main.js --roles=provider-execution,reconciler",
    },
    null,
    2,
  )}\n`,
);
