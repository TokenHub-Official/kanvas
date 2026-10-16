import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

export const CapabilityMappingJsonValueSchema = Type.Recursive(
  (Self) =>
    Type.Union([
      Type.Null(),
      Type.Boolean(),
      Type.Number(),
      Type.String(),
      Type.Array(Self, { maxItems: 10_000 }),
      Type.Record(Type.String(), Self, { maxProperties: 1_000 }),
    ]),
  { $id: "kanvas.capability-mapping-json-value.v1" },
);

export type CapabilityMappingJsonValue = Static<
  typeof CapabilityMappingJsonValueSchema
>;

const JsonPointerSchema = Type.String({
  maxLength: 2_048,
  pattern: "^(?:/(?:[^~/]|~[01])*)*$",
});

const SemanticTypeSchema = Type.String({
  minLength: 3,
  maxLength: 160,
  pattern: "^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$",
});

export const CapabilityMappingExpressionV1Schema = Type.Recursive(
  (Self) =>
    Type.Union([
      Type.Object(
        {
          op: Type.Literal("source"),
          root: Type.Union([
            Type.Literal("input"),
            Type.Literal("configuration"),
            Type.Literal("result"),
          ]),
          pointer: JsonPointerSchema,
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          op: Type.Literal("constant"),
          value: Type.Ref(CapabilityMappingJsonValueSchema),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          op: Type.Literal("default"),
          value: Self,
          fallback: Self,
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          op: Type.Literal("coalesce"),
          values: Type.Array(Self, { minItems: 2, maxItems: 16 }),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          op: Type.Literal("enum_map"),
          value: Self,
          cases: Type.Record(
            Type.String({ minLength: 1, maxLength: 160 }),
            Type.Ref(CapabilityMappingJsonValueSchema),
            { minProperties: 1, maxProperties: 256 },
          ),
          fallback: Type.Optional(Type.Ref(CapabilityMappingJsonValueSchema)),
          semanticType: Type.Optional(SemanticTypeSchema),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          op: Type.Literal("object"),
          properties: Type.Record(
            Type.String({ minLength: 1, maxLength: 160 }),
            Self,
            { maxProperties: 200 },
          ),
          semanticType: Type.Optional(SemanticTypeSchema),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          op: Type.Literal("pick"),
          value: Self,
          keys: Type.Array(Type.String({ minLength: 1, maxLength: 160 }), {
            minItems: 1,
            maxItems: 128,
            uniqueItems: true,
          }),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          op: Type.Literal("number"),
          value: Self,
          multiply: Type.Optional(Type.Number()),
          add: Type.Optional(Type.Number()),
          minimum: Type.Optional(Type.Number()),
          maximum: Type.Optional(Type.Number()),
          rounding: Type.Optional(
            Type.Union([
              Type.Literal("floor"),
              Type.Literal("ceil"),
              Type.Literal("round"),
            ]),
          ),
          semanticType: Type.Optional(SemanticTypeSchema),
        },
        { additionalProperties: false },
      ),
    ]),
  { $id: "kanvas.capability-mapping-expression.v1" },
);

export const CapabilityMappingDocumentV1Schema = Type.Object(
  {
    schemaVersion: Type.Literal("kanvas.capability-mapping/v1"),
    direction: Type.Union([Type.Literal("input"), Type.Literal("output")]),
    expression: Type.Ref(CapabilityMappingExpressionV1Schema),
  },
  {
    additionalProperties: false,
    $id: "kanvas.capability-mapping-document.v1",
  },
);

export type CapabilityMappingExpressionV1 = Static<
  typeof CapabilityMappingExpressionV1Schema
>;
export type CapabilityMappingDocumentV1 = Static<
  typeof CapabilityMappingDocumentV1Schema
>;

type MappingRoot = "configuration" | "input" | "result";
type JsonType =
  "array" | "boolean" | "integer" | "null" | "number" | "object" | "string";

interface CompiledSourceExpression {
  readonly op: "source";
  readonly root: MappingRoot;
  readonly path: readonly string[];
}

interface CompiledConstantExpression {
  readonly op: "constant";
  readonly value: CapabilityMappingJsonValue;
}

interface CompiledDefaultExpression {
  readonly op: "default";
  readonly value: CompiledCapabilityMappingExpressionV1;
  readonly fallback: CompiledCapabilityMappingExpressionV1;
}

interface CompiledCoalesceExpression {
  readonly op: "coalesce";
  readonly values: readonly CompiledCapabilityMappingExpressionV1[];
}

interface CompiledEnumMapExpression {
  readonly op: "enum_map";
  readonly value: CompiledCapabilityMappingExpressionV1;
  readonly cases: readonly (readonly [string, CapabilityMappingJsonValue])[];
  readonly fallback?: CapabilityMappingJsonValue;
  readonly semanticType?: string;
}

interface CompiledObjectExpression {
  readonly op: "object";
  readonly properties: readonly (readonly [
    string,
    CompiledCapabilityMappingExpressionV1,
  ])[];
  readonly semanticType?: string;
}

interface CompiledPickExpression {
  readonly op: "pick";
  readonly value: CompiledCapabilityMappingExpressionV1;
  readonly keys: readonly string[];
}

interface CompiledNumberExpression {
  readonly op: "number";
  readonly value: CompiledCapabilityMappingExpressionV1;
  readonly multiply?: number;
  readonly add?: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly rounding?: "ceil" | "floor" | "round";
  readonly semanticType?: string;
}

export type CompiledCapabilityMappingExpressionV1 =
  | CompiledSourceExpression
  | CompiledConstantExpression
  | CompiledDefaultExpression
  | CompiledCoalesceExpression
  | CompiledEnumMapExpression
  | CompiledObjectExpression
  | CompiledPickExpression
  | CompiledNumberExpression;

