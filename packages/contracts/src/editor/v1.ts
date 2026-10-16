import { Type, type Static } from "@sinclair/typebox";

import { UlidSchema } from "../primitives/index.js";

const EditorNodeIdV1Schema = Type.String({
  minLength: 1,
  maxLength: 160,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$",
});

const FiniteCoordinateV1Schema = Type.Number({
  minimum: -10_000_000,
  maximum: 10_000_000,
});

const PositiveDimensionV1Schema = Type.Number({
  exclusiveMinimum: 0,
  maximum: 32_768,
});

const UnitIntervalV1Schema = Type.Number({
  minimum: 0,
  maximum: 1,
});

const CssColorV1Schema = Type.String({
  minLength: 1,
  maxLength: 120,
});

const CatalogIdV1Schema = Type.String({
  minLength: 1,
  maxLength: 160,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$",
});

export const EditorCatalogReferenceV1Schema = Type.Object(
  {
    catalogId: CatalogIdV1Schema,
    definitionId: CatalogIdV1Schema,
    revision: Type.String({ minLength: 1, maxLength: 120 }),
  },
  { additionalProperties: false },
);

export const EditorArtifactReferenceV1Schema = Type.Object(
  {
    kind: Type.Literal("artifact"),
    artifactId: UlidSchema,
    assetId: Type.Optional(UlidSchema),
  },
  { additionalProperties: false },
);

export const EditorPaintV1Schema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal("none"),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("solid"),
      color: CssColorV1Schema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("linear_gradient"),
      angle: Type.Number({ minimum: -360_000, maximum: 360_000 }),
      stops: Type.Array(
        Type.Object(
          {
            color: CssColorV1Schema,
            offset: UnitIntervalV1Schema,
          },
          { additionalProperties: false },
        ),
        { minItems: 2, maxItems: 16 },
      ),
    },
    { additionalProperties: false },
  ),
]);

export const EditorStrokeV1Schema = Type.Object(
  {
    paint: EditorPaintV1Schema,
    width: Type.Number({ minimum: 0, maximum: 1_024 }),
    alignment: Type.Union([
      Type.Literal("inside"),
      Type.Literal("center"),
      Type.Literal("outside"),
    ]),
    dash: Type.Optional(
      Type.Array(Type.Number({ minimum: 0, maximum: 4_096 }), {
        maxItems: 32,
      }),
    ),
  },
  { additionalProperties: false },
);

export const EditorTransformV1Schema = Type.Object(
  {
    x: FiniteCoordinateV1Schema,
    y: FiniteCoordinateV1Schema,
    width: PositiveDimensionV1Schema,
    height: PositiveDimensionV1Schema,
    rotation: Type.Number({ minimum: -360_000, maximum: 360_000 }),
    flipX: Type.Boolean(),
    flipY: Type.Boolean(),
  },
  { additionalProperties: false },
);

const EditorNodeBaseV1 = {
  id: EditorNodeIdV1Schema,
  name: Type.String({ minLength: 1, maxLength: 240 }),
  transform: EditorTransformV1Schema,
  opacity: UnitIntervalV1Schema,
  blendMode: Type.Union([
    Type.Literal("normal"),
    Type.Literal("multiply"),
    Type.Literal("screen"),
    Type.Literal("overlay"),
    Type.Literal("darken"),
    Type.Literal("lighten"),
    Type.Literal("color_dodge"),
    Type.Literal("color_burn"),
    Type.Literal("hard_light"),
    Type.Literal("soft_light"),
    Type.Literal("difference"),
    Type.Literal("exclusion"),
    Type.Literal("hue"),
    Type.Literal("saturation"),
    Type.Literal("color"),
    Type.Literal("luminosity"),
  ]),
  visible: Type.Boolean(),
  locked: Type.Boolean(),
} as const;

const EditorCropV1Schema = Type.Object(
  {
    x: UnitIntervalV1Schema,
    y: UnitIntervalV1Schema,
    width: UnitIntervalV1Schema,
    height: UnitIntervalV1Schema,
  },
  { additionalProperties: false },
);

const EditorImageAdjustmentsV1Schema = Type.Object(
  {
    brightness: Type.Number({ minimum: -1, maximum: 1 }),
    contrast: Type.Number({ minimum: -1, maximum: 1 }),
    saturation: Type.Number({ minimum: -1, maximum: 1 }),
    temperature: Type.Number({ minimum: -1, maximum: 1 }),
    tint: Type.Number({ minimum: -1, maximum: 1 }),
    highlights: Type.Number({ minimum: -1, maximum: 1 }),
    shadows: Type.Number({ minimum: -1, maximum: 1 }),
    blur: Type.Number({ minimum: 0, maximum: 100 }),
    vignette: UnitIntervalV1Schema,
    grayscale: UnitIntervalV1Schema,
    sepia: UnitIntervalV1Schema,
  },
  { additionalProperties: false },
);

