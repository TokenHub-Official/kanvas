import { readFile } from "node:fs/promises";

import stylelintConfig from "../../stylelint.config.mjs";

export const requiredCssImports = Object.freeze([
  "tailwindcss",
  "./styles/tokens.css",
  "./styles/base.css",
  "./styles/motion.css",
]);

export const forbiddenCssEntrypointImports = Object.freeze([
  "@xyflow/react/dist/style.css",
]);

export function cssEntrypointProblems(source, importNotation) {
  const problems = [];
  if (importNotation !== "string") {
    problems.push(
      "Stylelint must enforce string @import notation for Vite and Tailwind package resolution.",
    );
  }
  for (const specifier of requiredCssImports) {
    if (!source.includes(`@import "${specifier}";`)) {
      problems.push(`CSS entrypoint must import ${specifier} as a string.`);
    }
  }
  for (const specifier of forbiddenCssEntrypointImports) {
    if (source.includes(`@import "${specifier}";`)) {
      problems.push(
        `Route-local CSS ${specifier} must load with its lazy feature, not the application entrypoint.`,
      );
    }
  }
  return problems;
}

export async function checkCssEntrypoint() {
  const source = await readFile(
    new URL("../../apps/web/src/styles.css", import.meta.url),
    "utf8",
  );
  const problems = cssEntrypointProblems(
    source,
    stylelintConfig.rules?.["import-notation"],
  );
  if (problems.length > 0) {
    throw new Error(problems.join("\n"));
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  await checkCssEntrypoint();
  console.log(
    "CSS entrypoint policy passed (Tailwind and package imports use string notation).",
  );
}