export interface CompiledCapabilityMappingPlanV1 {
  readonly schemaVersion: "kanvas.compiled-capability-mapping/v1";
  readonly direction: "input" | "output";
  readonly expression: CompiledCapabilityMappingExpressionV1;
}

export const CompiledCapabilityMappingExpressionV1Schema = Type.Recursive(
  (Self) =>
    Type.Union([
      Type.Object(
        {
          op: Type.Literal("source"),
          root: Type.Union([
            Type.Literal("input"),
            Type.Literal("configuration"),
            Type.Literal("result"),
          ]),
          path: Type.Array(
            Type.String({
              minLength: 1,
              maxLength: 160,
              pattern: "^(?!__proto__$|prototype$|constructor$).+$",
            }),
            { maxItems: 32 },
          ),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          op: Type.Literal("constant"),
          value: Type.Ref(CapabilityMappingJsonValueSchema),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          op: Type.Literal("default"),
          value: Self,
          fallback: Self,
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          op: Type.Literal("coalesce"),
          values: Type.Array(Self, { minItems: 2, maxItems: 16 }),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          op: Type.Literal("enum_map"),
          value: Self,
          cases: Type.Array(
            Type.Tuple([
              Type.String({ minLength: 1, maxLength: 160 }),
              Type.Ref(CapabilityMappingJsonValueSchema),
            ]),
            { minItems: 1, maxItems: 256 },
          ),
          fallback: Type.Optional(Type.Ref(CapabilityMappingJsonValueSchema)),
          semanticType: Type.Optional(SemanticTypeSchema),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          op: Type.Literal("object"),
          properties: Type.Array(
            Type.Tuple([
              Type.String({
                minLength: 1,
                maxLength: 160,
                pattern: "^(?!__proto__$|prototype$|constructor$).+$",
              }),
              Self,
            ]),
            { maxItems: 200 },
          ),
          semanticType: Type.Optional(SemanticTypeSchema),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          op: Type.Literal("pick"),
          value: Self,
          keys: Type.Array(
            Type.String({
              minLength: 1,
              maxLength: 160,
              pattern: "^(?!__proto__$|prototype$|constructor$).+$",
            }),
            { minItems: 1, maxItems: 128, uniqueItems: true },
          ),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          op: Type.Literal("number"),
          value: Self,
          multiply: Type.Optional(Type.Number()),
          add: Type.Optional(Type.Number()),
          minimum: Type.Optional(Type.Number()),
          maximum: Type.Optional(Type.Number()),
          rounding: Type.Optional(
            Type.Union([
              Type.Literal("floor"),
              Type.Literal("ceil"),
              Type.Literal("round"),
            ]),
          ),
          semanticType: Type.Optional(SemanticTypeSchema),
        },
        { additionalProperties: false },
      ),
    ]),
  { $id: "kanvas.compiled-capability-mapping-expression.v1" },
);

export const CompiledCapabilityMappingPlanV1Schema = Type.Object(
  {
    schemaVersion: Type.Literal("kanvas.compiled-capability-mapping/v1"),
    direction: Type.Union([Type.Literal("input"), Type.Literal("output")]),
    expression: Type.Ref(CompiledCapabilityMappingExpressionV1Schema),
  },
  {
    additionalProperties: false,
    $id: "kanvas.compiled-capability-mapping-plan.v1",
  },
);

export interface CompileCapabilityMappingOptions {
  readonly document: unknown;
  readonly sourceSchemas: Readonly<
    Partial<Record<MappingRoot, Readonly<Record<string, unknown>>>>
  >;
  readonly targetSchema: Readonly<Record<string, unknown>>;
}

export type CapabilityMappingErrorCode =
  | "bounds_exceeded"
  | "invalid_document"
  | "invalid_expression"
  | "invalid_json"
  | "invalid_pointer"
  | "missing_required_target"
  | "remote_reference_forbidden"
  | "semantic_mismatch"
  | "source_not_found"
  | "source_not_permitted"
  | "type_mismatch"
  | "unsupported_schema";

export class CapabilityMappingError extends Error {
  public constructor(
    readonly code: CapabilityMappingErrorCode,
    readonly path: string,
    message: string,
  ) {
    super(message);
    this.name = "CapabilityMappingError";
  }
}

interface Shape {
  readonly types: ReadonlySet<JsonType>;
  readonly optional: boolean;
  readonly semanticType?: string;
  readonly attemptOutputArtifactReference?: boolean;
  readonly constant?: CapabilityMappingJsonValue;
  readonly enumValues?: readonly CapabilityMappingJsonValue[];
  readonly properties?: ReadonlyMap<string, Shape>;
  readonly required?: ReadonlySet<string>;
}

interface CompileBudget {
  nodes: number;
}

interface CompiledWithShape {
  readonly expression: CompiledCapabilityMappingExpressionV1;
  readonly shape: Shape;
}

const maximumDepth = 32;
const maximumNodes = 2_000;
const semanticTypePattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/u;
const safePropertyPattern = /^(?!__proto__$|prototype$|constructor$).{1,160}$/u;
const canonicalArrayIndex = /^(?:0|[1-9][0-9]*)$/u;
const missing = Symbol("capability-mapping-missing");
type EvaluatedValue = CapabilityMappingJsonValue | typeof missing;

function fail(
  code: CapabilityMappingErrorCode,
  path: string,
  message: string,
): never {
  throw new CapabilityMappingError(code, path, message);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  required: readonly string[],
  optional: readonly string[],
  path: string,
): void {
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => !allowed.has(key))
  ) {
    fail(
      "invalid_expression",
      path,
      "Mapping expression has missing or unsupported fields.",
    );
  }
}

