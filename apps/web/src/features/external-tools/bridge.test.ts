import { MessageChannel } from "node:worker_threads";
import { describe, expect, it, vi } from "vitest";
import { connectToolPort } from "./bridge.js";

function response(port: MessageChannel["port2"]): Promise<unknown> {
  return new Promise((resolve) => port.once("message", resolve));
}

describe("private tool channel", () => {
  it("replays a request without executing twice and rejects conflicting reuse", async () => {
    const channel = new MessageChannel();
    const execute = vi.fn().mockResolvedValue({ status: "queued" });
    const close = connectToolPort(
      channel.port1 as unknown as MessagePort,
      execute,
    );
    try {
      const message = {
        version: 1,
        id: "one",
        method: "run.start",
        params: { value: 1 },
      };
      let next = response(channel.port2);
      channel.port2.postMessage(message);
      expect(await next).toMatchObject({
        ok: true,
        data: { status: "queued" },
      });
      next = response(channel.port2);
      channel.port2.postMessage(message);
      expect(await next).toMatchObject({ ok: true });
      expect(execute).toHaveBeenCalledTimes(1);
      next = response(channel.port2);
      channel.port2.postMessage({ ...message, params: { value: 2 } });
      expect(await next).toMatchObject({
        ok: false,
        error: "request_conflict",
      });
    } finally {
      close();
      channel.port2.close();
    }
  });
  it("does not return arbitrary exception details to the tool", async () => {
    const channel = new MessageChannel();
    const close = connectToolPort(channel.port1 as unknown as MessagePort, () =>
      Promise.reject(new Error("private credentials")),
    );
    try {
      const next = response(channel.port2);
      channel.port2.postMessage({
        version: 1,
        id: "one",
        method: "run.status",
        params: {},
      });
      expect(await next).toMatchObject({ ok: false, error: "request_failed" });
    } finally {
      close();
      channel.port2.close();
    }
  });
});
