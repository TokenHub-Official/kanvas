import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = new URL("../../", import.meta.url);
const webRoot = new URL("../../apps/web/", import.meta.url);
const sourceRoot = new URL("../../apps/web/src/", import.meta.url);
const sourceExtensions = new Set([".css", ".ts", ".tsx"]);

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await sourceFiles(path)));
    } else if (sourceExtensions.has(extname(entry.name))) {
      files.push(path);
    }
  }
  return files;
}

export function uiSystemBoundaryProblems({ dependencies, files }) {
  const problems = [];
  for (const name of Object.keys(dependencies)) {
    if (name.startsWith("@radix-ui/")) {
      problems.push(
        `Web must not declare the retired direct dependency ${name}.`,
      );
    }
  }

  for (const file of files) {
    if (file.source.includes("@radix-ui/")) {
      problems.push(
        `${file.path} imports or references retired Radix UI code.`,
      );
    }
    if (file.source.includes("--radix-")) {
      problems.push(`${file.path} retains a retired Radix CSS variable.`);
    }
    if (file.path.endsWith(".css") && /\.ant-[a-z0-9_-]+/iu.test(file.source)) {
      problems.push(`${file.path} targets Ant Design internal DOM classes.`);
    }
  }
  return problems;
}

export async function checkUiSystemBoundaries() {
  const packageJson = JSON.parse(
    await readFile(new URL("package.json", webRoot), "utf8"),
  );
  const paths = await sourceFiles(fileURLToPath(sourceRoot));
  const rootPath = fileURLToPath(workspaceRoot);
  const files = await Promise.all(
    paths.map(async (path) => ({
      path: relative(rootPath, path),
      source: await readFile(path, "utf8"),
    })),
  );
  const problems = uiSystemBoundaryProblems({
    dependencies: {
      ...(packageJson.dependencies ?? {}),
      ...(packageJson.devDependencies ?? {}),
    },
    files,
  });
  if (problems.length > 0) {
    throw new Error(problems.join("\n"));
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  await checkUiSystemBoundaries();
  console.log(
    "UI system boundaries passed (Ant Design/Tailwind, no Radix residue).",
  );
}
