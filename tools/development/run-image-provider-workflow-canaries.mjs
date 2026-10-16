#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";

import { verifyProviderCanaryRuntime } from "./provider-canary-runtime-preflight.mjs";

const requireFromWorker = createRequire(
  new URL("../../apps/worker/package.json", import.meta.url),
);
const sharp = requireFromWorker("sharp");

const workspaceId =
  process.env.KANVAS_DEMO_WORKSPACE_ID ?? "01K00000000000000000000000";
const baseUrl = process.env.KANVAS_CANARY_BASE_URL ?? "http://127.0.0.1:3000";
const browserOrigin =
  process.env.KANVAS_AUTH_TRUSTED_ORIGINS?.split(",")
    .map((value) => value.trim())
    .find(Boolean) ?? "http://127.0.0.1:5173";
const providerWorkerBaseUrl = (
  process.env.KANVAS_PROVIDER_CANARY_WORKER_BASE_URL ?? "http://127.0.0.1:3002"
).replace(/\/+$/u, "");
const outputRoot = resolve(
  process.env.KANVAS_PROVIDER_CANARY_OUTPUT_ROOT ??
    "artifacts/atom-foundation-provider-v1",
);
const statePath = resolve(outputRoot, "canary-state.json");
const mode = process.argv.includes("--submit")
  ? "submit"
  : process.argv.includes("--prepare")
    ? "prepare"
    : "observe";
const observeMilliseconds = Number(
  process.env.KANVAS_PROVIDER_CANARY_OBSERVE_MS ?? "5000",
);
const email = process.env.KANVAS_DEV_ADMIN_EMAIL?.trim();
const password = process.env.KANVAS_DEV_ADMIN_PASSWORD;

if (
  !email ||
  !password ||
  !Number.isSafeInteger(observeMilliseconds) ||
  observeMilliseconds < 0 ||
  observeMilliseconds > 60_000
) {
  throw new Error(
    "Provider canaries require Demo credentials and KANVAS_PROVIDER_CANARY_OBSERVE_MS between 0 and 60000.",
  );
}

