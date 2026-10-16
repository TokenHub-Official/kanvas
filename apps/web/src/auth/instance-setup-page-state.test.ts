import { describe, expect, it } from "vitest";

import {
  createInstanceSetupPageState,
  reduceInstanceSetupPage,
} from "./instance-setup-page-state.js";

describe("reduceInstanceSetupPage", () => {
  it("derives a slug from the name until the user edits it", () => {
    const initial = createInstanceSetupPageState("setup-token");
    const named = reduceInstanceSetupPage(initial, {
      type: "organization_name_changed",
      value: "Kanvas Studio",
    });
    const touched = reduceInstanceSetupPage(named, {
      type: "organization_slug_changed",
      value: "custom-studio",
    });

    expect(
      reduceInstanceSetupPage(touched, {
        type: "organization_name_changed",
        value: "Renamed Studio",
      }),
    ).toMatchObject({
      organizationName: "Renamed Studio",
      organizationSlug: "custom-studio",
      organizationSlugTouched: true,
    });
  });

  it("reveals URL settings when slug validation fails", () => {
    const initial = createInstanceSetupPageState("setup-token");

    expect(
      reduceInstanceSetupPage(initial, {
        type: "validation_failed",
        fieldErrors: { workspaceSlug: "workspaceSlugRequired" },
        revealUrlSettings: true,
      }),
    ).toMatchObject({
      fieldErrors: { workspaceSlug: "workspaceSlugRequired" },
      urlSettingsOpen: true,
    });
  });

  it("invalidates the setup link without losing recovery state", () => {
    const submitting = reduceInstanceSetupPage(
      createInstanceSetupPageState("setup-token"),
      { type: "submission_started" },
    );

    expect(
      reduceInstanceSetupPage(submitting, { type: "token_rejected" }),
    ).toMatchObject({
      setupLinkUnavailable: true,
      setupToken: "",
      submitting: true,
    });
  });
});
