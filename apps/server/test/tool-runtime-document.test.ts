import { runInNewContext } from "node:vm";
import { parse } from "parse5";
import { parse as parseJavaScript } from "acorn";
import { describe, expect, it } from "vitest";
import {
  createToolHostDocument,
  createToolContentDocument,
  toolRuntimePath,
} from "../src/tools/tool-runtime-document.js";
const sessionId = "01K00000000000000000000001";
const workspaceId = "01K00000000000000000000002";
describe("forced tool document policy", () => {
  it("keeps uploaded code under an HTTP sandbox without same-origin authority", () => {
    const author = Buffer.from(
      '<meta http-equiv="Content-Security-Policy" content="default-src *"><script>window.example=1</script>',
    );
    const result = createToolContentDocument(author, [
      "https://kanvas.example",
    ]);
    expect(result.body).toBe(author.toString());
    expect(result.headers["Content-Security-Policy"]).toContain(
      "sandbox allow-scripts;",
    );
    expect(result.headers["Content-Security-Policy"]).not.toContain(
      "allow-same-origin",
    );
    for (const directive of [
      "connect-src 'none'",
      "frame-src 'none'",
      "form-action 'none'",
      "base-uri 'none'",
      "object-src 'none'",
    ])
      expect(result.headers["Content-Security-Policy"]).toContain(directive);
    expect(result.headers["Cache-Control"]).toBe("no-store");
  });
  it("uses nonce-only trusted loader code and restricts child navigation to its document", () => {
    const result = createToolHostDocument({
      sessionId,
      workspaceId,
      parentOrigins: ["https://kanvas.example"],
    });
    expect(result.headers["Content-Security-Policy"]).toContain(
      `frame-src https://kanvas.example${toolRuntimePath(sessionId, workspaceId)}/document;`,
    );
    expect(result.headers["Content-Security-Policy"]).not.toContain(
      "'unsafe-inline'",
    );
    const doc = parse(result.body);
    const html = doc.childNodes.find(
      (node) => "tagName" in node && node.tagName === "html",
    );
    if (!html || !("childNodes" in html)) throw new Error("Missing host HTML");
    const body = html.childNodes.find(
      (node) => "tagName" in node && node.tagName === "body",
    );
    if (!body || !("childNodes" in body)) throw new Error("Missing host body");
    const scripts = body.childNodes.filter(
      (node) => "tagName" in node && node.tagName === "script",
    );
    expect(scripts).toHaveLength(2);
    const script = scripts[1]!;
    if (!("attrs" in script) || !("childNodes" in script))
      throw new Error("Missing loader script");
    const nonce = script.attrs.find((attr) => attr.name === "nonce")?.value;
    expect(result.headers["Content-Security-Policy"]).toContain(
      `'nonce-${nonce}'`,
    );
    const source = script.childNodes
      .map((node) => ("value" in node ? node.value : ""))
      .join("");
    expect(() =>
      parseJavaScript(source, { ecmaVersion: "latest" }),
    ).not.toThrow();
    expect(
      createToolHostDocument({
        sessionId,
        workspaceId,
        parentOrigins: ["https://kanvas.example"],
      }).body,
    ).not.toBe(result.body);
  });
  it("adds bounded diagnostics only in preview without changing document mode", () => {
    const source =
      '<!doctype html><!-- <head> is a comment --><html><head><title>Tool</title></head><body><script>throw new Error("author failure")</script></body></html>';
    const preview = createToolContentDocument(
      Buffer.from(source),
      ["https://kanvas.example"],
      true,
    );
    expect(parse(preview.body).mode).toBe("no-quirks");
    expect(preview.body.indexOf("kanvas.tool.diagnostic")).toBeLessThan(
      preview.body.indexOf("throw new Error"),
    );
    expect(
      createToolContentDocument(Buffer.from(source), ["https://kanvas.example"])
        .body,
    ).toBe(source);
    const script = preview.body.match(/<script>(.*?)<\/script>/s)![1]!;
    const listeners: Record<
      string,
      (event: { message: string; lineno: number }) => void
    > = {};
    const received: unknown[] = [];
    runInNewContext(script, {
      addEventListener: (
        name: string,
        callback: (event: { message: string; lineno: number }) => void,
      ) => {
        listeners[name] = callback;
      },
      parent: { postMessage: (message: unknown) => received.push(message) },
    });
    for (let index = 0; index < 30; index++)
      listeners.error!({ message: "x".repeat(900), lineno: 4 });
    expect(received).toHaveLength(20);
    expect(received[0]).toEqual({
      type: "kanvas.tool.diagnostic",
      version: 1,
      message: "x".repeat(600),
      line: 4,
    });
    expect(preview.headers["Content-Security-Policy"]).toContain(
      "sandbox allow-scripts;",
    );
    expect(preview.headers["Content-Security-Policy"]).not.toContain(
      "allow-same-origin",
    );
  });

  it("rejects unsafe document identities and non-origin parent configuration", () => {
    expect(() => toolRuntimePath("../escape")).toThrow();
    for (const origin of [
      "*",
      "https://kanvas.example/path",
      "https://user:pass@kanvas.example",
      "data:text/html,x",
    ]) {
      expect(() =>
        createToolHostDocument({ sessionId, parentOrigins: [origin] }),
      ).toThrow();
    }
  });
});
