import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/mysql-core";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  budgetAccountTable,
  budgetLedgerEntryTable,
  budgetReservationTable,
  credentialTable,
  instancePolicyBindingTable,
  instancePolicyRevisionTable,
  modelDeploymentTable,
  modelProfileRevisionTable,
  pricingRevisionTable,
  providerEndpointTable,
  routePolicyRevisionTable,
  secretVersionTable,
  workspacePolicyBindingTable,
  workspacePolicyRevisionTable,
} from "../src/schema/index.js";

describe("Configuration, Secret, Provider, and Budget schema", () => {
  it("mirrors every table introduced by migration 0013", () => {
    const tables = [
      instancePolicyRevisionTable,
      instancePolicyBindingTable,
      workspacePolicyRevisionTable,
      workspacePolicyBindingTable,
      providerEndpointTable,
      credentialTable,
      secretVersionTable,
      modelProfileRevisionTable,
      modelDeploymentTable,
      pricingRevisionTable,
      routePolicyRevisionTable,
      budgetAccountTable,
      budgetReservationTable,
      budgetLedgerEntryTable,
    ] as const;

    expect(tables).toHaveLength(14);
    expect(Object.keys(getTableColumns(secretVersionTable))).toEqual(
      expect.arrayContaining([
        "materialCiphertextBase64",
        "wrappedDekBase64",
        "deploymentReference",
        "materialFingerprint",
        "destroyedAt",
      ]),
    );
    expect(Object.keys(getTableColumns(budgetReservationTable))).toEqual(
      expect.arrayContaining([
        "workflowRunId",
        "capabilityRunId",
        "capabilityAttemptId",
        "pricingRevisionId",
        "requestDigest",
      ]),
    );
    expect(
      getTableConfig(credentialTable).foreignKeys.map((key) => key.getName()),
    ).toContain("fk_credential_active_secret_version");
    expect(
      getTableConfig(secretVersionTable).foreignKeys.map((key) =>
        key.getName(),
      ),
    ).toContain("fk_secret_version_credential");
  });

  it("keeps DECIMAL(36,12) values as strings", () => {
    expectTypeOf<
      typeof budgetAccountTable.$inferSelect.hardLimitAmount
    >().toEqualTypeOf<string>();
    expectTypeOf<
      typeof budgetReservationTable.$inferSelect.reservedAmount
    >().toEqualTypeOf<string>();
    expectTypeOf<
      typeof budgetLedgerEntryTable.$inferSelect.consumedDelta
    >().toEqualTypeOf<string>();
  });
});
