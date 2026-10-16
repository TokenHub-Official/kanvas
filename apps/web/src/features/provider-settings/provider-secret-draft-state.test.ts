import type { ProviderSettingSummary } from "@kanvas/contracts/api";
import { describe, expect, it } from "vitest";

import {
  initialProviderSecretDraftState,
  reduceProviderSecretDraft,
} from "./provider-secret-draft-state.js";

const provider = {
  id: "provider-01",
  displayName: "Primary",
} as ProviderSettingSummary;

describe("reduceProviderSecretDraft", () => {
  it("opens and closes a secret operation as one state", () => {
    const opened = reduceProviderSecretDraft(initialProviderSecretDraftState, {
      type: "open",
      target: provider,
    });

    expect(opened).toEqual({
      apiKey: "",
      target: provider,
    });
    expect(reduceProviderSecretDraft(opened, { type: "close" })).toEqual(
      initialProviderSecretDraftState,
    );
  });

  it("clears stale errors when the key changes", () => {
    const failed = reduceProviderSecretDraft(
      {
        apiKey: "old",
        target: provider,
      },
      {
        type: "request_failed",
        clearApiKey: true,
        error: "Request failed",
        fieldError: "Invalid key",
      },
    );

    expect(
      reduceProviderSecretDraft(failed, {
        type: "key_changed",
        apiKey: "replacement",
      }),
    ).toEqual({
      apiKey: "replacement",
      target: provider,
    });
  });
});
