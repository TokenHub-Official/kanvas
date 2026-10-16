import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { i18n } from "../i18n/i18n.js";

import {
  EmptyState,
  InlineNotice,
  LoadingState,
  PageEmptyState,
  PageLoading,
} from "./feedback.js";

describe("feedback heading semantics", () => {
  beforeEach(async () => i18n.changeLanguage("zh-CN"));

  it("keeps nested empty states at level two", () => {
    const markup = renderToStaticMarkup(
      <EmptyState title="没有搜索结果">请调整筛选条件。</EmptyState>,
    );

    expect(markup).toContain("<h2");
    expect(markup).not.toContain("<h1");
  });

  it("gives page-level recovery states a single level-one heading", () => {
    const markup = renderToStaticMarkup(
      <PageEmptyState title="无法打开这个页面">
        请检查连接后重试。
      </PageEmptyState>,
    );

    expect(markup).toContain("<h1");
    expect(markup).not.toContain("<h2");
    expect(markup).toContain('data-page-focus-target="true"');
    expect(markup).toContain('tabindex="-1"');
  });

  it("exposes a single disabled busy action while recovery is pending", () => {
    const markup = renderToStaticMarkup(
      <PageEmptyState
        action={() => undefined}
        actionLabel="重新加载"
        actionPending
        title="无法打开页面"
      >
        请检查连接后重试。
      </PageEmptyState>,
    );

    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("disabled");
    expect(markup).toContain("正在重试");
    expect(markup).not.toContain("重新加载");
  });

  it("announces notices without adding a false heading level", () => {
    const markup = renderToStaticMarkup(
      <InlineNotice title="无法登录" tone="danger">
        请检查邮箱和密码。
      </InlineNotice>,
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("ant-alert-filled");
    expect(markup).toContain("border-0");
    expect(markup).not.toContain("border-danger");
    expect(markup).not.toContain("<h3");
  });

  it("keeps recovery actions and dismiss controls in the shared notice", () => {
    const markup = renderToStaticMarkup(
      <InlineNotice
        action={<button>重新加载</button>}
        closable={{ "aria-label": "关闭", onClose: () => undefined }}
        title="状态暂时不可用"
        tone="warning"
      >
        当前结果仍会保留。
      </InlineNotice>,
    );

    expect(markup).toContain('role="status"');
    expect(markup).toContain("重新加载");
    expect(markup).toContain('aria-label="关闭"');
    expect(markup).toContain("ant-alert-warning");
  });

  it("uses the shared state module for empty and loading states", () => {
    const emptyMarkup = renderToStaticMarkup(
      <EmptyState title="暂无内容">完成第一项操作后会显示在这里。</EmptyState>,
    );
    const loadingMarkup = renderToStaticMarkup(
      <LoadingState label="正在加载内容" />,
    );
    const pageLoadingMarkup = renderToStaticMarkup(
      <PageLoading label="正在打开页面" />,
    );

    expect(emptyMarkup).toContain('data-state-module="empty"');
    expect(loadingMarkup).toContain('data-state-module="loading"');
    expect(loadingMarkup).toContain('role="status"');
    expect(loadingMarkup).toContain('aria-busy="true"');
    expect(pageLoadingMarkup).toContain('data-state-module="loading"');
  });

  it("localizes shared default state copy", async () => {
    await i18n.changeLanguage("en-US");

    const loadingMarkup = renderToStaticMarkup(<PageLoading />);
    const retryMarkup = renderToStaticMarkup(
      <PageEmptyState
        action={() => undefined}
        actionLabel="Reload"
        actionPending
        title="Unable to load"
      >
        Check your connection.
      </PageEmptyState>,
    );

    expect(loadingMarkup).toContain("Preparing workspace");
    expect(retryMarkup).toContain("Retrying");
    expect(retryMarkup).not.toContain("正在重试");
  });
});
