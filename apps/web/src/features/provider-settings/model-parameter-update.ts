import type { CanonicalModelSummary } from "@kanvas/contracts/api";

type Operations = NonNullable<CanonicalModelSummary["profile"]>["operations"];
export type ImageModelOperations = Pick<
  Operations,
  "image.generate" | "image.edit"
>;
const operationKeys = ["image.generate", "image.edit"] as const;

function same(left: unknown, right: unknown): boolean {
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, normalize(item)]),
      );
    }
    return value;
  };
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

export function imageModelOperations(
  operations: Operations,
): ImageModelOperations {
  return Object.fromEntries(
    operationKeys.flatMap((key) =>
      operations[key] ? [[key, operations[key]]] : [],
    ),
  );
}

/** Preserve local parameter edits while applying changes to untouched fields. */
export function mergeImageModelParameters(
  base: ImageModelOperations,
  current: ImageModelOperations,
  incoming: ImageModelOperations,
) {
  const merged: ImageModelOperations = {};
  const preserved: string[] = [];
  for (const operation of operationKeys) {
    const old = base[operation];
    const local = current[operation];
    const next = incoming[operation];
    if (same(local, old)) {
      if (next) merged[operation] = next;
      continue;
    }
    if (!local || !next) {
      if (local) merged[operation] = local;
      if (!same(local, next)) preserved.push(operation);
      continue;
    }
    const keys = [
      ...new Set(
        [
          ...next.parameters,
          ...local.parameters,
          ...(old?.parameters ?? []),
        ].map((item) => item.key),
      ),
    ];
    const parameters = keys.flatMap((key) => {
      const previous = old?.parameters.find((item) => item.key === key);
      const edited = local.parameters.find((item) => item.key === key);
      const updated = next.parameters.find((item) => item.key === key);
      if (!same(edited, previous)) {
        if (!same(edited, updated)) preserved.push(`${operation}.${key}`);
        return edited ? [edited] : [];
      }
      return updated ? [updated] : [];
    });
    merged[operation] = { parameters };
  }
  return { merged, preserved, changed: !same(current, merged) };
}