function cloneJson(
  value: unknown,
  path: string,
  depth = 0,
  budget: CompileBudget = { nodes: 0 },
): CapabilityMappingJsonValue {
  budget.nodes += 1;
  if (depth > maximumDepth || budget.nodes > maximumNodes) {
    return fail(
      "bounds_exceeded",
      path,
      "Mapping JSON exceeds the depth or node-count limit.",
    );
  }
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return fail("invalid_json", path, "Mapping numbers must be finite.");
    }
    return value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(
      value.map((entry, index) =>
        cloneJson(entry, `${path}/${String(index)}`, depth + 1, budget),
      ),
    ) as unknown as CapabilityMappingJsonValue;
  }
  if (!isRecord(value)) {
    return fail("invalid_json", path, "Mapping values must be JSON data.");
  }
  const result = Object.create(null) as Record<
    string,
    CapabilityMappingJsonValue
  >;
  for (const key of Object.keys(value).sort()) {
    if (!safePropertyPattern.test(key)) {
      return fail("invalid_json", `${path}/${key}`, "Unsafe JSON property.");
    }
    result[key] = cloneJson(value[key], `${path}/${key}`, depth + 1, budget);
  }
  return Object.freeze(result);
}

function jsonType(value: CapabilityMappingJsonValue): JsonType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") {
    return Number.isInteger(value) ? "integer" : "number";
  }
  return typeof value as "boolean" | "object" | "string";
}

function parsePointer(pointer: unknown, path: string): readonly string[] {
  if (typeof pointer !== "string" || pointer.length > 2_048) {
    return fail("invalid_pointer", path, "Mapping pointer is invalid.");
  }
  if (pointer === "") return Object.freeze([]);
  if (!pointer.startsWith("/")) {
    return fail(
      "invalid_pointer",
      path,
      "Mapping pointer must be a JSON Pointer.",
    );
  }
  const result: string[] = [];
  for (const encoded of pointer.slice(1).split("/")) {
    if (/~(?:[^01]|$)/u.test(encoded)) {
      return fail(
        "invalid_pointer",
        path,
        "Mapping pointer escape is invalid.",
      );
    }
    const segment = encoded.replaceAll("~1", "/").replaceAll("~0", "~");
    if (!safePropertyPattern.test(segment)) {
      return fail(
        "invalid_pointer",
        path,
        "Mapping pointer contains an unsafe segment.",
      );
    }
    result.push(segment);
  }
  return Object.freeze(result);
}

function schemaTypes(schema: Readonly<Record<string, unknown>>): Set<JsonType> {
  const declared = schema.type;
  const types = new Set<JsonType>();
  const add = (value: unknown) => {
    if (
      value === "array" ||
      value === "boolean" ||
      value === "integer" ||
      value === "null" ||
      value === "number" ||
      value === "object" ||
      value === "string"
    ) {
      types.add(value);
    }
  };
  if (Array.isArray(declared)) declared.forEach(add);
  else add(declared);
  if (types.size === 0 && Object.hasOwn(schema, "const")) {
    types.add(jsonType(cloneJson(schema.const, "/schema/const")));
  }
  if (types.size === 0 && Array.isArray(schema.enum)) {
    for (const value of schema.enum) {
      types.add(jsonType(cloneJson(value, "/schema/enum")));
    }
  }
  if (types.size === 0 && isRecord(schema.properties)) types.add("object");
  return types;
}

function localReference(
  root: Readonly<Record<string, unknown>>,
  reference: string,
  path: string,
): Readonly<Record<string, unknown>> {
  if (!reference.startsWith("#")) {
    return fail(
      "remote_reference_forbidden",
      path,
      "Capability mappings do not permit remote schema references.",
    );
  }
  const tokens = parsePointer(reference.slice(1), path);
  let value: unknown = root;
  for (const token of tokens) {
    if (!isRecord(value) || !Object.hasOwn(value, token)) {
      return fail(
        "unsupported_schema",
        path,
        "Local schema reference was not found.",
      );
    }
    value = value[token];
  }
  if (!isRecord(value)) {
    return fail(
      "unsupported_schema",
      path,
      "Schema reference must resolve to an object.",
    );
  }
  return value;
}

function resolvedSchema(
  value: Readonly<Record<string, unknown>>,
  root: Readonly<Record<string, unknown>>,
  path: string,
): Readonly<Record<string, unknown>> {
  let schema = value;
  const seen = new Set<Readonly<Record<string, unknown>>>();
  for (let index = 0; index < 16; index += 1) {
    if (seen.has(schema)) {
      return fail(
        "unsupported_schema",
        path,
        "Schema references contain a cycle.",
      );
    }
    seen.add(schema);
    if (typeof schema.$ref !== "string") return schema;
    if (Object.keys(schema).some((key) => key !== "$ref")) {
      return fail(
        "unsupported_schema",
        path,
        "Mapping V1 requires referenced schemas to contain only $ref.",
      );
    }
    schema = localReference(root, schema.$ref, path);
  }
  return fail(
    "unsupported_schema",
    path,
    "Schema reference depth is too large.",
  );
}

