import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

import sharp from "sharp";

import { evaluateObjectRemove, type RgbaImage } from "../src/eval.js";

interface ImageFile {
  readonly bytes: Buffer;
  readonly image: RgbaImage;
}

const statePath = resolve(
  process.argv[2] ?? "artifacts/atom-foundation-provider-v1/canary-state.json",
);
const outputRoot = dirname(statePath);
const reportPath = resolve(outputRoot, "report.json");
const contactSheetPath = resolve(outputRoot, "contact-sheet.png");

function record(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function insideRoot(path: string): string {
  const absolute = resolve(path);
  const child = relative(outputRoot, absolute);
  if (child === "" || child.startsWith("..") || child === absolute) {
    throw new Error("Provider Eval evidence path escaped its artifact root.");
  }
  return absolute;
}

function digest(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function image(path: string): Promise<ImageFile> {
  const bytes = await readFile(insideRoot(path));
  const decoded = await sharp(bytes, {
    failOn: "warning",
    limitInputPixels: 20_000_000,
  })
    .rotate()
    .ensureAlpha()
    .raw()
    .toBuffer({
      resolveWithObject: true,
    });
  return Object.freeze({
    bytes,
    image: Object.freeze({
      width: decoded.info.width,
      height: decoded.info.height,
      data: new Uint8Array(decoded.data),
    }),
  });
}

function rounded(value: number): number {
  return Number(value.toFixed(6));
}

function canvasMetrics(options: {
  readonly candidate: RgbaImage;
  readonly generatedMask: RgbaImage;
  readonly source: RgbaImage;
  readonly x: number;
  readonly y: number;
}) {
  const { candidate, generatedMask, source, x, y } = options;
  if (
    candidate.width !== 1024 ||
    candidate.height !== 1024 ||
    generatedMask.width !== candidate.width ||
    generatedMask.height !== candidate.height ||
    source.width !== 768 ||
    source.height !== 768 ||
    x + source.width > candidate.width ||
    y + source.height > candidate.height
  ) {
    throw new Error(
      "Canvas-expand Eval dimensions do not match the canary contract.",
    );
  }
  let sourceChannels = 0;
  let sourceChannelsExact = 0;
  let maskPixels = 0;
  let maskPixelsExact = 0;
  let generatedPixels = 0;
  for (let outputY = 0; outputY < candidate.height; outputY += 1) {
    for (let outputX = 0; outputX < candidate.width; outputX += 1) {
      const outputPixel: number = outputY * candidate.width + outputX;
      const outputOffset: number = outputPixel * 4;
      const preserved =
        outputX >= x &&
        outputX < x + source.width &&
        outputY >= y &&
        outputY < y + source.height;
      const expectedMask = preserved ? 0 : 255;
      maskPixels += 1;
      if (generatedMask.data[outputOffset] === expectedMask) {
        maskPixelsExact += 1;
      }
      if (!preserved) {
        generatedPixels += 1;
        continue;
      }
      const sourceOffset = ((outputY - y) * source.width + (outputX - x)) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        sourceChannels += 1;
        if (
          candidate.data[outputOffset + channel] ===
          source.data[sourceOffset + channel]
        ) {
          sourceChannelsExact += 1;
        }
      }
    }
  }
  return Object.freeze({
    sourceRegionExactRatio: rounded(sourceChannelsExact / sourceChannels),
    generatedMaskExactRatio: rounded(maskPixelsExact / maskPixels),
    generatedPixelRatio: rounded(generatedPixels / maskPixels),
  });
}

async function reconstructiveMetrics(source: RgbaImage, output: ImageFile) {
  const roundTrip = await sharp(output.bytes)
    .resize(source.width, source.height, {
      fit: "fill",
      kernel: "lanczos3",
    })
    .ensureAlpha()
    .raw()
    .toBuffer();
  let absolute = 0;
  let channels = 0;
  for (let index = 0; index < source.data.length; index += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      absolute += Math.abs(
        source.data[index + channel]! - roundTrip[index + channel]!,
      );
      channels += 1;
    }
  }
  roundTrip.fill(0);
  return Object.freeze({
    outputWidth: output.image.width,
    outputHeight: output.image.height,
    effectiveLinearScale: rounded(
      Math.sqrt(
        (output.image.width * output.image.height) /
          (source.width * source.height),
      ),
    ),
    aspectRatioDrift: rounded(
      Math.abs(
        output.image.width / output.image.height - source.width / source.height,
      ),
    ),
    sourceRoundTripRgbMae: rounded(absolute / channels),
    requiresHumanReview: true,
  });
}

