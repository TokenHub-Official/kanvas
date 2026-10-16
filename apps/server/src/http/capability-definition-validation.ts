import type {
  CapabilityInvoker,
  CapabilityDefinitionSummary,
  CreateCapabilityDefinitionBody,
  WorkflowCapabilityAuthoringDeclaration,
} from "@kanvas/contracts/api";
import { digestProviderValue } from "@kanvas/database/runtime";
import { Ajv2020 } from "ajv/dist/2020.js";

const maximumSchemaBytes = 131_072;
const maximumSchemaDepth = 32;
const maximumSchemaNodes = 5_000;
const invokerOrder = ["user", "workflow", "agent", "canvas"] as const;
type CapabilityDefinitionPublicationBody = Omit<
  CreateCapabilityDefinitionBody,
  "runMethod"
>;

export class CapabilityDefinitionValidationError extends TypeError {
  public constructor(message: string) {
    super(message);
    this.name = "CapabilityDefinitionValidationError";
  }
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function assertBoundedSchema(
  label: string,
  schema: Readonly<Record<string, unknown>>,
): void {
  const encoded = JSON.stringify(schema);
  if (Buffer.byteLength(encoded, "utf8") > maximumSchemaBytes) {
    throw new CapabilityDefinitionValidationError(
      `${label} Schema is too large.`,
    );
  }
  let nodes = 0;
  const visit = (value: unknown, depth: number): void => {
    nodes += 1;
    if (nodes > maximumSchemaNodes || depth > maximumSchemaDepth) {
      throw new CapabilityDefinitionValidationError(
        `${label} Schema exceeds the supported complexity.`,
      );
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    const object = record(value);
    if (!object) return;
    if (
      "$ref" in object ||
      "$dynamicRef" in object ||
      "$recursiveRef" in object
    ) {
      throw new CapabilityDefinitionValidationError(
        `${label} Schema cannot use external or dynamic references.`,
      );
    }
    for (const item of Object.values(object)) visit(item, depth + 1);
  };
  visit(schema, 0);
  if (
    schema.type !== "object" ||
    !record(schema.properties) ||
    schema.additionalProperties !== false
  ) {
    throw new CapabilityDefinitionValidationError(
      `${label} Schema must be a closed object with explicit properties.`,
    );
  }
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    validateFormats: false,
  });
  if (!ajv.validateSchema(schema)) {
    throw new CapabilityDefinitionValidationError(
      `${label} Schema is not valid JSON Schema 2020-12.`,
    );
  }
  try {
    ajv.compile(schema);
  } catch {
    throw new CapabilityDefinitionValidationError(
      `${label} Schema cannot be compiled.`,
    );
  }
}

function requiredKeys(
  schema: Readonly<Record<string, unknown>>,
): ReadonlySet<string> {
  return new Set(
    Array.isArray(schema.required)
      ? schema.required.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
  );
}

function assertSemanticType(
  key: string,
  semanticType: string,
  schema: Readonly<Record<string, unknown>>,
): void {
  const type = schema.type;
  let valid = true;
  if (semanticType === "artifact.image_list") {
    valid = type === "array";
  } else if (semanticType.startsWith("artifact.")) {
    valid = type === "string";
  } else if (semanticType === "text.plain" || semanticType === "prompt.rich") {
    valid = type === "string";
  } else if (semanticType === "number.scalar") {
    valid = type === "number" || type === "integer";
  } else if (semanticType === "boolean.flag") {
    valid = type === "boolean";
  }
  if (!valid) {
    throw new CapabilityDefinitionValidationError(
      `${key} business semantic does not match its Schema type.`,
    );
  }
}

