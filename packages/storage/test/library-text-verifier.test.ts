import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyLibraryText } from "../src/library-text-verifier.js";

function body(...chunks: Uint8Array[]): AsyncIterable<Uint8Array> {
  return (async function* () {
    for (const chunk of chunks) yield await Promise.resolve(chunk);
  })();
}
const options = {
  declaredMediaType: "text/plain",
  maximumInputBytes: 131072,
  verificationProfileVersion: "library-text-v1",
};
describe("Library text upload verification", () => {
  it("validates UTF-8 across transport chunks and hashes original bytes", async () => {
    const bytes = Buffer.from("产品参数\n");
    const result = await verifyLibraryText({
      ...options,
      body: body(bytes.subarray(0, 1), bytes.subarray(1)),
    });
    expect(result.byteSize).toBe(String(bytes.length));
    expect(result.sha256).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    );
    expect(result.detectedMediaType).toBe("text/plain");
  });
  it("rejects binary, empty, over-limit and unsupported declared media", async () => {
    for (const bytes of [
      Buffer.from([0xff]),
      Buffer.alloc(0),
      Buffer.alloc(131073, 65),
    ]) {
      await expect(
        verifyLibraryText({ ...options, body: body(bytes) }),
      ).rejects.toThrow();
    }
    await expect(
      verifyLibraryText({
        ...options,
        declaredMediaType: "text/html",
        body: body(Buffer.from("text")),
      }),
    ).rejects.toThrow();
  });
});
