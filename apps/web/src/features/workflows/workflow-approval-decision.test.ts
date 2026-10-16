import { describe, expect, it } from "vitest";

import {
  workflowApprovalDecisionFingerprint,
  workflowApprovalDecisionForm,
  workflowApprovalDecisionValue,
} from "./workflow-approval-decision.js";

describe("Workflow Approval decision form", () => {
  it("recognizes the standard authored approve/reject schema", () => {
    expect(
      workflowApprovalDecisionForm({
        type: "object",
        additionalProperties: false,
        properties: { approved: { type: "boolean" } },
        required: ["approved"],
      }),
    ).toEqual({ kind: "standard_boolean" });
  });

  it("projects a flat scalar form and preserves native JSON values", () => {
    const form = workflowApprovalDecisionForm({
      type: "object",
      properties: {
        rating: { type: "integer", title: "Rating" },
        outcome: {
          type: "string",
          title: "Outcome",
          enum: ["accept", "revise"],
        },
      },
      required: ["outcome"],
    });
    expect(form.kind).toBe("flat");
    if (form.kind !== "flat") return;
    expect(
      workflowApprovalDecisionValue(form, {
        rating: 4,
        outcome: "revise",
      }),
    ).toEqual({ rating: 4, outcome: "revise" });
  });

  it.each([
    {
      type: "object",
      properties: { choice: { oneOf: [{ type: "string" }] } },
    },
    {
      type: "object",
      properties: { nested: { type: "object", properties: {} } },
    },
    {
      type: "object",
      properties: { mixed: { type: "string", enum: ["yes", false] } },
    },
    {
      type: "object",
      properties: { known: { type: "string" } },
      required: ["missing"],
    },
    {
      type: "object",
      properties: { approved: { type: "boolean", const: true } },
      required: ["approved"],
    },
    {
      type: "object",
      properties: { approved: { $ref: "#/$defs/decision" } },
      required: ["approved"],
    },
    {
      type: "object",
      properties: { rating: { type: "number", minimum: 1 } },
    },
    {
      type: "object",
      properties: { known: { type: "string" } },
      required: ["known", false],
    },
  ])("rejects a schema that cannot be represented honestly", (schema) => {
    expect(workflowApprovalDecisionForm(schema)).toEqual({
      kind: "unsupported",
    });
  });

  it("fingerprints field order deterministically for decision retries", () => {
    expect(workflowApprovalDecisionFingerprint({ b: false, a: "ok" })).toBe(
      workflowApprovalDecisionFingerprint({ a: "ok", b: false }),
    );
  });
});
