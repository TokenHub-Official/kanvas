import { Type, type Static } from "@sinclair/typebox";

export const UlidSchema = Type.String({
  minLength: 26,
  maxLength: 26,
  pattern: "^[0-9A-HJKMNP-TV-Z]{26}$",
});

export type Ulid = Static<typeof UlidSchema>;

export const IsoDateTimeSchema = Type.String({
  format: "date-time",
});

export const ProcessRoleSchema = Type.Union([
  Type.Literal("server"),
  Type.Literal("worker"),
  Type.Literal("migrate"),
]);

export type ProcessRole = Static<typeof ProcessRoleSchema>;

export const InstanceRuntimeStateSchema = Type.Union([
  Type.Literal("ACTIVE"),
  Type.Literal("DRAINING"),
  Type.Literal("MAINTENANCE"),
  Type.Literal("RESTORING"),
  Type.Literal("VERIFYING"),
  Type.Literal("READ_ONLY"),
]);

export type InstanceRuntimeState = Static<typeof InstanceRuntimeStateSchema>;
