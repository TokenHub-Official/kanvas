import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

import sharp from "sharp";

import {
  assessQuality,
  composeBackground,
  denoiseBrowserPixels,
  enhanceBrowserLightPixels,
  extractPalette,
  suggestCrops,
  type RgbaImage,
} from "@kanvas/image-atomic-core";
import {
  createAwsS3CompatibleOperations,
  loadStorageAdapterConfig,
} from "@kanvas/storage";
import { defaultCatalogImplementationDigests } from "../src/default-catalog-implementation-digests.js";
import { buildPacketFileIntegrity } from "../src/designer-review-packet.js";

interface SourceSelection {
  readonly schemaVersion: "kanvas.image-atomic-review-source-selection/v1";
  readonly workspaceId: string;
  readonly dataClassification: "internal";
  readonly sources: readonly {
    readonly artifactId: string;
    readonly byteSize: number;
    readonly categories: readonly string[];
    readonly container: string;
    readonly filename: string;
    readonly id: string;
    readonly mediaType: string;
    readonly objectKey: string;
    readonly sha256: string;
    readonly storageProfileId: string;
  }[];
}

const workspaceRoot = resolve(import.meta.dirname, "../../..");
const selectionPath = resolve(
  workspaceRoot,
  "eval-data/image-atomic-designer-review-v1/source-selection.json",
);
const outputRoot = resolve(
  workspaceRoot,
  "artifacts/atom-foundation-review-v1",
);
const previewWidth = 240;
const previewHeight = 180;
const tileWidth = 260;
const tileHeight = 225;
const columns = ["source", "denoise", "light", "compose"] as const;

function digestBytes(value: Uint8Array | Uint8ClampedArray): string {
  return `sha256:${createHash("sha256")
    .update(Uint8Array.from(value))
    .digest("hex")}`;
}

function artifactId(value: unknown): value is string {
  return (
    typeof value === "string" && /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u.test(value)
  );
}

function sha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

function parseSelection(value: unknown): SourceSelection {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Review source selection must be an object.");
  }
  const input = value as Readonly<Record<string, unknown>>;
  if (
    input.schemaVersion !== "kanvas.image-atomic-review-source-selection/v1" ||
    input.dataClassification !== "internal" ||
    !artifactId(input.workspaceId) ||
    !Array.isArray(input.sources) ||
    input.sources.length < 1 ||
    input.sources.length > 32
  ) {
    throw new TypeError("Review source selection identity is invalid.");
  }
  const ids = new Set<string>();
  const sources = input.sources.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError("Review source is invalid.");
    }
    const source = value as Readonly<Record<string, unknown>>;
    if (
      typeof source.id !== "string" ||
      !/^[a-z0-9][a-z0-9-]{0,79}$/u.test(source.id) ||
      ids.has(source.id) ||
      !artifactId(source.artifactId) ||
      !artifactId(source.storageProfileId) ||
      typeof source.filename !== "string" ||
      typeof source.container !== "string" ||
      typeof source.objectKey !== "string" ||
      typeof source.mediaType !== "string" ||
      !Number.isSafeInteger(source.byteSize) ||
      (source.byteSize as number) < 1 ||
      !sha256(source.sha256) ||
      !Array.isArray(source.categories) ||
      source.categories.some((category) => typeof category !== "string")
    ) {
      throw new TypeError("Review source fields are invalid.");
    }
    ids.add(source.id);
    return Object.freeze({
      id: source.id,
      artifactId: source.artifactId,
      storageProfileId: source.storageProfileId,
      filename: source.filename,
      container: source.container,
      objectKey: source.objectKey,
      mediaType: source.mediaType,
      byteSize: source.byteSize as number,
      sha256: source.sha256,
      categories: Object.freeze([...(source.categories as string[])]),
    });
  });
  return Object.freeze({
    schemaVersion: "kanvas.image-atomic-review-source-selection/v1",
    workspaceId: input.workspaceId,
    dataClassification: "internal",
    sources: Object.freeze(sources),
  });
}

