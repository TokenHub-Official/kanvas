import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(import.meta.dirname, "..");
const packagePath = fileURLToPath(
  import.meta.resolve("@lobehub/fluent-emoji-3d/package.json"),
);
const metadata = JSON.parse(await readFile(packagePath, "utf8"));
if (metadata.version !== "1.1.0")
  throw new Error("Fluent emoji assets must remain pinned to 1.1.0.");
const source = resolve(dirname(packagePath), "assets");
const target = resolve(appRoot, "public/fluent-emoji/1.1.0");
await mkdir(target, { recursive: true });
await copyFile(
  resolve(import.meta.dirname, "fluent-emoji-NOTICE.txt"),
  resolve(target, "NOTICE.txt"),
);
const manifest = {};
for (const filename of (await readdir(source)).sort()) {
  if (!/^[a-f0-9-]+\.webp$/u.test(filename)) continue;
  const key = filename
    .slice(0, -5)
    .split("-")
    .filter((part) => part !== "fe0f")
    .join("-");
  manifest[key] = filename;
  await copyFile(resolve(source, filename), resolve(target, filename));
}
await writeFile(
  resolve(appRoot, "src/components/fluent-emoji-assets.generated.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
process.stdout.write(
  `Prepared ${Object.keys(manifest).length} local Fluent 3D emoji assets.\n`,
);
