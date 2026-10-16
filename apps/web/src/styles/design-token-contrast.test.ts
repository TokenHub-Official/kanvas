import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { kanvasTheme } from "../theme/kanvas-theme.js";

const tokens = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");
const baseStyles = readFileSync(new URL("./base.css", import.meta.url), "utf8");
const documentMarkup = readFileSync(
  new URL("../../index.html", import.meta.url),
  "utf8",
);

function token(name: string): string {
  const match = new RegExp(
    `--${name}:\\s*(#[\\da-f]{3}(?:[\\da-f]{3})?)`,
    "iu",
  ).exec(tokens);
  if (!match?.[1]) {
    throw new Error(`Missing color token: ${name}`);
  }
  return match[1].length === 4
    ? `#${[...match[1].slice(1)].map((digit) => `${digit}${digit}`).join("")}`
    : match[1];
}

function relativeLuminance(color: string): number {
  const value = Number.parseInt(color.slice(1), 16);
  const channels = [value >> 16, (value >> 8) & 255, value & 255].map(
    (channel) => {
      const normalized = channel / 255;
      return normalized <= 0.04045
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4;
    },
  );
  return (
    0.2126 * (channels[0] ?? 0) +
    0.7152 * (channels[1] ?? 0) +
    0.0722 * (channels[2] ?? 0)
  );
}

function channels(color: string): readonly number[] {
  const value = Number.parseInt(color.slice(1), 16);
  return [value >> 16, (value >> 8) & 255, value & 255];
}

function contrast(foreground: string, background: string): number {
  const values = [
    relativeLuminance(foreground),
    relativeLuminance(background),
  ].sort((left, right) => right - left);
  return ((values[0] ?? 0) + 0.05) / ((values[1] ?? 0) + 0.05);
}

function antColor(name: string): string {
  const value = (
    kanvasTheme.token as Readonly<Record<string, unknown>> | undefined
  )?.[name];
  if (typeof value !== "string") {
    throw new Error(`Missing Ant Design color token: ${name}`);
  }
  const reference = /^var\(--([a-z0-9-]+)\)$/u.exec(value)?.[1];
  return reference ? token(reference) : value;
}

describe("design token contrast", () => {
  it.each(["paper-hover", "mist", "mist-deep", "line", "line-strong"])(
    "%s is a hue-free neutral gray",
    (name) => {
      expect(new Set(channels(token(name))).size).toBe(1);
    },
  );

  it.each([
    ["muted", "paper"],
    ["muted", "mist"],
    ["placeholder", "paper"],
    ["placeholder", "mist"],
    ["primary", "paper"],
    ["on-primary", "primary"],
    ["on-primary-muted", "primary"],
    ["positive", "positive-surface"],
    ["warning", "warning-surface"],
    ["danger", "danger-surface"],
    ["info", "info-surface"],
  ])("%s on %s meets WCAG AA for normal text", (foreground, background) => {
    expect(
      contrast(token(foreground), token(background)),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ["colorSuccessText", "colorSuccessBg", "positive", "positive-surface"],
    ["colorWarningText", "colorWarningBg", "warning", "warning-surface"],
    ["colorErrorText", "colorErrorBg", "danger", "danger-surface"],
    ["colorInfoText", "colorInfoBg", "info", "info-surface"],
  ])(
    "%s on %s maps to product tokens and meets WCAG AA",
    (foreground, background, expectedForeground, expectedBackground) => {
      expect(antColor(foreground)).toBe(token(expectedForeground));
      expect(antColor(background)).toBe(token(expectedBackground));
      expect(
        contrast(antColor(foreground), antColor(background)),
      ).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("declares the committed light browser theme in HTML and CSS", () => {
    expect(documentMarkup).toContain(
      '<meta name="color-scheme" content="light"',
    );
    expect(baseStyles).toMatch(/color-scheme:\s*light;/u);
  });

  it("retains the global error border token for invalid controls", () => {
    expect(
      (kanvasTheme.token as Readonly<Record<string, unknown>> | undefined)
        ?.colorErrorBorder,
    ).toBe("var(--danger-border)");
  });

  it("removes Alert chrome without changing global control borders", () => {
    expect(kanvasTheme.components?.Alert?.lineWidth).toBe(0);
    expect(
      (kanvasTheme.token as Readonly<Record<string, unknown>> | undefined)
        ?.colorErrorBorder,
    ).toBe("var(--danger-border)");
  });
});
