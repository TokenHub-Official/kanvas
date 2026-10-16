interface AdoptionIdentity {
  readonly externalId: string;
  readonly sourceRevisionId: string;
  readonly license: { readonly termsDigest: string };
}

export async function resourceAdoptionIdempotencyKey(
  candidate: AdoptionIdentity,
): Promise<string> {
  const input = new TextEncoder().encode(
    JSON.stringify({
      sourceRevisionId: candidate.sourceRevisionId,
      externalId: candidate.externalId,
      termsDigest: candidate.license.termsDigest,
    }),
  );
  const digest = await crypto.subtle.digest("SHA-256", input);
  const hex = [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return `resource-adoption:${candidate.sourceRevisionId}:${hex}`;
}
