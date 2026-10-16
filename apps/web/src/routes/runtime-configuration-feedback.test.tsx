import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
  RuntimeConfigurationOverview,
  RuntimeConfigurationWorker,
} from "@kanvas/contracts/api";
import { configurationFeedback } from "./runtime-configuration-feedback.js";
import { RuntimeConfigurationStatus } from "./runtime-configuration-status.js";
import { initialRuntimeConfiguration } from "./runtime-configuration-model.js";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
const now = Date.parse("2026-10-10T12:00:00Z");
const worker: RuntimeConfigurationWorker = {
  workerId: "process",
  deployment: {
    source: "instance",
    downloadsEnabled: true,
    allowedOrigins: [],
    serviceVersion: "0.1.0-development",
  },
  configurationVersion: 4,
  observedAt: new Date(now).toISOString(),
};
function overview(
  workers: RuntimeConfigurationWorker[],
): RuntimeConfigurationOverview {
  return {
    current: {
      version: 4,
      document: { ...initialRuntimeConfiguration, activated: true },
      reason: "test",
      publishedBy: "test",
      publishedAt: new Date(now).toISOString(),
      restoredFromVersion: null,
    },
    workers,
    services: [],
    servicesTruncated: false,
  };
}
describe("configuration feedback semantics", () => {
  it("does not interpret old process reports as failure or a server inventory", () => {
    const state = overview(
      Array.from({ length: 17 }, (_, i) => ({
        ...worker,
        workerId: `old-${i}`,
        observedAt: new Date(now - 120_000 - i).toISOString(),
      })),
    );
    expect(configurationFeedback(state, now)).toMatchObject({
      state: "unknown",
      count: 0,
      groups: [],
    });
    const html = renderToStaticMarkup(
      <RuntimeConfigurationStatus overview={state} checkedAt={now} />,
    );
    expect(html).toContain("runtimeConfiguration.feedbackUnknownHelp");
    expect(html).not.toContain("runtimeConfiguration.feedbackAction");
    expect(html).not.toContain("<table");
    expect(html).not.toContain("0.1.0-development");
  });
  it("groups matching recent reports and excludes expired restarts", () => {
    expect(
      configurationFeedback(
        overview([
          worker,
          { ...worker, workerId: "second" },
          {
            ...worker,
            workerId: "old",
            observedAt: new Date(now - 120_000).toISOString(),
          },
        ]),
        now,
      ),
    ).toMatchObject({
      state: "current",
      count: 2,
      groups: [{ count: 2, version: 4 }],
    });
  });
  it("never presents an observed backend revision as applied in deployment mode", () => {
    const env = {
      ...worker,
      deployment: { ...worker.deployment, source: "environment" as const },
    };
    expect(configurationFeedback(overview([env]), now)).toMatchObject({
      state: "deployment",
      groups: [{ version: null }],
    });
    expect(configurationFeedback(overview([worker, env]), now).state).toBe(
      "mixed",
    );
  });
  it("distinguishes old policy and emergency disable from missing reports", () => {
    expect(
      configurationFeedback(
        overview([{ ...worker, configurationVersion: 3 }]),
        now,
      ).state,
    ).toBe("older");
    expect(
      configurationFeedback(
        overview([
          {
            ...worker,
            deployment: { ...worker.deployment, downloadsEnabled: false },
          },
        ]),
        now,
      ).emergencyDisabled,
    ).toBe(true);
  });
});
