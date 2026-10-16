import { createHash } from "node:crypto";
import {
  assertLibraryId,
  readLibraryTextPassages,
  libraryTextPassages,
  DomainError,
  libraryTextMaximumBytes,
  type AgentActionReceiptRecord,
  type StorageProfileRegistry,
  type TrustedWorkspaceScope,
} from "@kanvas/application";
import type {
  AgentLibraryReference,
  AgentLibraryStore,
} from "@kanvas/database/runtime";
import { loadLibraryDocumentText } from "@kanvas/storage";
import type {
  LibraryResourceExecutor,
  LibraryToolExecution,
  KanvasAgentToolExecution,
} from "@kanvas/agent-runtime";

const maximumImageBytes = 32 * 1024 * 1024;
function input(
  value: unknown,
  allowed: readonly string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    throw new TypeError("Invalid library tool input.");
  return value as Record<string, unknown>;
}
export async function readAgentLibraryBytes(
  profiles: StorageProfileRegistry,
  reference: AgentLibraryReference,
  signal: AbortSignal,
): Promise<Buffer> {
  signal.throwIfAborted();
  const limit = reference.mediaType.startsWith("text/")
    ? libraryTextMaximumBytes
    : maximumImageBytes;
  const size = Number(reference.byteSize);
  if (!Number.isSafeInteger(size) || size < 1 || size > limit)
    throw new DomainError(
      "resource_library.content_limit",
      "The reference exceeds the model input limit.",
    );
  const profile = profiles.resolve(reference.storageProfileId);
  if (!profile)
    throw new DomainError(
      "resource_library.storage_unavailable",
      "Reference storage is unavailable.",
    );
  const read = await profile.adapter.openRead({
    identity: {
      storageProfileId: reference.storageProfileId,
      container: reference.container,
      objectKey: reference.objectKey,
    },
    expectedByteSize: reference.byteSize,
    expectedSha256: reference.sha256,
    expectedImmutableIdentityHash: reference.immutableIdentityHash,
  });
  if (
    read.totalByteSize !== reference.byteSize ||
    read.contentByteSize !== reference.byteSize ||
    read.range
  )
    throw new DomainError(
      "resource_library.integrity",
      "Reference byte identity changed.",
    );
  const chunks: Buffer[] = [];
  let consumed = 0;
  for await (const chunk of read.body) {
    signal.throwIfAborted();
    consumed += chunk.byteLength;
    if (consumed > size)
      throw new DomainError(
        "resource_library.integrity",
        "Reference content exceeded its verified size.",
      );
    chunks.push(Buffer.from(chunk));
  }
  const bytes = Buffer.concat(chunks, consumed);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (
    consumed !== size ||
    digest !== reference.sha256 ||
    reference.contentDigest !== `sha256:${digest}`
  )
    throw new DomainError(
      "resource_library.integrity",
      "Reference digest verification failed.",
    );
  return bytes;
}
export function createAgentLibraryResourceExecutor(options: {
  readonly authority: TrustedWorkspaceScope;
  readonly runId: string;
  readonly libraries: AgentLibraryStore;
  readonly profiles: StorageProfileRegistry;
  readonly signal: AbortSignal;
  readonly now: () => Date;
  readonly canReadImages: () => Promise<boolean>;
  readonly executeWithReceipt: (
    key: string,
    input: unknown,
    operation: (
      action: AgentActionReceiptRecord,
    ) => Promise<KanvasAgentToolExecution>,
    failure: (error: unknown) => string,
  ) => Promise<KanvasAgentToolExecution>;
}): LibraryResourceExecutor {
  const scope = () => ({
    authority: options.authority,
    runId: options.runId,
    now: options.now(),
  });
  return {
    searchContent(value) {
      const parsed = input(value, ["query", "libraryId"]);
      if (
        typeof parsed.query !== "string" ||
        !parsed.query.trim() ||
        parsed.query.length > 200
      )
        throw new TypeError("Invalid content query.");
      if (parsed.libraryId !== undefined) assertLibraryId(parsed.libraryId);
      const query = parsed.query;
      return options.executeWithReceipt(
        "library.search_content",
        value,
        async (action) => {
          const pending = await options.libraries.pendingText({
            ...scope(),
            ...(typeof parsed.libraryId === "string"
              ? { libraryId: parsed.libraryId }
              : {}),
          });
          const indexFailures = [];
          for (const source of pending.slice(0, 8)) {
            try {
              options.signal.throwIfAborted();
              const loaded = await loadLibraryDocumentText(
                source,
                options.profiles,
              );
              await options.libraries.cacheText({
                ...scope(),
                libraryId: source.libraryId,
                artifactId: source.artifactId,
                contentDigest: source.contentDigest,
                ...loaded,
              });
            } catch (error) {
              if (options.signal.aborted) throw error;
              indexFailures.push({
                libraryId: source.libraryId,
                artifactId: source.artifactId,
                error: "document_index_unavailable",
              });
            }
          }
          const matches = await options.libraries.searchText({
            ...scope(),
            query,
            ...(typeof parsed.libraryId === "string"
              ? { libraryId: parsed.libraryId }
              : {}),
          });
          const terms =
            query
              .normalize("NFKD")
              .replace(/\p{M}/gu, "")
              .toLowerCase()
              .match(/[\p{L}\p{N}]+/gu) ?? [];
          const results = [];
          let remainingCharacters = 16000;
          for (const match of matches) {
            if (remainingCharacters < 4000) break;
            const passages = libraryTextPassages(
              match.text,
              match.extraction.pageRanges,
            );
            const ranked = passages
              .map((passage) => ({
                passage,
                score: terms.filter((term) =>
                  passage.text
                    .normalize("NFKD")
                    .replace(/\p{M}/gu, "")
                    .toLowerCase()
                    .includes(term),
                ).length,
              }))
              .sort(
                (a, b) =>
                  b.score - a.score || a.passage.number - b.passage.number,
              );
            const selected = ranked
              .slice(0, Math.min(2, Math.floor(remainingCharacters / 4000)))
              .map((item) => item.passage)
              .sort((a, b) => a.number - b.number);
            remainingCharacters -= selected.reduce(
              (sum, passage) => sum + passage.text.length,
              0,
            );
            await options.libraries.recordUse({
              ...scope(),
              reference: match.reference,
              kind: "text_read",
              locations: selected.map(({ text: _text, ...location }) => {
                void _text;
                return location;
              }),
              useKey: `search:${action.id}:${match.reference.entryId}:${match.reference.libraryId}`,
            });
            results.push({
              libraryId: match.reference.libraryId,
              libraryName: match.libraryName,
              revisionId: match.reference.revisionId,
              revisionNumber: match.revisionNumber,
              entryId: match.reference.entryId,
              artifactId: match.reference.artifactId,
              contentDigest: match.reference.contentDigest,
              name: match.reference.name,
              passages: selected,
              totalPassages: passages.length,
              locatorVersion: "text-passages-v1",
              complete: selected.length === passages.length,
            });
          }
          return {
            modelOutput: {
              results,
              resultLimit: 20,
              scope: "accessible-active-or-run-pinned-libraries",
              indexCoverage:
                pending.length > 8 || indexFailures.length
                  ? "partial"
                  : "complete",
              indexingRemaining: pending.length > 8,
              indexFailures,
            },
          };
        },
        () => "agent.library_content_search_failed",
      );
    },
    search(value) {
      const parsed = input(value, ["query"]);
      if (
        parsed.query !== undefined &&
        (typeof parsed.query !== "string" || parsed.query.length > 200)
      )
        throw new TypeError("Invalid library query.");
      return options.executeWithReceipt(
        "library.search",
        value,
        async () => ({
          modelOutput: {
            libraries: await options.libraries.catalog({
              ...scope(),
              ...(typeof parsed.query === "string"
                ? { query: parsed.query }
                : {}),
            }),
          },
        }),
        () => "agent.library_search_failed",
      );
    },
    inspect(value) {
      const parsed = input(value, ["libraryId"]);
      assertLibraryId(parsed.libraryId);
      const libraryId = parsed.libraryId;
      return options.executeWithReceipt(
        "library.inspect",
        value,
        async () => {
          const revision = await options.libraries.pin({
            ...scope(),
            libraryId,
          });
          return {
            modelOutput: {
              libraryId,
              revisionId: revision.id,
              ...revision.document,
              contentLoaded: false,
            },
          };
        },
        () => "agent.library_inspect_failed",
      );
    },
    read(value) {
      const parsed = input(value, [
        "libraryId",
        "entryId",
        "startPassage",
        "passageCount",
      ]);
      assertLibraryId(parsed.libraryId);
      assertLibraryId(parsed.entryId);
      const libraryId = parsed.libraryId,
        entryId = parsed.entryId;
      for (const key of ["startPassage", "passageCount"] as const) {
        if (
          parsed[key] !== undefined &&
          (typeof parsed[key] !== "number" ||
            !Number.isSafeInteger(parsed[key]) ||
            parsed[key] < 1 ||
            (key === "passageCount" && parsed[key] > 12))
        )
          throw new TypeError("Invalid passage range.");
      }
      return options.executeWithReceipt(
        "library.read",
        value,
        async (action): Promise<LibraryToolExecution> => {
          const reference = await options.libraries.reference({
            ...scope(),
            libraryId,
            entryId,
          });
          if (
            reference.mediaType.startsWith("image/") &&
            !(await options.canReadImages())
          ) {
            throw new DomainError(
              "resource_library.vision_unavailable",
              "The selected model cannot view images. Select a vision-capable model or use an authorized image tool.",
            );
          }
          const isImage = reference.mediaType.startsWith("image/");
          const bytes = isImage
            ? await readAgentLibraryBytes(
                options.profiles,
                reference,
                options.signal,
              )
            : undefined;
          let extraction = isImage
            ? undefined
            : await options.libraries.text({ ...scope(), libraryId, entryId });
          if (!isImage && !extraction) {
            const loaded = await loadLibraryDocumentText(
              reference,
              options.profiles,
            );
            await options.libraries.cacheText({
              ...scope(),
              libraryId,
              artifactId: reference.artifactId,
              contentDigest: reference.contentDigest,
              ...loaded,
            });
            extraction = await options.libraries.text({
              ...scope(),
              libraryId,
              entryId,
            });
            if (!extraction)
              throw new DomainError(
                "resource_library.extraction_unavailable",
                "Document extraction is unavailable.",
              );
          }
          const text = extraction?.text;
          if (
            text === undefined &&
            (parsed.startPassage !== undefined ||
              parsed.passageCount !== undefined)
          )
            throw new DomainError(
              "resource_library.invalid_argument",
              "Passage ranges apply only to text.",
            );
          const textView =
            text === undefined
              ? undefined
              : readLibraryTextPassages(
                  text,
                  parsed.startPassage as number | undefined,
                  parsed.passageCount as number | undefined,
                  extraction?.pageRanges,
                );
          // The second lookup inside recordUse catches revoked authority/content after storage I/O.
          await options.libraries.recordUse({
            ...scope(),
            reference,
            kind: text === undefined ? "image_view" : "text_read",
            ...(textView
              ? {
                  locations: textView.passages.map(
                    ({ text: _text, ...location }) => {
                      void _text;
                      return location;
                    },
                  ),
                }
              : {}),
            useKey: `read:${action.id}`,
          });
          return {
            modelOutput: {
              libraryId,
              revisionId: reference.revisionId,
              revisionNumber: reference.revisionNumber,
              entryId,
              artifactId: reference.artifactId,
              name: reference.name,
              purpose: reference.purpose,
              mediaType: reference.mediaType,
              ...(text !== undefined
                ? {
                    ...textView,
                    extractorVersion: extraction?.extractorVersion,
                    offsetSpace: reference.mediaType.startsWith("text/")
                      ? "original-text"
                      : "extracted-text",
                    source: {
                      libraryId,
                      revisionId: reference.revisionId,
                      entryId,
                      artifactId: reference.artifactId,
                      contentDigest: reference.contentDigest,
                    },
                  }
                : { imageAttached: true }),
            },
            ...(text === undefined
              ? {
                  image: {
                    data: bytes!.toString("base64"),
                    mediaType: reference.mediaType,
                  },
                }
              : {}),
          };
        },
        () => "agent.library_read_failed",
      );
    },
  };
}