const workflows = Object.freeze({
  reconstructiveUpscale: Object.freeze({
    workflowRevisionId: "01K00000000000000000000035",
    outputArtifactKeys: Object.freeze(["imageArtifactId"]),
  }),
  canvasExpand: Object.freeze({
    workflowRevisionId: "01K00000000000000000000043",
    outputArtifactKeys: Object.freeze([
      "expandedArtifactId",
      "generatedRegionMaskArtifactId",
    ]),
  }),
  objectRemove: Object.freeze({
    workflowRevisionId: "01K00000000000000000000055",
    outputArtifactKeys: Object.freeze([
      "repairedArtifactId",
      "removedRegionMaskArtifactId",
    ]),
  }),
  imageGenerate: Object.freeze({
    workflowRevisionId: "01K00000000000000000000305",
    outputArtifactKeys: Object.freeze(["imageArtifactId"]),
  }),
  imageEdit: Object.freeze({
    workflowRevisionId: "01K00000000000000000000315",
    outputArtifactKeys: Object.freeze(["imageArtifactId"]),
  }),
});
const selectedWorkflowKeys = Object.freeze(
  (
    process.env.KANVAS_PROVIDER_CANARY_WORKFLOWS?.trim() ??
    Object.keys(workflows).join(",")
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
if (
  selectedWorkflowKeys.length < 1 ||
  new Set(selectedWorkflowKeys).size !== selectedWorkflowKeys.length ||
  selectedWorkflowKeys.some((key) => !(key in workflows))
) {
  throw new Error(
    `KANVAS_PROVIDER_CANARY_WORKFLOWS must contain unique workflow keys from: ${Object.keys(
      workflows,
    ).join(", ")}.`,
  );
}

if (mode === "submit") {
  await verifyProviderCanaryRuntime({
    baseUrl: providerWorkerBaseUrl,
    selectedWorkflowKeys,
  });
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

async function readState() {
  try {
    const state = JSON.parse(await readFile(statePath, "utf8"));
    if (
      !state ||
      typeof state !== "object" ||
      state.schemaVersion !== "kanvas.image-provider-canary-state/v1" ||
      typeof state.batchId !== "string" ||
      !state.runs ||
      typeof state.runs !== "object"
    ) {
      throw new Error("Provider canary state identity is invalid.");
    }
    return state;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function writeState(state) {
  await mkdir(dirname(statePath), {
    recursive: true,
  });
  const temporary = `${statePath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporary, statePath);
}

async function renderFixture() {
  const background = `
    <defs>
      <linearGradient id="wall" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#e8f0ea"/>
        <stop offset="1" stop-color="#b9cbbf"/>
      </linearGradient>
      <linearGradient id="table" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#c99f78"/>
        <stop offset="1" stop-color="#9b6f4e"/>
      </linearGradient>
      <linearGradient id="glass" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#f7faf8"/>
        <stop offset="0.5" stop-color="#b8d7ce"/>
        <stop offset="1" stop-color="#779f94"/>
      </linearGradient>
    </defs>
    <rect width="768" height="500" fill="url(#wall)"/>
    <rect y="500" width="768" height="268" fill="url(#table)"/>
    <ellipse cx="382" cy="650" rx="150" ry="28" fill="#604b3d" opacity="0.28"/>
    <rect x="322" y="260" width="124" height="348" rx="34" fill="url(#glass)" stroke="#52766d" stroke-width="8"/>
    <rect x="346" y="205" width="76" height="82" rx="12" fill="#253a36"/>
    <rect x="340" y="390" width="88" height="112" rx="8" fill="#f4eee5" opacity="0.96"/>
    <text x="384" y="430" text-anchor="middle" font-family="Arial, sans-serif" font-size="20" font-weight="700" fill="#26332f">KANVAS</text>
    <text x="384" y="461" text-anchor="middle" font-family="Arial, sans-serif" font-size="16" fill="#52625d">SERUM</text>
  `;
  const sourceSvg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="768" height="768">${background}<circle cx="620" cy="590" r="72" fill="#d83b32" stroke="#8e211d" stroke-width="8"/><ellipse cx="620" cy="675" rx="84" ry="20" fill="#604b3d" opacity="0.25"/></svg>`,
    "utf8",
  );
  const expectedSvg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="768" height="768">${background}</svg>`,
    "utf8",
  );
  const maskSvg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="768" height="768"><rect width="768" height="768" fill="black"/><polygon points="520,500 720,500 720,710 520,710" fill="white"/></svg>`,
    "utf8",
  );
  const [source, expected, mask] = await Promise.all([
    sharp(sourceSvg)
      .png({
        compressionLevel: 9,
        adaptiveFiltering: false,
      })
      .toBuffer(),
    sharp(expectedSvg)
      .png({
        compressionLevel: 9,
        adaptiveFiltering: false,
      })
      .toBuffer(),
    sharp(maskSvg)
      .png({
        compressionLevel: 9,
        adaptiveFiltering: false,
      })
      .toBuffer(),
  ]);
  sourceSvg.fill(0);
  expectedSvg.fill(0);
  maskSvg.fill(0);
  return Object.freeze({
    source,
    expected,
    mask,
  });
}

async function authenticate() {
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
  const sessionCookie = signInResponse.headers
    .getSetCookie()
    .map((candidate) => candidate.split(";", 1)[0])
    .find((candidate) => candidate.startsWith("kanvas.session_token="));
  if (!sessionCookie) {
    throw new Error("Kanvas sign-in did not return a session cookie.");
  }
  const context = await expectResponse(
    await jsonRequest("/api/v1/auth/current-human-context", {
      method: "GET",
      headers: {
        cookie: sessionCookie,
      },
    }),
    200,
  );
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
  return Object.freeze({
    sessionCookie,
    headers: Object.freeze({
      cookie: sessionCookie,
      origin: browserOrigin,
      "x-kanvas-workspace-id": workspaceId,
      "x-kanvas-csrf": context.csrfToken,
    }),
  });
}

async function commitSource(state, fixture, headers) {
  if (state.sourceArtifactId) {
    return state.sourceArtifactId;
  }
  const allocation = await expectResponse(
    await jsonRequest("/api/v1/user-import-upload-sessions", {
      method: "POST",
      headers: {
        ...headers,
        "idempotency-key": `${state.batchId}-source-import`,
      },
      body: JSON.stringify({
        expectedSize: String(fixture.source.byteLength),
        expectedMediaType: "image/png",
        expectedSha256: sha256(fixture.source),
      }),
    }),
    201,
  );
  if (
    !allocation ||
    typeof allocation !== "object" ||
    typeof allocation.uploadSessionId !== "string"
  ) {
    throw new Error(
      "Kanvas returned an invalid Provider canary upload allocation.",
    );
  }
  await expectResponse(
    await fetch(
      `${baseUrl}/api/v1/user-import-upload-sessions/${encodeURIComponent(
        allocation.uploadSessionId,
      )}/content`,
      {
        method: "PUT",
        headers: {
          accept: "application/json",
          "content-type": "image/png",
          ...headers,
        },
        body: fixture.source,
      },
    ),
    200,
  );
  const committed = await expectResponse(
    await jsonRequest(
      `/api/v1/user-import-upload-sessions/${encodeURIComponent(
        allocation.uploadSessionId,
      )}/commit`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          artifactType: "image.source",
          dataClassification: "internal",
          displayFilename: "provider-atomic-canary.png",
          metadata: {
            canary: "ATOM-FOUNDATION-01.provider-image-capabilities",
            sourceWidth: 768,
            sourceHeight: 768,
            removableObject: "red circle and shadow at x=520..720 y=500..710",
          },
        }),
      },
    ),
    200,
  );
  if (
    !committed ||
    typeof committed !== "object" ||
    typeof committed.artifactId !== "string"
  ) {
    throw new Error("Kanvas returned an invalid Provider canary Artifact.");
  }
  state.sourceArtifactId = committed.artifactId;
  await writeState(state);
  return committed.artifactId;
}

