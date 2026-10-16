import { mergeAttributes } from "@tiptap/core";
import { Mention } from "@tiptap/extension-mention";
import { Placeholder } from "@tiptap/extension-placeholder";
import {
  EditorContent,
  ReactRenderer,
  type JSONContent,
  useEditor,
} from "@tiptap/react";
import type { SuggestionOptions } from "@tiptap/suggestion";
import StarterKit from "@tiptap/starter-kit";
import type { WorkflowAuthoringBindingV1 } from "@kanvas/contracts/workflow-authoring";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
} from "react";
import { useTranslation } from "react-i18next";

import type { WorkflowAuthoringVariableOptionV1 } from "./workflow-authoring-node-editor-v1.js";

const WorkflowVariableMention = Mention.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      sourceNodeId: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-source-node-id"),
        renderHTML: (attributes: Readonly<Record<string, unknown>>) =>
          attributes.sourceNodeId
            ? { "data-source-node-id": attributes.sourceNodeId }
            : {},
      },
      fieldKey: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-field-key"),
        renderHTML: (attributes: Readonly<Record<string, unknown>>) =>
          attributes.fieldKey ? { "data-field-key": attributes.fieldKey } : {},
      },
    };
  },
  renderHTML({ HTMLAttributes, node }) {
    return [
      "span",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
      String(node.attrs.label ?? node.attrs.id ?? ""),
    ];
  },
});

const mentionNodeNames = new Set(["workflowVariableAt"]);
const WorkflowVariableAt = WorkflowVariableMention.extend({
  name: "workflowVariableAt",
});
const suggestionPopupOffset = 6;
const suggestionPopupZIndex = 1600;

interface WorkflowMentionItem {
  readonly id: string;
  readonly label: string;
  readonly sourceNodeId: string;
  readonly fieldKey: string;
}

interface SuggestionListRef {
  readonly onKeyDown: (input: { readonly event: KeyboardEvent }) => boolean;
}

function WorkflowSuggestionList({
  command,
  items,
  ref,
}: {
  readonly command: (item: WorkflowMentionItem) => void;
  readonly items: readonly WorkflowMentionItem[];
  readonly ref?: Ref<SuggestionListRef>;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const select = useCallback(
    (index: number) => {
      const item = items[index];
      if (item) command(item);
    },
    [command, items],
  );
  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === "ArrowUp") {
        setSelectedIndex((current) =>
          current <= 0 ? items.length - 1 : current - 1,
        );
        return true;
      }
      if (event.key === "ArrowDown") {
        setSelectedIndex((current) =>
          current >= items.length - 1 ? 0 : current + 1,
        );
        return true;
      }
      if (event.key === "Enter") {
        select(selectedIndex);
        return true;
      }
      return false;
    },
  }));
  return (
    <div className="max-h-60 min-w-64 overflow-y-auto rounded-xl bg-paper p-1.5 shadow-[0_12px_36px_rgb(20_24_40_/_18%)]">
      {items.length > 0 ? (
        items.map((item, index) => (
          <button
            className={`grid w-full gap-0.5 rounded-lg border-0 px-3 py-2 text-left ${
              index === selectedIndex ? "bg-primary-soft" : "bg-transparent"
            }`}
            key={item.id}
            onClick={() => select(index)}
            onMouseEnter={() => setSelectedIndex(index)}
            type="button"
          >
            <strong className="text-xs text-ink">{item.label}</strong>
          </button>
        ))
      ) : (
        <span className="block px-3 py-2 text-xs text-muted">No matches</span>
      )}
    </div>
  );
}

export function workflowSuggestionMatch(input: unknown) {
  const value = input as {
    readonly $position: {
      readonly pos: number;
      readonly nodeBefore?: {
        readonly isText?: boolean;
        readonly text?: string;
      };
    };
  };
  const text = value.$position.nodeBefore?.isText
    ? (value.$position.nodeBefore.text ?? "")
    : "";
  const match = text.match(/@([^\s@{}]*)$/u);
  if (!match) return null;
  return {
    range: {
      from: value.$position.pos - match[0].length,
      to: value.$position.pos,
    },
    query: match[1] ?? "",
    text: match[0],
  };
}