const EditorImageFilterV1Schema = Type.Object(
  {
    definition: EditorCatalogReferenceV1Schema,
    intensity: Type.Number({ minimum: -2, maximum: 2 }),
    parameters: Type.Optional(
      Type.Record(
        Type.String({
          minLength: 1,
          maxLength: 80,
          pattern: "^[A-Za-z][A-Za-z0-9._-]*$",
        }),
        Type.Union([
          Type.Boolean(),
          Type.Number({
            minimum: -1_000_000,
            maximum: 1_000_000,
          }),
          Type.String({ maxLength: 240 }),
        ]),
        { maxProperties: 64 },
      ),
    ),
  },
  { additionalProperties: false },
);

const EditorShadowV1Schema = Type.Object(
  {
    color: CssColorV1Schema,
    blur: Type.Number({ minimum: 0, maximum: 512 }),
    offsetX: Type.Number({ minimum: -2_048, maximum: 2_048 }),
    offsetY: Type.Number({ minimum: -2_048, maximum: 2_048 }),
    opacity: UnitIntervalV1Schema,
  },
  { additionalProperties: false },
);

export const EditorPlacedImageV1Schema = Type.Object(
  {
    source: EditorArtifactReferenceV1Schema,
    intrinsicWidth: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 262_144 }),
    ),
    intrinsicHeight: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 262_144 }),
    ),
    mediaType: Type.Optional(
      Type.Union([
        Type.Literal("image/jpeg"),
        Type.Literal("image/png"),
        Type.Literal("image/webp"),
      ]),
    ),
    crop: EditorCropV1Schema,
    fit: Type.Union([
      Type.Literal("contain"),
      Type.Literal("cover"),
      Type.Literal("fill"),
    ]),
    focalPoint: Type.Object(
      {
        x: UnitIntervalV1Schema,
        y: UnitIntervalV1Schema,
      },
      { additionalProperties: false },
    ),
    adjustments: Type.Optional(EditorImageAdjustmentsV1Schema),
    filters: Type.Optional(
      Type.Array(EditorImageFilterV1Schema, { maxItems: 32 }),
    ),
  },
  { additionalProperties: false },
);

const EditorFontReferenceV1Schema = Type.Object(
  {
    source: Type.Union([
      Type.Literal("builtin"),
      Type.Literal("system"),
      Type.Literal("workspace"),
      Type.Literal("brand"),
    ]),
    fontId: Type.String({ minLength: 1, maxLength: 200 }),
    family: Type.String({ minLength: 1, maxLength: 200 }),
    revision: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
  },
  { additionalProperties: false },
);