function shapeFromSchema(
  value: Readonly<Record<string, unknown>>,
  root: Readonly<Record<string, unknown>>,
  optional: boolean,
  path: string,
): Shape {
  const schema = resolvedSchema(value, root, path);
  const types = schemaTypes(schema);
  let alternatives: readonly unknown[] | undefined;
  if (Array.isArray(schema.oneOf)) {
    alternatives = schema.oneOf;
  } else if (Array.isArray(schema.anyOf)) {
    alternatives = schema.anyOf;
  }
  if (types.size === 0 && alternatives) {
    if (
      alternatives.length < 1 ||
      alternatives.length > 32 ||
      alternatives.some((entry) => !isRecord(entry))
    ) {
      return fail(
        "unsupported_schema",
        path,
        "Schema alternatives must contain between 1 and 32 object schemas.",
      );
    }
    return unionShapes(
      alternatives.map((entry, index) =>
        shapeFromSchema(
          entry as Readonly<Record<string, unknown>>,
          root,
          optional,
          `${path}/alternatives/${String(index)}`,
        ),
      ),
      optional,
    );
  }
  if (types.size === 0) {
    return fail(
      "unsupported_schema",
      path,
      "Mapping V1 requires an explicit, const, enum or object JSON type.",
    );
  }
  const semantic = schema["x-kanvas-semantic-type"];
  if (
    semantic !== undefined &&
    (typeof semantic !== "string" || !semanticTypePattern.test(semantic))
  ) {
    return fail("unsupported_schema", path, "Schema semantic type is invalid.");
  }
  const properties = new Map<string, Shape>();
  const requiredValues = Array.isArray(schema.required) ? schema.required : [];
  const required = new Set(
    requiredValues.filter(
      (entry): entry is string => typeof entry === "string",
    ),
  );
  if (isRecord(schema.properties)) {
    for (const [key, property] of Object.entries(schema.properties)) {
      if (!safePropertyPattern.test(key) || !isRecord(property)) {
        return fail(
          "unsupported_schema",
          `${path}/properties/${key}`,
          "Schema property is invalid.",
        );
      }
      properties.set(
        key,
        shapeFromSchema(
          property,
          root,
          !required.has(key),
          `${path}/properties/${key}`,
        ),
      );
    }
  }
  const constant = Object.hasOwn(schema, "const")
    ? cloneJson(schema.const, `${path}/const`)
    : undefined;
  const enumValues = Array.isArray(schema.enum)
    ? Object.freeze(
        schema.enum.map((entry, index) =>
          cloneJson(entry, `${path}/enum/${String(index)}`),
        ),
      )
    : undefined;
  return {
    types,
    optional,
    ...(typeof semantic === "string" ? { semanticType: semantic } : {}),
    ...(schema["x-kanvas-attempt-output-artifact"] === true
      ? { attemptOutputArtifactReference: true }
      : {}),
    ...(constant !== undefined ? { constant } : {}),
    ...(enumValues ? { enumValues } : {}),
    ...(properties.size > 0 ? { properties, required } : {}),
  };
}

function sourceShape(
  rootName: MappingRoot,
  path: readonly string[],
  schemas: CompileCapabilityMappingOptions["sourceSchemas"],
  diagnosticPath: string,
): Shape {
  const root = schemas[rootName];
  if (!root) {
    return fail(
      "source_not_permitted",
      diagnosticPath,
      "Mapping source is not available in this direction.",
    );
  }
  let shape = shapeFromSchema(root, root, false, `/${rootName}`);
  for (const segment of path) {
    if (shape.types.has("object") && shape.properties?.has(segment)) {
      shape = shape.properties.get(segment)!;
      continue;
    }
    return fail(
      "source_not_found",
      diagnosticPath,
      "Mapping source path is not declared by its schema.",
    );
  }
  return shape;
}

function unionShapes(shapes: readonly Shape[], optional: boolean): Shape {
  const types = new Set<JsonType>();
  for (const shape of shapes) shape.types.forEach((type) => types.add(type));
  const semantics = new Set(
    shapes
      .map((shape) => shape.semanticType)
      .filter((value): value is string => !!value),
  );
  const semanticType = semantics.size === 1 ? [...semantics][0]! : undefined;
  return {
    types,
    optional,
    ...(semanticType &&
    shapes.every(
      (shape) =>
        shape.semanticType === semanticType ||
        (shape.constant !== undefined && shape.semanticType === undefined),
    )
      ? { semanticType }
      : {}),
  };
}

