import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { validateScenarioPack } from "../src/validate-scenario-pack.js";

async function readJsonObject(path: string): Promise<Record<string, unknown>> {
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`Expected a JSON object at ${path}.`);
  }
  return value as Record<string, unknown>;
}

describe("scenario pack validator", () => {
  it("accepts a declarative scenario pack fixture", async () => {
    const result = await validateScenarioPack(
      resolve(import.meta.dirname, "fixtures/valid"),
    );
    expect(result).toEqual({
      valid: true,
      diagnostics: [],
    });
  });

  it("accepts the Artifact-native deterministic cutout canary", async () => {
    const canaryRoot = resolve(
      import.meta.dirname,
      "../../../scenario-packs/first-party/single-image-cutout-canary",
    );
    const result = await validateScenarioPack(canaryRoot);
    expect(result).toEqual({
      valid: true,
      diagnostics: [],
    });

    const [skill, capability, workflow] = await Promise.all([
      readJsonObject(resolve(canaryRoot, "skill/manifest.json")),
      readJsonObject(
        resolve(canaryRoot, "capabilities/test-image-background-remove.json"),
      ),
      readJsonObject(resolve(canaryRoot, "workflows/single-image-cutout.json")),
    ]);
    expect(JSON.stringify([skill, capability, workflow])).not.toContain(
      "deliverable",
    );
    expect(skill).toMatchObject({
      entrypoints: [
        {
          inputUiSchema: {
            source: { parameterKey: "sourceArtifactId" },
          },
        },
      ],
    });
    expect(capability).toMatchObject({
      inputSchema: {
        additionalProperties: false,
        required: ["sourceArtifactId"],
      },
      outputSchema: {
        additionalProperties: false,
        required: [
          "schemaVersion",
          "imageArtifactId",
          "sourceArtifactId",
          "capabilityRunId",
        ],
        properties: {
          schemaVersion: {
            const: "kanvas.deterministic-image-result/v1",
          },
        },
      },
    });
    expect(workflow).toMatchObject({
      outputs: {
        schemaVersion: {
          required: true,
          value: "kanvas.deterministic-image-result/v1",
        },
        imageArtifactId: {
          required: true,
          value: { $value: { pointer: "/imageArtifactId" } },
        },
        sourceArtifactId: {
          required: true,
          value: { $value: { pointer: "/sourceArtifactId" } },
        },
        capabilityRunId: {
          required: true,
          value: { $value: { pointer: "/capabilityRunId" } },
        },
      },
    });
  });

  it("accepts the production single-image background-removal pack", async () => {
    const result = await validateScenarioPack(
      resolve(
        import.meta.dirname,
        "../../../scenario-packs/first-party/single-image-background-remove",
      ),
    );
    expect(result).toEqual({
      valid: true,
      diagnostics: [],
    });
  });

  it.each(["image-text-remove", "image-layers-separate"])(
    "accepts composition-only Workflow pack %s without a duplicate Capability",
    async (pack) => {
      const result = await validateScenarioPack(
        resolve(
          import.meta.dirname,
          `../../../scenario-packs/first-party/${pack}`,
        ),
      );
      expect(result).toEqual({
        valid: true,
        diagnostics: [],
      });
    },
  );

  it("rejects executable source in a pack", async () => {
    const result = await validateScenarioPack(
      resolve(import.meta.dirname, "fixtures/invalid-executable"),
    );
    expect(result.valid).toBe(false);
    expect(result.diagnostics.join("\n")).toContain(
      "Executable source is forbidden",
    );
  });
});
