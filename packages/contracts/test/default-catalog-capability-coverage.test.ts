import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

interface AssetDescriptor {
  readonly assetKey: string;
  readonly kind: string;
  readonly path: string;
}

interface RecommendationDescriptor {
  readonly recommendationKey: string;
  readonly defaultBindingAssetKey: string;
}

async function document(root: string, asset: AssetDescriptor) {
  return JSON.parse(
    await readFile(resolve(root, asset.path), "utf8"),
  ) as Readonly<Record<string, unknown>>;
}

describe("default Catalog capability coverage", () => {
  it("keeps Capability run methods complete without requiring Workflow or Skill coverage", async () => {
    const root = resolve(
      import.meta.dirname,
      "../../../catalog-packages/kanvas-default",
    );
    const manifest = JSON.parse(
      await readFile(resolve(root, "manifest.json"), "utf8"),
    ) as {
      readonly assets: readonly AssetDescriptor[];
      readonly recommendations: readonly RecommendationDescriptor[];
    };
    const [
      contracts,
      declarations,
      implementations,
      bindings,
      adapters,
      workflows,
      skills,
    ] = await Promise.all([
      Promise.all(
        manifest.assets
          .filter((asset) => asset.kind === "capability_contract")
          .map((asset) => document(root, asset)),
      ),
      Promise.all(
        manifest.assets
          .filter((asset) => asset.kind === "capability_declaration")
          .map((asset) => document(root, asset)),
      ),
      Promise.all(
        manifest.assets
          .filter((asset) => asset.kind === "capability_implementation")
          .map((asset) => document(root, asset)),
      ),
      Promise.all(
        manifest.assets
          .filter((asset) => asset.kind === "capability_binding")
          .map((asset) => document(root, asset)),
      ),
      Promise.all(
        manifest.assets
          .filter((asset) => asset.kind === "runtime_adapter")
          .map((asset) => document(root, asset)),
      ),
      Promise.all(
        manifest.assets
          .filter((asset) => asset.kind === "workflow")
          .map((asset) => document(root, asset)),
      ),
      Promise.all(
        manifest.assets
          .filter((asset) => asset.kind === "skill")
          .map((asset) => document(root, asset)),
      ),
    ]);
    const implementationContracts = new Set(
      implementations.map(
        (implementation) =>
          (implementation.contract as Readonly<Record<string, string>>).key,
      ),
    );
    const boundImplementations = new Set(
      bindings.map(
        (binding) =>
          (binding.implementation as Readonly<Record<string, string>>).key,
      ),
    );
    const skillWorkflows = new Set(
      skills.flatMap((skill) =>
        (
          skill.entrypoints as readonly Readonly<{
            workflow: Readonly<{ key: string }>;
          }>[]
        ).map((entrypoint) => entrypoint.workflow.key),
      ),
    );
    const declaredCapabilities = declarations.map(
      (declaration) =>
        (declaration.contract as Readonly<Record<string, string>>).key!,
    );

    expect(new Set(contracts.map((contract) => contract.revision))).toEqual(
      new Set([1]),
    );
    expect(workflows).toEqual([]);
    expect(skills).toEqual([]);
    expect(manifest.recommendations).toHaveLength(contracts.length);
    expect(
      new Set(
        manifest.recommendations.map(
          (recommendation) => recommendation.recommendationKey,
        ),
      ).size,
    ).toBe(manifest.recommendations.length);
    const bindingAssetKeys = new Set(
      manifest.assets
        .filter((asset) => asset.kind === "capability_binding")
        .map((asset) => asset.assetKey),
    );
    expect(
      manifest.recommendations.filter(
        (recommendation) =>
          !bindingAssetKeys.has(recommendation.defaultBindingAssetKey),
      ),
    ).toEqual([]);
    expect(
      declaredCapabilities.filter((key) => !implementationContracts.has(key)),
    ).toEqual([]);
    expect(
      implementations
        .map((implementation) => implementation.implementationKey as string)
        .filter((key) => !boundImplementations.has(key)),
    ).toEqual([]);
    for (const adapter of adapters.filter(
      (item) =>
        (item.sourceKinds as readonly string[]).includes("plugin") &&
        (item.executable as Readonly<Record<string, unknown>>).kind ===
          "built_in",
    )) {
      const policy = adapter.selectionPolicy as Readonly<
        Record<string, unknown>
      >;
      const contracts = new Set(
        implementations
          .filter(
            (implementation) =>
              (implementation.adapter as Readonly<Record<string, unknown>>)
                .adapterKey === adapter.adapterKey,
          )
          .map(
            (implementation) =>
              (implementation.contract as Readonly<Record<string, string>>).key,
          ),
      );
      expect(policy.scope).toBe("capability_private");
      expect(contracts).toEqual(new Set([policy.capabilityKey]));
    }
    const contractKeys = new Set(
      contracts.map((contract) => contract.contractKey as string),
    );
    expect(
      workflows.flatMap((workflow) =>
        (
          workflow.requiredCapabilities as readonly Readonly<{
            key: string;
          }>[]
        )
          .map((capability) => capability.key)
          .filter((key) => !contractKeys.has(key)),
      ),
    ).toEqual([]);
    const workflowKeys = new Set(
      workflows.map((workflow) => workflow.workflowKey as string),
    );
    expect([...skillWorkflows].filter((key) => !workflowKeys.has(key))).toEqual(
      [],
    );
  });
});
