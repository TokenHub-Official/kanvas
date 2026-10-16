import { readFile, realpath } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

import {
  orderCatalogPackageAssetsV1,
  parseCatalogPackageV1,
  type CatalogPackageV1,
} from "@kanvas/contracts/capability";

import { digestProviderValue } from "../runtime/provider-value-digest.js";

export type LoadedCatalogPackageAsset = Readonly<{
  descriptor: CatalogPackageV1["assets"][number];
  document: unknown;
}>;

export interface LoadedCatalogPackageV1 {
  readonly manifest: CatalogPackageV1;
  readonly assets: readonly LoadedCatalogPackageAsset[];
}

export class CatalogPackageLoadError extends Error {
  public constructor(
    readonly code:
      | "asset_digest_mismatch"
      | "asset_invalid_json"
      | "asset_path_escape"
      | "manifest_digest_mismatch"
      | "manifest_invalid_json",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "CatalogPackageLoadError";
  }
}

function packageContent(manifest: CatalogPackageV1): unknown {
  return Object.freeze({
    schemaVersion: manifest.schemaVersion,
    packageKey: manifest.packageKey,
    version: manifest.version,
    displayName: manifest.displayName,
    dependencies: manifest.dependencies,
    recommendations: manifest.recommendations,
    assets: manifest.assets,
  });
}

function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new CatalogPackageLoadError(
      label === "manifest" ? "manifest_invalid_json" : "asset_invalid_json",
      `Catalog Package ${label} is not valid JSON.`,
      { cause: error },
    );
  }
}

function insideRoot(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path !== ".." && !path.startsWith(`..${sep}`) && !path.startsWith(sep);
}

export async function loadCatalogPackageV1(
  packageRoot: string,
): Promise<LoadedCatalogPackageV1> {
  const manifestPath = resolve(packageRoot, "manifest.json");
  const canonicalRoot = await realpath(dirname(manifestPath));
  const manifest = parseCatalogPackageV1(
    parseJson(await readFile(manifestPath, "utf8"), "manifest"),
  );
  if (
    digestProviderValue(packageContent(manifest)) !== manifest.contentDigest
  ) {
    throw new CatalogPackageLoadError(
      "manifest_digest_mismatch",
      "Catalog Package manifest content digest is invalid.",
    );
  }

  const loaded: LoadedCatalogPackageAsset[] = [];
  for (const descriptor of orderCatalogPackageAssetsV1(manifest)) {
    const declaredPath = resolve(canonicalRoot, descriptor.path);
    const canonicalPath = await realpath(declaredPath);
    if (!insideRoot(canonicalRoot, canonicalPath)) {
      throw new CatalogPackageLoadError(
        "asset_path_escape",
        `Catalog Package asset ${descriptor.assetKey} escapes the package root.`,
      );
    }
    const document = parseJson(
      await readFile(canonicalPath, "utf8"),
      `asset ${descriptor.assetKey}`,
    );
    if (digestProviderValue(document) !== descriptor.contentDigest) {
      throw new CatalogPackageLoadError(
        "asset_digest_mismatch",
        `Catalog Package asset ${descriptor.assetKey} content digest is invalid.`,
      );
    }
    loaded.push(Object.freeze({ descriptor, document }));
  }
  return Object.freeze({
    manifest,
    assets: Object.freeze(loaded),
  });
}

export function loadDefaultCatalogPackageV1(): Promise<LoadedCatalogPackageV1> {
  return loadCatalogPackageV1(
    process.env.KANVAS_DEFAULT_CATALOG_DIRECTORY ||
      resolve(
        import.meta.dirname,
        "../../../../catalog-packages/kanvas-default",
      ),
  );
}

export function catalogPackageContentDigest(
  manifest: Omit<CatalogPackageV1, "contentDigest">,
): string {
  return digestProviderValue(manifest);
}
