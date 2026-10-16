import type { CurrentProviderRouteSnapshot } from "@kanvas/application";
import type { ProviderInvocationExecutionContext } from "@kanvas/database/runtime";
import { describe, expect, it, vi } from "vitest";

import { createOpenAiCompatibleProviderAdapters } from "../src/provider/openai-compatible-provider.js";
import type { AuthorizedProviderInvocationRequest } from "../src/provider/provider-adapter.js";
import type {
  ProviderHttpRequest,
  ProviderHttpResponse,
  ProviderHttpTransport,
} from "../src/provider/provider-http-transport.js";

const id = (value: number): string => `01K${String(value).padStart(23, "0")}`;
const digest = (character: string): string => `sha256:${character.repeat(64)}`;

function route(
  overrides: Partial<CurrentProviderRouteSnapshot> = {},
): CurrentProviderRouteSnapshot {
  return Object.freeze({
    providerProtocolVersion: 1,
    providerKey: "openai",
    apiSurface: "responses.v1",
    providerEndpointId: id(1),
    credentialIdentityId: id(2),
    credentialIdentityEpoch: 1,
    pinnedSecretVersionId: id(3),
    credentialIdentityDigest: digest("a"),
    instancePolicyRevisionId: id(4),
    workspacePolicyRevisionId: id(5),
    routePolicyRevisionId: id(6),
    modelProfileRevisionId: id(7),
    modelDeploymentId: id(8),
    pricingRevisionId: id(9),
    budgetAccountId: id(10),
    routingMode: "kanvas_fixed",
    executionTransparency: "full",
    maximumCharge: {
      currencyCode: "USD",
      amount: "1.00",
    },
    routeCandidateDigest: digest("b"),
    requestScopeDigest: digest("c"),
    queryMode: "provider_request_id",
    notFoundIsAuthoritative: true,
    ...overrides,
  });
}

function context(
  currentRoute: CurrentProviderRouteSnapshot,
  overrides: Partial<ProviderInvocationExecutionContext> = {},
): ProviderInvocationExecutionContext {
  return Object.freeze({
    invocationId: id(11),
    workspaceId: id(12),
    route: currentRoute,
    implementationConfiguration: {},
    endpoint: Object.freeze({
      id: currentRoute.providerEndpointId,
      adapterKind: "openai_native",
      presetKind: "openai",
      baseUrl: "https://api.openai.com/v1",
      canonicalOrigin: "https://api.openai.com",
      regionCode: "global",
      networkPolicy: {},
      dataPolicy: {},
    }),
    model: Object.freeze({
      deploymentId: currentRoute.modelDeploymentId,
      providerModelId: "gpt-test-pinned",
      modelProfileRevisionId: currentRoute.modelProfileRevisionId,
      modelProfile: {},
    }),
    pricing: Object.freeze({
      revisionId: currentRoute.pricingRevisionId,
      currencyCode: "USD",
      pricing: {},
    }),
    secret: Object.freeze({
      id: currentRoute.pinnedSecretVersionId,
      workspaceId: id(12),
      credentialId: currentRoute.credentialIdentityId,
      version: 1,
      materialGeneration: 1,
      sourceKind: "deployment_reference",
      lifecycleStatus: "active",
      aadDigest: digest("d"),
      materialFingerprint: digest("e"),
      formatVersion: 1,
      drainDeadlineAt: null,
      deploymentReference: "deployment://provider/openai",
    }),
    ...overrides,
  });
}

function invocationRequest(
  executionContext: ProviderInvocationExecutionContext,
  input: Readonly<Record<string, unknown>>,
): AuthorizedProviderInvocationRequest {
  return Object.freeze({
    route: executionContext.route,
    stableRequestKey: "kanvas:v1:test-request",
    requestFingerprint: digest("f"),
    input,
    deadlineAt: new Date(Date.now() + 10_000),
    executionContext,
    credential: Buffer.from("sk-test-only", "utf8"),
  });
}

function transportReturning(response: ProviderHttpResponse): {
  readonly transport: ProviderHttpTransport;
  readonly request: ReturnType<
    typeof vi.fn<
      (request: ProviderHttpRequest) => Promise<ProviderHttpResponse>
    >
  >;
} {
  const request = vi.fn((requestOptions: ProviderHttpRequest) => {
    void requestOptions;
    return Promise.resolve(response);
  });
  return {
    request,
    transport: {
      request,
    },
  };
}