function workflowInput(key, sourceArtifactId) {
  if (key === "reconstructiveUpscale") {
    return {
      sourceArtifactId,
      qualityIntent: "reconstructive",
      scaleFactor: 2,
      guidance:
        "Preserve the bottle, label text, red circle, colors and composition. Reconstruct only faithful high-resolution detail.",
    };
  }
  if (key === "canvasExpand") {
    return {
      sourceArtifactId,
      targetWidth: 1024,
      targetHeight: 1024,
      sourcePlacement: {
        x: 128,
        y: 128,
      },
      generatedRegion: {
        left: 128,
        top: 128,
        right: 128,
        bottom: 128,
      },
      prompt:
        "Continue the pale green studio wall and wooden table naturally without adding another product.",
    };
  }
  if (key === "imageGenerate") {
    return {
      prompt:
        "A clean product photograph of a cobalt blue ceramic desk lamp on a warm white studio background, centered composition, no logos, no text.",
      aspectRatio: "1:1",
    };
  }
  if (key === "imageEdit") {
    return {
      sourceArtifactId,
      prompt:
        "Change only the red circular object to cobalt blue. Preserve the bottle, label text, table, lighting, composition, and every unrelated detail.",
    };
  }
  return {
    sourceArtifactId,
    regions: [
      {
        points: [
          { x: 520, y: 500 },
          { x: 720, y: 500 },
          { x: 720, y: 710 },
          { x: 520, y: 710 },
        ],
      },
    ],
    guidance:
      "Remove the red circular object and its local shadow. Continue only the wooden tabletop.",
  };
}

async function submitMissingRuns(state, headers) {
  for (const key of selectedWorkflowKeys) {
    const definition = workflows[key];
    if (state.runs[key]?.workflowRunId) {
      continue;
    }
    const accepted = await expectResponse(
      await jsonRequest("/api/v1/workflow-runs", {
        method: "POST",
        headers: {
          ...headers,
          "idempotency-key": `${state.batchId}-${key}`,
        },
        body: JSON.stringify({
          workflowRevisionId: definition.workflowRevisionId,
          input: workflowInput(key, state.sourceArtifactId),
        }),
      }),
      202,
    );
    if (
      !accepted ||
      typeof accepted !== "object" ||
      typeof accepted.id !== "string"
    ) {
      throw new Error(`Kanvas returned an invalid ${key} Workflow acceptance.`);
    }
    state.runs[key] = {
      workflowRevisionId: definition.workflowRevisionId,
      workflowRunId: accepted.id,
      lifecycleStatus: accepted.lifecycleStatus,
      outcome: accepted.outcome ?? null,
      output: null,
    };
    await writeState(state);
  }
}

