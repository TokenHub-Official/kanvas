import { describe, expect, it } from "vitest";

import {
  CanvasOperationRegistry,
  createCanvasCoreOperationRegistry,
  projectCanvasOperationsV1,
  workspaceCanvasOperationDefinitionsV1,
} from "./canvas-operation-registry.js";

describe("Canvas Core V1 operation registry", () => {
  const coreRegistry = () =>
    createCanvasCoreOperationRegistry({ crop: "Crop", resize: "Resize" });

  it("keeps only intrinsic editor commands in the static registry", () => {
    const definitions = coreRegistry().list();

    expect(
      new Set(definitions.map((definition) => definition.category)),
    ).toEqual(new Set(["layout"]));
    expect(definitions.map((definition) => definition.id)).toEqual([
      "canvas.image.crop",
      "canvas.image.resize",
    ]);
  });

  it("does not fabricate routed operations before Catalog discovery", () => {
    const definitions = coreRegistry().list();

    expect(
      definitions.find((definition) => definition.id === "canvas.image.crop")
        ?.execution,
    ).toBe("editor_command");
    expect(
      definitions.every((definition) => definition.category === "layout"),
    ).toBe(true);
  });

  it("requires every operation to declare input and output contracts", () => {
    for (const definition of coreRegistry().list()) {
      expect(definition.parametersSchemaId).not.toBe("");
      expect(definition.input.maximum).toBeGreaterThanOrEqual(
        definition.input.minimum,
      );
      expect(definition.outputModes.length).toBeGreaterThan(0);
      if (definition.availability.status === "unavailable") {
        expect(definition.availability.reason).not.toBe("");
      }
    }
  });

  it("only marks commands backed by a production interaction as available", () => {
    const availableIds = coreRegistry()
      .list()
      .filter((definition) => definition.availability.status === "available")
      .map((definition) => definition.id);

    expect(availableIds).toEqual(["canvas.image.crop", "canvas.image.resize"]);
  });

  it("projects executable and selection-bound intrinsic states", () => {
    const registry = coreRegistry();

    const imageProjection = projectCanvasOperationsV1(registry.list(), [
      "image",
    ]);
    expect(
      imageProjection.find((item) => item.definition.id === "canvas.image.crop")
        ?.status,
    ).toBe("available");
    const emptyProjection = projectCanvasOperationsV1(registry.list(), []);
    expect(
      emptyProjection.find(
        (item) => item.definition.id === "canvas.image.resize",
      )?.status,
    ).toBe("needs_selection");
  });

  it("rejects duplicate operation identities", () => {
    const registry = new CanvasOperationRegistry();
    const definition = {
      id: "image.test",
      label: "测试",
      availability: {
        status: "available" as const,
      },
      category: "enhance" as const,
      execution: "routed" as const,
      input: {
        minimum: 1,
        maximum: 1,
        nodeKinds: ["image" as const],
      },
      outputModes: ["add_node" as const],
      parametersSchemaId: "kanvas.image-test.v1",
    };

    registry.register(definition);

    expect(() => {
      registry.register(definition);
    }).toThrow("Canvas operation image.test is already registered.");
  });

  it("creates a routed operation only from a published Workspace tool", () => {
    const definitions = workspaceCanvasOperationDefinitionsV1(
      coreRegistry().list(),
      [
        {
          capabilityKey: "image.background.remove",
          category: "图像处理",
          completionBehavior: "review_required",
          interactionBehavior: "form",
          id: "01K00000000000000000000021:remove",
          operationId: "image.background.remove",
          label: "团队去背景",
          order: 10,
          outputArtifactPath: ["result", "foregroundArtifactId"],
          outputModes: ["add_node", "replace_content"],
          parameterFields: [],
          parametersSchemaId: "kanvas.image-background-remove.v1",
          sourceParameterKey: "source",
          sourceValue: "artifact_id",
          contractRevisionId: "01K00000000000000000000022",
        },
      ],
    );
    const backgroundRemoval = definitions.find(
      (definition) => definition.id === "image.background.remove",
    );

    expect(backgroundRemoval).toMatchObject({
      label: "团队去背景",
      category: "图像处理",
      availability: {
        status: "available",
      },
      execution: "routed",
      outputModes: ["add_node", "replace_content"],
      parametersSchemaId: "kanvas.image-background-remove.v1",
    });
  });
});
