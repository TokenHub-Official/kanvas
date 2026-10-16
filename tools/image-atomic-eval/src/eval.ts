export type BatchBCapability =
  | "image.object.remove"
  | "image.denoise"
  | "image.light.enhance"
  | "image.text.extract";

export interface RgbaImage {
  readonly data: Uint8Array;
  readonly height: number;
  readonly width: number;
}

export interface MetricThreshold {
  readonly operator: "gte" | "lte" | "eq";
  readonly value: number;
}

export type MetricThresholds = Readonly<Record<string, MetricThreshold>>;

export interface EvalDecision {
  readonly failures: readonly string[];
  readonly passed: boolean;
}

export interface OcrPolygonPoint {
  readonly x: number;
  readonly y: number;
}

export interface OcrEvalBlock {
  readonly confidence?: number;
  readonly polygon: readonly OcrPolygonPoint[];
  readonly text: string;
}

export interface OcrEvalDocument {
  readonly blocks: readonly OcrEvalBlock[];
  readonly direction: "ltr" | "rtl" | "ttb" | "unknown";
  readonly language: string | null;
  readonly text: string;
}

function assertImage(image: RgbaImage, label: string): void {
  if (
    !Number.isSafeInteger(image.width) ||
    !Number.isSafeInteger(image.height) ||
    image.width < 1 ||
    image.height < 1 ||
    image.width * image.height > 100_000_000 ||
    image.data.length !== image.width * image.height * 4
  ) {
    throw new TypeError(`${label} must be bounded RGBA.`);
  }
}

function assertSameDimensions(
  left: RgbaImage,
  right: RgbaImage,
  labels: readonly [string, string],
): void {
  assertImage(left, labels[0]);
  assertImage(right, labels[1]);
  if (left.width !== right.width || left.height !== right.height) {
    throw new TypeError(`${labels[0]} and ${labels[1]} dimensions differ.`);
  }
}

function rounded(value: number): number {
  return Number(value.toFixed(6));
}

function pixelSelected(
  mask: RgbaImage | undefined,
  pixelIndex: number,
  inside: boolean,
): boolean {
  if (!mask) {
    return true;
  }
  const selected = mask.data[pixelIndex * 4]! >= 128;
  return inside ? selected : !selected;
}

function rgbError(
  candidate: RgbaImage,
  truth: RgbaImage,
  mask?: RgbaImage,
  inside = true,
): {
  readonly mae: number;
  readonly mse: number;
} {
  assertSameDimensions(candidate, truth, ["candidate", "ground truth"]);
  if (mask) {
    assertSameDimensions(candidate, mask, ["candidate", "mask"]);
  }
  let absolute = 0;
  let squared = 0;
  let channels = 0;
  const pixels = candidate.width * candidate.height;
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    if (!pixelSelected(mask, pixel, inside)) {
      continue;
    }
    const offset = pixel * 4;
    for (let channel = 0; channel < 3; channel += 1) {
      const delta =
        candidate.data[offset + channel]! - truth.data[offset + channel]!;
      absolute += Math.abs(delta);
      squared += delta * delta;
      channels += 1;
    }
  }
  return Object.freeze({
    mae: channels === 0 ? 0 : absolute / channels,
    mse: channels === 0 ? 0 : squared / channels,
  });
}

function psnr(mse: number): number {
  return mse === 0 ? 99 : 10 * Math.log10((255 * 255) / mse);
}

function exactRatio(
  candidate: RgbaImage,
  truth: RgbaImage,
  mask?: RgbaImage,
  inside = true,
): number {
  assertSameDimensions(candidate, truth, ["candidate", "comparison"]);
  if (mask) {
    assertSameDimensions(candidate, mask, ["candidate", "mask"]);
  }
  let exact = 0;
  let selected = 0;
  const pixels = candidate.width * candidate.height;
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    if (!pixelSelected(mask, pixel, inside)) {
      continue;
    }
    const offset = pixel * 4;
    selected += 1;
    if (
      candidate.data[offset] === truth.data[offset] &&
      candidate.data[offset + 1] === truth.data[offset + 1] &&
      candidate.data[offset + 2] === truth.data[offset + 2] &&
      candidate.data[offset + 3] === truth.data[offset + 3]
    ) {
      exact += 1;
    }
  }
  return selected === 0 ? 1 : exact / selected;
}

function luminance(image: RgbaImage, pixel: number): number {
  const offset = pixel * 4;
  return (
    image.data[offset]! * 0.2126 +
    image.data[offset + 1]! * 0.7152 +
    image.data[offset + 2]! * 0.0722
  );
}

function edgeEnergy(image: RgbaImage): number {
  assertImage(image, "image");
  let energy = 0;
  let count = 0;
  for (let y = 1; y < image.height - 1; y += 1) {
    for (let x = 1; x < image.width - 1; x += 1) {
      const pixel = y * image.width + x;
      const horizontal =
        luminance(image, pixel + 1) - luminance(image, pixel - 1);
      const vertical =
        luminance(image, pixel + image.width) -
        luminance(image, pixel - image.width);
      energy += Math.hypot(horizontal, vertical);
      count += 1;
    }
  }
  return count === 0 ? 0 : energy / count;
}

