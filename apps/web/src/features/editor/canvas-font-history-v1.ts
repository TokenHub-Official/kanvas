const maximumRecentFonts = 6;

function storageKey(workspaceId: string): string {
  return `kanvas:canvas:recent-fonts:${workspaceId}`;
}

export function readRecentCanvasFontsV1(
  workspaceId: string,
  storage?: Pick<Storage, "getItem">,
): readonly string[] {
  try {
    const target = storage ?? globalThis.localStorage;
    if (!target) return [];
    const value: unknown = JSON.parse(
      target.getItem(storageKey(workspaceId)) ?? "[]",
    );
    return Array.isArray(value)
      ? value
          .filter((item): item is string => typeof item === "string")
          .slice(0, maximumRecentFonts)
      : [];
  } catch {
    return [];
  }
}

export function addRecentCanvasFontV1(
  current: readonly string[],
  fontId: string,
): readonly string[] {
  return [fontId, ...current.filter((item) => item !== fontId)].slice(
    0,
    maximumRecentFonts,
  );
}

export function saveRecentCanvasFontsV1(
  workspaceId: string,
  fonts: readonly string[],
  storage?: Pick<Storage, "setItem">,
): void {
  try {
    const target = storage ?? globalThis.localStorage;
    target?.setItem(storageKey(workspaceId), JSON.stringify(fonts));
  } catch {
    // Recent choices are an optional convenience and never block editing.
  }
}
