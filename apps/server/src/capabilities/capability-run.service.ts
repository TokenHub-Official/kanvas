import type { ToolSessionRunContext } from "@kanvas/database/runtime";
import { createHash } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import { DomainError, type TrustedWorkspaceScope } from "@kanvas/application";
import type { DirectCapabilityRunRecord } from "@kanvas/database/runtime";
import { CapabilityRunStoreError } from "@kanvas/database/runtime";
import { monotonicFactory } from "ulid";

import type { ServerDatabaseRuntime } from "../app.module.js";
import { createJsonSchemaInputValidator } from "../application-adapters.js";
import { DATABASE_RUNTIME } from "../tokens.js";

const nextId = monotonicFactory();

function authenticationReferenceHash(value: string): string {
  return `sha256:${createHash("sha256")
    .update("kanvas:capability-run-auth-ref:v1\0")
    .update(value)
    .digest("hex")}`;
}

@Injectable()
export class CapabilityRunService {
  readonly #inputValidator = createJsonSchemaInputValidator();

  public constructor(
    @Inject(DATABASE_RUNTIME)
    private readonly database: ServerDatabaseRuntime,
  ) {}

  public async start(options: {
    readonly toolSession?: ToolSessionRunContext;
    readonly authority: TrustedWorkspaceScope;
    readonly invocationKind: "user" | "agent" | "canvas";
    readonly invocationReferenceId: string;
    readonly contractRevisionId: string;
    readonly idempotencyKey: string;
    readonly input: Readonly<Record<string, unknown>>;
    readonly requestId: string;
    readonly now: Date;
  }): Promise<Readonly<{ run: DirectCapabilityRunRecord; replayed: boolean }>> {
    const idempotencyKey = options.idempotencyKey.trim();
    if (!idempotencyKey || idempotencyKey.length > 160) {
      throw new DomainError(
        "capability_run.invalid_argument",
        "A valid Idempotency-Key is required.",
      );
    }
    try {
      const capability = await this.database.capabilityRuns.getInvokable(
        options.authority,
        options.contractRevisionId,
        options.invocationKind,
        options.now,
      );
      const issues = this.#inputValidator.validate(
        capability.inputSchema,
        options.input,
      );
      if (issues.length > 0) {
        throw new DomainError(
          "capability_run.input_invalid",
          `Capability input failed validation: ${issues.join(", ")}`,
        );
      }
      return await this.database.capabilityRuns.createDirect({
        ...(options.toolSession ? { toolSession: options.toolSession } : {}),
        scope: options.authority,
        invocationKind: options.invocationKind,
        invocationReferenceId: options.invocationReferenceId,
        contractRevisionId: options.contractRevisionId,
        idempotencyKey,
        input: options.input,
        runId: nextId(),
        attemptId: nextId(),
        outboxEventId: nextId(),
        now: options.now,
        audit: {
          auditEventId: nextId(),
          actorPrincipalId: options.authority.principalId,
          actorType: options.authority.principalType,
          authenticationRefType: options.authority.authenticationRefType,
          authenticationRefHash: authenticationReferenceHash(
            options.authority.authenticationRefId,
          ),
          authorityType: options.authority.authorityType,
          authorityId: options.authority.authorityId,
          authorityVersion: options.authority.authorityVersion,
          requestId: options.requestId,
        },
      });
    } catch (error) {
      if (error instanceof DomainError) throw error;
      if (error instanceof CapabilityRunStoreError) {
        throw new DomainError(error.code, error.message);
      }
      throw error;
    }
  }

  public async get(
    authority: TrustedWorkspaceScope,
    capabilityRunId: string,
    now: Date,
  ): Promise<DirectCapabilityRunRecord> {
    try {
      return await this.database.capabilityRuns.get(
        authority,
        capabilityRunId,
        now,
      );
    } catch (error) {
      if (error instanceof CapabilityRunStoreError) {
        throw new DomainError(error.code, error.message);
      }
      throw error;
    }
  }

  public async cancel(options: {
    readonly authority: TrustedWorkspaceScope;
    readonly capabilityRunId: string;
    readonly requestId: string;
    readonly now: Date;
  }): Promise<DirectCapabilityRunRecord> {
    try {
      return await this.database.capabilityRuns.cancelDirect(
        options.authority,
        options.capabilityRunId,
        options.now,
        {
          auditEventId: nextId(),
          actorPrincipalId: options.authority.principalId,
          actorType: options.authority.principalType,
          authenticationRefType: options.authority.authenticationRefType,
          authenticationRefHash: authenticationReferenceHash(
            options.authority.authenticationRefId,
          ),
          authorityType: options.authority.authorityType,
          authorityId: options.authority.authorityId,
          authorityVersion: options.authority.authorityVersion,
          requestId: options.requestId,
        },
      );
    } catch (error) {
      if (error instanceof CapabilityRunStoreError) {
        throw new DomainError(error.code, error.message);
      }
      throw error;
    }
  }
}