function meanLuminanceError(candidate: RgbaImage, truth: RgbaImage): number {
  assertSameDimensions(candidate, truth, ["candidate", "ground truth"]);
  let error = 0;
  const pixels = candidate.width * candidate.height;
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    error += Math.abs(luminance(candidate, pixel) - luminance(truth, pixel));
  }
  return error / pixels;
}

function clippedRatio(image: RgbaImage): number {
  assertImage(image, "candidate");
  let clipped = 0;
  let visible = 0;
  const pixels = image.width * image.height;
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const offset = pixel * 4;
    if (image.data[offset + 3] === 0) {
      continue;
    }
    visible += 1;
    if (
      image.data[offset]! <= 1 ||
      image.data[offset + 1]! <= 1 ||
      image.data[offset + 2]! <= 1 ||
      image.data[offset]! >= 254 ||
      image.data[offset + 1]! >= 254 ||
      image.data[offset + 2]! >= 254
    ) {
      clipped += 1;
    }
  }
  return visible === 0 ? 0 : clipped / visible;
}

function seamMask(mask: RgbaImage): RgbaImage {
  assertImage(mask, "mask");
  const data = new Uint8Array(mask.data.length);
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      const pixel = y * mask.width + x;
      const selected = mask.data[pixel * 4]! >= 128;
      const neighbors = [
        x > 0 ? pixel - 1 : pixel,
        x + 1 < mask.width ? pixel + 1 : pixel,
        y > 0 ? pixel - mask.width : pixel,
        y + 1 < mask.height ? pixel + mask.width : pixel,
      ];
      const boundary = neighbors.some(
        (neighbor) => mask.data[neighbor * 4]! >= 128 !== selected,
      );
      const value = boundary ? 255 : 0;
      const offset = pixel * 4;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  return Object.freeze({
    data,
    width: mask.width,
    height: mask.height,
  });
}

export function evaluateObjectRemove(options: {
  readonly candidate: RgbaImage;
  readonly expected: RgbaImage;
  readonly mask: RgbaImage;
  readonly source: RgbaImage;
}): Readonly<Record<string, number>> {
  const inside = rgbError(
    options.candidate,
    options.expected,
    options.mask,
    true,
  );
  const seam = rgbError(
    options.candidate,
    options.expected,
    seamMask(options.mask),
    true,
  );
  return Object.freeze({
    outsideMaskExactRatio: rounded(
      exactRatio(options.candidate, options.source, options.mask, false),
    ),
    insideMaskMae: rounded(inside.mae),
    insideMaskPsnr: rounded(psnr(inside.mse)),
    seamMae: rounded(seam.mae),
  });
}

export function evaluateDenoise(options: {
  readonly candidate: RgbaImage;
  readonly clean: RgbaImage;
  readonly noisy: RgbaImage;
}): Readonly<Record<string, number>> {
  const candidate = rgbError(options.candidate, options.clean);
  const baseline = rgbError(options.noisy, options.clean);
  const candidatePsnr = psnr(candidate.mse);
  const baselinePsnr = psnr(baseline.mse);
  const truthEdges = edgeEnergy(options.clean);
  const candidateEdges = edgeEnergy(options.candidate);
  let edgeRetention = candidateEdges === 0 ? 1 : 0;
  if (truthEdges > 0) {
    edgeRetention =
      Math.min(candidateEdges, truthEdges) /
      Math.max(candidateEdges, truthEdges);
  }
  return Object.freeze({
    candidatePsnr: rounded(candidatePsnr),
    baselinePsnr: rounded(baselinePsnr),
    psnrGain: rounded(candidatePsnr - baselinePsnr),
    edgeRetention: rounded(edgeRetention),
    alphaExactRatio: rounded(alphaExactRatio(options.candidate, options.noisy)),
  });
}

function alphaExactRatio(candidate: RgbaImage, source: RgbaImage): number {
  assertSameDimensions(candidate, source, ["candidate", "source"]);
  let exact = 0;
  const pixels = candidate.width * candidate.height;
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    if (candidate.data[pixel * 4 + 3] === source.data[pixel * 4 + 3]) {
      exact += 1;
    }
  }
  return exact / pixels;
}

export function evaluateLightEnhance(options: {
  readonly candidate: RgbaImage;
  readonly expected: RgbaImage;
  readonly source: RgbaImage;
}): Readonly<Record<string, number>> {
  const candidate = rgbError(options.candidate, options.expected);
  const baseline = rgbError(options.source, options.expected);
  return Object.freeze({
    candidateMae: rounded(candidate.mae),
    baselineMae: rounded(baseline.mae),
    maeImprovement: rounded(baseline.mae - candidate.mae),
    luminanceMae: rounded(
      meanLuminanceError(options.candidate, options.expected),
    ),
    clippedRatio: rounded(clippedRatio(options.candidate)),
    alphaExactRatio: rounded(
      alphaExactRatio(options.candidate, options.source),
    ),
  });
}

