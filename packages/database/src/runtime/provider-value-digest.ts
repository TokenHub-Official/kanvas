import { createHash } from "node:crypto";

export type ProviderValueCanonicalizationReason =
  | "cycle"
  | "non_finite_number"
  | "non_plain_object"
  | "undefined"
  | "unsupported_type";

export class ProviderValueCanonicalizationError extends TypeError {
  public readonly code = "provider_value.not_canonical_json";

  public constructor(
    public readonly reason: ProviderValueCanonicalizationReason,
    public readonly path: string,
    message: string,
  ) {
    super(message);
    this.name = "ProviderValueCanonicalizationError";
  }
}

function compareCanonicalText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  return left > right ? 1 : 0;
}

function invalidProviderValue(
  reason: ProviderValueCanonicalizationReason,
  path: string,
  detail: string,
): never {
  throw new ProviderValueCanonicalizationError(
    reason,
    path,
    `${path} ${detail}`,
  );
}

function canonicalize(
  value: unknown,
  path: string,
  ancestors: WeakSet<object>,
): string {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return invalidProviderValue(
        "non_finite_number",
        path,
        "contains a non-finite number.",
      );
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) {
      return invalidProviderValue("cycle", path, "contains a cyclic array.");
    }
    ancestors.add(value);
    try {
      const items: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value) || value[index] === undefined) {
          return invalidProviderValue(
            "undefined",
            `${path}[${String(index)}]`,
            "cannot be undefined or sparse.",
          );
        }
        items.push(
          canonicalize(value[index], `${path}[${String(index)}]`, ancestors),
        );
      }
      return `[${items.join(",")}]`;
    } finally {
      ancestors.delete(value);
    }
  }
  if (typeof value === "object" && value !== null) {
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return invalidProviderValue(
        "non_plain_object",
        path,
        "must contain only plain JSON objects.",
      );
    }
    if (ancestors.has(value)) {
      return invalidProviderValue("cycle", path, "contains a cyclic object.");
    }
    ancestors.add(value);
    try {
      const entries = Object.entries(
        value as Readonly<Record<string, unknown>>,
      ).sort(([left], [right]) => compareCanonicalText(left, right));
      const fields: string[] = [];
      for (const [key, item] of entries) {
        const itemPath = `${path}[${JSON.stringify(key)}]`;
        if (item === undefined) {
          return invalidProviderValue(
            "undefined",
            itemPath,
            "cannot be undefined.",
          );
        }
        fields.push(
          `${JSON.stringify(key)}:${canonicalize(item, itemPath, ancestors)}`,
        );
      }
      return `{${fields.join(",")}}`;
    } finally {
      ancestors.delete(value);
    }
  }
  return invalidProviderValue(
    value === undefined ? "undefined" : "unsupported_type",
    path,
    `contains unsupported ${typeof value}.`,
  );
}

/**
 * Canonical JSON authority for Provider request fingerprints and response
 * digests. Object keys use locale-independent JavaScript code-unit ordering;
 * undefined, sparse arrays, non-plain objects, non-finite numbers, and cycles
 * are rejected instead of being silently normalized.
 */
export function canonicalizeProviderValue(value: unknown): string {
  return canonicalize(value, "$", new WeakSet<object>());
}

export function digestProviderValue(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(canonicalizeProviderValue(value), "utf8")
    .digest("hex")}`;
}