function compileExpression(
  value: unknown,
  direction: "input" | "output",
  schemas: CompileCapabilityMappingOptions["sourceSchemas"],
  path: string,
  depth: number,
  budget: CompileBudget,
): CompiledWithShape {
  budget.nodes += 1;
  if (depth > maximumDepth || budget.nodes > maximumNodes) {
    return fail(
      "bounds_exceeded",
      path,
      "Mapping expression exceeds the depth or node-count limit.",
    );
  }
  if (!isRecord(value) || typeof value.op !== "string") {
    return fail(
      "invalid_expression",
      path,
      "Mapping expression must be an object with an operation.",
    );
  }
  if (value.op === "source") {
    exactKeys(value, ["op", "root", "pointer"], [], path);
    if (
      value.root !== "input" &&
      value.root !== "configuration" &&
      value.root !== "result"
    ) {
      return fail(
        "invalid_expression",
        `${path}/root`,
        "Mapping source root is invalid.",
      );
    }
    const allowed =
      direction === "input"
        ? new Set<MappingRoot>(["input", "configuration"])
        : new Set<MappingRoot>(["result"]);
    if (!allowed.has(value.root)) {
      return fail(
        "source_not_permitted",
        `${path}/root`,
        "Mapping source is not permitted for this direction.",
      );
    }
    const pointerPath = parsePointer(value.pointer, `${path}/pointer`);
    return {
      expression: Object.freeze({
        op: "source",
        root: value.root,
        path: pointerPath,
      }),
      shape: sourceShape(value.root, pointerPath, schemas, `${path}/pointer`),
    };
  }
  if (value.op === "constant") {
    exactKeys(value, ["op", "value"], [], path);
    const constant = cloneJson(value.value, `${path}/value`);
    return {
      expression: Object.freeze({ op: "constant", value: constant }),
      shape: {
        types: new Set([jsonType(constant)]),
        optional: false,
        constant,
      },
    };
  }
  if (value.op === "default") {
    exactKeys(value, ["op", "value", "fallback"], [], path);
    const primary = compileExpression(
      value.value,
      direction,
      schemas,
      `${path}/value`,
      depth + 1,
      budget,
    );
    const fallback = compileExpression(
      value.fallback,
      direction,
      schemas,
      `${path}/fallback`,
      depth + 1,
      budget,
    );
    return {
      expression: Object.freeze({
        op: "default",
        value: primary.expression,
        fallback: fallback.expression,
      }),
      shape: unionShapes(
        [primary.shape, fallback.shape],
        primary.shape.optional && fallback.shape.optional,
      ),
    };
  }
  if (value.op === "coalesce") {
    exactKeys(value, ["op", "values"], [], path);
    if (
      !Array.isArray(value.values) ||
      value.values.length < 2 ||
      value.values.length > 16
    ) {
      return fail(
        "invalid_expression",
        `${path}/values`,
        "Coalesce requires between 2 and 16 values.",
      );
    }
    const values = value.values.map((entry, index) =>
      compileExpression(
        entry,
        direction,
        schemas,
        `${path}/values/${String(index)}`,
        depth + 1,
        budget,
      ),
    );
    return {
      expression: Object.freeze({
        op: "coalesce",
        values: Object.freeze(values.map((entry) => entry.expression)),
      }),
      shape: unionShapes(
        values.map((entry) => entry.shape),
        values.every((entry) => entry.shape.optional),
      ),
    };
  }
  if (value.op === "enum_map") {
    exactKeys(
      value,
      ["op", "value", "cases"],
      ["fallback", "semanticType"],
      path,
    );
    const source = compileExpression(
      value.value,
      direction,
      schemas,
      `${path}/value`,
      depth + 1,
      budget,
    );
    if (
      !source.shape.types.has("string") ||
      source.shape.types.size !== 1 ||
      !isRecord(value.cases)
    ) {
      return fail(
        "type_mismatch",
        path,
        "Enum mapping requires a string source and an object of cases.",
      );
    }
    const entries = Object.entries(value.cases).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    if (entries.length < 1 || entries.length > 256) {
      return fail(
        "bounds_exceeded",
        `${path}/cases`,
        "Enum mapping requires between 1 and 256 cases.",
      );
    }
    const cases = Object.freeze(
      entries.map(([key, entry]) =>
        Object.freeze([key, cloneJson(entry, `${path}/cases/${key}`)] as const),
      ),
    );
    const fallback = Object.hasOwn(value, "fallback")
      ? cloneJson(value.fallback, `${path}/fallback`)
      : undefined;
    const semanticType = value.semanticType;
    if (
      semanticType !== undefined &&
      (typeof semanticType !== "string" ||
        !semanticTypePattern.test(semanticType))
    ) {
      return fail(
        "invalid_expression",
        `${path}/semanticType`,
        "Mapping semantic type is invalid.",
      );
    }
    const mappedValues = [
      ...cases.map((entry) => entry[1]),
      ...(fallback !== undefined ? [fallback] : []),
    ];
    const sourceEnum = source.shape.enumValues?.filter(
      (entry): entry is string => typeof entry === "string",
    );
    const covered =
      !!sourceEnum &&
      sourceEnum.every((entry) => entries.some(([key]) => key === entry));
    const types = new Set(mappedValues.map(jsonType));
    return {
      expression: Object.freeze({
        op: "enum_map",
        value: source.expression,
        cases,
        ...(fallback !== undefined ? { fallback } : {}),
        ...(typeof semanticType === "string" ? { semanticType } : {}),
      }),
      shape: {
        types,
        optional: source.shape.optional || (fallback === undefined && !covered),
        ...(typeof semanticType === "string" ? { semanticType } : {}),
        enumValues: Object.freeze(mappedValues),
      },
    };
  }
  if (value.op === "object") {
    exactKeys(value, ["op", "properties"], ["semanticType"], path);
    if (
      !isRecord(value.properties) ||
      Object.keys(value.properties).length > 200
    ) {
      return fail(
        "invalid_expression",
        `${path}/properties`,
        "Object mapping properties are invalid.",
      );
    }
    const authoredProperties = value.properties;
    const semanticType = value.semanticType;
    if (
      semanticType !== undefined &&
      (typeof semanticType !== "string" ||
        !semanticTypePattern.test(semanticType))
    ) {
      return fail(
        "invalid_expression",
        `${path}/semanticType`,
        "Mapping semantic type is invalid.",
      );
    }
    const properties = new Map<string, Shape>();
    const required = new Set<string>();
    const compiled = Object.freeze(
      Object.keys(authoredProperties)
        .sort()
        .map((key) => {
          if (!safePropertyPattern.test(key)) {
            return fail(
              "invalid_expression",
              `${path}/properties/${key}`,
              "Object mapping property is unsafe.",
            );
          }
          const entry = compileExpression(
            authoredProperties[key],
            direction,
            schemas,
            `${path}/properties/${key}`,
            depth + 1,
            budget,
          );
          properties.set(key, entry.shape);
          if (!entry.shape.optional) required.add(key);
          return Object.freeze([key, entry.expression] as const);
        }),
    );
    return {
      expression: Object.freeze({
        op: "object",
        properties: compiled,
        ...(typeof semanticType === "string" ? { semanticType } : {}),
      }),
      shape: {
        types: new Set(["object"]),
        optional: false,
        properties,
        required,
        ...(typeof semanticType === "string" ? { semanticType } : {}),
      },
    };
  }
  if (value.op === "pick") {
    exactKeys(value, ["op", "value", "keys"], [], path);
    const source = compileExpression(
      value.value,
      direction,
      schemas,
      `${path}/value`,
      depth + 1,
      budget,
    );
    if (
      !source.shape.types.has("object") ||
      source.shape.types.size !== 1 ||
      !Array.isArray(value.keys)
    ) {
      return fail(
        "type_mismatch",
        path,
        "Pick requires an object source and a key list.",
      );
    }
    const rawKeys = [...new Set<unknown>(value.keys)];
    const keys = rawKeys
      .filter((key): key is string => typeof key === "string")
      .sort();
    if (
      keys.length < 1 ||
      keys.length > 128 ||
      keys.length !== rawKeys.length ||
      keys.some((key) => !safePropertyPattern.test(key))
    ) {
      return fail(
        "invalid_expression",
        `${path}/keys`,
        "Pick keys are invalid.",
      );
    }
    const properties = new Map<string, Shape>();
    const required = new Set<string>();
    for (const key of keys) {
      const shape = source.shape.properties?.get(key);
      if (!shape)
        return fail(
          "source_not_found",
          `${path}/keys`,
          `Pick source does not declare ${key}.`,
        );
      properties.set(key, shape);
      if (!shape.optional) required.add(key);
    }
    return {
      expression: Object.freeze({
        op: "pick",
        value: source.expression,
        keys: Object.freeze(keys),
      }),
      shape: {
        types: new Set(["object"]),
        optional: source.shape.optional,
        properties,
        required,
        ...(source.shape.semanticType
          ? { semanticType: source.shape.semanticType }
          : {}),
      },
    };
  }
  if (value.op === "number") {
    exactKeys(
      value,
      ["op", "value"],
      ["multiply", "add", "minimum", "maximum", "rounding", "semanticType"],
      path,
    );
    const source = compileExpression(
      value.value,
      direction,
      schemas,
      `${path}/value`,
      depth + 1,
      budget,
    );
    if (
      [...source.shape.types].some(
        (type) => type !== "integer" && type !== "number",
      )
    ) {
      return fail(
        "type_mismatch",
        `${path}/value`,
        "Numeric mapping requires a number-only source.",
      );
    }
    const numericFields = ["multiply", "add", "minimum", "maximum"] as const;
    for (const field of numericFields) {
      const entry = value[field];
      if (
        entry !== undefined &&
        (typeof entry !== "number" || !Number.isFinite(entry))
      ) {
        return fail(
          "invalid_expression",
          `${path}/${field}`,
          "Numeric transform values must be finite.",
        );
      }
    }
    if (
      typeof value.minimum === "number" &&
      typeof value.maximum === "number" &&
      value.minimum > value.maximum
    ) {
      return fail(
        "invalid_expression",
        path,
        "Numeric transform minimum exceeds maximum.",
      );
    }
    if (
      value.rounding !== undefined &&
      value.rounding !== "floor" &&
      value.rounding !== "ceil" &&
      value.rounding !== "round"
    ) {
      return fail(
        "invalid_expression",
        `${path}/rounding`,
        "Numeric transform rounding is invalid.",
      );
    }
    const semanticType = value.semanticType;
    if (
      semanticType !== undefined &&
      (typeof semanticType !== "string" ||
        !semanticTypePattern.test(semanticType))
    ) {
      return fail(
        "invalid_expression",
        `${path}/semanticType`,
        "Mapping semantic type is invalid.",
      );
    }
    const outputSemanticType =
      typeof semanticType === "string"
        ? semanticType
        : source.shape.semanticType;
    return {
      expression: Object.freeze({
        op: "number",
        value: source.expression,
        ...(typeof value.multiply === "number"
          ? { multiply: value.multiply }
          : {}),
        ...(typeof value.add === "number" ? { add: value.add } : {}),
        ...(typeof value.minimum === "number"
          ? { minimum: value.minimum }
          : {}),
        ...(typeof value.maximum === "number"
          ? { maximum: value.maximum }
          : {}),
        ...(typeof value.rounding === "string"
          ? { rounding: value.rounding }
          : {}),
        ...(typeof semanticType === "string" ? { semanticType } : {}),
      }),
      shape: {
        types: new Set([value.rounding ? "integer" : "number"]),
        optional: source.shape.optional,
        ...(outputSemanticType ? { semanticType: outputSemanticType } : {}),
      },
    };
  }
  return fail(
    "invalid_expression",
    `${path}/op`,
    "Mapping operation is unsupported.",
  );
}

