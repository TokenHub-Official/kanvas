import type {
  CanvasShapeDefinitionV1,
  CanvasShapeNumberParameterV1,
  CanvasShapePointV1,
} from "./shape-catalog-v1.js";

export interface CanvasShapePathV1 {
  readonly d: string;
  readonly fillRule: "evenodd" | "nonzero";
  readonly viewBox: "0 0 100 100";
}

export type CanvasShapeParameterValuesV1 = Readonly<
  Record<string, boolean | number | string>
>;

function number(value: number): string {
  return Number(value.toFixed(4)).toString();
}

function parameterValue(
  parameter: CanvasShapeNumberParameterV1 | undefined,
  values: CanvasShapeParameterValuesV1,
): number {
  if (!parameter) {
    return 0;
  }
  const candidate = values[parameter.id];
  return typeof candidate === "number" && Number.isFinite(candidate)
    ? Math.min(parameter.maximum, Math.max(parameter.minimum, candidate))
    : parameter.defaultValue;
}

function pathFromPoints(points: readonly CanvasShapePointV1[]): string {
  return points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"}${number(
          point.x * 100,
        )} ${number(point.y * 100)}`,
    )
    .join(" ")
    .concat(" Z");
}

function roundedRectanglePath(radius: number): string {
  const normalizedRadius = Math.min(50, Math.max(0, radius * 100));
  if (normalizedRadius === 0) {
    return "M0 0 H100 V100 H0 Z";
  }
  const r = number(normalizedRadius);
  const far = number(100 - normalizedRadius);
  return [
    `M${r} 0`,
    `H${far}`,
    `Q100 0 100 ${r}`,
    `V${far}`,
    `Q100 100 ${far} 100`,
    `H${r}`,
    `Q0 100 0 ${far}`,
    `V${r}`,
    `Q0 0 ${r} 0`,
    "Z",
  ].join(" ");
}

function ellipsePath(): string {
  return "M50 0 A50 50 0 1 1 50 100 A50 50 0 1 1 50 0 Z";
}

function ringPath(innerRadius: number): string {
  const radius = Math.min(46, Math.max(2.5, innerRadius * 50));
  const left = number(50 - radius);
  const right = number(50 + radius);
  const r = number(radius);
  return [
    ellipsePath(),
    `M${left} 50`,
    `A${r} ${r} 0 1 0 ${right} 50`,
    `A${r} ${r} 0 1 0 ${left} 50`,
    "Z",
  ].join(" ");
}

function crossPath(armWidth: number): string {
  const halfArm = Math.min(0.48, Math.max(0.04, armWidth)) * 50;
  const near = 50 - halfArm;
  const far = 50 + halfArm;
  return pathFromPoints([
    { x: near / 100, y: 0 },
    { x: far / 100, y: 0 },
    { x: far / 100, y: near / 100 },
    { x: 1, y: near / 100 },
    { x: 1, y: far / 100 },
    { x: far / 100, y: far / 100 },
    { x: far / 100, y: 1 },
    { x: near / 100, y: 1 },
    { x: near / 100, y: far / 100 },
    { x: 0, y: far / 100 },
    { x: 0, y: near / 100 },
    { x: near / 100, y: near / 100 },
  ]);
}

function speechRoundedPath(tailPosition: number): string {
  const tailCenter = Math.min(0.86, Math.max(0.14, tailPosition)) * 100;
  const tailLeft = Math.max(10, tailCenter - 12);
  const tailRight = Math.min(90, tailCenter + 8);
  const tailTip = Math.max(4, tailCenter - 18);
  return [
    "M12 4",
    "H88",
    "Q98 4 98 14",
    "V64",
    "Q98 74 88 74",
    `H${number(tailRight)}`,
    `L${number(tailTip)} 96`,
    `L${number(tailLeft)} 74`,
    "H12",
    "Q2 74 2 64",
    "V14",
    "Q2 4 12 4",
    "Z",
  ].join(" ");
}

export function canvasStickyNoteFoldPathV1(): string {
  return "M72 98 L98 72 V90 Q98 98 90 98 Z";
}

function stickyNotePath(): string {
  return [
    "M8 2",
    "H92",
    "Q98 2 98 8",
    "V72",
    "L72 98",
    "H8",
    "Q2 98 2 92",
    "V8",
    "Q2 2 8 2",
    "Z",
  ].join(" ");
}

export function materializeCanvasShapePathV1(
  definition: CanvasShapeDefinitionV1,
  values: CanvasShapeParameterValuesV1 = {},
): CanvasShapePathV1 {
  const parameter = (id: string) =>
    definition.parameters.find((candidate) => candidate.id === id);
  const geometry = definition.geometry;
  let d: string;
  let fillRule: CanvasShapePathV1["fillRule"] = "nonzero";

  if (geometry.kind === "rectangle") {
    d = roundedRectanglePath(parameterValue(parameter("cornerRadius"), values));
  } else if (geometry.kind === "ellipse") {
    d = ellipsePath();
  } else if (geometry.kind === "polygon") {
    d = pathFromPoints(geometry.points);
  } else if (geometry.kind === "path") {
    d = geometry.path;
  } else if (geometry.kind === "ring") {
    d = ringPath(
      parameter("innerRadius")
        ? parameterValue(parameter("innerRadius"), values)
        : geometry.innerRadius,
    );
    fillRule = "evenodd";
  } else if (geometry.kind === "cross") {
    d = crossPath(
      parameter("armWidth")
        ? parameterValue(parameter("armWidth"), values)
        : geometry.defaultArmWidth,
    );
  } else if (geometry.kind === "speech_rounded") {
    d = speechRoundedPath(
      parameter("tailPosition")
        ? parameterValue(parameter("tailPosition"), values)
        : geometry.defaultTailPosition,
    );
  } else {
    d = stickyNotePath();
  }

  return {
    d,
    fillRule,
    viewBox: "0 0 100 100",
  };
}
