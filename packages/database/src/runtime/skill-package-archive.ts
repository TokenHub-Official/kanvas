import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";

import { digestProviderValue } from "./provider-value-digest.js";

const localFileHeaderSignature = 0x04034b50;
const centralDirectorySignature = 0x02014b50;
const endOfCentralDirectorySignature = 0x06054b50;
const maximumZipCommentBytes = 1024;
const maximumEocdSearchBytes = 65_557;
const supportedFlagMask = 0x0806;
const utf8Flag = 0x0800;
const encryptedFlag = 0x0001;
const dataDescriptorFlag = 0x0008;
const unixPlatform = 3;
const unixFileTypeMask = 0o170000;
const unixRegularFile = 0o100000;
const unixDirectory = 0o040000;
const dosDirectoryAttribute = 0x10;
const archiveExtensionPattern =
  /\.(?:zip|tar|tgz|gz|bz2|xz|7z|rar|cab|iso|dmg)$/iu;
const executableExtensionPattern =
  /\.(?:pyc|exe|dll|dylib|so|wasm|class|jar|com|html?|svg)$/iu;

export type SkillArchiveFilenameEncoding =
  "auto" | "utf-8" | "gb18030" | "big5" | "shift_jis" | "cp437";

export interface SkillPackageArchiveLimits {
  readonly maximumArchiveBytes: number;
  readonly maximumFiles: number;
  readonly maximumFileBytes: number;
  readonly maximumExpandedBytes: number;
  readonly maximumCompressionRatio: number;
  readonly maximumPathBytes: number;
  readonly maximumPathDepth: number;
}

export const defaultSkillPackageArchiveLimits =
  Object.freeze<SkillPackageArchiveLimits>({
    maximumArchiveBytes: 64 * 1024 * 1024,
    maximumFiles: 256,
    maximumFileBytes: 32 * 1024 * 1024,
    maximumExpandedBytes: 256 * 1024 * 1024,
    maximumCompressionRatio: 100,
    maximumPathBytes: 500,
    maximumPathDepth: 12,
  });

export const skillArchiveMediaTypes = Object.freeze([
  "text/plain",
  "text/markdown",
  "application/json",
  "application/yaml",
  "image/png",
  "image/jpeg",
  "image/webp",
  "font/woff",
  "font/woff2",
  "font/ttf",
  "font/otf",
] as const);
export type SkillArchiveMediaType = (typeof skillArchiveMediaTypes)[number];

export interface ExtractedSkillArchiveEntry {
  readonly path: string;
  readonly byteSize: number;
  readonly sha256: string;
  readonly mediaType: SkillArchiveMediaType;
  readonly bytes: Uint8Array;
}

export interface ExtractedSkillPackageArchive {
  readonly archiveSha256: string;
  readonly logicalPackageDigest: string;
  readonly entries: readonly ExtractedSkillArchiveEntry[];
}

export type SkillPackageArchiveErrorCode =
  | "skill_archive.invalid_argument"
  | "skill_archive.invalid_zip"
  | "skill_archive.limit_exceeded"
  | "skill_archive.path_rejected"
  | "skill_archive.entry_rejected"
  | "skill_archive.content_rejected"
  | "skill_archive.required_file_missing"
  | "skill_archive.encoding_invalid"
  | "skill_archive.multiple_skills";

export class SkillPackageArchiveError extends Error {
  public constructor(
    public readonly code: SkillPackageArchiveErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SkillPackageArchiveError";
  }
}

interface CentralDirectoryEntry {
  readonly path: string;
  readonly rawName: Buffer;
  readonly flags: number;
  readonly compressionMethod: 0 | 8;
  readonly crc32: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
  readonly directory: boolean;
}

interface EntrySpan {
  readonly start: number;
  readonly end: number;
  readonly entry: CentralDirectoryEntry;
  readonly compressedBytes: Buffer;
}

function fail(
  code: SkillPackageArchiveErrorCode,
  message: string,
  cause?: unknown,
): never {
  throw new SkillPackageArchiveError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}

function assertPositiveInteger(
  value: number,
  label: string,
  maximum: number,
): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    fail(
      "skill_archive.invalid_argument",
      `${label} must be a bounded positive integer.`,
    );
  }
}

