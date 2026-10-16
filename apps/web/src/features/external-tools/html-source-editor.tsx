import { Input } from "antd";
import { useEffect, useMemo, useRef, useState, type ComponentRef } from "react";

const lineHeight = 22;
const padding = 16;
const visibleLineCount = 100;

export function sourceLineRange(
  source: string,
  line: number,
): [number, number] {
  const lines = source.split("\n");
  const selected = Math.max(0, Math.min(lines.length - 1, line - 1));
  let start = 0;
  for (let index = 0; index < selected; index++)
    start += lines[index]!.length + 1;
  return [start, start + lines[selected]!.length];
}

/** Native text editing with a bounded line-number gutter; no editor engine. */
export function HtmlSourceEditor({
  value,
  onChange,
  disabled,
  label,
  focusRequest,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  label: string;
  focusRequest?: { line: number };
}): React.JSX.Element {
  const textareaRef = useRef<ComponentRef<typeof Input.TextArea>>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const lineCount = useMemo(() => value.split("\n").length, [value]);
  const firstLine = Math.max(0, Math.floor((scrollTop - padding) / lineHeight));
  const gutter = Array.from(
    { length: Math.min(visibleLineCount, lineCount - firstLine) },
    (_, index) => firstLine + index + 1,
  ).join("\n");
  useEffect(() => {
    if (!focusRequest || !textareaRef.current) return;
    const element = textareaRef.current.resizableTextArea?.textArea;
    if (!element) return;
    const range = sourceLineRange(element.value, focusRequest.line);
    element.focus();
    element.setSelectionRange(...range);
    element.scrollTop = Math.max(
      0,
      (focusRequest.line - 1) * lineHeight - padding,
    );
  }, [focusRequest]);
  return (
    <div className="flex h-full min-w-0 overflow-hidden rounded-control bg-paper focus-within:ring-2 focus-within:ring-primary/30">
      <div
        aria-hidden="true"
        className="relative w-12 shrink-0 overflow-hidden bg-mist/30 text-right font-mono text-xs text-muted"
      >
        <pre
          className="absolute inset-x-0 m-0 pr-3"
          style={{
            lineHeight: `${lineHeight}px`,
            top: padding + firstLine * lineHeight - scrollTop,
          }}
        >
          {gutter}
        </pre>
      </div>
      <Input.TextArea
        ref={textareaRef}
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        spellCheck={false}
        wrap="soft"
        variant="borderless"
        className="min-w-0 flex-1"
        styles={{
          root: { height: "100%" },
          textarea: {
            height: "100%",
            resize: "none",
            padding: 16,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 14,
            background: "var(--paper)",

            lineHeight: `${lineHeight}px`,
            tabSize: 2,
            whiteSpace: "pre",
            overflowWrap: "normal",
          },
        }}
      />
    </div>
  );
}
