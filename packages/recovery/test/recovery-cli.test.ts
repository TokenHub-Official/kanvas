import {
  lstat,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../src/cli/main.js";
import {
  parseCommandFlags,
  readJsonFile,
  writeJsonExclusive,
} from "../src/cli/support.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

async function temporaryDirectory(): Promise<string> {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), "kanvas-recovery-cli-")),
  );
  temporaryDirectories.push(directory);
  return directory;
}

describe("Recovery CLI boundary", () => {
  it("exposes stable top-level help without loading deployment secrets", async () => {
    let output = "";
    await runCli(["--help"], {}, "/app/kanvas", (value) => {
      output += value;
    });
    expect(output).toContain("kanvas recovery <begin|verify|activate|abort>");
  });

  it("rejects duplicate and malformed flags", () => {
    expect(() =>
      parseCommandFlags(["--manifest", "/one", "--manifest", "/two"]),
    ).toThrow(/duplicate/u);
    expect(() => parseCommandFlags(["manifest", "/one"])).toThrow(
      /Unexpected/u,
    );
  });

  it("writes manifests with mode 0600 and never overwrites", async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, "backup-set.json");
    await writeJsonExclusive(path, {
      schemaVersion: 1,
      status: "created",
    });
    const facts = await lstat(path);
    expect(facts.mode & 0o777).toBe(0o600);
    expect(await readJsonFile(path)).toEqual({
      schemaVersion: 1,
      status: "created",
    });
    await expect(writeJsonExclusive(path, { changed: true })).rejects.toThrow(
      /without overwriting/u,
    );
    expect(await readFile(path, "utf8")).not.toContain("changed");
    expect(await readdir(directory)).toEqual(["backup-set.json"]);
  });
});
