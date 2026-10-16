import type {
  ArtTextPresetManifest,
  ResourceCandidate,
  ResourceArtTextCandidate,
  ResourceFontCandidate,
  ResourceImageCandidate,
  ResourceLicenseDescriptor,
  ResourceLicensePolicy,
  ResourceSourceCapability,
  ResourceSourceType,
} from "@kanvas/contracts/resource-source";
import {
  ArtTextPresetManifestSchema,
  resourceLicensePolicyReason,
} from "@kanvas/contracts/resource-source";
import { digestProviderValue } from "@kanvas/database/runtime";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import type { ProviderProbeRequester } from "../provider/provider-setting-probe.js";

export interface ResourceSourceAdapterValidation {
  readonly capabilities: readonly ResourceSourceCapability[];
  readonly validationDigest: string;
  readonly reasonCode: "resource_source.connection_verified";
}

export class ResourceSourceAdapterError extends Error {
  public constructor(
    public readonly code:
      | "adapter_not_found"
      | "authentication_failed"
      | "invalid_response"
      | "rate_limited"
      | "unavailable",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ResourceSourceAdapterError";
  }
}

interface ResourceSourceAdapter {
  readonly descriptor: ResourceSourceType;
  readonly capabilities: readonly ResourceSourceCapability[];
  probe(options: {
    readonly endpointOrigin: string;
    readonly material?: Uint8Array;
    readonly request: ProviderProbeRequester;
  }): Promise<unknown>;
  search?: (
    options: ResourceSourceSearchOptions,
  ) => Promise<ResourceSourceSearchResult>;
  resolve?: (
    options: ResourceSourceResolveOptions,
  ) => Promise<ResourceCandidate>;
}

interface ResourceSourceSearchOptions {
  readonly sourceInstanceId: string;
  readonly sourceRevisionId: string;
  readonly endpointOrigin: string;
  readonly configuration: Readonly<Record<string, unknown>>;
  readonly licensePolicy: ResourceLicensePolicy;
  readonly query: string;
  readonly cursor?: string;
  readonly limit: number;
  readonly material?: Uint8Array;
  readonly request: ProviderProbeRequester;
  readonly now: Date;
}

const maximumAnonymousOpenversePageSize = 20;

interface ResourceSourceResolveOptions extends Omit<
  ResourceSourceSearchOptions,
  "cursor" | "limit" | "query"
> {
  readonly externalId: string;
}

export interface ResourceSourceSearchResult {
  readonly candidates: readonly ResourceCandidate[];
  readonly nextCursor?: string;
}

function adapter(value: ResourceSourceAdapter): ResourceSourceAdapter {
  return Object.freeze(value);
}

function credentialText(material: Uint8Array | undefined): string {
  if (!material || material.byteLength < 1) {
    throw new ResourceSourceAdapterError(
      "authentication_failed",
      "This resource source requires configured credentials.",
    );
  }
  return Buffer.from(material).toString("utf8");
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ResourceSourceAdapterError(
      "invalid_response",
      "The resource source returned an invalid catalog response.",
    );
  }
  return value as Readonly<Record<string, unknown>>;
}

function assertSuccess(statusCode: number): void {
  if (statusCode >= 200 && statusCode < 300) {
    return;
  }
  if (statusCode === 401 || statusCode === 403) {
    throw new ResourceSourceAdapterError(
      "authentication_failed",
      "The resource source rejected the configured credentials.",
    );
  }
  if (statusCode === 429) {
    throw new ResourceSourceAdapterError(
      "rate_limited",
      "The resource source temporarily limited validation requests.",
    );
  }
  throw new ResourceSourceAdapterError(
    "unavailable",
    "The resource source is temporarily unavailable.",
  );
}

async function getJson(
  request: ProviderProbeRequester,
  options: {
    readonly endpointOrigin: string;
    readonly path: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly maximumResponseBytes?: number;
  },
): Promise<unknown> {
  const response = await request({
    baseUrl: options.endpointOrigin,
    path: options.path,
    headers: options.headers ?? {},
    ...(options.maximumResponseBytes
      ? { maximumResponseBytes: options.maximumResponseBytes }
      : {}),
  });
  assertSuccess(response.statusCode);
  return response.body;
}

function httpsUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 240)
    : fallback;
}

