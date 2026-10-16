import type {
  ModelResourceFormat,
  ModelResourceLicense,
  ModelResourceNativeInterface,
  ModelResourceSourceProvenance,
} from "@kanvas/contracts/api";
import type {
  ModelResourceCatalogAssetV1,
  RuntimeAdapterDefinitionRevision,
} from "@kanvas/contracts/capability";
import {
  digestProviderValue,
  type CompatibleRuntimeAdapter,
  type ModelResourceImportFileRecord,
} from "@kanvas/database/runtime";

export interface AnalyzeModelResourceOptions {
  readonly originalSource: ModelResourceSourceProvenance;
  readonly file: ModelResourceImportFileRecord;
  readonly header: Uint8Array;
  readonly adapters: readonly Readonly<{
    adapterKey: string;
    revision: number;
    canonicalDigest: string;
    document: RuntimeAdapterDefinitionRevision;
  }>[];
  readonly detectedNativeInterface?: ModelResourceNativeInterface;
  readonly catalogDocument?: ModelResourceCatalogAssetV1;
}

export interface ModelResourceAnalysis {
  readonly source: ModelResourceSourceProvenance;
  readonly suggestedKey: string;
  readonly suggestedDisplayName: string;
  readonly format?: ModelResourceFormat;
  readonly license?: ModelResourceLicense;
  readonly nativeInterface?: ModelResourceNativeInterface;
  readonly compatibleAdapters: readonly CompatibleRuntimeAdapter[];
  readonly requiredUserInputs: readonly ("license" | "format")[];
}

function fileExtension(path: string): string {
  const name = path.split("/").at(-1)?.toLowerCase() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1) : "";
}

function bytesEqual(
  bytes: Uint8Array,
  offset: number,
  expected: readonly number[],
): boolean {
  return expected.every((value, index) => bytes[offset + index] === value);
}

export function detectModelResourceFormat(
  path: string,
  header: Uint8Array,
): ModelResourceFormat | undefined {
  const extension = fileExtension(path);
  if (extension === "onnx") return "onnx";
  if (extension === "safetensors") return "safetensors";
  if (extension === "gguf") return "gguf";
  if (extension === "tflite") return "tflite";
  if (extension === "mlmodel" || extension === "mlpackage") return "coreml";
  if (extension === "traineddata") return "tesseract_data";
  if (extension === "wasm") return "wasm_bundle";

  if (bytesEqual(header, 0, [0x47, 0x47, 0x55, 0x46])) return "gguf";
  if (bytesEqual(header, 4, [0x54, 0x46, 0x4c, 0x33])) return "tflite";
  if (bytesEqual(header, 0, [0x00, 0x61, 0x73, 0x6d])) return "wasm_bundle";
  if (header.byteLength >= 10) {
    const view = new DataView(
      header.buffer,
      header.byteOffset,
      header.byteLength,
    );
    const metadataLength = view.getBigUint64(0, true);
    if (
      metadataLength > 1n &&
      metadataLength <= 100_000_000n &&
      header[8] === 0x7b
    ) {
      return "safetensors";
    }
  }
  return undefined;
}

function textMetadata(
  metadata: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = metadata[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function huggingFaceSource(
  source: ModelResourceSourceProvenance,
  metadata: Readonly<Record<string, unknown>>,
): ModelResourceSourceProvenance | undefined {
  if (source.kind !== "https") return undefined;
  let url: URL;
  try {
    url = new URL(source.url);
  } catch {
    return undefined;
  }
  if (url.hostname.toLowerCase() !== "huggingface.co") return undefined;
  const segments = url.pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));
  if (
    segments.length < 5 ||
    (segments[2] !== "resolve" && segments[2] !== "blob")
  ) {
    return undefined;
  }
  const sourceRevision = segments[3];
  const resolvedRevision = textMetadata(metadata, "huggingFaceCommit");
  const filePath = segments.slice(4).join("/");
  if (!sourceRevision || !filePath) return undefined;
  return Object.freeze({
    kind: "hugging_face",
    repository: `${segments[0]}/${segments[1]}`,
    revision: resolvedRevision ?? sourceRevision,
    filePath,
  });
}

function normalizedSource(
  source: ModelResourceSourceProvenance,
  metadata: Readonly<Record<string, unknown>>,
): ModelResourceSourceProvenance {
  const huggingFace = huggingFaceSource(source, metadata);
  if (huggingFace) return huggingFace;
  if (source.kind !== "https") return source;
  const etag = textMetadata(metadata, "etag");
  const lastModified = textMetadata(metadata, "lastModified");
  return Object.freeze({
    kind: "https",
    url: source.url,
    ...(etag ? { etag } : {}),
    ...(lastModified ? { lastModified } : {}),
  });
}

