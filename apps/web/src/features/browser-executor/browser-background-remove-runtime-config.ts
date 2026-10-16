import type {
  BrowserRuntimeCapability,
  BrowserRuntimeManifest,
} from "@kanvas/contracts/api";
import type { BrowserU2NetConfiguration } from "./u2net-browser-types.js";

const ulidPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const runtimeTextMaximumLength = 800;
const modelVariantMaximumLength = 160;
const normalizationMaximumLength = 40;
const compactModelInputSize = 320;
const detailedModelInputSize = 1_024;

export interface BrowserBackgroundRemoveRuntimeConfig {
  readonly inputSize: BrowserU2NetConfiguration["inputSize"];
  readonly capabilities: readonly BrowserRuntimeCapability[];
  readonly modelDigest: string;
  readonly modelUrl: string;
  readonly modelWorkspaceId?: string;
  readonly modelVariant: BrowserU2NetConfiguration["modelVariant"];
  readonly normalization: BrowserU2NetConfiguration["normalization"];
  readonly runtimeReleaseDigest: string;
  readonly runtimeReleaseId: string;
  readonly wasmPaths: string;
}

function safeModelUrl(value: string): boolean {
  if (value.startsWith("/")) {
    return !value.includes("\\") && !value.split("/").includes("..");
  }
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function text(
  value: unknown,
  maximumLength = runtimeTextMaximumLength,
): string | undefined {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength
    ? value
    : undefined;
}

function normalizedDigest(value: unknown): string | undefined {
  const digest = text(value);
  if (!digest) return undefined;
  return digest.startsWith("sha256:") ? digest : `sha256:${digest}`;
}

export function browserBackgroundRemoveRuntimeConfigFromManifest(
  manifest: BrowserRuntimeManifest,
  workspaceId: string,
  requiredCapabilityKeys?: readonly string[],
): BrowserBackgroundRemoveRuntimeConfig | undefined {
  const capabilities = manifest.capabilities.filter(
    (capability) =>
      capability.runtimeProfileKind === "browser.u2net.v1" &&
      (requiredCapabilityKeys === undefined ||
        requiredCapabilityKeys.includes(capability.capabilityKey)),
  );
  if (capabilities.length === 0) return undefined;
  const first = capabilities[0]!;
  const resource = first.modelResource;
  const configuration = record(first.implementationConfiguration);
  const model = record(configuration?.model);
  const modelVariant = text(model?.variant, modelVariantMaximumLength);
  const normalization = text(model?.normalization, normalizationMaximumLength);
  const inputSize = model?.inputSize;
  const wasmPaths = text(configuration?.wasmPaths);
  if (
    !ulidPattern.test(manifest.runtimeReleaseId) ||
    !digestPattern.test(manifest.runtimeReleaseDigest) ||
    !resource ||
    resource.format !== "onnx" ||
    resource.family !== model?.family ||
    resource.variant !== modelVariant ||
    resource.contentDigest !== normalizedDigest(model?.sha256) ||
    !safeModelUrl(resource.contentUrl) ||
    !["u2net", "u2netp", "isnet-general-fp16"].includes(modelVariant ?? "") ||
    !["imagenet", "isnet"].includes(normalization ?? "") ||
    (inputSize !== compactModelInputSize &&
      inputSize !== detailedModelInputSize) ||
    !wasmPaths ||
    !wasmPaths.startsWith("/") ||
    wasmPaths.includes("\\") ||
    wasmPaths.split("/").includes("..") ||
    new Set(
      capabilities.map((capability) => capability.implementationRevisionId),
    ).size !== capabilities.length ||
    capabilities.some(
      (capability) =>
        !ulidPattern.test(capability.implementationRevisionId) ||
        !digestPattern.test(capability.implementationDigest) ||
        !ulidPattern.test(capability.runtimeAdapterRevisionId) ||
        !digestPattern.test(capability.runtimeAdapterRevisionDigest) ||
        !digestPattern.test(capability.probeResultDigest) ||
        capability.runtimeProfileKind !== "browser.u2net.v1" ||
        capability.runtimeProfileVersion !== 1 ||
        (capability.runtimeRole !== "background_remove" &&
          capability.runtimeRole !== "subject_detect") ||
        capability.backend !== "wasm" ||
        capability.probeProfileVersion !== 1 ||
        capability.modelResource?.revisionId !== resource.revisionId ||
        capability.modelResource?.revisionDigest !== resource.revisionDigest ||
        capability.modelResource?.contentDigest !== resource.contentDigest,
    )
  ) {
    throw new Error(
      "Browser runtime manifest does not match the admitted local runtime.",
    );
  }
  return Object.freeze({
    runtimeReleaseId: manifest.runtimeReleaseId,
    runtimeReleaseDigest: manifest.runtimeReleaseDigest,
    capabilities: Object.freeze(capabilities),
    modelUrl: resource.contentUrl,
    ...(resource.contentUrl.startsWith("/api/v1/")
      ? { modelWorkspaceId: workspaceId }
      : {}),
    modelDigest: resource.contentDigest,
    inputSize,
    normalization: normalization as BrowserU2NetConfiguration["normalization"],
    wasmPaths,
    modelVariant: modelVariant as BrowserU2NetConfiguration["modelVariant"],
  });
}
