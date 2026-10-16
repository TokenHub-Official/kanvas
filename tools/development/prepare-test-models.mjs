import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const catalog = JSON.parse(
  await readFile(
    resolve(
      root,
      "catalog-packages/kanvas-default/model-resources/isnet-isnet-general-fp16-r2.json",
    ),
    "utf8",
  ),
);
const models = [
  {
    name: "u2netp.onnx",
    url: "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx",
    size: 4574861,
    sha256: "309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8",
  },
  {
    name: "isnet-general-fp16.onnx",
    url: catalog.sourceUrl,
    size: Number(catalog.expectedByteSize),
    sha256: catalog.expectedSha256.replace("sha256:", ""),
  },
];
const directory = resolve(root, ".tmp/test-models");
await mkdir(directory, { recursive: true });
function verify(bytes, model) {
  if (
    bytes.length !== model.size ||
    createHash("sha256").update(bytes).digest("hex") !== model.sha256
  ) {
    throw new Error(`Test model size/digest mismatch: ${model.name}`);
  }
}
for (const model of models) {
  const path = resolve(directory, model.name);
  try {
    const cached = await readFile(path);
    verify(cached, model);
    continue;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const response = await fetch(model.url, {
    signal: AbortSignal.timeout(300_000),
  });
  if (!response.ok || !response.body)
    throw new Error(
      `Test model download failed: ${model.name} (${response.status})`,
    );
  let length = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > model.size)
      throw new Error(`Test model exceeds pinned size: ${model.name}`);
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  verify(bytes, model);
  const temporary = `${path}.${process.pid}.download`;
  try {
    await writeFile(temporary, bytes, { flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
process.stdout.write(
  "Pinned ONNX test models verified in the ignored test cache.\n",
);
