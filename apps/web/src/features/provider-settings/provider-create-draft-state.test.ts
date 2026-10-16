import { describe, expect, it } from "vitest";

import {
  initialProviderCreateDraftState,
  reduceProviderCreateDraft,
} from "./provider-create-draft-state.js";

describe("reduceProviderCreateDraft", () => {
  it("resets the entire draft when creation closes", () => {
    const edited = reduceProviderCreateDraft(
      {
        ...initialProviderCreateDraftState,
        open: true,
      },
      {
        type: "api_key_changed",
        value: "secret",
      },
    );

    expect(reduceProviderCreateDraft(edited, { type: "close" })).toEqual(
      initialProviderCreateDraftState,
    );
  });

  it("invalidates dependent base URL state when the preset changes", () => {
    expect(
      reduceProviderCreateDraft(
        {
          ...initialProviderCreateDraftState,
          baseUrl: "https://old.example",
          fieldErrors: {
            baseUrl: "Invalid URL",
          },
          formError: "Previous request failed",
        },
        {
          type: "preset_changed",
          preset: "openai",
        },
      ),
    ).toEqual({
      ...initialProviderCreateDraftState,
      preset: "openai",
    });
  });

  it("clears the rejected secret while preserving other draft fields", () => {
    expect(
      reduceProviderCreateDraft(
        {
          ...initialProviderCreateDraftState,
          apiKey: "rejected",
          displayName: "Primary",
          open: true,
        },
        {
          type: "request_failed",
          apiKeyError: "Invalid key",
          error: "Provider rejected the request",
        },
      ),
    ).toMatchObject({
      apiKey: "",
      displayName: "Primary",
      fieldErrors: {
        apiKey: "Invalid key",
      },
      formError: "Provider rejected the request",
      open: true,
    });
  });
});
