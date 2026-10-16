import type * as ReactModule from "react";
import type * as I18nextModule from "react-i18next";
import type * as TransportModule from "../../api/transport.js";
import type { ProviderSettingSummary } from "@kanvas/contracts/api";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  values: [] as unknown[],
  index: 0,
  mutation: undefined as
    | undefined
    | { mutationFn: () => Promise<unknown>; onError: () => Promise<void> },
  rename: vi.fn(),
  invalidate: vi.fn().mockResolvedValue(undefined),
  refreshed: { providers: [{ id: "provider-1", version: 2 }] },
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof ReactModule>()),
  useState: (initial: unknown) => {
    const index = state.index++;
    if (state.values[index] === undefined) state.values[index] = initial;
    return [
      state.values[index],
      (value: unknown) => {
        state.values[index] = value;
      },
    ];
  },
}));
vi.mock("@tanstack/react-query", () => ({
  useMutation: (options: typeof state.mutation) => {
    state.mutation = options;
    return { isPending: false };
  },
  useQuery: vi.fn(),
  useQueryClient: () => ({
    invalidateQueries: state.invalidate,
    getQueryData: () => state.refreshed,
  }),
}));
vi.mock("react-i18next", async (original) => ({
  ...(await original<typeof I18nextModule>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../../components/settings-notification.js", () => ({
  useSettingsNotification: () => ({ notify: vi.fn() }),
}));
vi.mock("../../api/transport.js", async (original) => ({
  ...(await original<typeof TransportModule>()),
  renameWorkspaceProviderSetting: state.rename,
}));
import { RenameProviderDialog } from "./provider-management-dialogs.js";

describe("provider rename conflict recovery", () => {
  it("keeps the edited name, refreshes the version only after failure, and waits for another save", async () => {
    const provider = {
      id: "provider-1",
      displayName: "Original",
      version: 1,
    } as ProviderSettingSummary;
    const render = () => {
      state.index = 0;
      return RenameProviderDialog({
        context: { workspaceId: "workspace", csrfToken: "csrf" },
        provider,
        onClose: vi.fn(),
      });
    };
    render();
    state.values[0] = "Edited";
    render();
    state.rename
      .mockRejectedValueOnce(new Error("conflict"))
      .mockResolvedValue(undefined);
    await expect(state.mutation!.mutationFn()).rejects.toThrow("conflict");
    expect(state.rename.mock.calls[0]?.[2]).toEqual({
      expectedVersion: 1,
      displayName: "Edited",
    });
    await state.mutation!.onError();
    expect(state.rename).toHaveBeenCalledTimes(1);
    render();
    await state.mutation!.mutationFn();
    expect(state.rename.mock.calls[1]?.[2]).toEqual({
      expectedVersion: 2,
      displayName: "Edited",
    });
    expect(state.invalidate).toHaveBeenCalledOnce();
  });
});
