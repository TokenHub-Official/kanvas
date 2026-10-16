import type {
  WorkerAdapter,
  WorkerAdapterExecutionContext,
} from "./worker-adapter.js";
import {
  consumeBoundedImageBody,
  decodeImageSource,
  imageOutputBody,
  imageSha256,
  normalizeU2NetMask,
  prepareU2NetModelInput,
  renderU2NetMask,
  type DecodedSource,
  type U2NetInference,
  type U2NetModelBundle,
} from "./u2net-background-remove-adapter.js";

export const u2netSubjectDetectAdapterKey =
  "first-party.image.subject-detect.isnet.v1";

const artifactIdPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;

interface SubjectDetectInput {
  readonly sourceArtifactId: string;
  readonly maxSubjects: number;
  readonly minimumAreaRatio: number;
  readonly minimumConfidence: number;
  readonly includeMask: boolean;
}

interface SubjectComponent {
  readonly area: number;
  readonly confidence: number;
  readonly maximumX: number;
  readonly maximumY: number;
  readonly minimumX: number;
  readonly minimumY: number;
}

function requireInput(value: unknown): SubjectDetectInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Subject detection input must be an object.");
  }
  const record = value as Readonly<Record<string, unknown>>;
  const sourceArtifactId = record.sourceArtifactId;
  const maxSubjects = record.maxSubjects ?? 8;
  const minimumAreaRatio = record.minimumAreaRatio ?? 0.001;
  const minimumConfidence = record.minimumConfidence ?? 0.35;
  const includeMask = record.includeMask ?? true;
  if (
    typeof sourceArtifactId !== "string" ||
    !artifactIdPattern.test(sourceArtifactId) ||
    !Number.isSafeInteger(maxSubjects) ||
    Number(maxSubjects) < 1 ||
    Number(maxSubjects) > 16 ||
    typeof minimumAreaRatio !== "number" ||
    !Number.isFinite(minimumAreaRatio) ||
    minimumAreaRatio < 0.000_01 ||
    minimumAreaRatio > 0.5 ||
    typeof minimumConfidence !== "number" ||
    !Number.isFinite(minimumConfidence) ||
    minimumConfidence < 0.05 ||
    minimumConfidence > 0.95 ||
    typeof includeMask !== "boolean" ||
    Object.keys(record).some(
      (key) =>
        key !== "sourceArtifactId" &&
        key !== "maxSubjects" &&
        key !== "minimumAreaRatio" &&
        key !== "minimumConfidence" &&
        key !== "includeMask",
    )
  ) {
    throw new TypeError(
      "Subject detection input does not match kanvas.image-subject-detect-input/v1.",
    );
  }
  return Object.freeze({
    sourceArtifactId,
    maxSubjects: Number(maxSubjects),
    minimumAreaRatio,
    minimumConfidence,
    includeMask,
  });
}

function connectedSubjectComponents(options: {
  readonly mask: Uint8Array;
  readonly inputSize: number;
  readonly minimumAreaRatio: number;
  readonly minimumConfidence: number;
  readonly signal: AbortSignal;
}): readonly SubjectComponent[] {
  const pixelCount = options.inputSize * options.inputSize;
  if (options.mask.length !== pixelCount) {
    throw new Error("Subject detection mask dimensions are inconsistent.");
  }
  const threshold = Math.round(options.minimumConfidence * 255);
  const minimumArea = Math.max(
    1,
    Math.ceil(options.minimumAreaRatio * pixelCount),
  );
  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  const components: SubjectComponent[] = [];
  for (let start = 0; start < pixelCount; start += 1) {
    if (visited[start] === 1 || Number(options.mask[start]) < threshold) {
      continue;
    }
    let head = 0;
    let tail = 0;
    queue[tail] = start;
    tail += 1;
    visited[start] = 1;
    let area = 0;
    let confidenceSum = 0;
    let minimumX = options.inputSize;
    let minimumY = options.inputSize;
    let maximumX = 0;
    let maximumY = 0;
    while (head < tail) {
      if ((head & 16_383) === 0) {
        options.signal.throwIfAborted();
      }
      const index = Number(queue[head]);
      head += 1;
      const x = index % options.inputSize;
      const y = Math.floor(index / options.inputSize);
      area += 1;
      confidenceSum += Number(options.mask[index]);
      minimumX = Math.min(minimumX, x);
      minimumY = Math.min(minimumY, y);
      maximumX = Math.max(maximumX, x);
      maximumY = Math.max(maximumY, y);
      const neighbors = [
        x > 0 ? index - 1 : -1,
        x + 1 < options.inputSize ? index + 1 : -1,
        y > 0 ? index - options.inputSize : -1,
        y + 1 < options.inputSize ? index + options.inputSize : -1,
      ];
      for (const neighbor of neighbors) {
        if (
          neighbor >= 0 &&
          visited[neighbor] === 0 &&
          Number(options.mask[neighbor]) >= threshold
        ) {
          visited[neighbor] = 1;
          queue[tail] = neighbor;
          tail += 1;
        }
      }
    }
    if (area >= minimumArea) {
      components.push(
        Object.freeze({
          area,
          confidence: confidenceSum / area / 255,
          minimumX,
          minimumY,
          maximumX,
          maximumY,
        }),
      );
    }
  }
  return Object.freeze(
    components.sort(
      (left, right) =>
        right.area - left.area ||
        right.confidence - left.confidence ||
        left.minimumY - right.minimumY ||
        left.minimumX - right.minimumX,
    ),
  );
}

