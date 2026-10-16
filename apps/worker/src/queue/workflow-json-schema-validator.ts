import type { WorkflowJsonSchemaValidationPort } from "@kanvas/database/runtime";
import { digestProviderValue } from "@kanvas/database/runtime";
import { registerKanvasJsonSchemaKeywords } from "@kanvas/contracts/api";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const maximumCachedSchemas = 256;
const maximumReportedIssues = 32;

export function createWorkflowJsonSchemaValidationPort(): WorkflowJsonSchemaValidationPort {
  const ajv = new Ajv2020({
    strict: true,
    strictRequired: false,
    strictTypes: false,
    allErrors: true,
    coerceTypes: false,
    removeAdditional: false,
    useDefaults: false,
  });
  const registerFormats = addFormats as unknown as (
    instance: Ajv2020,
  ) => unknown;
  registerFormats(ajv);
  registerKanvasJsonSchemaKeywords(ajv);
  const cache = new Map<string, ValidateFunction>();

  return Object.freeze({
    validate(
      schema: Readonly<Record<string, unknown>>,
      value: unknown,
    ): readonly string[] {
      const digest = digestProviderValue(schema);
      let validator = cache.get(digest);
      if (!validator) {
        try {
          validator = ajv.compile(schema);
        } catch {
          return Object.freeze(["schema is not a valid JSON Schema"]);
        }
        if (cache.size >= maximumCachedSchemas) {
          const oldest = cache.keys().next().value;
          if (oldest) {
            cache.delete(oldest);
          }
        }
        cache.set(digest, validator);
      }
      if (validator(value)) {
        return Object.freeze([]);
      }
      return Object.freeze(
        (validator.errors ?? [])
          .slice(0, maximumReportedIssues)
          .map((error) =>
            `${error.instancePath || "/"} ${error.message ?? "invalid"}`
              .replaceAll(/\s+/gu, " ")
              .slice(0, 240),
          ),
      );
    },
  });
}