async function downloadArtifact(artifactId, name, authentication) {
  const response = await fetch(
    `${baseUrl}/api/v1/artifacts/${encodeURIComponent(artifactId)}/content`,
    {
      method: "GET",
      headers: {
        accept: "image/png,image/jpeg,image/webp",
        cookie: authentication.sessionCookie,
        "x-kanvas-workspace-id": workspaceId,
      },
    },
  );
  if (response.status !== 200) {
    throw new Error(
      `Provider canary Artifact ${artifactId} download failed with ${String(
        response.status,
      )}.`,
    );
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const metadata = await sharp(bytes).metadata();
  if (
    !["png", "jpeg", "webp"].includes(metadata.format) ||
    !metadata.width ||
    !metadata.height
  ) {
    bytes.fill(0);
    throw new Error(
      `Provider canary Artifact ${artifactId} is not a bounded image.`,
    );
  }
  const path = resolve(outputRoot, name);
  await mkdir(dirname(path), {
    recursive: true,
  });
  await writeFile(path, bytes, {
    mode: 0o600,
  });
  return Object.freeze({
    path,
    byteSize: bytes.byteLength,
    sha256: sha256(bytes),
    width: metadata.width,
    height: metadata.height,
  });
}

async function observeRuns(state, authentication) {
  const deadline = Date.now() + observeMilliseconds;
  do {
    let terminal = 0;
    for (const key of selectedWorkflowKeys) {
      const run = state.runs[key];
      if (!run.workflowRunId) {
        continue;
      }
      if (["completed", "failed", "cancelled"].includes(run.lifecycleStatus)) {
        terminal += 1;
        continue;
      }
      const current = await expectResponse(
        await jsonRequest(
          `/api/v1/workflow-runs/${encodeURIComponent(run.workflowRunId)}`,
          {
            method: "GET",
            headers: authentication.headers,
          },
        ),
        200,
      );
      run.lifecycleStatus = current.lifecycleStatus;
      run.outcome = current.outcome ?? null;
      run.output = current.output ?? null;
      if (["completed", "failed", "cancelled"].includes(run.lifecycleStatus)) {
        terminal += 1;
      }
      state.runs[key] = run;
      await writeState(state);
    }
    if (terminal === selectedWorkflowKeys.length || Date.now() >= deadline) {
      break;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
  } while (Date.now() <= deadline);

  for (const key of selectedWorkflowKeys) {
    const definition = workflows[key];
    const run = state.runs[key];
    if (
      !run ||
      run.lifecycleStatus !== "completed" ||
      run.outcome !== "full_success" ||
      !run.output ||
      run.downloads
    ) {
      continue;
    }
    const downloads = {};
    for (const artifactKey of definition.outputArtifactKeys) {
      const artifactId = run.output[artifactKey];
      if (typeof artifactId !== "string") {
        throw new Error(
          `Provider canary ${key} output is missing ${artifactKey}.`,
        );
      }
      downloads[artifactKey] = await downloadArtifact(
        artifactId,
        `${key}/${artifactKey}.png`,
        authentication,
      );
    }
    run.downloads = downloads;
    state.runs[key] = run;
    await writeState(state);
  }
}

await mkdir(outputRoot, {
  recursive: true,
});
let state = await readState();
if (!state) {
  if (mode !== "submit" && mode !== "prepare") {
    throw new Error(
      "No Provider canary state exists. Use --prepare to commit the source without external side effects, or --submit after the control plane and Provider Worker are ready.",
    );
  }
  const batchId = `provider-image-capabilities-${randomUUID()}`;
  state = {
    schemaVersion: "kanvas.image-provider-canary-state/v1",
    batchId,
    createdAt: new Date().toISOString(),
    sourceArtifactId: null,
    source: null,
    runs: Object.fromEntries(
      Object.keys(workflows).map((key) => [
        key,
        {
          workflowRevisionId: workflows[key].workflowRevisionId,
          workflowRunId: null,
          lifecycleStatus: "not_submitted",
          outcome: null,
          output: null,
        },
      ]),
    ),
  };
  await writeState(state);
}

const fixture = await renderFixture();
try {
  const sourcePath = resolve(outputRoot, "source.png");
  const expectedPath = resolve(outputRoot, "object-remove/expected.png");
  const maskPath = resolve(outputRoot, "object-remove/mask.png");
  await mkdir(dirname(expectedPath), {
    recursive: true,
  });
  await Promise.all([
    writeFile(sourcePath, fixture.source),
    writeFile(expectedPath, fixture.expected),
    writeFile(maskPath, fixture.mask),
  ]);
  state.source = {
    path: sourcePath,
    byteSize: fixture.source.byteLength,
    sha256: sha256(fixture.source),
    width: 768,
    height: 768,
  };
  await writeState(state);

  const authentication = await authenticate();
  if (mode === "submit" || mode === "prepare") {
    await commitSource(state, fixture, authentication.headers);
  }
  if (mode === "submit") {
    await submitMissingRuns(state, authentication.headers);
  }
  if (mode !== "prepare") {
    await observeRuns(state, authentication);
  }
} finally {
  fixture.source.fill(0);
  fixture.expected.fill(0);
  fixture.mask.fill(0);
}

process.stdout.write(
  `${JSON.stringify(
    {
      statePath,
      batchId: state.batchId,
      sourceArtifactId: state.sourceArtifactId,
      runs: Object.fromEntries(
        Object.entries(state.runs).map(([key, run]) => [
          key,
          {
            workflowRunId: run.workflowRunId,
            lifecycleStatus: run.lifecycleStatus,
            outcome: run.outcome,
            output: run.output,
            downloads: run.downloads ?? null,
          },
        ]),
      ),
    },
    null,
    2,
  )}\n`,
);
