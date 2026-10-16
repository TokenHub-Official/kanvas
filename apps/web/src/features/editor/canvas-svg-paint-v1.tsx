import type { EditorPaintV1 } from "@kanvas/contracts/editor";

const HALF_TURN_DEGREES = 180;
const GRADIENT_CENTER_PERCENT = 50;

export interface SvgPaintPresentationV1 {
  readonly fill: string;
  readonly gradient?: {
    readonly angle: number;
    readonly id: string;
    readonly stops: readonly {
      readonly color: string;
      readonly offset: number;
    }[];
  };
}

export function safeSvgIdV1(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/gu, "_");
}

export function svgPaintPresentationV1(
  paint: EditorPaintV1,
  id: string,
): SvgPaintPresentationV1 {
  if (paint.kind === "none") {
    return {
      fill: "none",
    };
  }
  if (paint.kind === "solid") {
    return {
      fill: paint.color,
    };
  }
  return {
    fill: `url(#${id})`,
    gradient: {
      id,
      angle: paint.angle,
      stops: paint.stops,
    },
  };
}

function gradientVector(angle: number) {
  const radians = (angle * Math.PI) / HALF_TURN_DEGREES;
  const x = Math.cos(radians) * GRADIENT_CENTER_PERCENT;
  const y = Math.sin(radians) * GRADIENT_CENTER_PERCENT;
  return {
    x1: `${String(GRADIENT_CENTER_PERCENT - x)}%`,
    y1: `${String(GRADIENT_CENTER_PERCENT - y)}%`,
    x2: `${String(GRADIENT_CENTER_PERCENT + x)}%`,
    y2: `${String(GRADIENT_CENTER_PERCENT + y)}%`,
  };
}

export function SvgPaintGradientV1({
  gradient,
}: {
  readonly gradient: NonNullable<SvgPaintPresentationV1["gradient"]>;
}) {
  const vector = gradientVector(gradient.angle);
  return (
    <linearGradient
      id={gradient.id}
      x1={vector.x1}
      x2={vector.x2}
      y1={vector.y1}
      y2={vector.y2}
    >
      {gradient.stops.map((stop, index) => (
        <stop
          key={`${String(stop.offset)}-${String(index)}`}
          offset={`${String(stop.offset * 100)}%`}
          stopColor={stop.color}
        />
      ))}
    </linearGradient>
  );
}
