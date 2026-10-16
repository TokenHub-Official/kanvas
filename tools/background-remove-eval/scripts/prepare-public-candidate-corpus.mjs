import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import sharp from "sharp";

const outputRoot = resolve(
  import.meta.dirname,
  "../../../eval-data/background-remove",
);
const sourcesRoot = resolve(outputRoot, "sources");
const masksRoot = resolve(outputRoot, "masks");

const datasetsApi = "https://datasets-server.huggingface.co/rows";
const execFileAsync = promisify(execFile);

const disSelections = [
  ["dis-bag", 0, ["product", "large_image"]],
  ["dis-eyeglasses", 2, ["product", "transparent_or_translucent"]],
  ["dis-jewelry", 27, ["product", "small_subject"]],
  ["dis-ring", 28, ["product", "small_subject"]],
  ["dis-watch", 35, ["product", "small_subject"]],
  ["dis-shoe", 32, ["product", "shadow"]],
  ["dis-ladder", 74, ["product", "complex_background", "large_image"]],
  [
    "dis-table-chair",
    105,
    ["product", "multiple_subjects", "complex_background"],
  ],
  ["dis-skeleton", 58, ["product", "complex_background"]],
  ["dis-butterfly", 171, ["animal", "hair_or_fur", "small_subject"]],
  ["dis-snake", 165, ["animal", "low_contrast"]],
  [
    "dis-wine-glass",
    176,
    ["product", "transparent_or_translucent", "shadow", "large_image"],
  ],
  ["dis-wire-whisk", 183, ["product", "complex_background"]],
  ["dis-robot", 477, ["product", "small_subject"]],
  [
    "dis-rock-climbing",
    267,
    ["person", "multiple_subjects", "complex_background", "large_image"],
  ],
  ["dis-needle", 324, ["product", "small_subject"]],
  ["dis-sailboat", 230, ["multiple_subjects", "complex_background", "shadow"]],
  ["dis-kite", 241, ["small_subject", "complex_background"]],
  ["dis-sculpture", 382, ["product", "shadow", "large_image"]],
];

const p3mSelections = Array.from({ length: 5 }, (_, index) => [
  `p3m-person-${String(index + 1).padStart(2, "0")}`,
  index,
  ["person", "hair_or_fur", "complex_background", "large_image"],
]);

const camoSelections = Array.from({ length: 5 }, (_, index) => [
  `camo-${String(index + 1).padStart(2, "0")}`,
  index,
  ["animal", "low_contrast", "complex_background"],
]);

async function downloadWithRetry(url) {
  const { stdout } = await execFileAsync(
    "/usr/bin/curl",
    [
      "-L",
      "--fail",
      "--retry",
      "5",
      "--retry-all-errors",
      "--connect-timeout",
      "30",
      "--max-time",
      "180",
      "--silent",
      "--show-error",
      "--user-agent",
      "Kanvas-ATOM-01-Eval-Candidate/1.0",
      url,
    ],
    {
      encoding: "buffer",
      maxBuffer: 100 * 1024 * 1024,
      timeout: 210_000,
    },
  );
  return stdout;
}

async function rows(options) {
  const query = new URLSearchParams({
    dataset: options.dataset,
    config: "default",
    split: options.split,
    offset: String(options.offset),
    length: String(options.length),
  });
  return JSON.parse(
    (await downloadWithRetry(`${datasetsApi}?${query}`)).toString("utf8"),
  ).rows;
}

async function download(url) {
  return await downloadWithRetry(url);
}

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function persistPair(options) {
  const [sourceBytes, maskBytes] = await Promise.all([
    download(options.sourceUrl),
    download(options.maskUrl),
  ]);
  const source = await sharp(sourceBytes, {
    failOn: "warning",
    limitInputPixels: 40_000_000,
  })
    .rotate()
    .jpeg({ quality: 92, chromaSubsampling: "4:4:4" })
    .toBuffer();
  const mask = await sharp(maskBytes, {
    failOn: "warning",
    limitInputPixels: 40_000_000,
  })
    .rotate()
    .greyscale()
    .threshold(128)
    .png()
    .toBuffer();
  const sourceFile = `sources/${options.id}.jpg`;
  const maskFile = `masks/${options.id}.png`;
  await Promise.all([
    writeFile(resolve(outputRoot, sourceFile), source),
    writeFile(resolve(outputRoot, maskFile), mask),
  ]);
  return {
    sample: {
      id: options.id,
      categories: options.categories,
      sourceFile,
      groundTruthMaskFile: maskFile,
      annotation: {
        decision: "direct_use",
        currentTool:
          "public benchmark ground-truth candidate; Kanvas designer review pending",
        manualMinutes: 0,
        reworkReason:
          "Kanvas designer baseline time and direct-use decision are not yet approved.",
      },
    },
    provenance: {
      id: options.id,
      dataset: options.dataset,
      split: options.split,
      row: options.row,
      upstreamName: options.upstreamName,
      sourceDigest: digest(source),
      groundTruthMaskDigest: digest(mask),
    },
    source,
  };
}

