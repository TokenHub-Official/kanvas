import assert from "node:assert/strict";
import test from "node:test";

import {
  configurationNames,
  undocumentedConfigurationNames,
} from "./check-env-contract.mjs";

test("extracts supported environment names", () => {
  assert.deepEqual(
    [
      ...configurationNames(
        "process.env.KANVAS_HTTP_PORT and KANVAS_WEB_SOURCEMAP",
      ),
    ],
    ["KANVAS_HTTP_PORT", "KANVAS_WEB_SOURCEMAP"],
  );
});

test("reports undocumented environment names and ignores protocol constants", () => {
  assert.deepEqual(
    undocumentedConfigurationNames(
      "KANVAS_HTTP_PORT KANVAS_TEST_S3_ENDPOINT KANVAS_CANVAS_SELECTION",
      "`KANVAS_HTTP_PORT` is optional.",
    ),
    ["KANVAS_TEST_S3_ENDPOINT"],
  );
});
