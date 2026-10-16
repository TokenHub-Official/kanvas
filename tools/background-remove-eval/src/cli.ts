#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  evaluateBackgroundRemoval,
  parseBackgroundRemoveEvalCorpus,
  parseBackgroundRemoveEvalResults,
  readEvalJson,
} from "./eval.js";

function argument(name: string): string {
  const prefix = `--${name}=`;
  const value = process.argv
    .slice(2)
    .find((item) => item.startsWith(prefix))
    ?.slice(prefix.length);
  if (!value) {
    throw new Error(`Missing --${name}=<path>.`);
  }
  return resolve(value);
}

const corpusPath = argument("corpus");
const browserResultsPath = argument("browser-results");
const workerResultsPath = argument("worker-results");
const outputPath = argument("out");
const corpus = parseBackgroundRemoveEvalCorpus(await readEvalJson(corpusPath));
const sampleIds = new Set(corpus.samples.map((sample) => sample.id));
const [browserResults, workerResults] = await Promise.all([
  readEvalJson(browserResultsPath).then((value) =>
    parseBackgroundRemoveEvalResults(value, "browser", sampleIds),
  ),
  readEvalJson(workerResultsPath).then((value) =>
    parseBackgroundRemoveEvalResults(value, "worker", sampleIds),
  ),
]);
const report = await evaluateBackgroundRemoval({
  corpus,
  corpusPath,
  browserResults,
  browserResultsPath,
  workerResults,
  workerResultsPath,
});
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.acceptance.status !== "passed") {
  process.exitCode = 2;
}