async function main() {
  await Promise.all([
    mkdir(sourcesRoot, { recursive: true }),
    mkdir(masksRoot, { recursive: true }),
  ]);
  const disPages = new Map();
  for (const [, row] of disSelections) {
    const offset = Math.floor(row / 100) * 100;
    if (!disPages.has(offset)) {
      disPages.set(
        offset,
        await rows({
          dataset: "nobg/DIS5K",
          split: "DIS_TE1",
          offset,
          length: 100,
        }),
      );
    }
  }
  const p3mRows = await rows({
    dataset: "nobg/P3M-10K",
    split: "P3M_500_NP",
    offset: 0,
    length: 5,
  });
  const camoRows = await rows({
    dataset: "nobg/camo",
    split: "test",
    offset: 0,
    length: 5,
  });
  const specifications = [
    ...disSelections.map(([id, row, categories]) => {
      const offset = Math.floor(row / 100) * 100;
      const value = disPages.get(offset)[row - offset].row;
      return {
        id,
        row,
        categories,
        dataset: "nobg/DIS5K",
        split: "DIS_TE1",
        upstreamName: value.image_name,
        sourceUrl: value.image.src,
        maskUrl: value.label.src,
      };
    }),
    ...p3mSelections.map(([id, row, categories]) => {
      const value = p3mRows[row].row;
      return {
        id,
        row,
        categories,
        dataset: "nobg/P3M-10K",
        split: "P3M_500_NP",
        upstreamName: `P3M_500_NP/${row}`,
        sourceUrl: value.image.src,
        maskUrl: value.mask.src,
      };
    }),
    ...camoSelections.map(([id, row, categories]) => {
      const value = camoRows[row].row;
      return {
        id,
        row,
        categories,
        dataset: "nobg/camo",
        split: "test",
        upstreamName: value.image_name,
        sourceUrl: value.image.src,
        maskUrl: value.mask.src,
      };
    }),
  ];
  const persisted = [];
  for (const specification of specifications) {
    persisted.push(await persistPair(specification));
  }
  const unsupportedGif = Buffer.from(
    "R0lGODlhAQABAIAAAP///wAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQICgAAACwAAAAAAQABAAACAkQBADs=",
    "base64",
  );
  await writeFile(
    resolve(sourcesRoot, "unsupported-animated.gif"),
    unsupportedGif,
  );
  const unsupportedSample = {
    id: "unsupported-animated-gif",
    categories: ["unsupported_media"],
    sourceFile: "sources/unsupported-animated.gif",
    annotation: {
      decision: "fail_or_fallback",
      currentTool: "Kanvas static-image contract candidate review",
      manualMinutes: 0,
      reworkReason: "Animated media is outside image.background.remove V1.",
    },
  };
  const corpus = {
    schemaVersion: "kanvas.background-remove-eval-corpus/v1",
    corpusId: "atom-01-public-candidate-2026-08",
    anonymized: true,
    samples: [...persisted.map((value) => value.sample), unsupportedSample],
  };
  const provenance = {
    schemaVersion: "kanvas.background-remove-eval-provenance/v1",
    generatedAt: new Date().toISOString(),
    reviewStatus: "candidate_pending_kanvas_designer_review",
    sources: [
      {
        dataset: "DIS5K V1.0",
        upstream: "https://github.com/xuebinqin/DIS",
        mirror: "https://huggingface.co/datasets/nobg/DIS5K",
        use: "local non-production evaluation candidate",
      },
      {
        dataset: "P3M-10K",
        upstream: "https://github.com/JizhiziLi/P3M",
        mirror: "https://huggingface.co/datasets/nobg/P3M-10K",
        use: "local non-production evaluation candidate",
      },
      {
        dataset: "CAMO",
        upstream: "https://sites.google.com/view/ltnghia/research/camo",
        mirror: "https://huggingface.co/datasets/nobg/camo",
        use: "local non-production evaluation candidate",
      },
    ],
    samples: [
      ...persisted.map((value) => value.provenance),
      {
        id: unsupportedSample.id,
        dataset: "generated-contract-probe",
        split: "unsupported",
        row: 0,
        upstreamName: "two-frame-animated.gif",
        sourceDigest: digest(unsupportedGif),
      },
    ],
  };
  await Promise.all([
    writeFile(
      resolve(outputRoot, "corpus.json"),
      `${JSON.stringify(corpus, null, 2)}\n`,
    ),
    writeFile(
      resolve(outputRoot, "provenance.json"),
      `${JSON.stringify(provenance, null, 2)}\n`,
    ),
  ]);
  process.stdout.write(
    `${JSON.stringify({
      corpusId: corpus.corpusId,
      samples: corpus.samples.length,
      reviewStatus: provenance.reviewStatus,
    })}\n`,
  );
}

await main();
