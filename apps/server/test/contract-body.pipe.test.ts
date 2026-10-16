import { CompleteBrowserAttemptBodySchema } from "@kanvas/contracts/api";
import { describe, expect, it } from "vitest";

import { ContractBodyPipe } from "../src/http/contract-body.pipe.js";

const body = {
  controlPlaneVersion: 1,
  attemptId: "01K00000000000000000000001",
  capabilityRunId: "01K00000000000000000000002",
  leaseGeneration: 1,
  executionGeneration: 1,
  implementationRevisionId: "01K00000000000000000000003",
  implementationDigest:
    "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  adapterKey: "browser.remove-background",
  capabilityOutput: {},
  outputs: [],
  initialUsage: [
    {
      entryKey: "browser.duration",
      metricKey: "duration",
      valueDimension: "quantity",
      unitCode: "millisecond",
      entryKind: "observation",
      numericValue: "1250",
      evidenceDigest:
        "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      observedAt: "2026-07-28T11:00:00.000Z",
    },
  ],
};

describe("ContractBodyPipe", () => {
  it("registers date-time validation for request contracts", () => {
    const pipe = new ContractBodyPipe(CompleteBrowserAttemptBodySchema);
    expect(pipe.transform(body)).toBe(body);
    expect(() =>
      pipe.transform({
        ...body,
        initialUsage: [
          {
            ...body.initialUsage[0],
            observedAt: "not-a-date",
          },
        ],
      }),
    ).toThrow("Bad Request Exception");
  });
});