function assignable(source: JsonType, target: ReadonlySet<JsonType>): boolean {
  return target.has(source) || (source === "integer" && target.has("number"));
}

function jsonEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((entry, index) => jsonEqual(entry, right[index]))
    );
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key, index) =>
          key === rightKeys[index] && jsonEqual(left[key], right[key]),
      )
    );
  }
  return false;
}

function checkShape(
  source: Shape,
  target: Shape,
  path: string,
  required: boolean,
): void {
  if (required && source.optional) {
    fail(
      "missing_required_target",
      path,
      "Mapping can omit a required target field.",
    );
  }
  const deferredArtifactReference =
    source.attemptOutputArtifactReference === true &&
    target.types.has("string") &&
    target.semanticType?.startsWith("artifact.") === true;
  if (
    !deferredArtifactReference &&
    [...source.types].some((type) => !assignable(type, target.types))
  ) {
    fail(
      "type_mismatch",
      path,
      "Mapping value type is incompatible with the target schema.",
    );
  }
  if (
    target.semanticType &&
    source.constant === undefined &&
    source.semanticType !== target.semanticType
  ) {
    fail(
      "semantic_mismatch",
      path,
      "Mapping semantic type is incompatible with the target field.",
    );
  }
  if (
    target.constant !== undefined &&
    source.constant !== undefined &&
    !jsonEqual(source.constant, target.constant)
  ) {
    fail(
      "type_mismatch",
      path,
      "Mapping constant differs from the target constant.",
    );
  }
  if (
    target.enumValues &&
    source.enumValues &&
    source.enumValues.some(
      (entry) =>
        !target.enumValues!.some((candidate) => jsonEqual(entry, candidate)),
    )
  ) {
    fail(
      "type_mismatch",
      path,
      "Mapping can produce a value outside the target enum.",
    );
  }
  if (target.types.has("object") && source.properties) {
    for (const key of target.required ?? []) {
      const sourceProperty = source.properties.get(key);
      const targetProperty = target.properties?.get(key);
      if (!sourceProperty || !targetProperty) {
        fail(
          "missing_required_target",
          `${path}/${key}`,
          "Mapping does not produce a required target field.",
        );
      }
      checkShape(sourceProperty, targetProperty, `${path}/${key}`, true);
    }
    for (const [key, sourceProperty] of source.properties) {
      const targetProperty = target.properties?.get(key);
      if (targetProperty)
        checkShape(sourceProperty, targetProperty, `${path}/${key}`, false);
    }
  }
}

