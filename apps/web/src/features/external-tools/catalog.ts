import type { UserCapabilitySummary } from "@kanvas/contracts/api";
import { record } from "./bridge.js";

/** V1 intentionally supports only simple text/scalar inputs, without file or model execution in the frame. */
export function supportsBasicTool(capability: UserCapabilitySummary): boolean {
  const schema = capability.inputSchema;
  const properties = record(schema.properties);
  if (
    !properties ||
    schema.type !== "object" ||
    Object.keys(properties).length > 12 ||
    schema.oneOf ||
    schema.anyOf ||
    schema.allOf ||
    schema.$ref
  )
    return false;
  if (
    capability.parameters.some((parameter) =>
      parameter.semanticType.startsWith("artifact."),
    )
  )
    return false;
  return Object.values(properties).every((value) => {
    const field = record(value);
    return (
      field &&
      ["string", "number", "integer", "boolean"].includes(String(field.type)) &&
      !field.oneOf &&
      !field.anyOf &&
      !field.allOf &&
      !field.$ref
    );
  });
}