function positiveInteger(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

function dimensions(
  width: unknown,
  height: unknown,
): { readonly width?: number; readonly height?: number } {
  const parsedWidth = positiveInteger(width);
  const parsedHeight = positiveInteger(height);
  return {
    ...(parsedWidth !== undefined ? { width: parsedWidth } : {}),
    ...(parsedHeight !== undefined ? { height: parsedHeight } : {}),
  };
}

function licenseDescriptor(
  options: {
    readonly id: string;
    readonly url: string;
    readonly attribution: boolean;
    readonly shareAlike?: boolean;
    readonly standaloneRedistribution?: boolean;
    readonly creatorCredit?: string;
    readonly sourceCredit?: string;
  },
  now: Date,
): ResourceLicenseDescriptor {
  return {
    licenseId: options.id,
    licenseUrl: options.url,
    commercialUseAllowed: true,
    modificationAllowed: true,
    attributionRequired: options.attribution,
    shareAlikeRequired: options.shareAlike ?? false,
    standaloneRedistributionAllowed: options.standaloneRedistribution ?? true,
    ...(options.creatorCredit
      ? { creatorCredit: options.creatorCredit.slice(0, 500) }
      : {}),
    ...(options.sourceCredit
      ? { sourceCredit: options.sourceCredit.slice(0, 500) }
      : {}),
    modelReleaseStatus: "unknown",
    propertyReleaseStatus: "unknown",
    trademarkRisk: "unknown",
    capturedAt: now.toISOString(),
    termsDigest: digestProviderValue({
      licenseId: options.id,
      licenseUrl: options.url,
      attribution: options.attribution,
      shareAlike: options.shareAlike ?? false,
      standaloneRedistribution: options.standaloneRedistribution ?? true,
    }),
  };
}

function pageCursor(value: string | undefined): number {
  const page = Number.parseInt(value ?? "1", 10);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

function nextPage(
  page: number,
  count: number,
  limit: number,
): string | undefined {
  return count >= limit ? String(page + 1) : undefined;
}

function allowedCandidate(
  policy: ResourceLicensePolicy,
  candidate: ResourceCandidate | undefined,
): candidate is ResourceCandidate {
  return Boolean(
    candidate &&
    resourceLicensePolicyReason(policy, candidate.license) === "allowed",
  );
}

function openverseLicense(
  value: Readonly<Record<string, unknown>>,
  now: Date,
): ResourceLicenseDescriptor | undefined {
  const id =
    typeof value.license === "string" ? value.license.toLowerCase() : "";
  const known: Readonly<
    Record<string, { id: string; attribution: boolean; shareAlike?: boolean }>
  > = {
    cc0: { id: "CC0-1.0", attribution: false },
    pdm: { id: "PDM-1.0", attribution: false },
    by: {
      id: `CC-BY-${text(value.license_version, "4.0")}`,
      attribution: true,
    },
    "by-sa": {
      id: `CC-BY-SA-${text(value.license_version, "4.0")}`,
      attribution: true,
      shareAlike: true,
    },
  };
  const match = known[id];
  const url = httpsUrl(value.license_url);
  if (!match || !url) return undefined;
  return licenseDescriptor(
    {
      id: match.id,
      url,
      attribution: match.attribution,
      ...(match.shareAlike ? { shareAlike: true } : {}),
      ...(typeof value.creator === "string"
        ? { creatorCredit: value.creator }
        : {}),
      sourceCredit: "Openverse",
    },
    now,
  );
}

function openverseCandidate(
  item: unknown,
  options: ResourceSourceSearchOptions,
): ResourceImageCandidate | undefined {
  const value = record(item);
  const externalId = typeof value.id === "string" ? value.id : undefined;
  const previewUrl = httpsUrl(value.thumbnail);
  const originalUrl = httpsUrl(value.url);
  const sourcePageUrl = httpsUrl(value.foreign_landing_url);
  const license = openverseLicense(value, options.now);
  if (
    !externalId ||
    !previewUrl ||
    !originalUrl ||
    !sourcePageUrl ||
    !license
  ) {
    return undefined;
  }
  return {
    sourceInstanceId: options.sourceInstanceId,
    sourceRevisionId: options.sourceRevisionId,
    externalId,
    kind: "image",
    title: text(value.title, "Openverse image"),
    sourcePageUrl,
    ...(typeof value.creator === "string"
      ? { creatorName: value.creator }
      : {}),
    license,
    providerObligations: {
      displayCreditRequired: true,
      hotlinkRequired: false,
      downloadEventRequired: false,
      brandingRequired: true,
      coreReplicationRestricted: false,
    },
    preview: {
      url: previewUrl,
      mediaType: "image/jpeg",
      ...dimensions(value.width, value.height),
    },
    original: {
      url: originalUrl,
      mediaType: value.filetype === "png" ? "image/png" : "image/jpeg",
      ...dimensions(value.width, value.height),
    },
    tags: Array.isArray(value.tags)
      ? value.tags
          .flatMap((tag) => {
            if (!tag || typeof tag !== "object") return [];
            const name = (tag as Readonly<Record<string, unknown>>).name;
            return typeof name === "string" ? [name.slice(0, 80)] : [];
          })
          .slice(0, 128)
      : [],
  };
}

function openverseSearchFilters(options: ResourceSourceSearchOptions): string {
  const policy = options.licensePolicy;
  const allowed = policy.allowedLicenseIds;
  const accepts = (id: string) =>
    allowed.length === 0 ||
    allowed.some(
      (candidate) =>
        candidate === id ||
        candidate.startsWith(`${id.replace(/-1\.0$/u, "")}-`),
    );
  const licenses = [
    ...(accepts("CC0-1.0") ? ["cc0"] : []),
    ...(accepts("PDM-1.0") ? ["pdm"] : []),
    ...(policy.allowAttribution && accepts("CC-BY") ? ["by"] : []),
    ...(policy.allowAttribution && policy.allowShareAlike && accepts("CC-BY-SA")
      ? ["by-sa"]
      : []),
  ];
  const sources = Array.isArray(options.configuration.allowedSources)
    ? options.configuration.allowedSources.filter(
        (value): value is string =>
          typeof value === "string" && value.length > 0,
      )
    : [];
  return [
    ...(licenses.length > 0
      ? [`license=${encodeURIComponent(licenses.join(","))}`]
      : []),
    ...(sources.length > 0
      ? [`source=${encodeURIComponent(sources.join(","))}`]
      : []),
  ]
    .map((value) => `&${value}`)
    .join("");
}

function pexelsCandidate(
  item: unknown,
  options: ResourceSourceSearchOptions,
): ResourceImageCandidate | undefined {
  const value = record(item);
  const source = value.src ? record(value.src) : {};
  const externalId =
    typeof value.id === "number" || typeof value.id === "string"
      ? String(value.id)
      : undefined;
  const previewUrl = httpsUrl(source.medium ?? source.small);
  const originalUrl = httpsUrl(source.original ?? source.large2x);
  const sourcePageUrl = httpsUrl(value.url);
  if (!externalId || !previewUrl || !originalUrl || !sourcePageUrl)
    return undefined;
  const creator = text(value.photographer, "Pexels contributor");
  return {
    sourceInstanceId: options.sourceInstanceId,
    sourceRevisionId: options.sourceRevisionId,
    externalId,
    kind: "image",
    title: text(value.alt, `Pexels photo ${externalId}`),
    sourcePageUrl,
    creatorName: creator,
    license: licenseDescriptor(
      {
        id: "Pexels-License",
        url: "https://www.pexels.com/license/",
        attribution: false,
        standaloneRedistribution: false,
        creatorCredit: creator,
        sourceCredit: "Pexels",
      },
      options.now,
    ),
    providerObligations: {
      displayCreditRequired: true,
      hotlinkRequired: false,
      downloadEventRequired: false,
      brandingRequired: true,
      coreReplicationRestricted: true,
    },
    preview: {
      url: previewUrl,
      mediaType: "image/jpeg",
      ...dimensions(value.width, value.height),
    },
    original: {
      url: originalUrl,
      mediaType: "image/jpeg",
      ...dimensions(value.width, value.height),
    },
    tags: [],
  };
}

function pixabayCandidate(
  item: unknown,
  options: ResourceSourceSearchOptions,
): ResourceImageCandidate | undefined {
  const value = record(item);
  const externalId =
    typeof value.id === "number" || typeof value.id === "string"
      ? String(value.id)
      : undefined;
  const previewUrl = httpsUrl(value.webformatURL ?? value.previewURL);
  const originalUrl = httpsUrl(value.largeImageURL ?? value.webformatURL);
  const sourcePageUrl = httpsUrl(value.pageURL);
  if (!externalId || !previewUrl || !originalUrl || !sourcePageUrl)
    return undefined;
  const creator = text(value.user, "Pixabay contributor");
  return {
    sourceInstanceId: options.sourceInstanceId,
    sourceRevisionId: options.sourceRevisionId,
    externalId,
    kind: "image",
    title: text(value.tags, `Pixabay image ${externalId}`),
    sourcePageUrl,
    creatorName: creator,
    license: licenseDescriptor(
      {
        id: "Pixabay-Content-License",
        url: "https://pixabay.com/service/license-summary/",
        attribution: false,
        standaloneRedistribution: false,
        creatorCredit: creator,
        sourceCredit: "Pixabay",
      },
      options.now,
    ),
    providerObligations: {
      displayCreditRequired: false,
      hotlinkRequired: false,
      downloadEventRequired: false,
      brandingRequired: false,
      coreReplicationRestricted: true,
    },
    preview: {
      url: previewUrl,
      mediaType: "image/jpeg",
      ...dimensions(value.webformatWidth, value.webformatHeight),
    },
    original: {
      url: originalUrl,
      mediaType: "image/jpeg",
      ...dimensions(value.imageWidth, value.imageHeight),
    },
    tags:
      typeof value.tags === "string"
        ? value.tags
            .split(",")
            .map((tag) => tag.trim().slice(0, 80))
            .filter(Boolean)
            .slice(0, 128)
        : [],
  };
}

function iconifyCandidate(
  icon: unknown,
  collections: Readonly<Record<string, unknown>>,
  options: ResourceSourceSearchOptions,
): ResourceImageCandidate | undefined {
  if (typeof icon !== "string") return undefined;
  const separator = icon.indexOf(":");
  if (separator < 1 || separator === icon.length - 1) return undefined;
  const prefix = icon.slice(0, separator);
  const name = icon.slice(separator + 1);
  if (!collections[prefix]) return undefined;
  const collection = record(collections[prefix]);
  const licenseValue = record(collection.license);
  const licenseId =
    typeof licenseValue.spdx === "string" ? licenseValue.spdx : undefined;
  const licenseUrl = httpsUrl(licenseValue.url);
  if (!licenseId || !licenseUrl || /(?:^|-)NC(?:-|$)/iu.test(licenseId)) {
    return undefined;
  }
  const originalUrl = `${options.endpointOrigin}/${encodeURIComponent(prefix)}/${encodeURIComponent(name)}.svg`;
  const attribution = /^CC-BY-/iu.test(licenseId);
  const license = {
    ...licenseDescriptor(
      {
        id: licenseId,
        url: licenseUrl,
        attribution,
        sourceCredit: text(collection.name, prefix),
      },
      options.now,
    ),
    modelReleaseStatus: "not_applicable" as const,
    propertyReleaseStatus: "not_applicable" as const,
    trademarkRisk: "none_declared" as const,
  };
  return {
    sourceInstanceId: options.sourceInstanceId,
    sourceRevisionId: options.sourceRevisionId,
    externalId: icon,
    kind: "vector",
    title: name.replaceAll("-", " ").slice(0, 240),
    sourcePageUrl: `https://icon-sets.iconify.design/${encodeURIComponent(prefix)}/${encodeURIComponent(name)}/`,
    license,
    providerObligations: {
      displayCreditRequired: attribution,
      hotlinkRequired: false,
      downloadEventRequired: false,
      brandingRequired: false,
      coreReplicationRestricted: false,
    },
    preview: {
      url: originalUrl,
      mediaType: "image/svg+xml",
      ...dimensions(collection.width, collection.height),
    },
    original: {
      url: originalUrl,
      mediaType: "image/svg+xml",
      ...dimensions(collection.width, collection.height),
    },
    tags: [prefix, name].map((tag) => tag.slice(0, 80)),
  };
}

const maximumFontCatalogResponseBytes = 4_194_304;
const maximumFontSearchDetails = 12;
const maximumConcurrentFontDetails = 3;
const manifestAjv = new Ajv2020({ strict: true, allErrors: true });
const registerManifestFormats = addFormats as unknown as (
  instance: Ajv2020,
) => unknown;
registerManifestFormats(manifestAjv);
const validateArtTextManifest: ValidateFunction<ArtTextPresetManifest> =
  manifestAjv.compile(ArtTextPresetManifestSchema);

function fontCategory(value: unknown): ResourceFontCandidate["category"] {
  if (value === "sans-serif") return "sans";
  if (value === "serif") return "serif";
  if (value === "display") return "display";
  if (value === "handwriting") return "handwriting";
  if (value === "monospace") return "monospace";
  return "other";
}

function fontVariant(value: string):
  | {
      readonly style: "italic" | "normal";
      readonly weight: number;
    }
  | undefined {
  if (value === "regular") return { style: "normal", weight: 400 };
  if (value === "italic") return { style: "italic", weight: 400 };
  const match = /^(\d{3})(italic)?$/u.exec(value);
  if (!match) return undefined;
  const weight = Number(match[1]);
  if (weight < 1 || weight > 1_000) return undefined;
  return { style: match[2] ? "italic" : "normal", weight };
}

function fontFileRank(
  file: ResourceFontCandidate["fileVariants"][number],
): number {
  if (file.style === "normal" && file.weight === 400) return 0;
  if (file.style === "normal" && file.weight === 700) return 1;
  return 2;
}

function preferredFontFiles(
  files: ResourceFontCandidate["fileVariants"],
): ResourceFontCandidate["fileVariants"] {
  return [...files]
    .sort(
      (left, right) =>
        fontFileRank(left) - fontFileRank(right) || left.weight - right.weight,
    )
    .slice(0, 4);
}

function configuredFontSubsets(
  options: ResourceSourceSearchOptions,
): readonly string[] {
  return Array.isArray(options.configuration.preferredSubsets)
    ? options.configuration.preferredSubsets.filter(
        (value): value is string =>
          typeof value === "string" && value.length > 0,
      )
    : [];
}

function secureFontUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    if (url.protocol === "http:") url.protocol = "https:";
    return url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function fontVersion(
  value: Readonly<Record<string, unknown>>,
): string | undefined {
  if (typeof value.version === "string") return value.version;
  return typeof value.lastModified === "string"
    ? value.lastModified
    : undefined;
}

async function googleFontLicense(
  family: string,
  options: ResourceSourceSearchOptions,
): Promise<{ readonly id: string; readonly url: string } | undefined> {
  const slug = family.toLowerCase().replace(/[^a-z0-9]/gu, "");
  const metadataOrigin =
    typeof options.configuration.metadataOrigin === "string" &&
    options.configuration.metadataOrigin.trim()
      ? options.configuration.metadataOrigin.trim()
      : "https://api.github.com";
  const candidates = [
    ["ofl", "OFL-1.1", "OFL.txt"],
    ["apache", "Apache-2.0", "LICENSE.txt"],
    ["ufl", "Ubuntu-Font-License-1.0", "LICENCE.txt"],
  ] as const;
  for (const [directory, id, filename] of candidates) {
    const response = await options.request({
      baseUrl: metadataOrigin,
      path: `/repos/google/fonts/contents/${directory}/${slug}/${filename}`,
      headers: { "user-agent": "Kanvas resource source adapter" },
    });
    if (response.statusCode === 404) continue;
    assertSuccess(response.statusCode);
    const body = record(response.body);
    const url = httpsUrl(body.html_url);
    if (url) return { id, url };
  }
  return undefined;
}

function googleFontCandidate(
  item: unknown,
  licenseInfo: { readonly id: string; readonly url: string },
  options: ResourceSourceSearchOptions,
): ResourceFontCandidate | undefined {
  const value = record(item);
  const family = typeof value.family === "string" ? value.family : undefined;
  const upstreamVersion = fontVersion(value);
  const files = value.files ? record(value.files) : {};
  const subsets = Array.isArray(value.subsets)
    ? value.subsets.filter(
        (subset): subset is string => typeof subset === "string",
      )
    : [];
  if (!family || !upstreamVersion || subsets.length < 1) return undefined;
  const configuredSubsets = configuredFontSubsets(options);
  const selectedSubset =
    configuredSubsets.find((subset) => subsets.includes(subset)) ?? subsets[0]!;
  if (
    configuredSubsets.length > 0 &&
    !configuredSubsets.some((subset) => subsets.includes(subset))
  ) {
    return undefined;
  }
  const fileVariants = preferredFontFiles(
    Object.entries(files).flatMap(([variant, rawUrl]) => {
      const parsed = fontVariant(variant);
      const url = secureFontUrl(rawUrl);
      return parsed && url
        ? [
            {
              url,
              format: "ttf" as const,
              weight: parsed.weight,
              style: parsed.style,
              subset: selectedSubset,
              pinned: true as const,
            },
          ]
        : [];
    }),
  );
  if (fileVariants.length < 1) return undefined;
  const license = {
    ...licenseDescriptor(
      {
        id: licenseInfo.id,
        url: licenseInfo.url,
        attribution: false,
        sourceCredit: "Google Fonts",
      },
      options.now,
    ),
    embeddingAllowed: true,
    modelReleaseStatus: "not_applicable" as const,
    propertyReleaseStatus: "not_applicable" as const,
    trademarkRisk: "none_declared" as const,
  };
  return {
    sourceInstanceId: options.sourceInstanceId,
    sourceRevisionId: options.sourceRevisionId,
    externalId: family,
    kind: "font",
    title: family,
    family,
    sourcePageUrl: `https://fonts.google.com/specimen/${encodeURIComponent(family)}`,
    license,
    providerObligations: {
      displayCreditRequired: false,
      hotlinkRequired: false,
      downloadEventRequired: false,
      brandingRequired: false,
      coreReplicationRestricted: false,
    },
    upstreamVersion,
    category: fontCategory(value.category),
    scripts: [...subsets],
    languages: [...subsets],
    weights: [...new Set(fileVariants.map((variant) => variant.weight))].sort(
      (left, right) => left - right,
    ),
    styles: [...new Set(fileVariants.map((variant) => variant.style))],
    fileVariants,
  };
}

function fontsourceVariantUrls(value: unknown): readonly string[] {
  if (!value || typeof value !== "object") return [];
  const urls: string[] = [];
  const visit = (current: unknown): void => {
    if (!current || typeof current !== "object") return;
    for (const [key, child] of Object.entries(
      current as Readonly<Record<string, unknown>>,
    )) {
      if (key === "ttf" && typeof child === "string") urls.push(child);
      else visit(child);
    }
  };
  visit(value);
  return urls;
}

async function fontsourceCandidate(
  listItem: unknown,
  options: ResourceSourceSearchOptions,
): Promise<ResourceFontCandidate | undefined> {
  const summary = record(listItem);
  const id = typeof summary.id === "string" ? summary.id : undefined;
  const family =
    typeof summary.family === "string" ? summary.family : undefined;
  if (!id || !family) return undefined;
  const packageRegistryOrigin =
    typeof options.configuration.packageRegistryOrigin === "string" &&
    options.configuration.packageRegistryOrigin.trim()
      ? options.configuration.packageRegistryOrigin.trim()
      : "https://registry.npmjs.org";
  const [detailResponse, packageResponse] = await Promise.all([
    options.request({
      baseUrl: options.endpointOrigin,
      path: `/v1/fonts/${encodeURIComponent(id)}`,
      headers: {},
      maximumResponseBytes: maximumFontCatalogResponseBytes,
    }),
    options.request({
      baseUrl: packageRegistryOrigin,
      path: `/@fontsource%2F${encodeURIComponent(id)}/latest`,
      headers: {},
    }),
  ]);
  assertSuccess(detailResponse.statusCode);
  assertSuccess(packageResponse.statusCode);
  const detail = record(detailResponse.body);
  const packageMetadata = record(packageResponse.body);
  const packageVersion =
    typeof packageMetadata.version === "string"
      ? packageMetadata.version
      : undefined;
  const licenseId =
    typeof packageMetadata.license === "string"
      ? packageMetadata.license
      : undefined;
  if (!packageVersion || !licenseId) return undefined;
  const configuredSubsets = configuredFontSubsets(options);
  const defaultSubset =
    typeof detail.defSubset === "string" ? detail.defSubset : undefined;
  const availableFiles = fontsourceVariantUrls(detail.variants).flatMap(
    (rawUrl) => {
      const url = secureFontUrl(rawUrl)?.replace(
        /@latest\//u,
        `@${packageVersion}/`,
      );
      const match = url
        ? /\/([^/]+)-(\d+)-(normal|italic)\.ttf$/u.exec(new URL(url).pathname)
        : undefined;
      if (!url || !match) return [];
      return [
        {
          url,
          format: "ttf" as const,
          subset: match[1]!,
          weight: Number(match[2]),
          style: match[3] as "italic" | "normal",
          pinned: true as const,
        },
      ];
    },
  );
  let selectedSubsets = configuredSubsets;
  if (selectedSubsets.length === 0 && defaultSubset) {
    selectedSubsets = [defaultSubset];
  }
  if (selectedSubsets.length === 0 && availableFiles[0]) {
    selectedSubsets = [availableFiles[0].subset];
  }
  const selectedFiles = availableFiles.filter((file) =>
    selectedSubsets.includes(file.subset),
  );
  const fileVariants = preferredFontFiles(selectedFiles);
  if (fileVariants.length < 1) return undefined;
  const subsets = Array.isArray(detail.subsets)
    ? detail.subsets.filter(
        (subset): subset is string => typeof subset === "string",
      )
    : [];
  const license = {
    ...licenseDescriptor(
      {
        id: licenseId,
        url: `https://spdx.org/licenses/${encodeURIComponent(licenseId)}.html`,
        attribution: /^CC-BY-/iu.test(licenseId),
        sourceCredit: "Fontsource",
      },
      options.now,
    ),
    embeddingAllowed: true,
    modelReleaseStatus: "not_applicable" as const,
    propertyReleaseStatus: "not_applicable" as const,
    trademarkRisk: "none_declared" as const,
  };
  return {
    sourceInstanceId: options.sourceInstanceId,
    sourceRevisionId: options.sourceRevisionId,
    externalId: id,
    kind: "font",
    title: family,
    family,
    sourcePageUrl: `https://fontsource.org/fonts/${encodeURIComponent(id)}`,
    license,
    providerObligations: {
      displayCreditRequired: license.attributionRequired,
      hotlinkRequired: false,
      downloadEventRequired: false,
      brandingRequired: false,
      coreReplicationRestricted: false,
    },
    upstreamVersion: packageVersion,
    category: fontCategory(detail.category),
    scripts: subsets.length > 0 ? [...subsets] : ["unknown"],
    languages: [...subsets],
    weights: [...new Set(fileVariants.map((variant) => variant.weight))].sort(
      (left, right) => left - right,
    ),
    styles: [...new Set(fileVariants.map((variant) => variant.style))],
    fileVariants: fileVariants.slice(0, 256),
  };
}

interface ArtTextCatalogEntry {
  readonly id: string;
  readonly revision: string;
  readonly manifestUrl: string;
  readonly previewUrl?: string;
  readonly labels: Readonly<Record<string, string>>;
}

function artTextCatalogEntries(value: unknown): readonly ArtTextCatalogEntry[] {
  const root = record(value);
  if (root.schemaVersion !== 1 || !Array.isArray(root.presets)) {
    throw new ResourceSourceAdapterError(
      "invalid_response",
      "Art Text Registry did not return a versioned preset catalog.",
    );
  }
  return root.presets.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const entry = item as Readonly<Record<string, unknown>>;
    const labels =
      entry.labels &&
      typeof entry.labels === "object" &&
      !Array.isArray(entry.labels)
        ? (entry.labels as Readonly<Record<string, string>>)
        : {};
    if (
      typeof entry.id !== "string" ||
      typeof entry.revision !== "string" ||
      typeof entry.manifestUrl !== "string" ||
      !/^sha256:[0-9a-f]{64}$/u.test(entry.revision)
    ) {
      return [];
    }
    return [
      {
        id: entry.id,
        revision: entry.revision,
        manifestUrl: entry.manifestUrl,
        ...(typeof entry.previewUrl === "string"
          ? { previewUrl: entry.previewUrl }
          : {}),
        labels,
      },
    ];
  });
}

