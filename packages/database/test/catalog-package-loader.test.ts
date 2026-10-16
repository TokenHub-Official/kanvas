import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  catalogPackageContentDigest,
  type CatalogPackageLoadError,
  loadDefaultCatalogPackageV1,
  loadCatalogPackageV1,
} from "../src/cli/catalog-package-loader.js";
import { digestProviderValue } from "../src/runtime/provider-value-digest.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "kanvas-catalog-package-"));
  roots.push(root);
  await mkdir(join(root, "assets"));
  const adapter = { schemaVersion: 1, adapterKey: "adapter.example" };
  const implementation = {
    schemaVersion: 1,
    implementationKey: "implementation.example",
  };
  await writeFile(
    join(root, "assets", "adapter.json"),
    JSON.stringify(adapter),
  );
  await writeFile(
    join(root, "assets", "implementation.json"),
    JSON.stringify(implementation),
  );
  const content = {
    schemaVersion: "kanvas.catalog-package/v1" as const,
    packageKey: "kanvas.test-catalog",
    version: "1.0.0",
    displayName: {
      defaultLocale: "en-US",
      values: { "en-US": "Test catalog", "zh-CN": "测试目录" },
    },
    dependencies: [],
    recommendations: [],
    assets: [
      {
        assetKey: "implementation.example",
        kind: "capability_implementation" as const,
        path: "assets/implementation.json",
        contentDigest: digestProviderValue(implementation),
        dependsOn: ["adapter.example"],
      },
      {
        assetKey: "adapter.example",
        kind: "runtime_adapter" as const,
        path: "assets/adapter.json",
        contentDigest: digestProviderValue(adapter),
        dependsOn: [],
      },
    ],
  };
  const manifest = {
    ...content,
    contentDigest: catalogPackageContentDigest(content),
  };
  await writeFile(join(root, "manifest.json"), JSON.stringify(manifest));
  return { root, manifest };
}

describe("Catalog Package loader", () => {
  it("loads the repository default Catalog Package without capability code", async () => {
    const loaded = await loadDefaultCatalogPackageV1();
    expect(loaded.manifest.packageKey).toBe("kanvas.default-catalog");
    expect(loaded.manifest.version).toBe("2.1.1");
    expect(loaded.manifest.recommendations).toHaveLength(14);
    expect(loaded.assets).toHaveLength(75);
    expect(
      new Set(loaded.assets.map(({ descriptor }) => descriptor.kind)),
    ).toEqual(
      new Set([
        "runtime_adapter",
        "model_resource",
        "capability_contract",
        "capability_declaration",
        "capability_implementation",
        "capability_binding",
      ]),
    );
  });

  it("verifies canonical digests and returns dependency order", async () => {
    const { root } = await fixture();
    const loaded = await loadCatalogPackageV1(root);
    expect(loaded.assets.map(({ descriptor }) => descriptor.assetKey)).toEqual([
      "adapter.example",
      "implementation.example",
    ]);
  });

  it("fails closed when an asset changes after publication", async () => {
    const { root } = await fixture();
    await writeFile(
      join(root, "assets", "adapter.json"),
      JSON.stringify({ schemaVersion: 1, adapterKey: "adapter.changed" }),
    );
    await expect(loadCatalogPackageV1(root)).rejects.toEqual(
      expect.objectContaining<Partial<CatalogPackageLoadError>>({
        code: "asset_digest_mismatch",
      }),
    );
  });
});
