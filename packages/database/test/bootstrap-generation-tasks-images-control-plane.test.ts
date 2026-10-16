import { describe, expect, it } from "vitest";

import {
  buildGenerationTasksImagesControlPlaneDefinition,
  loadGenerationTasksImagesControlPlaneConfiguration,
} from "../src/cli/bootstrap-generation-tasks-images-control-plane.js";
import { buildImageProviderSharedPolicyDefinition } from "../src/cli/bootstrap-image-provider-shared-policy.js";
import {
  generationTasksImagesResourceIds,
  openAiImagesResourceIds,
} from "../src/cli/image-provider-control-plane-ids.js";

const digest =
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("Generation Tasks Images control-plane bootstrap", () => {
  it("stays disabled without explicit deployment evidence", () => {
    expect(
      loadGenerationTasksImagesControlPlaneConfiguration({}),
    ).toBeUndefined();
  });

  it("requires a deployment-owned Secret reference and validation evidence", () => {
    expect(() =>
      loadGenerationTasksImagesControlPlaneConfiguration({
        KANVAS_GENERATION_TASKS_IMAGES_CONTROL_PLANE_ENABLED: "true",
      }),
    ).toThrow(/DEPLOYMENT_REFERENCE/u);
  });

  it("requires a fixed price until the TokenHub charge contract is final", () => {
    expect(() =>
      loadGenerationTasksImagesControlPlaneConfiguration({
        KANVAS_GENERATION_TASKS_IMAGES_CONTROL_PLANE_ENABLED: "true",
        KANVAS_GENERATION_TASKS_IMAGES_DEPLOYMENT_REFERENCE:
          "deployment://tokenhub/images-primary",
        KANVAS_GENERATION_TASKS_IMAGES_SECRET_FINGERPRINT: digest,
        KANVAS_GENERATION_TASKS_IMAGES_ENDPOINT_VALIDATION_DIGEST: digest,
        KANVAS_GENERATION_TASKS_IMAGES_ENDPOINT_VALIDATED_AT:
          "2020-08-03T11:00:00.000Z",
      }),
    ).toThrow(/FIXED_CHARGE_AMOUNT/u);
  });

  it("builds a queryable TokenHub route with fixed pricing evidence", () => {
    const configuration = loadGenerationTasksImagesControlPlaneConfiguration({
      KANVAS_GENERATION_TASKS_IMAGES_CONTROL_PLANE_ENABLED: "true",
      KANVAS_GENERATION_TASKS_IMAGES_DEPLOYMENT_REFERENCE:
        "deployment://tokenhub/images-primary",
      KANVAS_GENERATION_TASKS_IMAGES_SECRET_FINGERPRINT: digest,
      KANVAS_GENERATION_TASKS_IMAGES_ENDPOINT_VALIDATION_DIGEST: digest,
      KANVAS_GENERATION_TASKS_IMAGES_FIXED_CHARGE_AMOUNT: "0.72",
      KANVAS_GENERATION_TASKS_IMAGES_PRICING_EVIDENCE_REFERENCE:
        "contract://tokenhub/gpt-image-2/default",
      KANVAS_GENERATION_TASKS_IMAGES_PRICING_EVIDENCE_DIGEST: digest,
      KANVAS_GENERATION_TASKS_IMAGES_ENDPOINT_VALIDATED_AT:
        "2020-08-03T11:00:00.000Z",
    });
    expect(configuration).toBeDefined();
    const definition = buildGenerationTasksImagesControlPlaneDefinition({
      configuration: configuration!,
      instanceId: "kanvas-local",
      workspaceId: "01K00000000000000000000000",
    });

    expect(definition.routePolicyDocument).toMatchObject({
      providerKey: "tokenhub",
      apiSurface: "generation.tasks.v1",
      providerEndpointId: generationTasksImagesResourceIds.endpoint,
      routingMode: "gateway_managed",
      executionTransparency: "partial",
      maximumCharge: {
        currencyCode: "USD",
        amount: "1",
      },
      queryMode: "provider_request_id",
      notFoundIsAuthoritative: false,
    });
    expect(definition.pricingDocument).toEqual({
      schemaVersion: 1,
      billingMode: "fixed",
      fixedChargeAmount: "0.72",
      evidence: {
        priceVerified: true,
        sourceKind: "contract",
        sourceReference: "contract://tokenhub/gpt-image-2/default",
        observedAt: "2020-08-03T11:00:00.000Z",
        sourceDigest: digest,
      },
    });
    expect(definition.pricingRevisionSourceKind).toBe("contract");
    expect(definition.spec).toMatchObject({
      endpoint: {
        adapterKind: "openai_compatible",
        presetKind: "tokenhub",
        canonicalOrigin: "https://us-api.tokenhub.com",
        regionCode: "us",
      },
      providerModelId: "gpt-image-2",
    });
  });

  it("uses the same protocol control plane for a private NewAPI deployment", () => {
    const configuration = loadGenerationTasksImagesControlPlaneConfiguration({
      KANVAS_GENERATION_TASKS_IMAGES_CONTROL_PLANE_ENABLED: "true",
      KANVAS_GENERATION_TASKS_IMAGES_PRESET_KIND: "newapi",
      KANVAS_GENERATION_TASKS_IMAGES_PROVIDER_KEY: "newapi-private",
      KANVAS_GENERATION_TASKS_IMAGES_API_ORIGIN: "https://newapi.example.test",
      KANVAS_GENERATION_TASKS_IMAGES_MODEL_ID: "gpt-image-2",
      KANVAS_GENERATION_TASKS_IMAGES_DEPLOYMENT_REFERENCE:
        "deployment://newapi/images-primary",
      KANVAS_GENERATION_TASKS_IMAGES_SECRET_FINGERPRINT: digest,
      KANVAS_GENERATION_TASKS_IMAGES_ENDPOINT_VALIDATION_DIGEST: digest,
      KANVAS_GENERATION_TASKS_IMAGES_FIXED_CHARGE_AMOUNT: "0.72",
      KANVAS_GENERATION_TASKS_IMAGES_PRICING_EVIDENCE_REFERENCE:
        "contract://newapi/images/gpt-image-2",
      KANVAS_GENERATION_TASKS_IMAGES_PRICING_EVIDENCE_DIGEST: digest,
      KANVAS_GENERATION_TASKS_IMAGES_ENDPOINT_VALIDATED_AT:
        "2020-08-03T11:00:00.000Z",
    });
    const definition = buildGenerationTasksImagesControlPlaneDefinition({
      configuration: configuration!,
      instanceId: "kanvas-local",
      workspaceId: "01K00000000000000000000000",
    });

    expect(definition.spec).toMatchObject({
      endpoint: {
        presetKind: "newapi",
        canonicalOrigin: "https://newapi.example.test",
        regionCode: "private",
      },
    });
    expect(definition.routePolicyDocument).toMatchObject({
      providerKey: "newapi-private",
    });
    expect(definition.pricingDocument).toMatchObject({
      billingMode: "fixed",
      fixedChargeAmount: "0.72",
    });
    expect(definition.pricingRevisionSourceKind).toBe("contract");
  });

  it("keeps Instance policy dynamic while Workspace policy pins admitted Images endpoints", () => {
    const definition = buildImageProviderSharedPolicyDefinition();
    expect(definition.instancePolicyDocument).toMatchObject({
      allowedAdapterKinds: [
        "gemini_native",
        "openai_compatible",
        "openai_native",
        "openrouter_native",
      ],
      allowedPresetKinds: [
        "gemini",
        "newapi",
        "openai",
        "openrouter",
        "tokenhub",
        "xai",
      ],
    });
    expect(definition.instancePolicyDocument).not.toHaveProperty(
      "allowedProviderEndpointIds",
    );
    expect(definition.workspacePolicyDocument).toMatchObject({
      allowedAdapterKinds: [
        "gemini_native",
        "openai_compatible",
        "openai_native",
        "openrouter_native",
      ],
      allowedPresetKinds: [
        "gemini",
        "newapi",
        "openai",
        "openrouter",
        "tokenhub",
        "xai",
      ],
      allowedProviderEndpointIds: [
        openAiImagesResourceIds.endpoint,
        generationTasksImagesResourceIds.endpoint,
      ],
    });
  });
});
