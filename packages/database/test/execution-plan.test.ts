import { describe, expect, it } from "vitest";

import {
  ExecutionPlanSnapshotError,
  assertPinnedCandidateIdentity,
  assertPinnedRouteIdentity,
  findPinnedCandidate,
  findPinnedRoute,
  maximumRouteCandidates,
  maximumRouteTotalAttempts,
  parseExecutionPlan,
} from "../src/runtime/execution-plan.js";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;
const id = (value: number): string => `01K${String(value).padStart(23, "0")}`;

const topology = Object.freeze({
  schemaVersion: 1,
  key: "route_test",
  entryNodeKey: "invoke",
  limits: {
    maxNodeRuns: 1,
    timeoutMs: 60_000,
  },
  nodes: [
    {
      key: "invoke",
      kind: "invoke",
      capability: {
        contractId: "image.background.remove",
        revision: 1,
        canonicalDigest: digest("c"),
      },
      input: {},
      next: [],
    },
  ],
  outputs: {},
});

const retryPolicy = Object.freeze({
  maxAttempts: 2,
  backoff: "fixed",
  initialDelayMs: 1000,
  maxDelayMs: 1000,
});

const providerRoute = Object.freeze({
  providerProtocolVersion: 1,
  providerKey: "openai",
  apiSurface: "responses.v1",
  providerEndpointId: id(11),
  credentialIdentityId: id(12),
  credentialIdentityEpoch: 1,
  modelDeploymentId: id(13),
  pricingRevisionId: id(14),
  pinnedSecretVersionId: id(15),
  credentialIdentityDigest: digest("e"),
  instancePolicyRevisionId: id(16),
  workspacePolicyRevisionId: id(17),
  routePolicyRevisionId: id(18),
  modelProfileRevisionId: id(19),
  budgetAccountId: id(20),
  routingMode: "kanvas_fixed",
  executionTransparency: "full",
  maximumCharge: Object.freeze({ currencyCode: "USD", amount: "1" }),
  routeCandidateDigest: digest("a"),
  requestScopeDigest: digest("b"),
  queryMode: "client_request_id",
  notFoundIsAuthoritative: true,
});

function routeCandidate(
  candidateIndex: number,
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    candidateIndex,
    bindingId: id(20 + candidateIndex),
    bindingVersion: 1,
    implementationRevisionId: id(30 + candidateIndex),
    implementationDigest: digest(
      "abcdef0123456789"[candidateIndex % 16] ?? "0",
    ),
    executionTarget: candidateIndex === 0 ? "browser" : "worker",
    adapterKey:
      candidateIndex === 0
        ? "browser.background.remove"
        : "worker.background.remove",
    idempotencyMode: "intrinsic",
    retryPolicy,
    attemptTimeoutMs: 120_000,
    fallbackOn: candidateIndex === 0 ? ["browser_lease_expired"] : [],
    ...overrides,
  };
}

function currentPlan(
  candidates: readonly Readonly<Record<string, unknown>>[],
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    workflowRevision: {
      id: id(40),
      canonicalDigest: digest("f"),
    },
    topology,
    routes: [
      {
        nodeKey: "invoke",
        contractRevisionId: id(1),
        contractKey: "image.background.remove",
        contractRevision: 1,
        contractDigest: digest("c"),
        candidates,
      },
    ],
  };
}

