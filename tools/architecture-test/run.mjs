import { readFile, readdir } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

const workspaceRoot = resolve(import.meta.dirname, "../..");
const depcruise = resolve(workspaceRoot, "node_modules/.bin/depcruise");

function runDependencyCruiser(paths) {
  return spawnSync(
    depcruise,
    [
      ...paths,
      "--config",
      resolve(workspaceRoot, "dependency-cruiser.config.mjs"),
      "--output-type",
      "err",
    ],
    {
      cwd: workspaceRoot,
      encoding: "utf8",
    },
  );
}

const productionResult = runDependencyCruiser([
  "apps",
  "packages",
  "tools/scenario-validator",
]);
if (productionResult.status !== 0) {
  process.stderr.write(productionResult.stdout);
  process.stderr.write(productionResult.stderr);
  throw new Error("Production dependency graph violates architecture rules.");
}

const negativeFixtures = [
  {
    path: "architecture-fixtures/packages/application/import-database.ts",
    rule: "application-is-framework-free",
  },
  {
    path: "architecture-fixtures/packages/storage/import-nest.ts",
    rule: "storage-is-framework-free",
  },
  {
    path: "architecture-fixtures/packages/contracts/import-application.ts",
    rule: "contracts-are-leaf-authority",
  },
  {
    path: "architecture-fixtures/packages/application/import-app.ts",
    rule: "packages-and-tools-do-not-import-apps",
  },
  {
    path: "architecture-fixtures/apps/web/import-application.ts",
    rule: "web-does-not-reach-server-core",
  },
  {
    path: "architecture-fixtures/apps/server/import-worker.ts",
    rule: "server-does-not-import-other-apps",
  },
  {
    path: "architecture-fixtures/packages/application/import-scenario.ts",
    rule: "no-product-code-to-scenarios",
  },
  {
    path: "architecture-fixtures/packages/application/import-agent-runtime.ts",
    rule: "core-packages-do-not-import-agent-runtime",
  },
  {
    path: "architecture-fixtures/cycle/a.ts",
    rule: "no-circular",
  },
];

for (const fixture of negativeFixtures) {
  const result = runDependencyCruiser([fixture.path]);
  const output = `${result.stdout}\n${result.stderr}`;
  if (result.status === 0 || !output.includes(fixture.rule)) {
    throw new Error(
      `Negative architecture fixture did not trigger ${fixture.rule}: ${fixture.path}`,
    );
  }
}

async function listTypeScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listTypeScriptFiles(absolute)));
    } else if (entry.isFile() && /\.(?:ts|tsx)$/u.test(entry.name)) {
      files.push(absolute);
    }
  }
  return files;
}

function workspaceOwner(file) {
  const normalized = relative(workspaceRoot, file).split(sep).join("/");
  const match = /^(apps|packages|tools)\/([^/]+)\//u.exec(normalized);
  return match ? `${match[1]}/${match[2]}` : undefined;
}

