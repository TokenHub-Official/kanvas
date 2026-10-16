import { Type, type Static } from "@sinclair/typebox";

import { IsoDateTimeSchema, UlidSchema } from "../primitives/index.js";
import { WorkflowTopologySchema } from "../workflow/index.js";

export const EventEnvelopeSchema = Type.Object(
  {
    eventId: UlidSchema,
    eventType: Type.String({ minLength: 1, maxLength: 160 }),
    schemaVersion: Type.Integer({ minimum: 1 }),
    occurredAt: IsoDateTimeSchema,
    aggregateId: UlidSchema,
    payload: Type.Record(Type.String(), Type.Unknown()),
  },
  {
    additionalProperties: false,
  },
);

export type EventEnvelope = Static<typeof EventEnvelopeSchema>;

export const WorkflowTopologyValidationJobSchema = Type.Object(
  {
    expectedGeneration: Type.Integer({ minimum: 1 }),
    topology: WorkflowTopologySchema,
  },
  {
    additionalProperties: false,
    $id: "kanvas.job.workflow-topology-validation.v1",
  },
);

export type WorkflowTopologyValidationJob = Static<
  typeof WorkflowTopologyValidationJobSchema
>;
