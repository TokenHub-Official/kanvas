import {
  isAttemptOutputArtifactReferenceV1,
  resolveAttemptOutputArtifactReferences,
} from "../src/capability/index.js";
import { describe, expect, it } from "vitest";

describe("Attempt output artifact references", () => {
  it("resolves a declared output coordinate without exposing storage identity", () => {
    const reference = {
      $kanvas: "attempt-output-artifact/v1",
      outputRole: "primary",
      outputIndex: 0,
    } as const;

    expect(isAttemptOutputArtifactReferenceV1(reference)).toBe(true);
    expect(
      resolveAttemptOutputArtifactReferences(
        {
          image: reference,
        },
        [
          {
            outputRole: "primary",
            outputIndex: 0,
            artifactId: "01K00000000000000000000001",
          },
        ],
      ),
    ).toEqual({
      image: "01K00000000000000000000001",
    });
  });

  it("fails closed for missing or malformed reserved references", () => {
    expect(() =>
      resolveAttemptOutputArtifactReferences(
        {
          $kanvas: "attempt-output-artifact/v1",
          outputRole: "mask",
          outputIndex: 0,
        },
        [],
      ),
    ).toThrow(/missing Attempt output/u);
    expect(() =>
      resolveAttemptOutputArtifactReferences(
        {
          $kanvas: "unknown",
          outputRole: "primary",
          outputIndex: 0,
        },
        [],
      ),
    ).toThrow(/invalid reserved/u);
  });
});