function catalogSourceMatches(
  observed: ModelResourceSourceProvenance,
  expected: ModelResourceSourceProvenance,
): boolean {
  if (observed.kind !== expected.kind) return false;
  if (observed.kind === "https" && expected.kind === "https") {
    return (
      observed.url === expected.url &&
      (expected.etag === undefined || observed.etag === expected.etag) &&
      (expected.lastModified === undefined ||
        observed.lastModified === expected.lastModified)
    );
  }
  if (observed.kind === "hugging_face" && expected.kind === "hugging_face") {
    return (
      observed.repository === expected.repository &&
      observed.revision === expected.revision &&
      observed.filePath === expected.filePath
    );
  }
  return (
    observed.kind === "upload" &&
    expected.kind === "upload" &&
    observed.fileName === expected.fileName
  );
}

function displayName(path: string): string {
  const name = path.split("/").at(-1) ?? "Model";
  const extension = fileExtension(name);
  const withoutExtension = extension
    ? name.slice(0, -(extension.length + 1))
    : name;
  return (
    withoutExtension
      .replace(/[_-]+/gu, " ")
      .replace(/\s+/gu, " ")
      .trim()
      .slice(0, 160) || "Model"
  );
}

function suggestedKey(path: string): string {
  const normalized = displayName(path)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ".")
    .replace(/^\.+|\.+$/gu, "")
    .slice(0, 150)
    .replace(/\.+$/gu, "");
  return `model.${normalized || "imported"}`;
}

function detectedLicense(
  metadata: Readonly<Record<string, unknown>>,
): ModelResourceLicense | undefined {
  const spdxId = textMetadata(metadata, "licenseSpdxId");
  if (!spdxId) return undefined;
  const sourceUrl = textMetadata(metadata, "licenseUrl");
  return Object.freeze({
    spdxId,
    ...(sourceUrl ? { sourceUrl } : {}),
    confidence: "detected",
  });
}

function compatibleAdapters(
  format: ModelResourceFormat | undefined,
  nativeInterface: ModelResourceNativeInterface | undefined,
  adapters: AnalyzeModelResourceOptions["adapters"],
): readonly CompatibleRuntimeAdapter[] {
  if (!format || !nativeInterface) return Object.freeze([]);
  const interfaceDigest = digestProviderValue(nativeInterface);
  return Object.freeze(
    adapters
      .filter(
        (adapter) =>
          adapter.document.sourceKinds.includes("model_resource") &&
          adapter.document.supportedModelFormats.includes(format) &&
          adapter.document.modelResourceInterfaceDigest === interfaceDigest,
      )
      .map((adapter) =>
        Object.freeze({
          adapterKey: adapter.adapterKey,
          displayName: adapter.document.displayName,
          revision: adapter.revision,
          canonicalDigest: adapter.canonicalDigest,
          executionTarget: adapter.document.executionTarget,
          confidence: "exact" as const,
          reasonCode: "model_resource.interface_matched",
        }),
      ),
  );
}

export function analyzeModelResource(
  options: AnalyzeModelResourceOptions,
): ModelResourceAnalysis {
  const format = detectModelResourceFormat(options.file.path, options.header);
  const catalog = options.catalogDocument;
  if (catalog && format !== catalog.format) {
    throw new TypeError(
      "Downloaded model format does not match the selected Catalog release.",
    );
  }
  if (
    catalog &&
    options.detectedNativeInterface &&
    digestProviderValue(options.detectedNativeInterface) !==
      digestProviderValue(catalog.nativeInterface)
  ) {
    throw new TypeError(
      "Downloaded model interface does not match the selected Catalog release.",
    );
  }
  const source = normalizedSource(
    options.originalSource,
    options.file.sourceMetadata,
  );
  if (catalog && !catalogSourceMatches(source, catalog.source)) {
    throw new TypeError(
      "Downloaded model provenance does not match the selected Catalog release.",
    );
  }
  const license = detectedLicense(options.file.sourceMetadata);
  const requiredUserInputs: ModelResourceAnalysis["requiredUserInputs"][number][] =
    [];
  if (!catalog) {
    if (!format) requiredUserInputs.push("format");
  }
  const analyzedFormat = catalog?.format ?? format;
  const analyzedLicense = catalog
    ? {
        ...catalog.license,
        confidence: "declared" as const,
      }
    : (license ?? { spdxId: "NOASSERTION", confidence: "unknown" as const });
  const nativeInterface =
    catalog?.nativeInterface ?? options.detectedNativeInterface;
  return Object.freeze({
    source: catalog?.source ?? source,
    suggestedKey: catalog?.resourceKey ?? suggestedKey(options.file.path),
    suggestedDisplayName: catalog
      ? catalog.displayName.values[catalog.displayName.defaultLocale]!
      : displayName(options.file.path),
    ...(analyzedFormat ? { format: analyzedFormat } : {}),
    ...(analyzedLicense ? { license: analyzedLicense } : {}),
    ...(nativeInterface ? { nativeInterface } : {}),
    compatibleAdapters: compatibleAdapters(
      catalog?.format ?? format,
      nativeInterface,
      options.adapters,
    ),
    requiredUserInputs: Object.freeze(requiredUserInputs),
  });
}
