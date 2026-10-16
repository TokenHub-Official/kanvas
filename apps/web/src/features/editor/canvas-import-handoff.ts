const pendingImports = new Map<string, readonly File[]>();

export function stageCanvasImportFiles(files: readonly File[]): string {
  const token = crypto.randomUUID();
  pendingImports.set(token, [...files]);
  return token;
}

export function readCanvasImportFiles(
  token: string | undefined,
): readonly File[] {
  return token ? (pendingImports.get(token) ?? []) : [];
}

export function clearCanvasImportFiles(token: string | undefined): void {
  if (token) {
    pendingImports.delete(token);
  }
}
