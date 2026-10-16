import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Inject,
  NotFoundException,
  Param,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { TrustedWorkspaceScope } from "@kanvas/application";
import {
  getWorkspaceUsageSummaryRoute,
  resolveUnknownBudgetHoldRoute,
  ResolveUnknownBudgetHoldBodySchema,
  updateWorkspaceBudgetRoute,
  UpdateWorkspaceBudgetBodySchema,
  WorkspaceBudgetPathSchema,
  UnknownBudgetHoldPathSchema,
  type ResolveUnknownBudgetHoldBody,
  type UpdateWorkspaceBudgetBody,
  type WorkspaceBudgetMutationResult,
  type UnknownBudgetHoldResolution,
  type WorkspaceUsageSummary,
} from "@kanvas/contracts/api";
import {
  BudgetReservationStoreError,
  WorkspaceUsageSummaryStoreError,
  type ControlPlaneAuditContext,
} from "@kanvas/database/runtime";
import type { FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import { ulid } from "ulid";

import { ContractRoute } from "./contract-route.decorator.js";
import { ContractBodyPipe } from "./contract-body.pipe.js";
import { RequireWorkspacePermission } from "./workspace-permission.decorator.js";
import { WorkspaceAuthorizationGuard } from "./workspace-authorization.guard.js";
import { RequestAuthorizationContextStore } from "./request-authorization-context.js";
import { DATABASE_RUNTIME } from "../tokens.js";
import type { ServerDatabaseRuntime } from "../app.module.js";

const summaryWindowMilliseconds = 30 * 24 * 60 * 60 * 1000;

function authenticationReferenceHash(value: string): string {
  return `sha256:${createHash("sha256")
    .update("kanvas:budget-resolution-auth-ref:v1\0")
    .update(value)
    .digest("hex")}`;
}

function auditFor(
  scope: TrustedWorkspaceScope,
  request: FastifyRequest,
): ControlPlaneAuditContext {
  return Object.freeze({
    auditEventId: ulid(),
    actorPrincipalId: scope.principalId,
    actorType: scope.principalType,
    authenticationRefType: scope.authenticationRefType,
    authenticationRefHash: authenticationReferenceHash(
      scope.authenticationRefId,
    ),
    authorityType: scope.authorityType,
    authorityId: scope.authorityId,
    authorityVersion: scope.authorityVersion,
    requestId: request.id,
  });
}

function resolutionDigest(
  reservationId: string,
  body: ResolveUnknownBudgetHoldBody,
): string {
  return `sha256:${createHash("sha256")
    .update("kanvas:unknown-budget-resolution:v1\0")
    .update(
      JSON.stringify({
        reservationId,
        expectedVersion: body.expectedVersion,
        resolution: body.resolution,
        chargedAmount: body.chargedAmount ?? null,
        evidenceReference: body.evidenceReference.trim(),
      }),
    )
    .digest("hex")}`;
}

function mapResolutionError(error: unknown): never {
  if (!(error instanceof BudgetReservationStoreError)) {
    throw error;
  }
  if (error.code === "budget.not_found") {
    throw new NotFoundException(error.message);
  }
  if (
    error.code === "budget.identity_conflict" ||
    error.code === "budget.lifecycle_conflict"
  ) {
    throw new ConflictException(error.message);
  }
  throw new BadRequestException(error.message);
}

function mapBudgetUpdateError(error: unknown): never {
  if (!(error instanceof WorkspaceUsageSummaryStoreError)) {
    throw error;
  }
  if (error.code === "budget.not_found") {
    throw new NotFoundException(error.message);
  }
  if (error.code === "budget.version_conflict") {
    throw new ConflictException(error.message);
  }
  throw new BadRequestException(error.message);
}

@Controller()
export class WorkspaceUsageController {
  public constructor(
    @Inject(DATABASE_RUNTIME)
    private readonly database: ServerDatabaseRuntime,
    private readonly contexts: RequestAuthorizationContextStore,
  ) {}

  @ContractRoute(getWorkspaceUsageSummaryRoute)
  @RequireWorkspacePermission("usage.read")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async get(
    @Req() request: FastifyRequest,
  ): Promise<WorkspaceUsageSummary> {
    const { scope } = this.contexts.require(request);
    const now = new Date();
    const windowStartAt = new Date(now.getTime() - summaryWindowMilliseconds);
    const summary = await this.database.workspaceUsageSummary.get(
      scope,
      windowStartAt,
      now,
    );
    return {
      generatedAt: now.toISOString(),
      windowStartAt: windowStartAt.toISOString(),
      windowEndAt: now.toISOString(),
      trackedAttemptCount: summary.trackedAttemptCount,
      unknownUsageCount: summary.unknownUsageCount,
      budgets: summary.budgets.map((budget) => ({
        ...budget,
        periodStartAt: budget.periodStartAt.toISOString(),
        periodEndAt: budget.periodEndAt.toISOString(),
      })),
      unknownHolds: summary.unknownHolds.map((hold) => ({
        id: hold.id,
        providerName: hold.providerName,
        ...(hold.workflowRunId ? { workflowRunId: hold.workflowRunId } : {}),
        ...(hold.capabilityRunId
          ? { capabilityRunId: hold.capabilityRunId }
          : {}),
        ...(hold.providerRequestId
          ? {
              providerRequestId: hold.providerRequestId,
            }
          : {}),
        currencyCode: hold.currencyCode,
        heldAmount: hold.heldAmount,
        version: hold.version,
        ...(hold.submittedAt
          ? {
              submittedAt: hold.submittedAt.toISOString(),
            }
          : {}),
        heldAt: hold.heldAt.toISOString(),
      })),
      metrics: summary.metrics.map((metric) => ({
        ...metric,
        lastRecordedAt: metric.lastRecordedAt.toISOString(),
      })),
    };
  }

  @ContractRoute(updateWorkspaceBudgetRoute)
  @RequireWorkspacePermission("credential.manage")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async updateBudget(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(WorkspaceBudgetPathSchema))
    params: { readonly providerSettingId: string },
    @Body(new ContractBodyPipe(UpdateWorkspaceBudgetBodySchema))
    body: UpdateWorkspaceBudgetBody,
  ): Promise<WorkspaceBudgetMutationResult> {
    const { scope } = this.contexts.require(request);
    const now = new Date();
    try {
      const result =
        await this.database.workspaceUsageSummary.updateBudgetLimit({
          scope,
          providerSettingId: params.providerSettingId,
          expectedVersion: body.expectedVersion,
          hardLimitAmount: body.hardLimitAmount,
          now,
        });
      return {
        providerSettingId: result.providerSettingId,
        hardLimitAmount: result.hardLimitAmount,
        version: result.version,
        updatedAt: result.updatedAt.toISOString(),
      };
    } catch (error) {
      return mapBudgetUpdateError(error);
    }
  }

  @ContractRoute(resolveUnknownBudgetHoldRoute)
  @RequireWorkspacePermission("credential.manage")
  @UseGuards(WorkspaceAuthorizationGuard)
  public async resolveUnknownHold(
    @Req() request: FastifyRequest,
    @Param(new ContractBodyPipe(UnknownBudgetHoldPathSchema))
    params: { readonly budgetReservationId: string },
    @Body(new ContractBodyPipe(ResolveUnknownBudgetHoldBodySchema))
    body: ResolveUnknownBudgetHoldBody,
  ): Promise<UnknownBudgetHoldResolution> {
    if (body.resolution === "charged" && body.chargedAmount === undefined) {
      throw new BadRequestException("Charged amount is required.");
    }
    if (body.resolution === "not_charged" && body.chargedAmount !== undefined) {
      throw new BadRequestException(
        "Charged amount is not valid for a no-charge resolution.",
      );
    }
    const { scope } = this.contexts.require(request);
    const now = new Date();
    try {
      const result = await this.database.budgetReservations.resolveUnknown({
        scope,
        reservationId: params.budgetReservationId,
        expectedVersion: body.expectedVersion,
        ledgerEntryId: ulid(),
        ledgerEntryKey: `unknown-resolve:${params.budgetReservationId}:${String(
          body.expectedVersion,
        )}`,
        requestDigest: resolutionDigest(params.budgetReservationId, body),
        resolution: body.resolution,
        ...(body.chargedAmount === undefined
          ? {}
          : {
              chargedAmount: body.chargedAmount,
            }),
        evidenceReference: body.evidenceReference.trim(),
        now,
        audit: auditFor(scope, request),
      });
      return {
        budgetReservationId: result.reservationId,
        result: result.status,
        lifecycleStatus: result.lifecycleStatus,
        chargedAmount: result.chargedAmount,
        resolvedAt: result.resolvedAt.toISOString(),
      };
    } catch (error) {
      return mapResolutionError(error);
    }
  }
}
