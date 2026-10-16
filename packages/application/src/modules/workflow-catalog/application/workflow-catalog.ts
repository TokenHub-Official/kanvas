import type {
  EffectiveInvocationSchema,
  WorkflowPresentation,
} from "@kanvas/contracts/api";
import type { WorkflowTopology } from "@kanvas/contracts/workflow";

import { DomainError } from "../../../foundation/domain-error.js";
import type { TrustedWorkspaceScope } from "../../authorization/index.js";

export interface WorkflowTemplate {
  readonly workflowDefinitionId: string;
  readonly workflowRevisionId: string;
  readonly workflowKey: string;
  readonly revision: number;
  readonly displayName: string;
  readonly description?: string;
  readonly category?: string;
  readonly canonicalDigest: string;
  readonly runtimeStatus: "enabled" | "disabled" | "revoked";
  readonly topology: WorkflowTopology;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema: Readonly<Record<string, unknown>>;
  readonly effectiveInvocationSchema?: EffectiveInvocationSchema;
  readonly presentation?: WorkflowPresentation;
  readonly publishedAt: Date;
}

export interface WorkflowCatalogRepository {
  list(
    authority: TrustedWorkspaceScope,
    now: Date,
  ): Promise<readonly WorkflowTemplate[]>;
  get(
    authority: TrustedWorkspaceScope,
    workflowRevisionId: string,
    now: Date,
  ): Promise<WorkflowTemplate | undefined>;
}

export interface WorkflowCatalog {
  list(
    authority: TrustedWorkspaceScope,
    filters?: {
      readonly query?: string;
      readonly category?: string;
      readonly includeUnavailable?: boolean;
    },
  ): Promise<readonly WorkflowTemplate[]>;
  get(
    authority: TrustedWorkspaceScope,
    workflowRevisionId: string,
  ): Promise<WorkflowTemplate>;
}

export function createWorkflowCatalog(dependencies: {
  readonly repository: WorkflowCatalogRepository;
  readonly now: () => Date;
}): WorkflowCatalog {
  const catalog: WorkflowCatalog = {
    async list(authority, filters) {
      const items = await dependencies.repository.list(
        authority,
        dependencies.now(),
      );
      const query = filters?.query?.trim().toLocaleLowerCase();
      return items.filter((item) => {
        const title = item.presentation?.title ?? item.displayName;
        const description = item.presentation?.description ?? item.description;
        const category = item.presentation?.category ?? item.category;
        return (
          (filters?.includeUnavailable || item.runtimeStatus === "enabled") &&
          (!filters?.category || category === filters.category) &&
          (!query ||
            title.toLocaleLowerCase().includes(query) ||
            description?.toLocaleLowerCase().includes(query) ||
            item.presentation?.tags.some((tag) =>
              tag.toLocaleLowerCase().includes(query),
            ))
        );
      });
    },
    async get(authority, workflowRevisionId) {
      const item = await dependencies.repository.get(
        authority,
        workflowRevisionId,
        dependencies.now(),
      );
      if (!item) {
        throw new DomainError(
          "workflow_template.not_found",
          "Published Workflow template was not found.",
        );
      }
      return item;
    },
  };
  return Object.freeze(catalog);
}
