import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

export interface PacketFileIntegrity {
  readonly byteSize: number;
  readonly path: string;
  readonly sha256: string;
}

export interface DesignerReviewPacketVerification {
  readonly approvalDigest: string;
  readonly evidenceClass: "designer_approved" | "designer_review_pending";
  readonly fileCount: number;
  readonly manifestPath: string;
  readonly sourceCount: number;
}

const artifactIdPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const sourceIdPattern = /^[a-z0-9][a-z0-9-]{0,79}$/u;
const expectedCapabilities = Object.freeze([
  "image.denoise",
  "image.light.enhance",
  "image.crop.suggest",
  "image.palette.extract",
  "image.quality.assess",
  "image.background.compose",
]);

function record(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function safeRelativeFile(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 500 &&
    !isAbsolute(value) &&
    !value.startsWith("/") &&
    !value.split(/[\\/]/u).includes("..")
  );
}

function digest(value: Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const input = record(value, "canonical JSON value");
  return `{${Object.keys(input)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(input[key])}`)
    .join(",")}}`;
}

function approvalDigest(manifest: Readonly<Record<string, unknown>>): string {
  const approval = record(manifest.approval, "approval");
  return digest(
    Buffer.from(
      canonicalJson({
        ...manifest,
        approval: {
          ...approval,
          manifestDigest: null,
        },
      }),
      "utf8",
    ),
  );
}

async function listFiles(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, {
    withFileTypes: true,
  });
  const files: string[] = [];
  for (const entry of entries) {
    const path = resolve(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(root, path)));
    } else if (entry.isFile()) {
      files.push(relative(root, path));
    } else {
      throw new Error(
        `Review packet contains an unsupported filesystem entry: ${relative(
          root,
          path,
        )}.`,
      );
    }
  }
  return files.sort();
}

export async function buildPacketFileIntegrity(
  root: string,
  paths: readonly string[],
): Promise<readonly PacketFileIntegrity[]> {
  const unique = new Set<string>();
  const result: PacketFileIntegrity[] = [];
  for (const path of [...paths].sort()) {
    if (!safeRelativeFile(path) || unique.has(path)) {
      throw new TypeError(
        `Review packet file path is unsafe or duplicated: ${String(path)}.`,
      );
    }
    unique.add(path);
    const bytes = await readFile(resolve(root, path));
    result.push(
      Object.freeze({
        path,
        byteSize: bytes.byteLength,
        sha256: digest(bytes),
      }),
    );
  }
  return Object.freeze(result);
}

export async function verifyDesignerReviewPacket(
  root: string,
): Promise<DesignerReviewPacketVerification> {
  const manifestPath = resolve(root, "manifest.json");
  const manifest = record(
    JSON.parse(await readFile(manifestPath, "utf8")) as unknown,
    "designer review manifest",
  );
  if (
    manifest.schemaVersion !==
      "kanvas.image-atomic-designer-review-packet/v1" ||
    (manifest.evidenceClass !== "designer_review_pending" &&
      manifest.evidenceClass !== "designer_approved") ||
    !artifactIdPattern.test(String(manifest.workspaceId)) ||
    manifest.dataClassification !== "internal" ||
    typeof manifest.generatedAt !== "string" ||
    !Number.isFinite(Date.parse(manifest.generatedAt)) ||
    !Array.isArray(manifest.capabilities) ||
    JSON.stringify(manifest.capabilities) !==
      JSON.stringify(expectedCapabilities) ||
    !Array.isArray(manifest.sources) ||
    manifest.sources.length < 1 ||
    manifest.sources.length > 32 ||
    manifest.sourceCount !== manifest.sources.length ||
    !Array.isArray(manifest.packetFiles)
  ) {
    throw new TypeError(
      "Designer review packet identity, capabilities, or source count is invalid.",
    );
  }

  record(manifest.missingCandidateCapabilities, "missingCandidateCapabilities");
  const approval = record(manifest.approval, "approval");
  const sourceIds = new Set<string>();
  const artifactIds = new Set<string>();
  const referencedFiles = new Set<string>();
  if (!safeRelativeFile(manifest.contactSheet)) {
    throw new TypeError("Designer review contact sheet path is invalid.");
  }
  referencedFiles.add(manifest.contactSheet);

  for (const rawSource of manifest.sources) {
    const source = record(rawSource, "review source");
    if (
      typeof source.id !== "string" ||
      !sourceIdPattern.test(source.id) ||
      sourceIds.has(source.id) ||
      typeof source.artifactId !== "string" ||
      !artifactIdPattern.test(source.artifactId) ||
      artifactIds.has(source.artifactId) ||
      typeof source.sourceDigest !== "string" ||
      !digestPattern.test(source.sourceDigest) ||
      !safeRelativeFile(source.analysisFile)
    ) {
      throw new TypeError(
        "Designer review source identity or evidence path is invalid.",
      );
    }
    sourceIds.add(source.id);
    artifactIds.add(source.artifactId);
    referencedFiles.add(source.analysisFile);

    const previews = record(source.previews, `source ${source.id} previews`);
    if (
      JSON.stringify(Object.keys(previews).sort()) !==
      JSON.stringify(["compose", "denoise", "light", "source"])
    ) {
      throw new TypeError(`Source ${source.id} preview inventory is invalid.`);
    }
    for (const path of Object.values(previews)) {
      if (!safeRelativeFile(path)) {
        throw new TypeError(`Source ${source.id} preview path is invalid.`);
      }
      referencedFiles.add(path);
    }
  }

  const packetFiles = new Map<string, PacketFileIntegrity>();
  for (const rawFile of manifest.packetFiles) {
    const file = record(rawFile, "packet file");
    if (
      !safeRelativeFile(file.path) ||
      packetFiles.has(file.path) ||
      !Number.isSafeInteger(file.byteSize) ||
      (file.byteSize as number) < 1 ||
      typeof file.sha256 !== "string" ||
      !digestPattern.test(file.sha256)
    ) {
      throw new TypeError(
        "Designer review packet file integrity record is invalid.",
      );
    }
    packetFiles.set(file.path, {
      path: file.path,
      byteSize: file.byteSize as number,
      sha256: file.sha256,
    });
  }
  if (
    referencedFiles.size !== packetFiles.size ||
    [...referencedFiles].some((path) => !packetFiles.has(path))
  ) {
    throw new Error(
      "Designer review manifest references and packet file inventory differ.",
    );
  }

  for (const [path, expected] of packetFiles) {
    const bytes = await readFile(resolve(root, path));
    if (
      bytes.byteLength !== expected.byteSize ||
      digest(bytes) !== expected.sha256
    ) {
      throw new Error(
        `Designer review packet file failed digest verification: ${path}.`,
      );
    }
  }

  for (const rawSource of manifest.sources) {
    const source = record(rawSource, "review source");
    const analysis = record(
      JSON.parse(
        await readFile(resolve(root, source.analysisFile as string), "utf8"),
      ) as unknown,
      `source ${String(source.id)} analysis`,
    );
    if (
      analysis.schemaVersion !== "kanvas.image-atomic-review-analysis/v1" ||
      analysis.sourceArtifactId !== source.artifactId
    ) {
      throw new Error(
        `Designer review analysis identity mismatch: ${String(source.id)}.`,
      );
    }
  }

  const actualFiles = await listFiles(root);
  const expectedFiles = ["manifest.json", ...packetFiles.keys()].sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error(
      "Designer review packet contains missing or untracked files.",
    );
  }

  const calculatedApprovalDigest = approvalDigest(manifest);
  if (
    manifest.evidenceClass === "designer_approved" &&
    (typeof approval.reviewer !== "string" ||
      approval.reviewer.length < 1 ||
      typeof approval.reviewedAt !== "string" ||
      !Number.isFinite(Date.parse(approval.reviewedAt)) ||
      approval.manifestDigest !== calculatedApprovalDigest)
  ) {
    throw new Error(
      "Designer-approved evidence requires reviewer identity, review time, and the canonical manifest digest.",
    );
  }
  if (
    manifest.evidenceClass === "designer_review_pending" &&
    approval.manifestDigest !== null
  ) {
    throw new Error(
      "Pending designer evidence cannot claim a manifest approval digest.",
    );
  }

  return Object.freeze({
    manifestPath,
    evidenceClass: manifest.evidenceClass,
    sourceCount: manifest.sources.length,
    fileCount: packetFiles.size,
    approvalDigest: calculatedApprovalDigest,
  });
}
