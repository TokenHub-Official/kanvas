import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import { CapabilityContractRevisionRefSchema } from "../capability/index.js";

const WorkflowKeySchema = Type.String({
  minLength: 1,
  maxLength: 100,
  pattern: "^[a-z][a-z0-9_]*$",
});

const WorkflowJoinPolicySchema = Type.Union([
  Type.Literal("all_success"),
  Type.Literal("all_settled"),
]);

const WorkflowNextSchema = Type.Array(WorkflowKeySchema, {
  maxItems: 20,
  uniqueItems: true,
});

/**
 * A closed JSON value schema used only for embedded literal values. Runtime
 * protocol code applies tighter depth, node-count and plain-object limits.
 */
export const WorkflowJsonValueSchema = Type.Recursive(
  (Self) =>
    Type.Union([
      Type.Null(),
      Type.Boolean(),
      Type.Number(),
      Type.String(),
      Type.Array(Self),
      Type.Record(Type.String(), Self),
    ]),
  {
    $id: "kanvas.workflow-json-value.v1",
  },
);

export type WorkflowJsonValue = Static<typeof WorkflowJsonValueSchema>;

const JsonPointerSchema = Type.String({
  maxLength: 2048,
  pattern: "^(?:/(?:[^~/]|~[01])*)*$",
});

export const WorkflowValueReferenceSchema = Type.Union([
  Type.Object(
    {
      source: Type.Literal("workflow_input"),
      pointer: JsonPointerSchema,
    },
    {
      additionalProperties: false,
    },
  ),
  Type.Object(
    {
      source: Type.Union([
        Type.Literal("node_output"),
        Type.Literal("node_result"),
      ]),
      nodeKey: WorkflowKeySchema,
      scope: Type.Union([Type.Literal("root"), Type.Literal("current")]),
      pointer: JsonPointerSchema,
    },
    {
      additionalProperties: false,
    },
  ),
  Type.Object(
    {
      source: Type.Literal("map_item"),
      pointer: JsonPointerSchema,
    },
    {
      additionalProperties: false,
    },
  ),
]);

export type WorkflowValueReference = Static<
  typeof WorkflowValueReferenceSchema
>;

/**
 * Ordinary JSON is literal. Dynamic leaves are explicit {$value: ...} tags.
 * {$literal: ...} escapes objects that would otherwise collide with a tag.
 */
export const WorkflowValueTemplateSchema = Type.Recursive(
  (Self) =>
    Type.Union([
      Type.Null(),
      Type.Boolean(),
      Type.Number(),
      Type.String(),
      Type.Array(Self),
      Type.Object(
        {
          $value: WorkflowValueReferenceSchema,
        },
        {
          additionalProperties: false,
        },
      ),
      Type.Object(
        {
          $literal: Type.Ref(WorkflowJsonValueSchema),
        },
        {
          additionalProperties: false,
        },
      ),
      Type.Object(
        {
          $string: Type.Array(
            Type.Union([
              Type.String(),
              Type.Object(
                {
                  $value: WorkflowValueReferenceSchema,
                },
                { additionalProperties: false },
              ),
            ]),
            { minItems: 1, maxItems: 1000 },
          ),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          $coalesce: Type.Array(
            Type.Object(
              { $value: WorkflowValueReferenceSchema },
              { additionalProperties: false },
            ),
            { minItems: 2, maxItems: 32 },
          ),
        },
        { additionalProperties: false },
      ),
      Type.Record(
        Type.String({
          pattern: "^(?!\\$(?:value|literal|string|coalesce)$).*$",
        }),
        Self,
        {
          additionalProperties: false,
        },
      ),
    ]),
  {
    $id: "kanvas.workflow-value-template.v1",
  },
);

export type WorkflowValueTemplate = Static<typeof WorkflowValueTemplateSchema>;

const WorkflowInvokeNodeV1Schema = Type.Object(
  {
    key: WorkflowKeySchema,
    kind: Type.Literal("invoke"),
    joinPolicy: Type.Optional(WorkflowJoinPolicySchema),
    capability: CapabilityContractRevisionRefSchema,
    input: Type.Ref(WorkflowValueTemplateSchema),
    next: WorkflowNextSchema,
  },
  {
    additionalProperties: false,
  },
);

const WorkflowMapInvokeV1Schema = Type.Object(
  {
    capability: CapabilityContractRevisionRefSchema,
    input: Type.Ref(WorkflowValueTemplateSchema),
  },
  {
    additionalProperties: false,
  },
);

const WorkflowMapNodeV1Schema = Type.Object(
  {
    key: WorkflowKeySchema,
    kind: Type.Literal("map"),
    joinPolicy: Type.Optional(WorkflowJoinPolicySchema),
    items: Type.Ref(WorkflowValueTemplateSchema),
    scopeKey: Type.Ref(WorkflowValueTemplateSchema),
    maxItems: Type.Integer({ minimum: 1, maximum: 500 }),
    maxConcurrency: Type.Integer({ minimum: 1, maximum: 32 }),
    failureMode: Type.Union([
      Type.Literal("collect_all"),
      Type.Literal("fail_fast"),
    ]),
    invoke: WorkflowMapInvokeV1Schema,
    next: WorkflowNextSchema,
  },
  {
    additionalProperties: false,
  },
);

const WorkflowSwitchComparableSchema = Type.Ref(WorkflowJsonValueSchema);