async function collect(
  body: AsyncIterable<Uint8Array>,
  maximum: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of body) {
    size += chunk.byteLength;
    if (size > maximum) {
      throw new RangeError("Review source exceeds its committed size.");
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function normalizedImage(bytes: Buffer): Promise<RgbaImage> {
  const { data, info } = await sharp(bytes, {
    failOn: "warning",
    limitInputPixels: 100_000_000,
  })
    .rotate()
    .resize({
      width: 1600,
      height: 1600,
      fit: "inside",
      withoutEnlargement: true,
    })
    .ensureAlpha()
    .raw()
    .toBuffer({
      resolveWithObject: true,
    });
  return Object.freeze({
    data: new Uint8ClampedArray(data),
    width: info.width,
    height: info.height,
  });
}

async function preview(image: RgbaImage): Promise<Buffer> {
  return sharp(Buffer.from(image.data), {
    raw: {
      width: image.width,
      height: image.height,
      channels: 4,
    },
  })
    .flatten({
      background: "#F3F4F6",
    })
    .resize(previewWidth, previewHeight, {
      fit: "contain",
      background: "#F3F4F6",
    })
    .png({
      compressionLevel: 9,
      adaptiveFiltering: false,
    })
    .toBuffer();
}

function xml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function label(value: string): Buffer {
  return Buffer.from(
    `<svg width="${String(previewWidth)}" height="34" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#111827"/>
      <text x="10" y="22" font-family="Arial, sans-serif" font-size="13" fill="#F9FAFB">${xml(value)}</text>
    </svg>`,
  );
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), {
    recursive: true,
  });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const selection = parseSelection(
  JSON.parse(await readFile(selectionPath, "utf8")) as unknown,
);
const storage = loadStorageAdapterConfig(process.env, "development");
if (!storage || storage.kind !== "s3") {
  throw new Error(
    "Designer review packet currently requires the configured S3 profile.",
  );
}
const operations = createAwsS3CompatibleOperations({
  endpoint: storage.endpoint,
  region: storage.region,
  forcePathStyle: storage.forcePathStyle,
  ...(storage.credentials
    ? {
        credentials: storage.credentials,
      }
    : {}),
});

await mkdir(resolve(outputRoot, "previews"), {
  recursive: true,
});
await mkdir(resolve(outputRoot, "analysis"), {
  recursive: true,
});

const packetSources = [];
const contactTiles: Array<{
  readonly image: Buffer;
  readonly label: string;
}> = [];

try {
  for (const source of selection.sources) {
    if (
      source.storageProfileId !== storage.profileId ||
      source.container !== storage.container
    ) {
      throw new Error(
        `Review source ${source.id} is outside the configured storage profile.`,
      );
    }
    const head = await operations.headObject(
      source.container,
      source.objectKey,
    );
    if (
      !head ||
      head.contentLength !== String(source.byteSize) ||
      head.metadata["kanvas-sha256"] !== source.sha256
    ) {
      throw new Error(
        `Review source ${source.id} no longer matches committed storage facts.`,
      );
    }
    const opened = await operations.getObject({
      bucket: source.container,
      key: source.objectKey,
      ifMatch: head.etag,
    });
    const bytes = await collect(opened.body, source.byteSize);
    if (
      bytes.byteLength !== source.byteSize ||
      digestBytes(bytes) !== `sha256:${source.sha256}`
    ) {
      throw new Error(
        `Review source ${source.id} bytes do not match their Artifact digest.`,
      );
    }

    const original = await normalizedImage(bytes);
    const denoisedResult = denoiseBrowserPixels({
      pixels: new Uint8ClampedArray(original.data),
      width: original.width,
      height: original.height,
      strength: 0.6,
    });
    const denoised = Object.freeze({
      data: denoisedResult.pixels,
      width: original.width,
      height: original.height,
    });
    const quality = assessQuality(original, {
      sourceArtifactId: source.artifactId,
      subjectBounds: [],
      sampleSize: 256,
    });
    const lightParameters = Object.freeze({
      exposureStops: quality.underExposureRatio >= 0.2 ? 0.5 : 0.15,
      shadows: quality.underExposureRatio >= 0.1 ? 0.2 : 0.05,
      highlights: quality.overExposureRatio >= 0.1 ? -0.2 : -0.05,
      temperature: 0,
      tint: 0,
    });
    const enhancedResult = enhanceBrowserLightPixels({
      pixels: new Uint8ClampedArray(original.data),
      width: original.width,
      height: original.height,
      parameters: lightParameters,
    });
    const enhanced = Object.freeze({
      data: enhancedResult.pixels,
      width: original.width,
      height: original.height,
    });
    const insetX = Math.round(original.width * 0.1);
    const insetY = Math.round(original.height * 0.1);
    const composed = composeBackground({
      foreground: original,
      input: {
        foregroundArtifactId: source.artifactId,
        background: {
          kind: "color",
          color: "#E5E7EBFF",
        },
        canvas: {
          width: original.width,
          height: original.height,
        },
        placement: {
          x: insetX,
          y: insetY,
          width: Math.max(1, original.width - insetX * 2),
          height: Math.max(1, original.height - insetY * 2),
          fit: "contain",
          opacity: 1,
        },
      },
    });
    const crop = suggestCrops(original, {
      sourceArtifactId: source.artifactId,
      aspectRatios: ["1:1", "4:5", "16:9"],
      maxSuggestionsPerRatio: 3,
      safeMarginRatio: 0.05,
      subjectBounds: [],
    });
    const palette = extractPalette(original, {
      sourceArtifactId: source.artifactId,
      colorCount: 6,
      alphaThreshold: 16,
      sampleSize: 256,
    });

    const candidateImages = {
      source: original,
      denoise: denoised,
      light: enhanced,
      compose: composed.image,
    };
    const previews: Record<string, string> = {};
    for (const [kind, image] of Object.entries(candidateImages)) {
      const bytes = await preview(image);
      const path = resolve(outputRoot, "previews", `${source.id}-${kind}.png`);
      await writeFile(path, bytes);
      previews[kind] = relative(outputRoot, path);
      contactTiles.push({
        image: bytes,
        label: `${source.id} · ${kind}`,
      });
    }

    const analysisPath = resolve(outputRoot, "analysis", `${source.id}.json`);
    await writeJson(analysisPath, {
      schemaVersion: "kanvas.image-atomic-review-analysis/v1",
      sourceArtifactId: source.artifactId,
      normalizedReviewSource: {
        width: original.width,
        height: original.height,
        rgbaDigest: digestBytes(original.data),
      },
      crop: {
        implementationDigest: defaultCatalogImplementationDigests.cropBrowser,
        suggestions: crop,
      },
      palette: {
        implementationDigest:
          defaultCatalogImplementationDigests.paletteBrowser,
        ...palette,
      },
      quality: {
        implementationDigest:
          defaultCatalogImplementationDigests.qualityBrowser,
        ...quality,
      },
    });

    packetSources.push({
      id: source.id,
      artifactId: source.artifactId,
      filename: source.filename,
      categories: source.categories,
      sourceDigest: `sha256:${source.sha256}`,
      normalizedReviewSource: {
        width: original.width,
        height: original.height,
        rgbaDigest: digestBytes(original.data),
      },
      previews,
      analysisFile: relative(outputRoot, analysisPath),
      candidates: {
        denoise: {
          implementationDigest:
            defaultCatalogImplementationDigests.denoiseBrowser,
          parameters: {
            strength: 0.6,
          },
          rgbaDigest: digestBytes(denoised.data),
          noiseEstimate: denoisedResult.noiseEstimate,
        },
        lightEnhance: {
          implementationDigest:
            defaultCatalogImplementationDigests.lightEnhanceBrowser,
          parameters: lightParameters,
          rgbaDigest: digestBytes(enhanced.data),
          clippedLowRatio: enhancedResult.clippedLowRatio,
          clippedHighRatio: enhancedResult.clippedHighRatio,
        },
        backgroundCompose: {
          implementationDigest:
            defaultCatalogImplementationDigests.composeBrowser,
          rgbaDigest: digestBytes(composed.image.data),
          maskDigest: digestBytes(composed.mask.data),
          resolvedPlacement: composed.resolvedPlacement,
        },
      },
      review: {
        decision: "pending",
        acceptedLimitations: [],
        notes: null,
      },
    });
  }
} finally {
  operations.close?.();
}

const sheetWidth = columns.length * tileWidth;
const sheetHeight =
  Math.ceil(contactTiles.length / columns.length) * tileHeight;
const composites = contactTiles.flatMap((tile, index) => {
  const x = (index % columns.length) * tileWidth + 10;
  const y = Math.floor(index / columns.length) * tileHeight + 10;
  return [
    {
      input: label(tile.label),
      left: x,
      top: y,
    },
    {
      input: tile.image,
      left: x,
      top: y + 34,
    },
  ];
});
const contactSheetPath = resolve(outputRoot, "contact-sheet.png");
await sharp({
  create: {
    width: sheetWidth,
    height: sheetHeight,
    channels: 4,
    background: "#D1D5DB",
  },
})
  .composite(composites)
  .png({
    compressionLevel: 9,
    adaptiveFiltering: false,
  })
  .toFile(contactSheetPath);

const contactSheet = relative(outputRoot, contactSheetPath);
const packetFiles = await buildPacketFileIntegrity(outputRoot, [
  contactSheet,
  ...packetSources.flatMap((source) => [
    source.analysisFile,
    ...Object.values(source.previews),
  ]),
]);
const packet = {
  schemaVersion: "kanvas.image-atomic-designer-review-packet/v1",
  evidenceClass: "designer_review_pending",
  generatedAt: new Date().toISOString(),
  workspaceId: selection.workspaceId,
  dataClassification: selection.dataClassification,
  sourceCount: packetSources.length,
  capabilities: [
    "image.denoise",
    "image.light.enhance",
    "image.crop.suggest",
    "image.palette.extract",
    "image.quality.assess",
    "image.background.compose",
  ],
  missingCandidateCapabilities: {
    "image.object.remove":
      "Provider route is not enabled in the current development environment.",
    "image.text.extract":
      "No deployment-owned OCR language bundle is admitted.",
  },
  contactSheet,
  packetFiles,
  sources: packetSources,
  approval: {
    reviewer: null,
    reviewedAt: null,
    manifestDigest: null,
    acceptedCapabilities: [],
    rejectedCapabilities: [],
    acceptedLimitations: [],
    thresholdChanges: [],
  },
};
const manifestPath = resolve(outputRoot, "manifest.json");
await writeJson(manifestPath, packet);

process.stdout.write(
  `${JSON.stringify({
    manifest: manifestPath,
    contactSheet: contactSheetPath,
    sourceCount: packetSources.length,
    evidenceClass: packet.evidenceClass,
  })}\n`,
);
