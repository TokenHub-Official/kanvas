import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface CatalogAssetDigest {
  readonly assetKey: string;
  readonly contentDigest: string;
}

const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const workspaceRoot = resolve(import.meta.dirname, "../../..");
const manifestPath = resolve(
  workspaceRoot,
  "catalog-packages/kanvas-default/manifest.json",
);

function readCatalogAssetDigests(): readonly CatalogAssetDigest[] {
  const document: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new TypeError("The default Catalog manifest must be an object.");
  }
  const assets = (document as Readonly<Record<string, unknown>>).assets;
  if (!Array.isArray(assets)) {
    throw new TypeError("The default Catalog manifest must declare assets.");
  }
  return assets.map((asset) => {
    if (!asset || typeof asset !== "object" || Array.isArray(asset)) {
      throw new TypeError("Each default Catalog asset must be an object.");
    }
    const entry = asset as Readonly<Record<string, unknown>>;
    if (
      typeof entry.assetKey !== "string" ||
      typeof entry.contentDigest !== "string" ||
      !digestPattern.test(entry.contentDigest)
    ) {
      throw new TypeError("A default Catalog asset digest is invalid.");
    }
    return Object.freeze({
      assetKey: entry.assetKey,
      contentDigest: entry.contentDigest,
    });
  });
}

const catalogAssetDigests = readCatalogAssetDigests();

function implementationDigest(assetKey: string): string {
  const asset = catalogAssetDigests.find(
    (entry) => entry.assetKey === assetKey,
  );
  if (!asset) {
    throw new Error(`Default Catalog implementation is missing: ${assetKey}`);
  }
  return asset.contentDigest;
}

export const defaultCatalogImplementationDigests = Object.freeze({
  composeBrowser: implementationDigest(
    "implementation.first-party-image-background-compose-deterministic-browser",
  ),
  cropBrowser: implementationDigest(
    "implementation.first-party-image-crop-suggest-deterministic-browser",
  ),
  denoiseBrowser: implementationDigest(
    "implementation.first-party-image-denoise-median-blend-browser",
  ),
  lightEnhanceBrowser: implementationDigest(
    "implementation.first-party-image-light-enhance-deterministic-browser",
  ),
  paletteBrowser: implementationDigest(
    "implementation.first-party-image-palette-extract-histogram-browser",
  ),
  qualityBrowser: implementationDigest(
    "implementation.first-party-image-quality-assess-deterministic-browser",
  ),
});
