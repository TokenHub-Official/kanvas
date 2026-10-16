import { describe, expect, it, vi } from "vitest";
import { createToolRuntimeApi } from "./tool-api.js";
import { ApiProblem } from "../../api/transport.js";
describe("scoped tool transport", () => {
  it("uses session endpoints and keeps CSRF in headers, outside tool data", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    const api = createToolRuntimeApi({
      scope: { kind: "use", workspaceId: "workspace" },
      csrfToken: "csrf",
      locale: "zh-CN",
      fetcher,
    });
    await api.start(
      "session",
      { contractRevisionId: "contract", input: { prompt: "hello" } },
      "retry-key",
    );
    const [path, init] = fetcher.mock.calls[0]!;
    expect(path).toBe("/api/v1/tool-sessions/session/runs");
    expect(init).toMatchObject({
      credentials: "include",
      headers: {
        "x-kanvas-workspace-id": "workspace",
        "x-kanvas-csrf": "csrf",
      },
    });
    expect(JSON.parse(init?.body as string)).toEqual({
      contractRevisionId: "contract",
      input: { prompt: "hello" },
      requestKey: "retry-key",
    });
  });
  it("previews never use Workspace scope or generic capability execution", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(() =>
        Promise.resolve(new Response("{}", { status: 200 })),
      );
    const api = createToolRuntimeApi({
      scope: { kind: "preview" },
      csrfToken: "csrf",
      locale: "zh-CN",
      fetcher,
    });
    await api.create("tool", "revision", "open-key");
    expect(fetcher.mock.calls[0]![0]).toBe(
      "/api/v1/instance/tools/tool/previews",
    );
    expect(fetcher.mock.calls[0]![1]?.headers).not.toHaveProperty(
      "x-kanvas-workspace-id",
    );
    expect(() =>
      api.start(
        "session",
        { contractRevisionId: "contract", input: {} },
        "run",
      ),
    ).toThrow(ApiProblem);
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
