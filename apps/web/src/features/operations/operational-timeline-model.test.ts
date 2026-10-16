import type { OperationalTimeline } from "@kanvas/contracts/api";
import { beforeAll, describe, expect, it } from "vitest";

import { i18n } from "../../i18n/i18n.js";
import {
  isOperationalIssue,
  operationalEventSummary,
  operationalEventTitle,
  operationalEventTone,
  operationalResponseStructureSummary,
} from "./operational-timeline-model.js";

type TimelineItem = OperationalTimeline["items"][number];

beforeAll(async () => {
  await i18n.changeLanguage("zh-CN");
});

function item(
  input: Partial<TimelineItem> & Pick<TimelineItem, "source">,
): TimelineItem {
  return {
    facts: {},
    id: "01K00000000000000000000000",
    kind: "snapshot",
    occurredAt: "2026-08-05T00:00:00.000Z",
    resourceId: "01K00000000000000000000001",
    resourceType: "workflow_run",
    ...input,
  };
}

describe("operational timeline presentation", () => {
  it("puts the business state in the event title", () => {
    expect(
      operationalEventTitle(
        item({
          source: "workflow_run",
          outcome: "full_success",
        }),
      ),
    ).toBe("工作流：成功");
  });

  it("explains execution target without exposing raw facts first", () => {
    const attempt = item({
      source: "capability_attempt",
      status: "running",
      facts: {
        attemptNumber: 2,
        executionTarget: "worker",
      },
    });
    expect(operationalEventTitle(attempt)).toBe("第 2 次执行尝试：执行中");
    expect(operationalEventSummary(attempt)).toBe("执行位置：后台 Worker");
  });

  it("promotes failures and recoverable waiting states", () => {
    const failed = item({
      source: "provider_invocation",
      status: "failed",
    });
    const waiting = item({
      source: "node_run",
      status: "waiting",
    });
    expect(operationalEventTone(failed)).toBe("danger");
    expect(isOperationalIssue(failed)).toBe(true);
    expect(operationalEventTone(waiting)).toBe("warning");
    expect(isOperationalIssue(waiting)).toBe(true);
  });

  it("explains a safe Provider response structure without exposing response values", () => {
    const observation = item({
      source: "provider_observation",
      status: "failed",
      outcome: "provider.response_task_id_invalid",
      facts: {
        responseStructure: "d-o.t-u.s-s.r-u.u-u.c-u.e-u.m-u.x-2",
      },
    });

    expect(operationalEventSummary(observation)).toBe(
      "观察结果：provider.response_task_id_invalid · 已记录安全响应结构",
    );
    expect(operationalResponseStructureSummary(observation)).toBe(
      "响应数据：对象；status：字符串；缺失：task_id、result_urls、updated_at、created_at、error、message；其他字段：2 个",
    );
  });

  it("fails closed on a malformed response structure", () => {
    expect(
      operationalResponseStructureSummary(
        item({
          source: "provider_observation",
          facts: {
            responseStructure: "d-o.private-field-name-private-field-value",
          },
        }),
      ),
    ).toBeUndefined();
  });
});
