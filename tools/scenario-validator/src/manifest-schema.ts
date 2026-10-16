import { CapabilityContractRevisionRefSchema } from "@kanvas/contracts/capability";
import { Type, type Static } from "@sinclair/typebox";

export const ScenarioPackManifestSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    packId: Type.String({
      pattern: "^[a-z][a-z0-9.-]+$",
      maxLength: 160,
    }),
    displayName: Type.String({ minLength: 1, maxLength: 200 }),
    workflows: Type.Array(
      Type.Object(
        {
          path: Type.String({ pattern: "^workflows/[a-z0-9._-]+\\.json$" }),
        },
        {
          additionalProperties: false,
        },
      ),
      {
        minItems: 1,
        maxItems: 20,
      },
    ),
    skill: Type.Optional(
      Type.Object(
        {
          path: Type.String({
            pattern: "^skill/[a-z0-9._-]+\\.json$",
          }),
        },
        {
          additionalProperties: false,
        },
      ),
    ),
    capabilities: Type.Optional(
      Type.Array(
        Type.Object(
          {
            path: Type.String({
              pattern: "^capabilities/[a-z0-9._-]+\\.json$",
            }),
          },
          {
            additionalProperties: false,
          },
        ),
        {
          minItems: 0,
          maxItems: 100,
        },
      ),
    ),
    requiredCapabilities: Type.Array(CapabilityContractRevisionRefSchema, {
      maxItems: 100,
    }),
  },
  {
    additionalProperties: false,
  },
);

export type ScenarioPackManifest = Static<typeof ScenarioPackManifestSchema>;
