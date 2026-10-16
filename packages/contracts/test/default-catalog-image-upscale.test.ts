import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import {
  CapabilityImplementationDefinitionV1Schema,
  CapabilityMappingDocumentV1Schema,
  CapabilityMappingExpressionV1Schema,
  CapabilityMappingJsonValueSchema,
  compileCapabilityMappingPlanV1,
  executeCapabilityMappingPlanV1,
  RuntimeAdapterDefinitionRevisionSchema,
} from "../src/capability/index.js";

async function json(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

describe("default Catalog image upscale vertical slice", () => {
  it("compiles both mappings and passes every fixed fixture", async () => {
    const root = resolve(
      import.meta.dirname,
      "../../../catalog-packages/kanvas-default",
    );
    const manifest = (await json(resolve(root, "manifest.json"))) as {
      readonly assets: readonly {
        readonly assetKey: string;
        readonly path: string;
      }[];
    };
    const pathFor = (assetKey: string) =>
      resolve(
        root,
        manifest.assets.find((asset) => asset.assetKey === assetKey)!.path,
      );
    const implementationAsset = manifest.assets.find(
      (asset) =>
        asset.assetKey ===
        "implementation.first-party-image-upscale-lanczos3-worker",
    )!;
    const implementationValue = (await json(
      resolve(root, implementationAsset.path),
    )) as {
      readonly adapter: { readonly revision: number };
    };
    const [contractValue, adapterValue] = await Promise.all([
      json(pathFor("contract.image.upscale")),
      json(
        pathFor(
          `adapter.kanvas-image-resize-sharp-v1.r${String(implementationValue.adapter.revision)}`,
        ),
      ),
    ]);
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    ajv.addSchema(CapabilityMappingJsonValueSchema);
    ajv.addSchema(CapabilityMappingExpressionV1Schema);
    ajv.addSchema(CapabilityMappingDocumentV1Schema);
    expect(
      ajv.compile(RuntimeAdapterDefinitionRevisionSchema)(adapterValue),
    ).toBe(true);
    expect(
      ajv.compile(CapabilityImplementationDefinitionV1Schema)(
        implementationValue,
      ),
    ).toBe(true);

    const contract = contractValue as Readonly<Record<string, unknown>>;
    const adapter = adapterValue as Readonly<Record<string, unknown>>;
    const implementation = implementationValue as Readonly<
      Record<string, unknown>
    >;
    const input = compileCapabilityMappingPlanV1({
      document: implementation.inputMapping,
      sourceSchemas: {
        input: contract.inputSchema as Readonly<Record<string, unknown>>,
        configuration: adapter.configurationSchema as Readonly<
          Record<string, unknown>
        >,
      },
      targetSchema: adapter.invocationInputSchema as Readonly<
        Record<string, unknown>
      >,
    });
    const output = compileCapabilityMappingPlanV1({
      document: implementation.outputMapping,
      sourceSchemas: {
        result: adapter.invocationOutputSchema as Readonly<
          Record<string, unknown>
        >,
      },
      targetSchema: contract.outputSchema as Readonly<Record<string, unknown>>,
    });
    const fixtures = implementation.fixtures;
    expect(Array.isArray(fixtures)).toBe(true);
    for (const fixture of fixtures as readonly Readonly<
      Record<string, unknown>
    >[]) {
      expect(
        executeCapabilityMappingPlanV1(input, {
          input: fixture.capabilityInput,
          configuration: fixture.configuration,
        }),
      ).toEqual(fixture.expectedAdapterInput);
      expect(
        executeCapabilityMappingPlanV1(output, {
          result: fixture.adapterResult,
        }),
      ).toEqual(fixture.expectedCapabilityOutput);
    }
  });
});