function inspectReferences(
  value: unknown,
  path = "",
  depth = 0,
  budget: CompileBudget = { nodes: 0 },
): void {
  budget.nodes += 1;
  if (depth > maximumDepth || budget.nodes > maximumNodes) {
    fail(
      "bounds_exceeded",
      path,
      "Mapping schema exceeds the depth or node-count limit.",
    );
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      inspectReferences(entry, `${path}/${String(index)}`, depth + 1, budget),
    );
    return;
  }
  if (!isRecord(value)) return;
  if (typeof value.$ref === "string" && !value.$ref.startsWith("#")) {
    fail(
      "remote_reference_forbidden",
      `${path}/$ref`,
      "Capability mappings do not permit remote schema references.",
    );
  }
  for (const [key, entry] of Object.entries(value)) {
    inspectReferences(entry, `${path}/${key}`, depth + 1, budget);
  }
}

export function assertBoundedCapabilityJsonSchema(
  value: unknown,
): asserts value is Readonly<Record<string, unknown>> {
  if (!isRecord(value)) {
    fail("unsupported_schema", "", "Capability schema must be an object.");
  }
  inspectReferences(value);
  const shape = shapeFromSchema(value, value, false, "");
  if (!shape.types.has("object")) {
    fail(
      "unsupported_schema",
      "",
      "Capability interface schema must describe an object.",
    );
  }
}

export function compileCapabilityMappingPlanV1(
  options: CompileCapabilityMappingOptions,
): CompiledCapabilityMappingPlanV1 {
  if (!isRecord(options.document)) {
    return fail(
      "invalid_document",
      "",
      "Capability mapping document must be an object.",
    );
  }
  exactKeys(
    options.document,
    ["schemaVersion", "direction", "expression"],
    [],
    "",
  );
  if (
    options.document.schemaVersion !== "kanvas.capability-mapping/v1" ||
    (options.document.direction !== "input" &&
      options.document.direction !== "output")
  ) {
    return fail(
      "invalid_document",
      "",
      "Capability mapping document version or direction is invalid.",
    );
  }
  inspectReferences(options.targetSchema, "/targetSchema");
  for (const [root, schema] of Object.entries(options.sourceSchemas)) {
    inspectReferences(schema, `/sourceSchemas/${root}`);
  }
  const compiled = compileExpression(
    options.document.expression,
    options.document.direction,
    options.sourceSchemas,
    "/expression",
    0,
    { nodes: 0 },
  );
  const target = shapeFromSchema(
    options.targetSchema,
    options.targetSchema,
    false,
    "/targetSchema",
  );
  checkShape(compiled.shape, target, "", true);
  return Object.freeze({
    schemaVersion: "kanvas.compiled-capability-mapping/v1" as const,
    direction: options.document.direction,
    expression: compiled.expression,
  });
}

export interface CapabilityMappingContextV1 {
  readonly input?: unknown;
  readonly configuration?: unknown;
  readonly result?: unknown;
}

export function createIdentityCapabilityMappingPlanV1(
  direction: "input" | "output",
): CompiledCapabilityMappingPlanV1 {
  return Object.freeze({
    schemaVersion: "kanvas.compiled-capability-mapping/v1",
    direction,
    expression: Object.freeze({
      op: "source",
      root: direction === "input" ? "input" : "result",
      path: Object.freeze([]),
    }),
  });
}

