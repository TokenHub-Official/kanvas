import type { ModelResourceNativeInterface } from "@kanvas/contracts/api";
import { InferenceSession } from "onnxruntime-node";

type ValueMetadata =
  | Readonly<{ name: string; isTensor: false }>
  | Readonly<{
      name: string;
      isTensor: true;
      type: string;
      shape: ReadonlyArray<number | string>;
    }>;

function itemType(type: string): "boolean" | "integer" | "number" | "string" {
  if (type === "bool") return "boolean";
  if (type === "string") return "string";
  if (type.startsWith("int") || type.startsWith("uint")) return "integer";
  return "number";
}

function tensorSchema(
  metadata: ValueMetadata,
): Readonly<Record<string, unknown>> {
  if (!metadata.isTensor) {
    return Object.freeze({ "x-kanvas-value-kind": "non_tensor" });
  }
  const shape = [...metadata.shape];
  const elementCount = shape.every(
    (dimension): dimension is number =>
      typeof dimension === "number" &&
      Number.isSafeInteger(dimension) &&
      dimension > 0,
  )
    ? shape.reduce((total, dimension) => total * dimension, 1)
    : undefined;
  return Object.freeze({
    type: "array",
    items: Object.freeze({ type: itemType(metadata.type) }),
    ...(elementCount !== undefined && Number.isSafeInteger(elementCount)
      ? { minItems: elementCount, maxItems: elementCount }
      : {}),
    "x-kanvas-tensor": Object.freeze({
      dataType: metadata.type,
      shape,
    }),
  });
}

function objectSchema(
  metadata: readonly ValueMetadata[],
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    required: metadata.map((value) => value.name),
    properties: Object.fromEntries(
      metadata.map((value) => [value.name, tensorSchema(value)]),
    ),
  });
}

export async function inspectOnnxNativeInterface(
  bytes: Uint8Array,
): Promise<ModelResourceNativeInterface> {
  const session = await InferenceSession.create(bytes, {
    executionProviders: ["cpu"],
    graphOptimizationLevel: "disabled",
    interOpNumThreads: 1,
    intraOpNumThreads: 1,
  });
  try {
    return Object.freeze({
      protocol: "tensor",
      inputSchema: objectSchema(session.inputMetadata),
      outputSchema: objectSchema(session.outputMetadata),
    });
  } finally {
    await session.release();
  }
}
