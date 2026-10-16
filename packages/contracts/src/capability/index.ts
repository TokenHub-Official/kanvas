import { Type, type Static } from "@sinclair/typebox";

export * from "./mapping.js";
export * from "./localized-text.js";
export * from "./runtime-adapter.js";
export * from "./catalog-package.js";

export const CapabilityContractRevisionRefSchema = Type.Object(
  {
    contractId: Type.String({ minLength: 1, maxLength: 160 }),
    revision: Type.Integer({ minimum: 1 }),
    canonicalDigest: Type.String({ pattern: "^sha256:[0-9a-f]{64}$" }),
  },
  {
    additionalProperties: false,
  },
);

export type CapabilityContractRevisionRef = Static<
  typeof CapabilityContractRevisionRefSchema
>;

export const AttemptOutputArtifactReferenceV1Schema = Type.Object(
  {
    $kanvas: Type.Literal("attempt-output-artifact/v1"),
    outputRole: Type.String({
      minLength: 1,
      maxLength: 80,
      pattern: "^[\\x21-\\x7e]+$",
    }),
    outputIndex: Type.Integer({
      minimum: 0,
      maximum: 4_294_967_295,
    }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.attempt-output-artifact-reference.v1",
  },
);

export type AttemptOutputArtifactReferenceV1 = Static<
  typeof AttemptOutputArtifactReferenceV1Schema
>;

export interface AttemptOutputArtifactIdentity {
  readonly outputRole: string;
  readonly outputIndex: number;
  readonly artifactId: string;
}

const artifactReferenceKeys = new Set(["$kanvas", "outputRole", "outputIndex"]);
const visibleAsciiPattern = /^[\x21-\x7e]{1,80}$/u;
const ulidPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isAttemptOutputArtifactReferenceV1(
  value: unknown,
): value is AttemptOutputArtifactReferenceV1 {
  if (!isRecord(value)) {
    return false;
  }
  const keys = Object.keys(value);
  return (
    keys.length === artifactReferenceKeys.size &&
    keys.every((key) => artifactReferenceKeys.has(key)) &&
    value.$kanvas === "attempt-output-artifact/v1" &&
    typeof value.outputRole === "string" &&
    visibleAsciiPattern.test(value.outputRole) &&
    Number.isSafeInteger(value.outputIndex) &&
    Number(value.outputIndex) >= 0 &&
    Number(value.outputIndex) <= 4_294_967_295
  );
}

export function resolveAttemptOutputArtifactReferences(
  value: unknown,
  outputs: readonly AttemptOutputArtifactIdentity[],
): unknown {
  const byCoordinate = new Map<string, string>();
  for (const output of outputs) {
    if (
      !visibleAsciiPattern.test(output.outputRole) ||
      !Number.isSafeInteger(output.outputIndex) ||
      output.outputIndex < 0 ||
      output.outputIndex > 4_294_967_295 ||
      !ulidPattern.test(output.artifactId)
    ) {
      throw new TypeError("Attempt output artifact identity is invalid.");
    }
    const coordinate = `${output.outputRole}\0${String(output.outputIndex)}`;
    if (byCoordinate.has(coordinate)) {
      throw new TypeError(
        `Attempt output artifact identity ${output.outputRole}:${String(output.outputIndex)} is duplicated.`,
      );
    }
    byCoordinate.set(coordinate, output.artifactId);
  }

  const active = new WeakSet<object>();
  let nodes = 0;
  const visit = (candidate: unknown, depth: number): unknown => {
    nodes += 1;
    if (nodes > 10_000 || depth > 64) {
      throw new RangeError(
        "Capability output exceeds the bounded artifact-reference projection limits.",
      );
    }
    if (
      candidate === null ||
      typeof candidate === "string" ||
      typeof candidate === "boolean"
    ) {
      return candidate;
    }
    if (typeof candidate === "number") {
      if (!Number.isFinite(candidate)) {
        throw new TypeError(
          "Capability output numbers must be finite JSON values.",
        );
      }
      return candidate;
    }
    if (isAttemptOutputArtifactReferenceV1(candidate)) {
      const artifactId = byCoordinate.get(
        `${candidate.outputRole}\0${String(candidate.outputIndex)}`,
      );
      if (!artifactId) {
        throw new TypeError(
          `Capability output references missing Attempt output ${candidate.outputRole}:${String(candidate.outputIndex)}.`,
        );
      }
      return artifactId;
    }
    if (!candidate || typeof candidate !== "object") {
      throw new TypeError(
        "Capability output must contain only JSON values and declared Attempt output references.",
      );
    }
    if (active.has(candidate)) {
      throw new TypeError("Capability output must not contain cycles.");
    }
    active.add(candidate);
    try {
      if (Array.isArray(candidate)) {
        return candidate.map((entry) => visit(entry, depth + 1));
      }
      const record = candidate as Readonly<Record<string, unknown>>;
      if ("$kanvas" in record) {
        throw new TypeError(
          "Capability output contains an invalid reserved $kanvas reference.",
        );
      }
      return Object.fromEntries(
        Object.entries(record).map(([key, entry]) => [
          key,
          visit(entry, depth + 1),
        ]),
      );
    } finally {
      active.delete(candidate);
    }
  };

  return visit(value, 0);
}
