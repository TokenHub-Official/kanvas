export type CanvasGraphicColorSlotV1 = "primary" | "secondary";

export interface CanvasGraphicPathV1 {
  readonly colorSlot: CanvasGraphicColorSlotV1;
  readonly d: string;
  readonly fillRule?: "evenodd" | "nonzero";
  readonly opacity?: number;
}

export interface CanvasGraphicDefinitionV1 {
  readonly catalogId: "kanvas.core.graphics";
  readonly defaultAspectRatio: number;
  readonly defaultColors: Readonly<Record<CanvasGraphicColorSlotV1, string>>;
  readonly keywords: readonly string[];
  readonly label: string;
  readonly paths: readonly CanvasGraphicPathV1[];
  readonly resourceId: string;
  readonly revision: string;
  readonly viewBox: string;
}

const revision = "2026-07-31";
const catalogId = "kanvas.core.graphics" as const;
const defaultColors = {
  primary: "#3048f5",
  secondary: "#151515",
} as const;

function graphic(
  value: Omit<
    CanvasGraphicDefinitionV1,
    "catalogId" | "defaultColors" | "revision" | "viewBox"
  >,
): CanvasGraphicDefinitionV1 {
  return {
    ...value,
    catalogId,
    revision,
    viewBox: "0 0 100 100",
    defaultColors,
  };
}

export const canvasGraphicCatalogV1 = [
  graphic({
    resourceId: "graphic.spark",
    label: "闪光",
    defaultAspectRatio: 1,
    keywords: ["星光", "亮点", "spark"],
    paths: [
      {
        colorSlot: "primary",
        d: "M50 4 61 39 96 50 61 61 50 96 39 61 4 50 39 39Z",
      },
    ],
  }),
  graphic({
    resourceId: "graphic.heart",
    label: "爱心",
    defaultAspectRatio: 1,
    keywords: ["心形", "收藏", "heart"],
    paths: [
      {
        colorSlot: "primary",
        d: "M50 90C42 81 15 63 9 43 3 23 16 10 32 12 42 13 48 20 50 27 52 20 58 13 68 12 84 10 97 23 91 43 85 63 58 81 50 90Z",
      },
    ],
  }),
  graphic({
    resourceId: "graphic.lightning",
    label: "闪电",
    defaultAspectRatio: 0.8,
    keywords: ["能量", "速度", "bolt"],
    paths: [
      {
        colorSlot: "primary",
        d: "M57 4 18 56H45L38 96 82 40H54Z",
      },
    ],
  }),
  graphic({
    resourceId: "graphic.badge-check",
    label: "确认标记",
    defaultAspectRatio: 1,
    keywords: ["完成", "验证", "check", "badge"],
    paths: [
      {
        colorSlot: "primary",
        d: "M50 3 61 12 75 11 82 23 95 29 94 43 100 55 91 66 89 80 75 84 66 95 52 91 39 97 29 88 15 87 11 73 1 64 7 51 4 37 16 28 20 14 34 12Z",
      },
      {
        colorSlot: "secondary",
        d: "M30 50 43 63 72 34 80 42 43 79 22 58Z",
      },
    ],
  }),
  graphic({
    resourceId: "graphic.leaf",
    label: "叶片",
    defaultAspectRatio: 0.85,
    keywords: ["自然", "植物", "leaf"],
    paths: [
      {
        colorSlot: "primary",
        d: "M85 8C45 9 16 31 15 61 14 78 25 91 42 92 70 94 89 60 85 8Z",
      },
      {
        colorSlot: "secondary",
        d: "M20 91C35 66 51 47 76 24L82 31C57 53 42 70 29 96Z",
      },
    ],
  }),
  graphic({
    resourceId: "graphic.quote",
    label: "引号",
    defaultAspectRatio: 1.25,
    keywords: ["引用", "文字", "quote"],
    paths: [
      {
        colorSlot: "primary",
        d: "M9 18H45V52C45 73 34 86 12 90L8 76C20 73 26 67 27 57H9ZM55 18H91V52C91 73 80 86 58 90L54 76C66 73 72 67 73 57H55Z",
      },
    ],
  }),
  graphic({
    resourceId: "graphic.location",
    label: "位置标记",
    defaultAspectRatio: 0.78,
    keywords: ["地点", "坐标", "pin", "location"],
    paths: [
      {
        colorSlot: "primary",
        d: "M50 4C26 4 10 21 10 44 10 69 38 91 50 98 62 91 90 69 90 44 90 21 74 4 50 4ZM50 58A15 15 0 1 1 50 28 15 15 0 0 1 50 58Z",
        fillRule: "evenodd",
      },
    ],
  }),
  graphic({
    resourceId: "graphic.flower",
    label: "花形",
    defaultAspectRatio: 1,
    keywords: ["花朵", "装饰", "flower"],
    paths: [
      {
        colorSlot: "primary",
        d: "M50 36C31 21 33 3 50 3 67 3 69 21 50 36ZM64 50C79 31 97 33 97 50 97 67 79 69 64 50ZM50 64C69 79 67 97 50 97 33 97 31 79 50 64ZM36 50C21 69 3 67 3 50 3 33 21 31 36 50Z",
      },
      {
        colorSlot: "secondary",
        d: "M50 31A19 19 0 1 1 50 69 19 19 0 0 1 50 31Z",
      },
    ],
  }),
  graphic({
    resourceId: "graphic.arrow-turn",
    label: "转向箭头",
    defaultAspectRatio: 1.25,
    keywords: ["方向", "指示", "arrow"],
    paths: [
      {
        colorSlot: "primary",
        d: "M8 20H58C76 20 88 32 88 50V60H100L78 88 56 60H69V51C69 43 64 39 56 39H8Z",
      },
    ],
  }),
  graphic({
    resourceId: "graphic.crescent",
    label: "月牙",
    defaultAspectRatio: 0.82,
    keywords: ["月亮", "夜晚", "crescent"],
    paths: [
      {
        colorSlot: "primary",
        d: "M72 5C47 13 34 34 38 56 42 78 62 92 87 90 76 98 63 102 50 99 23 94 5 68 11 41 16 17 42 1 72 5Z",
      },
    ],
  }),
] as const satisfies readonly CanvasGraphicDefinitionV1[];

const definitions = new Map(
  canvasGraphicCatalogV1.map((definition) => [
    `${definition.catalogId}:${definition.resourceId}:${definition.revision}`,
    definition,
  ]),
);

export function canvasGraphicDefinitionV1(
  catalogIdValue: string,
  resourceId: string,
  revisionValue: string,
): CanvasGraphicDefinitionV1 | undefined {
  return definitions.get(`${catalogIdValue}:${resourceId}:${revisionValue}`);
}