function normalizeLimits(
  limits: Partial<SkillPackageArchiveLimits> | undefined,
): SkillPackageArchiveLimits {
  const normalized = Object.freeze({
    ...defaultSkillPackageArchiveLimits,
    ...limits,
  });
  assertPositiveInteger(
    normalized.maximumArchiveBytes,
    "maximumArchiveBytes",
    1024 * 1024 * 1024,
  );
  assertPositiveInteger(normalized.maximumFiles, "maximumFiles", 10_000);
  assertPositiveInteger(
    normalized.maximumFileBytes,
    "maximumFileBytes",
    1024 * 1024 * 1024,
  );
  assertPositiveInteger(
    normalized.maximumExpandedBytes,
    "maximumExpandedBytes",
    4 * 1024 * 1024 * 1024,
  );
  assertPositiveInteger(
    normalized.maximumCompressionRatio,
    "maximumCompressionRatio",
    10_000,
  );
  assertPositiveInteger(normalized.maximumPathBytes, "maximumPathBytes", 4096);
  assertPositiveInteger(normalized.maximumPathDepth, "maximumPathDepth", 128);
  if (normalized.maximumFileBytes > normalized.maximumExpandedBytes) {
    fail(
      "skill_archive.invalid_argument",
      "maximumFileBytes cannot exceed maximumExpandedBytes.",
    );
  }
  return normalized;
}

function asBuffer(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function requireRange(
  buffer: Buffer,
  offset: number,
  length: number,
  label: string,
): void {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset + length > buffer.length
  ) {
    fail("skill_archive.invalid_zip", `${label} exceeds the ZIP byte range.`);
  }
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const lowerBound = Math.max(0, buffer.length - maximumEocdSearchBytes);
  for (let offset = buffer.length - 22; offset >= lowerBound; offset -= 1) {
    if (buffer.readUInt32LE(offset) !== endOfCentralDirectorySignature) {
      continue;
    }
    requireRange(buffer, offset, 22, "End of Central Directory");
    const commentLength = buffer.readUInt16LE(offset + 20);
    if (
      commentLength > maximumZipCommentBytes ||
      offset + 22 + commentLength !== buffer.length
    ) {
      continue;
    }
    return offset;
  }
  return fail(
    "skill_archive.invalid_zip",
    "ZIP End of Central Directory is missing or malformed.",
  );
}

// ZIP's legacy default is CP437. Do not guess between ambiguous regional encodings.
const cp437HighCharacters =
  "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\xa0";
function decodeEntryName(
  rawName: Buffer,
  flags: number,
  extra: Buffer,
  encoding: SkillArchiveFilenameEncoding,
): string {
  try {
    // Info-ZIP Unicode Path (0x7075) is authoritative only with a matching CRC.
    for (let offset = 0; offset + 4 <= extra.length;) {
      const kind = extra.readUInt16LE(offset);
      const size = extra.readUInt16LE(offset + 2);
      const data = extra.subarray(offset + 4, offset + 4 + size);
      if (data.length !== size) throw new Error("Truncated ZIP extra field");
      if (
        kind === 0x7075 &&
        size >= 5 &&
        data[0] === 1 &&
        data.readUInt32LE(1) === skillArchiveCrc32(rawName)
      ) {
        return new TextDecoder("utf-8", { fatal: true })
          .decode(data.subarray(5))
          .normalize("NFC");
      }
      offset += 4 + size;
    }
    if ((flags & utf8Flag) !== 0 || encoding === "utf-8") {
      return new TextDecoder("utf-8", { fatal: true })
        .decode(rawName)
        .normalize("NFC");
    }
    if (encoding === "auto") {
      try {
        return new TextDecoder("utf-8", { fatal: true })
          .decode(rawName)
          .normalize("NFC");
      } catch {
        /* Legacy ZIP without Unicode metadata. */
      }
    } else if (encoding !== "cp437") {
      return new TextDecoder(encoding, { fatal: true })
        .decode(rawName)
        .normalize("NFC");
    }
    return [...rawName]
      .map((byte) =>
        byte < 128
          ? String.fromCharCode(byte)
          : cp437HighCharacters[byte - 128],
      )
      .join("")
      .normalize("NFC");
  } catch (error) {
    return fail(
      "skill_archive.encoding_invalid",
      "ZIP filenames could not be decoded. Choose the original filename encoding or recreate the ZIP with UTF-8 filenames.",
      error,
    );
  }
}

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint < 32 || codePoint === 127);
  });
}

