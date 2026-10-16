import type { EditorArtifactRuntimeResourceV1 } from "./editor-document-v1.js";

const DEFAULT_ARTIFACT_LOAD_CONCURRENCY = 4;

export async function loadCanvasArtifactResourcesV1({
  artifactIds,
  concurrency = DEFAULT_ARTIFACT_LOAD_CONCURRENCY,
  onResource,
  resolveArtifactPreview,
  resolveArtifactSource,
  signal,
}: {
  readonly artifactIds: readonly string[];
  readonly concurrency?: number;
  readonly onResource: (resource: EditorArtifactRuntimeResourceV1) => void;
  readonly resolveArtifactPreview?: (
    artifactId: string,
    signal: AbortSignal,
  ) => Promise<string>;
  readonly resolveArtifactSource?: (
    artifactId: string,
    signal: AbortSignal,
  ) => Promise<string>;
  readonly signal: AbortSignal;
}): Promise<void> {
  const queue = [...new Set(artifactIds)];
  const previewAvailable = new Set<string>();
  const loadOne = async (
    artifactId: string,
    resolve: (artifactId: string, signal: AbortSignal) => Promise<string>,
    quality: "original" | "preview",
  ) => {
    try {
      const sourceUrl = await resolve(artifactId, signal);
      if (!signal.aborted) {
        if (quality === "preview") previewAvailable.add(artifactId);
        onResource({
          artifactId,
          ...(resolveArtifactPreview ? { sourceQuality: quality } : {}),
          sourceUnavailable: false,
          sourceUrl,
        });
      }
    } catch {
      if (
        !signal.aborted &&
        quality === "original" &&
        !previewAvailable.has(artifactId)
      ) {
        onResource({ artifactId, sourceUnavailable: true });
      }
    }
  };
  const runQueue = async (
    items: readonly string[],
    workerCount: number,
    work: (artifactId: string) => Promise<void>,
  ) => {
    let nextIndex = 0;
    const worker = async () => {
      while (!signal.aborted) {
        const index = nextIndex;
        nextIndex += 1;
        const artifactId = items[index];
        if (!artifactId) return;
        await work(artifactId);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(items.length, workerCount) }, worker),
    );
  };

  const normalizedConcurrency = Math.max(1, Math.floor(concurrency));
  if (!resolveArtifactPreview && resolveArtifactSource) {
    await runQueue(queue, normalizedConcurrency, (artifactId) =>
      loadOne(artifactId, resolveArtifactSource, "original"),
    );
    return;
  }
  if (!resolveArtifactPreview) return;

  const originalConcurrency = Math.max(
    1,
    Math.floor(normalizedConcurrency / 2),
  );
  const originalChains = Array.from(
    { length: Math.min(queue.length, originalConcurrency) },
    () => Promise.resolve(),
  );
  let nextOriginalChain = 0;
  const scheduleOriginal = (artifactId: string) => {
    if (!resolveArtifactSource || originalChains.length === 0) return;
    const chainIndex = nextOriginalChain % originalChains.length;
    nextOriginalChain += 1;
    originalChains[chainIndex] = originalChains[chainIndex]!.then(() =>
      loadOne(artifactId, resolveArtifactSource, "original"),
    );
  };
  await runQueue(queue, normalizedConcurrency, async (artifactId) => {
    await loadOne(artifactId, resolveArtifactPreview, "preview");
    scheduleOriginal(artifactId);
  });
  if (!signal.aborted) {
    await Promise.all(originalChains);
  }
}