const EditorTextRunV1Schema = Type.Object(
  {
    text: Type.String({ maxLength: 20_000 }),
    font: EditorFontReferenceV1Schema,
    fontSize: Type.Number({ exclusiveMinimum: 0, maximum: 2_048 }),
    fontWeight: Type.Integer({ minimum: 100, maximum: 1_000 }),
    fontStyle: Type.Union([Type.Literal("normal"), Type.Literal("italic")]),
    letterSpacing: Type.Number({ minimum: -200, maximum: 2_000 }),
    fill: EditorPaintV1Schema,
    decoration: Type.Object(
      {
        underline: Type.Boolean(),
        strikeThrough: Type.Boolean(),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

const EditorTextParagraphV1Schema = Type.Object(
  {
    align: Type.Union([
      Type.Literal("left"),
      Type.Literal("center"),
      Type.Literal("right"),
      Type.Literal("justify"),
    ]),
    direction: Type.Union([
      Type.Literal("auto"),
      Type.Literal("ltr"),
      Type.Literal("rtl"),
    ]),
    lineHeight: Type.Number({ minimum: 0.5, maximum: 10 }),
    spaceBefore: Type.Number({ minimum: 0, maximum: 4_096 }),
    spaceAfter: Type.Number({ minimum: 0, maximum: 4_096 }),
    runs: Type.Array(EditorTextRunV1Schema, {
      minItems: 1,
      maxItems: 2_000,
    }),
  },
  { additionalProperties: false },
);

export const EditorTextContentV1Schema = Type.Object(
  {
    paragraphs: Type.Array(EditorTextParagraphV1Schema, {
      minItems: 1,
      maxItems: 2_000,
    }),
    verticalAlign: Type.Union([
      Type.Literal("top"),
      Type.Literal("middle"),
      Type.Literal("bottom"),
    ]),
    resizeMode: Type.Union([
      Type.Literal("auto_width"),
      Type.Literal("auto_height"),
      Type.Literal("fixed"),
    ]),
  },
  { additionalProperties: false },
);

export const EditorTextEffectV1Schema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal("outline"),
      color: CssColorV1Schema,
      width: Type.Number({ minimum: 0, maximum: 256 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("shadow"),
      ...EditorShadowV1Schema.properties,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("background"),
      paint: EditorPaintV1Schema,
      paddingX: Type.Number({ minimum: 0, maximum: 2_048 }),
      paddingY: Type.Number({ minimum: 0, maximum: 2_048 }),
      cornerRadius: Type.Number({ minimum: 0, maximum: 2_048 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("curve"),
      amount: Type.Number({ minimum: -1, maximum: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("glow"),
      color: CssColorV1Schema,
      blur: Type.Number({ minimum: 0, maximum: 512 }),
      opacity: UnitIntervalV1Schema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("hollow"),
      color: CssColorV1Schema,
      width: Type.Number({ minimum: 0, maximum: 256 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("offset_layers"),
      layers: Type.Array(
        Type.Object(
          {
            color: CssColorV1Schema,
            offsetX: Type.Number({ minimum: -2_048, maximum: 2_048 }),
            offsetY: Type.Number({ minimum: -2_048, maximum: 2_048 }),
            opacity: UnitIntervalV1Schema,
          },
          { additionalProperties: false },
        ),
        { minItems: 1, maxItems: 12 },
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("skew"),
      x: Type.Number({ minimum: -80, maximum: 80 }),
      y: Type.Number({ minimum: -80, maximum: 80 }),
    },
    { additionalProperties: false },
  ),
]);

const EditorShapeParameterValueV1Schema = Type.Union([
  Type.Boolean(),
  Type.Number({
    minimum: -1_000_000,
    maximum: 1_000_000,
  }),
  Type.String({ maxLength: 240 }),
]);

const EditorShapeLabelV1Schema = Type.Object(
  {
    content: EditorTextContentV1Schema,
    padding: Type.Object(
      {
        top: Type.Number({ minimum: 0, maximum: 8_192 }),
        right: Type.Number({ minimum: 0, maximum: 8_192 }),
        bottom: Type.Number({ minimum: 0, maximum: 8_192 }),
        left: Type.Number({ minimum: 0, maximum: 8_192 }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

const EditorLinePointV1Schema = Type.Object(
  {
    x: Type.Number({ minimum: -8, maximum: 8 }),
    y: Type.Number({ minimum: -8, maximum: 8 }),
  },
  { additionalProperties: false },
);

const EditorLineBindingV1Schema = Type.Object(
  {
    nodeId: EditorNodeIdV1Schema,
    anchor: Type.Union([
      Type.Literal("top"),
      Type.Literal("right"),
      Type.Literal("bottom"),
      Type.Literal("left"),
    ]),
  },
  { additionalProperties: false },
);

const EditorLineCapV1Schema = Type.Union([
  Type.Literal("none"),
  Type.Literal("arrow"),
  Type.Literal("circle"),
  Type.Literal("diamond"),
  Type.Literal("square"),
  Type.Literal("hollow_circle"),
  Type.Literal("hollow_diamond"),
  Type.Literal("hollow_square"),
  Type.Literal("bar"),
  Type.Literal("triangle"),
]);

const EditorLineRoleV1Schema = Type.Union([
  Type.Literal("design"),
  Type.Literal("freehand"),
]);

const EditorLineCapStyleV1Schema = Type.Union([
  Type.Literal("butt"),
  Type.Literal("round"),
  Type.Literal("square"),
]);

const EditorLineJoinStyleV1Schema = Type.Union([
  Type.Literal("bevel"),
  Type.Literal("miter"),
  Type.Literal("round"),
]);

const EditorGraphicSourceV1Schema = Type.Union([
  EditorArtifactReferenceV1Schema,
  Type.Object(
    {
      kind: Type.Literal("catalog"),
      catalogId: CatalogIdV1Schema,
      resourceId: CatalogIdV1Schema,
      revision: Type.String({ minLength: 1, maxLength: 120 }),
    },
    { additionalProperties: false },
  ),
]);

const EditorFrameContentV1Schema = Type.Object(
  {
    image: EditorPlacedImageV1Schema,
  },
  { additionalProperties: false },
);

const EditorGridCellV1Schema = Type.Object(
  {
    slotId: EditorNodeIdV1Schema,
    content: Type.Optional(EditorFrameContentV1Schema),
  },
  { additionalProperties: false },
);

export const EditorNodeV1Schema = Type.Recursive(
  (Node) =>
    Type.Union([
      Type.Object(
        {
          ...EditorNodeBaseV1,
          kind: Type.Literal("image"),
          image: EditorPlacedImageV1Schema,
          cornerRadius: Type.Number({ minimum: 0, maximum: 16_384 }),
          shadow: Type.Optional(EditorShadowV1Schema),
          mask: Type.Optional(EditorCatalogReferenceV1Schema),
          altText: Type.Optional(Type.String({ maxLength: 2_000 })),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          ...EditorNodeBaseV1,
          kind: Type.Literal("text"),
          content: EditorTextContentV1Schema,
          effects: Type.Array(EditorTextEffectV1Schema, {
            maxItems: 32,
          }),
          preset: Type.Optional(EditorCatalogReferenceV1Schema),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          ...EditorNodeBaseV1,
          kind: Type.Literal("shape"),
          definition: EditorCatalogReferenceV1Schema,
          parameters: Type.Record(
            Type.String({
              minLength: 1,
              maxLength: 80,
              pattern: "^[A-Za-z][A-Za-z0-9._-]*$",
            }),
            EditorShapeParameterValueV1Schema,
            { maxProperties: 128 },
          ),
          fill: EditorPaintV1Schema,
          stroke: EditorStrokeV1Schema,
          label: Type.Optional(EditorShapeLabelV1Schema),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          ...EditorNodeBaseV1,
          kind: Type.Literal("line"),
          pathKind: Type.Union([
            Type.Literal("straight"),
            Type.Literal("polyline"),
            Type.Literal("elbow"),
            Type.Literal("curve"),
          ]),
          points: Type.Array(EditorLinePointV1Schema, {
            minItems: 2,
            maxItems: 256,
          }),
          stroke: EditorStrokeV1Schema,
          startCap: EditorLineCapV1Schema,
          endCap: EditorLineCapV1Schema,
          startBinding: Type.Optional(EditorLineBindingV1Schema),
          endBinding: Type.Optional(EditorLineBindingV1Schema),
          role: Type.Optional(EditorLineRoleV1Schema),
          capStyle: Type.Optional(EditorLineCapStyleV1Schema),
          joinStyle: Type.Optional(EditorLineJoinStyleV1Schema),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          ...EditorNodeBaseV1,
          kind: Type.Literal("graphic"),
          source: EditorGraphicSourceV1Schema,
          colorSlots: Type.Record(
            Type.String({
              minLength: 1,
              maxLength: 80,
              pattern: "^[A-Za-z][A-Za-z0-9._-]*$",
            }),
            CssColorV1Schema,
            { maxProperties: 256 },
          ),
          preserveAspectRatio: Type.Boolean(),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          ...EditorNodeBaseV1,
          kind: Type.Literal("frame"),
          definition: EditorCatalogReferenceV1Schema,
          content: Type.Optional(EditorFrameContentV1Schema),
          fill: EditorPaintV1Schema,
          stroke: EditorStrokeV1Schema,
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          ...EditorNodeBaseV1,
          kind: Type.Literal("grid"),
          definition: EditorCatalogReferenceV1Schema,
          gap: Type.Number({ minimum: 0, maximum: 8_192 }),
          cornerRadius: Type.Number({ minimum: 0, maximum: 8_192 }),
          cells: Type.Array(EditorGridCellV1Schema, {
            minItems: 2,
            maxItems: 256,
          }),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          ...EditorNodeBaseV1,
          kind: Type.Literal("group"),
          children: Type.Array(Node, {
            minItems: 2,
            maxItems: 5_000,
          }),
        },
        { additionalProperties: false },
      ),
    ]),
  {
    $id: "kanvas.editor-node.v1",
  },
);

const EditorPageInsetsV1Schema = Type.Object(
  {
    top: Type.Number({ minimum: 0, maximum: 32_768 }),
    right: Type.Number({ minimum: 0, maximum: 32_768 }),
    bottom: Type.Number({ minimum: 0, maximum: 32_768 }),
    left: Type.Number({ minimum: 0, maximum: 32_768 }),
  },
  { additionalProperties: false },
);

const EditorPageGuideV1Schema = Type.Object(
  {
    id: EditorNodeIdV1Schema,
    axis: Type.Union([Type.Literal("horizontal"), Type.Literal("vertical")]),
    position: Type.Number({
      minimum: -32_768,
      maximum: 65_536,
    }),
    locked: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const EditorPageBackgroundV1Schema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal("transparent"),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("paint"),
      paint: EditorPaintV1Schema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("image"),
      image: EditorPlacedImageV1Schema,
      opacity: UnitIntervalV1Schema,
    },
    { additionalProperties: false },
  ),
]);

export const EditorPageV1Schema = Type.Object(
  {
    id: EditorNodeIdV1Schema,
    name: Type.String({ minLength: 1, maxLength: 240 }),
    width: Type.Integer({ minimum: 64, maximum: 32_768 }),
    height: Type.Integer({ minimum: 64, maximum: 32_768 }),
    background: EditorPageBackgroundV1Schema,
    overlays: Type.Optional(
      Type.Object(
        {
          safeArea: Type.Optional(EditorPageInsetsV1Schema),
          bleed: Type.Optional(EditorPageInsetsV1Schema),
          guides: Type.Optional(
            Type.Array(EditorPageGuideV1Schema, {
              maxItems: 512,
            }),
          ),
        },
        { additionalProperties: false },
      ),
    ),
    nodes: Type.Array(EditorNodeV1Schema, { maxItems: 5_000 }),
  },
  {
    additionalProperties: false,
    $id: "kanvas.editor-page.v1",
  },
);

export const EditorDraftContentV1Schema = Type.Object(
  {
    schemaVersion: Type.Literal("kanvas.editor-document/v1"),
    title: Type.String({ minLength: 1, maxLength: 240 }),
    pages: Type.Array(EditorPageV1Schema, {
      minItems: 1,
      maxItems: 128,
    }),
    metadata: Type.Object(
      {
        createdWith: Type.String({ minLength: 1, maxLength: 120 }),
      },
      { additionalProperties: false },
    ),
  },
  {
    additionalProperties: false,
    $id: "kanvas.editor-draft-content.v1",
  },
);

export const EditorDocumentV1Schema = Type.Object(
  {
    documentId: UlidSchema,
    workspaceId: UlidSchema,
    ...EditorDraftContentV1Schema.properties,
  },
  {
    additionalProperties: false,
    $id: "kanvas.editor-document.v1",
  },
);

export type EditorArtifactReferenceV1 = Static<
  typeof EditorArtifactReferenceV1Schema
>;
export type EditorCatalogReferenceV1 = Static<
  typeof EditorCatalogReferenceV1Schema
>;
export type EditorDocumentV1 = Static<typeof EditorDocumentV1Schema>;
export type EditorDraftContentV1 = Static<typeof EditorDraftContentV1Schema>;
export type EditorFrameNodeV1 = Extract<EditorNodeV1, { kind: "frame" }>;
export type EditorGraphicNodeV1 = Extract<EditorNodeV1, { kind: "graphic" }>;
export type EditorGridNodeV1 = Extract<EditorNodeV1, { kind: "grid" }>;
export type EditorGroupNodeV1 = Extract<EditorNodeV1, { kind: "group" }>;
export type EditorImageNodeV1 = Extract<EditorNodeV1, { kind: "image" }>;
export type EditorLineNodeV1 = Extract<EditorNodeV1, { kind: "line" }>;
export type EditorLineBindingV1 = NonNullable<EditorLineNodeV1["startBinding"]>;
export type EditorNodeV1 = Static<typeof EditorNodeV1Schema>;
export type EditorNodeKindV1 = EditorNodeV1["kind"];
export type EditorPaintV1 = Static<typeof EditorPaintV1Schema>;
export type EditorPageBackgroundV1 = Static<
  typeof EditorPageBackgroundV1Schema
>;
export type EditorPageV1 = Static<typeof EditorPageV1Schema>;
export type EditorPlacedImageV1 = Static<typeof EditorPlacedImageV1Schema>;
export type EditorShapeNodeV1 = Extract<EditorNodeV1, { kind: "shape" }>;
export type EditorStrokeV1 = Static<typeof EditorStrokeV1Schema>;
export type EditorTextContentV1 = Static<typeof EditorTextContentV1Schema>;
export type EditorTextEffectV1 = Static<typeof EditorTextEffectV1Schema>;
export type EditorTextNodeV1 = Extract<EditorNodeV1, { kind: "text" }>;
