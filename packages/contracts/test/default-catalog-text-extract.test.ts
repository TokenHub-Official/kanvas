import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

async function json(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Catalog test value must be an object.");
  }
  return value as Readonly<Record<string, unknown>>;
}

describe("default Catalog text extraction", () => {
  it("is configurable through a pinned model resource without a Canvas half-entry", async () => {
    const root = resolve(
      import.meta.dirname,
      "../../../catalog-packages/kanvas-default",
    );
    const manifest = record(await json(resolve(root, "manifest.json")));
    const assets = manifest.assets;
    if (!Array.isArray(assets)) throw new TypeError("Catalog assets missing.");
    const pathFor = (assetKey: string): string => {
      const asset = assets
        .map(record)
        .find((item) => item.assetKey === assetKey);
      if (!asset || typeof asset.path !== "string") {
        throw new Error(`Catalog asset missing: ${assetKey}`);
      }
      return resolve(root, asset.path);
    };

    const [declarationAsset, adapter, model, implementation, binding] =
      await Promise.all([
        json(pathFor("declaration.image.text.extract")),
        json(pathFor("adapter.first-party-image-text-extract-tesseract-v1.r2")),
        json(pathFor("model.tesseract.tessdata-fast-eng")),
        json(
          pathFor(
            "implementation.first-party-image-text-extract-tesseract-eng-worker.r2",
          ),
        ),
        json(
          pathFor(
            "binding.first-party-image-text-extract-tesseract-eng-worker.r2",
          ),
        ),
      ]);
    const declaration = record(record(declarationAsset).declaration);
    const catalog = record(declaration.catalog);
    const outputs = declaration.outputs;
    if (!Array.isArray(outputs)) {
      throw new TypeError("Text extraction outputs missing.");
    }

    expect(catalog.surfaces).toEqual(["workflow", "agent"]);
    expect(
      outputs.map(record).filter((output) => output.primary === true),
    ).toEqual([
      expect.objectContaining({
        key: "text",
        semanticType: "text.plain",
      }),
    ]);
    expect(record(adapter)).toMatchObject({
      executionTarget: "worker",
      sourceKinds: ["model_resource"],
      supportedModelFormats: ["tesseract_data"],
      executable: {
        entrypoint: "first-party.image.text-extract.tesseract.v1",
      },
    });
    const modelRecord = record(model);
    const modelSource = record(modelRecord.source);
    expect(modelRecord).toMatchObject({
      resourceKey: "tesseract.tessdata-fast-eng",
      expectedByteSize: "4113088",
      expectedSha256:
        "sha256:7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2",
    });
    expect(modelSource.kind).toBe("https");
    if (typeof modelSource.url !== "string") {
      throw new TypeError("Catalog model source URL missing.");
    }
    expect(modelSource.url).toContain(
      "/87416418657359cb625c412a48b6e1d6d41c29bd/eng.traineddata",
    );
    expect(record(implementation)).toMatchObject({
      contract: { key: "image.text.extract", revision: 1 },
      source: {
        kind: "model_resource",
        resource: { key: "tesseract.tessdata-fast-eng", revision: 1 },
      },
    });
    expect(record(binding)).toMatchObject({
      enabled: true,
      fallbackOn: ["not_applicable", "unavailable", "retry_exhausted"],
    });
  });
});