async function preview(bytes: Buffer, label: string): Promise<Buffer> {
  const image = await sharp(bytes)
    .flatten({
      background: "#F3F4F6",
    })
    .resize(280, 280, {
      fit: "contain",
      background: "#F3F4F6",
    })
    .png()
    .toBuffer();
  const escaped = label
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return sharp({
    create: {
      width: 300,
      height: 330,
      channels: 4,
      background: "#E5E7EB",
    },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="280" height="30"><rect width="280" height="30" fill="#111827"/><text x="10" y="20" font-family="Arial, sans-serif" font-size="13" fill="#F9FAFB">${escaped}</text></svg>`,
        ),
        left: 10,
        top: 10,
      },
      {
        input: image,
        left: 10,
        top: 40,
      },
    ])
    .png()
    .toBuffer();
}

const state = record(
  JSON.parse(await readFile(statePath, "utf8")) as unknown,
  "Provider canary state",
);
if (
  state.schemaVersion !== "kanvas.image-provider-canary-state/v1" ||
  typeof state.batchId !== "string"
) {
  throw new Error("Provider canary state identity is invalid.");
}
const sourceState = record(state.source, "Provider canary source");
const runs = record(state.runs, "Provider canary runs");
const upscaleRun = record(
  runs.reconstructiveUpscale,
  "reconstructive upscale run",
);
const expandRun = record(runs.canvasExpand, "canvas expand run");
const removeRun = record(runs.objectRemove, "object remove run");
for (const [label, run] of [
  ["reconstructive upscale", upscaleRun],
  ["canvas expand", expandRun],
  ["object remove", removeRun],
] as const) {
  if (
    run.lifecycleStatus !== "completed" ||
    run.outcome !== "full_success" ||
    typeof run.workflowRunId !== "string" ||
    !run.downloads
  ) {
    throw new Error(`Provider ${label} is not a downloaded full-success Run.`);
  }
}

const upscaleDownloads = record(upscaleRun.downloads, "upscale downloads");
const expandDownloads = record(expandRun.downloads, "expand downloads");
const removeDownloads = record(removeRun.downloads, "remove downloads");
function downloadPath(
  downloads: Readonly<Record<string, unknown>>,
  key: string,
): string {
  const item = record(downloads[key], `${key} download`);
  if (typeof item.path !== "string") {
    throw new Error(`Provider download ${key} has no path.`);
  }
  return item.path;
}

if (typeof sourceState.path !== "string") {
  throw new Error("Provider canary source has no evidence path.");
}
const [
  source,
  expectedRemove,
  inputRemoveMask,
  reconstructed,
  expanded,
  expandedMask,
  repaired,
  removedMask,
] = await Promise.all([
  image(sourceState.path),
  image(resolve(outputRoot, "object-remove/expected.png")),
  image(resolve(outputRoot, "object-remove/mask.png")),
  image(downloadPath(upscaleDownloads, "imageArtifactId")),
  image(downloadPath(expandDownloads, "expandedArtifactId")),
  image(downloadPath(expandDownloads, "generatedRegionMaskArtifactId")),
  image(downloadPath(removeDownloads, "repairedArtifactId")),
  image(downloadPath(removeDownloads, "removedRegionMaskArtifactId")),
]);

let removedMaskExact = 0;
const maskPixels = inputRemoveMask.image.width * inputRemoveMask.image.height;
for (let pixel = 0; pixel < maskPixels; pixel += 1) {
  if (
    inputRemoveMask.image.data[pixel * 4] === removedMask.image.data[pixel * 4]
  ) {
    removedMaskExact += 1;
  }
}
const objectRemoveMetrics: Readonly<Record<string, number>> = Object.freeze({
  ...evaluateObjectRemove({
    candidate: repaired.image,
    expected: expectedRemove.image,
    source: source.image,
    mask: inputRemoveMask.image,
  }),
  removedMaskExactRatio: rounded(removedMaskExact / maskPixels),
});
const expandMetrics = canvasMetrics({
  candidate: expanded.image,
  generatedMask: expandedMask.image,
  source: source.image,
  x: 128,
  y: 128,
});
const upscaleMetrics = await reconstructiveMetrics(source.image, reconstructed);
const structuralPassed =
  objectRemoveMetrics["outsideMaskExactRatio"] === 1 &&
  objectRemoveMetrics["removedMaskExactRatio"] === 1 &&
  expandMetrics.sourceRegionExactRatio === 1 &&
  expandMetrics.generatedMaskExactRatio === 1;

const tiles = await Promise.all([
  preview(source.bytes, "source"),
  preview(expectedRemove.bytes, "remove expected"),
  preview(repaired.bytes, "remove candidate"),
  preview(expanded.bytes, "canvas expand"),
  preview(reconstructed.bytes, "reconstructive 2x"),
]);
await sharp({
  create: {
    width: tiles.length * 300,
    height: 330,
    channels: 4,
    background: "#D1D5DB",
  },
})
  .composite(
    tiles.map((tile, index) => ({
      input: tile,
      left: index * 300,
      top: 0,
    })),
  )
  .png({
    compressionLevel: 9,
    adaptiveFiltering: false,
  })
  .toFile(contactSheetPath);

const evidenceFiles = [
  statePath,
  sourceState.path,
  resolve(outputRoot, "object-remove/expected.png"),
  resolve(outputRoot, "object-remove/mask.png"),
  downloadPath(upscaleDownloads, "imageArtifactId"),
  downloadPath(expandDownloads, "expandedArtifactId"),
  downloadPath(expandDownloads, "generatedRegionMaskArtifactId"),
  downloadPath(removeDownloads, "repairedArtifactId"),
  downloadPath(removeDownloads, "removedRegionMaskArtifactId"),
  contactSheetPath,
];
const evidenceDigests: Record<string, string> = {};
for (const path of evidenceFiles) {
  const absolute = insideRoot(path);
  evidenceDigests[relative(outputRoot, absolute)] = digest(
    await readFile(absolute),
  );
}

const report = {
  schemaVersion: "kanvas.image-provider-canary-report/v1",
  evidenceClass: "provider_review_pending",
  generatedAt: new Date().toISOString(),
  batchId: state.batchId,
  sourceArtifactId: state.sourceArtifactId,
  structuralPassed,
  runs: {
    reconstructiveUpscale: {
      workflowRunId: upscaleRun.workflowRunId,
      metrics: upscaleMetrics,
      review: {
        decision: "pending",
        notes: null,
      },
    },
    canvasExpand: {
      workflowRunId: expandRun.workflowRunId,
      metrics: expandMetrics,
      review: {
        decision: "pending",
        notes: null,
      },
    },
    objectRemove: {
      workflowRunId: removeRun.workflowRunId,
      metrics: objectRemoveMetrics,
      review: {
        decision: "pending",
        notes: null,
      },
    },
  },
  contactSheet: relative(outputRoot, contactSheetPath),
  evidenceDigests,
};
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(
  `${JSON.stringify({
    report: reportPath,
    contactSheet: contactSheetPath,
    evidenceClass: report.evidenceClass,
    structuralPassed,
  })}\n`,
);
if (!structuralPassed) {
  process.exitCode = 1;
}