function rounded(value: number): number {
  return Number(value.toFixed(6));
}

function subjectCandidates(
  components: readonly SubjectComponent[],
  source: Pick<DecodedSource, "width" | "height">,
  inputSize: number,
  maximum: number,
) {
  const pixelCount = inputSize * inputSize;
  return Object.freeze(
    components.slice(0, maximum).map((component, index) => {
      const x = Math.floor((component.minimumX / inputSize) * source.width);
      const y = Math.floor((component.minimumY / inputSize) * source.height);
      const right = Math.min(
        source.width,
        Math.ceil(((component.maximumX + 1) / inputSize) * source.width),
      );
      const bottom = Math.min(
        source.height,
        Math.ceil(((component.maximumY + 1) / inputSize) * source.height),
      );
      return Object.freeze({
        subjectId: `subject-${String(index + 1)}`,
        rank: index + 1,
        category: "visual_subject" as const,
        confidence: rounded(component.confidence),
        areaRatio: rounded(component.area / pixelCount),
        bounds: Object.freeze({
          x,
          y,
          width: Math.max(1, right - x),
          height: Math.max(1, bottom - y),
        }),
        normalizedBounds: Object.freeze({
          x: rounded(x / source.width),
          y: rounded(y / source.height),
          width: rounded(Math.max(1, right - x) / source.width),
          height: rounded(Math.max(1, bottom - y) / source.height),
        }),
      });
    }),
  );
}

function outputReference() {
  return Object.freeze({
    $kanvas: "attempt-output-artifact/v1" as const,
    outputRole: "mask",
    outputIndex: 0,
  });
}

export function createU2NetSubjectDetectAdapter(options: {
  readonly inference: U2NetInference;
  readonly model: Pick<
    U2NetModelBundle,
    "inputSize" | "normalization" | "sha256" | "variant"
  >;
}): WorkerAdapter {
  return Object.freeze({
    adapterKey: u2netSubjectDetectAdapterKey,
    async execute(
      value: unknown,
      signal: AbortSignal,
      context: WorkerAdapterExecutionContext,
    ) {
      const input = requireInput(value);
      const sourceArtifact = await context.inputArtifacts.open({
        inputPointer: "/sourceArtifactId",
      });
      const sourceBytes = await consumeBoundedImageBody(
        sourceArtifact.body,
        signal,
      );
      if (imageSha256(sourceBytes) !== sourceArtifact.sha256) {
        throw new Error("Subject detection source digest is inconsistent.");
      }
      const [source, preparedInput] = await Promise.all([
        decodeImageSource(sourceBytes, signal),
        prepareU2NetModelInput(sourceBytes, options.model, signal),
      ]);
      const inference = await options.inference.infer(preparedInput, signal);
      const rawMask =
        inference instanceof Float32Array ? inference : inference.mask;
      const normalizedMask = normalizeU2NetMask(
        rawMask,
        options.model.inputSize,
      );
      const components = connectedSubjectComponents({
        mask: normalizedMask,
        inputSize: options.model.inputSize,
        minimumAreaRatio: input.minimumAreaRatio,
        minimumConfidence: input.minimumConfidence,
        signal,
      });
      const candidates = subjectCandidates(
        components,
        source,
        options.model.inputSize,
        input.maxSubjects,
      );
      const renderedMask = await renderU2NetMask({
        mask: normalizedMask,
        refinement: "standard",
        inputSize: options.model.inputSize,
        width: source.width,
        height: source.height,
        signal,
      });
      const maskSha256 = imageSha256(renderedMask.png);
      return Object.freeze({
        protocol: "kanvas.worker-adapter-result/v1" as const,
        capabilityOutput: Object.freeze({
          schemaVersion: "kanvas.image-subject-detect-result/v1" as const,
          sourceWidth: source.width,
          sourceHeight: source.height,
          candidates,
          maskArtifactId: input.includeMask ? outputReference() : null,
          qualitySignals: Object.freeze({
            schemaVersion: "kanvas.image-subject-detect-quality/v1" as const,
            candidateCount: candidates.length,
            foregroundRatio: rounded(renderedMask.foregroundRatio),
            uncertainEdgeRatio: rounded(renderedMask.uncertainEdgeRatio),
            taxonomy: "class_agnostic_isnet" as const,
            modelVariant: options.model.variant,
            modelDigest: `sha256:${options.model.sha256}`,
          }),
        }),
        outputs: input.includeMask
          ? Object.freeze([
              Object.freeze({
                outputRole: "mask",
                outputIndex: 0,
                artifactType: "image.mask",
                metadata: Object.freeze({
                  operation: "image.subject.detect",
                  role: "subject-mask",
                  width: source.width,
                  height: source.height,
                  sourceArtifactId: input.sourceArtifactId,
                  sourceSha256: sourceArtifact.sha256,
                  modelVariant: options.model.variant,
                  modelSha256: options.model.sha256,
                  taxonomy: "class_agnostic_isnet",
                }),
                mediaType: "image/png" as const,
                byteSize: renderedMask.png.byteLength.toString(),
                sha256: maskSha256,
                body: imageOutputBody(renderedMask.png, signal),
              }),
            ])
          : Object.freeze([]),
      });
    },
  });
}
