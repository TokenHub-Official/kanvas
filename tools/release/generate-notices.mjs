import { format } from "prettier";
import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const records = new Map();
const visited = new Set();
function noticesAt(directory, nested = false) {
  return readdirSync(directory)
    .sort()
    .flatMap((name) => {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) {
        return /^(?:licenses?|notices?)$/iu.test(name)
          ? noticesAt(path, true)
          : [];
      }
      return nested ||
        /^(?:licen[cs]e|copying|notice|copyright)(?:[.-]|$)/iu.test(name)
        ? [path]
        : [];
    });
}
function resolveInstalledPackage(from, name) {
  for (let directory = from; ; directory = dirname(directory)) {
    const candidate = join(directory, "node_modules", name, "package.json");
    if (existsSync(candidate)) return dirname(realpathSync(candidate));
    if (dirname(directory) === directory) return undefined;
  }
}
function visit(directory) {
  directory = realpathSync(directory);
  if (visited.has(directory)) return;
  visited.add(directory);
  const metadata = JSON.parse(
    readFileSync(join(directory, "package.json"), "utf8"),
  );
  const own = metadata.name.startsWith("@kanvas/") || directory === root;
  const declared = metadata.license ?? metadata.licenses;
  const label = (value) => (typeof value === "string" ? value : value?.type);
  const license = own
    ? "Apache-2.0"
    : Array.isArray(declared)
      ? `(${declared.map(label).join(" OR ")})`
      : label(declared);
  if (typeof license !== "string" || !license || /^unknown$/iu.test(license)) {
    throw new Error(`Unresolved license: ${metadata.name}`);
  }
  if (!own) {
    const key = `${metadata.name}@${metadata.version}`;
    const record = records.get(key) ?? {
      name: metadata.name,
      version: metadata.version,
      license,
      ...(metadata.homepage ? { homepage: metadata.homepage } : {}),
      ...(metadata.repository ? { repository: metadata.repository } : {}),
      texts: new Set(),
    };
    for (const file of noticesAt(directory))
      record.texts.add(
        readFileSync(file, "utf8").replaceAll("\r\n", "\n").trim(),
      );
    if (!record.texts.size)
      record.texts.add(
        `Declared license: ${license}\nAttribution metadata: ${JSON.stringify(metadata.author ?? metadata.contributors ?? "not included in package metadata")}\nNo standalone license text is included in this package; retain its package metadata.`,
      );
    records.set(key, record);
  }
  // Traverse the installed production graph, including platform-specific optional
  // binaries. Do not depend on the package-manager cache surviving a Docker layer.
  for (const name of Object.keys({
    ...metadata.dependencies,
    ...metadata.optionalDependencies,
    ...metadata.peerDependencies,
  }).sort()) {
    const dependency = resolveInstalledPackage(directory, name);
    if (dependency) visit(dependency);
    else if (
      !metadata.optionalDependencies?.[name] &&
      !metadata.peerDependencies?.[name]
    )
      throw new Error(
        `Missing installed dependency: ${metadata.name} -> ${name}`,
      );
  }
}
visit(root);
for (const group of ["apps", "packages", "tools"]) {
  for (const name of readdirSync(join(root, group)).sort()) {
    const directory = join(root, group, name);
    if (existsSync(join(directory, "package.json"))) visit(directory);
  }
}
const inventory = [];
const sections = [];
for (const record of [...records.values()].sort((a, b) =>
  `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`),
)) {
  const { texts, ...entry } = record;
  inventory.push(entry);
  sections.push(
    `${record.name} ${record.version}\nDeclared license: ${record.license}\n${[...texts].sort().join("\n\n")}\n`,
  );
}
const destination = join(root, "third-party");
mkdirSync(destination, { recursive: true });
writeFileSync(
  join(destination, "production-dependencies.json"),
  await format(JSON.stringify(inventory), { parser: "json" }),
);
writeFileSync(
  join(destination, "NOTICES.txt"),
  "Third-party dependency notices\nGenerated from installed production dependencies; optional binaries vary by platform.\n\n" +
    sections.join(
      "\n------------------------------------------------------------\n\n",
    ),
);
process.stdout.write(
  `Generated inventory and bundled notices for ${inventory.length} production package versions.\n`,
);