function validatePath(
  path: string,
  limits: SkillPackageArchiveLimits,
  directory: boolean,
): string {
  const normalizedPath =
    directory && path.endsWith("/") ? path.slice(0, -1) : path;
  if (
    normalizedPath.length < 1 ||
    Buffer.byteLength(normalizedPath, "utf8") > limits.maximumPathBytes ||
    normalizedPath.startsWith("/") ||
    normalizedPath.includes("\\") ||
    normalizedPath.includes(":") ||
    containsControlCharacter(normalizedPath) ||
    normalizedPath !== normalizedPath.normalize("NFC")
  ) {
    fail(
      "skill_archive.path_rejected",
      "ZIP entry path is not a normalized relative path.",
    );
  }
  const segments = normalizedPath.split("/");
  if (
    segments.length > limits.maximumPathDepth ||
    segments.some(
      (segment) =>
        segment.length < 1 ||
        segment === "." ||
        segment === ".." ||
        segment.endsWith(" ") ||
        segment.endsWith("."),
    )
  ) {
    fail(
      "skill_archive.path_rejected",
      "ZIP entry path exceeds the bounded path profile.",
    );
  }
  return normalizedPath;
}

function directoryFact(
  path: string,
  versionMadeBy: number,
  externalAttributes: number,
): boolean {
  const platform = versionMadeBy >>> 8;
  if (platform === unixPlatform) {
    const mode = externalAttributes >>> 16;
    const fileType = mode & unixFileTypeMask;
    if (
      fileType !== 0 &&
      fileType !== unixRegularFile &&
      fileType !== unixDirectory
    ) {
      fail(
        "skill_archive.entry_rejected",
        "ZIP contains a link, device, or non-regular filesystem entry.",
      );
    }
    return fileType === unixDirectory || path.endsWith("/");
  }
  return (
    (externalAttributes & dosDirectoryAttribute) !== 0 || path.endsWith("/")
  );
}

