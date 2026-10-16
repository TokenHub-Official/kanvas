export const developmentProxyStartupGraceMilliseconds = 45_000;
export const developmentProxyRetryMilliseconds = 1_000;

export function isConnectionRefused(error: unknown): boolean {
  return (
    error instanceof Error && "code" in error && error.code === "ECONNREFUSED"
  );
}

export function isExpectedStartupProxyRefusal(
  message: string,
  elapsedMilliseconds: number,
): boolean {
  return (
    elapsedMilliseconds <= developmentProxyStartupGraceMilliseconds &&
    message.includes("http proxy error:") &&
    message.includes("ECONNREFUSED")
  );
}
