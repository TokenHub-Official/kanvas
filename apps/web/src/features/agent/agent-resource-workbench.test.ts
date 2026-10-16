import type { WorkflowCapabilityParameterDeclaration } from "@kanvas/contracts/api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import { App } from "antd";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  AgentResourceWorkbench,
  agentTaskParameterRows,
  agentTaskResourceFields,
  agentTabIndexAfterKey,
  currentAgentWorkbenchEntries,
  agentWorkbenchEntryKey,
  agentWorkbenchResourceKey,
  agentWorkbenchTaskEntry,
} from "./agent-resource-workbench.js";
import "../../i18n/i18n.js";

describe("Agent resource workbench", () => {
  it("uses one tab identity for the same Canvas across message positions", () => {
    const current = {
      kind: "canvas" as const,
      resourceId: "01K00000000000000000000001",
      state: "available" as const,
    };

    expect(agentWorkbenchResourceKey(current)).toBe(
      "canvas:01K00000000000000000000001",
    );
    expect(agentWorkbenchResourceKey({ ...current, version: 3 })).toBe(
      "canvas:01K00000000000000000000001",
    );
  });

  it("wraps resource tab focus for arrow keys", () => {
    expect(agentTabIndexAfterKey(2, 3, "ArrowRight")).toBe(0);
    expect(agentTabIndexAfterKey(0, 3, "ArrowLeft")).toBe(2);
    expect(agentTabIndexAfterKey(1, 3, "Enter")).toBeUndefined();
  });

  it("places production tasks in the same tab history as resources", () => {
    expect(
      agentWorkbenchEntryKey(
        agentWorkbenchTaskEntry({
          id: "01K00000000000000000000002",
          kind: "workflow",
          lifecycleStatus: "running",
          title: "生成新品海报",
        }),
      ),
    ).toBe("task:01K00000000000000000000002");
  });

  it("refreshes an already-open task with its latest lifecycle facts", () => {
    const opened = agentWorkbenchTaskEntry({
      id: "01K00000000000000000000002",
      kind: "workflow",
      lifecycleStatus: "waiting_approval",
      title: "生成新品海报",
    });
    const current = agentWorkbenchTaskEntry({
      id: "01K00000000000000000000002",
      kind: "workflow",
      lifecycleStatus: "succeeded",
      title: "生成新品海报",
      workflowRunId: "01K00000000000000000000003",
    });

    expect(currentAgentWorkbenchEntries([opened], [current])).toEqual([
      current,
    ]);
  });

  it("links a waiting task to its existing approval run", () => {
    const workspaceId = "01K00000000000000000000004";
    const workflowRunId = "01K00000000000000000000005";
    const workflowRevisionId = "01K00000000000000000000003";
    const task = agentWorkbenchTaskEntry({
      id: "01K00000000000000000000002",
      kind: "workflow",
      lifecycleStatus: "waiting_approval",
      title: "生成新品海报",
      workflowRevisionId,
      workflowRunId,
    });
    const queryClient = new QueryClient();
    queryClient.setQueryData(
      ["agent-workflow-task", workspaceId, workflowRunId],
      {
        id: workflowRunId,
        pendingApprovals: [
          {
            id: "01K00000000000000000000006",
            nodeRunId: "01K00000000000000000000007",
            nodeKey: "review",
            title: "确认本次生成",
            decisionSchema: { type: "object" },
            expiresAt: "2026-09-15T02:00:00.000Z",
          },
        ],
        workflowRevisionId,
        definitionKind: "published_revision",
        nonProduction: false,
        lifecycleStatus: "waiting",
        input: {},
        nodes: [],
        version: 2,
        createdAt: "2026-09-15T01:00:00.000Z",
        updatedAt: "2026-09-15T01:01:00.000Z",
      },
    );
    const router = createRouter({
      routeTree: createRootRoute(),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });

    const markup = renderToStaticMarkup(
      createElement(RouterContextProvider, {
        router,
        children: createElement(
          App,
          null,
          createElement(
            QueryClientProvider,
            { client: queryClient },
            createElement(AgentResourceWorkbench, {
              activeKey: agentWorkbenchEntryKey(task),
              availableEntries: [task],
              canDownloadArtifact: false,
              canEdit: false,
              entries: [task],
              onActiveChange: vi.fn(),
              onClose: vi.fn(),
              onCloseItem: vi.fn(),
              onEdit: vi.fn(),
              onOpenEntry: vi.fn(),
              workspaceId,
            }),
          ),
        ),
      }),
    );

    expect(markup).toMatch(/打开运行处理审批|Open run to decide/u);
    expect(markup).toContain(
      `href="/w/${workspaceId}/workflow-runs/${workflowRunId}"`,
    );
  });

  it("keeps result actions in the selected task tab", () => {
    const task = agentWorkbenchTaskEntry({
      id: "01K00000000000000000000002",
      kind: "workflow",
      lifecycleStatus: "succeeded",
      title: "生成新品海报",
      resultArtifacts: [
        {
          resourceId: "01K00000000000000000000003",
          kind: "image",
          state: "available",
        },
      ],
    });
    const markup = renderToStaticMarkup(
      createElement(
        App,
        null,
        createElement(
          QueryClientProvider,
          { client: new QueryClient() },
          createElement(AgentResourceWorkbench, {
            activeKey: agentWorkbenchEntryKey(task),
            availableEntries: [task],
            canDownloadArtifact: true,
            canEdit: false,
            entries: [task],
            onActiveChange: vi.fn(),
            onClose: vi.fn(),
            onCloseItem: vi.fn(),
            onEdit: vi.fn(),
            onOpenEntry: vi.fn(),
            workspaceId: "01K00000000000000000000004",
          }),
        ),
      ),
    );

    expect(markup).not.toMatch(/在画板中编辑|Edit on a board/u);
    expect(markup).toMatch(/>下载<|>Download</u);
  });

  it("shows localized declared Capability output values instead of a count", () => {
    const workspaceId = "01K00000000000000000000004";
    const capabilityRunId = "01K00000000000000000000005";
    const task = agentWorkbenchTaskEntry({
      id: "01K00000000000000000000002",
      kind: "capability",
      lifecycleStatus: "succeeded",
      title: "提取色板",
      capabilityContractRevisionId: "01K00000000000000000000003",
      capabilityRunId,
      capabilityRunStatus: "completed",
    });
    const queryClient = new QueryClient();
    queryClient.setQueryData(
      ["agent-capability-task", workspaceId, capabilityRunId],
      {
        id: capabilityRunId,
        contractRevisionId: "01K00000000000000000000003",
        invocationKind: "agent",
        lifecycleStatus: "completed",
        input: { quality: "high" },
        inputDeclarations: [
          {
            key: "quality",
            label: { "zh-CN": "采样精度", "en-US": "Sampling precision" },
            semanticType: "value.any",
            required: false,
            exposurePolicy: {
              allowed: ["workflow_author"],
              default: "workflow_author",
            },
            sourcePolicy: {
              allowed: ["workflow_input"],
              default: "workflow_input",
            },
            editor: "text",
          },
        ],
        output: {
          colors: [
            { hex: "#1f5f99", ratio: 0.62 },
            { hex: "#f0d7a1", ratio: 0.38 },
          ],
          qualitySignals: {
            deterministic: true,
            schemaVersion: "quality/v1",
          },
          sourceArtifactId: "01K00000000000000000000009",
          schemaVersion: 1,
        },
        outputDeclarations: [
          {
            key: "colors",
            label: { "zh-CN": "主要颜色", "en-US": "Dominant colors" },
            semanticType: "value.any",
            primary: true,
            visibility: "author",
          },
          {
            key: "qualitySignals",
            label: { "zh-CN": "质量信息", "en-US": "Quality signals" },
            semanticType: "quality.signals",
            primary: false,
            visibility: "advanced",
          },
          {
            key: "sourceArtifactId",
            label: { "zh-CN": "源图片", "en-US": "Source image" },
            semanticType: "artifact.image",
            primary: false,
            visibility: "advanced",
          },
          {
            key: "schemaVersion",
            label: { "zh-CN": "结果版本", "en-US": "Result version" },
            semanticType: "value.any",
            primary: false,
            visibility: "hidden",
          },
        ],
        version: 2,
        executionDeadlineAt: "2026-09-15T01:05:00.000Z",
        createdAt: "2026-09-15T01:00:00.000Z",
        updatedAt: "2026-09-15T01:01:00.000Z",
        completedAt: "2026-09-15T01:01:00.000Z",
      },
    );

    const markup = renderToStaticMarkup(
      createElement(
        App,
        null,
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(AgentResourceWorkbench, {
            activeKey: agentWorkbenchEntryKey(task),
            availableEntries: [task],
            canDownloadArtifact: false,
            canEdit: false,
            canReadCapabilities: true,
            entries: [task],
            onActiveChange: vi.fn(),
            onClose: vi.fn(),
            onCloseItem: vi.fn(),
            onEdit: vi.fn(),
            onOpenEntry: vi.fn(),
            workspaceId,
          }),
        ),
      ),
    );

    expect(markup).toMatch(/主要颜色|Dominant colors/u);
    expect(markup).toMatch(/采样精度|Sampling precision/u);
    expect(markup).toContain("high");
    expect(markup).toContain("#1f5f99");
    expect(markup).toContain("0.62");
    expect(markup).toMatch(/技术详情|Technical details/u);
    expect(markup).toMatch(/质量信息|Quality signals/u);
    expect(markup).toContain("quality/v1");
    expect(markup).toMatch(/<details(?![^>]*\bopen\b)[^>]*>/u);
    expect(markup).not.toContain("sourceArtifactId");
    expect(markup).not.toMatch(/结果版本|Result version/u);
    expect(markup).not.toMatch(
      /暂无可预览的输出结果|No previewable output yet/u,
    );
  });

  it("shows the published Workflow output fields when no artifact was produced", () => {
    const workspaceId = "01K00000000000000000000004";
    const workflowRunId = "01K00000000000000000000005";
    const workflowRevisionId = "01K00000000000000000000003";
    const task = agentWorkbenchTaskEntry({
      id: "01K00000000000000000000002",
      kind: "workflow",
      lifecycleStatus: "succeeded",
      title: "整理素材说明",
      workflowRevisionId,
      workflowRunId,
    });
    const queryClient = new QueryClient();
    queryClient.setQueryData(
      ["agent-workflow-task", workspaceId, workflowRunId],
      {
        id: workflowRunId,
        workflowRevisionId,
        definitionKind: "published_revision",
        nonProduction: false,
        lifecycleStatus: "completed",
        outcome: "full_success",
        version: 2,
        input: {},
        output: {
          summary: "已提取标题、正文和报名信息。",
          sections: [
            { included: true, name: "标题" },
            { included: true, name: "正文" },
            { included: false, name: "报名信息" },
          ],
        },
        nodes: [],
        createdAt: "2026-09-15T01:00:00.000Z",
        updatedAt: "2026-09-15T01:01:00.000Z",
        completedAt: "2026-09-15T01:01:00.000Z",
      },
    );
    queryClient.setQueryData(
      ["workflow-template", workspaceId, workflowRevisionId],
      {
        outputSchema: {
          type: "object",
          properties: {
            summary: { type: "string", title: "处理说明" },
            sections: {
              type: "array",
              title: "已处理部分",
              items: {
                type: "object",
                properties: {
                  name: { type: "string", title: "部分" },
                  included: { type: "boolean", title: "已纳入" },
                },
              },
            },
          },
        },
      },
    );

    const markup = renderToStaticMarkup(
      createElement(
        App,
        null,
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(AgentResourceWorkbench, {
            activeKey: agentWorkbenchEntryKey(task),
            availableEntries: [task],
            canDownloadArtifact: false,
            canEdit: false,
            entries: [task],
            onActiveChange: vi.fn(),
            onClose: vi.fn(),
            onCloseItem: vi.fn(),
            onEdit: vi.fn(),
            onOpenEntry: vi.fn(),
            workspaceId,
          }),
        ),
      ),
    );

    expect(markup).toContain("处理说明");
    expect(markup).toContain("已提取标题、正文和报名信息。");
    expect(markup).toContain("已处理部分");
    expect(markup).toContain("已纳入");
    expect(markup).toContain("报名信息");
    expect(markup).not.toMatch(
      /暂无可预览的输出结果|No previewable output yet/u,
    );
  });

  it("shows governed readable inputs without exposing resource identifiers", () => {
    expect(
      agentTaskParameterRows(
        {
          schemaVersion: "kanvas.effective-invocation-schema/v1",
          availability: "available",
          controlledParameterKeys: [],
          validationSchema: {
            schemaVersion: "kanvas.effective-invocation-validation-schema/v1",
            document: "{}",
          },
          fields: [
            {
              key: "prompt",
              label: "Prompt",
              required: true,
              valueType: "string",
              maxLength: 500,
            },
            {
              key: "source",
              label: "输入素材",
              required: false,
              valueType: "artifact",
            },
          ],
        },
        {
          prompt: "海滨度假酒店，清爽安静",
          source: "01K00000000000000000000003",
        },
        "画面要求",
      ),
    ).toEqual([{ label: "画面要求", value: "海滨度假酒店，清爽安静" }]);
  });

  it("shows readable Capability inputs when no Workflow schema is available", () => {
    expect(
      agentTaskParameterRows(
        undefined,
        {
          prompt: "清明节气海报",
          quality: "high",
          aspectRatio: "1:1",
          sourceArtifactId: "01K00000000000000000000003",
        },
        "画面要求",
        {
          locale: "zh-CN",
        },
      ),
    ).toEqual([
      { label: "画面要求", value: "清明节气海报" },
      { label: "质量", value: "high" },
      { label: "宽高比", value: "1:1" },
    ]);
  });
  it("uses localized run declarations and hides undeclared, derived and resource inputs", () => {
    const declaration: WorkflowCapabilityParameterDeclaration = {
      key: "quality",
      label: { "zh-CN": "细节程度", "en-US": "Detail level" },
      semanticType: "value.any",
      required: false,
      exposurePolicy: {
        allowed: ["workflow_author"] as const,
        default: "workflow_author" as const,
      },
      sourcePolicy: {
        allowed: ["workflow_input"] as const,
        default: "workflow_input" as const,
      },
      editor: "text" as const,
    };
    const declarations: WorkflowCapabilityParameterDeclaration[] = [
      declaration,
      { ...declaration, key: "source", semanticType: "artifact.image" },
      {
        ...declaration,
        key: "derived",
        exposurePolicy: {
          allowed: ["hidden_derived"] as const,
          default: "hidden_derived" as const,
        },
      },
    ];
    const input = {
      quality: "high",
      source: "private-reference",
      derived: "internal",
      extra: "unlisted",
    };
    expect(
      agentTaskParameterRows(undefined, input, "提示词", {
        declarations,
        locale: "zh-CN",
      }),
    ).toEqual([{ label: "细节程度", value: "high" }]);
    expect(
      agentTaskParameterRows(undefined, input, "Prompt", {
        declarations,
        locale: "en-US",
      }),
    ).toEqual([{ label: "Detail level", value: "high" }]);
    expect(
      agentTaskParameterRows(undefined, input, "Prompt", { declarations: [] }),
    ).toEqual([]);
    expect(
      agentTaskParameterRows(
        undefined,
        { quality: "high", seed: 7 },
        "提示词",
        { locale: "zh-CN" },
      ),
    ).toEqual([
      { label: "质量", value: "high" },
      { label: "随机种子", value: "7" },
    ]);
  });
});

