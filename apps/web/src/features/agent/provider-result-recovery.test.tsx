import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderResultRecovery } from "./provider-result-recovery.js";
const { records } = vi.hoisted(() => ({
  records: {
    data: {
      canRecover: true,
      canDownload: true,
      unavailableReason: undefined as "no_results" | undefined,
      resultCount: 1,
      items: [] as Array<{
        id: string;
        resultIndex: number;
        state: string;
        createdAt: string;
        errorCode?: string;
        artifactId?: string;
        initiatedByAdministrator?: boolean;
      }>,
      truncated: false,
    },
  },
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ setQueryData: vi.fn() }),
  useQuery: ({ queryKey }: { queryKey: string[] }) =>
    queryKey[0] === "authentication"
      ? { data: { csrfToken: "test" } }
      : records,
  useMutation: () => ({ isPending: false, isError: false, mutate: vi.fn() }),
}));
vi.mock("../../components/toast.js", () => ({
  useToast: () => ({ notify: vi.fn() }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
function render() {
  return renderToStaticMarkup(
    <ProviderResultRecovery workspaceId="workspace" runId="run" />,
  );
}
describe("retained result recovery presentation", () => {
  beforeEach(() => {
    records.data.canDownload = true;
    records.data.canRecover = true;
    records.data.unavailableReason = undefined;
  });
  it("lets administrators recover without advertising access to the user's private file", () => {
    records.data.canDownload = false;
    records.data.items = [
      {
        id: "recovery",
        resultIndex: 0,
        state: "succeeded",
        createdAt: "2026-10-10T00:00:00Z",
        artifactId: "artifact",
        initiatedByAdministrator: true,
      },
    ];
    const html = render();
    expect(html).toContain("agent.resultRecovery.administratorHelp");
    expect(html).toContain("agent.resultRecovery.administratorInitiated");
    expect(html).not.toContain("agent.resultRecovery.download<");
  });
  it("explains when no original address was retained", () => {
    records.data.items = [];
    records.data.canRecover = false;
    records.data.unavailableReason = "no_results";
    expect(render()).toContain("agent.resultRecovery.noResults");
  });
  it("offers a separate fetch operation for available evidence", () => {
    records.data.items = [];
    expect(render()).toContain("agent.resultRecovery.recover");
    expect(render()).toContain("agent.resultRecovery.help");
  });
  it("explains expired results without presenting regeneration as recovery", () => {
    records.data.items = [
      {
        id: "recovery",
        resultIndex: 0,
        state: "failed",
        createdAt: "2026-10-10T00:00:00Z",
        errorCode: "result_recovery.expired",
      },
    ];
    const html = render();
    expect(html).toContain("agent.resultRecovery.expired");
    expect(html).not.toContain("agent.resultRecovery.download<");
  });
  it("offers the recovered artifact independently of the original failure", () => {
    records.data.items = [
      {
        id: "recovery",
        resultIndex: 0,
        state: "succeeded",
        createdAt: "2026-10-10T00:00:00Z",
        artifactId: "artifact",
      },
    ];
    const html = render();
    expect(html).toContain("agent.resultRecovery.states.succeeded");
    expect(html).toContain("agent.resultRecovery.download");
  });
  it("distinguishes storage failure from fetching the upstream file", () => {
    records.data.items = [
      {
        id: "recovery",
        resultIndex: 0,
        state: "failed",
        createdAt: "2026-10-12T00:00:00Z",
        errorCode: "storage_upload.invalid_argument",
      },
    ];
    expect(render()).toContain("agent.resultRecovery.storageFailed");
  });
});