function workflowVariableSuggestion(
  getVariables: () => readonly WorkflowAuthoringVariableOptionV1[],
): Omit<SuggestionOptions<WorkflowMentionItem>, "editor"> {
  return {
    char: "@",
    allowSpaces: true,
    findSuggestionMatch: workflowSuggestionMatch,
    items: ({ query }) => {
      const search = query.toLocaleLowerCase();
      return getVariables()
        .filter((item) =>
          `${item.sourceLabel} ${item.label} ${item.sourceNodeId} ${item.fieldKey}`
            .toLocaleLowerCase()
            .includes(search),
        )
        .map((item) => ({
          id: item.id,
          label: `${item.sourceLabel} · ${item.label}`,
          sourceNodeId: item.sourceNodeId,
          fieldKey: item.fieldKey,
        }));
    },
    render: () => {
      let renderer: ReactRenderer<SuggestionListRef> | undefined;
      let popup: HTMLDivElement | undefined;
      const position = (clientRect?: (() => DOMRect | null) | null) => {
        const rect = clientRect?.();
        if (!popup || !rect) return;
        popup.style.left = `${String(rect.left)}px`;
        popup.style.top = `${String(rect.bottom + suggestionPopupOffset)}px`;
      };
      return {
        onStart(props) {
          renderer = new ReactRenderer(WorkflowSuggestionList, {
            props,
            editor: props.editor,
          });
          popup = document.createElement("div");
          popup.dataset.workflowVariableSuggestion = "@";
          popup.style.position = "fixed";
          popup.style.zIndex = String(suggestionPopupZIndex);
          popup.addEventListener("pointerdown", (event) =>
            event.stopPropagation(),
          );
          popup.appendChild(renderer.element);
          document.body.appendChild(popup);
          position(props.clientRect);
        },
        onUpdate(props) {
          renderer?.updateProps(props);
          position(props.clientRect);
        },
        onKeyDown(props) {
          if (props.event.key === "Escape") {
            popup?.remove();
            return true;
          }
          return renderer?.ref?.onKeyDown(props) ?? false;
        },
        onExit() {
          popup?.remove();
          renderer?.destroy();
          popup = undefined;
          renderer = undefined;
        },
      };
    },
  };
}

function pushLiteral(
  segments: Extract<
    WorkflowAuthoringBindingV1,
    { readonly kind: "text" }
  >["segments"][number][],
  text: string,
) {
  if (!text) return;
  const previous = segments.at(-1);
  if (previous?.kind === "literal") {
    segments[segments.length - 1] = {
      kind: "literal",
      text: previous.text + text,
    };
    return;
  }
  segments.push({ kind: "literal", text });
}

function inlineNodes(
  binding: WorkflowAuthoringBindingV1,
  variables: readonly WorkflowAuthoringVariableOptionV1[],
): JSONContent[] {
  let segments: Extract<
    WorkflowAuthoringBindingV1,
    { readonly kind: "text" }
  >["segments"] = [];
  if (binding.kind === "text") segments = binding.segments;
  else if (binding.kind === "variable") {
    segments = [{ kind: "variable", variable: binding.variable }];
  } else if (binding.kind === "literal" && typeof binding.value === "string") {
    segments = [{ kind: "literal", text: binding.value }];
  }
  const nodes: JSONContent[] = [];
  for (const segment of segments) {
    if (segment.kind === "literal") {
      if (segment.text) nodes.push({ type: "text", text: segment.text });
      continue;
    }
    const option = variables.find(
      (item) =>
        JSON.stringify(item.variable) === JSON.stringify(segment.variable),
    );
    if (!option) continue;
    nodes.push({
      type: "workflowVariableAt",
      attrs: {
        id: option.id,
        label: `${option.sourceLabel} · ${option.label}`,
        sourceNodeId: option.sourceNodeId,
        fieldKey: option.fieldKey,
      },
    });
  }
  return nodes;
}

