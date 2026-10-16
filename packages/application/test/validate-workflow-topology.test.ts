import { describe, expect, it } from "vitest";
import {
  compileWorkflowAuthoringGraph,
  workflowAuthoringInputNodeId,
  workflowAuthoringOutputNodeId,
  type WorkflowAuthoringGraphV1,
} from "@kanvas/contracts/workflow-authoring";

import { createValidateWorkflowTopology } from "../src/modules/workflow/index.js";

describe("validate workflow topology", () => {
  it("accepts a compiled six-node authoring graph with fixed parallel and activated-edge join", async () => {
    const digest = `sha256:${"a".repeat(64)}`;
    const capability = (contractId: string) => ({
      contractId,
      revision: 1,
      canonicalDigest: digest,
    });
    const graph: WorkflowAuthoringGraphV1 = {
      schemaVersion: 1,
      workflowKey: "authoring_compile_probe",
      limits: { maxNodeRuns: 20, timeoutMs: 60_000 },
      nodes: [
        {
          id: workflowAuthoringInputNodeId,
          type: "input",
          displayName: "Input",
          schemaMetadata: {},
          fields: [
            {
              key: "source",
              label: "Source",
              required: true,
              schema: { type: "string" },
            },
          ],
        },
        {
          id: "prepare",
          nodeKey: "prepare",
          type: "capability",
          displayName: "Prepare",
          capability: capability("image.prepare"),
          input: {
            kind: "object",
            fields: {
              source: {
                kind: "variable",
                variable: { source: "workflow_input", path: ["source"] },
              },
            },
          },
        },
        ...["left", "right"].map((nodeKey) => ({
          id: nodeKey,
          nodeKey,
          type: "capability" as const,
          displayName: nodeKey,
          capability: capability(`image.${nodeKey}`),
          input: {
            kind: "object" as const,
            fields: {
              source: {
                kind: "variable" as const,
                variable: {
                  source: "node_output" as const,
                  nodeKey: "prepare",
                  scope: "root" as const,
                  path: ["artifactId"],
                },
              },
            },
          },
        })),
        {
          id: "review",
          nodeKey: "review",
          type: "approval",
          displayName: "Review",
          joinPolicy: "all_success",
          request: {
            kind: "object",
            fields: {
              left: {
                kind: "variable",
                variable: {
                  source: "node_output",
                  nodeKey: "left",
                  scope: "root",
                  path: ["artifactId"],
                },
              },
            },
          },
          decisionSchema: { approved: { type: "boolean" } },
        },
        {
          id: workflowAuthoringOutputNodeId,
          type: "output",
          displayName: "Output",
          schemaMetadata: {},
          fields: [
            {
              key: "approved",
              label: "Approved",
              required: true,
              schema: { type: "boolean" },
              binding: {
                kind: "variable",
                variable: {
                  source: "node_output",
                  nodeKey: "review",
                  scope: "root",
                  path: ["approved"],
                },
              },
            },
          ],
        },
      ],
      edges: [
        {
          id: "start",
          source: workflowAuthoringInputNodeId,
          sourcePort: "start",
          target: "prepare",
        },
        {
          id: "prepare-left",
          source: "prepare",
          sourcePort: "out",
          target: "left",
        },
        {
          id: "prepare-right",
          source: "prepare",
          sourcePort: "out",
          target: "right",
        },
        {
          id: "left-review",
          source: "left",
          sourcePort: "out",
          target: "review",
        },
        {
          id: "right-review",
          source: "right",
          sourcePort: "out",
          target: "review",
        },
        {
          id: "finish",
          source: "review",
          sourcePort: "out",
          target: workflowAuthoringOutputNodeId,
        },
      ],
    };
    const document = compileWorkflowAuthoringGraph(graph);
    const validate = createValidateWorkflowTopology();
    await expect(validate({ topology: document.topology })).resolves.toEqual({
      valid: true,
      diagnostics: [],
    });
  });

  it("reports duplicate, missing target and cycle diagnostics", async () => {
    const validate = createValidateWorkflowTopology();
    const result = await validate({
      topology: {
        schemaVersion: 1,
        key: "invalid_probe",
        entryNodeKey: "loop",
        limits: { maxNodeRuns: 2, timeoutMs: 60_000 },
        nodes: [
          {
            key: "loop",
            kind: "invoke",
            capability: {
              contractId: "foundation.loop",
              revision: 1,
              canonicalDigest: `sha256:${"a".repeat(64)}`,
            },
            input: {},
            next: ["loop", "missing"],
          },
          {
            key: "loop",
            kind: "invoke",
            capability: {
              contractId: "foundation.loop",
              revision: 1,
              canonicalDigest: `sha256:${"a".repeat(64)}`,
            },
            input: {},
            next: [],
          },
        ],
        outputs: {},
      },
    });

    expect(result.valid).toBe(false);
    expect(result.diagnostics.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "duplicate_node_key",
        "missing_target",
        "cycle_detected",
      ]),
    );
  });

  it("accepts a reachable bounded v2 topology with a direct map scope key", async () => {
    const validate = createValidateWorkflowTopology();
    const result = await validate({
      topology: {
        schemaVersion: 1,
        key: "bounded_probe",
        entryNodeKey: "prepare",
        limits: {
          maxNodeRuns: 6,
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
              source: {
                $value: {
                  source: "workflow_input",
                  pointer: "/source",
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
            maxItems: 4,
            maxConcurrency: 2,
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
      },
    });

    expect(result).toEqual({
      valid: true,
      diagnostics: [],
    });
  });

  it("rejects unreachable nodes, downstream reads and unbounded expansion", async () => {
    const validate = createValidateWorkflowTopology();
    const result = await validate({
      topology: {
        schemaVersion: 1,
        key: "invalid_v2",
        entryNodeKey: "first",
        limits: {
          maxNodeRuns: 2,
          timeoutMs: 60_000,
        },
        nodes: [
          {
            key: "first",
            kind: "invoke",
            capability: {
              contractId: "foundation.first",
              revision: 1,
              canonicalDigest: `sha256:${"c".repeat(64)}`,
            },
            input: {
              future: {
                $value: {
                  source: "node_output",
                  nodeKey: "later",
                  scope: "root",
                  pointer: "",
                },
              },
            },
            next: ["fanout"],
          },
          {
            key: "fanout",
            kind: "map",
            items: [],
            scopeKey: "constant",
            maxItems: 2,
            maxConcurrency: 1,
            failureMode: "fail_fast",
            invoke: {
              capability: {
                contractId: "foundation.item",
                revision: 1,
                canonicalDigest: `sha256:${"d".repeat(64)}`,
              },
              input: {},
            },
            next: [],
          },
          {
            key: "later",
            kind: "approval",
            request: {},
            decisionSchema: {
              type: "object",
            },
            next: [],
          },
        ],
        outputs: {},
      },
    });

    expect(result.valid).toBe(false);
    expect(result.diagnostics.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "unreachable_node",
        "reference_not_upstream",
        "invalid_value_template",
        "limit_exceeded",
      ]),
    );
  });

  it("rejects a node reading its own not-yet-terminal output", async () => {
    const validate = createValidateWorkflowTopology();
    const result = await validate({
      topology: {
        schemaVersion: 1,
        key: "self_reference",
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
              canonicalDigest: `sha256:${"e".repeat(64)}`,
            },
            input: {
              previous: {
                $value: {
                  source: "node_output",
                  nodeKey: "invoke",
                  scope: "root",
                  pointer: "",
                },
              },
            },
            next: [],
          },
        ],
        outputs: {},
      },
    });

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "reference_not_upstream",
          nodeKey: "invoke",
          targetKey: "invoke",
        }),
      ]),
    );
  });
});