const WorkflowSwitchWhenSchema = Type.Union([
  Type.Object(
    {
      operator: Type.Literal("exists"),
    },
    {
      additionalProperties: false,
    },
  ),
  Type.Object(
    {
      operator: Type.Union([
        Type.Literal("equals"),
        Type.Literal("not_equals"),
      ]),
      value: WorkflowSwitchComparableSchema,
    },
    {
      additionalProperties: false,
    },
  ),
  Type.Object(
    {
      operator: Type.Literal("in"),
      value: Type.Array(WorkflowSwitchComparableSchema, {
        minItems: 1,
        maxItems: 100,
      }),
    },
    {
      additionalProperties: false,
    },
  ),
]);

const WorkflowSwitchCaseV1Schema = Type.Object(
  {
    when: WorkflowSwitchWhenSchema,
    next: WorkflowNextSchema,
  },
  {
    additionalProperties: false,
  },
);

const WorkflowSwitchNodeV1Schema = Type.Object(
  {
    key: WorkflowKeySchema,
    kind: Type.Literal("switch"),
    joinPolicy: Type.Optional(WorkflowJoinPolicySchema),
    value: Type.Ref(WorkflowValueTemplateSchema),
    cases: Type.Array(WorkflowSwitchCaseV1Schema, {
      minItems: 1,
      maxItems: 20,
    }),
    defaultNext: WorkflowNextSchema,
  },
  {
    additionalProperties: false,
  },
);

const WorkflowApprovalNodeV1Schema = Type.Object(
  {
    key: WorkflowKeySchema,
    kind: Type.Literal("approval"),
    joinPolicy: Type.Optional(WorkflowJoinPolicySchema),
    request: Type.Ref(WorkflowValueTemplateSchema),
    decisionSchema: Type.Record(
      Type.String(),
      Type.Ref(WorkflowJsonValueSchema),
      {
        minProperties: 1,
        maxProperties: 200,
      },
    ),
    next: WorkflowNextSchema,
  },
  {
    additionalProperties: false,
  },
);

export const WorkflowTopologyNodeV1Schema = Type.Union([
  WorkflowInvokeNodeV1Schema,
  WorkflowMapNodeV1Schema,
  WorkflowSwitchNodeV1Schema,
  WorkflowApprovalNodeV1Schema,
]);

export type WorkflowTopologyNodeV1 = Static<
  typeof WorkflowTopologyNodeV1Schema
>;

const WorkflowOutputSelectionSchema = Type.Object(
  {
    required: Type.Boolean(),
    value: Type.Ref(WorkflowValueTemplateSchema),
  },
  {
    additionalProperties: false,
  },
);

export const WorkflowTopologyV1Schema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    key: WorkflowKeySchema,
    entryNodeKey: WorkflowKeySchema,
    limits: Type.Object(
      {
        maxNodeRuns: Type.Integer({ minimum: 1, maximum: 500 }),
        timeoutMs: Type.Integer({
          minimum: 1000,
          maximum: 86_400_000,
        }),
      },
      {
        additionalProperties: false,
      },
    ),
    nodes: Type.Array(WorkflowTopologyNodeV1Schema, {
      minItems: 1,
      maxItems: 500,
    }),
    outputs: Type.Record(
      Type.String({
        minLength: 1,
        maxLength: 100,
        pattern: "^[a-z][a-z0-9_]*$",
      }),
      WorkflowOutputSelectionSchema,
      {
        maxProperties: 100,
      },
    ),
  },
  {
    additionalProperties: false,
    $id: "kanvas.workflow-topology.v1",
    $defs: {
      WorkflowJsonValue: WorkflowJsonValueSchema,
      WorkflowValueTemplate: WorkflowValueTemplateSchema,
    },
  },
);

export type WorkflowTopologyV1 = Static<typeof WorkflowTopologyV1Schema>;

export const WorkflowTopologySchema = WorkflowTopologyV1Schema;

export type WorkflowTopology = Static<typeof WorkflowTopologySchema>;

export function isWorkflowTopology(value: unknown): value is WorkflowTopology {
  try {
    return Value.Check(
      WorkflowTopologySchema,
      [WorkflowJsonValueSchema, WorkflowValueTemplateSchema],
      value,
    );
  } catch {
    return false;
  }
}

export const WorkflowTopologyDiagnosticCodeSchema = Type.Union([
  Type.Literal("duplicate_node_key"),
  Type.Literal("duplicate_target"),
  Type.Literal("missing_target"),
  Type.Literal("cycle_detected"),
  Type.Literal("entry_node_missing"),
  Type.Literal("unreachable_node"),
  Type.Literal("join_policy_required"),
  Type.Literal("reference_node_missing"),
  Type.Literal("reference_not_upstream"),
  Type.Literal("reference_scope_invalid"),
  Type.Literal("map_item_out_of_scope"),
  Type.Literal("invalid_value_template"),
  Type.Literal("limit_exceeded"),
]);

export const WorkflowTopologyDiagnosticSchema = Type.Object(
  {
    code: WorkflowTopologyDiagnosticCodeSchema,
    nodeKey: Type.Optional(Type.String()),
    targetKey: Type.Optional(Type.String()),
    path: Type.Optional(Type.String()),
    message: Type.String(),
  },
  {
    additionalProperties: false,
  },
);

export type WorkflowTopologyDiagnostic = Static<
  typeof WorkflowTopologyDiagnosticSchema
>;

export const ValidateWorkflowTopologyResultSchema = Type.Object(
  {
    valid: Type.Boolean(),
    diagnostics: Type.Array(WorkflowTopologyDiagnosticSchema),
  },
  {
    additionalProperties: false,
  },
);

export type ValidateWorkflowTopologyResult = Static<
  typeof ValidateWorkflowTopologyResultSchema
>;
