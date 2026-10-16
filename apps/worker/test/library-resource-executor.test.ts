import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type {
  AgentActionReceiptRecord,
  StorageProfileRegistry,
  TrustedWorkspaceScope,
} from "@kanvas/application";
import type {
  AgentLibraryReference,
  AgentLibraryStore,
} from "@kanvas/database/runtime";
import { createLibraryResourceToolProjection } from "@kanvas/agent-runtime";
import { createAgentLibraryResourceExecutor } from "../src/agent/library-resource-executor.js";
const id = (value: number) => `01K${String(value).padStart(23, "0")}`;
function harness(
  mediaType = "text/plain",
  bytes = Buffer.from("Product KA-100\n"),
  corrupt = false,
) {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const reference: AgentLibraryReference = {
    libraryId: id(1),
    revisionId: id(2),
    revisionNumber: 1,
    entryId: id(3),
    artifactId: id(4),
    name: "Product",
    purpose: "Facts",
    contentDigest: `sha256:${sha256}`,
    mediaType,
    byteSize: String(bytes.length),
    storedObjectId: id(5),
    storageProfileId: id(6),
    container: "test",
    objectKey: "fixture",
    sha256,
    immutableIdentityHash: `sha256:${"a".repeat(64)}`,
    dataClassification: "internal",
  };
  const recordUse = vi
    .fn<AgentLibraryStore["recordUse"]>()
    .mockResolvedValue(undefined);
  const openRead = vi.fn().mockResolvedValue({
    totalByteSize: reference.byteSize,
    contentByteSize: reference.byteSize,
    body: (async function* () {
      yield await Promise.resolve(corrupt ? Buffer.alloc(bytes.length) : bytes);
    })(),
  });
  const extraction = {
    text: bytes.toString("utf8"),
    extractorVersion: "utf8-v1",
    pageRanges: [],
  };
  let cached: typeof extraction | undefined;
  const libraries = {
    pendingText: vi.fn().mockResolvedValue([]),
    text: vi.fn().mockImplementation(() => Promise.resolve(cached)),
    cacheText: vi
      .fn()
      .mockImplementation((input: { extraction: typeof extraction }) => {
        cached = input.extraction;
        return Promise.resolve();
      }),
    searchText: vi.fn().mockResolvedValue([
      {
        reference,
        text: bytes.toString("utf8"),
        extraction,
        libraryName: "Product",
        revisionNumber: 1,
      },
    ]),
    reference: vi.fn().mockResolvedValue(reference),
    recordUse,
  } as unknown as AgentLibraryStore;
  const canReadImages = vi.fn().mockResolvedValue(true);
  const executor = createAgentLibraryResourceExecutor({
    authority: { workspaceId: id(7) } as TrustedWorkspaceScope,
    runId: id(8),
    libraries,
    profiles: {
      resolve: () => ({ adapter: { openRead } }),
    } as unknown as StorageProfileRegistry,
    canReadImages,
    signal: new AbortController().signal,
    now: () => new Date(),
    executeWithReceipt: async (_key, _input, action) =>
      action({ id: id(9) } as AgentActionReceiptRecord),
  });
  return { executor, recordUse, reference, openRead, canReadImages, libraries };
}
describe("Agent library content consumption", () => {
  it("rejects image viewing when the selected model lacks vision before reading bytes", async () => {
    const h = harness("image/png");
    h.canReadImages.mockResolvedValue(false);
    await expect(
      h.executor.read({ libraryId: id(1), entryId: id(3) }),
    ).rejects.toMatchObject({ code: "resource_library.vision_unavailable" });
    expect(h.openRead).not.toHaveBeenCalled();
    expect(h.recordUse).not.toHaveBeenCalled();
  });
  it("returns complete verified text and records the exact source", async () => {
    const h = harness();
    expect(
      await h.executor.read({ libraryId: id(1), entryId: id(3) }),
    ).toMatchObject({
      modelOutput: {
        artifactId: id(4),
        text: "Product KA-100\n",
        complete: true,
      },
    });
    expect(h.recordUse).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "text_read", reference: h.reference }),
    );
  });
  it("backfills old text from verified storage before searching", async () => {
    const h = harness();
    vi.mocked(h.libraries.pendingText).mockResolvedValueOnce([
      { ...h.reference },
    ]);
    await h.executor.searchContent({ query: "KA-100" });
    expect(h.libraries.cacheText).toHaveBeenCalledWith(
      expect.objectContaining({
        artifactId: h.reference.artifactId,
        extraction: {
          text: "Product KA-100\n",
          extractorVersion: "utf8-v1",
          pageRanges: [],
        },
      }),
    );
  });
  it("reports incomplete coverage when an old source cannot be verified", async () => {
    const h = harness("text/plain", Buffer.from("text"), true);
    vi.mocked(h.libraries.pendingText).mockResolvedValueOnce([
      { ...h.reference },
    ]);
    vi.mocked(h.libraries.searchText).mockResolvedValueOnce([]);
    expect(await h.executor.searchContent({ query: "text" })).toMatchObject({
      modelOutput: {
        results: [],
        indexCoverage: "partial",
        indexFailures: [{ artifactId: h.reference.artifactId }],
      },
    });
    expect(h.libraries.cacheText).not.toHaveBeenCalled();
  });
  it("reads an imported PDF as bounded text with page and immutable file references", async () => {
    const bytes = await readFile(
      new URL(
        "../../../packages/storage/test/fixtures/library-documents/product.pdf",
        import.meta.url,
      ),
    );
    const h = harness("application/pdf", bytes);
    const result = await h.executor.read({
      libraryId: id(1),
      entryId: id(3),
      startPassage: 2,
      passageCount: 1,
    });
    expect(result).toMatchObject({
      modelOutput: {
        offsetSpace: "extracted-text",
        complete: false,
        passages: [{ number: 2, page: 2 }],
        source: { artifactId: id(4), contentDigest: h.reference.contentDigest },
      },
    });
    expect(h.recordUse.mock.calls[0]?.[0].locations).toMatchObject([
      { number: 2, page: 2 },
    ]);
  });
  it("finds a relevant body passage and records its exact immutable source", async () => {
    const h = harness(
      "text/plain",
      Buffer.from(
        "Unrelated intro\n\nDurable aluminium product\n\nOther notes",
      ),
    );
    expect(
      await h.executor.searchContent({ query: "aluminium" }),
    ).toMatchObject({
      modelOutput: {
        results: [
          {
            artifactId: id(4),
            revisionId: id(2),
            passages: [
              { number: 1 },
              { number: 2, text: "Durable aluminium product\n\n" },
            ],
          },
        ],
      },
    });
    expect(h.recordUse).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "text_read", reference: h.reference }),
    );
    h.recordUse.mockRejectedValueOnce(new Error("revoked"));
    await expect(
      h.executor.searchContent({ query: "aluminium" }),
    ).rejects.toThrow("revoked");
  });
  it("reads a requested passage and returns immutable citation coordinates", async () => {
    const h = harness(
      "text/markdown",
      Buffer.from("# Product\n\nDurable aluminium.\n\nCare instructions."),
    );
    expect(
      await h.executor.read({
        libraryId: id(1),
        entryId: id(3),
        startPassage: 2,
        passageCount: 1,
      }),
    ).toMatchObject({
      modelOutput: {
        text: "Durable aluminium.\n\n",
        complete: false,
        nextPassage: 3,
        passages: [{ number: 2, startLine: 3, endLine: 4 }],
        source: {
          revisionId: id(2),
          artifactId: id(4),
          contentDigest: h.reference.contentDigest,
        },
      },
    });
  });
  it("does not record invalid range reads as successful use", async () => {
    const h = harness();
    await expect(
      h.executor.read({ libraryId: id(1), entryId: id(3), startPassage: 5 }),
    ).rejects.toMatchObject({ code: "resource_library.invalid_argument" });
    expect(h.recordUse).not.toHaveBeenCalled();
  });
  it("delivers real image bytes to the model projection without storing them in the receipt metadata", async () => {
    const bytes = Buffer.from([1, 2, 3]);
    const h = harness("image/png", bytes);
    const output = await h.executor.read({ libraryId: id(1), entryId: id(3) });
    expect(output.modelOutput).not.toHaveProperty("data");
    const read = createLibraryResourceToolProjection(
      h.executor,
    ).descriptors.find((tool) => tool.key === "library.read");
    expect(read?.toModelOutput?.(output)).toMatchObject({
      type: "content",
      value: [
        { type: "text" },
        {
          type: "image-data",
          data: bytes.toString("base64"),
          mediaType: "image/png",
        },
      ],
    });
    expect(h.recordUse).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "image_view" }),
    );
  });
  it("never records successful use when bytes fail integrity", async () => {
    const h = harness("text/plain", Buffer.from("text"), true);
    await expect(
      h.executor.read({ libraryId: id(1), entryId: id(3) }),
    ).rejects.toMatchObject({ code: "resource_library.integrity" });
    expect(h.recordUse).not.toHaveBeenCalled();
  });
  it("does not deliver content if authority changes after the byte read", async () => {
    const h = harness();
    h.recordUse.mockRejectedValueOnce(new Error("revoked"));
    await expect(
      h.executor.read({ libraryId: id(1), entryId: id(3) }),
    ).rejects.toThrow("revoked");
  });
});
