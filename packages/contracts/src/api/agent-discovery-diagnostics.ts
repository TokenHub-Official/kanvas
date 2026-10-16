import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  AgentDiscoveryDiagnosticsSchema,
  type AgentDiscoveryDiagnostics,
} from "./schemas.js";

const ajv = new Ajv2020({ strict: false });
const registerFormats = addFormats as unknown as (instance: Ajv2020) => void;
registerFormats(ajv);
const validate = ajv.compile<AgentDiscoveryDiagnostics>(
  AgentDiscoveryDiagnosticsSchema,
);

/** Only bounded, explicit diagnostic facts may cross persistence and API seams. */
export function parseAgentDiscoveryDiagnostics(
  value: unknown,
): AgentDiscoveryDiagnostics {
  const candidate: unknown =
    typeof value === "string" ? JSON.parse(value) : value;
  if (!validate(candidate) || JSON.stringify(candidate).length > 32_768) {
    throw new TypeError("Agent discovery diagnostics are invalid.");
  }
  return candidate;
}
