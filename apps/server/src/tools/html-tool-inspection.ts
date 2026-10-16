import { parse as parseJavaScript } from "acorn";
import { parse as parseHtml, type DefaultTreeAdapterMap } from "parse5";
import {
  htmlToolMaximumBytes,
  htmlToolPolicyVersion,
  type ToolCheckIssue,
  type ToolCheckReport,
} from "@kanvas/contracts/api";

type HtmlNode = DefaultTreeAdapterMap["node"];
const maximumIssues = 100;
const blockedTags = new Set([
  "base",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
]);
const scriptTypes = new Set([
  "",
  "text/javascript",
  "application/javascript",
  "module",
]);

function javascriptIssues(source: string, module: boolean): readonly string[] {
  const ast = parseJavaScript(source, {
    ecmaVersion: "latest",
    sourceType: module ? "module" : "script",
  });
  const issues = new Set<string>();
  const stack: unknown[] = [ast];
  while (stack.length) {
    const value = stack.pop();
    if (!value || typeof value !== "object") continue;
    if (Array.isArray(value)) {
      for (const child of value) stack.push(child);
      continue;
    }
    const node = value as Record<string, unknown>;
    if (
      node.type === "ImportDeclaration" ||
      node.type === "ImportExpression" ||
      ((node.type === "ExportNamedDeclaration" ||
        node.type === "ExportAllDeclaration") &&
        node.source)
    ) {
      issues.add("module_dependency");
    }
    if (node.type === "CallExpression" || node.type === "NewExpression") {
      const callee = node.callee as Record<string, unknown> | undefined;
      if (
        callee?.type === "Identifier" &&
        (callee.name === "eval" || callee.name === "Function")
      )
        issues.add("dynamic_code");
    }
    stack.push(...Object.values(node));
  }
  return [...issues];
}

