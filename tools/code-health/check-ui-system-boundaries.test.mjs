import assert from "node:assert/strict";
import test from "node:test";

import { uiSystemBoundaryProblems } from "./check-ui-system-boundaries.mjs";

test("accepts public Ant Design usage without retired UI dependencies", () => {
  assert.deepEqual(
    uiSystemBoundaryProblems({
      dependencies: { antd: "6.5.4", tailwindcss: "4.3.3" },
      files: [
        {
          path: "apps/web/src/page.tsx",
          source: 'import { Button } from "antd";',
        },
      ],
    }),
    [],
  );
});

test("rejects direct Radix dependencies and source references", () => {
  const problems = uiSystemBoundaryProblems({
    dependencies: { "@radix-ui/react-dialog": "1.0.0" },
    files: [
      {
        path: "apps/web/src/dialog.tsx",
        source: 'import * as Dialog from "@radix-ui/react-dialog";',
      },
    ],
  });
  assert.equal(problems.length, 2);
});

test("rejects Radix variables and Ant Design internal selectors", () => {
  const problems = uiSystemBoundaryProblems({
    dependencies: {},
    files: [
      {
        path: "apps/web/src/styles.css",
        source:
          ".ant-input { color: red } .toast { left: var(--radix-toast-x) }",
      },
    ],
  });
  assert.equal(problems.length, 2);
});
