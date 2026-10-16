import type * as ReactQuery from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiProblem } from "../api/transport.js";
import { i18n } from "../i18n/i18n.js";
import { ConversationResourcePreview } from "./conversation-resource-preview.js";
const query = vi.hoisted(() => ({
  error: new Error("network"),
  refetch: vi.fn(),
}));
vi.mock("@tanstack/react-query", async (original) => ({
  ...(await original<typeof ReactQuery>()),
  useQuery: () => ({
    isPending: false,
    isError: true,
    error: query.error,
    refetch: query.refetch,
  }),
}));
function render(canManage = true) {
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <ConversationResourcePreview
        resource={{
          kind: "skill",
          id: "archived-skill",
          name: "画板创建与文字编辑",
        }}
        workspaceId="workspace"
        canReadAssets={false}
        onBack={() => {}}
        managementHref="/skills/archived-skill"
        {...(canManage ? { manageAgentHref: "/agents/current/edit" } : {})}
      />
    </I18nextProvider>,
  );
}
describe("linked resource failure recovery", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN");
  });
  it("guides an unavailable Skill to Agent management instead of retrying a dead link", () => {
    query.error = new ApiProblem(
      404,
      "skill_library.not_found",
      "Published Skill was not found.",
    );
    const html = render();
    expect(html).toContain("此 Skill 已不可用");
    expect(html).toContain("更换或移除");
    expect(html).toContain('href="/agents/current/edit"');
    expect(html).not.toContain("重新加载");
    expect(html).not.toContain('href="/skills/archived-skill"');
  });
  it("offers contact guidance without exposing a management action to non-managers", () => {
    query.error = new ApiProblem(
      403,
      "authorization.permission_denied",
      "Denied",
    );
    const html = render(false);
    expect(html).toContain("没有权限");
    expect(html).toContain("联系");
    expect(html).not.toContain('href="/agents/current/edit"');
  });
  it("keeps retry available for temporary connection failures", () => {
    query.error = new TypeError("Failed to fetch");
    const html = render();
    expect(html).toContain("连接");
    expect(html).toContain("重新加载");
  });
});
