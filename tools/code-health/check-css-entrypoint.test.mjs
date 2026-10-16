import assert from "node:assert/strict";
import test from "node:test";

import {
  cssEntrypointProblems,
  forbiddenCssEntrypointImports,
  requiredCssImports,
} from "./check-css-entrypoint.mjs";

const validEntrypoint = requiredCssImports
  .map((specifier) => `@import "${specifier}";`)
  .join("\n");

test("accepts package and local imports in Tailwind-compatible string notation", () => {
  assert.deepEqual(cssEntrypointProblems(validEntrypoint, "string"), []);
});

test("rejects Stylelint configuration that can rewrite package imports", () => {
  assert.match(
    cssEntrypointProblems(validEntrypoint, "url").join("\n"),
    /Stylelint must enforce string @import notation/u,
  );
});

test("rejects URL notation that prevents Tailwind utilities from compiling", () => {
  const brokenEntrypoint = validEntrypoint.replace(
    '@import "tailwindcss";',
    '@import url("tailwindcss");',
  );
  assert.match(
    cssEntrypointProblems(brokenEntrypoint, "string").join("\n"),
    /must import tailwindcss as a string/u,
  );
});

test("rejects route-local library CSS in the application entrypoint", () => {
  const routeCss = forbiddenCssEntrypointImports
    .map((specifier) => `@import "${specifier}";`)
    .join("\n");
  assert.match(
    cssEntrypointProblems(`${validEntrypoint}\n${routeCss}`, "string").join(
      "\n",
    ),
    /must load with its lazy feature/u,
  );
});
