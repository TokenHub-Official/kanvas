const maximumActivePercent = 99;

export function modelResourceDownloadPercent(
  downloadedBytes: string,
  expectedByteSize: string | undefined,
): number | undefined {
  if (!expectedByteSize) return undefined;
  try {
    const downloaded = BigInt(downloadedBytes);
    const expected = BigInt(expectedByteSize);
    if (downloaded < 0n || expected <= 0n) return undefined;
    return Math.min(
      maximumActivePercent,
      Number((downloaded * 100n) / expected),
    );
  } catch {
    return undefined;
  }
}
