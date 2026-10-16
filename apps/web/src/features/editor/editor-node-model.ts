import type { EditorNodeKindV1 } from "@kanvas/contracts/editor";

export const editorNodeKinds = [
  "image",
  "text",
  "shape",
  "line",
  "graphic",
  "frame",
  "grid",
  "group",
] as const satisfies readonly EditorNodeKindV1[];

export type EditorNodeCommandId =
  | "adjust_image"
  | "blend_mode"
  | "copy"
  | "crop"
  | "delete"
  | "duplicate"
  | "edit_frame_content"
  | "edit_grid"
  | "edit_group"
  | "edit_internal_text"
  | "edit_line_path"
  | "edit_shape_parameters"
  | "edit_text"
  | "fill"
  | "filter"
  | "group"
  | "layer"
  | "lock"
  | "mask"
  | "move"
  | "opacity"
  | "recolor_graphic"
  | "rename"
  | "replace_content"
  | "resize"
  | "rotate"
  | "run_image_tool"
  | "select"
  | "set_as_background"
  | "shadow"
  | "stroke"
  | "text_effects"
  | "typography"
  | "ungroup"
  | "visibility";

export type EditorNodeResizeBehavior =
  | "container_crop"
  | "endpoints"
  | "group_children"
  | "layout"
  | "parametric"
  | "preserve_aspect"
  | "scale_or_crop"
  | "text_box";

export type EditorNodeCreationSource =
  | "artifact"
  | "brand"
  | "catalog"
  | "clipboard"
  | "generated_result"
  | "local_file"
  | "preset"
  | "template";

export interface EditorNodeDefinition {
  readonly addable: boolean;
  readonly commands: readonly EditorNodeCommandId[];
  readonly creationSources: readonly EditorNodeCreationSource[];
  readonly kind: EditorNodeKindV1;
  readonly label: string;
  readonly resizeBehavior: EditorNodeResizeBehavior;
}

const commonCommands = [
  "select",
  "move",
  "resize",
  "rotate",
  "copy",
  "duplicate",
  "delete",
  "opacity",
  "blend_mode",
  "layer",
  "visibility",
  "lock",
  "rename",
  "group",
] as const satisfies readonly EditorNodeCommandId[];

export const editorNodeDefinitions = {
  image: {
    kind: "image",
    label: "图片",
    addable: true,
    resizeBehavior: "scale_or_crop",
    creationSources: [
      "local_file",
      "clipboard",
      "artifact",
      "brand",
      "generated_result",
      "template",
    ],
    commands: [
      ...commonCommands,
      "crop",
      "replace_content",
      "adjust_image",
      "filter",
      "shadow",
      "mask",
      "run_image_tool",
      "set_as_background",
    ],
  },
  text: {
    kind: "text",
    label: "文字",
    addable: true,
    resizeBehavior: "text_box",
    creationSources: ["clipboard", "preset", "brand", "template"],
    commands: [
      ...commonCommands,
      "edit_text",
      "typography",
      "fill",
      "stroke",
      "shadow",
      "text_effects",
    ],
  },
  shape: {
    kind: "shape",
    label: "形状",
    addable: true,
    resizeBehavior: "parametric",
    creationSources: ["catalog", "brand", "template"],
    commands: [
      ...commonCommands,
      "edit_shape_parameters",
      "fill",
      "stroke",
      "edit_internal_text",
    ],
  },
  line: {
    kind: "line",
    label: "线条",
    addable: true,
    resizeBehavior: "endpoints",
    creationSources: ["catalog", "brand", "template"],
    commands: [...commonCommands, "edit_line_path", "stroke"],
  },
  graphic: {
    kind: "graphic",
    label: "矢量素材",
    addable: true,
    resizeBehavior: "preserve_aspect",
    creationSources: ["artifact", "brand", "catalog", "template"],
    commands: [
      ...commonCommands,
      "replace_content",
      "recolor_graphic",
      "shadow",
    ],
  },
  frame: {
    kind: "frame",
    label: "画框",
    addable: true,
    resizeBehavior: "container_crop",
    creationSources: ["catalog", "brand", "template"],
    commands: [
      ...commonCommands,
      "edit_frame_content",
      "replace_content",
      "fill",
      "stroke",
    ],
  },
  grid: {
    kind: "grid",
    label: "网格",
    addable: true,
    resizeBehavior: "layout",
    creationSources: ["catalog", "brand", "template"],
    commands: [...commonCommands, "edit_grid", "replace_content"],
  },
  group: {
    kind: "group",
    label: "组合",
    addable: false,
    resizeBehavior: "group_children",
    creationSources: ["template"],
    commands: [...commonCommands, "edit_group", "ungroup"],
  },
} as const satisfies Record<EditorNodeKindV1, EditorNodeDefinition>;

export function editorNodeDefinition(
  kind: EditorNodeKindV1,
): EditorNodeDefinition {
  return editorNodeDefinitions[kind];
}

export function editorNodeSupportsCommand(
  kind: EditorNodeKindV1,
  command: EditorNodeCommandId,
): boolean {
  return editorNodeDefinitions[kind].commands.some(
    (candidate) => candidate === command,
  );
}
