import { validateWorkflowTopology } from "@kanvas/application";
import { isWorkflowTopology } from "@kanvas/contracts/workflow";
import { describe, expect, it } from "vitest";

import {
  brandSocialStarterWorkflowDescriptor,
  layersSeparateWorkflowDescriptor,
  posterComposeSubjectWorkflowDescriptor,
  posterGenerateCompleteWorkflowDescriptor,
  posterGenerateSimpleWorkflowDescriptor,
  textRemoveWorkflowDescriptor,
} from "../src/cli/bootstrap-image-composition-workflows.js";
import { loadImageCompositionWorkflowSeed } from "../src/cli/bootstrap-image-composition-workflow.js";

describe("image composition Workflow packs", () => {
  it.each([
    [
      textRemoveWorkflowDescriptor,
      ["image.text.extract", "image.object.remove"],
    ],
    [
      layersSeparateWorkflowDescriptor,
      ["image.subject.detect", "image.background.remove", "image.text.extract"],
    ],
    [posterGenerateSimpleWorkflowDescriptor, ["image.generate"]],
    [brandSocialStarterWorkflowDescriptor, ["image.background.compose"]],
    [
      posterGenerateCompleteWorkflowDescriptor,
      ["image.generate", "image.edit"],
    ],
    [
      posterComposeSubjectWorkflowDescriptor,
      ["image.generate", "image.background.remove", "image.background.compose"],
    ],
  ])(
    "loads %s without defining a duplicate compute Capability",
    async (descriptor, contractIds) => {
      const seed = await loadImageCompositionWorkflowSeed(descriptor);

      expect(seed.manifest).toMatchObject({
        skillKey: descriptor.scenarioKey,
        nonProduction: false,
      });
      expect(
        seed.requiredCapabilities.map(({ contractId }) => contractId),
      ).toEqual(contractIds);
      expect(seed.topology).toMatchObject({
        key: descriptor.workflowKey,
      });
      if (!isWorkflowTopology(seed.topology)) {
        throw new TypeError("Scenario pack topology is invalid.");
      }
      expect(
        validateWorkflowTopology({
          topology: seed.topology,
        }),
      ).toMatchObject({ valid: true, diagnostics: [] });
      expect(seed.workflowDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    },
  );

  it("publishes the complete poster branch with one typed result selection", async () => {
    const seed = await loadImageCompositionWorkflowSeed(
      posterGenerateCompleteWorkflowDescriptor,
    );
    if (
      !isWorkflowTopology(seed.topology) ||
      seed.topology.schemaVersion !== 1
    ) {
      throw new TypeError("Complete poster topology is invalid.");
    }
    expect(seed.topology.outputs.resultImageArtifactId?.value).toEqual({
      $coalesce: [
        {
          $value: {
            source: "node_output",
            nodeKey: "generate_without_reference",
            scope: "root",
            pointer: "/imageArtifactId",
          },
        },
        {
          $value: {
            source: "node_output",
            nodeKey: "edit_from_reference",
            scope: "root",
            pointer: "/imageArtifactId",
          },
        },
      ],
    });
  });
});
