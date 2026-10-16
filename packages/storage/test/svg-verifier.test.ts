import { describe, expect, it } from "vitest";

import { verifyTrustedSvg } from "../src/svg-verifier.js";

async function* body(value: string): AsyncIterable<Uint8Array> {
  await Promise.resolve();
  yield Buffer.from(value);
}

describe("trusted SVG verifier", () => {
  it("accepts a bounded presentation-only vector", async () => {
    await expect(
      verifyTrustedSvg({
        body: body(
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="M0 0h24v24H0z"/></svg>',
        ),
        declaredMediaType: "image/svg+xml",
        maximumInputBytes: 10_000,
        verificationProfileVersion: "trusted-svg-v1",
      }),
    ).resolves.toMatchObject({
      detectedMediaType: "image/svg+xml",
      verificationResultHash: expect.stringMatching(
        /^sha256:[0-9a-f]{64}$/u,
      ) as unknown,
    });
  });

  it.each([
    "<svg><script>alert(1)</script></svg>",
    '<svg><image href="https://example.com/a.png"/></svg>',
    '<svg><path onload="alert(1)" d="M0 0"/></svg>',
    "<svg><foreignObject><p>unsafe</p></foreignObject></svg>",
    '<svg xmlns="https://example.com/svg"><path d="M0 0"/></svg>',
  ])("rejects active or externally linked content", async (value) => {
    await expect(
      verifyTrustedSvg({
        body: body(value),
        declaredMediaType: "image/svg+xml",
        maximumInputBytes: 10_000,
        verificationProfileVersion: "trusted-svg-v1",
      }),
    ).rejects.toMatchObject({ code: "media_verification.malformed" });
  });
});
