import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import ts from "typescript";

const workspaceRoot = resolve(import.meta.dirname, "../..");

export const inlineHandlerPolicies = [
  // These budgets freeze the current baseline. Lower them when handlers are
  // extracted; new production TSX files keep an implicit complex budget of 0.
  {
    file: "apps/web/src/features/agent/agent-composer.tsx",
    maxInlineHandlers: 12,
    maxComplexInlineHandlers: 5,
  },
  {
    file: "apps/web/src/features/agent/agent-resource-workbench.tsx",
    maxInlineHandlers: 10,
    maxComplexInlineHandlers: 2,
  },
  {
    file: "apps/web/src/features/assets/resource-catalog-text-picker.tsx",
    maxInlineHandlers: 4,
    maxComplexInlineHandlers: 1,
  },
  {
    file: "apps/web/src/features/editor/canvas-font-select-v1.tsx",
    maxInlineHandlers: 1,
    maxComplexInlineHandlers: 1,
  },
  {
    file: "apps/web/src/features/editor/canvas-page-strip-v1.tsx",
    maxInlineHandlers: 8,
    maxComplexInlineHandlers: 6,
  },
  {
    file: "apps/web/src/features/editor/canvas-text-alignment-popover-v1.tsx",
    maxInlineHandlers: 1,
    maxComplexInlineHandlers: 1,
  },
  {
    file: "apps/web/src/features/editor/canvas-workspace-v1.tsx",
    maxInlineHandlers: 67,
    maxComplexInlineHandlers: 5,
  },
  {
    file: "apps/web/src/features/editor/canvas-left-panel-v1.tsx",
    maxInlineHandlers: 3,
    maxComplexInlineHandlers: 0,
  },
  {
    file: "apps/web/src/features/editor/canvas-design-panel-v1.tsx",
    maxInlineHandlers: 4,
    maxComplexInlineHandlers: 0,
  },
  {
    file: "apps/web/src/features/editor/canvas-materials-panel-v1.tsx",
    maxInlineHandlers: 7,
    maxComplexInlineHandlers: 0,
  },
  {
    file: "apps/web/src/features/editor/canvas-text-panel-v1.tsx",
    maxInlineHandlers: 8,
    maxComplexInlineHandlers: 0,
  },
  {
    file: "apps/web/src/features/editor/canvas-background-panel-v1.tsx",
    maxInlineHandlers: 4,
    maxComplexInlineHandlers: 0,
  },
  {
    file: "apps/web/src/routes/provider-settings-page.tsx",
    maxInlineHandlers: 16,
    maxComplexInlineHandlers: 1,
  },
  {
    file: "apps/web/src/routes/usage-settings-page.tsx",
    maxInlineHandlers: 9,
    maxComplexInlineHandlers: 0,
  },
  {
    file: "apps/web/src/features/editor/canvas-image-panel-v1.tsx",
    maxInlineHandlers: 14,
    maxComplexInlineHandlers: 0,
  },
  {
    file: "apps/web/src/features/editor/canvas-quick-tools-popover-v1.tsx",
    maxInlineHandlers: 11,
    maxComplexInlineHandlers: 0,
  },
  {
    file: "apps/web/src/features/assets/workspace-asset-picker.tsx",
    maxInlineHandlers: 18,
    maxComplexInlineHandlers: 0,
  },
  {
    file: "apps/web/src/features/capability-bindings/capability-runtime-controls.tsx",
    maxInlineHandlers: 23,
    maxComplexInlineHandlers: 0,
  },
  {
    file: "apps/web/src/routes/setup-page.tsx",
    maxInlineHandlers: 0,
    maxComplexInlineHandlers: 0,
  },
  {
    file: "apps/web/src/routes/workflow-editor-page.tsx",
    maxInlineHandlers: 6,
    maxComplexInlineHandlers: 0,
  },
  {
    file: "apps/web/src/components/app-shell.tsx",
    maxInlineHandlers: 7,
    maxComplexInlineHandlers: 0,
  },
  {
    file: "apps/web/src/components/settings-inline-select.tsx",
    maxInlineHandlers: 2,
    maxComplexInlineHandlers: 0,
  },
  {
    file: "apps/web/src/routes/assets-page.tsx",
    maxInlineHandlers: 4,
    maxComplexInlineHandlers: 0,
  },
  {
    file: "apps/web/src/features/editor/canvas-export-panel.tsx",
    maxInlineHandlers: 15,
    maxComplexInlineHandlers: 0,
  },
  {
    file: "apps/web/src/routes/invite-page.tsx",
    maxInlineHandlers: 2,
    maxComplexInlineHandlers: 0,
  },
  {
    file: "apps/web/src/routes/people-page.tsx",
    maxInlineHandlers: 18,
    maxComplexInlineHandlers: 0,
  },
  {
    file: "apps/web/src/features/provider-settings/model-control-plane-panel.tsx",
    maxInlineHandlers: 28,
    maxComplexInlineHandlers: 4,
  },
  {
    file: "apps/web/src/features/workflows/workflow-authoring-node-editor-v1.tsx",
    maxInlineHandlers: 69,
    maxComplexInlineHandlers: 15,
  },
  {
    file: "apps/web/src/features/workflows/workflow-authoring-workspace-v1.tsx",
    maxInlineHandlers: 33,
    maxComplexInlineHandlers: 13,
  },
  {
    file: "apps/web/src/features/workflows/workflow-candidate-panel.tsx",
    maxInlineHandlers: 17,
    maxComplexInlineHandlers: 2,
  },
  {
    file: "apps/web/src/features/workflows/workflow-test-file-control.tsx",
    maxInlineHandlers: 4,
    maxComplexInlineHandlers: 1,
  },
  {
    file: "apps/web/src/routes/agent-page.tsx",
    maxInlineHandlers: 22,
    maxComplexInlineHandlers: 4,
  },
  {
    file: "apps/web/src/routes/brand-page.tsx",
    maxInlineHandlers: 36,
    maxComplexInlineHandlers: 4,
  },
  {
    file: "apps/web/src/routes/workspace-home-quick-entry-page.tsx",
    maxInlineHandlers: 5,
    maxComplexInlineHandlers: 2,
  },
];