function inspectCanonicalCompiledExpression(
  expression: CompiledCapabilityMappingExpressionV1,
  path: string,
  depth: number,
  budget: CompileBudget,
): void {
  budget.nodes += 1;
  if (depth > maximumDepth || budget.nodes > maximumNodes) {
    fail(
      "bounds_exceeded",
      path,
      "Compiled mapping exceeds the depth or node-count limit.",
    );
  }
  if (expression.op === "source" || expression.op === "constant") return;
  if (expression.op === "default") {
    inspectCanonicalCompiledExpression(
      expression.value,
      `${path}/value`,
      depth + 1,
      budget,
    );
    inspectCanonicalCompiledExpression(
      expression.fallback,
      `${path}/fallback`,
      depth + 1,
      budget,
    );
    return;
  }
  if (expression.op === "coalesce") {
    expression.values.forEach((entry, index) =>
      inspectCanonicalCompiledExpression(
        entry,
        `${path}/values/${String(index)}`,
        depth + 1,
        budget,
      ),
    );
    return;
  }
  if (expression.op === "enum_map") {
    inspectCanonicalCompiledExpression(
      expression.value,
      `${path}/value`,
      depth + 1,
      budget,
    );
    expression.cases.forEach(([key], index) => {
      const previous = expression.cases[index - 1]?.[0];
      if (previous !== undefined && previous.localeCompare(key) >= 0) {
        fail(
          "invalid_expression",
          `${path}/cases/${String(index)}`,
          "Compiled enum mapping cases are not in unique canonical order.",
        );
      }
    });
    return;
  }
  if (expression.op === "object") {
    expression.properties.forEach(([key, entry], index) => {
      const previous = expression.properties[index - 1]?.[0];
      if (previous !== undefined && previous.localeCompare(key) >= 0) {
        fail(
          "invalid_expression",
          `${path}/properties/${String(index)}`,
          "Compiled object properties are not in unique canonical order.",
        );
      }
      inspectCanonicalCompiledExpression(
        entry,
        `${path}/properties/${String(index)}/1`,
        depth + 1,
        budget,
      );
    });
    return;
  }
  if (expression.op === "pick") {
    expression.keys.forEach((key, index) => {
      const previous = expression.keys[index - 1];
      if (previous !== undefined && previous.localeCompare(key) >= 0) {
        fail(
          "invalid_expression",
          `${path}/keys/${String(index)}`,
          "Compiled pick keys are not in unique canonical order.",
        );
      }
    });
  }
  inspectCanonicalCompiledExpression(
    expression.value,
    `${path}/value`,
    depth + 1,
    budget,
  );
}

export function parseCompiledCapabilityMappingPlanV1(
  value: unknown,
): CompiledCapabilityMappingPlanV1 {
  let valid: boolean;
  try {
    valid = Value.Check(
      CompiledCapabilityMappingPlanV1Schema,
      [
        CapabilityMappingJsonValueSchema,
        CompiledCapabilityMappingExpressionV1Schema,
      ],
      value,
    );
  } catch {
    valid = false;
  }
  if (!valid) {
    return fail(
      "invalid_document",
      "",
      "Compiled capability mapping document is invalid.",
    );
  }
  const plan = value as CompiledCapabilityMappingPlanV1;
  inspectCanonicalCompiledExpression(plan.expression, "/expression", 0, {
    nodes: 0,
  });
  return cloneJson(value, "") as unknown as CompiledCapabilityMappingPlanV1;
}

function pointerValue(
  source: unknown,
  path: readonly string[],
): EvaluatedValue {
  let value = source;
  for (const segment of path) {
    if (Array.isArray(value)) {
      if (!canonicalArrayIndex.test(segment)) return missing;
      const index = Number(segment);
      if (!Number.isSafeInteger(index) || !Object.hasOwn(value, index))
        return missing;
      value = value[index];
      continue;
    }
    if (!isRecord(value) || !Object.hasOwn(value, segment)) return missing;
    value = value[segment];
  }
  return cloneJson(value, "/resolved");
}

function evaluate(
  expression: CompiledCapabilityMappingExpressionV1,
  context: CapabilityMappingContextV1,
): EvaluatedValue {
  if (expression.op === "source")
    return pointerValue(context[expression.root], expression.path);
  if (expression.op === "constant") return expression.value;
  if (expression.op === "default") {
    const value = evaluate(expression.value, context);
    return value === missing ? evaluate(expression.fallback, context) : value;
  }
  if (expression.op === "coalesce") {
    for (const candidate of expression.values) {
      const value = evaluate(candidate, context);
      if (value !== missing && value !== null) return value;
    }
    return missing;
  }
  if (expression.op === "enum_map") {
    const value = evaluate(expression.value, context);
    if (value === missing) return missing;
    if (typeof value !== "string") {
      return fail(
        "type_mismatch",
        "",
        "Enum mapping received a non-string value.",
      );
    }
    const selected = expression.cases.find(([key]) => key === value);
    return selected ? selected[1] : (expression.fallback ?? missing);
  }
  if (expression.op === "object") {
    const result = Object.create(null) as Record<
      string,
      CapabilityMappingJsonValue
    >;
    for (const [key, property] of expression.properties) {
      const value = evaluate(property, context);
      if (value !== missing) result[key] = value;
    }
    return Object.freeze(result);
  }
  if (expression.op === "pick") {
    const value = evaluate(expression.value, context);
    if (value === missing) return missing;
    if (!isRecord(value))
      return fail("type_mismatch", "", "Pick received a non-object value.");
    const result = Object.create(null) as Record<
      string,
      CapabilityMappingJsonValue
    >;
    for (const key of expression.keys) {
      if (Object.hasOwn(value, key))
        result[key] = cloneJson(value[key], `/pick/${key}`);
    }
    return Object.freeze(result);
  }
  const source = evaluate(expression.value, context);
  if (source === missing) return missing;
  if (typeof source !== "number" || !Number.isFinite(source)) {
    return fail(
      "type_mismatch",
      "",
      "Numeric mapping received a non-number value.",
    );
  }
  let result = source * (expression.multiply ?? 1) + (expression.add ?? 0);
  if (expression.minimum !== undefined)
    result = Math.max(expression.minimum, result);
  if (expression.maximum !== undefined)
    result = Math.min(expression.maximum, result);
  if (expression.rounding) result = Math[expression.rounding](result);
  if (
    !Number.isFinite(result) ||
    (!Number.isSafeInteger(result) && expression.rounding !== undefined)
  ) {
    return fail(
      "type_mismatch",
      "",
      "Numeric mapping produced an unsafe number.",
    );
  }
  return result;
}

export function executeCapabilityMappingPlanV1(
  plan: CompiledCapabilityMappingPlanV1,
  context: CapabilityMappingContextV1,
): CapabilityMappingJsonValue {
  const result = evaluate(plan.expression, context);
  if (result === missing) {
    return fail(
      "missing_required_target",
      "",
      "Capability mapping produced no root value.",
    );
  }
  return result;
}
