import { describe, expect, it } from "vitest";

import {
  parseProviderRouteSnapshot,
  type ProviderRouteSnapshot,
} from "../src/index.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const identity = (value: number): string =>
  `01K${String(value).padStart(23, "0")}`;

const currentSnapshot = Object.freeze({
  providerProtocolVersion: 1,
  providerKey: "openai",
  apiSurface: "responses.v1",
  providerEndpointId: identity(1),
  credentialIdentityId: identity(2),
  credentialIdentityEpoch: 3,
  modelDeploymentId: identity(3),
  pricingRevisionId: identity(4),
  pinnedSecretVersionId: identity(5),
  credentialIdentityDigest: digest("c"),
  instancePolicyRevisionId: identity(6),
  workspacePolicyRevisionId: identity(7),
  routePolicyRevisionId: identity(8),
  modelProfileRevisionId: identity(9),
  budgetAccountId: identity(10),
  routingMode: "kanvas_fixed",
  executionTransparency: "full",
  maximumCharge: Object.freeze({
    currencyCode: "USD",
    amount: "12.3400",
  }),
  routeCandidateDigest: digest("a"),
  requestScopeDigest: digest("b"),
  queryMode: "client_request_id",
  notFoundIsAuthoritative: true,
});

describe("ProviderRouteSnapshot", () => {
  it("returns a frozen, typed identity and query-semantics snapshot", () => {
    const parsed = parseProviderRouteSnapshot(currentSnapshot);
    const typed: ProviderRouteSnapshot = parsed;

    expect(parsed).toEqual(currentSnapshot);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(typed.queryMode).toBe("client_request_id");
  });

  it("requires current routes to pin secret, policies, model, price, and a fixed-point budget ceiling", () => {
    const parsed = parseProviderRouteSnapshot(currentSnapshot);

    expect(parsed).toEqual(currentSnapshot);
    expect(parsed.providerProtocolVersion).toBe(1);
    expect(parsed.pinnedSecretVersionId).toBe(identity(5));
    expect(parsed.maximumCharge).toEqual({
      currencyCode: "USD",
      amount: "12.3400",
    });
    expect(Object.isFrozen(parsed.maximumCharge)).toBe(true);
  });

  it.each([
    [
      "missing pinned SecretVersion",
      {
        ...currentSnapshot,
        pinnedSecretVersionId: undefined,
      },
    ],
    [
      "floating money",
      {
        ...currentSnapshot,
        maximumCharge: {
          currencyCode: "USD",
          amount: 1.25,
        },
      },
    ],
    [
      "gateway claiming full transparency",
      {
        ...currentSnapshot,
        routingMode: "gateway_managed",
        executionTransparency: "full",
      },
    ],
    [
      "unpriced current route",
      {
        ...currentSnapshot,
        pricingRevisionId: undefined,
      },
    ],
  ])("rejects v2 %s", (_label, value) => {
    expect(() => parseProviderRouteSnapshot(value)).toThrowError(
      expect.objectContaining({
        code: "provider_route_snapshot.invalid",
      }),
    );
  });

  it.each([
    [
      "unknown field",
      {
        ...currentSnapshot,
        mutableEndpoint: "https://example.invalid",
      },
    ],
    [
      "non-ULID identity",
      {
        ...currentSnapshot,
        providerEndpointId: "endpoint-openai-primary",
      },
    ],
    [
      "non-canonical digest",
      {
        ...currentSnapshot,
        requestScopeDigest: "sha256:not-a-digest",
      },
    ],
    [
      "unsupported query mode",
      {
        ...currentSnapshot,
        queryMode: "request_body",
      },
    ],
    [
      "authoritative not-found without query support",
      {
        ...currentSnapshot,
        queryMode: "none",
        notFoundIsAuthoritative: true,
      },
    ],
  ])("rejects %s", (_label, value) => {
    expect(() => parseProviderRouteSnapshot(value)).toThrowError(
      expect.objectContaining({
        code: "provider_route_snapshot.invalid",
      }),
    );
  });

  it("rejects a route missing its required pinned facts", () => {
    expect(() =>
      parseProviderRouteSnapshot({
        providerProtocolVersion: 1,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "provider_route_snapshot.invalid",
      }),
    );
  });
});
