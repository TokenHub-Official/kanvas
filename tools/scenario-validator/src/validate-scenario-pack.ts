import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";

import { isWorkflowTopology } from "@kanvas/contracts/workflow";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";

import {
  ScenarioPackManifestSchema,
  type ScenarioPackManifest,
} from "./manifest-schema.js";

const allowedExtensions = new Set([
  ".json",
  ".md",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
]);
const forbiddenExtensions = new Set([
  ".cjs",
  ".js",
  ".mjs",
  ".py",
  ".sh",
  ".ts",
  ".tsx",
]);

export interface ScenarioValidationResult {
  readonly valid: boolean;
  readonly diagnostics: readonly string[];
}

function canonicalize(value: unknown): string {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string" ||
    typeof value === "number"
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    return `{${Object.entries(value as Readonly<Record<string, unknown>>)
      .sort(([left], [right]) => {
        if (left < right) {
          return -1;
        }
        return left > right ? 1 : 0;
      })
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
      .join(",")}}`;
  }
  throw new TypeError(
    `Scenario content contains unsupported JSON type ${typeof value}.`,
  );
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(canonicalize(value))
    .digest("hex")}`;
}

async function listFiles(root: string, directory = root): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolutePath = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Symbolic links are not allowed: ${entry.name}`);
    }
    if (entry.isDirectory()) {
      files.push(...(await listFiles(root, absolutePath)));
    } else if (entry.isFile()) {
      files.push(relative(root, absolutePath).split(sep).join("/"));
    }
  }
  return files.sort();
}

export async function validateScenarioPack(
  packDirectory: string,
): Promise<ScenarioValidationResult> {
  const diagnostics: string[] = [];
  const root = resolve(packDirectory);
  const manifestPath = resolve(root, "manifest.json");

  try {
    if (!(await stat(manifestPath)).isFile()) {
      diagnostics.push("manifest.json must be a regular file.");
    }
  } catch {
    return {
      valid: false,
      diagnostics: ["manifest.json is missing."],
    };
  }

  let manifest: ScenarioPackManifest | undefined;
  try {
    const value: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
    const ajv = new Ajv2020({
      strict: true,
      allErrors: true,
      coerceTypes: false,
      removeAdditional: false,
      useDefaults: false,
    });
    const validate: ValidateFunction<ScenarioPackManifest> = ajv.compile(
      ScenarioPackManifestSchema,
    );
    if (!validate(value)) {
      diagnostics.push(
        ...(validate.errors ?? []).map(
          (error) =>
            `manifest${error.instancePath || "/"} ${error.message ?? ""}`,
        ),
      );
    } else {
      manifest = value;
    }
  } catch (error) {
    diagnostics.push(
      `manifest.json cannot be parsed: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    );
  }

  const files = await listFiles(root);
  for (const file of files) {
    const extension = extname(file).toLowerCase();
    if (forbiddenExtensions.has(extension)) {
      diagnostics.push(
        `Executable source is forbidden in scenario pack: ${file}`,
      );
    } else if (!allowedExtensions.has(extension)) {
      diagnostics.push(`Unsupported scenario pack file type: ${file}`);
    }
  }

  if (manifest) {
    const workflowCapabilityPins = new Set<string>();
    const referenced = [
      ...manifest.workflows.map((workflow) => workflow.path),
      ...(manifest.skill ? [manifest.skill.path] : []),
      ...(manifest.capabilities ?? []).map((capability) => capability.path),
    ];
    for (const path of referenced) {
      if (!files.includes(path)) {
        diagnostics.push(`Referenced scenario file is missing: ${path}`);
      }
    }
    for (const workflow of manifest.workflows) {
      if (!files.includes(workflow.path)) {
        continue;
      }
      try {
        const value: unknown = JSON.parse(
          await readFile(resolve(root, workflow.path), "utf8"),
        );
        if (!isWorkflowTopology(value)) {
          diagnostics.push(`Workflow topology is invalid: ${workflow.path}`);
        } else {
          for (const rawNode of value.nodes) {
            const node = rawNode as unknown as Readonly<
              Record<string, unknown>
            >;
            const capability =
              node.capability &&
              typeof node.capability === "object" &&
              !Array.isArray(node.capability)
                ? (node.capability as Readonly<Record<string, unknown>>)
                : undefined;
            if (!capability) {
              continue;
            }
            const pin = `${String(
              capability.contractId,
            )}:${String(capability.revision)}:${String(
              capability.canonicalDigest,
            )}`;
            workflowCapabilityPins.add(pin);
            const declared = manifest.requiredCapabilities.some(
              (required) =>
                required.contractId === capability.contractId &&
                required.revision === capability.revision &&
                required.canonicalDigest === capability.canonicalDigest,
            );
            if (!declared) {
              diagnostics.push(
                `Workflow Capability pin is not declared in requiredCapabilities: ${workflow.path}: ${pin}`,
              );
            }
          }
        }
      } catch (error) {
        diagnostics.push(
          `Workflow cannot be parsed: ${workflow.path}: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        );
      }
    }
    for (const capability of manifest.capabilities ?? []) {
      if (!files.includes(capability.path)) {
        continue;
      }
      try {
        const value: unknown = JSON.parse(
          await readFile(resolve(root, capability.path), "utf8"),
        );
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          diagnostics.push(
            `Capability definition is not an object: ${capability.path}`,
          );
          continue;
        }
        const definition = value as Readonly<Record<string, unknown>>;
        const reference = manifest.requiredCapabilities.find(
          (candidate) =>
            candidate.contractId === definition.contractKey &&
            candidate.revision === definition.revision,
        );
        if (!reference) {
          diagnostics.push(
            `Capability definition has no requiredCapabilities reference: ${capability.path}`,
          );
          continue;
        }
        if (digest(definition) !== reference.canonicalDigest) {
          diagnostics.push(
            `Capability canonical digest does not match manifest: ${capability.path}`,
          );
        }
      } catch (error) {
        diagnostics.push(
          `Capability cannot be parsed: ${capability.path}: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        );
      }
    }
    for (const required of manifest.requiredCapabilities) {
      const pin = `${required.contractId}:${String(
        required.revision,
      )}:${required.canonicalDigest}`;
      if (!workflowCapabilityPins.has(pin)) {
        diagnostics.push(
          `requiredCapabilities pin is unused by every Workflow: ${pin}`,
        );
      }
    }
  }

  return {
    valid: diagnostics.length === 0,
    diagnostics,
  };
}
