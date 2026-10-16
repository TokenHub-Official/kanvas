import { createHash, randomUUID } from "node:crypto";
import { constants as fileConstants } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import type {
  StorageByteRange,
  StorageCapabilities,
  StorageDeleteRequest,
  StorageObjectIdentity,
  StorageObjectInspection,
  StoragePort,
  StorageReadHandle,
  StorageReadRequest,
  StorageSealRequest,
  StorageWriteRequest,
  StorageWriteResult,
} from "@kanvas/application";

export type LocalStorageCrashCheckpoint =
  "after_temp_fsync" | "after_exclusive_publish" | "after_directory_fsync";

export interface CreateLocalFilesystemStorageOptions {
  readonly storageProfileId: string;
  readonly rootDirectory: string;
  /**
   * Local Filesystem has no portable openat-style directory capability in
   * Node.js. The configured 0700 root therefore has to be owned exclusively
   * by this process account; another process with the same OS uid is trusted.
   */
  readonly acknowledgeTrustedProcessRoot: true;
  readonly crashCheckpoint?: (
    checkpoint: LocalStorageCrashCheckpoint,
  ) => void | Promise<void>;
}

export type LocalFilesystemStorageErrorCode =
  | "local_storage.invalid_configuration"
  | "local_storage.invalid_identity"
  | "local_storage.path_unsafe"
  | "local_storage.object_exists"
  | "local_storage.object_missing"
  | "local_storage.object_not_regular"
  | "local_storage.size_limit_exceeded"
  | "local_storage.identity_mismatch"
  | "local_storage.object_changed"
  | "local_storage.io_failure"
  | "local_storage.simulated_crash";

export class LocalFilesystemStorageError extends Error {
  constructor(
    readonly code: LocalFilesystemStorageErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "LocalFilesystemStorageError";
  }
}

export class LocalStorageSimulatedCrashError extends LocalFilesystemStorageError {
  constructor(readonly checkpoint: LocalStorageCrashCheckpoint) {
    super(
      "local_storage.simulated_crash",
      `Simulated local storage crash at ${checkpoint}.`,
    );
    this.name = "LocalStorageSimulatedCrashError";
  }
}

interface ResolvedLocalIdentity {
  readonly finalPath: string;
  readonly parentPath: string;
  readonly relativeDirectorySegments: readonly string[];
  readonly basename: string;
  readonly temporaryPrefix: string;
}

interface TrustedRootFacts {
  readonly device: bigint;
  readonly inode: bigint;
  readonly owner: bigint;
}

const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const containerPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u;
const uint64Pattern = /^(?:0|[1-9][0-9]{0,19})$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const immutableIdentityHashPattern = /^sha256:[0-9a-f]{64}$/u;
const randomTemporarySuffixPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const maximumUint64 = 18_446_744_073_709_551_615n;
const maximumLocalObjectBytes = BigInt(Number.MAX_SAFE_INTEGER);
const readChunkSize = 64 * 1024;
const noFollow = fileConstants.O_NOFOLLOW ?? 0;
const directoryFlag = fileConstants.O_DIRECTORY ?? 0;

const capabilities = Object.freeze({
  uploadModes: Object.freeze(["server_stream"]),
  writeProtectionModes: Object.freeze(["server_owned"]),
  multipart: false,
  fullObjectChecksum: true,
  rangeRead: true,
  versionBoundIdentity: false,
  sealedIdentityImmutable: true,
  deploymentScope: "single_node",
  maximumObjectBytes: maximumLocalObjectBytes.toString(),
  serverSideEncryption: "not_provided",
} as const satisfies StorageCapabilities);

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

