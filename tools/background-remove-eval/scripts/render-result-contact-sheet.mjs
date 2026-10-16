import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import sharp from "sharp";

const root = resolve(
  import.meta.dirname,
  "../../../eval-data/background-remove",
);
const corpus = JSON.parse(await readFile(resolve(root, "corpus.json"), "utf8"));
function argument(name, fallback) {
  const prefix = `--${name}=`;
  return (
    process.argv
      .slice(2)
      .find((value) => value.startsWith(prefix))
      ?.slice(prefix.length) ?? fallback
  );
}
const browserDirectory = argument("browser-dir", "browser");
const workerDirectory = argument("worker-dir", "worker");
const outputFilename = argument("out", "result-contact-sheet.jpg");
const columns = 3;
const cellWidth = 430;
const cellHeight = 190;
const rows = Math.ceil(corpus.samples.length / columns);
const composites = [];

async function panel(path, background) {
  if (!path) {
    return await sharp({
      create: {
        width: 96,
        height: 142,
        channels: 3,
        background,
      },
    })
      .jpeg()
      .toBuffer();
  }
  return await sharp(resolve(root, path), {
    animated: false,
    failOn: "warning",
    limitInputPixels: 40_000_000,
  })
    .resize(96, 142, {
      fit: "contain",
      background,
    })
    .flatten({ background })
    .jpeg({ quality: 84 })
    .toBuffer();
}

for (const [index, sample] of corpus.samples.entries()) {
  const [source, expected, browser, worker] = await Promise.all([
    panel(sample.sourceFile, "#f4f4f5"),
    panel(sample.groundTruthMaskFile, "#111827"),
    panel(
      sample.groundTruthMaskFile
        ? `${browserDirectory}/masks/${sample.id}.png`
        : undefined,
      "#111827",
    ),
    panel(
      sample.groundTruthMaskFile
        ? `${workerDirectory}/masks/${sample.id}.png`
        : undefined,
      "#111827",
    ),
  ]);
  const label = Buffer.from(`
    <svg width="404" height="30" xmlns="http://www.w3.org/2000/svg">
      <rect width="404" height="30" fill="#ffffff"/>
      <text x="4" y="13" font-family="Arial, sans-serif" font-size="12" fill="#18181b">${sample.id}</text>
      <text x="4" y="27" font-family="Arial, sans-serif" font-size="9" fill="#52525b">source · ground truth · browser · worker</text>
    </svg>
  `);
  const tile = await sharp({
    create: {
      width: 404,
      height: 180,
      channels: 3,
      background: "#ffffff",
    },
  })
    .composite([
      { input: source, left: 4, top: 4 },
      { input: expected, left: 104, top: 4 },
      { input: browser, left: 204, top: 4 },
      { input: worker, left: 304, top: 4 },
      { input: label, left: 0, top: 150 },
    ])
    .jpeg({ quality: 88 })
    .toBuffer();
  composites.push({
    input: tile,
    left: (index % columns) * cellWidth + 8,
    top: Math.floor(index / columns) * cellHeight + 8,
  });
}

const sheet = await sharp({
  create: {
    width: columns * cellWidth,
    height: rows * cellHeight,
    channels: 3,
    background: "#e4e4e7",
  },
})
  .composite(composites)
  .jpeg({ quality: 90 })
  .toBuffer();
await writeFile(resolve(root, outputFilename), sheet);
process.stdout.write(
  `${JSON.stringify({
    path: resolve(root, outputFilename),
    samples: corpus.samples.length,
  })}\n`,
);
