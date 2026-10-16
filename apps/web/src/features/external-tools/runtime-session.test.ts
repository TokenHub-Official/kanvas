import type { ToolSession } from "@kanvas/contracts/api";
import { describe, expect, it, vi } from "vitest";
import { ApiProblem } from "../../api/transport.js";
import { createRuntimeSessionRecovery } from "./runtime-session.js";
import type { ToolRuntimeApi } from "./tool-api.js";
const id = (n: number) => `01K${String(n).padStart(23, "0")}`;
const session = {
  id: id(1),
  toolId: id(2),
  revisionId: id(3),
  available: true,
} as ToolSession;
function fixture() {
  const entries = new Map<string, string>();
  const storage = {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
  };
  const api = {
    create: vi.fn<ToolRuntimeApi["create"]>().mockResolvedValue(session),
    get: vi.fn<ToolRuntimeApi["get"]>().mockResolvedValue(session),
    close: vi
      .fn<ToolRuntimeApi["close"]>()
      .mockResolvedValue({ ...session, available: false }),
  };
  const options = {
    api: api as unknown as ToolRuntimeApi,
    principalId: id(4),
    scopeKey: `use:${id(5)}`,
    toolId: id(2),
    revisionId: id(3),
    storage,
  };
  return { api, storage, options, entries };
}
describe("tool runtime session recovery", () => {
  it("persists identity before creation and reuses it after a lost response", async () => {
    const f = fixture();
    f.api.create.mockImplementationOnce(() => {
      expect(f.entries.size).toBe(1);
      return Promise.reject(new TypeError("Response lost"));
    });
    await expect(
      createRuntimeSessionRecovery(f.options).open(),
    ).rejects.toThrow("Response lost");
    const key = f.api.create.mock.calls[0]![2];
    await createRuntimeSessionRecovery({
      ...f.options,
      revisionId: id(9),
    }).open();
    expect(f.api.create.mock.calls[1]).toEqual([id(2), id(3), key]);
    await createRuntimeSessionRecovery(f.options).open();
    expect(f.api.create).toHaveBeenCalledTimes(2);
    expect(f.api.get).toHaveBeenCalledWith(session.id);
  });
  it("coalesces opens and keeps unavailable sessions without silently replacing them", async () => {
    const f = fixture();
    const recovery = createRuntimeSessionRecovery(f.options);
    await Promise.all([recovery.open(), recovery.open()]);
    expect(f.api.create).toHaveBeenCalledOnce();
    f.api.get.mockResolvedValue({
      ...session,
      available: false,
      unavailableReason: "disabled",
    });
    expect(await recovery.open()).toMatchObject({ available: false });
    expect(f.api.create).toHaveBeenCalledOnce();
  });
  it("recovers a confirmed inactive standalone tool when entering the page", async () => {
    const f = fixture();
    const recovery = createRuntimeSessionRecovery(f.options);
    await recovery.open();
    f.api.get.mockResolvedValue({
      ...session,
      available: false,
      maximumRuns: 0,
      runIds: [],
      unavailableReason: "availability_changed",
    });
    expect(await recovery.openForDisplay()).toMatchObject({ available: true });
    expect(f.api.create).toHaveBeenCalledTimes(2);
    expect(f.api.close).toHaveBeenCalledWith(session.id);
  });
  it("does not replace a capability session or erase its existing task", async () => {
    const f = fixture();
    const recovery = createRuntimeSessionRecovery(f.options);
    await recovery.open();
    f.api.get.mockResolvedValue({
      ...session,
      available: false,
      maximumRuns: 3,
      runIds: [id(8)],
    });
    expect(await recovery.openForDisplay()).toMatchObject({ runIds: [id(8)] });
    expect(f.api.create).toHaveBeenCalledOnce();
  });
  it("does not discard uncertain creation just to reopen", async () => {
    const f = fixture();
    f.api.create.mockRejectedValue(new Error("Offline"));
    const recovery = createRuntimeSessionRecovery(f.options);
    await expect(recovery.open()).rejects.toThrow("Offline");
    await expect(recovery.reopen()).rejects.toThrow("session_creation_unknown");
    expect(f.api.create).toHaveBeenCalledOnce();
  });
  it("allows explicit retry after definitive rejection and explicit replacement after close", async () => {
    const f = fixture();
    f.api.create.mockRejectedValueOnce(
      new ApiProblem(409, "revision_changed", "Reload"),
    );
    const recovery = createRuntimeSessionRecovery(f.options);
    await expect(recovery.open()).rejects.toThrow("Reload");
    await expect(recovery.open()).rejects.toThrow("session_creation_rejected");
    await recovery.reopen();
    expect(f.api.create.mock.calls[1]![2]).not.toBe(
      f.api.create.mock.calls[0]![2],
    );
    await recovery.reopen();
    expect(f.api.close).toHaveBeenCalledWith(session.id);
  });
  it("keeps accounts and Workspaces from sharing recovery receipts", async () => {
    const f = fixture();
    await createRuntimeSessionRecovery(f.options).open();
    await createRuntimeSessionRecovery({
      ...f.options,
      principalId: id(6),
    }).open();
    await createRuntimeSessionRecovery({
      ...f.options,
      scopeKey: `use:${id(7)}`,
    }).open();
    expect(f.api.create).toHaveBeenCalledTimes(3);
    expect(f.api.get).not.toHaveBeenCalled();
  });
});

describe("explicit reconnect across browser authentication sessions", () => {
  it("permits an explicit new session when the old session no longer belongs to this login", async () => {
    const f = fixture();
    const recovery = createRuntimeSessionRecovery(f.options);
    await recovery.open();
    f.api.get.mockRejectedValue(
      new ApiProblem(404, "unavailable", "Old login"),
    );
    f.api.close.mockRejectedValue(
      new ApiProblem(404, "unavailable", "Old login"),
    );
    await expect(recovery.open()).rejects.toThrow("Old login");
    await recovery.reopen();
    expect(f.api.create).toHaveBeenCalledTimes(2);
  });
});
