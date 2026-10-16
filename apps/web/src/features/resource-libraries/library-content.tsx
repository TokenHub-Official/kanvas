import type { ReactNode } from "react";
import { Streamdown } from "streamdown";

// Library documents are reference data. Remote media, links and raw HTML stay inert.
const allowedElements = [
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "strong",
  "em",
  "del",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "code",
  "hr",
  "br",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
];
const markdownComponents = {
  p: ({ children }: { children?: ReactNode }) => (
    <p className="whitespace-pre-wrap">{children}</p>
  ),
};
export function LibraryTextContent({
  text,
  markdown,
}: {
  readonly text: string;
  readonly markdown: boolean;
}) {
  return markdown ? (
    <Streamdown
      mode="static"
      components={markdownComponents}
      className="agent-markdown max-w-prose"
      skipHtml
      allowedElements={allowedElements}
      unwrapDisallowed
      rehypePlugins={[]}
      controls={false}
    >
      {text}
    </Streamdown>
  ) : (
    <pre className="m-0 whitespace-pre-wrap break-words font-sans text-sm leading-7 text-ink">
      {text}
    </pre>
  );
}