function sameOriginPath(endpointOrigin: string, value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ResourceSourceAdapterError(
      "invalid_response",
      "Art Text Registry returned an invalid manifest URL.",
    );
  }
  if (url.protocol !== "https:" || url.origin !== endpointOrigin) {
    throw new ResourceSourceAdapterError(
      "invalid_response",
      "Art Text Registry manifests must remain on the configured origin.",
    );
  }
  return `${url.pathname}${url.search}`;
}

async function artTextCandidate(
  entry: ArtTextCatalogEntry,
  options: ResourceSourceSearchOptions,
): Promise<ResourceArtTextCandidate | undefined> {
  const response = await options.request({
    baseUrl: options.endpointOrigin,
    path: sameOriginPath(options.endpointOrigin, entry.manifestUrl),
    headers: {},
  });
  assertSuccess(response.statusCode);
  if (!validateArtTextManifest(response.body)) return undefined;
  const manifest = response.body;
  if (manifest.id !== entry.id || manifest.revision !== entry.revision) {
    return undefined;
  }
  const title = Object.values(entry.labels)[0] ?? entry.id;
  const previewUrl = entry.previewUrl ? httpsUrl(entry.previewUrl) : undefined;
  const candidate: ResourceArtTextCandidate = {
    sourceInstanceId: options.sourceInstanceId,
    sourceRevisionId: options.sourceRevisionId,
    externalId: entry.id,
    kind: "art_text",
    title: title.slice(0, 240),
    sourcePageUrl: entry.manifestUrl,
    license: manifest.license,
    providerObligations: {
      displayCreditRequired: manifest.license.attributionRequired,
      hotlinkRequired: false,
      downloadEventRequired: false,
      brandingRequired: false,
      coreReplicationRestricted: false,
    },
    manifest,
    ...(previewUrl ? { previewUrl } : {}),
  };
  return allowedCandidate(options.licensePolicy, candidate)
    ? candidate
    : undefined;
}

