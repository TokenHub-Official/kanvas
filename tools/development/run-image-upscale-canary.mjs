#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { createRequire } from "node:module";

const requireFromWorker = createRequire(
  new URL("../../apps/worker/package.json", import.meta.url),
);
const sharp = requireFromWorker("sharp");

const workspaceId =
  process.env.KANVAS_DEMO_WORKSPACE_ID ?? "01K00000000000000000000000";
const workflowRevisionId = "01K00000000000000000000035";
const baseUrl = process.env.KANVAS_CANARY_BASE_URL ?? "http://127.0.0.1:3000";
const browserOrigin =
  process.env.KANVAS_AUTH_TRUSTED_ORIGINS?.split(",")
    .map((value) => value.trim())
    .find(Boolean) ?? "http://127.0.0.1:5173";
const inputPathArgument = process.argv[2]?.trim();
if (!inputPathArgument) {
  throw new Error("Usage: pnpm canary:upscale -- <input-path> [output-path]");
}
const inputPath = resolve(inputPathArgument);
const outputPath = resolve(
  process.argv[3] ?? "artifacts/atom-batch-01/upscale-faithful-e2e.png",
);
const email = process.env.KANVAS_DEV_ADMIN_EMAIL?.trim();
const password = process.env.KANVAS_DEV_ADMIN_PASSWORD;

if (!email || !password) {
  throw new Error(
    "The faithful upscale canary requires KANVAS_DEV_ADMIN_EMAIL and KANVAS_DEV_ADMIN_PASSWORD.",
  );
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function responseBody(response) {
  const text = await response.text();
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function expectResponse(response, expectedStatus) {
  const body = await responseBody(response);
  if (response.status !== expectedStatus) {
    throw new Error(
      `Kanvas API ${response.status} ${response.statusText}: ${JSON.stringify(body)}`,
    );
  }
  return body;
}

async function jsonRequest(path, options) {
  return await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      accept: "application/json",
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...options.headers,
    },
  });
}

const signInResponse = await jsonRequest("/api/auth/sign-in/email", {
  method: "POST",
  headers: {
    origin: browserOrigin,
  },
  body: JSON.stringify({
    email,
    password,
    rememberMe: false,
  }),
});
await expectResponse(signInResponse, 200);
const cookies = signInResponse.headers.getSetCookie();
const sessionCookie = cookies
  .map((candidate) => candidate.split(";", 1)[0])
  .find((candidate) => candidate.startsWith("kanvas.session_token="));
if (!sessionCookie) {
  throw new Error("Kanvas sign-in did not return a session cookie.");
}

const contextResponse = await jsonRequest(
  "/api/v1/auth/current-human-context",
  {
    method: "GET",
    headers: {
      cookie: sessionCookie,
    },
  },
);
const context = await expectResponse(contextResponse, 200);
if (
  !context ||
  typeof context !== "object" ||
  typeof context.csrfToken !== "string" ||
  !Array.isArray(context.workspaces) ||
  !context.workspaces.some((workspace) => workspace.id === workspaceId)
) {
  throw new Error(
    "The authenticated Human context cannot access the Demo Workspace.",
  );
}

const source = await readFile(inputPath);
const sourceMetadata = await sharp(source).metadata();
if (
  sourceMetadata.format !== "png" ||
  !sourceMetadata.width ||
  !sourceMetadata.height
) {
  throw new Error(
    "The faithful upscale canary currently requires a decodable PNG source.",
  );
}
const runKey = `upscale-faithful-${randomUUID()}`;
const workspaceHeaders = {
  cookie: sessionCookie,
  origin: browserOrigin,
  "x-kanvas-workspace-id": workspaceId,
  "x-kanvas-csrf": context.csrfToken,
};

const allocationResponse = await jsonRequest(
  "/api/v1/user-import-upload-sessions",
  {
    method: "POST",
    headers: {
      ...workspaceHeaders,
      "idempotency-key": `${runKey}-import`,
    },
    body: JSON.stringify({
      expectedSize: String(source.byteLength),
      expectedMediaType: "image/png",
      expectedSha256: sha256(source),
    }),
  },
);
const allocation = await expectResponse(allocationResponse, 201);
if (
  !allocation ||
  typeof allocation !== "object" ||
  typeof allocation.uploadSessionId !== "string"
) {
  throw new Error("Kanvas returned an invalid upload allocation.");
}

const uploadResponse = await fetch(
  `${baseUrl}/api/v1/user-import-upload-sessions/${encodeURIComponent(
    allocation.uploadSessionId,
  )}/content`,
  {
    method: "PUT",
    headers: {
      accept: "application/json",
      "content-type": "image/png",
      ...workspaceHeaders,
    },
    body: source,
  },
);
await expectResponse(uploadResponse, 200);

