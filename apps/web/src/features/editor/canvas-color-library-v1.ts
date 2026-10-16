const hexPattern = /^#?([0-9a-f]{6})$/i;

export function normalizeCanvasHexColorV1(value: string): string | undefined {
  const match = hexPattern.exec(value.trim());
  return match ? `#${match[1]!.toLowerCase()}` : undefined;
}
export function addRecentCanvasColorV1(
  current: readonly string[],
  color: string,
  limit = 12,
): readonly string[] {
  const normalized = normalizeCanvasHexColorV1(color);
  if (!normalized || limit <= 0) {
    return current;
  }
  return [
    normalized,
    ...current.filter(
      (candidate) => normalizeCanvasHexColorV1(candidate) !== normalized,
    ),
  ].slice(0, limit);
}

export function canvasColorStorageKeyV1(workspaceId: string): string {
  return `kanvas.canvas-colors.${workspaceId}.v1`;
}

export function readRecentCanvasColorsV1(
  workspaceId: string,
): readonly string[] {
  if (typeof localStorage === "undefined") {
    return [];
  }
  try {
    const value = JSON.parse(
      localStorage.getItem(canvasColorStorageKeyV1(workspaceId)) ?? "[]",
    ) as unknown;
    if (!Array.isArray(value)) {
      return [];
    }
    return value.flatMap((candidate) => {
      if (typeof candidate !== "string") {
        return [];
      }
      const normalized = normalizeCanvasHexColorV1(candidate);
      return normalized ? [normalized] : [];
    });
  } catch {
    return [];
  }
}

export function saveRecentCanvasColorsV1(
  workspaceId: string,
  colors: readonly string[],
): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(
      canvasColorStorageKeyV1(workspaceId),
      JSON.stringify(colors),
    );
  } catch {
    // Recent colors are a convenience and never block editing.
  }
}
