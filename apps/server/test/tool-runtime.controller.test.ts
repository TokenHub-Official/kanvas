import { ForbiddenException } from "@nestjs/common";
import { SiteToolStoreError } from "@kanvas/database";
import type { FastifyReply, FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { ServerDatabaseRuntime } from "../src/app.module.js";
import type { ServerConfig } from "../src/config.js";
import { ToolRuntimeController } from "../src/http/tool-runtime.controller.js";
import type { RequestAuthorizationContextStore } from "../src/http/request-authorization-context.js";
const sessionId = "01K00000000000000000000001";
const workspaceId = "01K00000000000000000000002";
function fixture() {
  const get = vi.fn().mockResolvedValue({ available: true });
  const document = vi
    .fn()
    .mockResolvedValue(
      Buffer.from('<script>document.body.textContent="tool"</script>'),
    );
  const values: Record<string, string> = {};
  const reply = {
    header: (key: string, value: string) => {
      values[key] = value;
    },
  } as unknown as FastifyReply;
  const request = {
    url: "/runtime",
    headers: { "sec-fetch-dest": "iframe" },
  } as unknown as FastifyRequest;
  const controller = new ToolRuntimeController(
    { toolSessions: { get, document } } as unknown as ServerDatabaseRuntime,
    {
      auth: {
        baseUrl: "https://kanvas.example",
        trustedOrigins: ["https://kanvas.example"],
      },
    } as unknown as ServerConfig,
    {
      require: () => ({ scope: { workspaceId } }),
    } as unknown as RequestAuthorizationContextStore,
  );
  return { get, document, values, reply, request, controller };
}
describe("authorized tool document delivery", () => {
  it("returns trusted loader HTML separately from the uploaded content and forces response policy", async () => {
    const f = fixture();
    const host = await f.controller.host(f.request, sessionId, f.reply);
    expect(host).toContain("kanvas.tool.host.connect");
    expect(host).not.toContain('document.body.textContent="tool"');
    expect(f.document).not.toHaveBeenCalled();
    const content = await f.controller.content(f.request, sessionId, f.reply);
    expect(content).toContain('document.body.textContent="tool"');
    expect(f.values["Content-Type"]).toBe("text/html; charset=utf-8");
    expect(f.values["Content-Security-Policy"]).toContain(
      "sandbox allow-scripts;",
    );
    expect(f.values["Content-Security-Policy"]).not.toContain(
      "allow-same-origin",
    );
  });
  it("does not retrieve bytes for an unavailable session or a direct visit", async () => {
    const f = fixture();
    f.get.mockResolvedValue({ available: false });
    await expect(
      f.controller.content(f.request, sessionId, f.reply),
    ).rejects.toThrow(ForbiddenException);
    expect(f.document).not.toHaveBeenCalled();
    f.request.headers["sec-fetch-dest"] = "document";
    await expect(
      f.controller.content(f.request, sessionId, f.reply),
    ).rejects.toThrow(ForbiddenException);
    expect(f.values).toEqual({});
  });
  it("revalidates at the actual source read if authority changes after host initialization", async () => {
    const f = fixture();
    f.document.mockRejectedValue(
      new SiteToolStoreError("not_ready", "Disabled"),
    );
    await expect(
      f.controller.content(f.request, sessionId, f.reply),
    ).rejects.toThrow(ForbiddenException);
    expect(f.values).toEqual({});
  });
});
