import { assertRgbaImage } from "./inputs.js";
import type {
  CropSuggestInput,
  NormalizedBounds,
  PaletteExtractInput,
  PixelBounds,
  QualityAssessInput,
  RgbaImage,
} from "./types.js";

function rounded(value: number): number {
  return Number(value.toFixed(6));
}

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, value));
}

function luminance(red: number, green: number, blue: number) {
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function normalizedBounds(
  bounds: PixelBounds,
  width: number,
  height: number,
): NormalizedBounds {
  return Object.freeze({
    x: rounded(bounds.x / width),
    y: rounded(bounds.y / height),
    width: rounded(bounds.width / width),
    height: rounded(bounds.height / height),
  });
}

function boundedSubject(
  subject: PixelBounds,
  width: number,
  height: number,
): PixelBounds | undefined {
  const x = Math.min(width, subject.x);
  const y = Math.min(height, subject.y);
  const right = Math.min(width, subject.x + subject.width);
  const bottom = Math.min(height, subject.y + subject.height);
  return right > x && bottom > y
    ? Object.freeze({
        x,
        y,
        width: right - x,
        height: bottom - y,
      })
    : undefined;
}

function unionArea(bounds: readonly PixelBounds[]): number {
  if (bounds.length === 0) {
    return 0;
  }
  const xs = [
    ...new Set(bounds.flatMap(({ x, width }) => [x, x + width])),
  ].sort((left, right) => left - right);
  let area = 0;
  for (let index = 0; index < xs.length - 1; index += 1) {
    const left = xs[index]!;
    const right = xs[index + 1]!;
    if (right <= left) {
      continue;
    }
    const intervals = bounds
      .filter((item) => item.x < right && item.x + item.width > left)
      .map((item) => [item.y, item.y + item.height] as const)
      .sort(([a], [b]) => a - b);
    let covered = 0;
    let start = -1;
    let end = -1;
    for (const [top, bottom] of intervals) {
      if (start < 0) {
        start = top;
        end = bottom;
      } else if (top <= end) {
        end = Math.max(end, bottom);
      } else {
        covered += end - start;
        start = top;
        end = bottom;
      }
    }
    if (start >= 0) {
      covered += end - start;
    }
    area += covered * (right - left);
  }
  return area;
}

function subjectRetention(
  crop: PixelBounds,
  subjects: readonly PixelBounds[],
): number {
  if (subjects.length === 0) {
    return 1;
  }
  const total = unionArea(subjects);
  const intersections = subjects.flatMap((subject) => {
    const x = Math.max(crop.x, subject.x);
    const y = Math.max(crop.y, subject.y);
    const right = Math.min(crop.x + crop.width, subject.x + subject.width);
    const bottom = Math.min(crop.y + crop.height, subject.y + subject.height);
    return right > x && bottom > y
      ? [{ x, y, width: right - x, height: bottom - y }]
      : [];
  });
  return total === 0 ? 1 : unionArea(intersections) / total;
}

function saliencyProjection(image: RgbaImage) {
  const stride = Math.max(
    1,
    Math.ceil(Math.max(image.width, image.height) / 256),
  );
  let luminanceTotal = 0;
  let visible = 0;
  for (let y = 0; y < image.height; y += stride) {
    for (let x = 0; x < image.width; x += stride) {
      const offset = (y * image.width + x) * 4;
      const alpha = image.data[offset + 3]! / 255;
      if (alpha === 0) {
        continue;
      }
      luminanceTotal +=
        luminance(
          image.data[offset]!,
          image.data[offset + 1]!,
          image.data[offset + 2]!,
        ) * alpha;
      visible += alpha;
    }
  }
  const mean = visible === 0 ? 127.5 : luminanceTotal / visible;
  const columns = new Float64Array(image.width);
  const rows = new Float64Array(image.height);
  let total = 0;
  let weightedX = 0;
  let weightedY = 0;
  for (let y = 0; y < image.height; y += stride) {
    for (let x = 0; x < image.width; x += stride) {
      const offset = (y * image.width + x) * 4;
      const alpha = image.data[offset + 3]! / 255;
      const light = luminance(
        image.data[offset]!,
        image.data[offset + 1]!,
        image.data[offset + 2]!,
      );
      const weight = alpha * (0.25 + Math.abs(light - mean) / 255);
      columns[x] = columns[x]! + weight;
      rows[y] = rows[y]! + weight;
      total += weight;
      weightedX += weight * x;
      weightedY += weight * y;
    }
  }
  return {
    columns,
    rows,
    total,
    centerX: total === 0 ? (image.width - 1) / 2 : weightedX / total,
    centerY: total === 0 ? (image.height - 1) / 2 : weightedY / total,
  };
}

function projectionRetention(
  projection: ReturnType<typeof saliencyProjection>,
  bounds: PixelBounds,
): number {
  if (projection.total === 0) {
    return 1;
  }
  let horizontal = 0;
  let vertical = 0;
  for (let x = bounds.x; x < bounds.x + bounds.width; x += 1) {
    horizontal += projection.columns[x]!;
  }
  for (let y = bounds.y; y < bounds.y + bounds.height; y += 1) {
    vertical += projection.rows[y]!;
  }
  return Math.sqrt(
    clamp(horizontal / projection.total) * clamp(vertical / projection.total),
  );
}

function cropSize(
  width: number,
  height: number,
  ratio: number,
): {
  readonly height: number;
  readonly width: number;
} {
  if (width / height >= ratio) {
    return {
      width: Math.max(1, Math.min(width, Math.round(height * ratio))),
      height,
    };
  }
  return {
    width,
    height: Math.max(1, Math.min(height, Math.round(width / ratio))),
  };
}

function cropAt(
  centerX: number,
  centerY: number,
  cropWidth: number,
  cropHeight: number,
  imageWidth: number,
  imageHeight: number,
): PixelBounds {
  return Object.freeze({
    x: Math.max(
      0,
      Math.min(imageWidth - cropWidth, Math.round(centerX - cropWidth / 2)),
    ),
    y: Math.max(
      0,
      Math.min(imageHeight - cropHeight, Math.round(centerY - cropHeight / 2)),
    ),
    width: cropWidth,
    height: cropHeight,
  });
}

export function suggestCrops(image: RgbaImage, input: CropSuggestInput) {
  assertRgbaImage(image);
  const subjects = Object.freeze(
    input.subjectBounds.flatMap((subject) => {
      const bounded = boundedSubject(subject, image.width, image.height);
      return bounded ? [bounded] : [];
    }),
  );
  const projection = saliencyProjection(image);
  const subjectCenter =
    subjects.length === 0
      ? undefined
      : {
          x:
            subjects.reduce(
              (sum, item) =>
                sum + (item.x + item.width / 2) * item.width * item.height,
              0,
            ) /
            subjects.reduce((sum, item) => sum + item.width * item.height, 0),
          y:
            subjects.reduce(
              (sum, item) =>
                sum + (item.y + item.height / 2) * item.width * item.height,
              0,
            ) /
            subjects.reduce((sum, item) => sum + item.width * item.height, 0),
        };
  const preferredX = subjectCenter?.x ?? projection.centerX;
  const preferredY = subjectCenter?.y ?? projection.centerY;
  const suggestions: Array<{
    readonly aspectRatio: string;
    readonly bounds: PixelBounds;
    readonly confidence: number;
    readonly method: "deterministic_saliency_projection";
    readonly normalizedBounds: NormalizedBounds;
    readonly rank: number;
    readonly subjectRetention: number;
  }> = [];
  for (const ratioText of input.aspectRatios) {
    const [wide, high] = ratioText.split(":").map(Number) as [number, number];
    const size = cropSize(image.width, image.height, wide / high);
    const movingHorizontal = size.width < image.width;
    const shift =
      (movingHorizontal ? size.width : size.height) *
      (0.08 + input.safeMarginRatio * 0.4);
    const centers = [
      [preferredX, preferredY],
      [
        preferredX + (movingHorizontal ? -shift : 0),
        preferredY + (movingHorizontal ? 0 : -shift),
      ],
      [
        preferredX + (movingHorizontal ? shift : 0),
        preferredY + (movingHorizontal ? 0 : shift),
      ],
    ] as const;
    const candidates = centers
      .map(([x, y]) =>
        cropAt(x, y, size.width, size.height, image.width, image.height),
      )
      .filter(
        (candidate, index, all) =>
          all.findIndex(
            (item) => item.x === candidate.x && item.y === candidate.y,
          ) === index,
      )
      .map((candidate) => {
        const retention = subjectRetention(candidate, subjects);
        const saliency = projectionRetention(projection, candidate);
        return {
          bounds: candidate,
          subjectRetention: retention,
          confidence:
            subjects.length === 0 ? saliency : retention * 0.7 + saliency * 0.3,
        };
      })
      .sort(
        (left, right) =>
          right.confidence - left.confidence ||
          left.bounds.y - right.bounds.y ||
          left.bounds.x - right.bounds.x,
      )
      .slice(0, input.maxSuggestionsPerRatio);
    candidates.forEach((candidate, index) => {
      suggestions.push({
        aspectRatio: ratioText,
        rank: index + 1,
        bounds: candidate.bounds,
        normalizedBounds: normalizedBounds(
          candidate.bounds,
          image.width,
          image.height,
        ),
        subjectRetention: rounded(candidate.subjectRetention),
        confidence: rounded(clamp(candidate.confidence)),
        method: "deterministic_saliency_projection",
      });
    });
  }
  return Object.freeze(
    suggestions.map((suggestion, index) =>
      Object.freeze({
        suggestionId: `crop-${String(index + 1)}`,
        ...suggestion,
      }),
    ),
  );
}

interface PaletteBin {
  readonly blue: number;
  readonly green: number;
  readonly key: number;
  readonly red: number;
  readonly weight: number;
}

interface PaletteCluster {
  readonly blue: number;
  readonly green: number;
  readonly red: number;
  readonly weight: number;
}

function paletteDistance(
  left: Pick<PaletteCluster, "blue" | "green" | "red">,
  right: Pick<PaletteCluster, "blue" | "green" | "red">,
): number {
  const red = left.red - right.red;
  const green = left.green - right.green;
  const blue = left.blue - right.blue;
  return red * red + green * green + blue * blue;
}

function paletteBinColor(bin: PaletteBin): PaletteCluster {
  return {
    red: bin.red / bin.weight,
    green: bin.green / bin.weight,
    blue: bin.blue / bin.weight,
    weight: bin.weight,
  };
}

function initialPaletteClusters(
  bins: readonly PaletteBin[],
  colorCount: number,
): readonly PaletteCluster[] {
  const first = bins[0];
  if (!first) return [];
  const clusters = [paletteBinColor(first)];
  while (clusters.length < Math.min(colorCount, bins.length)) {
    let selected: PaletteBin | undefined;
    let selectedScore = -1;
    for (const bin of bins) {
      const color = paletteBinColor(bin);
      const distance = Math.min(
        ...clusters.map((cluster) => paletteDistance(color, cluster)),
      );
      const score = bin.weight * distance;
      if (
        score > selectedScore ||
        (score === selectedScore && bin.key < (selected?.key ?? Infinity))
      ) {
        selected = bin;
        selectedScore = score;
      }
    }
    if (!selected || selectedScore <= 0) break;
    clusters.push(paletteBinColor(selected));
  }
  return clusters;
}

function clusteredPalette(
  bins: readonly PaletteBin[],
  colorCount: number,
): readonly PaletteCluster[] {
  let clusters = initialPaletteClusters(bins, colorCount);
  const maximumIterations = 16;
  for (let iteration = 0; iteration < maximumIterations; iteration += 1) {
    const totals = clusters.map(() => ({
      red: 0,
      green: 0,
      blue: 0,
      weight: 0,
    }));
    for (const bin of bins) {
      const color = paletteBinColor(bin);
      let selectedIndex = 0;
      let selectedDistance = Infinity;
      clusters.forEach((cluster, index) => {
        const distance = paletteDistance(color, cluster);
        if (distance < selectedDistance) {
          selectedIndex = index;
          selectedDistance = distance;
        }
      });
      const total = totals[selectedIndex]!;
      total.red += bin.red;
      total.green += bin.green;
      total.blue += bin.blue;
      total.weight += bin.weight;
    }
    let movement = 0;
    clusters = clusters.map((cluster, index) => {
      const total = totals[index]!;
      if (total.weight === 0) return { ...cluster, weight: 0 };
      const next = {
        red: total.red / total.weight,
        green: total.green / total.weight,
        blue: total.blue / total.weight,
        weight: total.weight,
      };
      movement += paletteDistance(cluster, next);
      return next;
    });
    if (movement < 0.01) break;
  }
  return [...clusters]
    .filter((cluster) => cluster.weight > 0)
    .sort(
      (left, right) =>
        right.weight - left.weight ||
        left.red - right.red ||
        left.green - right.green ||
        left.blue - right.blue,
    );
}

export function extractPalette(image: RgbaImage, input: PaletteExtractInput) {
  assertRgbaImage(image);
  const stride = Math.max(
    1,
    Math.ceil(Math.max(image.width, image.height) / input.sampleSize),
  );
  const bins = new Map<
    number,
    {
      blue: number;
      green: number;
      red: number;
      weight: number;
    }
  >();
  let sampled = 0;
  let transparent = 0;
  let visibleWeight = 0;
  for (let y = 0; y < image.height; y += stride) {
    for (let x = 0; x < image.width; x += stride) {
      sampled += 1;
      const offset = (y * image.width + x) * 4;
      const alpha = image.data[offset + 3]!;
      if (alpha < input.alphaThreshold) {
        transparent += 1;
        continue;
      }
      const red = image.data[offset]!;
      const green = image.data[offset + 1]!;
      const blue = image.data[offset + 2]!;
      const key = ((red >> 3) << 10) | ((green >> 3) << 5) | (blue >> 3);
      const weight = alpha / 255;
      const bin = bins.get(key) ?? {
        red: 0,
        green: 0,
        blue: 0,
        weight: 0,
      };
      bin.red += red * weight;
      bin.green += green * weight;
      bin.blue += blue * weight;
      bin.weight += weight;
      visibleWeight += weight;
      bins.set(key, bin);
    }
  }
  const entries = [...bins.entries()]
    .map(([key, bin]) => ({ key, ...bin }))
    .sort((left, right) => right.weight - left.weight || left.key - right.key);
  const clusters = clusteredPalette(entries, input.colorCount);
  const clusteredWeight = clusters.reduce(
    (sum, cluster) => sum + cluster.weight,
    0,
  );
  if (Math.abs(clusteredWeight - visibleWeight) > 0.000001) {
    throw new Error("Palette cluster weights must cover every visible sample.");
  }
  const proportions = clusters.map((cluster) =>
    rounded(visibleWeight === 0 ? 0 : cluster.weight / visibleWeight),
  );
  const proportionDrift = rounded(
    1 - proportions.reduce((sum, proportion) => sum + proportion, 0),
  );
  if (proportions.length > 0) {
    proportions[0] = rounded(proportions[0]! + proportionDrift);
  }
  const colors = clusters.map((cluster, index) => {
    const red = Math.round(cluster.red);
    const green = Math.round(cluster.green);
    const blue = Math.round(cluster.blue);
    const maximum = Math.max(red, green, blue);
    const minimum = Math.min(red, green, blue);
    const saturation = maximum === 0 ? 0 : (maximum - minimum) / maximum;
    const hex = `#${[red, green, blue]
      .map((channel) => channel.toString(16).padStart(2, "0").toUpperCase())
      .join("")}`;
    let role: "accent" | "dominant" | "neutral" = "accent";
    if (saturation < 0.12) {
      role = "neutral";
    } else if (index === 0) {
      role = "dominant";
    }
    return Object.freeze({
      rank: index + 1,
      hex,
      red,
      green,
      blue,
      proportion: proportions[index]!,
      luminance: rounded(luminance(red, green, blue) / 255),
      role,
    });
  });
  return Object.freeze({
    colors: Object.freeze(colors),
    transparentRatio: rounded(sampled === 0 ? 0 : transparent / sampled),
    sampledPixelCount: sampled - transparent,
    visibleWeight: rounded(visibleWeight),
  });
}

function sampledLuminance(image: RgbaImage, sampleSize: number) {
  const stride = Math.max(
    1,
    Math.ceil(Math.max(image.width, image.height) / sampleSize),
  );
  const width = Math.ceil(image.width / stride);
  const height = Math.ceil(image.height / stride);
  const values = new Float64Array(width * height);
  let visible = 0;
  let under = 0;
  let over = 0;
  for (let sy = 0; sy < height; sy += 1) {
    for (let sx = 0; sx < width; sx += 1) {
      const x = Math.min(image.width - 1, sx * stride);
      const y = Math.min(image.height - 1, sy * stride);
      const offset = (y * image.width + x) * 4;
      const alpha = image.data[offset + 3]!;
      const light = luminance(
        image.data[offset]!,
        image.data[offset + 1]!,
        image.data[offset + 2]!,
      );
      values[sy * width + sx] = light;
      if (alpha >= 16) {
        visible += 1;
        if (light < 32) under += 1;
        if (light > 235) over += 1;
      }
    }
  }
  return {
    values,
    width,
    height,
    visible,
    under,
    over,
  };
}

export function assessQuality(image: RgbaImage, input: QualityAssessInput) {
  assertRgbaImage(image);
  const sampled = sampledLuminance(image, input.sampleSize);
  let laplacianSquared = 0;
  let laplacianTotal = 0;
  let residualTotal = 0;
  let residualCount = 0;
  let boundaryDifference = 0;
  let boundaryCount = 0;
  let internalDifference = 0;
  let internalCount = 0;
  for (let y = 1; y < sampled.height - 1; y += 1) {
    for (let x = 1; x < sampled.width - 1; x += 1) {
      const index = y * sampled.width + x;
      const center = sampled.values[index]!;
      const left = sampled.values[index - 1]!;
      const right = sampled.values[index + 1]!;
      const top = sampled.values[index - sampled.width]!;
      const bottom = sampled.values[index + sampled.width]!;
      const laplacian = left + right + top + bottom - center * 4;
      laplacianTotal += laplacian;
      laplacianSquared += laplacian * laplacian;
      residualTotal += Math.abs(center - (left + right + top + bottom) / 4);
      residualCount += 1;
      const horizontal = Math.abs(center - left);
      const vertical = Math.abs(center - top);
      if (x % 8 === 0) {
        boundaryDifference += horizontal;
        boundaryCount += 1;
      } else {
        internalDifference += horizontal;
        internalCount += 1;
      }
      if (y % 8 === 0) {
        boundaryDifference += vertical;
        boundaryCount += 1;
      } else {
        internalDifference += vertical;
        internalCount += 1;
      }
    }
  }
  const meanLaplacian =
    residualCount === 0 ? 0 : laplacianTotal / residualCount;
  const variance =
    residualCount === 0
      ? 0
      : laplacianSquared / residualCount - meanLaplacian * meanLaplacian;
  const blurScore = clamp(1 - variance / 1200);
  const noiseScore = clamp(
    residualCount === 0 ? 0 : residualTotal / residualCount / 48,
  );
  const boundaryMean =
    boundaryCount === 0 ? 0 : boundaryDifference / boundaryCount;
  const internalMean =
    internalCount === 0 ? 0 : internalDifference / internalCount;
  const compressionScore = clamp(
    (boundaryMean / Math.max(1, internalMean) - 1) / 2,
  );
  const underExposureRatio =
    sampled.visible === 0 ? 0 : sampled.under / sampled.visible;
  const overExposureRatio =
    sampled.visible === 0 ? 0 : sampled.over / sampled.visible;
  const subjects = input.subjectBounds.flatMap((subject) => {
    const bounded = boundedSubject(subject, image.width, image.height);
    return bounded ? [bounded] : [];
  });
  const subjectScaleRatio =
    subjects.length === 0
      ? null
      : unionArea(subjects) / (image.width * image.height);
  const findings: Array<
    | "blur"
    | "under_exposed"
    | "over_exposed"
    | "noise"
    | "compression"
    | "subject_too_small"
  > = [];
  if (blurScore >= 0.65) findings.push("blur");
  if (underExposureRatio >= 0.35) {
    findings.push("under_exposed");
  }
  if (overExposureRatio >= 0.2) {
    findings.push("over_exposed");
  }
  if (noiseScore >= 0.45) findings.push("noise");
  if (compressionScore >= 0.45) {
    findings.push("compression");
  }
  if (subjectScaleRatio !== null && subjectScaleRatio < 0.05) {
    findings.push("subject_too_small");
  }
  const severe =
    blurScore >= 0.85 ||
    underExposureRatio >= 0.65 ||
    overExposureRatio >= 0.5 ||
    noiseScore >= 0.75 ||
    compressionScore >= 0.75;
  let usability: "good" | "poor" | "review" = "review";
  if (findings.length === 0) {
    usability = "good";
  } else if (severe || findings.length >= 3) {
    usability = "poor";
  }
  return Object.freeze({
    blurScore: rounded(blurScore),
    underExposureRatio: rounded(underExposureRatio),
    overExposureRatio: rounded(overExposureRatio),
    noiseScore: rounded(noiseScore),
    compressionScore: rounded(compressionScore),
    subjectScaleRatio:
      subjectScaleRatio === null ? null : rounded(subjectScaleRatio),
    usability,
    findings: Object.freeze(findings),
  });
}
