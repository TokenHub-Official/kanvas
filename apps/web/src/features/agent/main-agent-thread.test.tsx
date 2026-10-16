import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { MainAgentThread } from "./main-agent-thread.js";
import "../../i18n/i18n.js";

function renderThread(
  tasks: Parameters<typeof MainAgentThread>[0]["tasks"] = [],
  messages: Parameters<typeof MainAgentThread>[0]["messages"] = [
    {
      id: "01K00000000000000000000001",
      role: "user",
      parts: [{ type: "text", text: "制作一张新品海报" }],
      relatedContent: [],
      createdAt: "2026-08-25T12:00:00.000Z",
    },
    {
      id: "01K00000000000000000000002",
      role: "assistant",
      parts: [
        { type: "reasoning", text: "先确认需求，再选择可执行的制作路径。" },
        { type: "tool-call", toolCallId: "call-1", toolName: "prepare" },
        { type: "tool-call", toolCallId: "call-2", toolName: "inspect" },
        {
          type: "text",
          text: "**制作方案已经准备好。**\n\n```ts\nconst ready = true;\n```",
        },
      ],
      relatedContent: [],
      createdAt: "2026-08-25T12:00:01.000Z",
    },
  ],
  failure: {
    readonly entryShortcuts?: Parameters<
      typeof MainAgentThread
    >[0]["entryShortcuts"];
    readonly canDownloadArtifact?: boolean;
    readonly canSaveAsset?: boolean;
    readonly csrfToken?: string;
    readonly queryClient?: QueryClient;
    readonly canReadCapabilities?: boolean;
    readonly onContinueTask?: Parameters<
      typeof MainAgentThread
    >[0]["onContinueTask"];
    readonly onAddResultToComposer?: Parameters<
      typeof MainAgentThread
    >[0]["onAddResultToComposer"];
    readonly onReuseFailedRequest?: () => void;
    readonly canManageModels?: boolean;
    readonly failedRunId?: string;
    readonly onOpenDiagnostics?: Parameters<
      typeof MainAgentThread
    >[0]["onOpenDiagnostics"];
    readonly isRunning?: boolean;
    readonly activeRunAssistantMessageId?: string;
    readonly branchActionPending?: boolean;
    readonly regeneratingMessageId?: string;
    readonly runStatus?: Parameters<typeof MainAgentThread>[0]["runStatus"];
    readonly runFailureKind?: Parameters<
      typeof MainAgentThread
    >[0]["runFailureKind"];
  } = {},
): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={failure.queryClient ?? new QueryClient()}>
      <MainAgentThread
        {...(failure.entryShortcuts
          ? { entryShortcuts: failure.entryShortcuts }
          : {})}
        canDownloadArtifact={failure.canDownloadArtifact ?? false}
        canSaveAsset={failure.canSaveAsset ?? false}
        {...(failure.csrfToken ? { csrfToken: failure.csrfToken } : {})}
        {...(failure.onContinueTask
          ? { onContinueTask: failure.onContinueTask }
          : {})}
        {...(failure.onAddResultToComposer
          ? { onAddResultToComposer: failure.onAddResultToComposer }
          : {})}
        canManageModels={failure.canManageModels ?? false}
        canReadWorkflow={false}
        canReadCapabilities={failure.canReadCapabilities ?? false}
        canRunWorkflow
        composerValue=""
        isRunning={failure.isRunning ?? false}
        branchActionPending={failure.branchActionPending ?? false}
        {...(failure.activeRunAssistantMessageId
          ? { activeRunAssistantMessageId: failure.activeRunAssistantMessageId }
          : {})}
        messages={messages}
        onConfirm={vi.fn(() => Promise.resolve())}
        onComposerChange={vi.fn()}
        onDecline={vi.fn(() => Promise.resolve())}
        onOpenResource={vi.fn()}
        onOpenTask={vi.fn()}
        {...(failure.onOpenDiagnostics
          ? { onOpenDiagnostics: failure.onOpenDiagnostics }
          : {})}
        {...(failure.onReuseFailedRequest
          ? { onReuseFailedRequest: failure.onReuseFailedRequest }
          : {})}
        onRegenerate={vi.fn(() => Promise.resolve())}
        onResolveInteraction={vi.fn(() => Promise.resolve())}
        onSelectBranch={vi.fn(() => Promise.resolve())}
        onSend={vi.fn(() => Promise.resolve())}
        onStop={vi.fn(() => Promise.resolve())}
        {...(failure.runFailureKind
          ? { runFailureKind: failure.runFailureKind }
          : {})}
        {...(failure.failedRunId ? { failedRunId: failure.failedRunId } : {})}
        {...(failure.regeneratingMessageId
          ? { regeneratingMessageId: failure.regeneratingMessageId }
          : {})}
        {...(failure.runStatus ? { runStatus: failure.runStatus } : {})}
        tasks={tasks}
        workspaceId="01K00000000000000000000003"
      />
    </QueryClientProvider>,
  );
}

