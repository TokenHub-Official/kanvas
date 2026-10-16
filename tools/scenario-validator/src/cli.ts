#!/usr/bin/env node

import { resolve } from "node:path";

import { validateScenarioPack } from "./validate-scenario-pack.js";

const packDirectory = process.argv[2];
if (!packDirectory) {
  throw new Error("Usage: scenario-validator <scenario-pack-directory>");
}

const result = await validateScenarioPack(resolve(packDirectory));
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.valid) {
  process.exitCode = 1;
}
