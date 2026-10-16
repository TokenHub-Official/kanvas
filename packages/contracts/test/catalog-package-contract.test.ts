import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import {
  CapabilityMappingDocumentV1Schema,
  CapabilityMappingExpressionV1Schema,
  CapabilityMappingJsonValueSchema,
  type CatalogPackageError,
  CatalogPackageV1Schema,
  orderCatalogPackageAssetsV1,
  parseCatalogPackageV1,
} from "../src/capability/index.js";

describe("catalog package contract", () => {
  it("carries asset digests and explicit installation dependencies", () => {
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    ajv.addSchema(CapabilityMappingJsonValueSchema);
    ajv.addSchema(CapabilityMappingExpressionV1Schema);
    ajv.addSchema(CapabilityMappingDocumentV1Schema);
    const validate = ajv.compile(CatalogPackageV1Schema);
    expect(
      validate({
        schemaVersion: "kanvas.catalog-package/v1",
        packageKey: "kanvas.default-catalog",
        version: "1.0.0",
        displayName: {
          defaultLocale: "en-US",
          values: { "en-US": "Kanvas defaults", "zh-CN": "Kanvas 默认目录" },
        },
        dependencies: [],
        recommendations: [],
        assets: [
          {
            assetKey: "adapter.sharp-resize",
            kind: "runtime_adapter",
            path: "runtime-adapters/sharp-resize.json",
            contentDigest: `sha256:${"1".repeat(64)}`,
            dependsOn: [],
          },
          {
            assetKey: "implementation.image-upscale-faithful",
            kind: "capability_implementation",
            path: "implementations/image-upscale-faithful.json",
            contentDigest: `sha256:${"2".repeat(64)}`,
            dependsOn: ["adapter.sharp-resize", "contract.image-upscale"],
          },
        ],
        contentDigest: `sha256:${"3".repeat(64)}`,
      }),
    ).toBe(true);
  });

  it("rejects absolute and parent-traversing asset paths", () => {
    const validate = new Ajv2020({ strict: true, allErrors: true }).compile(
      CatalogPackageV1Schema,
    );
    const base = {
      schemaVersion: "kanvas.catalog-package/v1",
      packageKey: "kanvas.default-catalog",
      version: "1.0.0",
      displayName: {
        defaultLocale: "en-US",
        values: { "en-US": "Kanvas defaults", "zh-CN": "Kanvas 默认目录" },
      },
      dependencies: [],
      recommendations: [],
      contentDigest: `sha256:${"3".repeat(64)}`,
    };
    for (const path of [
      "/tmp/model.json",
      "../model.json",
      "a/../model.json",
    ]) {
      expect(
        validate({
          ...base,
          assets: [
            {
              assetKey: "model.example",
              kind: "model_resource",
              path,
              contentDigest: `sha256:${"1".repeat(64)}`,
              dependsOn: [],
            },
          ],
        }),
      ).toBe(false);
    }
  });

  it("orders assets by declared dependencies and rejects cycles", () => {
    const manifest = parseCatalogPackageV1({
      schemaVersion: "kanvas.catalog-package/v1",
      packageKey: "kanvas.default-catalog",
      version: "1.0.0",
      displayName: {
        defaultLocale: "en-US",
        values: { "en-US": "Kanvas defaults", "zh-CN": "Kanvas 默认目录" },
      },
      dependencies: [],
      recommendations: [],
      assets: [
        {
          assetKey: "implementation.example",
          kind: "capability_implementation",
          path: "implementations/example.json",
          contentDigest: `sha256:${"2".repeat(64)}`,
          dependsOn: ["adapter.example"],
        },
        {
          assetKey: "adapter.example",
          kind: "runtime_adapter",
          path: "runtime-adapters/example.json",
          contentDigest: `sha256:${"1".repeat(64)}`,
          dependsOn: [],
        },
      ],
      contentDigest: `sha256:${"3".repeat(64)}`,
    });
    expect(
      orderCatalogPackageAssetsV1(manifest).map(({ assetKey }) => assetKey),
    ).toEqual(["adapter.example", "implementation.example"]);

    expect(() =>
      orderCatalogPackageAssetsV1({
        ...manifest,
        assets: manifest.assets.map((asset) => ({
          ...asset,
          dependsOn:
            asset.assetKey === "adapter.example"
              ? ["implementation.example"]
              : asset.dependsOn,
        })),
      }),
    ).toThrowError(
      expect.objectContaining<Partial<CatalogPackageError>>({
        code: "dependency_cycle",
      }),
    );
  });
});
