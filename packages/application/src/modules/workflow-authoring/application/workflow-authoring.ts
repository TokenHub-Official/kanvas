import type {
  WorkflowCapabilityAuthoringDeclaration,
  WorkflowPresentation,
} from "@kanvas/contracts/api";
import type { WorkflowTopologyV1 } from "@kanvas/contracts/workflow";

import { DomainError } from "../../../foundation/domain-error.js";
import type { TrustedWorkspaceScope } from "../../authorization/index.js";

export interface WorkflowAuthoringDocument {
  readonly schemaVersion: 1;
  readonly topology: WorkflowTopologyV1;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema: Readonly<Record<string, unknown>>;
  readonly presentation?: WorkflowPresentation;
}

export interface WorkflowDefinitionSummary {
  readonly id: string;
  readonly workspaceId: string;
  readonly workflowKey: string;
  readonly displayName: string;
  readonly description?: string;
  readonly category?: string;
  readonly lifecycleStatus: "active" | "archived";
  readonly version: number;
  readonly draft?: {
    readonly id: string;
    readonly version: number;
    readonly lifecycleStatus: "active" | "archived";
    readonly updatedAt: Date;
  };
  readonly latestRevision?: {
    readonly id: string;
    readonly revision: number;
    readonly lifecycleStatus: string;
    readonly runtimeStatus?: string;
    readonly publishedAt?: Date;
  };
  readonly createdByPrincipalId: string;
  readonly updatedByPrincipalId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface WorkflowDraftView {
  readonly definition: WorkflowDefinitionSummary;
  readonly draft: {
    readonly id: string;
    readonly version: number;
    readonly lifecycleStatus: "active" | "archived";
    readonly canonicalDigest: string;
    readonly document: WorkflowAuthoringDocument;
    readonly derivedFromWorkflowRevisionId?: string;
    readonly createdByPrincipalId: string;
    readonly updatedByPrincipalId: string;
    readonly createdAt: Date;
    readonly updatedAt: Date;
  };
}

export interface WorkflowDefinitionList {
  readonly items: readonly WorkflowDefinitionSummary[];
  readonly truncated: boolean;
}

export interface WorkflowAuthoringCapability {
  readonly contractId: string;
  readonly contractKey: string;
  readonly revision: number;
  readonly canonicalDigest: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema: Readonly<Record<string, unknown>>;
  readonly authoring: WorkflowCapabilityAuthoringDeclaration;
}

export interface WorkflowAuthoringAuditContext {
  readonly auditEventId: string;
  readonly authenticationRefHash: string;
  readonly requestId?: string;
  readonly traceId?: string;
}

export interface CreateWorkflowDraftPersistenceOptions {
  readonly authority: TrustedWorkspaceScope;
  readonly definitionId: string;
  readonly draftId: string;
  readonly workflowKey: string;
  readonly displayName: string;
  readonly description?: string;
  readonly category?: string;
  readonly document: WorkflowAuthoringDocument;
  readonly derivedFromWorkflowRevisionId?: string;
  readonly idempotencyKey: string;
  readonly actorPrincipalId: string;
  readonly now: Date;
  readonly audit: WorkflowAuthoringAuditContext;
}

export interface UpdateWorkflowDraftPersistenceOptions {
  readonly authority: TrustedWorkspaceScope;
  readonly definitionId: string;
  readonly draftId: string;
  readonly expectedDefinitionVersion: number;
  readonly expectedDraftVersion: number;
  readonly displayName: string;
  readonly description?: string;
  readonly category?: string;
  readonly document: WorkflowAuthoringDocument;
  readonly actorPrincipalId: string;
  readonly now: Date;
  readonly audit: WorkflowAuthoringAuditContext;
}

export interface ArchiveWorkflowDraftPersistenceOptions {
  readonly authority: TrustedWorkspaceScope;
  readonly definitionId: string;
  readonly draftId: string;
  readonly expectedDefinitionVersion: number;
  readonly expectedDraftVersion: number;
  readonly actorPrincipalId: string;
  readonly now: Date;
  readonly audit: WorkflowAuthoringAuditContext;
}

export interface WorkflowDraftMutationResult {
  readonly value: WorkflowDraftView;
  readonly replayed: boolean;
}

export interface WorkflowAuthoringRepository {
  listCapabilities(
    authority: TrustedWorkspaceScope,
    now: Date,
  ): Promise<readonly WorkflowAuthoringCapability[]>;
  list(
    authority: TrustedWorkspaceScope,
    options: {
      readonly includeArchived: boolean;
      readonly limit: number;
      readonly now: Date;
    },
  ): Promise<WorkflowDefinitionList>;
  get(
    authority: TrustedWorkspaceScope,
    definitionId: string,
    now: Date,
  ): Promise<WorkflowDraftView | undefined>;
  create(
    options: CreateWorkflowDraftPersistenceOptions,
  ): Promise<WorkflowDraftMutationResult>;
  update(
    options: UpdateWorkflowDraftPersistenceOptions,
  ): Promise<WorkflowDraftMutationResult>;
  archive(
    options: ArchiveWorkflowDraftPersistenceOptions,
  ): Promise<WorkflowDraftMutationResult>;
}

export interface WorkflowAuthoringDependencies {
  readonly repository: WorkflowAuthoringRepository;
  readonly now: () => Date;
  readonly nextId: () => string;
}

export interface CreateWorkflowDraftCommand {
  readonly authority: TrustedWorkspaceScope;
  readonly workflowKey: string;
  readonly displayName: string;
  readonly description?: string;
  readonly category?: string;
  readonly document: WorkflowAuthoringDocument;
  readonly derivedFromWorkflowRevisionId?: string;
  readonly idempotencyKey: string;
  readonly audit: WorkflowAuthoringAuditContext;
}

export interface UpdateWorkflowDraftCommand {
  readonly authority: TrustedWorkspaceScope;
  readonly definitionId: string;
  readonly draftId: string;
  readonly expectedDefinitionVersion: number;
  readonly expectedDraftVersion: number;
  readonly displayName: string;
  readonly description?: string;
  readonly category?: string;
  readonly document: WorkflowAuthoringDocument;
  readonly audit: WorkflowAuthoringAuditContext;
}

export interface ArchiveWorkflowDraftCommand {
  readonly authority: TrustedWorkspaceScope;
  readonly definitionId: string;
  readonly draftId: string;
  readonly expectedDefinitionVersion: number;
  readonly expectedDraftVersion: number;
  readonly audit: WorkflowAuthoringAuditContext;
}

export interface WorkflowAuthoring {
  listCapabilities(
    authority: TrustedWorkspaceScope,
  ): Promise<readonly WorkflowAuthoringCapability[]>;
  list(
    authority: TrustedWorkspaceScope,
    options?: {
      readonly includeArchived?: boolean;
      readonly limit?: number;
    },
  ): Promise<WorkflowDefinitionList>;
  get(
    authority: TrustedWorkspaceScope,
    definitionId: string,
  ): Promise<WorkflowDraftView>;
  create(
    command: CreateWorkflowDraftCommand,
  ): Promise<WorkflowDraftMutationResult>;
  update(
    command: UpdateWorkflowDraftCommand,
  ): Promise<WorkflowDraftMutationResult>;
  archive(
    command: ArchiveWorkflowDraftCommand,
  ): Promise<WorkflowDraftMutationResult>;
}

function assertAuthoringDocument(document: WorkflowAuthoringDocument): void {
  if (document.schemaVersion !== 1) {
    throw new DomainError(
      "workflow_authoring.document_invalid",
      "Workflow authoring document version is not supported.",
    );
  }
}

export function createWorkflowAuthoring(
  dependencies: WorkflowAuthoringDependencies,
): WorkflowAuthoring {
  const workflowAuthoring: WorkflowAuthoring = {
    listCapabilities(authority: TrustedWorkspaceScope) {
      return dependencies.repository.listCapabilities(
        authority,
        dependencies.now(),
      );
    },
    list(
      authority: TrustedWorkspaceScope,
      options?: {
        readonly includeArchived?: boolean;
        readonly limit?: number;
      },
    ) {
      return dependencies.repository.list(authority, {
        includeArchived: options?.includeArchived === true,
        limit: Math.min(Math.max(options?.limit ?? 50, 1), 100),
        now: dependencies.now(),
      });
    },

    async get(authority: TrustedWorkspaceScope, definitionId: string) {
      const result = await dependencies.repository.get(
        authority,
        definitionId,
        dependencies.now(),
      );
      if (!result) {
        throw new DomainError(
          "workflow_authoring.not_found",
          "Workflow definition or draft was not found.",
        );
      }
      return result;
    },

    create(command: CreateWorkflowDraftCommand) {
      assertAuthoringDocument(command.document);
      return dependencies.repository.create({
        authority: command.authority,
        definitionId: dependencies.nextId(),
        draftId: dependencies.nextId(),
        workflowKey: command.workflowKey,
        displayName: command.displayName,
        ...(command.description !== undefined
          ? { description: command.description }
          : {}),
        ...(command.category !== undefined
          ? { category: command.category }
          : {}),
        document: command.document,
        ...(command.derivedFromWorkflowRevisionId !== undefined
          ? {
              derivedFromWorkflowRevisionId:
                command.derivedFromWorkflowRevisionId,
            }
          : {}),
        idempotencyKey: command.idempotencyKey,
        actorPrincipalId: command.authority.principalId,
        now: dependencies.now(),
        audit: command.audit,
      });
    },

    update(command: UpdateWorkflowDraftCommand) {
      assertAuthoringDocument(command.document);
      return dependencies.repository.update({
        authority: command.authority,
        definitionId: command.definitionId,
        draftId: command.draftId,
        expectedDefinitionVersion: command.expectedDefinitionVersion,
        expectedDraftVersion: command.expectedDraftVersion,
        displayName: command.displayName,
        ...(command.description !== undefined
          ? { description: command.description }
          : {}),
        ...(command.category !== undefined
          ? { category: command.category }
          : {}),
        document: command.document,
        actorPrincipalId: command.authority.principalId,
        now: dependencies.now(),
        audit: command.audit,
      });
    },

    archive(command: ArchiveWorkflowDraftCommand) {
      return dependencies.repository.archive({
        authority: command.authority,
        definitionId: command.definitionId,
        draftId: command.draftId,
        expectedDefinitionVersion: command.expectedDefinitionVersion,
        expectedDraftVersion: command.expectedDraftVersion,
        actorPrincipalId: command.authority.principalId,
        now: dependencies.now(),
        audit: command.audit,
      });
    },
  };
  return Object.freeze(workflowAuthoring);
}