function assertDeclarationMatchesSchemas(
  body: CapabilityDefinitionPublicationBody,
): void {
  const inputProperties = record(body.inputSchema.properties) ?? {};
  const outputProperties = record(body.outputSchema.properties) ?? {};
  const inputKeys = Object.keys(inputProperties);
  const outputKeys = Object.keys(outputProperties);
  const parameterKeys = body.parameters.map((parameter) => parameter.key);
  const declaredOutputKeys = body.outputs.map((output) => output.key);
  if (
    new Set(parameterKeys).size !== parameterKeys.length ||
    parameterKeys.length !== inputKeys.length ||
    parameterKeys.some((key) => !(key in inputProperties))
  ) {
    throw new CapabilityDefinitionValidationError(
      "Input declarations must cover every input Schema property exactly once.",
    );
  }
  if (
    new Set(declaredOutputKeys).size !== declaredOutputKeys.length ||
    declaredOutputKeys.length !== outputKeys.length ||
    declaredOutputKeys.some((key) => !(key in outputProperties))
  ) {
    throw new CapabilityDefinitionValidationError(
      "Output declarations must cover every output Schema property exactly once.",
    );
  }
  const required = requiredKeys(body.inputSchema);
  if ([...required].some((key) => !(key in inputProperties))) {
    throw new CapabilityDefinitionValidationError(
      "Input Schema required fields must exist in properties.",
    );
  }
  for (const parameter of body.parameters) {
    if (parameter.required !== required.has(parameter.key)) {
      throw new CapabilityDefinitionValidationError(
        `Input ${parameter.key} required state does not match its Schema.`,
      );
    }
    const parameterSchema = record(inputProperties[parameter.key]) ?? {};
    assertSemanticType(
      `Input ${parameter.key}`,
      parameter.semanticType,
      parameterSchema,
    );
    if (
      !parameter.exposurePolicy.allowed.includes(
        parameter.exposurePolicy.default,
      ) ||
      !parameter.sourcePolicy.allowed.includes(parameter.sourcePolicy.default)
    ) {
      throw new CapabilityDefinitionValidationError(
        `Input ${parameter.key} default policy must be allowed.`,
      );
    }
    if (parameter.sourcePolicy.default === "derived" && !parameter.derivation) {
      throw new CapabilityDefinitionValidationError(
        `Input ${parameter.key} derived source needs a derivation rule.`,
      );
    }
    if (parameter.defaultValue !== undefined) {
      const validator = new Ajv2020({ strict: false, validateFormats: false });
      if (!validator.compile(parameterSchema)(parameter.defaultValue)) {
        throw new CapabilityDefinitionValidationError(
          `Input ${parameter.key} default value does not match its Schema.`,
        );
      }
    }
  }
  const requiredOutputs = requiredKeys(body.outputSchema);
  if ([...requiredOutputs].some((key) => !(key in outputProperties))) {
    throw new CapabilityDefinitionValidationError(
      "Output Schema required fields must exist in properties.",
    );
  }
  for (const output of body.outputs) {
    assertSemanticType(
      `Output ${output.key}`,
      output.semanticType,
      record(outputProperties[output.key]) ?? {},
    );
  }
  if (body.outputs.filter((output) => output.primary).length > 1) {
    throw new CapabilityDefinitionValidationError(
      "Capability can declare at most one primary output.",
    );
  }
}

export interface ValidatedCapabilityDefinitionPublication {
  readonly key: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema: Readonly<Record<string, unknown>>;
  readonly idempotencyMode: CapabilityDefinitionSummary["idempotencyMode"];
  readonly supportedInvokers: readonly CapabilityInvoker[];
  readonly declaration: WorkflowCapabilityAuthoringDeclaration;
  readonly contractDigest: string;
  readonly declarationDigest: string;
  readonly publicationDigest: string;
}

export function validateCapabilityDefinitionPublication(
  body: CapabilityDefinitionPublicationBody,
): ValidatedCapabilityDefinitionPublication {
  assertBoundedSchema("Input", body.inputSchema);
  assertBoundedSchema("Output", body.outputSchema);
  assertDeclarationMatchesSchemas(body);
  const supportedInvokers = invokerOrder.filter((invoker) =>
    body.supportedInvokers.includes(invoker),
  );
  const declaration = Object.freeze({
    schemaVersion: "kanvas.capability-declaration/v1" as const,
    origin: "declared" as const,
    catalog: Object.freeze({
      title: body.title,
      ...(body.description ? { description: body.description } : {}),
      category: body.category,
      sourceKind: body.sourceKind,
      tags: [...body.tags],
      surfaces: [...body.surfaces],
    }),
    parameters: body.parameters.map((item) => ({ ...item })),
    outputs: body.outputs.map((item) => ({ ...item })),
    ...(body.canvas ? { canvas: body.canvas } : {}),
  }) satisfies WorkflowCapabilityAuthoringDeclaration;
  const contractMaterial = Object.freeze({
    schemaVersion: 1,
    key: body.key,
    inputSchema: body.inputSchema,
    outputSchema: body.outputSchema,
    idempotencyMode: body.idempotencyMode,
    supportedInvokers,
  });
  const contractDigest = digestProviderValue(contractMaterial);
  const declarationDigest = digestProviderValue(
    Object.freeze({ contractDigest, declaration }),
  );
  return Object.freeze({
    key: body.key,
    inputSchema: body.inputSchema,
    outputSchema: body.outputSchema,
    idempotencyMode: body.idempotencyMode,
    supportedInvokers,
    declaration,
    contractDigest,
    declarationDigest,
    publicationDigest: digestProviderValue(
      Object.freeze({ contractMaterial, declaration }),
    ),
  });
}
