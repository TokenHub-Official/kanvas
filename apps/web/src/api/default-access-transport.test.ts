import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyDefaultAccess,
  updateDefaultAccessPolicy,
  retryDefaultAccess,
  ApiProblem,
} from "./transport.js";
afterEach(() => vi.unstubAllGlobals());
describe("default access transport", () => {
  it("sends the reviewed version and selected principals with session-bound CSRF", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ results: [] }));
    vi.stubGlobal("fetch", fetcher);
    const body = {
      expectedVersion: 3,
      principalIds: ["01K00000000000000000000001"],
    };
    await applyDefaultAccess("csrf", body);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/instance/default-access/apply",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: expect.objectContaining({
          "x-kanvas-csrf": "csrf",
        }) as unknown,
        body: JSON.stringify(body),
      }),
    );
  });
  it("never supplies an arbitrary target to self-recovery and exposes conflicts", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ state: "failed", reason: "temporary_failure" }),
      )
      .mockResolvedValueOnce(
        Response.json(
          { code: "policy_changed", detail: "Reload" },
          { status: 409 },
        ),
      );
    vi.stubGlobal("fetch", fetcher);
    expect(await retryDefaultAccess("csrf")).toEqual({
      state: "failed",
      reason: "temporary_failure",
    });
    expect(fetcher.mock.calls[0]?.[1]).not.toHaveProperty("body");
    await expect(
      updateDefaultAccessPolicy("csrf", {
        enabled: false,
        workspaceId: null,
        role: "operator",
        oidcProviderIds: [],
        verifiedDomains: [],
        expectedVersion: 1,
      }),
    ).rejects.toBeInstanceOf(ApiProblem);
  });
});