const adapters: Readonly<Record<string, ResourceSourceAdapter>> = Object.freeze(
  {
    "openverse.v1": adapter({
      descriptor: {
        adapterKind: "openverse.v1",
        adapterVersion: "1.0.0",
        displayName: "Openverse",
        description: "Open-licensed and public-domain images",
        descriptions: {
          en: "Open-licensed and public-domain images",
          "zh-Hans": "开放许可与公共领域图片",
        },
        iconPath: "/resource-source-icons/openverse.svg",
        resourceKinds: ["image"],
        capabilities: ["image.search", "image.import"],
        authModes: ["none"],
        defaultEndpointOrigin: "https://api.openverse.org",
        configurationFields: [
          {
            key: "allowedSources",
            label: "Content sources",
            labels: {
              en: "Content sources",
              "zh-Hans": "内容来源",
            },
            help: "Leave empty to search every available source.",
            helps: {
              en: "Leave empty to search every available source.",
              "zh-Hans": "默认使用全部来源；选择后仅搜索指定来源。",
            },
            suggestions: [
              { value: "wikimedia", label: "Wikimedia Commons" },
              { value: "flickr", label: "Flickr" },
              { value: "nasa", label: "NASA" },
              { value: "met", label: "The Met" },
              { value: "rawpixel", label: "Rawpixel" },
            ],
            inputKind: "string_list",
            required: false,
          },
        ],
      },
      capabilities: ["image.search", "image.import"] as const,
      async probe({ endpointOrigin, request }) {
        const body = record(
          await getJson(request, {
            endpointOrigin,
            path: "/v1/images/?q=landscape&page_size=1",
          }),
        );
        if (!Array.isArray(body.results)) {
          throw new ResourceSourceAdapterError(
            "invalid_response",
            "Openverse did not return an image result collection.",
          );
        }
        return { resultCount: body.results.length };
      },
      async search(options) {
        const page = pageCursor(options.cursor);
        const filters = openverseSearchFilters(options);
        const pageSize = Math.min(
          options.limit,
          maximumAnonymousOpenversePageSize,
        );
        const body = record(
          await getJson(options.request, {
            endpointOrigin: options.endpointOrigin,
            path: `/v1/images/?q=${encodeURIComponent(options.query)}&page=${String(page)}&page_size=${String(pageSize)}${filters}`,
          }),
        );
        const results = Array.isArray(body.results) ? body.results : [];
        const candidates = results
          .map((item) => openverseCandidate(item, options))
          .filter((candidate) =>
            allowedCandidate(options.licensePolicy, candidate),
          );
        const cursor = nextPage(page, results.length, pageSize);
        return {
          candidates,
          ...(cursor ? { nextCursor: cursor } : {}),
        };
      },
      async resolve(options) {
        const value = await getJson(options.request, {
          endpointOrigin: options.endpointOrigin,
          path: `/v1/images/${encodeURIComponent(options.externalId)}/`,
        });
        const candidate = openverseCandidate(value, {
          ...options,
          query: options.externalId,
          limit: 1,
        });
        if (!allowedCandidate(options.licensePolicy, candidate)) {
          throw new ResourceSourceAdapterError(
            "invalid_response",
            "Openverse resource is unavailable under the current license policy.",
          );
        }
        return candidate;
      },
    }),
    "pexels.v1": adapter({
      descriptor: {
        adapterKind: "pexels.v1",
        adapterVersion: "1.0.0",
        displayName: "Pexels",
        description: "Curated photography",
        descriptions: { en: "Curated photography", "zh-Hans": "精选摄影图片" },
        iconPath: "/resource-source-icons/pexels.svg",
        resourceKinds: ["image"],
        capabilities: ["image.search", "image.import"],
        authModes: ["api_key"],
        defaultEndpointOrigin: "https://api.pexels.com",
        credentialLabel: "API key",
        credentialLabels: { en: "API key", "zh-Hans": "API 密钥" },
        configurationFields: [],
      },
      capabilities: ["image.search", "image.import"] as const,
      async probe({ endpointOrigin, material, request }) {
        const body = record(
          await getJson(request, {
            endpointOrigin,
            path: "/v1/search?query=landscape&per_page=1",
            headers: { authorization: credentialText(material) },
          }),
        );
        if (!Array.isArray(body.photos)) {
          throw new ResourceSourceAdapterError(
            "invalid_response",
            "Pexels did not return a photo collection.",
          );
        }
        return { resultCount: body.photos.length };
      },
      async search(options) {
        const page = pageCursor(options.cursor);
        const body = record(
          await getJson(options.request, {
            endpointOrigin: options.endpointOrigin,
            path: `/v1/search?query=${encodeURIComponent(options.query)}&page=${String(page)}&per_page=${String(options.limit)}`,
            headers: { authorization: credentialText(options.material) },
          }),
        );
        const results = Array.isArray(body.photos) ? body.photos : [];
        const candidates = results
          .map((item) => pexelsCandidate(item, options))
          .filter((candidate) =>
            allowedCandidate(options.licensePolicy, candidate),
          );
        const cursor = nextPage(page, results.length, options.limit);
        return { candidates, ...(cursor ? { nextCursor: cursor } : {}) };
      },
      async resolve(options) {
        const value = await getJson(options.request, {
          endpointOrigin: options.endpointOrigin,
          path: `/v1/photos/${encodeURIComponent(options.externalId)}`,
          headers: { authorization: credentialText(options.material) },
        });
        const candidate = pexelsCandidate(value, {
          ...options,
          query: options.externalId,
          limit: 1,
        });
        if (!allowedCandidate(options.licensePolicy, candidate)) {
          throw new ResourceSourceAdapterError(
            "invalid_response",
            "Pexels resource is unavailable under the current license policy.",
          );
        }
        return candidate;
      },
    }),
    "pixabay.v1": adapter({
      descriptor: {
        adapterKind: "pixabay.v1",
        adapterVersion: "1.0.0",
        displayName: "Pixabay",
        description: "Photos and illustrations",
        descriptions: {
          en: "Photos and illustrations",
          "zh-Hans": "图片与插画素材",
        },
        iconPath: "/resource-source-icons/pixabay.svg",
        resourceKinds: ["image"],
        capabilities: ["image.search", "image.import"],
        authModes: ["api_key"],
        defaultEndpointOrigin: "https://pixabay.com",
        credentialLabel: "API key",
        credentialLabels: { en: "API key", "zh-Hans": "API 密钥" },
        configurationFields: [
          {
            key: "safeSearch",
            label: "Safe search",
            labels: { en: "Safe search", "zh-Hans": "安全搜索" },
            help: "Filter mature content from search results.",
            helps: {
              en: "Filter mature content from search results.",
              "zh-Hans": "过滤可能不适合工作场景的内容。",
            },
            inputKind: "boolean",
            required: false,
          },
        ],
      },
      capabilities: ["image.search", "image.import"] as const,
      async probe({ endpointOrigin, material, request }) {
        const key = encodeURIComponent(credentialText(material));
        const body = record(
          await getJson(request, {
            endpointOrigin,
            path: `/api/?key=${key}&q=landscape&per_page=3`,
          }),
        );
        if (!Array.isArray(body.hits)) {
          throw new ResourceSourceAdapterError(
            "invalid_response",
            "Pixabay did not return an image collection.",
          );
        }
        return { resultCount: body.hits.length };
      },
      async search(options) {
        const page = pageCursor(options.cursor);
        const key = encodeURIComponent(credentialText(options.material));
        const safeSearch =
          options.configuration.safeSearch === false ? "false" : "true";
        const body = record(
          await getJson(options.request, {
            endpointOrigin: options.endpointOrigin,
            path: `/api/?key=${key}&q=${encodeURIComponent(options.query)}&page=${String(page)}&per_page=${String(options.limit)}&safesearch=${safeSearch}`,
          }),
        );
        const results = Array.isArray(body.hits) ? body.hits : [];
        const candidates = results
          .map((item) => pixabayCandidate(item, options))
          .filter((candidate) =>
            allowedCandidate(options.licensePolicy, candidate),
          );
        const cursor = nextPage(page, results.length, options.limit);
        return { candidates, ...(cursor ? { nextCursor: cursor } : {}) };
      },
      async resolve(options) {
        const key = encodeURIComponent(credentialText(options.material));
        const body = record(
          await getJson(options.request, {
            endpointOrigin: options.endpointOrigin,
            path: `/api/?key=${key}&id=${encodeURIComponent(options.externalId)}`,
          }),
        );
        const candidate = pixabayCandidate(
          Array.isArray(body.hits) ? body.hits[0] : undefined,
          { ...options, query: options.externalId, limit: 1 },
        );
        if (!allowedCandidate(options.licensePolicy, candidate)) {
          throw new ResourceSourceAdapterError(
            "invalid_response",
            "Pixabay resource is unavailable under the current license policy.",
          );
        }
        return candidate;
      },
    }),
    "iconify.v1": adapter({
      descriptor: {
        adapterKind: "iconify.v1",
        adapterVersion: "1.0.0",
        displayName: "Iconify",
        description: "Open-source icon collections",
        descriptions: {
          en: "Open-source icon collections",
          "zh-Hans": "开源图标合集",
        },
        iconPath: "/resource-source-icons/iconify.svg",
        resourceKinds: ["vector"],
        capabilities: ["vector.search", "vector.import"],
        authModes: ["none"],
        defaultEndpointOrigin: "https://api.iconify.design",
        configurationFields: [
          {
            key: "allowedCollections",
            label: "Icon collections",
            labels: {
              en: "Icon collections",
              "zh-Hans": "图标集",
            },
            help: "Leave empty to search every available icon collection.",
            helps: {
              en: "Leave empty to search every available icon collection.",
              "zh-Hans": "默认使用全部图标集；选择后仅搜索指定图标集。",
            },
            suggestions: [
              { value: "lucide", label: "Lucide" },
              { value: "material-symbols", label: "Material Symbols" },
              { value: "mdi", label: "Material Design Icons" },
              { value: "tabler", label: "Tabler Icons" },
              { value: "heroicons", label: "Heroicons" },
              { value: "ph", label: "Phosphor" },
            ],
            inputKind: "string_list",
            required: false,
          },
        ],
      },
      capabilities: ["vector.search", "vector.import"] as const,
      async probe({ endpointOrigin, request }) {
        const body = record(
          await getJson(request, {
            endpointOrigin,
            path: "/search?query=home&limit=32",
          }),
        );
        if (!Array.isArray(body.icons)) {
          throw new ResourceSourceAdapterError(
            "invalid_response",
            "Iconify did not return icons with collection metadata.",
          );
        }
        record(body.collections);
        return { resultCount: body.icons.length };
      },
      async search(options) {
        const start = Math.max(
          0,
          (pageCursor(options.cursor) - 1) * options.limit,
        );
        const allowedCollections = Array.isArray(
          options.configuration.allowedCollections,
        )
          ? options.configuration.allowedCollections.filter(
              (value): value is string => typeof value === "string",
            )
          : [];
        const collectionQuery =
          allowedCollections.length > 0
            ? `&prefixes=${encodeURIComponent(allowedCollections.join(","))}`
            : "";
        const body = record(
          await getJson(options.request, {
            endpointOrigin: options.endpointOrigin,
            path: `/search?query=${encodeURIComponent(options.query)}&limit=${String(options.limit)}&start=${String(start)}${collectionQuery}`,
          }),
        );
        const icons = Array.isArray(body.icons) ? body.icons : [];
        const collections = record(body.collections);
        const candidates = icons
          .map((icon) => iconifyCandidate(icon, collections, options))
          .filter((candidate) =>
            allowedCandidate(options.licensePolicy, candidate),
          );
        const page = pageCursor(options.cursor);
        const cursor = nextPage(page, icons.length, options.limit);
        return { candidates, ...(cursor ? { nextCursor: cursor } : {}) };
      },
    }),
    "fontsource.v1": adapter({
      descriptor: {
        adapterKind: "fontsource.v1",
        adapterVersion: "1.0.0",
        displayName: "Fontsource",
        description: "Self-hostable open-source fonts",
        descriptions: {
          en: "Self-hostable open-source fonts",
          "zh-Hans": "可自托管的开源字体",
        },
        iconPath: "/resource-source-icons/fontsource.svg",
        resourceKinds: ["font"],
        capabilities: ["font.list", "font.import"],
        authModes: ["none"],
        defaultEndpointOrigin: "https://api.fontsource.org",
        configurationFields: [
          {
            key: "preferredSubsets",
            label: "Language coverage",
            labels: {
              en: "Language coverage",
              "zh-Hans": "语言范围",
            },
            help: "Leave empty to allow every language subset.",
            helps: {
              en: "Leave empty to allow every language subset.",
              "zh-Hans": "默认允许全部语言；选择后优先采用相应字体文件。",
            },
            suggestions: [
              {
                value: "latin",
                label: "Latin",
                labels: { "zh-Hans": "拉丁文" },
              },
              {
                value: "latin-ext",
                label: "Latin Extended",
                labels: { "zh-Hans": "扩展拉丁文" },
              },
              {
                value: "chinese-simplified",
                label: "Simplified Chinese",
                labels: { "zh-Hans": "简体中文" },
              },
              {
                value: "chinese-traditional",
                label: "Traditional Chinese",
                labels: { "zh-Hans": "繁体中文" },
              },
              {
                value: "japanese",
                label: "Japanese",
                labels: { "zh-Hans": "日文" },
              },
              {
                value: "korean",
                label: "Korean",
                labels: { "zh-Hans": "韩文" },
              },
              {
                value: "cyrillic",
                label: "Cyrillic",
                labels: { "zh-Hans": "西里尔文" },
              },
              {
                value: "arabic",
                label: "Arabic",
                labels: { "zh-Hans": "阿拉伯文" },
              },
            ],
            inputKind: "string_list",
            required: false,
          },
        ],
      },
      capabilities: ["font.list", "font.import"] as const,
      async probe({ endpointOrigin, request }) {
        const body = record(
          await getJson(request, {
            endpointOrigin,
            path: "/v1/fonts/inter",
          }),
        );
        if (
          typeof body.id !== "string" ||
          typeof body.family !== "string" ||
          !body.variants ||
          typeof body.variants !== "object"
        ) {
          throw new ResourceSourceAdapterError(
            "invalid_response",
            "Fontsource did not return a font descriptor.",
          );
        }
        return { probeFontId: body.id };
      },
      async search(options) {
        const body = await getJson(options.request, {
          endpointOrigin: options.endpointOrigin,
          path: "/v1/fonts",
          maximumResponseBytes: maximumFontCatalogResponseBytes,
        });
        if (!Array.isArray(body)) {
          throw new ResourceSourceAdapterError(
            "invalid_response",
            "Fontsource did not return a font collection.",
          );
        }
        const query = options.query.toLowerCase();
        const page = pageCursor(options.cursor);
        const offset =
          (page - 1) * Math.min(options.limit, maximumFontSearchDetails);
        const matches = body
          .filter((item) => {
            if (!item || typeof item !== "object") return false;
            const value = item as Readonly<Record<string, unknown>>;
            return [value.id, value.family].some(
              (candidate) =>
                typeof candidate === "string" &&
                candidate.toLowerCase().includes(query),
            );
          })
          .slice(
            offset,
            offset + Math.min(options.limit, maximumFontSearchDetails),
          );
        const candidates: ResourceFontCandidate[] = [];
        let firstError: unknown;
        for (
          let index = 0;
          index < matches.length;
          index += maximumConcurrentFontDetails
        ) {
          const outcomes = await Promise.allSettled(
            matches
              .slice(index, index + maximumConcurrentFontDetails)
              .map((item) => fontsourceCandidate(item, options)),
          );
          for (const outcome of outcomes) {
            if (outcome.status === "rejected") {
              firstError ??= outcome.reason;
            } else if (allowedCandidate(options.licensePolicy, outcome.value)) {
              candidates.push(outcome.value);
            }
          }
        }
        if (candidates.length === 0 && firstError) {
          throw firstError instanceof Error
            ? firstError
            : new Error("Font details are unavailable.");
        }
        const cursor = nextPage(
          page,
          matches.length,
          Math.min(options.limit, maximumFontSearchDetails),
        );
        return { candidates, ...(cursor ? { nextCursor: cursor } : {}) };
      },
    }),
    "google-fonts.v1": adapter({
      descriptor: {
        adapterKind: "google-fonts.v1",
        adapterVersion: "1.0.0",
        displayName: "Google Fonts",
        description: "Google's open-source font catalog",
        descriptions: {
          en: "Google's open-source font catalog",
          "zh-Hans": "Google 开源字体目录",
        },
        iconPath: "/resource-source-icons/google-fonts.svg",
        resourceKinds: ["font"],
        capabilities: ["font.list", "font.import"],
        authModes: ["api_key"],
        defaultEndpointOrigin: "https://www.googleapis.com",
        credentialLabel: "Developer API key",
        credentialLabels: {
          en: "Developer API key",
          "zh-Hans": "开发者 API 密钥",
        },
        configurationFields: [
          {
            key: "preferredSubsets",
            label: "Language coverage",
            labels: {
              en: "Language coverage",
              "zh-Hans": "语言范围",
            },
            help: "Leave empty to allow every language subset.",
            helps: {
              en: "Leave empty to allow every language subset.",
              "zh-Hans": "默认允许全部语言；选择后优先展示对应字体。",
            },
            suggestions: [
              {
                value: "latin",
                label: "Latin",
                labels: { "zh-Hans": "拉丁文" },
              },
              {
                value: "chinese-simplified",
                label: "Simplified Chinese",
                labels: { "zh-Hans": "简体中文" },
              },
              {
                value: "chinese-traditional",
                label: "Traditional Chinese",
                labels: { "zh-Hans": "繁体中文" },
              },
              {
                value: "japanese",
                label: "Japanese",
                labels: { "zh-Hans": "日文" },
              },
              {
                value: "korean",
                label: "Korean",
                labels: { "zh-Hans": "韩文" },
              },
              {
                value: "cyrillic",
                label: "Cyrillic",
                labels: { "zh-Hans": "西里尔文" },
              },
              {
                value: "arabic",
                label: "Arabic",
                labels: { "zh-Hans": "阿拉伯文" },
              },
            ],
            inputKind: "string_list",
            required: false,
          },
        ],
      },
      capabilities: ["font.list", "font.import"] as const,
      async probe({ endpointOrigin, material, request }) {
        const key = encodeURIComponent(credentialText(material));
        const body = record(
          await getJson(request, {
            endpointOrigin,
            path: `/webfonts/v1/webfonts?key=${key}&sort=alpha`,
          }),
        );
        if (!Array.isArray(body.items)) {
          throw new ResourceSourceAdapterError(
            "invalid_response",
            "Google Fonts did not return a font collection.",
          );
        }
        return { resultCount: body.items.length };
      },
      async search(options) {
        const key = encodeURIComponent(credentialText(options.material));
        const body = record(
          await getJson(options.request, {
            endpointOrigin: options.endpointOrigin,
            path: `/webfonts/v1/webfonts?key=${key}&sort=alpha`,
            maximumResponseBytes: maximumFontCatalogResponseBytes,
          }),
        );
        const query = options.query.toLowerCase();
        const matches = (Array.isArray(body.items) ? body.items : [])
          .filter((item) => {
            if (!item || typeof item !== "object") return false;
            const family = (item as Readonly<Record<string, unknown>>).family;
            return (
              typeof family === "string" && family.toLowerCase().includes(query)
            );
          })
          .slice(0, Math.min(options.limit, maximumFontSearchDetails));
        const candidates = (
          await Promise.all(
            matches.map(async (item) => {
              const family = String(
                (item as Readonly<Record<string, unknown>>).family,
              );
              const license = await googleFontLicense(family, options);
              return license
                ? googleFontCandidate(item, license, options)
                : undefined;
            }),
          )
        ).filter((candidate) =>
          allowedCandidate(options.licensePolicy, candidate),
        );
        return { candidates };
      },
    }),
    "art-text-registry.v1": adapter({
      descriptor: {
        adapterKind: "art-text-registry.v1",
        adapterVersion: "1.0.0",
        displayName: "Art Text Registry",
        description: "Editable team art-text styles",
        descriptions: {
          en: "Editable team art-text styles",
          "zh-Hans": "团队可编辑艺术字样式",
        },
        iconPath: "/resource-source-icons/kanvas.svg",
        resourceKinds: ["art_text"],
        capabilities: ["art_text.list", "art_text.import"],
        authModes: ["none"],
        configurationFields: [],
      },
      capabilities: ["art_text.list", "art_text.import"] as const,
      async probe({ endpointOrigin, request }) {
        const body = await getJson(request, {
          endpointOrigin,
          path: "/catalog.json",
        });
        return { presetCount: artTextCatalogEntries(body).length };
      },
      async search(options) {
        const catalogPath =
          typeof options.configuration.catalogPath === "string" &&
          options.configuration.catalogPath.startsWith("/")
            ? options.configuration.catalogPath
            : "/catalog.json";
        const entries = artTextCatalogEntries(
          await getJson(options.request, {
            endpointOrigin: options.endpointOrigin,
            path: catalogPath,
            maximumResponseBytes: maximumFontCatalogResponseBytes,
          }),
        );
        const query = options.query.toLowerCase();
        const page = pageCursor(options.cursor);
        const offset = (page - 1) * options.limit;
        const matches = entries
          .filter((entry) =>
            [entry.id, ...Object.values(entry.labels)].some((value) =>
              value.toLowerCase().includes(query),
            ),
          )
          .slice(offset, offset + options.limit);
        const candidates = (
          await Promise.all(
            matches.map((entry) => artTextCandidate(entry, options)),
          )
        ).filter((candidate): candidate is ResourceArtTextCandidate =>
          Boolean(candidate),
        );
        const cursor = nextPage(page, matches.length, options.limit);
        return { candidates, ...(cursor ? { nextCursor: cursor } : {}) };
      },
    }),
  },
);

