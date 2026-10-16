import assert from "node:assert/strict";
import test from "node:test";

import {
  complexInlineHandlerBudget,
  evaluateInlineHandlerPolicy,
  inspectInlineHandlers,
  isProductionTsxFile,
} from "./check-inline-handlers.mjs";

test("gives new production files an implicit zero complex-handler budget", () => {
  assert.equal(complexInlineHandlerBudget("apps/web/src/new-page.tsx"), 0);
  assert.equal(
    complexInlineHandlerBudget(
      "apps/web/src/features/agent/agent-composer.tsx",
    ),
    5,
  );
});

test("counts only JSX inline event handlers", () => {
  const report = inspectInlineHandlers(`
    const named = () => undefined;
    export function Example() {
      return (
        <button onClick={named} onFocus={() => undefined}>
          Save
        </button>
      );
    }
  `);

  assert.equal(report.inlineHandlers.length, 1);
  assert.equal(report.complexInlineHandlers.length, 0);
});

test("reports multi-statement inline handlers with their location", () => {
  const policy = {
    file: "example.tsx",
    maxInlineHandlers: 1,
    maxComplexInlineHandlers: 0,
  };
  const result = evaluateInlineHandlerPolicy(
    `
      export function Example() {
        return (
          <button onClick={() => {
            prepare();
            save();
          }}>
            Save
          </button>
        );
      }
    `,
    policy,
  );

  assert.equal(result.report.inlineHandlers.length, 1);
  assert.equal(result.report.complexInlineHandlers.length, 1);
  assert.match(result.violations.join("\n"), /onClick at example\.tsx:\d+/u);
});

test("rejects growth beyond the configured inline-handler budget", () => {
  const result = evaluateInlineHandlerPolicy(
    `
      export function Example() {
        return <button onClick={() => save()} onFocus={() => prepare()} />;
      }
    `,
    {
      file: "example.tsx",
      maxInlineHandlers: 1,
      maxComplexInlineHandlers: 0,
    },
  );

  assert.match(result.violations.join("\n"), /2 inline handlers/u);
});

test("global production scan excludes test and story modules", () => {
  assert.equal(isProductionTsxFile("src/page.tsx"), true);
  assert.equal(isProductionTsxFile("src/page.test.tsx"), false);
  assert.equal(isProductionTsxFile("src/page.stories.tsx"), false);
  assert.equal(isProductionTsxFile("src/model.ts"), false);
});