describe("OpenAI-compatible Provider Adapters", () => {
  it("forces endpoint/model/storage/idempotency facts for OpenAI Responses", async () => {
    const currentRoute = route();
    const executionContext = context(currentRoute);
    const http = transportReturning({
      statusCode: 200,
      headers: {},
      body: {
        id: "resp_123",
        status: "completed",
        output: [],
        usage: {
          input_tokens: 12,
          output_tokens: 4,
          total_tokens: 16,
        },
      },
    });
    const adapter = createOpenAiCompatibleProviderAdapters(
      ["openai.responses.v1"],
      http.transport,
    )[0];

    await expect(
      adapter?.submit(
        invocationRequest(executionContext, {
          input: "Create a concise design brief.",
        }),
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      status: "succeeded",
      providerRequestId: "resp_123",
      usage: [
        {
          metricKey: "input_tokens",
          numericValue: "12",
          unitCode: "token",
        },
        {
          metricKey: "output_tokens",
          numericValue: "4",
          unitCode: "token",
        },
        {
          metricKey: "total_tokens",
          numericValue: "16",
          unitCode: "token",
        },
        {
          metricKey: "input_text_tokens",
          numericValue: "12",
          unitCode: "token",
        },
        {
          metricKey: "output_text_tokens",
          numericValue: "4",
          unitCode: "token",
        },
      ],
    });
    expect(http.request).toHaveBeenCalledOnce();
    const sent = http.request.mock.calls[0]?.[0];
    expect(sent?.baseUrl).toBe("https://api.openai.com/v1");
    expect(sent?.path).toBe("/responses");
    expect(sent?.method).toBe("POST");
    expect(sent?.headers.authorization).toBe("Bearer sk-test-only");
    expect(sent?.headers["idempotency-key"]).toBe("kanvas:v1:test-request");
    expect(sent?.body).toEqual({
      input: "Create a concise design brief.",
      model: "gpt-test-pinned",
      stream: false,
      store: true,
    });
  });

  it("rejects route-controlled body overrides before transport", async () => {
    const currentRoute = route();
    const executionContext = context(currentRoute);
    const http = transportReturning({
      statusCode: 200,
      headers: {},
      body: {
        id: "unused",
        status: "completed",
      },
    });
    const adapter = createOpenAiCompatibleProviderAdapters(
      ["openai.responses.v1"],
      http.transport,
    )[0];

    await expect(
      adapter?.submit(
        invocationRequest(executionContext, {
          input: "test",
          model: "attacker-controlled",
        }),
        new AbortController().signal,
      ),
    ).rejects.toThrow(/route-controlled fields/u);
    expect(http.request).not.toHaveBeenCalled();
  });

  it("disables OpenRouter fallback routing and keeps its Responses API stateless", async () => {
    const currentRoute = route({
      providerKey: "openrouter",
      queryMode: "none",
      notFoundIsAuthoritative: false,
    });
    const executionContext = context(currentRoute, {
      endpoint: {
        ...context(currentRoute).endpoint,
        adapterKind: "openrouter_native",
        presetKind: "openrouter",
        baseUrl: "https://openrouter.ai/api/v1",
        canonicalOrigin: "https://openrouter.ai",
      },
    });
    const http = transportReturning({
      statusCode: 200,
      headers: {},
      body: {
        id: "or-response-1",
        status: "completed",
        output: [],
      },
    });
    const adapter = createOpenAiCompatibleProviderAdapters(
      ["openrouter.responses.v1"],
      http.transport,
    )[0];

    expect(adapter).toMatchObject({
      queryMode: "none",
      notFoundIsAuthoritative: false,
    });
    await adapter?.submit(
      invocationRequest(executionContext, {
        input: "test",
      }),
      new AbortController().signal,
    );
    expect(http.request).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          input: "test",
          model: "gpt-test-pinned",
          stream: false,
          provider: {
            allow_fallbacks: false,
          },
        },
      }),
    );
  });

  it("normalizes HTTP failures and authoritative OpenAI query not-found", async () => {
    const currentRoute = route();
    const executionContext = context(currentRoute);
    const rateLimited = transportReturning({
      statusCode: 429,
      headers: {},
      body: {
        error: {
          code: "rate_limit_exceeded",
        },
      },
    });
    const rateLimitedAdapter = createOpenAiCompatibleProviderAdapters(
      ["openai.responses.v1"],
      rateLimited.transport,
    )[0];

    await expect(
      rateLimitedAdapter?.submit(
        invocationRequest(executionContext, {
          input: "test",
        }),
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      status: "failed",
      stableErrorCode: "provider.remote_rate_limited",
    });

    const missing = transportReturning({
      statusCode: 404,
      headers: {},
      body: {
        error: {
          code: "not_found",
        },
      },
    });
    const queryAdapter = createOpenAiCompatibleProviderAdapters(
      ["openai.responses.v1"],
      missing.transport,
    )[0];
    await expect(
      queryAdapter?.query(
        {
          ...invocationRequest(executionContext, {
            input: "test",
          }),
          providerRequestId: "resp_missing",
        },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      status: "not_found",
    });
  });
});