export function resourceSourceAdapterCapabilities(
  adapterKind: string,
): readonly ResourceSourceCapability[] {
  const adapter = adapters[adapterKind];
  if (!adapter) {
    throw new ResourceSourceAdapterError(
      "adapter_not_found",
      "The configured resource source Adapter is unavailable.",
    );
  }
  return adapter.capabilities;
}

export function resourceSourceAdapterType(
  adapterKind: string,
): ResourceSourceType {
  const entry = adapters[adapterKind];
  if (!entry) {
    throw new ResourceSourceAdapterError(
      "adapter_not_found",
      "The configured resource source Adapter is unavailable.",
    );
  }
  return entry.descriptor;
}

export function listResourceSourceAdapterTypes(): readonly ResourceSourceType[] {
  return Object.freeze(
    Object.values(adapters).map((entry) => Object.freeze(entry.descriptor)),
  );
}

export async function validateResourceSourceAdapter(options: {
  readonly adapterKind: string;
  readonly endpointOrigin: string;
  readonly material?: Uint8Array;
  readonly request: ProviderProbeRequester;
}): Promise<ResourceSourceAdapterValidation> {
  const adapter = adapters[options.adapterKind];
  if (!adapter) {
    throw new ResourceSourceAdapterError(
      "adapter_not_found",
      "The configured resource source Adapter is unavailable.",
    );
  }
  try {
    const evidence = await adapter.probe(options);
    return Object.freeze({
      capabilities: adapter.capabilities,
      validationDigest: digestProviderValue({
        adapterKind: options.adapterKind,
        adapterVersion: "1",
        evidence,
      }),
      reasonCode: "resource_source.connection_verified" as const,
    });
  } catch (error) {
    if (error instanceof ResourceSourceAdapterError) {
      throw error;
    }
    throw new ResourceSourceAdapterError(
      "unavailable",
      "The resource source could not be validated.",
      { cause: error },
    );
  }
}

