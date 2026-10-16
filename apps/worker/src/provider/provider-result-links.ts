import {
  captureProviderResultEvidence,
  type ProviderResultEvidence,
} from "@kanvas/database/runtime";
import type { ProviderHttpTransport } from "./provider-http-transport.js";

/** Evidence is private; only policy-approved links may be exposed as fallback downloads. */
export function confirmedResultLinks(
  transport: ProviderHttpTransport,
  candidates: readonly unknown[],
): {
  readonly resultUrls?: readonly string[];
  readonly resultEvidence: ProviderResultEvidence;
} {
  const resultEvidence = captureProviderResultEvidence(
    candidates.filter((value) => value !== undefined),
  );
  const resultUrls = [
    ...new Set(
      resultEvidence.urls
        .filter(
          (value): value is string =>
            typeof value === "string" &&
            transport.isResultUrlAllowed?.(value) === true,
        )
        .map((value) => new URL(value).href),
    ),
  ].slice(0, 16);
  return { resultEvidence, ...(resultUrls.length ? { resultUrls } : {}) };
}
