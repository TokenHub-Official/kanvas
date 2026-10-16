import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertSupportedNode,
  formatHttpOrigin,
  loopbackHost,
} from "./start-dev.mjs";

test("accepts the repository Node.js engine range", () => {
  assert.doesNotThrow(() => assertSupportedNode("22.13.0"));
  assert.doesNotThrow(() => assertSupportedNode("22.99.0"));
  assert.throws(
    () => assertSupportedNode("21.99.0"),
    /requires Node\.js >=22\.13 <23/,
  );
  assert.throws(
    () => assertSupportedNode("23.0.0"),
    /requires Node\.js >=22\.13 <23/,
  );
});

test("maps wildcard bind addresses to reachable development origins", () => {
  assert.equal(loopbackHost("0.0.0.0"), "127.0.0.1");
  assert.equal(loopbackHost("::"), "::1");
  assert.equal(formatHttpOrigin("0.0.0.0", 3000), "http://127.0.0.1:3000");
  assert.equal(formatHttpOrigin("::", 3001), "http://[::1]:3001");
});

test("loads the models.dev reference before bootstrapping demo model services", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../../package.json", import.meta.url), "utf8"),
  );
  const setup = packageJson.scripts["setup:dev"];

  assert.ok(setup.includes("sync:model-reference"));
  assert.ok(
    setup.indexOf("sync:model-reference") < setup.indexOf("bootstrap:demo"),
  );
});
