import type { EditorNodeKindV1 } from "@kanvas/contracts/editor";

export type CanvasLeftRailId =
  "brand" | "design" | "materials" | "text" | "tools";

export type CanvasLeftRailScope =
  | "content_discovery"
  | "content_ingest"
  | "operation_discovery"
  | "page_styling";

export interface CanvasLeftRailDefinition {
  readonly id: CanvasLeftRailId;
  readonly nodeKinds: readonly EditorNodeKindV1[];
  readonly scope: CanvasLeftRailScope;
}

export const canvasLeftRailDefinitions = [
  {
    id: "design",
    scope: "page_styling",
    nodeKinds: [
      "image",
      "text",
      "shape",
      "line",
      "graphic",
      "frame",
      "grid",
      "group",
    ],
  },
  {
    id: "materials",
    scope: "content_discovery",
    nodeKinds: ["image", "shape", "line", "graphic", "frame", "grid"],
  },
  {
    id: "text",
    scope: "content_discovery",
    nodeKinds: ["text"],
  },
  {
    id: "brand",
    scope: "content_discovery",
    nodeKinds: ["image", "text", "shape", "line", "graphic", "frame", "grid"],
  },
  {
    id: "tools",
    scope: "operation_discovery",
    nodeKinds: ["shape", "line", "text"],
  },
] as const satisfies readonly CanvasLeftRailDefinition[];

const definitions = new Map(
  canvasLeftRailDefinitions.map((definition) => [definition.id, definition]),
);

export function canvasLeftRailDefinition(
  id: CanvasLeftRailId,
): CanvasLeftRailDefinition {
  const definition = definitions.get(id);
  if (!definition) {
    throw new Error(`Unknown Canvas left rail item: ${id}.`);
  }
  return definition;
}