function parseCentralDirectory(
  buffer: Buffer,
  eocdOffset: number,
  limits: SkillPackageArchiveLimits,
  filenameEncoding: SkillArchiveFilenameEncoding,
): {
  readonly entries: readonly CentralDirectoryEntry[];
  readonly centralDirectoryOffset: number;
} {
  const diskNumber = buffer.readUInt16LE(eocdOffset + 4);
  const centralDiskNumber = buffer.readUInt16LE(eocdOffset + 6);
  const entriesOnDisk = buffer.readUInt16LE(eocdOffset + 8);
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (
    diskNumber !== 0 ||
    centralDiskNumber !== 0 ||
    entriesOnDisk !== totalEntries ||
    totalEntries === 0 ||
    totalEntries === 0xffff ||
    centralDirectorySize === 0xffffffff ||
    centralDirectoryOffset === 0xffffffff
  ) {
    fail(
      "skill_archive.invalid_zip",
      "Multi-disk, empty, or ZIP64 archives are not supported.",
    );
  }
  if (totalEntries > limits.maximumFiles + 256) {
    fail(
      "skill_archive.limit_exceeded",
      "ZIP Central Directory exceeds the entry-count bound.",
    );
  }
  requireRange(
    buffer,
    centralDirectoryOffset,
    centralDirectorySize,
    "Central Directory",
  );
  if (centralDirectoryOffset + centralDirectorySize !== eocdOffset) {
    fail(
      "skill_archive.invalid_zip",
      "Central Directory has an unexpected byte range.",
    );
  }

  const entries: CentralDirectoryEntry[] = [];
  let offset = centralDirectoryOffset;
  let fileCount = 0;
  let expandedBytes = 0;
  const collisionKeys = new Set<string>();
  for (let index = 0; index < totalEntries; index += 1) {
    requireRange(buffer, offset, 46, "Central Directory entry");
    if (buffer.readUInt32LE(offset) !== centralDirectorySignature) {
      fail(
        "skill_archive.invalid_zip",
        "Central Directory entry signature is invalid.",
      );
    }
    const versionMadeBy = buffer.readUInt16LE(offset + 4);
    const flags = buffer.readUInt16LE(offset + 8);
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const crc32 = buffer.readUInt32LE(offset + 16);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const diskStart = buffer.readUInt16LE(offset + 34);
    const externalAttributes = buffer.readUInt32LE(offset + 38);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const entryLength = 46 + nameLength + extraLength + commentLength;
    requireRange(buffer, offset, entryLength, "Central Directory entry");
    if (
      diskStart !== 0 ||
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff
    ) {
      fail(
        "skill_archive.invalid_zip",
        "ZIP64 or multi-disk entry metadata is not supported.",
      );
    }
    if (
      (flags & encryptedFlag) !== 0 ||
      (flags & dataDescriptorFlag) !== 0 ||
      (flags & ~supportedFlagMask) !== 0
    ) {
      fail(
        "skill_archive.entry_rejected",
        "Encrypted, descriptor-based, or unsupported ZIP entries are rejected.",
      );
    }
    if (compressionMethod !== 0 && compressionMethod !== 8) {
      fail(
        "skill_archive.entry_rejected",
        "ZIP entry compression method is not supported.",
      );
    }
    const rawName = buffer.subarray(offset + 46, offset + 46 + nameLength);
    const decodedPath = decodeEntryName(
      rawName,
      flags,
      buffer.subarray(
        offset + 46 + nameLength,
        offset + 46 + nameLength + extraLength,
      ),
      filenameEncoding,
    );
    const directory = directoryFact(
      decodedPath,
      versionMadeBy,
      externalAttributes,
    );
    const path = validatePath(decodedPath, limits, directory);
    const collisionKey = path.toLowerCase();
    if (collisionKeys.has(collisionKey)) {
      fail(
        "skill_archive.path_rejected",
        "ZIP contains a Unicode or case-insensitive path collision.",
      );
    }
    collisionKeys.add(collisionKey);
    if (directory) {
      if (compressedSize !== 0 || uncompressedSize !== 0) {
        fail(
          "skill_archive.entry_rejected",
          "ZIP directory entries must be empty.",
        );
      }
    } else {
      fileCount += 1;
      expandedBytes += uncompressedSize;
      if (
        fileCount > limits.maximumFiles ||
        uncompressedSize > limits.maximumFileBytes ||
        expandedBytes > limits.maximumExpandedBytes
      ) {
        fail(
          "skill_archive.limit_exceeded",
          "ZIP expanded resource bounds are exceeded.",
        );
      }
      if (
        (compressedSize === 0 && uncompressedSize > 0) ||
        (compressedSize > 0 &&
          uncompressedSize / compressedSize > limits.maximumCompressionRatio)
      ) {
        fail(
          "skill_archive.limit_exceeded",
          "ZIP compression ratio exceeds the configured bound.",
        );
      }
      if (
        archiveExtensionPattern.test(path) ||
        executableExtensionPattern.test(path)
      ) {
        fail(
          "skill_archive.content_rejected",
          "Nested archives, binaries, HTML and SVG are not supported. Remove them and import again.",
        );
      }
    }
    entries.push(
      Object.freeze({
        path,
        rawName: Buffer.from(rawName),
        flags,
        compressionMethod,
        crc32,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
        directory,
      }),
    );
    offset += entryLength;
  }
  if (offset !== eocdOffset || fileCount < 1) {
    fail(
      "skill_archive.invalid_zip",
      "Central Directory count or boundary is inconsistent.",
    );
  }
  return Object.freeze({
    entries: Object.freeze(entries),
    centralDirectoryOffset,
  });
}

function resolveEntrySpans(
  buffer: Buffer,
  entries: readonly CentralDirectoryEntry[],
  centralDirectoryOffset: number,
): readonly EntrySpan[] {
  const spans = entries.map((entry): EntrySpan => {
    const offset = entry.localHeaderOffset;
    requireRange(buffer, offset, 30, "Local File Header");
    if (buffer.readUInt32LE(offset) !== localFileHeaderSignature) {
      fail(
        "skill_archive.invalid_zip",
        "Local File Header signature is invalid.",
      );
    }
    const flags = buffer.readUInt16LE(offset + 6);
    const compressionMethod = buffer.readUInt16LE(offset + 8);
    const crc32 = buffer.readUInt32LE(offset + 14);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const uncompressedSize = buffer.readUInt32LE(offset + 22);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const headerLength = 30 + nameLength + extraLength;
    const dataStart = offset + headerLength;
    const dataEnd = dataStart + entry.compressedSize;
    requireRange(buffer, offset, headerLength, "Local File Header");
    requireRange(buffer, dataStart, entry.compressedSize, "ZIP entry data");
    const localName = buffer.subarray(offset + 30, offset + 30 + nameLength);
    if (
      flags !== entry.flags ||
      compressionMethod !== entry.compressionMethod ||
      crc32 !== entry.crc32 ||
      compressedSize !== entry.compressedSize ||
      uncompressedSize !== entry.uncompressedSize ||
      !localName.equals(entry.rawName) ||
      dataEnd > centralDirectoryOffset
    ) {
      fail(
        "skill_archive.invalid_zip",
        "Local and Central ZIP entry identities differ.",
      );
    }
    return Object.freeze({
      start: offset,
      end: dataEnd,
      entry,
      compressedBytes: buffer.subarray(dataStart, dataEnd),
    });
  });
  const sorted = [...spans].sort((left, right) => left.start - right.start);
  for (let index = 1; index < sorted.length; index += 1) {
    if ((sorted[index - 1]?.end ?? 0) > (sorted[index]?.start ?? 0)) {
      fail(
        "skill_archive.invalid_zip",
        "ZIP Local File Header ranges overlap.",
      );
    }
  }
  return Object.freeze(spans);
}

