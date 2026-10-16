import { describe, expect, it } from "vitest";

import { providerRouteOperationFacts } from "../src/runtime/capability-binding-admin-store.js";

const id = (value: number): string => `01K${String(value).padStart(23, "0")}`;

function route(capabilityKey: string) {
  return {
    capabilityKey,
    providerKey: "openai",
    apiSurface: "responses.v1",
    providerEndpointId: id(1),
    credentialId: id(2),
    modelDeploymentId: id(3),
    pricingRevisionId: id(4),
    budgetAccountId: id(5),
    routingMode: "kanvas_fixed",
    executionTransparency: "full",
    maximumCharge: { currencyCode: "USD", amount: "1" },
    requestTimeoutSeconds: 60,
    queryMode: "client_request_id",
    notFoundIsAuthoritative: true,
    constraints: {},
  };
}

describe("Capability Binding provider route projection", () => {
  it("projects every supported model operation without an image-specific branch", () => {
    expect(
      providerRouteOperationFacts({
        routeDocument: route("text.generate"),
        modelProfileSchemaVersion: 1,
        modelProfileDocument: {},
        modelProfileCanonicalDigest: null,
        modelProfileStatus: "published",
      }),
    ).toEqual({ modelOperation: "text.generate" });
  });

  it("does not expose an operation the Provider model contract cannot execute", () => {
    expect(
      providerRouteOperationFacts({
        routeDocument: route("video.generate"),
        modelProfileSchemaVersion: 1,
        modelProfileDocument: {},
        modelProfileCanonicalDigest: null,
        modelProfileStatus: "published",
      }),
    ).toEqual({});
  });
});