describe("execution plan parser", () => {
  it("parses ordered v1 candidates and exposes identity helpers", () => {
    const plan = parseExecutionPlan(
      currentPlan([routeCandidate(0), routeCandidate(1)]),
    );
    const route = findPinnedRoute(plan, "invoke");
    const candidate = findPinnedCandidate(route, 1);

    expect(plan.schemaVersion).toBe(1);
    expect(plan.routes).toHaveLength(1);
    expect(candidate.executionTarget).toBe("worker");
    expect(() =>
      assertPinnedRouteIdentity(route, {
        nodeKey: "invoke",
        contractRevisionId: id(1),
        contractDigest: digest("c"),
      }),
    ).not.toThrow();
    expect(() =>
      assertPinnedCandidateIdentity(candidate, {
        candidateIndex: 1,
        bindingId: id(21),
        implementationRevisionId: id(31),
        implementationDigest: digest("b"),
        executionTarget: "worker",
        adapterKey: "worker.background.remove",
      }),
    ).not.toThrow();
    expect(() =>
      assertPinnedCandidateIdentity(candidate, {
        candidateIndex: 0,
        bindingId: id(21),
        implementationRevisionId: id(31),
        implementationDigest: digest("b"),
        executionTarget: "worker",
        adapterKey: "worker.background.remove",
      }),
    ).toThrow(ExecutionPlanSnapshotError);
  });

  it("accepts the full bounded WorkflowTopology v1 contract", () => {
    const plan = parseExecutionPlan({
      ...currentPlan([routeCandidate(0)]),
      topology: {
        schemaVersion: 1,
        key: "route_test",
        entryNodeKey: "invoke",
        limits: {
          maxNodeRuns: 1,
          timeoutMs: 60_000,
        },
        nodes: [
          {
            key: "invoke",
            kind: "invoke",
            capability: {
              contractId: "image.background.remove",
              revision: 1,
              canonicalDigest: digest("c"),
            },
            input: {
              sourceArtifactId: {
                $value: {
                  source: "workflow_input",
                  pointer: "/sourceArtifactId",
                },
              },
            },
            next: [],
          },
        ],
        outputs: {
          artifactId: {
            required: true,
            value: {
              $value: {
                source: "node_output",
                nodeKey: "invoke",
                scope: "root",
                pointer: "/artifactId",
              },
            },
          },
        },
      },
    });

    expect(plan.topology.nodes).toEqual([
      {
        key: "invoke",
        kind: "invoke",
        next: [],
      },
    ]);
    expect(() =>
      parseExecutionPlan({
        ...currentPlan([routeCandidate(0)]),
        topology: {
          schemaVersion: 1,
          key: "route_test",
          entryNodeKey: "invoke",
          limits: {
            maxNodeRuns: 1,
            timeoutMs: 0,
          },
          nodes: topology.nodes,
          outputs: {},
        },
      }),
    ).toThrow(/bounded WorkflowTopology v1 contract/u);
  });

  it("requires a strict Provider route only on Provider candidates", () => {
    expect(() =>
      parseExecutionPlan(
        currentPlan([
          routeCandidate(0, {
            executionTarget: "provider",
            adapterKey: "provider.openai",
            fallbackOn: [],
          }),
        ]),
      ),
    ).toThrow(/providerRoute is required/u);

    const plan = parseExecutionPlan(
      currentPlan([
        routeCandidate(0, {
          executionTarget: "provider",
          adapterKey: "provider.openai",
          providerRoute,
          fallbackOn: [],
        }),
      ]),
    );
    expect(plan.routes[0]?.candidates[0]).toMatchObject({
      executionTarget: "provider",
      providerRoute,
    });

    expect(() =>
      parseExecutionPlan(
        currentPlan([
          routeCandidate(0, {
            providerRoute,
          }),
        ]),
      ),
    ).toThrow(/providerRoute is forbidden/u);

    expect(() =>
      parseExecutionPlan(
        currentPlan([
          routeCandidate(0, {
            executionTarget: "worker",
            adapterKey: "worker.background.remove",
            fallbackOn: ["browser_lease_expired"],
          }),
        ]),
      ),
    ).toThrow(/Browser-only reason/u);
  });

  it("rejects discontinuous indexes, duplicate bindings and unknown facts", () => {
    expect(() => parseExecutionPlan(currentPlan([routeCandidate(1)]))).toThrow(
      /contiguous and zero-based/u,
    );
    expect(() =>
      parseExecutionPlan(
        currentPlan([
          routeCandidate(0),
          routeCandidate(1, {
            bindingId: id(20),
          }),
        ]),
      ),
    ).toThrow(/duplicate binding/u);
    expect(() =>
      parseExecutionPlan(
        currentPlan([
          routeCandidate(0, {
            rawRoutePolicy: {
              currentDatabaseValue: true,
            },
          }),
        ]),
      ),
    ).toThrow(/unknown field rawRoutePolicy/u);
  });

  it("requires every capability-bearing topology node to have one route", () => {
    expect(() =>
      parseExecutionPlan({
        schemaVersion: 1,
        topology: {
          schemaVersion: 1,
          key: "empty_route_test",
          entryNodeKey: "invoke",
          limits: { maxNodeRuns: 1, timeoutMs: 60_000 },
          nodes: [],
          outputs: {},
        },
        routes: [],
      }),
    ).toThrow(/bounded WorkflowTopology v1 contract/u);

    expect(() =>
      parseExecutionPlan({
        schemaVersion: 1,
        topology,
        routes: [],
      }),
    ).toThrow(/has no pinned route/u);

    expect(() =>
      parseExecutionPlan({
        schemaVersion: 1,
        topology,
        routes: [
          {
            ...(
              currentPlan([routeCandidate(0)]).routes as readonly Record<
                string,
                unknown
              >[]
            )[0],
            nodeKey: "missing",
          },
        ],
      }),
    ).toThrow(/has no topology node/u);
  });

  it("enforces candidate and total-attempt hard limits", () => {
    const tooManyCandidates = Array.from(
      { length: maximumRouteCandidates + 1 },
      (_, index) => routeCandidate(index),
    );
    expect(() => parseExecutionPlan(currentPlan(tooManyCandidates))).toThrow(
      /between 1 and 8/u,
    );

    const attemptsOverLimit = Array.from(
      { length: Math.ceil(maximumRouteTotalAttempts / 9) },
      (_, index) =>
        routeCandidate(index, {
          retryPolicy: {
            ...retryPolicy,
            maxAttempts: 9,
          },
        }),
    );
    expect(() => parseExecutionPlan(currentPlan(attemptsOverLimit))).toThrow(
      /maximum is 32/u,
    );
  });
});
