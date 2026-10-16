import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const parameterKeys = [
  "resolution",
  "size",
  "quality",
  "outputFormat",
  "background",
  "outputCompression",
] as const;

async function capabilityInputSchema(
  scenario: string,
  capabilityFile: string,
): Promise<Readonly<Record<string, unknown>>> {
  const document = JSON.parse(
    await readFile(
      resolve(
        import.meta.dirname,
        `../../../scenario-packs/first-party/${scenario}/capabilities/${capabilityFile}`,
      ),
      "utf8",
    ),
  ) as {
    readonly inputSchema: Readonly<Record<string, unknown>>;
  };
  return document.inputSchema;
}

describe("stable image-edit Capability Contracts", () => {
  it.each([
    ["image-upscale", "image-upscale.json"],
    ["image-canvas-expand", "image-canvas-expand.json"],
    ["image-object-remove", "image-object-remove.json"],
  ])(
    "keeps model-service transport parameters out of the public %s contract",
    async (scenario, capabilityFile) => {
      const schema = await capabilityInputSchema(scenario, capabilityFile);
      const properties = schema.properties as Readonly<Record<string, unknown>>;

      expect(schema).not.toHaveProperty("x-kanvas-provider-model-operation");
      expect(schema).not.toHaveProperty("x-kanvas-provider-parameter-keys");
      for (const key of parameterKeys) {
        expect(properties).not.toHaveProperty(key);
      }
    },
  );
});
