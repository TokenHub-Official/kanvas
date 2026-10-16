import { describe, expect, it } from "vitest";
import {
  taskRecordDuration,
  taskRecordStatus,
} from "./task-record-presentation.js";

describe("support task presentation", () => {
  it("unifies successful execution states without hiding partial results", () => {
    expect(taskRecordStatus({ status: "completed" })).toEqual(
      taskRecordStatus({ status: "succeeded" }),
    );
    expect(
      taskRecordStatus({ status: "completed", outcome: "partial_success" }),
    ).toEqual({ key: "partialSuccess", tone: "warning" });
    expect(taskRecordStatus({ status: "failed" }).tone).toBe("danger");
  });
  it("formats wall time in readable units and leaves active duration unset", () => {
    const record = {
      createdAt: "2026-09-21T00:00:00Z",
      completedAt: "2026-09-21T00:02:21Z",
    };
    expect(taskRecordDuration(record, "zh-CN")).toBe("2分钟 21秒");
    expect(taskRecordDuration(record, "en-US")).toBe("2m 21s");
    expect(taskRecordDuration({ createdAt: record.createdAt }, "zh-CN")).toBe(
      "—",
    );
  });
});
