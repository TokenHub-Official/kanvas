import type { PoolConnection } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

import {
  ConfigurationProviderStoreError,
  readPublishedWorkspacePolicyRevisionInTransaction,
  resolveActiveProviderPolicySetInTransaction,
} from "../src/runtime/configuration-provider-store.js";
import { digestProviderValue } from "../src/runtime/provider-value-digest.js";

const workspaceId = "01K00000000000000000000001";
const instancePolicyId = "01K00000000000000000000002";
const workspacePolicyId = "01K00000000000000000000003";
const routePolicyId = "01K00000000000000000000004";
const endpointId = "01K00000000000000000000005";
const credentialId = "01K00000000000000000000006";
const modelDeploymentId = "01K00000000000000000000007";
const pricingRevisionId = "01K00000000000000000000008";
const budgetAccountId = "01K00000000000000000000009";
const publishedAt = new Date("2026-07-27T12:00:00.000Z");

const instancePolicy = {
  allowedAdapterKinds: ["openai_compatible"],
  allowedRoutingModes: ["kanvas_fixed"],
} as const;

const workspacePolicy = {
  allowedPresetKinds: ["newapi", "tokenhub"],
  maxProviderRequestSeconds: 60,
} as const;

const routeDocument = {
  providerKey: "tokenhub",
  apiSurface: "responses",
  providerEndpointId: endpointId,
  credentialId,
  modelDeploymentId,
  pricingRevisionId,
  budgetAccountId,
  routingMode: "kanvas_fixed",
  executionTransparency: "full",
  maximumCharge: {
    currencyCode: "USD",
    amount: "1.250000000000",
  },
  requestTimeoutSeconds: 45,
  queryMode: "provider_request_id",
  notFoundIsAuthoritative: true,
  constraints: {
    allowedRegionCodes: ["us-west"],
  },
} as const;

describe("Configuration Provider database authority", () => {
  it("resolves only locked, published V1 policies with verified digests", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([
        [
          {
            id: instancePolicyId,
            revision: 1,
            schemaVersion: 1,
            policyDocument: JSON.stringify(instancePolicy),
            canonicalDigest: digestProviderValue(instancePolicy),
            lifecycleStatus: "published",
            publishedAt,
            bindingVersion: 3,
            bindingUpdatedAt: publishedAt,
          },
        ],
      ])
      .mockResolvedValueOnce([
        [
          {
            id: workspacePolicyId,
            workspaceId,
            revision: 2,
            schemaVersion: 1,
            policyDocument: workspacePolicy,
            canonicalDigest: digestProviderValue(workspacePolicy),
            lifecycleStatus: "published",
            publishedAt,
            bindingVersion: 4,
            bindingUpdatedAt: publishedAt,
          },
        ],
      ])
      .mockResolvedValueOnce([
        [
          {
            id: routePolicyId,
            workspaceId,
            routeKey: "default-image-route",
            revision: 5,
            schemaVersion: 1,
            routeDocument,
            canonicalDigest: digestProviderValue(routeDocument),
            lifecycleStatus: "published",
            publishedAt,
          },
        ],
      ]);
    const connection = {
      execute,
    } as unknown as PoolConnection;

    await expect(
      resolveActiveProviderPolicySetInTransaction(
        connection,
        workspaceId,
        routePolicyId,
      ),
    ).resolves.toMatchObject({
      instance: {
        bindingVersion: 3,
        policyRevision: {
          id: instancePolicyId,
          schemaVersion: 1,
          policy: instancePolicy,
        },
      },
      workspace: {
        workspaceId,
        bindingVersion: 4,
        policyRevision: {
          id: workspacePolicyId,
          schemaVersion: 1,
          policy: workspacePolicy,
        },
      },
      route: {
        id: routePolicyId,
        workspaceId,
        route: {
          providerKey: "tokenhub",
          providerEndpointId: endpointId,
          maximumCharge: {
            currencyCode: "USD",
            amount: "1.25",
          },
        },
      },
    });
    expect(execute).toHaveBeenCalledTimes(3);
    for (const [statement] of execute.mock.calls) {
      expect(statement).toEqual(expect.stringMatching(/\bFOR SHARE\s*$/u));
    }
  });

  it("fails closed when persisted JSON does not match its digest", async () => {
    const execute = vi.fn().mockResolvedValue([
      [
        {
          id: workspacePolicyId,
          workspaceId,
          revision: 2,
          schemaVersion: 1,
          policyDocument: workspacePolicy,
          canonicalDigest: digestProviderValue(instancePolicy),
          lifecycleStatus: "published",
          publishedAt,
        },
      ],
    ]);

    await expect(
      readPublishedWorkspacePolicyRevisionInTransaction(
        {
          execute,
        } as unknown as PoolConnection,
        workspaceId,
        workspacePolicyId,
      ),
    ).rejects.toMatchObject({
      code: "configuration_provider.integrity_violation",
    });
  });

  it.each([
    {
      name: "non-published lifecycle",
      lifecycleStatus: "deprecated",
      schemaVersion: 1,
    },
    {
      name: "unknown schema",
      lifecycleStatus: "published",
      schemaVersion: 2,
    },
  ])("fails closed for a $name", async ({ lifecycleStatus, schemaVersion }) => {
    const execute = vi.fn().mockResolvedValue([
      [
        {
          id: workspacePolicyId,
          workspaceId,
          revision: 2,
          schemaVersion,
          policyDocument: workspacePolicy,
          canonicalDigest: digestProviderValue(workspacePolicy),
          lifecycleStatus,
          publishedAt,
        },
      ],
    ]);

    await expect(
      readPublishedWorkspacePolicyRevisionInTransaction(
        {
          execute,
        } as unknown as PoolConnection,
        workspaceId,
        workspacePolicyId,
      ),
    ).rejects.toBeInstanceOf(ConfigurationProviderStoreError);
  });

  it("rejects a row that escapes the requested Workspace", async () => {
    const execute = vi.fn().mockResolvedValue([
      [
        {
          id: workspacePolicyId,
          workspaceId: "01K0000000000000000000000A",
          revision: 2,
          schemaVersion: 1,
          policyDocument: workspacePolicy,
          canonicalDigest: digestProviderValue(workspacePolicy),
          lifecycleStatus: "published",
          publishedAt,
        },
      ],
    ]);

    await expect(
      readPublishedWorkspacePolicyRevisionInTransaction(
        {
          execute,
        } as unknown as PoolConnection,
        workspaceId,
        workspacePolicyId,
      ),
    ).rejects.toMatchObject({
      code: "configuration_provider.integrity_violation",
    });
  });
});
