import { describe, expect, it } from "vitest";

import { assertDisposableIntegrationDatabaseName } from "./disposable-integration-database.js";

describe("disposable integration database guard", () => {
  it("refuses non-runner database names", () => {
    expect(() => assertDisposableIntegrationDatabaseName("kanvas")).toThrow(
      /runner-created isolated database/u,
    );
    expect(() =>
      assertDisposableIntegrationDatabaseName("kanvas_integration_manual"),
    ).toThrow(/runner-created isolated database/u);
    expect(() => assertDisposableIntegrationDatabaseName(undefined)).toThrow(
      /runner-created isolated database/u,
    );
  });

  it("accepts only the runner-generated database name shape", () => {
    expect(() =>
      assertDisposableIntegrationDatabaseName(
        "kanvas_integration_12345_012345abcdef",
      ),
    ).not.toThrow();
    expect(() =>
      assertDisposableIntegrationDatabaseName(
        "kanvas_integration_12345_012345ABCDEf",
      ),
    ).toThrow(/runner-created isolated database/u);
  });
});
