import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

// Executes the delivered standalone script, without claiming browser/iframe proof.
function calculator() {
  const html = readFileSync(
    new URL("./examples/calculator.html", import.meta.url),
    "utf8",
  );
  let click: ((event: { preventDefault: () => void }) => void) | undefined;
  const elements = {
    first: { valueAsNumber: 12 },
    second: { valueAsNumber: 3 },
    operation: { value: "add" },
    result: { textContent: "" },
    error: { textContent: "" },
    calculator: {
      addEventListener: () => undefined,
      reportValidity: () => true,
    },
    calculate: {
      addEventListener: (_name: string, handler: typeof click) => {
        if (_name === "click") click = handler;
      },
    },
  };
  runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "", {
    document: {
      documentElement: { lang: "zh-CN" },
      getElementById: (id: keyof typeof elements) => elements[id],
    },
  });
  return {
    elements,
    calculate: () => click?.({ preventDefault: () => undefined }),
  };
}

describe("standalone calculator", () => {
  it("supports arithmetic and common decimal inputs without a host", () => {
    const { elements, calculate } = calculator();
    for (const [operation, expected] of [
      ["add", "15"],
      ["subtract", "9"],
      ["multiply", "36"],
      ["divide", "4"],
    ]) {
      elements.operation.value = operation!;
      calculate();
      expect(elements.result.textContent).toBe(expected);
    }
    elements.first.valueAsNumber = 0.1;
    elements.second.valueAsNumber = 0.2;
    elements.operation.value = "add";
    calculate();
    expect(elements.result.textContent).toBe("0.3");
  });
  it("clears stale results on division by zero and recovers with corrected inputs", () => {
    const { elements, calculate } = calculator();
    calculate();
    elements.operation.value = "divide";
    elements.second.valueAsNumber = 0;
    calculate();
    expect(elements.result.textContent).toBe("—");
    expect(elements.error.textContent).not.toBe("");
    elements.second.valueAsNumber = 4;
    calculate();
    expect(elements.result.textContent).toBe("3");
    expect(elements.error.textContent).toBe("");
  });
});
