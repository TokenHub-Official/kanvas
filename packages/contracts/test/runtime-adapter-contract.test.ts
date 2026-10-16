import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import { RuntimeAdapterDefinitionRevisionSchema } from "../src/capability/index.js";

describe("runtime adapter definition contract", () => {
  it("describes an immutable executable without capability-specific identity", () => {
    const validate = new Ajv2020({ strict: true, allErrors: true }).compile(
      RuntimeAdapterDefinitionRevisionSchema,
    );
    expect(
      validate({
        schemaVersion: "kanvas.runtime-adapter-definition/v1",
        adapterKey: "kanvas.image.resize.sharp",
        revision: 1,
        displayName: {
          defaultLocale: "en-US",
          values: {
            "en-US": "Sharp image resize",
            "zh-CN": "Sharp 图片缩放",
          },
        },
        executionTarget: "worker",
        sourceKinds: ["plugin"],
        supportedModelFormats: [],
        invocationInputSchema: { type: "object" },
        invocationOutputSchema: { type: "object" },
        configurationSchema: { type: "object" },
        artifactInputs: [
          {
            role: "source",
            pointer: "/artifactId",
            required: true,
            mediaTypes: ["image/png", "image/jpeg", "image/webp"],
          },
        ],
        executable: {
          kind: "built_in",
          packageKey: "kanvas.image-processing",
          packageVersion: "1.0.0",
          entrypoint: "sharp.resize",
          releaseDigest: `sha256:${"1".repeat(64)}`,
        },
      }),
    ).toBe(true);
  });

  it("rejects source kinds without a governed resolver", () => {
    const validate = new Ajv2020({ strict: true, allErrors: true }).compile(
      RuntimeAdapterDefinitionRevisionSchema,
    );
    const adapter = {
      schemaVersion: "kanvas.runtime-adapter-definition/v1",
      adapterKey: "kanvas.workflow.invoke",
      revision: 1,
      displayName: {
        defaultLocale: "en-US",
        values: { "en-US": "Workflow", "zh-CN": "工作流" },
      },
      executionTarget: "worker",
      supportedModelFormats: [],
      invocationInputSchema: { type: "object" },
      invocationOutputSchema: { type: "object" },
      configurationSchema: { type: "object" },
      artifactInputs: [],
      executable: {
        kind: "built_in",
        packageKey: "kanvas.workflow-runtime",
        packageVersion: "1.0.0",
        entrypoint: "workflow.invoke",
        releaseDigest: `sha256:${"1".repeat(64)}`,
      },
    };
    expect(validate({ ...adapter, sourceKinds: ["workflow"] })).toBe(false);
    expect(validate({ ...adapter, sourceKinds: ["api"] })).toBe(false);
    expect(validate({ ...adapter, sourceKinds: ["mcp"] })).toBe(false);
  });
});