/** Syntax/compatibility inspection only. The platform runtime enforces authority and CSP. */
export function inspectHtmlTool(options: {
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly digest: string;
  readonly now: Date;
}): ToolCheckReport {
  const issues: ToolCheckIssue[] = [];
  let hasErrors = false;
  const add = (
    code: string,
    message: string,
    line?: number,
    severity: "error" | "warning" = "error",
  ): void => {
    if (severity === "error") hasErrors = true;
    if (issues.length >= maximumIssues) {
      if (
        severity === "error" &&
        issues.every((issue) => issue.severity === "warning")
      ) {
        issues[maximumIssues - 1] = {
          code,
          severity,
          message,
          ...(line ? { line } : {}),
        };
      }
      return;
    }
    issues.push({ code, severity, message, ...(line ? { line } : {}) });
  };
  const report = (): ToolCheckReport => ({
    policyVersion: htmlToolPolicyVersion,
    checkedDigest: options.digest,
    passed: !hasErrors,
    issues,
    checkedAt: options.now.toISOString(),
  });
  if (!/\.html?$/i.test(options.filename))
    add("html_filename", "Upload an .html or .htm document.");
  if (
    !options.bytes.byteLength ||
    options.bytes.byteLength > htmlToolMaximumBytes
  ) {
    add("html_size", "The HTML document must be between 1 byte and 2 MiB.");
    return report();
  }
  let html: string;
  try {
    html = new TextDecoder("utf-8", { fatal: true }).decode(options.bytes);
  } catch {
    add("html_encoding", "Save the document using UTF-8 encoding.");
    return report();
  }
  if (html.includes("\0")) {
    add("html_binary", "The document contains binary null bytes.");
    return report();
  }
  const document = parseHtml(html, { sourceCodeLocationInfo: true });
  const nodes: HtmlNode[] = [...document.childNodes];
  let originalElements = 0;
  while (nodes.length) {
    const node = nodes.pop()!;
    if ("childNodes" in node)
      for (const child of node.childNodes) nodes.push(child);
    if ("content" in node) nodes.push(node.content);
    if (!("tagName" in node)) continue;
    const tag = node.tagName;
    const line = node.sourceCodeLocation?.startLine;
    if (line) originalElements += 1;
    const attribute = (name: string): string =>
      node.attrs.find((item) => item.name === name)?.value.trim() ?? "";
    if (blockedTags.has(tag))
      add(
        "embedded_document",
        `The self-contained profile does not support <${tag}>.`,
        line,
      );
    if (tag === "meta" && attribute("http-equiv").toLowerCase() === "refresh")
      add(
        "automatic_navigation",
        "Remove automatic page refresh or redirection.",
        line,
      );
    if (tag === "script") {
      if (attribute("src"))
        add(
          "external_script",
          "Inline script dependencies instead of loading a script URL.",
          line,
        );
      const type = attribute("type").toLowerCase();
      if (scriptTypes.has(type)) {
        const source = node.childNodes
          .map((child) => ("value" in child ? child.value : ""))
          .join("");
        try {
          for (const issue of javascriptIssues(source, type === "module")) {
            add(
              issue,
              issue === "module_dependency"
                ? "Bundle module dependencies into this HTML document."
                : "Dynamic code generation is blocked by the runtime policy.",
              line,
            );
          }
        } catch (error) {
          const relativeLine = (error as { loc?: { line?: number } })?.loc
            ?.line;
          const sourceStartLine =
            node.sourceCodeLocation?.startTag?.endLine ?? line;
          const errorLine =
            sourceStartLine &&
            typeof relativeLine === "number" &&
            relativeLine > 0
              ? sourceStartLine + relativeLine - 1
              : line;
          add(
            "javascript_syntax",
            "The inline script contains a JavaScript syntax error.",
            errorLine,
          );
        }
      } else if (
        type !== "application/json" &&
        type !== "application/ld+json"
      ) {
        add(
          "script_type",
          "This script type is not supported by the self-contained profile.",
          line,
        );
      }
    }
    if (tag === "link" && attribute("href"))
      add(
        "external_link_resource",
        "Inline styles and other linked resources in the HTML document.",
        line,
      );
    for (const item of node.attrs) {
      if (
        item.name === "src" &&
        tag !== "script" &&
        !/^data:image\/(?:png|jpeg|webp|gif|svg\+xml);/i.test(item.value)
      )
        add(
          "external_media",
          "Embed image bytes as a data URL; external media requests are blocked.",
          line,
        );
      if (item.name === "srcset")
        add(
          "image_source_set",
          "Use a single embedded image source in this profile.",
          line,
        );
      if (
        item.name === "href" &&
        tag === "a" &&
        item.value &&
        !item.value.startsWith("#")
      )
        add(
          "external_navigation",
          "External navigation is blocked inside the tool. Use in-document links.",
          line,
          "warning",
        );
      if (item.name.startsWith("on")) {
        try {
          javascriptIssues(
            `function handler(event) {\n${item.value}\n}`,
            false,
          );
        } catch {
          add(
            "event_handler_syntax",
            "An inline event handler contains a JavaScript syntax error.",
            line,
          );
        }
      }
    }
    if (tag === "form") {
      const descendants: HtmlNode[] = [...node.childNodes];
      let submits = false;
      while (descendants.length) {
        const child = descendants.pop()!;
        if ("childNodes" in child)
          for (const descendant of child.childNodes)
            descendants.push(descendant);
        if ("tagName" in child) {
          const type = child.attrs
            .find((item) => item.name === "type")
            ?.value.toLowerCase();
          if (
            (child.tagName === "button" && (!type || type === "submit")) ||
            (child.tagName === "input" && type === "submit")
          )
            submits = true;
        }
      }
      if (submits)
        add(
          "sandboxed_form_submit",
          "Sandboxed forms cannot submit. Use type=button and an explicit click handler.",
          line,
        );
    }
  }
  if (!originalElements)
    add("html_document", "The upload does not contain HTML elements.");
  return report();
}