function fail(
  code: LocalFilesystemStorageErrorCode,
  message: string,
  cause?: unknown,
): never {
  throw new LocalFilesystemStorageError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function parseUint64(value: string, label: string): bigint {
  if (!uint64Pattern.test(value)) {
    return fail(
      "local_storage.invalid_identity",
      `${label} must be an unsigned decimal integer.`,
    );
  }
  const parsed = BigInt(value);
  if (parsed > maximumUint64) {
    return fail(
      "local_storage.invalid_identity",
      `${label} exceeds the uint64 boundary.`,
    );
  }
  return parsed;
}

function parseLocalByteCount(value: string, label: string): bigint {
  const parsed = parseUint64(value, label);
  if (parsed > maximumLocalObjectBytes) {
    return fail(
      "local_storage.size_limit_exceeded",
      `${label} exceeds the safe Local Filesystem boundary.`,
    );
  }
  return parsed;
}

function insideRoot(root: string, target: string): boolean {
  const relation = relative(root, target);
  return (
    relation === "" ||
    (!relation.startsWith(`..${sep}`) &&
      relation !== ".." &&
      !isAbsolute(relation))
  );
}

function assertIdentity(
  expectedProfileId: string,
  root: string,
  identity: StorageObjectIdentity,
): ResolvedLocalIdentity {
  if (
    identity.storageProfileId !== expectedProfileId ||
    !idPattern.test(identity.storageProfileId) ||
    identity.storageVersionId !== undefined ||
    !containerPattern.test(identity.container) ||
    identity.objectKey.length < 1 ||
    identity.objectKey.length > 800 ||
    hasControlCharacter(identity.objectKey) ||
    identity.objectKey.includes("\\") ||
    identity.objectKey.startsWith("/") ||
    isAbsolute(identity.objectKey)
  ) {
    return fail(
      "local_storage.invalid_identity",
      "Local object identity is invalid for this storage profile.",
    );
  }
  const segments = identity.objectKey.split("/");
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        segment.length > 255,
    )
  ) {
    return fail(
      "local_storage.invalid_identity",
      "Local object key contains an unsafe path segment.",
    );
  }
  const relativeSegments = [identity.container, ...segments];
  const finalPath = resolve(root, ...relativeSegments);
  if (!insideRoot(root, finalPath) || finalPath === root) {
    return fail(
      "local_storage.path_unsafe",
      "Resolved local object path escapes the configured root.",
    );
  }
  const objectBasename = basename(finalPath);
  return Object.freeze({
    finalPath,
    parentPath: dirname(finalPath),
    relativeDirectorySegments: relativeSegments.slice(0, -1),
    basename: objectBasename,
    temporaryPrefix: `.${objectBasename}.part.`,
  });
}

