import type { InstanceRuntimeState } from "@kanvas/contracts/primitives";
import { datetime, int, mysqlTable, varchar } from "drizzle-orm/mysql-core";

export const instanceRuntimeStateTable = mysqlTable("instance_runtime_state", {
  instanceId: varchar("instance_id", { length: 120 }).primaryKey(),
  state: varchar("state", { length: 24 })
    .$type<InstanceRuntimeState>()
    .notNull(),
  executionGeneration: int("execution_generation", {
    unsigned: true,
  })
    .notNull()
    .default(1),
  stateVersion: int("state_version", { unsigned: true }).notNull().default(1),
  reason: varchar("reason", { length: 500 }).notNull(),
  deadline: datetime("deadline", {
    mode: "date",
    fsp: 3,
  }),
  changedBy: varchar("changed_by", { length: 120 }).notNull(),
  changedAt: datetime("changed_at", {
    mode: "date",
    fsp: 3,
  }).notNull(),
});
