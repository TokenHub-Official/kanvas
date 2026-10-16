import assert from "node:assert/strict";
import test from "node:test";

import {
  applyLegacyEnvironment,
  environmentValues,
  shouldMigrateExisting,
} from "./setup-env.mjs";

test("parses legacy values without interpreting their contents", () => {
  assert.deepEqual(
    [...environmentValues('A=plain\nB="contains=equals"\n# C=ignored')],
    [
      ["A", "plain"],
      ["B", '"contains=equals"'],
    ],
  );
});

test("projects only known legacy keys into component templates", () => {
  const projection = applyLegacyEnvironment(
    ["# A=template", "B=template", "# C=template", ""].join("\n"),
    ["A=legacy", 'B="legacy=value"', "UNKNOWN=ignored", ""].join("\n"),
  );

  assert.equal(
    projection.contents,
    ["A=legacy", 'B="legacy=value"', "# C=template", ""].join("\n"),
  );
  assert.equal(projection.migrated, 2);
});

test("migrates only an untouched generated template", () => {
  assert.equal(shouldMigrateExisting("template", "template", "legacy"), true);
  assert.equal(shouldMigrateExisting("edited", "template", "legacy"), false);
  assert.equal(
    shouldMigrateExisting("template", "template", "template"),
    false,
  );
});