async function assertSafeDirectory(
  root: string,
  directory: string,
  trustedRoot: TrustedRootFacts,
): Promise<void> {
  let facts;
  try {
    facts = await lstat(directory, { bigint: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return fail(
        "local_storage.object_missing",
        "Local object directory is missing.",
      );
    }
    return fail(
      "local_storage.io_failure",
      "Could not inspect a local object directory.",
      error,
    );
  }
  if (facts.isSymbolicLink() || !facts.isDirectory()) {
    return fail(
      "local_storage.path_unsafe",
      "Local object directory is not a real directory.",
    );
  }
  if (facts.uid !== trustedRoot.owner || (facts.mode & 0o022n) !== 0n) {
    return fail(
      "local_storage.path_unsafe",
      "Local object directories must be owner-controlled and not group/world writable.",
    );
  }
  if (
    directory === root &&
    (facts.dev !== trustedRoot.device || facts.ino !== trustedRoot.inode)
  ) {
    return fail(
      "local_storage.path_unsafe",
      "Configured local storage root was replaced after startup.",
    );
  }
  const canonical = await realpath(directory);
  if (!insideRoot(root, canonical)) {
    return fail(
      "local_storage.path_unsafe",
      "Local object directory resolves outside the configured root.",
    );
  }
}

async function ensureSafeDirectories(
  root: string,
  segments: readonly string[],
  trustedRoot: TrustedRootFacts,
): Promise<void> {
  await assertSafeDirectory(root, root, trustedRoot);
  let current = root;
  for (const segment of segments) {
    const parent = current;
    current = join(parent, segment);
    let created = false;
    try {
      await mkdir(current, { mode: 0o700 });
      created = true;
    } catch (error) {
      if (!isNodeError(error) || error.code !== "EEXIST") {
        return fail(
          "local_storage.io_failure",
          "Could not create a local object directory.",
          error,
        );
      }
    }
    await assertSafeDirectory(root, current, trustedRoot);
    if (created) {
      /*
       * Persist every new directory entry before a child or object is
       * published beneath it. Syncing only the leaf would not make the
       * complete newly-created path durable across a host crash.
       */
      await syncDirectory(parent);
    }
  }
}

async function assertExistingDirectoryChain(
  root: string,
  segments: readonly string[],
  trustedRoot: TrustedRootFacts,
): Promise<boolean> {
  await assertSafeDirectory(root, root, trustedRoot);
  let current = root;
  for (const segment of segments) {
    current = join(current, segment);
    try {
      await assertSafeDirectory(root, current, trustedRoot);
    } catch (error) {
      if (
        error instanceof LocalFilesystemStorageError &&
        error.code === "local_storage.object_missing"
      ) {
        return false;
      }
      throw error;
    }
  }
  return true;
}

async function openRegularFile(
  path: string,
  trustedRoot: TrustedRootFacts,
): Promise<FileHandle | undefined> {
  let handle: FileHandle;
  try {
    handle = await open(path, fileConstants.O_RDONLY | noFollow);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    if (isNodeError(error) && error.code === "ELOOP") {
      return fail(
        "local_storage.path_unsafe",
        "Local object cannot be a symbolic link.",
      );
    }
    return fail(
      "local_storage.io_failure",
      "Could not open the local object.",
      error,
    );
  }
  const facts = await handle.stat({ bigint: true });
  if (
    !facts.isFile() ||
    facts.dev !== trustedRoot.device ||
    facts.uid !== trustedRoot.owner ||
    (facts.mode & 0o022n) !== 0n
  ) {
    await handle.close();
    return fail(
      facts.isFile()
        ? "local_storage.path_unsafe"
        : "local_storage.object_not_regular",
      facts.isFile()
        ? "Local object permissions or filesystem ownership are unsafe."
        : "Local object is not a regular file.",
    );
  }
  return handle;
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(
    path,
    fileConstants.O_RDONLY | directoryFlag | noFollow,
  );
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeAll(handle: FileHandle, chunk: Uint8Array): Promise<void> {
  const bytes = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  let offset = 0;
  while (offset < bytes.length) {
    const result = await handle.write(
      bytes,
      offset,
      bytes.length - offset,
      null,
    );
    if (result.bytesWritten < 1) {
      return fail(
        "local_storage.io_failure",
        "Local object write made no progress.",
      );
    }
    offset += result.bytesWritten;
  }
}

async function hashOpenFile(handle: FileHandle): Promise<{
  readonly byteSize: string;
  readonly sha256: string;
  readonly device: bigint;
  readonly inode: bigint;
  readonly mtimeNanoseconds: bigint;
}> {
  const before = await handle.stat({ bigint: true });
  if (before.size > maximumLocalObjectBytes) {
    return fail(
      "local_storage.size_limit_exceeded",
      "Local object exceeds the safe Local Filesystem boundary.",
    );
  }
  const digest = createHash("sha256");
  const buffer = Buffer.allocUnsafe(readChunkSize);
  let position = 0n;
  while (true) {
    const result = await handle.read(
      buffer,
      0,
      buffer.length,
      Number(position),
    );
    if (result.bytesRead === 0) {
      break;
    }
    digest.update(buffer.subarray(0, result.bytesRead));
    position += BigInt(result.bytesRead);
  }
  const after = await handle.stat({ bigint: true });
  if (
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeNs !== after.mtimeNs ||
    position !== after.size
  ) {
    return fail(
      "local_storage.object_changed",
      "Local object changed during inspection.",
    );
  }
  return Object.freeze({
    byteSize: after.size.toString(),
    sha256: digest.digest("hex"),
    device: after.dev,
    inode: after.ino,
    mtimeNanoseconds: after.mtimeNs,
  });
}

async function assertPathStillReferencesFile(
  path: string,
  fingerprint: {
    readonly device: bigint;
    readonly inode: bigint;
    readonly byteSize: string;
    readonly mtimeNanoseconds: bigint;
  },
): Promise<void> {
  let facts;
  try {
    facts = await lstat(path, { bigint: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return fail(
        "local_storage.object_changed",
        "Local object disappeared after verification.",
      );
    }
    return fail(
      "local_storage.io_failure",
      "Could not re-inspect the verified local object.",
      error,
    );
  }
  if (
    facts.isSymbolicLink() ||
    !facts.isFile() ||
    facts.dev !== fingerprint.device ||
    facts.ino !== fingerprint.inode ||
    facts.size.toString() !== fingerprint.byteSize ||
    facts.mtimeNs !== fingerprint.mtimeNanoseconds
  ) {
    return fail(
      "local_storage.object_changed",
      "Local object path changed after verification.",
    );
  }
}

function immutableIdentityHash(identity: StorageObjectIdentity): string {
  const hash = createHash("sha256")
    .update("kanvas:local-object-identity:v1\0")
    .update(identity.storageProfileId)
    .update("\0")
    .update(identity.container)
    .update("\0")
    .update(identity.objectKey)
    .update("\0")
    .digest("hex");
  return `sha256:${hash}`;
}

function inspection(
  identity: StorageObjectIdentity,
  byteSize: string,
  sha256: string,
): StorageObjectInspection {
  return Object.freeze({
    identity: Object.freeze({ ...identity }),
    byteSize,
    sha256,
    immutableIdentityHash: immutableIdentityHash(identity),
  });
}

function assertExpectedObjectFacts(
  identity: StorageObjectIdentity,
  expectedByteSize: string,
  expectedSha256: string,
  expectedImmutableIdentityHash: string,
): bigint {
  const parsedSize = parseLocalByteCount(
    expectedByteSize,
    "Expected byte size",
  );
  if (
    !sha256Pattern.test(expectedSha256) ||
    !immutableIdentityHashPattern.test(expectedImmutableIdentityHash) ||
    expectedImmutableIdentityHash !== immutableIdentityHash(identity)
  ) {
    return fail(
      "local_storage.invalid_identity",
      "Committed local object facts are invalid for this identity.",
    );
  }
  return parsedSize;
}

async function invokeCheckpoint(
  hook: CreateLocalFilesystemStorageOptions["crashCheckpoint"],
  checkpoint: LocalStorageCrashCheckpoint,
): Promise<void> {
  if (!hook) {
    return;
  }
  try {
    await hook(checkpoint);
  } catch {
    throw new LocalStorageSimulatedCrashError(checkpoint);
  }
}

function normalizedRange(
  range: StorageByteRange | undefined,
  size: bigint,
): { readonly start: bigint; readonly end: bigint } {
  if (!range) {
    return Object.freeze({
      start: 0n,
      end: size === 0n ? -1n : size - 1n,
    });
  }
  const start = parseLocalByteCount(range.start, "Range start");
  const end = parseLocalByteCount(range.endInclusive, "Range end");
  if (start > end || end >= size) {
    return fail(
      "local_storage.invalid_identity",
      "Requested byte range is outside the local object.",
    );
  }
  return Object.freeze({ start, end });
}

async function removeExactTemporaryFiles(
  parent: string,
  prefix: string,
  trustedRoot: TrustedRootFacts,
): Promise<boolean> {
  let entries;
  try {
    entries = await readdir(parent, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }
    return fail(
      "local_storage.io_failure",
      "Could not inspect local staging objects.",
      error,
    );
  }
  let removed = false;
  for (const entry of entries) {
    if (
      !entry.name.startsWith(prefix) ||
      !randomTemporarySuffixPattern.test(entry.name.slice(prefix.length))
    ) {
      continue;
    }
    const candidate = join(parent, entry.name);
    const facts = await lstat(candidate, { bigint: true });
    if (
      facts.isSymbolicLink() ||
      !facts.isFile() ||
      facts.dev !== trustedRoot.device ||
      facts.uid !== trustedRoot.owner ||
      (facts.mode & 0o022n) !== 0n
    ) {
      return fail(
        "local_storage.path_unsafe",
        "Local staging object is not a regular file.",
      );
    }
    await unlink(candidate);
    removed = true;
  }
  return removed;
}

export async function createLocalFilesystemStorageAdapter(
  options: CreateLocalFilesystemStorageOptions,
): Promise<StoragePort> {
  if (
    !idPattern.test(options.storageProfileId) ||
    !isAbsolute(options.rootDirectory) ||
    options.acknowledgeTrustedProcessRoot !== true
  ) {
    return fail(
      "local_storage.invalid_configuration",
      "Local storage requires an absolute root and stable profile identity.",
    );
  }
  const root = resolve(options.rootDirectory);
  let rootFacts;
  try {
    rootFacts = await lstat(root, { bigint: true });
  } catch (error) {
    return fail(
      "local_storage.invalid_configuration",
      "Configured local storage root is unavailable.",
      error,
    );
  }
  if (rootFacts.isSymbolicLink() || !rootFacts.isDirectory()) {
    return fail(
      "local_storage.invalid_configuration",
      "Configured local storage root must be a real directory.",
    );
  }
  const effectiveUid = process.geteuid?.();
  if (
    effectiveUid === undefined ||
    rootFacts.uid !== BigInt(effectiveUid) ||
    (rootFacts.mode & 0o022n) !== 0n
  ) {
    return fail(
      "local_storage.invalid_configuration",
      "Configured local storage root must be owned by this process account and not group/world writable.",
    );
  }
  const canonicalRoot = await realpath(root);
  if (canonicalRoot !== root) {
    return fail(
      "local_storage.invalid_configuration",
      "Configured local storage root must already be canonical.",
    );
  }
  const trustedRoot = Object.freeze({
    device: rootFacts.dev,
    inode: rootFacts.ino,
    owner: rootFacts.uid,
  });

  const adapter: StoragePort = {
    storageProfileId: options.storageProfileId,
    kind: "local",
    capabilities,

    async writeObject(
      request: StorageWriteRequest,
    ): Promise<StorageWriteResult> {
      const target = assertIdentity(
        options.storageProfileId,
        root,
        request.identity,
      );
      const maximum = parseUint64(request.maximumBytes, "Maximum bytes");
      if (maximum > maximumLocalObjectBytes) {
        return fail(
          "local_storage.size_limit_exceeded",
          "Maximum bytes exceeds the safe Local Filesystem boundary.",
        );
      }
      await ensureSafeDirectories(
        root,
        target.relativeDirectorySegments,
        trustedRoot,
      );
      const temporaryPath = join(
        target.parentPath,
        `${target.temporaryPrefix}${randomUUID()}`,
      );
      let handle: FileHandle | undefined;
      let temporaryExists = false;
      let published = false;
      try {
        handle = await open(
          temporaryPath,
          fileConstants.O_WRONLY |
            fileConstants.O_CREAT |
            fileConstants.O_EXCL |
            noFollow,
          0o600,
        );
        temporaryExists = true;
        const digest = createHash("sha256");
        let size = 0n;
        for await (const chunk of request.body) {
          if (!(chunk instanceof Uint8Array)) {
            return fail(
              "local_storage.io_failure",
              "Local storage body yielded a non-byte chunk.",
            );
          }
          size += BigInt(chunk.byteLength);
          if (size > maximum) {
            return fail(
              "local_storage.size_limit_exceeded",
              "Local object exceeds its allocated byte limit.",
            );
          }
          digest.update(chunk);
          await writeAll(handle, chunk);
        }
        await handle.sync();
        await handle.close();
        handle = undefined;
        await invokeCheckpoint(options.crashCheckpoint, "after_temp_fsync");
        const directoriesStable = await assertExistingDirectoryChain(
          root,
          target.relativeDirectorySegments,
          trustedRoot,
        );
        if (!directoriesStable) {
          return fail(
            "local_storage.path_unsafe",
            "Local object directory disappeared before publication.",
          );
        }
        try {
          await link(temporaryPath, target.finalPath);
        } catch (error) {
          if (isNodeError(error) && error.code === "EEXIST") {
            return fail(
              "local_storage.object_exists",
              "Local object identity has already been published.",
            );
          }
          return fail(
            "local_storage.io_failure",
            "Could not publish the local object exclusively.",
            error,
          );
        }
        published = true;
        await invokeCheckpoint(
          options.crashCheckpoint,
          "after_exclusive_publish",
        );
        await unlink(temporaryPath);
        temporaryExists = false;
        await syncDirectory(target.parentPath);
        await invokeCheckpoint(
          options.crashCheckpoint,
          "after_directory_fsync",
        );
        return Object.freeze({
          ...inspection(
            request.identity,
            size.toString(),
            digest.digest("hex"),
          ),
          writeProtectionMode: "server_owned",
        });
      } catch (error) {
        if (handle) {
          await handle.close().catch(() => undefined);
        }
        if (
          !(error instanceof LocalStorageSimulatedCrashError) &&
          !published &&
          temporaryExists
        ) {
          await unlink(temporaryPath).catch(() => undefined);
        }
        if (error instanceof LocalFilesystemStorageError) {
          throw error;
        }
        return fail(
          "local_storage.io_failure",
          published
            ? "Local object was published but final durability confirmation failed."
            : "Local object write failed before publication.",
          error,
        );
      }
    },

    async sealObject(
      request: StorageSealRequest,
    ): Promise<StorageObjectInspection> {
      if (!sha256Pattern.test(request.expectedSha256)) {
        return fail(
          "local_storage.invalid_identity",
          "Expected object digest is invalid.",
        );
      }
      parseLocalByteCount(request.expectedByteSize, "Expected byte size");
      const found = await adapter.inspectObject(request.identity);
      if (!found) {
        return fail(
          "local_storage.object_missing",
          "Local object is missing at seal.",
        );
      }
      if (
        found.byteSize !== request.expectedByteSize ||
        found.sha256 !== request.expectedSha256
      ) {
        return fail(
          "local_storage.identity_mismatch",
          "Local object does not match the seal facts.",
        );
      }
      return found;
    },

    async inspectObject(
      identity: StorageObjectIdentity,
    ): Promise<StorageObjectInspection | undefined> {
      const target = assertIdentity(options.storageProfileId, root, identity);
      const parentsExist = await assertExistingDirectoryChain(
        root,
        target.relativeDirectorySegments,
        trustedRoot,
      );
      if (!parentsExist) {
        return undefined;
      }
      const handle = await openRegularFile(target.finalPath, trustedRoot);
      if (!handle) {
        return undefined;
      }
      try {
        const result = await hashOpenFile(handle);
        return inspection(identity, result.byteSize, result.sha256);
      } finally {
        await handle.close();
      }
    },

    async openRead(request: StorageReadRequest): Promise<StorageReadHandle> {
      const target = assertIdentity(
        options.storageProfileId,
        root,
        request.identity,
      );
      const expectedSize = assertExpectedObjectFacts(
        request.identity,
        request.expectedByteSize,
        request.expectedSha256,
        request.expectedImmutableIdentityHash,
      );
      const parentsExist = await assertExistingDirectoryChain(
        root,
        target.relativeDirectorySegments,
        trustedRoot,
      );
      if (!parentsExist) {
        return fail("local_storage.object_missing", "Local object is missing.");
      }
      const openedHandle = await openRegularFile(target.finalPath, trustedRoot);
      if (!openedHandle) {
        return fail("local_storage.object_missing", "Local object is missing.");
      }
      const readableHandle = openedHandle;
      const verified = await hashOpenFile(readableHandle).catch(
        async (error: unknown) => {
          await readableHandle.close().catch(() => undefined);
          throw error;
        },
      );
      if (
        verified.byteSize !== expectedSize.toString() ||
        verified.sha256 !== request.expectedSha256
      ) {
        await readableHandle.close();
        return fail(
          "local_storage.identity_mismatch",
          "Local object no longer matches committed size and digest facts.",
        );
      }
      await assertPathStillReferencesFile(target.finalPath, verified).catch(
        async (error: unknown) => {
          await readableHandle.close().catch(() => undefined);
          throw error;
        },
      );
      const range = normalizedRange(request.range, expectedSize);
      const contentSize =
        range.end < range.start ? 0n : range.end - range.start + 1n;
      async function* body(): AsyncGenerator<Uint8Array> {
        try {
          let position = range.start;
          let remaining = contentSize;
          while (remaining > 0n) {
            const wanted = Number(
              remaining > BigInt(readChunkSize)
                ? BigInt(readChunkSize)
                : remaining,
            );
            const buffer = Buffer.allocUnsafe(wanted);
            const result = await readableHandle.read(
              buffer,
              0,
              wanted,
              Number(position),
            );
            if (result.bytesRead === 0) {
              return fail(
                "local_storage.object_changed",
                "Local object was truncated during reading.",
              );
            }
            position += BigInt(result.bytesRead);
            remaining -= BigInt(result.bytesRead);
            yield buffer.subarray(0, result.bytesRead);
          }
          const after = await readableHandle.stat({ bigint: true });
          if (
            after.dev !== verified.device ||
            after.ino !== verified.inode ||
            after.size.toString() !== verified.byteSize ||
            after.mtimeNs !== verified.mtimeNanoseconds
          ) {
            return fail(
              "local_storage.object_changed",
              "Local object changed while it was being read.",
            );
          }
        } finally {
          await readableHandle.close();
        }
      }
      return Object.freeze({
        identity: Object.freeze({ ...request.identity }),
        totalByteSize: expectedSize.toString(),
        contentByteSize: contentSize.toString(),
        ...(request.range
          ? {
              range: Object.freeze({
                start: range.start.toString(),
                endInclusive: range.end.toString(),
              }),
            }
          : {}),
        body: body(),
      });
    },

    async deleteObject(request: StorageDeleteRequest) {
      const target = assertIdentity(
        options.storageProfileId,
        root,
        request.identity,
      );
      const expectedSize = assertExpectedObjectFacts(
        request.identity,
        request.expectedByteSize,
        request.expectedSha256,
        request.expectedImmutableIdentityHash,
      );
      const parentsExist = await assertExistingDirectoryChain(
        root,
        target.relativeDirectorySegments,
        trustedRoot,
      );
      if (!parentsExist) {
        return Object.freeze({ disposition: "missing" });
      }
      let removed = false;
      const openedHandle = await openRegularFile(target.finalPath, trustedRoot);
      if (openedHandle) {
        let verified;
        try {
          verified = await hashOpenFile(openedHandle);
          if (
            verified.byteSize !== expectedSize.toString() ||
            verified.sha256 !== request.expectedSha256
          ) {
            return fail(
              "local_storage.identity_mismatch",
              "Local object no longer matches committed delete facts.",
            );
          }
          await assertPathStillReferencesFile(target.finalPath, verified);
        } finally {
          await openedHandle.close();
        }
        await assertExistingDirectoryChain(
          root,
          target.relativeDirectorySegments,
          trustedRoot,
        );
        try {
          await unlink(target.finalPath);
          removed = true;
        } catch (error) {
          if (isNodeError(error) && error.code === "ENOENT") {
            return fail(
              "local_storage.object_changed",
              "Local object disappeared before exact deletion.",
            );
          }
          throw error;
        }
      }
      const removedTemporary = await removeExactTemporaryFiles(
        target.parentPath,
        target.temporaryPrefix,
        trustedRoot,
      );
      if (removed || removedTemporary) {
        await syncDirectory(target.parentPath);
      }
      return Object.freeze({
        disposition: removed || removedTemporary ? "deleted" : "missing",
      });
    },

    async cleanupUnpublishedObject(identity) {
      const target = assertIdentity(options.storageProfileId, root, identity);
      const parentsExist = await assertExistingDirectoryChain(
        root,
        target.relativeDirectorySegments,
        trustedRoot,
      );
      if (!parentsExist) {
        return Object.freeze({ disposition: "missing" });
      }
      /*
       * An unsealed DB claim has no committed content digest. Never unlink
       * the final key in that state: a crash after exclusive publication but
       * before sealing needs reconciliation, not an identity-only delete.
       */
      const published = await openRegularFile(target.finalPath, trustedRoot);
      if (published) {
        await published.close();
        return fail(
          "local_storage.identity_mismatch",
          "Unsealed cleanup found a published object and requires reconciliation.",
        );
      }
      const removed = await removeExactTemporaryFiles(
        target.parentPath,
        target.temporaryPrefix,
        trustedRoot,
      );
      if (removed) {
        await syncDirectory(target.parentPath);
      }
      return Object.freeze({
        disposition: removed ? "deleted" : "missing",
      });
    },
  };
  return Object.freeze(adapter);
}
