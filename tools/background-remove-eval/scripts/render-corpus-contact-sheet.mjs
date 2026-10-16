import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import sharp from "sharp";

const root = resolve(
  import.meta.dirname,
  "../../../eval-data/background-remove",
);
const corpus = JSON.parse(await readFile(resolve(root, "corpus.json"), "utf8"));
const columns = 5;
const cellWidth = 260;
const cellHeight = 210;
const rows = Math.ceil(corpus.samples.length / columns);
const composites = [];

for (const [index, sample] of corpus.samples.entries()) {
  const source = await sharp(resolve(root, sample.sourceFile), {
    animated: false,
    failOn: "warning",
    limitInputPixels: 40_000_000,
  })
    .resize(116, 160, {
      fit: "contain",
      background: "#f4f4f5",
    })
    .flatten({ background: "#f4f4f5" })
    .jpeg({ quality: 82 })
    .toBuffer();
  const mask = sample.groundTruthMaskFile
    ? await sharp(resolve(root, sample.groundTruthMaskFile), {
        failOn: "warning",
        limitInputPixels: 40_000_000,
      })
        .resize(116, 160, {
          fit: "contain",
          background: "#111827",
        })
        .flatten({ background: "#111827" })
        .jpeg({ quality: 82 })
        .toBuffer()
    : await sharp({
        create: {
          width: 116,
          height: 160,
          channels: 3,
          background: "#27272a",
        },
      })
        .jpeg()
        .toBuffer();
  const label = Buffer.from(`
    <svg width="244" height="34" xmlns="http://www.w3.org/2000/svg">
      <rect width="244" height="34" fill="#ffffff"/>
      <text x="4" y="14" font-family="Arial, sans-serif" font-size="12" fill="#18181b">${sample.id}</text>
      <text x="4" y="29" font-family="Arial, sans-serif" font-size="9" fill="#52525b">${sample.categories.join(", ")}</text>
    </svg>
  `);
  const tile = await sharp({
    create: {
      width: 244,
      height: 202,
      channels: 3,
      background: "#ffffff",
    },
  })
    .composite([
      { input: source, left: 4, top: 4 },
      { input: mask, left: 124, top: 4 },
      { input: label, left: 0, top: 168 },
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

await writeFile(resolve(root, "contact-sheet.jpg"), sheet);
process.stdout.write(
  `${JSON.stringify({
    path: resolve(root, "contact-sheet.jpg"),
    samples: corpus.samples.length,
    width: columns * cellWidth,
    height: rows * cellHeight,
  })}\n`,
);
