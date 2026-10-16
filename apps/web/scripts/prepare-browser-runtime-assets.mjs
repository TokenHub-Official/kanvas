import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(import.meta.dirname, "..");
const runtimeDirectory = resolve(appRoot, "public/onnxruntime");
const assets = Object.freeze([
  Object.freeze({
    filename: "ort-wasm-simd-threaded.jsep.mjs",
    sha256: "3ee381d20a80f51a788a1c4a5872f6f1d047538dd4342f4af00062de5f9ea4c6",
  }),
  Object.freeze({
    filename: "ort-wasm-simd-threaded.jsep.wasm",
    sha256: "78feeeb3d08f6bcee94d938ed322f69073bb8076b5f9d34697a574ffba8deb48",
  }),
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function assertDigest(path, expected, label) {
  const actual = sha256(await readFile(path));
  if (actual !== expected) {
    throw new Error(
      `${label} digest mismatch: expected ${expected}, received ${actual}.`,
    );
  }
}

async function main() {
  const onnxRuntimeEntry = fileURLToPath(
    import.meta.resolve("onnxruntime-web"),
  );
  const onnxRuntimeDist = dirname(onnxRuntimeEntry);
  await mkdir(runtimeDirectory, {
    recursive: true,
  });
  for (const asset of assets) {
    const source = resolve(onnxRuntimeDist, asset.filename);
    await assertDigest(
      source,
      asset.sha256,
      `ONNX Runtime source ${asset.filename}`,
    );
    const target = resolve(runtimeDirectory, asset.filename);
    await copyFile(source, target);
    await assertDigest(
      target,
      asset.sha256,
      `ONNX Runtime release ${asset.filename}`,
    );
  }
  process.stdout.write("Browser runtime assets are admitted.\n");
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  await main();
}
