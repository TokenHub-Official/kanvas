import { describe, expect, it } from "vitest";

import {
  buildOpenAiImagesControlPlaneDefinition,
  loadOpenAiImagesControlPlaneConfiguration,
  openAiImagesControlPlaneIds,
} from "../src/cli/bootstrap-openai-images-control-plane.js";

const digest =
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("OpenAI Images control-plane bootstrap", () => {
  it("stays disabled without an explicit opt-in", () => {
    expect(loadOpenAiImagesControlPlaneConfiguration({})).toBeUndefined();
  });

  it("requires deployment-owned secret and endpoint validation evidence", () => {
    expect(() =>
      loadOpenAiImagesControlPlaneConfiguration({
        KANVAS_OPENAI_IMAGES_CONTROL_PLANE_ENABLED: "true",
      }),
    ).toThrow(/DEPLOYMENT_REFERENCE/u);
  });

  it("builds a v2 Images Edit route with an unverified price and bounded risk ceiling", () => {
    const configuration = loadOpenAiImagesControlPlaneConfiguration({
      KANVAS_OPENAI_IMAGES_CONTROL_PLANE_ENABLED: "true",
      KANVAS_OPENAI_IMAGES_DEPLOYMENT_REFERENCE:
        "deployment://openai/images-primary",
      KANVAS_OPENAI_IMAGES_SECRET_FINGERPRINT: digest,
      KANVAS_OPENAI_IMAGES_ENDPOINT_VALIDATION_DIGEST: digest,
      KANVAS_OPENAI_IMAGES_ENDPOINT_VALIDATED_AT: "2020-08-03T11:00:00.000Z",
    });
    expect(configuration).toBeDefined();
    const definition = buildOpenAiImagesControlPlaneDefinition({
      configuration: configuration!,
      instanceId: "kanvas-local",
      workspaceId: "01K00000000000000000000000",
    });
    expect(definition.routePolicyDocument).toMatchObject({
      apiSurface: "images.edits.v1",
      providerEndpointId: openAiImagesControlPlaneIds.endpoint,
      maximumCharge: {
        currencyCode: "USD",
        amount: "2",
      },
      queryMode: "none",
      notFoundIsAuthoritative: false,
    });
    expect(definition.pricingDocument).toEqual({
      schemaVersion: 1,
      billingMode: "unverified",
      reason: "provider_price_evidence_missing",
      evidence: {
        priceVerified: false,
        sourceKind: "unverified",
        sourceReference: "none",
        maximumChargeRole: "risk_ceiling_only",
        revisionVerifiedAtRole: "risk_ceiling_reviewed_at",
      },
    });
    expect(definition.pricingRevisionSourceKind).toBe("unverified");
  });
});
