import type { EditorNodeKindV1 } from "@kanvas/contracts/editor";
import type { CanvasImageCapabilityTool } from "./canvas-capability-tools.js";

export type CanvasOperationCategory = string;

export type CanvasOperationExecution =
  "browser_preferred" | "editor_command" | "remote_required" | "routed";

export type CanvasOperationOutputMode =
  | "add_node"
  | "asset_only"
  | "fill_container"
  | "replace_content"
  | "set_background";

export type CanvasOperationAvailability =
  | {
      readonly status: "available";
    }
  | {
      readonly reason: string;
      readonly status: "unavailable";
    };

export interface CanvasOperationInput {
  readonly maximum: number;
  readonly minimum: number;
  readonly nodeKinds: readonly EditorNodeKindV1[];
}

export interface CanvasOperationDefinitionV1 {
  readonly availability: CanvasOperationAvailability;
  readonly category: CanvasOperationCategory;
  readonly execution: CanvasOperationExecution;
  readonly id: string;
  readonly input: CanvasOperationInput;
  readonly label: string;
  readonly outputModes: readonly CanvasOperationOutputMode[];
  readonly parametersSchemaId: string;
}

export interface CanvasOperationProjectionV1 {
  readonly compatible: boolean;
  readonly definition: CanvasOperationDefinitionV1;
  readonly status: "available" | "needs_selection" | "unavailable";
}

export class CanvasOperationRegistry {
  readonly #definitions = new Map<string, CanvasOperationDefinitionV1>();

  public register(definition: CanvasOperationDefinitionV1): () => void {
    if (this.#definitions.has(definition.id)) {
      throw new Error(
        `Canvas operation ${definition.id} is already registered.`,
      );
    }
    if (
      definition.input.minimum < 0 ||
      definition.input.maximum < definition.input.minimum
    ) {
      throw new Error(
        `Canvas operation ${definition.id} has an invalid input range.`,
      );
    }
    if (definition.outputModes.length === 0) {
      throw new Error(
        `Canvas operation ${definition.id} must declare an output mode.`,
      );
    }
    this.#definitions.set(definition.id, Object.freeze(definition));
    return () => {
      this.#definitions.delete(definition.id);
    };
  }

  public list(): readonly CanvasOperationDefinitionV1[] {
    return Object.freeze([...this.#definitions.values()]);
  }
}

const imageInput = {
  minimum: 1,
  maximum: 1,
  nodeKinds: ["image"] as const,
};

function operation(
  definition: CanvasOperationDefinitionV1,
): CanvasOperationDefinitionV1 {
  return definition;
}

const available = {
  status: "available",
} as const satisfies CanvasOperationAvailability;

export function createCanvasCoreOperationRegistry(labels: {
  readonly crop: string;
  readonly resize: string;
}): CanvasOperationRegistry {
  const registry = new CanvasOperationRegistry();
  for (const definition of [
    operation({
      id: "canvas.image.crop",
      label: labels.crop,
      availability: available,
      category: "layout",
      execution: "editor_command",
      input: imageInput,
      outputModes: ["replace_content"],
      parametersSchemaId: "kanvas.canvas-image-crop.v1",
    }),
    operation({
      id: "canvas.image.resize",
      label: labels.resize,
      availability: available,
      category: "layout",
      execution: "browser_preferred",
      input: imageInput,
      outputModes: ["add_node", "replace_content", "asset_only"],
      parametersSchemaId: "kanvas.canvas-image-resize.v1",
    }),
  ]) {
    registry.register(definition);
  }
  return registry;
}

export function workspaceCanvasOperationDefinitionsV1(
  core: readonly CanvasOperationDefinitionV1[],
  capabilityTools: readonly CanvasImageCapabilityTool[],
): readonly CanvasOperationDefinitionV1[] {
  const definitions = new Map(
    core.map((definition) => [definition.id, definition]),
  );
  for (const tool of capabilityTools) {
    const existing = definitions.get(tool.operationId);
    definitions.set(
      tool.operationId,
      Object.freeze({
        id: tool.operationId,
        label: tool.label,
        availability: available,
        category: tool.category,
        execution: existing?.execution ?? "routed",
        input: existing?.input ?? {
          minimum: 1,
          maximum: 1,
          nodeKinds: ["image"] as const,
        },
        outputModes: tool.outputModes,
        parametersSchemaId: tool.parametersSchemaId,
      }),
    );
  }
  return Object.freeze([...definitions.values()]);
}

export function projectCanvasOperationsV1(
  definitions: readonly CanvasOperationDefinitionV1[],
  selectedKinds: readonly EditorNodeKindV1[],
): readonly CanvasOperationProjectionV1[] {
  return definitions.map((definition) => {
    const compatible =
      selectedKinds.length >= definition.input.minimum &&
      selectedKinds.length <= definition.input.maximum &&
      selectedKinds.every((kind) => definition.input.nodeKinds.includes(kind));
    let status: CanvasOperationProjectionV1["status"] = "needs_selection";
    if (definition.availability.status === "unavailable") {
      status = "unavailable";
    } else if (compatible) {
      status = "available";
    }
    return {
      compatible,
      definition,
      status,
    };
  });
}
