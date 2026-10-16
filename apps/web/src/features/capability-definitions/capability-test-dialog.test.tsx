import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { i18n } from "../../i18n/i18n.js";

import {
  CapabilityTestBrowserRuntimeNotice,
  CapabilityTestActions,
  CapabilityTestEmptyAssets,
  CapabilityTestFailure,
  CapabilityTestInputLayout,
  CapabilityTestOutputValue,
  CapabilityTestResultValues,
  capabilityTestUsesBrowserRuntime,
} from "./capability-test-dialog.js";

describe("Capability test prerequisites", () => {
  beforeEach(async () => i18n.changeLanguage("zh-CN"));

  it("gives an operator a direct recovery action when no image can be tested", () => {
    const markup = renderToStaticMarkup(
      <CapabilityTestEmptyAssets
        visible
        workspaceId="01K00000000000000000000000"
      />,
    );

    expect(markup).toContain("还没有可测试的图片");
    expect(markup).toContain("前往资产库添加");
    expect(markup).toContain('href="/w/01K00000000000000000000000/assets"');
  });

  it("does not add guidance when an image is already selectable", () => {
    expect(
      renderToStaticMarkup(
        <CapabilityTestEmptyAssets
          visible={false}
          workspaceId="01K00000000000000000000000"
        />,
      ),
    ).toBe("");
  });

  it("offers cancellation instead of silently closing an active run", () => {
    const markup = renderToStaticMarkup(
      <CapabilityTestActions
        cancelling={false}
        hasRun
        missingRequired={false}
        onCancel={() => undefined}
        onClose={() => undefined}
        onNew={() => undefined}
        onStart={() => undefined}
        starting={false}
        status="running"
      />,
    );

    expect(markup).toContain("取消测试");
    expect(markup).not.toContain(">关闭<");
    expect(markup).not.toContain("开始测试");
  });

  it("keeps terminal runs recoverable without reopening the dialog", () => {
    const cancelled = renderToStaticMarkup(
      <CapabilityTestActions
        cancelling={false}
        hasRun
        missingRequired={false}
        onCancel={() => undefined}
        onClose={() => undefined}
        onNew={() => undefined}
        onStart={() => undefined}
        starting={false}
        status="cancelled"
      />,
    );

    expect(cancelled).toContain("完 成");
    expect(cancelled).toContain("新测试");
    expect(cancelled).not.toContain("开始测试");
  });

  it("puts a completed result before its collapsed input", () => {
    const markup = renderToStaticMarkup(
      <CapabilityTestInputLayout completedResult={<div>已完成结果</div>}>
        <div>已停用输入</div>
      </CapabilityTestInputLayout>,
    );

    expect(markup.indexOf("已完成结果")).toBeLessThan(
      markup.indexOf("已停用输入"),
    );
    expect(markup).toContain("本次输入");
    expect(markup).toContain("ant-collapse");
    expect(markup).toContain('aria-expanded="false"');
  });

  it("keeps editable and non-success input directly visible", () => {
    const markup = renderToStaticMarkup(
      <CapabilityTestInputLayout>
        <div>可编辑输入</div>
      </CapabilityTestInputLayout>,
    );

    expect(markup).toContain("可编辑输入");
    expect(markup).not.toContain("ant-collapse");
  });

  it("mounts browser execution only when the first ready binding uses it", () => {
    const binding = (
      id: string,
      order: number,
      executionTarget: "browser" | "provider" | "worker",
      availabilityReason: "ready" | "implementation_unavailable" = "ready",
    ) => ({
      availabilityReason,
      executionTarget,
      id,
      order,
      status: "enabled" as const,
    });

    expect(
      capabilityTestUsesBrowserRuntime([
        binding("browser", 20, "browser"),
        binding("worker", 10, "worker"),
      ]),
    ).toBe(false);
    expect(
      capabilityTestUsesBrowserRuntime([
        binding("browser", 10, "browser"),
        binding("worker", 20, "worker"),
      ]),
    ).toBe(true);
    expect(
      capabilityTestUsesBrowserRuntime([
        binding("browser", 10, "browser", "implementation_unavailable"),
      ]),
    ).toBe(false);
  });

  it("shows browser connection state and an explicit reconnect action", () => {
    const markup = renderToStaticMarkup(
      <CapabilityTestBrowserRuntimeNotice
        canRun
        onReconnect={() => undefined}
        state="unavailable"
      />,
    );

    expect(markup).toContain("浏览器处理");
    expect(markup).toContain("暂时无法运行这个浏览器步骤");
    expect(markup).toContain("重新连接");
  });

  it("turns runtime failures into recovery guidance without raw codes", () => {
    const markup = renderToStaticMarkup(
      <CapabilityTestFailure error={{ code: "capability_run.unavailable" }} />,
    );

    expect(markup).toContain("当前没有可用的运行方式");
    expect(markup).toContain("检查运行方式后重试");
    expect(markup).not.toContain("capability_run.unavailable");
  });

  it("shows the actual structured output instead of only its item count", () => {
    const markup = renderToStaticMarkup(
      <CapabilityTestOutputValue value={[{ score: 0.9 }, { score: 0.8 }]} />,
    );

    expect(markup).toContain("score");
    expect(markup).toContain("0.9");
    expect(markup).toContain("0.8");
    expect(markup).not.toContain("2 项结果");
  });

  it("keeps author results visible and advanced results in closed details", () => {
    const markup = renderToStaticMarkup(
      <CapabilityTestResultValues
        declarations={[
          {
            key: "colors",
            label: { "en-US": "Colors", "zh-CN": "主要颜色" },
            semanticType: "value.any",
            primary: true,
            visibility: "author",
          },
          {
            key: "qualitySignals",
            label: { "en-US": "Quality", "zh-CN": "质量信息" },
            semanticType: "quality.signals",
            primary: false,
            visibility: "advanced",
          },
          {
            key: "schemaVersion",
            label: { "en-US": "Version", "zh-CN": "结果版本" },
            semanticType: "value.any",
            primary: false,
            visibility: "hidden",
          },
        ]}
        language="zh-CN"
        output={{
          colors: [{ hex: "#1F5F99", rank: 1 }],
          qualitySignals: {
            deterministic: true,
            schemaVersion: "quality/v1",
          },
          schemaVersion: "result/v1",
        }}
        outputSchema={{
          type: "object",
          properties: {
            colors: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  hex: { type: "string", title: "色值" },
                  rank: { type: "integer", title: "顺序" },
                },
              },
            },
            qualitySignals: {
              type: "object",
              properties: {
                deterministic: { type: "boolean", title: "结果可复现" },
                schemaVersion: { type: "string" },
              },
            },
            schemaVersion: { type: "string" },
          },
        }}
        workspaceId="01K00000000000000000000004"
      />,
    );

    expect(markup).toContain("主要颜色");
    expect(markup).toContain("ant-table");
    expect(markup).toMatch(/<details(?![^>]*\bopen\b)[^>]*>/u);
    expect(markup).toContain("技术详情");
    expect(markup).toContain("质量信息");
    expect(markup).toContain("quality/v1");
    expect(markup).not.toContain("result/v1");
  });
});