const commitResponse = await jsonRequest(
  `/api/v1/user-import-upload-sessions/${encodeURIComponent(
    allocation.uploadSessionId,
  )}/commit`,
  {
    method: "POST",
    headers: workspaceHeaders,
    body: JSON.stringify({
      artifactType: "image.source",
      dataClassification: "internal",
      displayFilename: basename(inputPath),
      metadata: {
        canary: "ATOM-BATCH-01.image.upscale.faithful",
        sourceWidth: sourceMetadata.width,
        sourceHeight: sourceMetadata.height,
      },
    }),
  },
);
const committed = await expectResponse(commitResponse, 200);
if (
  !committed ||
  typeof committed !== "object" ||
  typeof committed.artifactId !== "string"
) {
  throw new Error("Kanvas returned an invalid committed Artifact.");
}

const createResponse = await jsonRequest("/api/v1/workflow-runs", {
  method: "POST",
  headers: {
    ...workspaceHeaders,
    "idempotency-key": `${runKey}-workflow`,
  },
  body: JSON.stringify({
    workflowRevisionId,
    input: {
      sourceArtifactId: committed.artifactId,
      qualityIntent: "faithful",
      scaleFactor: 2,
    },
  }),
});
const accepted = await expectResponse(createResponse, 202);
if (
  !accepted ||
  typeof accepted !== "object" ||
  typeof accepted.id !== "string"
) {
  throw new Error("Kanvas returned an invalid Workflow acceptance.");
}

const deadline = Date.now() + 180_000;
let run;
while (Date.now() < deadline) {
  const response = await jsonRequest(
    `/api/v1/workflow-runs/${encodeURIComponent(accepted.id)}`,
    {
      method: "GET",
      headers: workspaceHeaders,
    },
  );
  run = await expectResponse(response, 200);
  if (
    run &&
    typeof run === "object" &&
    ["completed", "failed", "cancelled"].includes(run.lifecycleStatus)
  ) {
    break;
  }
  await new Promise((resolveWait) => setTimeout(resolveWait, 500));
}
if (
  !run ||
  typeof run !== "object" ||
  run.lifecycleStatus !== "completed" ||
  run.outcome !== "full_success" ||
  !run.output ||
  typeof run.output !== "object" ||
  typeof run.output.imageArtifactId !== "string"
) {
  throw new Error(
    `Faithful upscale Workflow did not succeed: ${JSON.stringify(run)}`,
  );
}

const downloadResponse = await fetch(
  `${baseUrl}/api/v1/artifacts/${encodeURIComponent(
    run.output.imageArtifactId,
  )}/content`,
  {
    method: "GET",
    headers: {
      accept: "image/png",
      cookie: sessionCookie,
      "x-kanvas-workspace-id": workspaceId,
    },
  },
);
if (downloadResponse.status !== 200) {
  throw new Error(
    `Upscaled Artifact download failed with ${String(downloadResponse.status)}.`,
  );
}
const output = Buffer.from(await downloadResponse.arrayBuffer());
const outputMetadata = await sharp(output).metadata();
if (
  outputMetadata.format !== "png" ||
  outputMetadata.width !== sourceMetadata.width * 2 ||
  outputMetadata.height !== sourceMetadata.height * 2 ||
  run.output.sourceWidth !== sourceMetadata.width ||
  run.output.sourceHeight !== sourceMetadata.height ||
  run.output.outputWidth !== outputMetadata.width ||
  run.output.outputHeight !== outputMetadata.height ||
  run.output.qualitySignals?.method !== "deterministic_resample" ||
  run.output.qualitySignals?.resamplingKernel !== "lanczos3" ||
  run.output.qualitySignals?.generative !== false
) {
  throw new Error(
    "Faithful upscale output dimensions or quality facts are inconsistent.",
  );
}
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, output);

process.stdout.write(
  `${JSON.stringify(
    {
      schemaVersion: 1,
      canary: "ATOM-BATCH-01.image.upscale.faithful",
      workflowRunId: accepted.id,
      sourceArtifactId: committed.artifactId,
      outputArtifactId: run.output.imageArtifactId,
      source: {
        path: inputPath,
        width: sourceMetadata.width,
        height: sourceMetadata.height,
        byteSize: String(source.byteLength),
        sha256: sha256(source),
      },
      output: {
        path: outputPath,
        width: outputMetadata.width,
        height: outputMetadata.height,
        byteSize: String(output.byteLength),
        sha256: sha256(output),
      },
      qualitySignals: run.output.qualitySignals,
    },
    null,
    2,
  )}\n`,
);
