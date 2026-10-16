import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import "../../i18n/i18n.js";
import {
  AgentPendingMessageQueue,
  agentQueueResumeIsBlocked,
  visibleAgentPendingMessages,
  type AgentPendingMessageView,
} from "./agent-pending-message-queue.js";

const messages: readonly AgentPendingMessageView[] = [
  {
    id: "queued-1",
    text: "第一条",
    status: "queued",
    attachmentCount: 1,
    referenceCount: 0,
    editable: true,
  },
  {
    id: "queued-2",
    text: "第二条",
    status: "queued",
    attachmentCount: 0,
    referenceCount: 1,
    editable: true,
  },
  {
    id: "queued-3",
    text: "第三条",
    status: "sending",
    attachmentCount: 0,
    referenceCount: 0,
    editable: false,
  },
  {
    id: "queued-4",
    text: "第四条",
    status: "uncertain",
    attachmentCount: 0,
    referenceCount: 0,
    editable: false,
  },
];

describe("AgentPendingMessageQueue", () => {
  it("keeps the ordered queue finite until the user expands it", () => {
    expect(visibleAgentPendingMessages(messages, false)).toEqual(
      messages.slice(0, 3),
    );
    expect(visibleAgentPendingMessages(messages, true)).toEqual(messages);

    const markup = renderToStaticMarkup(
      <AgentPendingMessageQueue
        expanded={false}
        messages={messages}
        onEditMessage={vi.fn()}
        onPause={vi.fn()}
        onRemoveMessage={vi.fn()}
        onResume={vi.fn()}
        onToggleExpanded={vi.fn()}
        paused={false}
      />,
    );
    expect(markup).toContain("第一条");
    expect(markup).toContain("第三条");
    expect(markup).not.toContain("第四条");
    expect(markup).toMatch(/再显示 1 条|Show 1 more/u);
    expect(markup).not.toContain("<textarea");
    expect(markup).toContain("h-8");
  });

  it("requires the live confirmation or question before resuming", () => {
    expect(agentQueueResumeIsBlocked("waiting_approval")).toBe(true);
    expect(agentQueueResumeIsBlocked("waiting_for_user")).toBe(true);
    expect(agentQueueResumeIsBlocked("failed")).toBe(false);
    expect(agentQueueResumeIsBlocked("manual")).toBe(false);

    const markup = renderToStaticMarkup(
      <AgentPendingMessageQueue
        expanded={false}
        messages={messages.slice(0, 1)}
        onResume={vi.fn()}
        pauseReason="waiting_approval"
        paused
      />,
    );
    expect(markup).toMatch(
      /请先完成当前确认|Complete the current confirmation/u,
    );
    expect(markup).toMatch(/<button[^>]*disabled/u);
  });

  it("makes queued text keyboard actionable without enabling a sending item", () => {
    const markup = renderToStaticMarkup(
      <AgentPendingMessageQueue
        expanded
        messages={messages}
        onEditMessage={vi.fn()}
        onPause={vi.fn()}
        onRemoveMessage={vi.fn()}
        paused={false}
      />,
    );
    expect(markup).toMatch(
      /<button[^>]*aria-label="(?:编辑待发送消息|Edit queued message): 第一条"[^>]*title="第一条"/u,
    );
    const sendingRow = markup.match(
      /<li[^>]*data-status="sending"[\s\S]*?<\/li>/u,
    )?.[0];
    expect(sendingRow).toMatch(/<button[^>]*disabled/u);
  });
});