let crc32Table: Uint32Array | undefined;

function crcTable(): Uint32Array {
  if (crc32Table) {
    return crc32Table;
  }
  const table = new Uint32Array(256);
  for (let value = 0; value < 256; value += 1) {
    let current = value;
    for (let bit = 0; bit < 8; bit += 1) {
      current =
        (current & 1) !== 0 ? 0xedb88320 ^ (current >>> 1) : current >>> 1;
    }
    table[value] = current >>> 0;
  }
  crc32Table = table;
  return table;
}

export function skillArchiveCrc32(bytes: Uint8Array): number {
  const table = crcTable();
  let checksum = 0xffffffff;
  for (const byte of bytes) {
    checksum = (table[(checksum ^ byte) & 0xff] ?? 0) ^ (checksum >>> 8);
  }
  return (checksum ^ 0xffffffff) >>> 0;
}

function decodeEntry(span: EntrySpan): Buffer {
  const { entry } = span;
  let decoded: Buffer;
  try {
    decoded =
      entry.compressionMethod === 0
        ? Buffer.from(span.compressedBytes)
        : inflateRawSync(span.compressedBytes, {
            maxOutputLength: entry.uncompressedSize,
          });
  } catch (error) {
    return fail(
      "skill_archive.content_rejected",
      "ZIP entry could not be decompressed within its declared bound.",
      error,
    );
  }
  if (
    decoded.length !== entry.uncompressedSize ||
    skillArchiveCrc32(decoded) !== entry.crc32
  ) {
    fail(
      "skill_archive.content_rejected",
      "ZIP entry size or CRC does not match its immutable inventory.",
    );
  }
  return decoded;
}

function startsWith(bytes: Buffer, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function assertUtf8Text(bytes: Buffer, path: string): void {
  let text: string;
  try {
    text = new TextDecoder("utf-8", {
      fatal: true,
    }).decode(bytes);
  } catch (error) {
    return fail(
      "skill_archive.content_rejected",
      `${path} is not valid UTF-8 text.`,
      error,
    );
  }
  if (text.includes("\u0000")) {
    fail("skill_archive.content_rejected", `${path} contains a NUL character.`);
  }
}

function assertSafeJson(bytes: Buffer, path: string): void {
  assertUtf8Text(bytes, path);
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch (error) {
    return fail(
      "skill_archive.content_rejected",
      `${path} is not valid JSON.`,
      error,
    );
  }
  const pending: { readonly value: unknown; readonly depth: number }[] = [
    { value, depth: 0 },
  ];
  let nodes = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) {
      break;
    }
    nodes += 1;
    if (nodes > 100_000 || current.depth > 64) {
      fail(
        "skill_archive.limit_exceeded",
        `${path} exceeds the JSON structure bound.`,
      );
    }
    if (current.value === null || typeof current.value !== "object") {
      continue;
    }
    if (Array.isArray(current.value)) {
      for (const item of current.value) {
        pending.push({
          value: item,
          depth: current.depth + 1,
        });
      }
      continue;
    }
    for (const [key, item] of Object.entries(
      current.value as Readonly<Record<string, unknown>>,
    )) {
      if (key === "__proto__" || key === "prototype" || key === "constructor") {
        fail(
          "skill_archive.content_rejected",
          `${path} contains a forbidden prototype key.`,
        );
      }
      pending.push({
        value: item,
        depth: current.depth + 1,
      });
    }
  }
}

