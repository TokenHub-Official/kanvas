import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { inspectHtmlTool } from "../src/tools/html-tool-inspection.js";

function inspect(html: string) {
  return inspectHtmlTool({
    bytes: Buffer.from(html),
    filename: "tool.html",
    digest: `sha256:${"a".repeat(64)}`,
    now: new Date("2026-09-23T10:00:00Z"),
  });
}
describe("uploaded HTML inspection", () => {
  it("reports the source line of a script error rather than its opening tag", () => {
    const report = inspect(
      "<!doctype html>\n<html>\n<head><title>Check</title></head>\n<body>\n<h1>Check</h1>\n<script>\nconst invalid = ;\n</script>\n</body>\n</html>",
    );
    expect(
      report.issues.find((issue) => issue.code === "javascript_syntax")?.line,
    ).toBe(7);
  });
  it("checks the actual calculator and communication examples without a built-in exemption", () => {
    for (const name of ["calculator", "capability"]) {
      const html = readFileSync(
        new URL(
          `../../web/src/features/external-tools/examples/${name}.html`,
          import.meta.url,
        ),
        "utf8",
      );
      expect(inspect(html)).toMatchObject({ passed: true, issues: [] });
    }
  });
  it("parses scripts without evaluating malicious or infinite code", () => {
    expect(
      inspect(
        "<body><script>while (true) {} ; globalThis.shouldNeverExecute = true;</script></body>",
      ).passed,
    ).toBe(true);
    expect("shouldNeverExecute" in globalThis).toBe(false);
  });
  it("reports blocked dependencies, embedded documents, redirection and form submission", () => {
    const report = inspect(
      '<html><head><script src="https://example.com/a.js"></script><link rel="stylesheet" href="a.css"><meta http-equiv="refresh" content="0;url=https://example.com"></head><body><iframe src="https://example.com"></iframe><form><button>Go</button></form></body></html>',
    );
    expect(report.passed).toBe(false);
    expect(report.issues.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "external_script",
        "external_link_resource",
        "automatic_navigation",
        "embedded_document",
        "sandboxed_form_submit",
      ]),
    );
  });
  it("does not let a full warning report hide a later blocking error", () => {
    const report = inspect(
      "<iframe></iframe>" +
        '<a href="https://example.com">Link</a>'.repeat(110),
    );
    expect(report.passed).toBe(false);
    expect(report.issues).toHaveLength(100);
    expect(
      report.issues.some((issue) => issue.code === "embedded_document"),
    ).toBe(true);
  });
  it("rejects invalid UTF-8 and oversized input", () => {
    const common = {
      filename: "tool.html",
      digest: `sha256:${"a".repeat(64)}`,
      now: new Date(),
    };
    expect(
      inspectHtmlTool({ ...common, bytes: Uint8Array.of(0xc3, 0x28) }).issues[0]
        ?.code,
    ).toBe("html_encoding");
    expect(
      inspectHtmlTool({ ...common, bytes: new Uint8Array(2 * 1024 * 1024 + 1) })
        .issues[0]?.code,
    ).toBe("html_size");
  });
  it("finds script syntax and unsupported module dependencies", () => {
    expect(inspect("<script>const = ;</script>").issues[0]?.code).toBe(
      "javascript_syntax",
    );
    expect(
      inspect(
        '<script type="module">import x from "https://example.com/x.js";</script>',
      ).issues[0]?.code,
    ).toBe("module_dependency");
    expect(inspect('<script>eval("1");</script>').issues[0]?.code).toBe(
      "dynamic_code",
    );
  });
});
