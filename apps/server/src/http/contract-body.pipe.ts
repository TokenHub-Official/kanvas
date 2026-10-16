import { BadRequestException, type PipeTransform } from "@nestjs/common";
import type { TSchema } from "@sinclair/typebox";
import { WorkflowJsonValueSchema } from "@kanvas/contracts/workflow";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

export class ContractBodyPipe implements PipeTransform<unknown, unknown> {
  readonly #validate: ValidateFunction;

  public constructor(schema: TSchema) {
    const ajv = new Ajv2020({
      strict: true,
      allErrors: true,
      coerceTypes: false,
      removeAdditional: false,
      useDefaults: false,
    });
    const registerFormats = addFormats as unknown as (
      instance: Ajv2020,
    ) => unknown;
    registerFormats(ajv);
    ajv.addSchema(WorkflowJsonValueSchema);
    this.#validate = ajv.compile(schema);
  }

  public transform(value: unknown): unknown {
    if (this.#validate(value)) {
      return value;
    }

    const pointers = (this.#validate.errors ?? [])
      .map((error) => error.instancePath || "/")
      .slice(0, 20);
    throw new BadRequestException({
      type: "https://kanvas.invalid/problems/contract-validation",
      title: "Request contract validation failed",
      status: 400,
      code: "contract_validation_failed",
      detail: `Invalid fields: ${pointers.join(", ")}`,
    });
  }
}
