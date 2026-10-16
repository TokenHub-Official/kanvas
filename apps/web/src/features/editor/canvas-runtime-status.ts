export const canvasRuntimeOfflineMessage =
  "本机处理暂时离线；连接恢复后会自动重试。";

export function canvasRuntimeErrorMessage(
  error: unknown,
  fallback: string,
  online = typeof navigator === "undefined" ? true : navigator.onLine,
): string {
  if (
    !online ||
    (error instanceof TypeError &&
      error.message.toLocaleLowerCase("en-US") === "failed to fetch")
  ) {
    return canvasRuntimeOfflineMessage;
  }
  return fallback;
}

export function isCanvasRuntimeOfflineMessage(
  message: string | undefined,
): boolean {
  return message === canvasRuntimeOfflineMessage;
}
