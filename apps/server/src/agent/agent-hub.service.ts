import { Inject, Injectable } from "@nestjs/common";
import { stableAgentRuntimeId } from "@kanvas/agent-runtime";
import {
  defaultAgentWorkspaceProfileV1,
  DomainError,
  isSystemManagedAgentV1,
  workspaceDefaultAgentSystemKeyV1,
  type TrustedWorkspaceScope,
} from "@kanvas/application";
import type {
  AgentHubAgent,
  AgentHubAgentDetail,
  AgentHubAgents,
  AgentHubSkills,
  CreateAgentHubAgentBody,
  UpdateAgentHubAgentBody,
} from "@kanvas/contracts/api";
import {
  AgentHubStoreError,
  AgentProfilePublicationStoreError,
  digestProviderValue,
  type AgentHubAgentDetailRecord,
  type DatabaseRuntime,
} from "@kanvas/database/runtime";
import { ulid } from "ulid";

import type { AuthenticationGateway } from "../auth/authentication-gateway.js";
import { AUTHENTICATION_GATEWAY, DATABASE_RUNTIME } from "../tokens.js";

function agentRecord(
  value: Awaited<ReturnType<DatabaseRuntime["agentHub"]["listAgents"]>>[number],
): AgentHubAgent {
  return {
    id: value.id,
    agentKey: value.agentKey,
    resourceState: value.resourceState,
    managementKind: value.managementKind,
    ...(value.systemKey ? { systemKey: value.systemKey } : {}),
    isDefault:
      value.managementKind === "system" &&
      value.systemKey === workspaceDefaultAgentSystemKeyV1,
    displayName: value.displayName,
    summary: value.summary,

    ...(value.avatar ? { avatar: { ...value.avatar } } : {}),
    ...(value.coverAssetId ? { coverAssetId: value.coverAssetId } : {}),
    ...(value.category ? { category: value.category } : {}),
    tags: [...value.tags],
    ownerPrincipalId: value.ownerPrincipalId,
    visibility: value.visibility,
    version: value.version,
    profileRevisionId: value.profileRevisionId,
    profileRevision: value.profileRevision,
    boundSkillCount: value.boundSkillCount,
    updatedAt: value.updatedAt.toISOString(),
  };
}

function canEditAgent(
  authority: TrustedWorkspaceScope,
  agent: {
    readonly managementKind: "system" | "workspace";
    readonly ownerPrincipalId: string;
  },
): boolean {
  return (
    !isSystemManagedAgentV1(agent) &&
    authority.effectivePermissions.includes("agent.manage") &&
    authority.effectivePermissions.includes("agent.publish") &&
    (agent.ownerPrincipalId === authority.principalId ||
      authority.effectivePermissions.includes("workspace.manage"))
  );
}

async function agentDetailRecord(
  authentication: AuthenticationGateway,
  authority: TrustedWorkspaceScope,
  value: AgentHubAgentDetailRecord,
): Promise<AgentHubAgentDetail> {
  let creatorDisplayName: string | undefined;
  if (!isSystemManagedAgentV1(value)) {
    try {
      creatorDisplayName = (
        await authentication.getHumanProfile?.(value.ownerAuthSubjectId)
      )?.displayName;
    } catch {
      creatorDisplayName = undefined;
    }
  }
  return {
    ...agentRecord(value),
    instructions: value.profile.manifest.instructions,
    ...(creatorDisplayName ? { creatorDisplayName } : {}),
    canEdit:
      value.resourceState !== "deleted" && canEditAgent(authority, value),
    boundSkills: value.boundSkills.map((skill) => ({ ...skill })),
    boundBrands: value.boundBrands.map((brand) => ({ ...brand })),
    boundLibraries: (value.boundLibraries ?? []).map((library) => ({
      ...library,
    })),
    boundWorkflows: value.boundWorkflows.map((workflow) => ({ ...workflow })),
  };
}

function mapError(error: unknown): never {
  if (
    error instanceof AgentHubStoreError ||
    error instanceof AgentProfilePublicationStoreError
  ) {
    throw new DomainError(error.code, error.message);
  }
  throw error;
}

@Injectable()
export class AgentHubService {
  public constructor(
    @Inject(DATABASE_RUNTIME) private readonly database: DatabaseRuntime,
    @Inject(AUTHENTICATION_GATEWAY)
    private readonly authentication: AuthenticationGateway,
  ) {}

