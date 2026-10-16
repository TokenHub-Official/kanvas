import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import { WorkflowTopologySchema } from "../src/workflow/index.js";

describe("WorkflowTopologySchema", () => {
  it("rejects undeclared properties without mutating input", () => {
    const ajv = new Ajv2020({
      strict: true,
      coerceTypes: false,
      removeAdditional: false,
      useDefaults: false,
    });
    const validate = ajv.compile(WorkflowTopologySchema);
    const input = {
      schemaVersion: 1,
      key: "foundation_probe",
      entryNodeKey: "validate",
      limits: { maxNodeRuns: 1, timeoutMs: 60_000 },
      nodes: [
        {
          key: "validate",
          kind: "invoke",
          capability: {
            contractId: "foundation.validate",
            revision: 1,
            canonicalDigest: `sha256:${"a".repeat(64)}`,
          },
          input: {},
          next: [],
          injected: true,
        },
      ],
      outputs: {},
    };

    expect(validate(input)).toBe(false);
    expect(input.nodes[0]?.injected).toBe(true);
  });

  it("accepts the bounded v1 node protocol and tagged values", () => {
    const ajv = new Ajv2020({
      strict: true,
      coerceTypes: false,
      removeAdditional: false,
      useDefaults: false,
    });
    const validate = ajv.compile(WorkflowTopologySchema);

    expect(
      validate({
        schemaVersion: 1,
        key: "bounded_probe",
        entryNodeKey: "prepare",
        limits: {
          maxNodeRuns: 12,
          timeoutMs: 60_000,
        },
        nodes: [
          {
            key: "prepare",
            kind: "invoke",
            capability: {
              contractId: "foundation.prepare",
              revision: 1,
              canonicalDigest: `sha256:${"a".repeat(64)}`,
            },
            input: {
              sourceId: {
                $value: {
                  source: "workflow_input",
                  pointer: "/sourceId",
                },
              },
            },
            next: ["items"],
          },
          {
            key: "items",
            kind: "map",
            items: {
              $value: {
                source: "node_output",
                nodeKey: "prepare",
                scope: "root",
                pointer: "/items",
              },
            },
            scopeKey: {
              $value: {
                source: "map_item",
                pointer: "/id",
              },
            },
            maxItems: 10,
            maxConcurrency: 4,
            failureMode: "collect_all",
            invoke: {
              capability: {
                contractId: "foundation.item",
                revision: 1,
                canonicalDigest: `sha256:${"b".repeat(64)}`,
              },
              input: {
                item: {
                  $value: {
                    source: "map_item",
                    pointer: "",
                  },
                },
              },
            },
            next: [],
          },
        ],
        outputs: {
          items: {
            required: true,
            value: {
              $value: {
                source: "node_output",
                nodeKey: "items",
                scope: "root",
                pointer: "/items",
              },
            },
          },
        },
      }),
    ).toBe(true);
  });

  it("rejects expression-like or malformed value tags", () => {
    const ajv = new Ajv2020({
      strict: true,
      coerceTypes: false,
      removeAdditional: false,
      useDefaults: false,
    });
    const validate = ajv.compile(WorkflowTopologySchema);
    const topology = {
      schemaVersion: 1,
      key: "invalid_value",
      entryNodeKey: "invoke",
      limits: {
        maxNodeRuns: 1,
        timeoutMs: 60_000,
      },
      nodes: [
        {
          key: "invoke",
          kind: "invoke",
          capability: {
            contractId: "foundation.invoke",
            revision: 1,
            canonicalDigest: `sha256:${"c".repeat(64)}`,
          },
          input: {
            $value: {
              source: "workflow_input",
              pointer: "/value",
            },
            expression: "input.value",
          },
          next: [],
        },
      ],
      outputs: {},
    };

    expect(validate(topology)).toBe(false);
    expect(topology.nodes[0]?.input.expression).toBe("input.value");
  });
});