export function workflowBindingToRichPrompt(
  binding: WorkflowAuthoringBindingV1,
  variables: readonly WorkflowAuthoringVariableOptionV1[],
): JSONContent {
  const paragraphs: JSONContent[] = [{ type: "paragraph", content: [] }];
  for (const node of inlineNodes(binding, variables)) {
    if (node.type !== "text" || !node.text?.includes("\n")) {
      paragraphs.at(-1)!.content!.push(node);
      continue;
    }
    const lines = node.text.split("\n");
    lines.forEach((line, index) => {
      if (line) paragraphs.at(-1)!.content!.push({ type: "text", text: line });
      if (index < lines.length - 1) {
        paragraphs.push({ type: "paragraph", content: [] });
      }
    });
  }
  return { type: "doc", content: paragraphs };
}

export function richPromptToWorkflowBinding(
  content: JSONContent,
  variables: readonly WorkflowAuthoringVariableOptionV1[],
): WorkflowAuthoringBindingV1 {
  const segments: Extract<
    WorkflowAuthoringBindingV1,
    { readonly kind: "text" }
  >["segments"][number][] = [];
  const paragraphs = content.content ?? [];
  paragraphs.forEach((paragraph, paragraphIndex) => {
    if (paragraphIndex > 0) pushLiteral(segments, "\n");
    for (const node of paragraph.content ?? []) {
      if (node.type === "text") {
        pushLiteral(segments, node.text ?? "");
        continue;
      }
      if (!node.type || !mentionNodeNames.has(node.type)) continue;
      const id = typeof node.attrs?.id === "string" ? node.attrs.id : "";
      const option = variables.find((item) => item.id === id);
      if (option)
        segments.push({ kind: "variable", variable: option.variable });
    }
  });
  if (segments.length === 0) segments.push({ kind: "literal", text: "" });
  return { kind: "text", segments };
}

export function WorkflowRichPromptV1({
  binding,
  label,
  onChange,
  variables,
}: {
  readonly binding: WorkflowAuthoringBindingV1;
  readonly label: string;
  readonly onChange: (binding: WorkflowAuthoringBindingV1) => void;
  readonly variables: readonly WorkflowAuthoringVariableOptionV1[];
}) {
  const { t } = useTranslation();
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  const initialContent = useMemo(
    () => workflowBindingToRichPrompt(binding, variables),
    [binding, variables],
  );
  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: false,
        bold: false,
        italic: false,
        strike: false,
        code: false,
        codeBlock: false,
        blockquote: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        horizontalRule: false,
      }),
      Placeholder.configure({
        placeholder: t("workflows.editor.textTemplatePlaceholder"),
      }),
      WorkflowVariableAt.configure({
        HTMLAttributes: {
          class:
            "inline-flex items-center rounded bg-primary-soft px-1.5 py-0.5 text-primary font-semibold",
        },
        suggestion: workflowVariableSuggestion(() => variables),
      }),
    ],
    [t, variables],
  );
  const editor = useEditor({
    extensions,
    content: initialContent,
    immediatelyRender: false,
    onUpdate: ({ editor: current }) => {
      onChangeRef.current(
        richPromptToWorkflowBinding(current.getJSON(), variables),
      );
    },
  });

  return (
    <section className="grid gap-2" aria-label={label}>
      <strong className="text-xs text-ink">{label}</strong>
      <div className="overflow-hidden rounded-xl bg-mist focus-within:shadow-[0_0_0_2px_rgb(48_72_245_/_12%)]">
        <EditorContent
          className="min-h-28 px-3 py-2 text-sm text-ink [&_.tiptap]:min-h-24 [&_.tiptap]:outline-none [&_.tiptap_p]:m-0 [&_.tiptap_p.is-editor-empty:first-child::before]:pointer-events-none [&_.tiptap_p.is-editor-empty:first-child::before]:float-left [&_.tiptap_p.is-editor-empty:first-child::before]:h-0 [&_.tiptap_p.is-editor-empty:first-child::before]:text-muted [&_.tiptap_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]"
          editor={editor}
        />
        <span className="block px-3 pb-2 text-[11px] text-muted">
          {t("workflows.editor.richPromptTriggerHint")}
        </span>
      </div>
    </section>
  );
}