function mediaTypeFor(path: string, bytes: Buffer): SkillArchiveMediaType {
  const lower = path.toLowerCase();
  if (
    /\.(?:txt|csv|css|toml|ini|js|mjs|cjs|ts|tsx|jsx|sh|bash|zsh|py|rb|php|pl|bat|cmd|ps1)$/u.test(
      lower,
    )
  ) {
    assertUtf8Text(bytes, path);
    return "text/plain";
  }
  if (lower.endsWith(".md")) {
    assertUtf8Text(bytes, path);
    return "text/markdown";
  }
  if (lower.endsWith(".json")) {
    assertSafeJson(bytes, path);
    return "application/json";
  }
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) {
    assertUtf8Text(bytes, path);
    return "application/yaml";
  }
  if (
    lower.endsWith(".png") &&
    startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  ) {
    return "image/png";
  }
  if (
    (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) &&
    startsWith(bytes, [0xff, 0xd8, 0xff])
  ) {
    return "image/jpeg";
  }
  if (
    lower.endsWith(".webp") &&
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  if (lower.endsWith(".woff") && bytes.toString("ascii", 0, 4) === "wOFF") {
    return "font/woff";
  }
  if (lower.endsWith(".woff2") && bytes.toString("ascii", 0, 4) === "wOF2") {
    return "font/woff2";
  }
  if (lower.endsWith(".ttf") && startsWith(bytes, [0x00, 0x01, 0x00, 0x00])) {
    return "font/ttf";
  }
  if (lower.endsWith(".otf") && bytes.toString("ascii", 0, 4) === "OTTO") {
    return "font/otf";
  }
  return fail(
    "skill_archive.content_rejected",
    `${path} has an unknown, mismatched, or disallowed media type.`,
  );
}

export function inspectAndExtractSkillPackageArchive(
  bytes: Uint8Array,
  limitOverrides?: Partial<SkillPackageArchiveLimits>,
  filenameEncoding: SkillArchiveFilenameEncoding = "auto",
): ExtractedSkillPackageArchive {
  const limits = normalizeLimits(limitOverrides);
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength < 22 ||
    bytes.byteLength > limits.maximumArchiveBytes
  ) {
    fail(
      "skill_archive.limit_exceeded",
      "Skill package archive size is outside the configured bound.",
    );
  }
  const buffer = asBuffer(bytes);
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const { entries, centralDirectoryOffset } = parseCentralDirectory(
    buffer,
    eocdOffset,
    limits,
    filenameEncoding,
  );
  const spans = resolveEntrySpans(buffer, entries, centralDirectoryOffset);
  const extracted: ExtractedSkillArchiveEntry[] = [];
  for (const span of spans) {
    if (span.entry.directory) {
      continue;
    }
    const decoded = decodeEntry(span);
    if (
      span.entry.path
        .split("/")
        .some(
          (part) =>
            part === "__MACOSX" ||
            part === ".DS_Store" ||
            part.startsWith("._"),
        )
    )
      continue;
    const mediaType = mediaTypeFor(span.entry.path, decoded);
    extracted.push(
      Object.freeze({
        path: span.entry.path,
        byteSize: decoded.length,
        sha256: createHash("sha256").update(decoded).digest("hex"),
        mediaType,
        bytes: Uint8Array.from(decoded),
      }),
    );
  }
  const roots = extracted.filter(
    ({ path }) => path === "SKILL.md" || /^[^/]+\/SKILL\.md$/u.test(path),
  );
  if (roots.length > 1)
    fail(
      "skill_archive.multiple_skills",
      "This ZIP contains multiple Skills. Upload one Skill folder at a time.",
    );
  const root = roots[0];
  if (!root)
    fail(
      "skill_archive.required_file_missing",
      "Add SKILL.md at the ZIP root or inside a single top-level folder.",
    );
  const prefix = root.path.slice(0, -"SKILL.md".length);
  if (prefix && extracted.some(({ path }) => !path.startsWith(prefix))) {
    fail(
      "skill_archive.multiple_skills",
      "The ZIP contains files outside the Skill folder. Compress only the Skill folder and import again.",
    );
  }
  const normalized = extracted
    .map((entry) =>
      Object.freeze({ ...entry, path: entry.path.slice(prefix.length) }),
    )
    .sort((left, right) => {
      if (left.path < right.path) return -1;
      return left.path > right.path ? 1 : 0;
    });
  return Object.freeze({
    archiveSha256: createHash("sha256").update(buffer).digest("hex"),
    logicalPackageDigest: digestProviderValue(
      normalized.map(({ path, byteSize, sha256, mediaType }) => ({
        path,
        byteSize,
        sha256,
        mediaType,
      })),
    ),
    entries: Object.freeze(normalized),
  });
}