describe("MainAgentThread", () => {
  it("shows pinned library use evidence and renders source labels as text", () => {
    const markup = renderThread(
      [],
      [
        {
          id: "01K00000000000000000000002",
          role: "assistant",
          parts: [{ type: "text", text: "已参考产品资料。" }],
          relatedContent: [],
          createdAt: "2026-08-25T12:00:01.000Z",
          libraryUses: [
            {
              libraryId: "01K00000000000000000000004",
              entryId: "01K00000000000000000000005",
              libraryName: "产品资料",
              name: "<script>source-label</script>",
              revisionNumber: 7,
              kind: "text_read",
            },
          ],
        },
      ],
    );
    expect(markup).toContain("产品资料");
    expect(markup).toContain("&lt;script&gt;source-label&lt;/script&gt;");
    expect(markup).not.toContain("<script>source-label");
    expect(markup).not.toContain("libraries.useKind.text_read");
  });

  it("uses the same live capability status as the open task detail", () => {
    const client = new QueryClient();
    const runId = "01K00000000000000000000005";
    client.setQueryData(
      ["agent-capability-task", "01K00000000000000000000003", runId],
      {
        id: runId,
        lifecycleStatus: "failed",
        version: 3,
        error: { code: "provider.output_materialization_failed" },
      },
    );
    const markup = renderThread(
      [
        {
          id: "01K00000000000000000000004",
          kind: "capability",
          lifecycleStatus: "running",
          title: "图生图",
          messageId: "01K00000000000000000000002",
          capabilityRunId: runId,
          capabilityRunStatus: "running",
        },
      ],
      undefined,
      { queryClient: client, canReadCapabilities: true },
    );
    expect(markup).toMatch(/制作失败|Production failed/u);
    expect(markup).not.toMatch(/正在制作|In production/u);
  });

  it("uses the open-source thread runtime while rendering user-facing Kanvas messages", () => {
    const markup = renderThread();

    expect(markup).toContain("制作一张新品海报");
    expect(markup).toContain("制作方案已经准备好。");
    expect(markup).not.toContain("**制作方案");
    expect(markup).toContain("先确认需求，再选择可执行的制作路径。");
    expect(markup).toMatch(/使用了 2 项能力|Capabilities used: 2/u);
    expect(markup).toMatch(/处理信息 × 2|Processed information × 2/u);
    expect(markup).toContain("max-h-72");
    expect(markup).toContain('data-streamdown="code-block-copy-button"');
    expect(markup).not.toContain("ToolView");
    expect(markup).toMatch(/复制消息|Copy message/u);
    expect(markup).toMatch(/回到底部|Scroll to bottom/u);
    expect(markup).toMatch(/重新生成|Regenerate/u);
    expect(markup).not.toContain("autofocus");
    const userTurn = markup
      .split('data-role="assistant"')[0]
      ?.split('data-role="user"')[1];
    const userBubble = userTurn?.match(/<article[\s\S]*?<\/article>/u)?.[0];
    expect(userBubble).not.toContain("anticon-copy");
  });

  it("renders a pending Agent question without exposing it as Tool activity", () => {
    const interactionId = "01K00000000000000000000004";
    const markup = renderThread(
      [],
      [
        {
          id: "01K00000000000000000000002",
          role: "assistant",
          parts: [
            {
              type: "tool-call",
              toolCallId: "provider-question-call",
              toolName: "ask_question",
            },
          ],
          relatedContent: [],
          interactions: [
            {
              id: interactionId,
              kind: "question",
              lifecycleStatus: "pending",
              version: 1,
              questions: [
                {
                  key: "format",
                  header: "输出形式",
                  question: "你希望先得到哪种结果？",
                  options: [
                    {
                      key: "outline",
                      label: "结构提纲",
                      recommended: true,
                    },
                    { key: "draft", label: "完整初稿" },
                  ],
                },
                {
                  key: "tone",
                  header: "表达语气",
                  question: "你希望使用哪种表达语气？",
                  options: [
                    { key: "formal", label: "正式" },
                    { key: "casual", label: "轻松" },
                  ],
                },
              ],
              createdAt: "2026-08-25T12:00:01.000Z",
              updatedAt: "2026-08-25T12:00:01.000Z",
            },
          ],
          createdAt: "2026-08-25T12:00:01.000Z",
        },
      ],
    );

    expect(markup).toContain("你希望先得到哪种结果？");
    expect(markup).toContain("结构提纲");
    expect(markup).toMatch(/推荐|Recommended/u);
    expect(markup).toContain("Q1");
    expect(markup).toContain("Q2");
    expect(markup).not.toContain("你希望使用哪种表达语气？");
    expect(markup).toMatch(/补充说明|Additional notes/u);
    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('aria-keyshortcuts="Escape"');
    expect(markup).toContain('aria-keyshortcuts="Enter"');
    expect(markup).toMatch(/>1<\/span>/u);
    expect(markup).toMatch(/>提交<|>Submit</u);
    expect(markup).not.toMatch(/结束任务|End task/u);
    expect(markup).not.toMatch(/使用了 1 项能力|Used 1 capability/u);
    expect(markup).not.toContain("ask_question");
    expect(markup).not.toContain(interactionId);
  });

  it("renders the common Markdown set with bounded production controls", () => {
    const markup = renderThread(
      [],
      [
        {
          id: "01K00000000000000000000002",
          role: "assistant",
          parts: [
            {
              type: "text",
              text: [
                "# 一级标题",
                "## 二级标题",
                "**加粗**、*强调*、~~删除~~ 与 `inline()`。",
                "- [x] 已完成\n- [ ] 待处理",
                "1. 第一步\n2. 第二步",
                "> 这是一段引用。",
                "[官方文档](https://example.com/docs)",
                "| 项目 | 状态 |\n| --- | --- |\n| 渲染 | 完成 |",
                "```ts\nconst ready = true;\n```",
                "![结果预览](https://example.com/result.png)",
              ].join("\n\n"),
            },
          ],
          relatedContent: [],
          createdAt: "2026-08-25T12:00:01.000Z",
        },
      ],
    );

    expect(markup).toContain('data-streamdown="heading-1"');
    expect(markup).toContain('data-streamdown="heading-2"');
    expect(markup).toContain('data-streamdown="unordered-list"');
    expect(markup).toContain('data-streamdown="ordered-list"');
    expect(markup).toContain('data-streamdown="blockquote"');
    expect(markup).toContain('data-streamdown="inline-code"');
    expect(markup).toContain('data-streamdown="table"');
    expect(markup).toContain('data-streamdown="code-block"');
    expect(markup).toContain('data-streamdown="image"');
    expect(markup).toContain("agent-markdown");
    expect(markup).not.toContain(
      'data-streamdown="code-block-download-button"',
    );
  });

  it("uses business labels for tool activity without exposing tool keys", () => {
    const markup = renderThread(
      [],
      [
        {
          id: "01K00000000000000000000002",
          role: "assistant",
          parts: [
            { type: "tool-call", toolCallId: "call-1", toolName: "web_search" },
            {
              type: "tool-call",
              toolCallId: "call-2",
              toolName: "thread_inspect-work",
            },
            {
              type: "tool-call",
              toolCallId: "call-3",
              toolName: "canvas.inspect",
            },
            {
              type: "tool-call",
              toolCallId: "call-4",
              toolName: "workflow.propose.entrypoint-1",
            },
            { type: "tool-call", toolCallId: "call-5", toolName: "skill" },
            {
              type: "tool-call",
              toolCallId: "call-6",
              toolName: "skill_search",
            },
            { type: "text", text: "处理完成。" },
          ],
          relatedContent: [],
          createdAt: "2026-08-25T12:00:01.000Z",
        },
      ],
    );

    expect(markup).toMatch(/搜索网页|Searched the web/u);
    expect(markup).toMatch(/检查会话任务|Checked conversation tasks/u);
    expect(markup).toMatch(/更新画板|Updated the board/u);
    expect(markup).toMatch(/准备制作任务|Prepared a production task/u);
    expect(markup).toMatch(/读取 Skill|Read Skill/u);
    expect(markup).toMatch(/查找 Skill|Searched Skills/u);
    expect(markup).not.toContain("thread_inspect-work");
    expect(markup).not.toContain("workflow.propose.entrypoint-1");
  });

  it("groups sources below the answer with useful fallback labels", () => {
    const markup = renderThread(
      [],
      [
        {
          id: "01K00000000000000000000002",
          role: "assistant",
          parts: [
            { type: "text", text: "结论已确认。" },
            {
              type: "source",
              sourceType: "url",
              id: "source-1",
              url: "https://cloud.tencent.com/document/product/1772/115969",
            },
            {
              type: "source",
              sourceType: "url",
              id: "source-2",
              url: "https://cloud.tencent.com/document/product/1772/115969",
            },
            {
              type: "source",
              sourceType: "url",
              id: "source-3",
              url: "https://example.com/guide",
              title: "使用指南",
            },
          ],
          relatedContent: [],
          createdAt: "2026-08-25T12:00:01.000Z",
        },
      ],
    );

    expect(markup).toMatch(/来源|Sources/u);
    expect(markup).toContain("cloud.tencent.com/document/product/1772/115969");
    expect(markup).toContain("使用指南");
    expect(markup.match(/href="https:\/\/cloud\.tencent\.com/g)).toHaveLength(
      1,
    );
    expect(markup).toMatch(/打开来源 1|Open source 1/u);
    expect(markup).toContain("sm:grid-cols-2");
    expect(markup).toContain("cloud.tencent.com</span>");
    expect(markup).toContain("anticon-export");
  });

  it("keeps the run placeholder out of the way once assistant streaming begins", () => {
    const markup = renderThread(
      [],
      [
        {
          id: "01K00000000000000000000002",
          role: "assistant",
          parts: [
            { type: "reasoning", text: "正在核对要求。" },
            { type: "text", text: "**正在整理你的要求" },
          ],
          relatedContent: [],
          createdAt: "2026-08-25T12:00:01.000Z",
        },
      ],
      {
        isRunning: true,
        runStatus: "running",
        activeRunAssistantMessageId: "01K00000000000000000000002",
      },
    );

    expect(markup).toContain('aria-busy="true"');
    expect(markup).toMatch(/正在思考|Thinking/u);
    expect(markup).not.toContain("**正在整理你的要求");
    expect(markup.match(/anticon-loading/gu)).toHaveLength(1);
  });

  it("distinguishes a queued run before the first assistant part arrives", () => {
    const markup = renderThread(
      [],
      [
        {
          id: "01K00000000000000000000001",
          role: "user",
          parts: [{ type: "text", text: "请开始处理" }],
          relatedContent: [],
          createdAt: "2026-08-25T12:00:00.000Z",
        },
      ],
      { isRunning: true, runStatus: "queued" },
    );

    expect(markup).toMatch(/等待开始|Waiting to start/u);
  });

  it("keeps the last user message action outside its blue bubble", () => {
    const markup = renderThread(
      [],
      [
        {
          id: "01K00000000000000000000001",
          role: "user",
          parts: [{ type: "text", text: "制作一张新品海报" }],
          relatedContent: [],
          createdAt: "2026-08-25T12:00:00.000Z",
        },
      ],
    );
    const userTurn = markup.split('data-role="user"')[1];
    const userBubble = userTurn?.match(/<article[\s\S]*?<\/article>/u)?.[0];

    expect(userBubble).not.toContain("anticon-copy");
    expect(userTurn).toContain("anticon-copy");
  });

  it("shows a recoverable model setup failure without exposing internal codes", () => {
    const markup = renderThread(
      [],
      [
        {
          id: "01K00000000000000000000002",
          role: "assistant",
          parts: [{ type: "text", text: "回复内容已返回。" }],
          relatedContent: [],
          createdAt: "2026-08-25T12:00:01.000Z",
        },
      ],
      {
        canManageModels: true,
        failedRunId: "01K00000000000000000000009",
        runFailureKind: "model_setup",
      },
    );

    expect(markup).toMatch(/这条回复未正常完成|did not finish normally/u);
    expect(markup).toMatch(/重新生成|Regenerate/u);
    expect(markup).toContain("/settings/models");
    expect(markup).not.toContain("agent.model_budget_settlement_failed");
  });

  it("offers retry when a recoverable Run failed before an assistant message", () => {
    const markup = renderThread(
      [],
      [
        {
          id: "01K00000000000000000000001",
          role: "user",
          parts: [{ type: "text", text: "制作一张新品海报" }],
          relatedContent: [],
          createdAt: "2026-08-25T12:00:00.000Z",
        },
      ],
      {
        failedRunId: "01K00000000000000000000009",
        runFailureKind: "runtime",
      },
    );

    expect(markup).toMatch(/重新生成|Regenerate/u);
  });

  it("reuses a tools-changed request and exposes its support reference without retrying the old Run", () => {
    const failedRunId = "01K00000000000000000000009";
    const markup = renderThread(undefined, undefined, {
      failedRunId,
      runFailureKind: "tools_changed",
      onReuseFailedRequest: vi.fn(),
    });

    expect(markup).toMatch(/可用工具已更新|Available tools have changed/u);
    expect(markup).toMatch(/填入原需求|Use request again/u);
    expect(markup).not.toMatch(/>重新生成<|>Regenerate</u);
    expect(markup).toMatch(/排查编号|Support reference/u);
    expect(markup).toContain(failedRunId);
    expect(markup).not.toContain("agent.tool_view_changed");
  });

  it("preserves completed output after the step limit without offering regeneration", () => {
    const failedRunId = "01K00000000000000000000009";
    const markup = renderThread(
      [
        {
          id: "01K00000000000000000000004",
          messageId: "01K00000000000000000000002",
          kind: "workflow",
          lifecycleStatus: "succeeded",
          title: "已完成的竖版候选",
          workflowRevisionId: "01K00000000000000000000005",
          workflowRunId: "01K00000000000000000000006",
          resultArtifacts: [
            {
              resourceId: "01K00000000000000000000007",
              kind: "image",
              state: "available",
            },
          ],
        },
      ],
      undefined,
      {
        failedRunId,
        runFailureKind: "limit",
        onOpenDiagnostics: vi.fn(),
      },
    );

    expect(markup).toMatch(/本轮处理达到上限|step limit/u);
    expect(markup).toMatch(
      /已有结果和文件已保留|results and files are preserved/u,
    );
    expect(markup).toContain("制作方案已经准备好。");
    expect(markup).toContain("已完成的竖版候选");
    expect(markup).toMatch(/更多操作|More actions/u);
    expect(markup).toMatch(/查看运行诊断|View run diagnostics/u);
    expect(markup).not.toMatch(/重新生成|Regenerate/u);
    expect(markup).toContain('role="status"');
    expect(markup).toContain(failedRunId);
  });

  it("keeps Asset saving and saved status out of the default result view", () => {
    const task = {
      id: "01K00000000000000000000004",
      messageId: "01K00000000000000000000002",
      kind: "capability" as const,
      lifecycleStatus: "succeeded" as const,
      title: "会话生成图",
      capabilityContractRevisionId: "01K00000000000000000000005",
      capabilityRunId: "01K00000000000000000000006",
      resultArtifacts: [
        {
          resourceId: "01K00000000000000000000007",
          kind: "image" as const,
          state: "available" as const,
        },
      ],
    };
    const unsaved = renderThread([task], undefined, {
      canSaveAsset: true,
      csrfToken: "csrf",
    });
    const saved = renderThread(
      [
        {
          ...task,
          resultArtifacts: [
            {
              ...task.resultArtifacts[0]!,
              assetId: "01K00000000000000000000008",
            },
          ],
        },
      ],
      undefined,
      { canSaveAsset: true, csrfToken: "csrf" },
    );

    expect(unsaved).not.toMatch(/保存到资产库|Save to assets/u);
    expect(saved).not.toMatch(/已保存到资产库|Saved to assets/u);
    expect(saved).toMatch(/更多操作|More actions/u);
  });

  it("marks partial tool activity as stopped when the run fails", () => {
    const markup = renderThread(undefined, undefined, {
      failedRunId: "01K00000000000000000000009",
      runFailureKind: "runtime",
      activeRunAssistantMessageId: "01K00000000000000000000002",
    });

    expect(markup).toMatch(/已停止|Stopped/u);
    expect(markup).toContain('role="alert"');
    expect(markup).toMatch(/这条回复中途停止了|This response stopped early/u);
  });

  it("restores the previous answer when its replacement fails", () => {
    const markup = renderThread(undefined, undefined, {
      isRunning: false,
      regeneratingMessageId: "01K00000000000000000000002",
      runFailureKind: "runtime",
      failedRunId: "01K00000000000000000000009",
    });
    expect(markup).toContain("制作方案已经准备好。");
    expect(markup).toContain('role="alert"');
    expect(markup).not.toContain('aria-busy="true"');
  });

  it("does not animate an older answer after refreshing during a queued replacement", () => {
    const markup = renderThread(undefined, undefined, {
      isRunning: true,
      runStatus: "queued",
    });
    expect(markup).toContain("制作方案已经准备好。");
    expect(markup).toMatch(/等待开始|Waiting to start/u);
  });

  it("removes the previous response while its replacement is being generated", () => {
    const markup = renderThread(undefined, undefined, {
      isRunning: true,
      regeneratingMessageId: "01K00000000000000000000002",
    });

    expect(markup).not.toContain("制作方案已经准备好。");
    expect(markup).toMatch(/正在整理你的要求|Organizing your request/u);
  });

  it("renders a governed approval from a structured task part", () => {
    const markup = renderThread([
      {
        id: "01K00000000000000000000004",
        messageId: "01K00000000000000000000002",
        kind: "workflow",
        lifecycleStatus: "waiting_approval",
        title: "新品海报",
        description: "使用本次品牌准备一张新品视觉。",
        workflowRunId: "01K00000000000000000000005",
      },
    ]);

    expect(markup).toContain("新品海报");
    expect(markup).toMatch(/确认并开始制作|Confirm and start production/u);
    expect(markup).toMatch(/放弃这项制作|Discard this production/u);
    expect(markup).toContain("anticon-thunderbolt");
    expect(markup).not.toContain("/workflow-runs/");
    expect(markup).not.toContain("01K00000000000000000000004");
  });

  it("does not guess that an unowned task belongs to the last answer", () => {
    const markup = renderThread([
      {
        id: "01K00000000000000000000004",
        kind: "workflow",
        lifecycleStatus: "waiting_approval",
        title: "Not on this response branch",
      },
    ]);
    expect(markup).not.toContain("Not on this response branch");
  });

  it("shows permitted result actions next to the image", () => {
    const markup = renderThread(
      [
        {
          id: "01K00000000000000000000004",
          messageId: "01K00000000000000000000002",
          kind: "workflow",
          lifecycleStatus: "succeeded",
          title: "夏日主视觉",
          workflowRevisionId: "01K00000000000000000000005",
          workflowRunId: "01K00000000000000000000006",
          resultArtifacts: [
            {
              resourceId: "01K00000000000000000000007",
              kind: "image",
              state: "available",
            },
          ],
        },
      ],
      undefined,
      {
        canDownloadArtifact: true,
        onContinueTask: async () => {},
        onAddResultToComposer: vi.fn(),
      },
    );

    expect(markup).not.toMatch(/继续到画板|Continue to board/u);
    expect(markup).not.toMatch(/>详情<|>Details</u);
    expect(markup).toMatch(/下载|Download/u);
    expect(markup).not.toMatch(/继续优化|Refine in chat/u);
    expect(markup).not.toMatch(/在画板中编辑|Edit on a board/u);
    expect(markup).toMatch(/更多操作|More actions/u);
    expect(markup).toContain("anticon-more");
    expect(markup).toMatch(/夏日主视觉.*正在载入|Summer visual.*loading/iu);
  });

  it("keeps the composer editable while a run exposes a stop action", () => {
    const markup = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <MainAgentThread
          canManageModels={false}
          canReadWorkflow={false}
          canRunWorkflow={false}
          composerValue="下一条要求"
          isRunning
          messages={[]}
          onComposerChange={vi.fn()}
          onConfirm={vi.fn(() => Promise.resolve())}
          onDecline={vi.fn(() => Promise.resolve())}
          onOpenResource={vi.fn()}
          onOpenTask={vi.fn()}
          onRegenerate={vi.fn(() => Promise.resolve())}
          onResolveInteraction={vi.fn(() => Promise.resolve())}
          onSelectBranch={vi.fn(() => Promise.resolve())}
          onSend={vi.fn(() => Promise.resolve())}
          onStop={vi.fn(() => Promise.resolve())}
          tasks={[]}
          workspaceId="01K00000000000000000000003"
        />
      </QueryClientProvider>,
    );

    expect(markup).toMatch(/停止输出|Stop generating/u);
    expect(markup).not.toMatch(/加入队列|Add to queue/u);
    expect(markup).toMatch(/aria-label="(?:发送|Send)"/u);
    expect(markup).toContain("下一条要求");
    expect(markup).not.toMatch(/<textarea[^>]*disabled/u);
  });

  it("keeps Stop available while an explicit queue transition locks the composer", () => {
    const markup = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <MainAgentThread
          canManageModels={false}
          canReadWorkflow={false}
          canRunWorkflow={false}
          composerValue="不要覆盖"
          isRunning
          messages={[]}
          onComposerChange={vi.fn()}
          onConfirm={vi.fn(() => Promise.resolve())}
          onDecline={vi.fn(() => Promise.resolve())}
          onOpenResource={vi.fn()}
          onOpenTask={vi.fn()}
          onRegenerate={vi.fn(() => Promise.resolve())}
          onResolveInteraction={vi.fn(() => Promise.resolve())}
          onSelectBranch={vi.fn(() => Promise.resolve())}
          onSend={vi.fn(() => Promise.resolve())}
          onStop={vi.fn(() => Promise.resolve())}
          sendDisabled
          tasks={[]}
          workspaceId="01K00000000000000000000003"
        />
      </QueryClientProvider>,
    );

    expect(markup).toMatch(/停止输出|Stop generating/u);
    expect(markup).toMatch(/<textarea[^>]*disabled/u);
  });

  it("shows immutable response branch navigation", () => {
    const markup = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <MainAgentThread
          canManageModels={false}
          canReadWorkflow={false}
          canRunWorkflow={false}
          composerValue=""
          isRunning={false}
          messages={[
            {
              id: "01K00000000000000000000002",
              role: "assistant",
              parts: [
                { type: "text", text: "替代回复" },
                {
                  type: "source",
                  sourceType: "url",
                  id: "source-1",
                  url: "https://example.com/source",
                  title: "可靠来源",
                },
              ],
              relatedContent: [],
              branch: {
                index: 2,
                count: 2,
                previousMessageId: "01K00000000000000000000001",
              },
              createdAt: "2026-08-25T12:00:01.000Z",
            },
          ]}
          onComposerChange={vi.fn()}
          onConfirm={vi.fn(() => Promise.resolve())}
          onDecline={vi.fn(() => Promise.resolve())}
          onOpenResource={vi.fn()}
          onOpenTask={vi.fn()}
          onRegenerate={vi.fn(() => Promise.resolve())}
          onResolveInteraction={vi.fn(() => Promise.resolve())}
          onSelectBranch={vi.fn(() => Promise.resolve())}
          onSend={vi.fn(() => Promise.resolve())}
          onStop={vi.fn(() => Promise.resolve())}
          tasks={[]}
          workspaceId="01K00000000000000000000003"
        />
      </QueryClientProvider>,
    );

    expect(markup).toContain("2 / 2");
    expect(markup).toMatch(/上一条替代回复|Previous response branch/u);
    expect(markup).toContain("可靠来源");
    expect(markup).toContain("https://example.com/source");
  });

  it("hides response branch navigation throughout an active run", () => {
    const markup = renderThread(
      [],
      [
        {
          id: "01K00000000000000000000002",
          role: "assistant",
          parts: [{ type: "text", text: "正在回复" }],
          relatedContent: [],
          branch: {
            index: 2,
            count: 2,
            previousMessageId: "01K00000000000000000000001",
          },
          createdAt: "2026-08-25T12:00:01.000Z",
        },
      ],
      {
        isRunning: true,
        activeRunAssistantMessageId: "01K00000000000000000000002",
      },
    );
    expect(markup).not.toMatch(/上一条替代回复|Previous response branch/u);
  });

  it("shows only Stop when running with an empty composer", () => {
    const markup = renderThread([], [], { isRunning: true });
    expect(markup).toMatch(/停止输出|Stop generating/u);
    expect(markup).not.toMatch(
      /aria-label="(?:发送|Send|加入队列|Add to queue)"/u,
    );
    expect(markup).not.toContain("anticon-stop");
  });

  it("renders Canvas related content as a compact reference without technical fields", () => {
    const markup = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <MainAgentThread
          canManageModels={false}
          canReadWorkflow={false}
          canRunWorkflow={false}
          composerValue=""
          isRunning={false}
          messages={[
            {
              id: "01K00000000000000000000001",
              role: "assistant",
              parts: [{ type: "text", text: "画板已经准备好，可以继续编辑。" }],
              relatedContent: [
                {
                  kind: "canvas",
                  resourceId: "01K00000000000000000000004",
                  title: "秋日新品",
                  state: "unavailable",
                  version: 2,
                },
              ],
              createdAt: "2026-08-25T12:00:01.000Z",
            },
          ]}
          onConfirm={vi.fn(() => Promise.resolve())}
          onComposerChange={vi.fn()}
          onDecline={vi.fn(() => Promise.resolve())}
          onOpenResource={vi.fn()}
          onOpenTask={vi.fn()}
          onRegenerate={vi.fn(() => Promise.resolve())}
          onResolveInteraction={vi.fn(() => Promise.resolve())}
          onSelectBranch={vi.fn(() => Promise.resolve())}
          onSend={vi.fn(() => Promise.resolve())}
          onStop={vi.fn(() => Promise.resolve())}
          tasks={[]}
          workspaceId="01K00000000000000000000003"
        />
      </QueryClientProvider>,
    );

    expect(markup).toContain("秋日新品");
    expect(markup).toMatch(/画板|Board/u);
    expect(markup).toMatch(/相关内容|Related content/u);
    expect(markup).toMatch(/暂不可用|Unavailable/u);
    expect(markup).not.toContain("canvas_command");
    expect(markup).not.toContain("01K00000000000000000000004");
  });

  it("places user image attachments above the text bubble as cover thumbnails", () => {
    const markup = renderThread(
      [],
      [
        {
          id: "01K00000000000000000000001",
          role: "user",
          parts: [{ type: "text", text: "解释图片" }],
          relatedContent: [
            {
              kind: "asset",
              resourceId: "01K00000000000000000000004",
              artifactId: "01K00000000000000000000005",
              title: "户型图",
              state: "available",
            },
            {
              kind: "canvas",
              resourceId: "01K00000000000000000000006",
              title: "参考画板",
              state: "available",
            },
            {
              kind: "brand",
              resourceId: "01K00000000000000000000007",
              title: "Example Studio",
              state: "available",
            },
          ],
          createdAt: "2026-08-25T12:00:00.000Z",
        },
      ],
    );

    const galleryIndex = markup.indexOf("data-user-message-attachments");
    const bubbleIndex = markup.indexOf("<article");
    expect(galleryIndex).toBeGreaterThan(-1);
    expect(galleryIndex).toBeLessThan(bubbleIndex);
    expect(markup).toContain("size-24");
    expect(markup).toContain("sm:size-28");
    expect(markup).toContain("object-cover");
    expect(markup).toContain("cursor-zoom-in");
    expect(markup).toContain("ml-auto w-fit max-w-full");
    expect(markup).toContain("参考画板");
    expect(markup).toContain("Example Studio");
  });

  it("keeps uploaded screenshot saving and saved status in the context menu", () => {
    const message = {
      id: "01K00000000000000000000001",
      role: "user" as const,
      parts: [{ type: "text" as const, text: "看这张截图" }],
      relatedContent: [
        {
          kind: "artifact" as const,
          resourceId: "01K00000000000000000000004",
          artifactId: "01K00000000000000000000004",
          title: "私有截图.png",
          state: "available" as const,
        },
      ],
      createdAt: "2026-08-25T12:00:00.000Z",
    };
    const privateMarkup = renderThread([], [message], {
      canSaveAsset: true,
      csrfToken: "csrf",
    });
    const savedMarkup = renderThread(
      [],
      [
        {
          ...message,
          relatedContent: [
            {
              ...message.relatedContent[0]!,
              assetId: "01K00000000000000000000005",
            },
          ],
        },
      ],
      { canSaveAsset: true, csrfToken: "csrf" },
    );
    expect(privateMarkup).toContain("data-user-message-attachments");
    expect(privateMarkup).not.toMatch(/保存到资产库|Save to assets/u);
    expect(savedMarkup).not.toMatch(/已保存到资产库|Saved to assets/u);
    expect(
      renderThread([], [message], { canSaveAsset: false, csrfToken: "csrf" }),
    ).not.toMatch(/保存到资产库|Save to assets/u);
  });
});

describe("New conversation shortcuts", () => {
  const entryShortcuts = <span>Example starter tasks</span>;
  it("places shortcuts below a single standard composer", () => {
    const html = renderThread([], [], { entryShortcuts });
    expect(html.match(/<textarea/g)).toHaveLength(1);
    expect(html.indexOf("<textarea")).toBeLessThan(
      html.indexOf("Example starter tasks"),
    );
  });
  it("keeps shortcuts out of an ongoing conversation", () => {
    expect(renderThread([], undefined, { entryShortcuts })).not.toContain(
      "Example starter tasks",
    );
  });
});
