import { beforeAll, describe, expect, it } from "vitest";

import { i18n } from "../../i18n/i18n.js";
import {
  budgetConsumptionPercent,
  budgetUnavailableAmount,
  formatUsageMetric,
  reconciliationEvidenceSummary,
  reconciliationTimestamp,
  usageMetricLabel,
} from "./usage-summary-model.js";

beforeAll(async () => {
  await i18n.changeLanguage("zh-CN");
});

describe("usage summary presentation", () => {
  it("uses business labels for known metrics", () => {
    expect(usageMetricLabel("compute.wall_time")).toBe("处理时长");
    expect(usageMetricLabel("private.metric")).toBe("其他已记录用量");
  });

  it("formats quantity and money without exposing raw dimensions", () => {
    expect(
      formatUsageMetric({
        metricKey: "compute.wall_time",
        dimension: "quantity",
        unitCode: "millisecond",
        value: "4520.000000000000",
        unknownCount: 0,
        lastRecordedAt: "2026-08-05T00:00:00.000Z",
      }),
    ).toBe("5 秒");
    expect(
      formatUsageMetric({
        metricKey: "cost",
        dimension: "money",
        currencyCode: "USD",
        value: "0.720000000000",
        unknownCount: 0,
        lastRecordedAt: "2026-08-05T00:00:00.000Z",
      }),
    ).toContain("0.72");
  });

  it("presents long processing time in readable units", () => {
    expect(
      formatUsageMetric({
        metricKey: "compute.wall_time",
        dimension: "quantity",
        unitCode: "millisecond",
        value: "669920.49",
        unknownCount: 0,
        lastRecordedAt: "2026-08-05T00:00:00.000Z",
      }),
    ).toBe("11 分 10 秒");
  });

  it("includes reserved and unknown holds in the unavailable percentage", () => {
    const budget = {
      name: "模型服务",
      status: "active" as const,
      currencyCode: "USD",
      periodStartAt: "2026-08-01T00:00:00.000Z",
      periodEndAt: "2026-09-01T00:00:00.000Z",
      hardLimitAmount: "100",
      consumedAmount: "20",
      reservedAmount: "5",
      unknownHeldAmount: "10",
      remainingAmount: "65",
      version: 1,
    };
    expect(budgetUnavailableAmount(budget)).toBe(35);
    expect(budgetConsumptionPercent(budget)).toBe(35);
  });

  it("formats reconciliation evidence to the second in local time and UTC", () => {
    expect(
      reconciliationTimestamp("2026-08-06T03:28:46.687Z", "Asia/Shanghai"),
    ).toEqual({
      localDateTime: "2026-08-06 11:28:46",
      localZone: "GMT+8",
      utcDateTime: "2026-08-06 03:28:46",
    });
    expect(
      reconciliationTimestamp(
        "2026-08-06T03:28:46.687Z",
        "America/Los_Angeles",
      ),
    ).toEqual({
      localDateTime: "2026-08-05 20:28:46",
      localZone: "GMT-7",
      utcDateTime: "2026-08-06 03:28:46",
    });
  });

  it("fails closed for invalid reconciliation timestamps and time zones", () => {
    expect(
      reconciliationTimestamp("not-a-date", "Asia/Shanghai"),
    ).toBeUndefined();
    expect(
      reconciliationTimestamp("2026-08-06T03:28:46.687Z", "Invalid/Zone"),
    ).toBeUndefined();
  });

  it("builds a self-contained reconciliation summary without secrets", () => {
    expect(
      reconciliationEvidenceSummary(
        {
          id: "01KZAHVJ2ADE84RVCNTA2EXJMG",
          providerName: "TokenHub",
          workflowRunId: "01KZAHVGKJV98JWHK2NQ26YCX8",
          currencyCode: "USD",
          heldAmount: "1",
          version: 2,
          submittedAt: "2026-08-06T03:28:46.687Z",
          heldAt: "2026-08-06T03:28:46.687Z",
        },
        "Asia/Shanghai",
      ),
    ).toBe(
      [
        "模型服务：TokenHub",
        "保留金额：US$1.00",
        "Kanvas 运行：01KZAHVGKJV98JWHK2NQ26YCX8",
        "外部任务：未取得外部任务编号",
        "提交时间（本地）：2026-08-06 11:28:46 GMT+8",
        "提交时间（UTC）：2026-08-06 03:28:46 UTC",
      ].join("\n"),
    );
  });
});
