import { describe, expect, it } from "vitest";

import {
  localizeEffectiveInvocationFields,
  workflowCapabilityOutput,
  workflowInputSemanticType,
  workflowSemanticTypesCompatible,
} from "./workflow-capability-authoring-profile-v1.js";

describe("workflow capability authoring profile", () => {
  it("reads output semantics from the server declaration", () => {
    const capability = {
      authoring: {
        outputs: [
          {
            key: "foregroundArtifactId",
            semanticType: "artifact.foreground",
          },
        ],
      },
    };
    expect(
      workflowCapabilityOutput(capability as never, "foregroundArtifactId"),
    ).toMatchObject({ semanticType: "artifact.foreground" });
  });

  it("does not allow a normal image where a mask is required", () => {
    expect(
      workflowSemanticTypesCompatible("artifact.mask", "artifact.image"),
    ).toBe(false);
    expect(
      workflowSemanticTypesCompatible("artifact.mask", "artifact.mask"),
    ).toBe(true);
    expect(
      workflowSemanticTypesCompatible("artifact.image", "artifact.foreground"),
    ).toBe(true);
  });

  it("infers image semantics from the canonical Artifact ID schema", () => {
    expect(
      workflowInputSemanticType({
        type: "string",
        pattern: "^[0-7][0-9A-HJKMNP-TV-Z]{25}$",
      }),
    ).toBe("artifact.image");
  });

  it("uses localized capability labels for public invocation fields", () => {
    expect(
      localizeEffectiveInvocationFields(
        [
          {
            key: "sourceArtifactId",
            label: "sourceArtifactId",
            required: true,
            valueType: "artifact",
          },
        ],
        {
          authoring: {
            parameters: [
              {
                key: "sourceArtifactId",
                label: { "zh-CN": "源图片", "en-US": "Source image" },
                description: {
                  "zh-CN": "选择需要处理的图片。",
                  "en-US": "Choose the image to process.",
                },
              },
            ],
          },
        } as never,
        "zh-CN",
      ),
    ).toEqual([
      {
        key: "sourceArtifactId",
        label: "源图片",
        description: "选择需要处理的图片。",
        required: true,
        valueType: "artifact",
      },
    ]);
  });
});