  public listResourceStates(
    authority: TrustedWorkspaceScope,
    subjectKind: "agent" | "skill",
  ) {
    return this.database.agentHub
      .listResourceStates(authority, subjectKind, new Date())
      .then((items) => ({ items }));
  }
  public changeResourceState(
    authority: TrustedWorkspaceScope,
    subjectKind: "agent" | "skill",
    subjectId: string,
    body: {
      expectedVersion: number;
      state: "enabled" | "disabled" | "deleted";
    },
  ) {
    return this.database.agentHub.changeResourceState({
      authority,
      subjectKind,
      subjectId,
      ...body,
      now: new Date(),
      audit: {
        auditEventId: ulid(),
        actorPrincipalId: authority.principalId,
        actorType: authority.principalType,
        authenticationRefType: authority.authenticationRefType,
        authenticationRefHash: digestProviderValue(
          authority.authenticationRefId,
        ),
        authorityType: authority.authorityType,
        authorityId: authority.authorityId,
        authorityVersion: authority.authorityVersion,
      },
    });
  }
  public async listAgents(
    authority: TrustedWorkspaceScope,
    now: Date,
  ): Promise<AgentHubAgents> {
    try {
      const items = await this.database.agentHub.listAgents(authority, now);
      return { items: items.map(agentRecord) };
    } catch (error) {
      return mapError(error);
    }
  }

  public async listSkills(
    authority: TrustedWorkspaceScope,
    now: Date,
  ): Promise<AgentHubSkills> {
    try {
      const items = await this.database.agentHub.listSkills(authority, now);
      return {
        items: items.map((item) => ({
          ...item,
          tags: [...item.tags],
          exampleRequests: [...item.exampleRequests],
          updatedAt: item.updatedAt.toISOString(),
        })),
      };
    } catch (error) {
      return mapError(error);
    }
  }

  public async getAgent(options: {
    readonly authority: TrustedWorkspaceScope;
    readonly agentDefinitionId: string;
    readonly now: Date;
    readonly threadId?: string;
  }): Promise<AgentHubAgentDetail> {
    try {
      const thread = options.threadId
        ? await this.database.agentRuntime.getThread(
            options.authority,
            options.threadId,
            options.now,
          )
        : undefined;
      if (
        options.threadId &&
        (!thread || thread.agentDefinitionId !== options.agentDefinitionId)
      ) {
        throw new DomainError(
          "agent_hub.not_found",
          "This Agent conversation is unavailable.",
        );
      }

      const agent = await this.database.agentHub.getAgent(
        options.authority,
        options.agentDefinitionId,
        options.now,
        {
          includeDeleted: true,
          ...(thread
            ? { profileRevisionId: thread.agentProfileRevisionId }
            : {}),
        },
      );
      if (!agent) {
        throw new DomainError(
          "agent_hub.not_found",
          "This Agent is unavailable.",
        );
      }
      return await agentDetailRecord(
        this.authentication,
        options.authority,
        agent,
      );
    } catch (error) {
      return mapError(error);
    }
  }

  public async createAgent(options: {
    readonly authority: TrustedWorkspaceScope;
    readonly body: CreateAgentHubAgentBody;
    readonly idempotencyKey: string;
    readonly now: Date;
  }): Promise<AgentHubAgent> {
    const identity = `${options.authority.workspaceId}:${options.authority.principalId}:${options.idempotencyKey}`;
    const agentDefinitionId = stableAgentRuntimeId(
      "agent-definition",
      identity,
      1,
    );
    const profileRevisionId = stableAgentRuntimeId(
      "agent-profile-revision",
      identity,
      1,
    );
    try {
      await this.database.agentProfilePublications.publish({
        authority: options.authority,
        agentDefinitionId,
        profileRevisionId,
        managementKind: "workspace",
        creationRequestHash: digestProviderValue(options.body),
        visibility: options.body.visibility,
        presentation: {
          displayName: options.body.displayName.trim(),
          summary: options.body.summary.trim(),

          ...(options.body.avatar ? { avatar: options.body.avatar } : {}),
          ...(options.body.coverAssetId
            ? { coverAssetId: options.body.coverAssetId }
            : {}),
          ...(options.body.category
            ? { category: options.body.category.trim() }
            : {}),
          tags: options.body.tags,
        },
        boundSkillDefinitionIds: options.body.skillDefinitionIds,
        boundBrandKitIds: options.body.brandKitIds,
        boundLibraryIds: options.body.libraryIds ?? [],
        boundWorkflowDefinitionIds: options.body.workflowDefinitionIds,
        profile: {
          profileKey: `workspace.agent-${agentDefinitionId.toLowerCase()}`,
          revision: 1,
          surfaceBindings: [],
          manifest: {
            ...defaultAgentWorkspaceProfileV1.manifest,
            allowedToolFamilies: [
              ...new Set([
                ...defaultAgentWorkspaceProfileV1.manifest.allowedToolFamilies,
                ...(defaultAgentWorkspaceProfileV1.manifest.allowedToolFamilies.includes(
                  "workflow",
                )
                  ? ["capability" as const]
                  : []),
              ]),
            ],
            displayName: options.body.displayName.trim(),
            instructions: options.body.instructions.trim(),
            allowedSurfaceKinds: ["agent_workspace"],
          },
        },
        now: options.now,
        audit: {
          auditEventId: stableAgentRuntimeId("agent-create-audit", identity, 1),
          actorPrincipalId: options.authority.principalId,
          actorType: options.authority.principalType,
          authenticationRefType: options.authority.authenticationRefType,
          authenticationRefHash: digestProviderValue(
            options.authority.authenticationRefId,
          ),
          authorityType: options.authority.authorityType,
          authorityId: options.authority.authorityId,
          authorityVersion: options.authority.authorityVersion,
        },
      });
      const created = (
        await this.database.agentHub.listAgents(options.authority, options.now)
      ).find((agent) => agent.id === agentDefinitionId);
      if (!created) {
        throw new DomainError(
          "agent_hub.integrity",
          "The Agent was created but could not be reloaded.",
        );
      }
      return agentRecord(created);
    } catch (error) {
      return mapError(error);
    }
  }