export async function searchResourceSourceAdapter(
  options: ResourceSourceSearchOptions & { readonly adapterKind: string },
): Promise<ResourceSourceSearchResult> {
  const entry = adapters[options.adapterKind];
  if (!entry?.search) {
    throw new ResourceSourceAdapterError(
      "adapter_not_found",
      "The configured resource source Adapter does not support catalog search.",
    );
  }
  try {
    return await entry.search(options);
  } catch (error) {
    if (error instanceof ResourceSourceAdapterError) throw error;
    throw new ResourceSourceAdapterError(
      "unavailable",
      "The resource catalog search could not be completed.",
      { cause: error },
    );
  }
}

export async function resolveResourceSourceCandidate(
  options: ResourceSourceResolveOptions & { readonly adapterKind: string },
): Promise<ResourceCandidate> {
  const entry = adapters[options.adapterKind];
  if (!entry) {
    throw new ResourceSourceAdapterError(
      "adapter_not_found",
      "The configured resource source Adapter is unavailable.",
    );
  }
  if (entry.resolve) return entry.resolve(options);
  if (entry.search) {
    const result = await entry.search({
      ...options,
      query: options.externalId,
      limit: 50,
    });
    const candidate = result.candidates.find(
      (item) => item.externalId === options.externalId,
    );
    if (candidate) return candidate;
  }
  throw new ResourceSourceAdapterError(
    "invalid_response",
    "The selected external resource could not be resolved again.",
  );
}