function normalizedText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function editDistance<T>(left: readonly T[], right: readonly T[]): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1]! + 1,
        previous[rightIndex]! + 1,
        previous[rightIndex - 1]! +
          (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length]!;
}

function errorRate<T>(candidate: readonly T[], truth: readonly T[]): number {
  if (truth.length === 0) {
    return candidate.length === 0 ? 0 : 1;
  }
  return editDistance(candidate, truth) / truth.length;
}

function bounds(polygon: readonly OcrPolygonPoint[]): {
  readonly maximumX: number;
  readonly maximumY: number;
  readonly minimumX: number;
  readonly minimumY: number;
} {
  if (
    polygon.length !== 4 ||
    polygon.some(
      (point) =>
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        point.x < 0 ||
        point.y < 0,
    )
  ) {
    throw new TypeError("OCR Eval polygons must contain four bounded points.");
  }
  return {
    minimumX: Math.min(...polygon.map(({ x }) => x)),
    minimumY: Math.min(...polygon.map(({ y }) => y)),
    maximumX: Math.max(...polygon.map(({ x }) => x)),
    maximumY: Math.max(...polygon.map(({ y }) => y)),
  };
}

function polygonIou(
  left: readonly OcrPolygonPoint[],
  right: readonly OcrPolygonPoint[],
): number {
  const a = bounds(left);
  const b = bounds(right);
  const intersectionWidth = Math.max(
    0,
    Math.min(a.maximumX, b.maximumX) - Math.max(a.minimumX, b.minimumX),
  );
  const intersectionHeight = Math.max(
    0,
    Math.min(a.maximumY, b.maximumY) - Math.max(a.minimumY, b.minimumY),
  );
  const intersection = intersectionWidth * intersectionHeight;
  const areaA = (a.maximumX - a.minimumX) * (a.maximumY - a.minimumY);
  const areaB = (b.maximumX - b.minimumX) * (b.maximumY - b.minimumY);
  const union = areaA + areaB - intersection;
  return union === 0 ? 1 : intersection / union;
}

export function evaluateTextExtract(options: {
  readonly candidate: OcrEvalDocument;
  readonly expected: OcrEvalDocument;
}): Readonly<Record<string, number>> {
  const candidateText = normalizedText(options.candidate.text);
  const expectedText = normalizedText(options.expected.text);
  const blockCount = Math.max(
    options.candidate.blocks.length,
    options.expected.blocks.length,
  );
  let polygonTotal = 0;
  let confidenceError = 0;
  for (let index = 0; index < blockCount; index += 1) {
    const candidate = options.candidate.blocks[index];
    const expected = options.expected.blocks[index];
    polygonTotal +=
      candidate && expected
        ? polygonIou(candidate.polygon, expected.polygon)
        : 0;
    const predicted = candidate?.confidence ?? 0;
    const correct =
      candidate &&
      expected &&
      normalizedText(candidate.text) === normalizedText(expected.text)
        ? 1
        : 0;
    confidenceError += (predicted - correct) ** 2;
  }
  return Object.freeze({
    characterErrorRate: rounded(
      errorRate([...candidateText], [...expectedText]),
    ),
    wordErrorRate: rounded(
      errorRate(
        candidateText ? candidateText.split(" ") : [],
        expectedText ? expectedText.split(" ") : [],
      ),
    ),
    meanPolygonIou: rounded(blockCount === 0 ? 1 : polygonTotal / blockCount),
    confidenceBrierScore: rounded(
      blockCount === 0 ? 0 : confidenceError / blockCount,
    ),
    languageMatch:
      options.candidate.language === options.expected.language ? 1 : 0,
    directionMatch:
      options.candidate.direction === options.expected.direction ? 1 : 0,
  });
}

export function evaluateThresholds(
  metrics: Readonly<Record<string, number>>,
  thresholds: MetricThresholds,
): EvalDecision {
  const failures: string[] = [];
  for (const [metric, threshold] of Object.entries(thresholds)) {
    const actual = metrics[metric];
    if (
      actual === undefined ||
      !Number.isFinite(actual) ||
      !Number.isFinite(threshold.value) ||
      !["gte", "lte", "eq"].includes(threshold.operator)
    ) {
      failures.push(`${metric}:missing_or_invalid`);
      continue;
    }
    let passed = actual === threshold.value;
    if (threshold.operator === "gte") {
      passed = actual >= threshold.value;
    } else if (threshold.operator === "lte") {
      passed = actual <= threshold.value;
    }
    if (!passed) {
      failures.push(
        `${metric}:${String(actual)}_${threshold.operator}_${String(threshold.value)}`,
      );
    }
  }
  return Object.freeze({
    passed: failures.length === 0,
    failures: Object.freeze(failures),
  });
}
