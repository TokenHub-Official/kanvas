import { describe, expect, it } from "vitest";

import { projectProviderObservationFacts } from "../src/runtime/operational-timeline-store.js";

const digest = "a".repeat(64);

describe("Operational Timeline Provider diagnostic projection", () => {
  it("projects only the bounded response structure from an unqueryable observation", () => {
    const projected = projectProviderObservationFacts({
      source: "consumer",
      adoptionOutcome: "applied",
      observationKey: `submit:error:1:${digest}:d-o.t-u.s-s.r-u.u-u.c-u.e-u.m-u.x-2:unqueryable`,
    });

    expect(projected).toEqual({
      source: "consumer",
      adoptionOutcome: "applied",
      responseStructure: "d-o.t-u.s-s.r-u.u-u.c-u.e-u.m-u.x-2",
    });
    expect(JSON.stringify(projected)).not.toContain("submit:error");
  });

  it.each([
    `submit:error:1:${digest}`,
    `submit:error:1:${digest}:private-field-name`,
    `submit:error:1:${digest}:r-n:unexpected-suffix`,
    `submit:error:1:${digest}:${"a".repeat(65)}`,
  ])("drops an unsafe or unrelated observation key: %s", (key) => {
    expect(
      projectProviderObservationFacts({
        source: "consumer",
        observationKey: key,
      }),
    ).toEqual({
      source: "consumer",
    });
  });
});

it("exposes result origins without signed paths or credentials", () => {
  const projected = projectProviderObservationFacts(
    { source: "adapter" },
    {
      resultUrls: [
        "https://cdn.example.com/private/image.png?token=secret",
        "https://cdn.example.com/other",
        "file:///private/secret",
        "https://user:password@bad.example.com/x",
      ],
      prompt: "private prompt",
    },
  );
  expect(projected).toMatchObject({
    resultOrigins: "https://cdn.example.com",
    resultCount: 4,
  });
  expect(JSON.stringify(projected)).not.toMatch(
    /secret|password|private|bad.example/u,
  );
});

it("projects persisted result facts and tolerates legacy or malformed records", () => {
  const resultFacts = JSON.stringify({
    resultUrls: ["https://cdn.example.com/file?signature=secret"],
  });
  expect(
    projectProviderObservationFacts({ source: "adapter", resultFacts }),
  ).toEqual({
    source: "adapter",
    resultOrigins: "https://cdn.example.com",
    resultCount: 1,
  });
  for (const value of [null, "invalid json", "{}", "[]"]) {
    expect(
      projectProviderObservationFacts({
        source: "adapter",
        resultFacts: value,
      }),
    ).toEqual({ source: "adapter" });
  }
});

it("bounds origin summaries to the timeline fact contract", () => {
  const resultUrls = Array.from(
    { length: 40 },
    (_, index) =>
      `https://${"x".repeat(80)}${index}.example.com/file?secret=value`,
  );
  const projected = projectProviderObservationFacts({}, { resultUrls });
  expect(String(projected.resultOrigins).length).toBeLessThanOrEqual(1024);
  expect(projected.resultOriginsTruncated).toBe(true);
  expect(projected.resultCount).toBe(40);
  expect(JSON.stringify(projected)).not.toContain("secret");
});

it("projects denied result evidence as origins without disclosing bearer URLs", () => {
  expect(
    projectProviderObservationFacts(
      {},
      {
        resultEvidence: {
          urls: ["https://blocked.example/path?signature=secret"],
          totalCount: 2,
          omittedCount: 1,
        },
      },
    ),
  ).toEqual({
    resultOrigins: "https://blocked.example",
    resultCount: 2,
    resultEvidenceOmitted: 1,
    resultOriginsTruncated: true,
  });
});
