import {
  BoundedWorkflowRuntimeError,
  digestProviderValue,
  type BoundedWorkflowOrchestratorStore,
} from "@kanvas/database/runtime";
import { describe, expect, it } from "vitest";

import {
  canonicalDigest,
  createJsonSchemaInputValidator,
  createWorkflowApprovalDecisionPort,
} from "../src/application-adapters.js";

describe("application canonical digest", () => {
  it("uses the runtime canonical JSON authority for execution facts", () => {
    const executionPlan = {
      schemaVersion: 1,
      workflowRevision: {
        id: "01K00000000000000000000000",
        canonicalDigest: `sha256:${"a".repeat(64)}`,
      },
      topology: {
        schemaVersion: 1,
        key: "image_palette_extract",
        entryNodeKey: "extract",
        nodes: [],
        outputs: {},
      },
      routes: {
        extract: {
          candidates: [],
          contractRevisionId: "01K00000000000000000000001",
        },
      },
    };

    expect(canonicalDigest.of(executionPlan)).toBe(
      digestProviderValue(executionPlan),
    );
  });

  it("accepts valid conditional JSON Schemas without strictTypes annotations", () => {
    const validator = createJsonSchemaInputValidator();
    const schema = {
      type: "object",
      required: ["background"],
      properties: {
        background: {
          type: "object",
        },
      },
      allOf: [
        {
          if: {
            properties: {
              background: {
                properties: {
                  kind: {
                    const: "artifact",
                  },
                },
              },
            },
          },
          then: {
            properties: {
              background: {
                required: ["artifactId"],
              },
            },
          },
        },
      ],
    };

    expect(
      validator.validate(schema, {
        background: {
          kind: "color",
          color: "#FFFFFFFF",
        },
      }),
    ).toEqual([]);
  });

  it("accepts Provider invocation annotation keywords without weakening validation", () => {
    const validator = createJsonSchemaInputValidator();
    const schema = {
      type: "object",
      additionalProperties: false,
      "x-kanvas-provider-model-operation": "image.generate",
      "x-kanvas-provider-parameter-keys": ["quality"],
      required: ["prompt"],
      properties: {
        prompt: {
          type: "string",
          minLength: 1,
        },
        quality: {
          type: "string",
          enum: ["low"],
        },
      },
    };

    expect(
      validator.validate(schema, {
        prompt: "A blue circle",
        quality: "low",
      }),
    ).toEqual([]);
    expect(
      validator.validate(schema, {
        prompt: "A blue circle",
        quality: "high",
      }),
    ).not.toEqual([]);
  });

  it("accepts governed capability and authoring annotations", () => {
    const validator = createJsonSchemaInputValidator();
    const schema = {
      type: "object",
      additionalProperties: false,
      required: ["sourceArtifactId"],
      properties: {
        sourceArtifactId: {
          type: "string",
          pattern: "^[0-7][0-9A-HJKMNP-TV-Z]{25}$",
          "x-kanvas-semantic-type": "artifact.image",
          "x-kanvas-file": { categories: ["image"] },
          "x-kanvas-ui": { placeholder: "Choose an image" },
        },
      },
    };

    expect(
      validator.validate(schema, {
        sourceArtifactId: "01K00000000000000000000000",
      }),
    ).toEqual([]);
  });
});

describe("Workflow Approval decision adapter", () => {
  it("maps pinned-schema rejection before an immutable decision is exposed", async () => {
    const port = createWorkflowApprovalDecisionPort({
      decideApproval: () =>
        Promise.reject(
          new BoundedWorkflowRuntimeError(
            "workflow.v1.approval_decision_invalid",
            "invalid",
          ),
        ),
    } as unknown as BoundedWorkflowOrchestratorStore);

    await expect(port.decide({} as never)).rejects.toMatchObject({
      code: "workflow_approval.decision_invalid",
    });
  });
});
