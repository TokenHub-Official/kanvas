import { deterministicImageDerivedPngAdapter } from "./nonproduction-deterministic-image-adapter.js";
import {
  createU2NetBackgroundRemoveAdapter,
  createU2NetModelResourceRuntimeResolver,
  u2netBackgroundRemoveAdapterKey,
  u2netBackgroundRemoveWebpAdapterKey,
} from "./u2net-background-remove-adapter.js";
import {
  createU2NetSubjectDetectAdapter,
  u2netSubjectDetectAdapterKey,
} from "./u2net-subject-detect-adapter.js";
import { sharpImageResizeAdapter } from "./image-upscale-adapter.js";
import { faithfulImageDenoiseAdapter } from "./image-denoise-adapter.js";
import { imageLightEnhanceAdapter } from "./image-light-enhance-adapter.js";
import {
  imageCropSuggestAdapter,
  imageQualityAssessAdapter,
} from "./batch-c-image-analysis-adapters.js";
import { imageBackgroundComposeAdapter } from "./image-background-compose-adapter.js";
import { tesseractTextExtractAdapter } from "./tesseract-text-extract-adapter.js";
import {
  createWorkerAdapterRegistry,
  type WorkerAdapter,
  type WorkerAdapterExecutionContext,
  type WorkerAdapterRegistry,
} from "./worker-adapter.js";

export interface CreateWorkerRuntimeAdapterRegistryOptions {
  readonly deterministicImageAdapterEnabled: boolean;
}

function requireRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Adapter input must be an object.");
  }
  return value as Readonly<Record<string, unknown>>;
}

function requireString(
  record: Readonly<Record<string, unknown>>,
  property: string,
): string {
  const value = record[property];
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`Adapter input ${property} must be a string.`);
  }
  return value;
}

const demoEchoWorkerAdapter: WorkerAdapter = Object.freeze({
  adapterKey: "demo.echo.worker",
  execute(input: unknown, signal: AbortSignal) {
    signal.throwIfAborted();
    const record = requireRecord(input);
    const message = requireString(record, "message");
    signal.throwIfAborted();
    return Promise.resolve(
      Object.freeze({
        protocol: "kanvas.worker-adapter-result/v1" as const,
        capabilityOutput: Object.freeze({
          message,
        }),
        outputs: Object.freeze([]),
      }),
    );
  },
});

export function createWorkerRuntimeAdapterRegistry(
  options: CreateWorkerRuntimeAdapterRegistryOptions,
): WorkerAdapterRegistry {
  const u2netRuntime = createU2NetModelResourceRuntimeResolver();
  const modelResourceBackgroundRemove = (
    adapterKey:
      | typeof u2netBackgroundRemoveAdapterKey
      | typeof u2netBackgroundRemoveWebpAdapterKey,
    foregroundEncoding: "png" | "webp_lossless",
  ): WorkerAdapter =>
    Object.freeze({
      adapterKey,
      async execute(
        input: unknown,
        signal: AbortSignal,
        context: WorkerAdapterExecutionContext,
      ) {
        const runtime = await u2netRuntime.resolve(context, signal);
        return createU2NetBackgroundRemoveAdapter({
          adapterKey,
          foregroundEncoding,
          inference: runtime.inference,
          model: runtime.model,
        }).execute(input, signal, context);
      },
    });
  const modelResourceSubjectDetect: WorkerAdapter = Object.freeze({
    adapterKey: u2netSubjectDetectAdapterKey,
    async execute(
      input: unknown,
      signal: AbortSignal,
      context: WorkerAdapterExecutionContext,
    ) {
      const runtime = await u2netRuntime.resolve(context, signal);
      return createU2NetSubjectDetectAdapter({
        inference: runtime.inference,
        model: runtime.model,
      }).execute(input, signal, context);
    },
  });
  return createWorkerAdapterRegistry([
    demoEchoWorkerAdapter,
    sharpImageResizeAdapter,
    faithfulImageDenoiseAdapter,
    imageLightEnhanceAdapter,
    imageCropSuggestAdapter,
    imageQualityAssessAdapter,
    imageBackgroundComposeAdapter,
    tesseractTextExtractAdapter,
    modelResourceBackgroundRemove(u2netBackgroundRemoveAdapterKey, "png"),
    modelResourceBackgroundRemove(
      u2netBackgroundRemoveWebpAdapterKey,
      "webp_lossless",
    ),
    modelResourceSubjectDetect,
    ...(options.deterministicImageAdapterEnabled
      ? [deterministicImageDerivedPngAdapter]
      : []),
  ]);
}