describe("declared task resources", () => {
  const first = "01K00000000000000000000003";
  const second = "01K00000000000000000000004";
  const third = "01K00000000000000000000005";
  const field: WorkflowCapabilityParameterDeclaration = {
    key: "subjectMaterial",
    label: { "zh-CN": "主体素材", "en-US": "Subject material" },
    semanticType: "artifact.image",
    required: true,
    exposurePolicy: {
      allowed: ["workflow_author"],
      default: "workflow_author",
    },
    sourcePolicy: { allowed: ["workflow_input"], default: "workflow_input" },
    editor: "artifact_picker",
  };
  const references = {
    ...field,
    key: "moodboard",
    label: { "zh-CN": "风格参考", "en-US": "Style references" },
    semanticType: "artifact.image_list",
    editor: "artifact_list_picker",
  } as const;
  it("uses arbitrary declared keys, localized labels and role order without guessing parameter names", () => {
    const declarations = [
      field,
      references,
      {
        ...field,
        key: "hidden",
        exposurePolicy: {
          allowed: ["hidden_derived"],
          default: "hidden_derived",
        },
      } satisfies WorkflowCapabilityParameterDeclaration,
    ];
    const input = {
      subjectMaterial: first,
      moodboard: [second, second, "invalid", third],
      hidden: first,
      sourceArtifactId: third,
    };
    expect(
      agentTaskResourceFields(undefined, input, {
        declarations,
        locale: "zh-CN",
      }),
    ).toEqual([
      { key: "subjectMaterial", label: "主体素材", artifactIds: [first] },
      { key: "moodboard", label: "风格参考", artifactIds: [second, third] },
    ]);
    expect(
      agentTaskResourceFields(undefined, input, {
        declarations,
        locale: "en-US",
      }).map((field) => field.label),
    ).toEqual(["Subject material", "Style references"]);
    expect(agentTaskResourceFields(undefined, input)).toEqual([]);
    expect(
      agentTaskResourceFields(undefined, input, { declarations: [] }),
    ).toEqual([]);
    expect(
      agentTaskResourceFields(
        undefined,
        { subjectMaterial: null, moodboard: [] },
        { declarations },
      ),
    ).toEqual([]);
  });
  it("retains Workflow resource roles from its effective invocation schema", () => {
    expect(
      agentTaskResourceFields(
        {
          schemaVersion: "kanvas.effective-invocation-schema/v1",
          availability: "available",
          controlledParameterKeys: [],
          validationSchema: {
            schemaVersion: "kanvas.effective-invocation-validation-schema/v1",
            document: "{}",
          },
          fields: [
            {
              key: "materials",
              label: "参考资料",
              required: true,
              valueType: "artifact_list",
              minItems: 0,
              maxItems: 10,
              uniqueItems: true,
            },
          ],
        },
        { materials: [first, second] },
      ),
    ).toEqual([
      { key: "materials", label: "参考资料", artifactIds: [first, second] },
    ]);
  });
  it("renders resource groups in a completed Capability task beside downloads", () => {
    const workspaceId = "01K00000000000000000000001";
    const capabilityRunId = "01K00000000000000000000002";
    const task = agentWorkbenchTaskEntry({
      id: third,
      kind: "capability",
      title: "Reference-based work",
      lifecycleStatus: "succeeded",
      capabilityRunId,
      resultArtifacts: [
        { resourceId: first, kind: "image", state: "available" },
      ],
    });
    const client = new QueryClient();
    client.setQueryData(
      ["agent-capability-task", workspaceId, capabilityRunId],
      {
        id: capabilityRunId,
        lifecycleStatus: "completed",
        input: { subjectMaterial: first, moodboard: [second] },
        inputDeclarations: [field, references],
      },
    );
    const markup = renderToStaticMarkup(
      createElement(
        App,
        null,
        createElement(
          QueryClientProvider,
          { client },
          createElement(AgentResourceWorkbench, {
            workspaceId,
            activeKey: agentWorkbenchEntryKey(task),
            availableEntries: [task],
            entries: [task],
            canReadCapabilities: true,
            canDownloadArtifact: true,
            canEdit: false,
            onActiveChange: vi.fn(),
            onClose: vi.fn(),
            onCloseItem: vi.fn(),
            onEdit: vi.fn(),
            onOpenEntry: vi.fn(),
          }),
        ),
      ),
    );
    expect(markup).toContain('id="agent-task-input"');
    expect(markup).toMatch(/主体素材|Subject material/u);
    expect(markup).toMatch(/风格参考|Style references/u);
    expect(markup).toContain("object-contain");
    expect(markup).not.toMatch(/在画板中编辑|Edit on a board/u);
    expect(markup).toMatch(/>下载<|>Download</u);
  });
});
