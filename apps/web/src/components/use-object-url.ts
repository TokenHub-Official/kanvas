import { useCallback, useSyncExternalStore } from "react";

interface ObjectUrlEntry {
  readonly url: string;
  subscribers: number;
}

const objectUrls = new WeakMap<Blob, ObjectUrlEntry>();

function subscribeToObjectUrl(
  blob: Blob | undefined,
  notify: () => void,
): () => void {
  if (!blob) {
    return () => undefined;
  }

  const existing = objectUrls.get(blob);
  const entry = existing ?? {
    subscribers: 0,
    url: URL.createObjectURL(blob),
  };
  entry.subscribers += 1;
  objectUrls.set(blob, entry);
  notify();

  return () => {
    entry.subscribers -= 1;
    if (entry.subscribers === 0) {
      URL.revokeObjectURL(entry.url);
      objectUrls.delete(blob);
    }
  };
}

export function useObjectUrl(blob: Blob | undefined): string | undefined {
  const subscribe = useCallback(
    (notify: () => void) => subscribeToObjectUrl(blob, notify),
    [blob],
  );
  const getSnapshot = useCallback(
    () => (blob ? objectUrls.get(blob)?.url : undefined),
    [blob],
  );

  return useSyncExternalStore(subscribe, getSnapshot, () => undefined);
}