export const productionTsxRoot = "apps/web/src";

export function isProductionTsxFile(file) {
  return (
    file.endsWith(".tsx") &&
    !file.endsWith(".test.tsx") &&
    !file.endsWith(".stories.tsx")
  );
}

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? collectFiles(path) : [path];
    }),
  );
  return nested.flat();
}

export function inspectInlineHandlers(source, fileName = "source.tsx") {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const inlineHandlers = [];

  function visit(node) {
    if (
      ts.isJsxAttribute(node) &&
      node.name.text.startsWith("on") &&
      node.initializer &&
      ts.isJsxExpression(node.initializer)
    ) {
      const expression = node.initializer.expression;
      if (
        expression &&
        (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression))
      ) {
        const position = sourceFile.getLineAndCharacterOfPosition(
          node.getStart(sourceFile),
        );
        const statementCount = ts.isBlock(expression.body)
          ? expression.body.statements.length
          : 1;
        inlineHandlers.push({
          attribute: node.name.text,
          column: position.character + 1,
          line: position.line + 1,
          statementCount,
        });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return {
    complexInlineHandlers: inlineHandlers.filter(
      ({ statementCount }) => statementCount > 1,
    ),
    inlineHandlers,
  };
}

export function evaluateInlineHandlerPolicy(source, policy) {
  const report = inspectInlineHandlers(source, policy.file);
  const violations = [];

  if (report.inlineHandlers.length > policy.maxInlineHandlers) {
    violations.push(
      `${policy.file} has ${String(report.inlineHandlers.length)} inline handlers; maximum is ${String(policy.maxInlineHandlers)}.`,
    );
  }
  if (report.complexInlineHandlers.length > policy.maxComplexInlineHandlers) {
    const locations = report.complexInlineHandlers
      .map(
        ({ attribute, line }) =>
          `${attribute} at ${policy.file}:${String(line)}`,
      )
      .join(", ");
    violations.push(
      `${policy.file} has ${String(report.complexInlineHandlers.length)} complex inline handlers; maximum is ${String(policy.maxComplexInlineHandlers)}. Extract named responsibility handlers: ${locations}.`,
    );
  }

  return { report, violations };
}

export function complexInlineHandlerBudget(file) {
  return (
    inlineHandlerPolicies.find((policy) => policy.file === file)
      ?.maxComplexInlineHandlers ?? 0
  );
}

export async function checkInlineHandlerPolicies() {
  const violations = [];
  const summaries = [];

  for (const policy of inlineHandlerPolicies) {
    const absolutePath = resolve(workspaceRoot, policy.file);
    const source = await readFile(absolutePath, "utf8");
    const result = evaluateInlineHandlerPolicy(source, policy);
    violations.push(...result.violations);
    summaries.push(
      `${relative(workspaceRoot, absolutePath)}: ${String(result.report.inlineHandlers.length)} inline, ${String(result.report.complexInlineHandlers.length)} complex`,
    );
  }

  const productionRoot = resolve(workspaceRoot, productionTsxRoot);
  const productionFiles = (await collectFiles(productionRoot)).filter(
    isProductionTsxFile,
  );
  const unbudgetedComplexHandlers = [];
  for (const absolutePath of productionFiles) {
    const file = relative(workspaceRoot, absolutePath);
    const source = await readFile(absolutePath, "utf8");
    const report = inspectInlineHandlers(source, file);
    if (
      report.complexInlineHandlers.length > complexInlineHandlerBudget(file)
    ) {
      unbudgetedComplexHandlers.push(
        ...report.complexInlineHandlers.map(
          ({ attribute, line }) => `${attribute} at ${file}:${String(line)}`,
        ),
      );
    }
  }
  if (unbudgetedComplexHandlers.length > 0) {
    violations.push(
      `Production TSX exceeds its per-file complex inline-handler baseline. Extract named responsibility handlers: ${unbudgetedComplexHandlers.join(", ")}.`,
    );
  }

  if (violations.length > 0) {
    throw new Error(violations.join("\n"));
  }

  process.stdout.write(
    `Inline handler policy passed for ${String(productionFiles.length)} production TSX files; ${summaries.join("; ")}.\n`,
  );
}

const isDirectExecution =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isDirectExecution) {
  await checkInlineHandlerPolicies();
}