  public async updateAgent(options: {
    readonly authority: TrustedWorkspaceScope;
    readonly agentDefinitionId: string;
    readonly body: UpdateAgentHubAgentBody;
    readonly now: Date;
  }): Promise<AgentHubAgentDetail> {
    try {
      const current = await this.database.agentHub.getAgent(
        options.authority,
        options.agentDefinitionId,
        options.now,
      );
      if (!current) {
        throw new DomainError(
          "agent_hub.not_found",
          "This Agent is unavailable.",
        );
      }
      if (isSystemManagedAgentV1(current)) {
        throw new DomainError(
          "agent_hub.system_managed",
          "The built-in default Agent is managed by the system.",
        );
      }
      if (!canEditAgent(options.authority, current)) {
        throw new DomainError(
          "agent_hub.forbidden",
          "You cannot edit this Agent.",
        );
      }
      await this.database.agentProfilePublications.publish({
        authority: options.authority,
        agentDefinitionId: current.id,
        profileRevisionId: ulid(),
        managementKind: "workspace",
        expectedAgentVersion: options.body.expectedVersion,
        visibility: options.body.visibility,
        presentation: {
          displayName: options.body.displayName.trim(),
          summary: options.body.summary.trim(),

          ...(options.body.avatar ? { avatar: options.body.avatar } : {}),
          ...(options.body.coverAssetId
            ? { coverAssetId: options.body.coverAssetId }
            : {}),
          ...(options.body.category
            ? { category: options.body.category.trim() }
            : {}),
          tags: options.body.tags,
        },
        boundSkillDefinitionIds: options.body.skillDefinitionIds,
        boundBrandKitIds: options.body.brandKitIds,
        boundLibraryIds:
          options.body.libraryIds ??
          current.boundLibraries?.map((library) => library.id) ??
          [],
        boundWorkflowDefinitionIds: options.body.workflowDefinitionIds,
        profile: {
          profileKey: current.profile.profileKey,
          revision: current.profile.revision + 1,
          surfaceBindings: [],
          manifest: {
            ...current.profile.manifest,
            allowedToolFamilies: [
              ...new Set([
                ...current.profile.manifest.allowedToolFamilies,
                ...(current.profile.manifest.allowedToolFamilies.includes(
                  "workflow",
                )
                  ? ["capability" as const]
                  : []),
              ]),
            ],
            displayName: options.body.displayName.trim(),
            instructions: options.body.instructions.trim(),
          },
        },
        now: options.now,
        audit: {
          auditEventId: ulid(),
          actorPrincipalId: options.authority.principalId,
          actorType: options.authority.principalType,
          authenticationRefType: options.authority.authenticationRefType,
          authenticationRefHash: digestProviderValue(
            options.authority.authenticationRefId,
          ),
          authorityType: options.authority.authorityType,
          authorityId: options.authority.authorityId,
          authorityVersion: options.authority.authorityVersion,
        },
      });
      const updated = await this.database.agentHub.getAgent(
        options.authority,
        options.agentDefinitionId,
        options.now,
      );
      if (!updated) {
        throw new DomainError(
          "agent_hub.integrity",
          "The Agent was updated but could not be reloaded.",
        );
      }
      return await agentDetailRecord(
        this.authentication,
        options.authority,
        updated,
      );
    } catch (error) {
      return mapError(error);
    }
  }

  public async setVisibility(options: {
    readonly authority: TrustedWorkspaceScope;
    readonly subjectKind: "agent" | "skill";
    readonly subjectId: string;
    readonly expectedVersion: number;
    readonly visibility: "private" | "workspace";
    readonly now: Date;
  }): Promise<void> {
    try {
      await this.database.agentHub.setVisibility(options);
    } catch (error) {
      return mapError(error);
    }
  }
}