const productAgentHardcodingPatterns = Object.freeze([
  {
    label: "Shadow planning scenario",
    pattern: /runAgentPlanningScenario/u,
  },
  {
    label: "static Shadow candidate contract",
    pattern: /KanvasShadowPlanningCandidate|KanvasShadowPlanV1/u,
  },
  {
    label: "deterministic Agent model response",
    pattern: /deterministic-shadow-v/u,
  },
  {
    label: "hardcoded Agent recommendation output",
    pattern: /recommendedCandidateKeys\s*:/u,
    agentOwnedOnly: true,
  },
  {
    label: "hardcoded Agent candidate catalog",
    pattern:
      /\bconst\s+[A-Za-z0-9_]*candidates?\s*=\s*(?:Object\.freeze\s*\()?\s*\[/iu,
    agentOwnedOnly: true,
  },
  {
    label: "message substring intent routing",
    pattern:
      /\b(?:userMessage|message|brief|prompt)\s*\.\s*(?:includes|startsWith|endsWith|match|search)\s*\(/u,
    agentOwnedOnly: true,
  },
  {
    label: "message regex intent routing",
    pattern:
      /\/[^/\n]+\/[dgimsuvy]*\.test\(\s*(?:userMessage|message|brief|prompt)\s*\)/u,
    agentOwnedOnly: true,
  },
  {
    label: "static Agent key mapping",
    pattern:
      /\bconst\s+[A-Za-z0-9_]*(?:mapping|routes?|tools?|skills?)\s*=\s*new\s+Map\s*\(\s*\[/iu,
    agentOwnedOnly: true,
  },
]);

function assertNoProductAgentSpike(file, contents) {
  const normalized = relative(workspaceRoot, file).split(sep).join("/");
  if (!/^(?:apps|packages)\/[^/]+\/src\//u.test(normalized)) {
    return;
  }
  const agentOwned =
    /(?:^|\/)agent(?:[-/.]|$)/u.test(normalized) ||
    contents.includes("@kanvas/agent-runtime");
  for (const rule of productAgentHardcodingPatterns) {
    if ((!rule.agentOwnedOnly || agentOwned) && rule.pattern.test(contents)) {
      throw new Error(
        `Product app source must not use hardcoded Agent planning logic: ${normalized} contains ${rule.label}`,
      );
    }
  }
}

const consumerLowerLayerPatterns = Object.freeze([
  /\bmodelResourceRevisionId\b/u,
  /\bruntimeAdapterRevisionId\b/u,
  /\broutePolicyRevisionId\b/u,
  /\bproviderModelId\b/u,
  /\bstorageProfileId\b/u,
  /\bimplementationRevisionId\b/u,
]);

function assertNoConsumerLowerLayerIdentity(file, contents) {
  const normalized = relative(workspaceRoot, file).split(sep).join("/");
  if (/\.(?:test|spec)\.(?:ts|tsx)$/u.test(normalized)) return;
  if (
    !/^(?:apps\/web\/src\/features\/(?:editor|workflows)|apps\/server\/src\/agent|packages\/agent-runtime\/src)\//u.test(
      normalized,
    )
  ) {
    return;
  }
  const leaked = consumerLowerLayerPatterns.find((pattern) =>
    pattern.test(contents),
  );
  if (leaked) {
    throw new Error(
      `Capability consumer must not retain lower-layer execution identity: ${normalized} contains ${String(leaked)}`,
    );
  }
}

const capabilityCoreOperationFiles = new Set([
  "apps/server/src/capabilities/capability-implementation.service.ts",
  "apps/web/src/features/capability-definitions/capability-implementation-editor.ts",
  "packages/database/src/runtime/capability-binding-admin-store.ts",
]);
const concreteProviderOperationPattern =
  /["'](?:text\.generate|image\.generate|image\.edit)["']/u;

function assertNoCapabilityCoreOperationLiteral(file, contents) {
  const normalized = relative(workspaceRoot, file).split(sep).join("/");
  if (
    capabilityCoreOperationFiles.has(normalized) &&
    concreteProviderOperationPattern.test(contents)
  ) {
    throw new Error(
      `Capability core must consume controlled Provider operations as data: ${normalized} enumerates a concrete operation`,
    );
  }
}

for (const fixture of [
  {
    label: "hardcoded planner",
    contents: `const candidates = [{ key: "fixed" }];\nrunAgentPlanningScenario();`,
  },
  {
    label: "substring intent router",
    contents: `function route(userMessage) { return userMessage.includes("poster"); }`,
  },
  {
    label: "regex intent router",
    contents: `function route(prompt) { return /poster/i.test(prompt); }`,
  },
  {
    label: "static Tool mapping",
    contents: `const toolMapping = new Map([["poster", "workflow-1"]]);`,
  },
]) {
  let triggered = false;
  try {
    assertNoProductAgentSpike(
      resolve(workspaceRoot, "apps/server/src/agent-hardcoding-fixture.ts"),
      fixture.contents,
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("hardcoded Agent planning logic")
    ) {
      triggered = true;
    } else {
      throw error;
    }
  }
  if (!triggered) {
    throw new Error(
      `Product Agent hardcoding architecture gate is inactive for ${fixture.label}.`,
    );
  }
}

let lowerLayerGateTriggered = false;
try {
  assertNoConsumerLowerLayerIdentity(
    resolve(
      workspaceRoot,
      "apps/web/src/features/editor/lower-layer-fixture.ts",
    ),
    "const runtimeAdapterRevisionId = 'fixed';",
  );
} catch (error) {
  if (
    error instanceof Error &&
    error.message.includes("must not retain lower-layer execution identity")
  ) {
    lowerLayerGateTriggered = true;
  } else {
    throw error;
  }
}
if (!lowerLayerGateTriggered) {
  throw new Error("Capability consumer lower-layer identity gate is inactive.");
}

let capabilityOperationGateTriggered = false;
try {
  assertNoCapabilityCoreOperationLiteral(
    resolve(
      workspaceRoot,
      "apps/server/src/capabilities/capability-implementation.service.ts",
    ),
    `const operation = "image.generate";`,
  );
} catch (error) {
  if (
    error instanceof Error &&
    error.message.includes(
      "must consume controlled Provider operations as data",
    )
  ) {
    capabilityOperationGateTriggered = true;
  } else {
    throw error;
  }
}
if (!capabilityOperationGateTriggered) {
  throw new Error("Capability-core Provider operation gate is inactive.");
}

for (const source of await listTypeScriptFiles(
  resolve(workspaceRoot, "apps"),
).then(async (appFiles) => [
  ...appFiles,
  ...(await listTypeScriptFiles(resolve(workspaceRoot, "packages"))),
  ...(await listTypeScriptFiles(resolve(workspaceRoot, "tools"))),
])) {
  const sourceOwner = workspaceOwner(source);
  const contents = await readFile(source, "utf8");
  assertNoProductAgentSpike(source, contents);
  assertNoConsumerLowerLayerIdentity(source, contents);
  assertNoCapabilityCoreOperationLiteral(source, contents);
  for (const match of contents.matchAll(
    /(?:from\s+|import\s*\()\s*["'](\.{1,2}\/[^"']+)["']/gu,
  )) {
    const specifier = match[1];
    if (!specifier) {
      continue;
    }
    const target = resolve(dirname(source), specifier.replace(/\.js$/u, ".ts"));
    const targetOwner = workspaceOwner(target);
    if (sourceOwner && targetOwner && sourceOwner !== targetOwner) {
      throw new Error(
        `Relative cross-workspace source import is forbidden: ${relative(
          workspaceRoot,
          source,
        )} -> ${specifier}`,
      );
    }
  }
}

process.stdout.write(
  `Architecture check passed with ${String(negativeFixtures.length)} dependency fixtures, Agent hardcoding, consumer identity, and Capability operation gates.\n`,
);
