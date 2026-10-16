import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import { renderToStaticMarkup } from "react-dom/server";
import { Streamdown } from "streamdown";
import { describe, expect, it, vi } from "vitest";

interface RuntimeMessage {
  readonly createdAt: string;
  readonly id: string;
  readonly resourceTitle?: string;
  readonly role: "assistant" | "user";
  readonly text: string;
}

function toThreadMessage(message: RuntimeMessage): ThreadMessageLike {
  return {
    id: message.id,
    role: message.role,
    createdAt: new Date(message.createdAt),
    content: [
      { type: "text", text: message.text },
      ...(message.resourceTitle
        ? [
            {
              type: "data-resource" as const,
              data: { title: message.resourceTitle },
            },
          ]
        : []),
    ],
  };
}

function RuntimeThread({
  messages,
  onNew,
}: {
  readonly messages: readonly RuntimeMessage[];
  readonly onNew: () => Promise<void>;
}): React.JSX.Element {
  const runtime = useExternalStoreRuntime({
    messages,
    convertMessage: toThreadMessage,
    isRunning: false,
    onNew,
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root>
        <ThreadPrimitive.Viewport>
          <ThreadPrimitive.Messages>
            {({ message }) => (
              <article data-role={message.role}>
                {message.content.map((part) => {
                  if (part.type === "text") {
                    return <span key="text">{part.text}</span>;
                  }
                  if (part.type === "data" && part.name === "resource") {
                    const data = part.data as { readonly title: string };
                    return (
                      <strong key={`resource:${data.title}`}>
                        {data.title}
                      </strong>
                    );
                  }
                  return null;
                })}
              </article>
            )}
          </ThreadPrimitive.Messages>
        </ThreadPrimitive.Viewport>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

describe("Agent UI runtime boundary", () => {
  it("renders Kanvas-owned messages and structured resource parts without taking persistence ownership", () => {
    const onNew = vi.fn(() => Promise.resolve());
    const markup = renderToStaticMarkup(
      <RuntimeThread
        messages={[
          {
            id: "message-1",
            role: "user",
            text: "制作一张新品海报",
            createdAt: "2026-08-25T12:00:00.000Z",
          },
          {
            id: "message-2",
            role: "assistant",
            text: "已经准备好一份可确认的制作方案。",
            resourceTitle: "新品海报画板",
            createdAt: "2026-08-25T12:00:01.000Z",
          },
        ]}
        onNew={onNew}
      />,
    );

    expect(markup).toContain("制作一张新品海报");
    expect(markup).toContain("已经准备好一份可确认的制作方案。");
    expect(markup).toContain("新品海报画板");
    expect(onNew).not.toHaveBeenCalled();
  });

  it("renders incomplete streaming Markdown without exposing raw formatting markers", () => {
    const markup = renderToStaticMarkup(
      <Streamdown isAnimating={true}>{"**正在整理你的要求"}</Streamdown>,
    );

    expect(markup).toContain("正在整理你的要求");
    expect(markup).not.toContain("**正在整理你的要求");
  });
});
