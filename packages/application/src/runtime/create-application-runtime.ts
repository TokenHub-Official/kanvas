import type { Clock } from "../foundation/clock.js";
import {
  createRuntimeFenceGuard,
  type RuntimeFenceGuard,
  type RuntimeStateReader,
} from "../foundation/runtime-fence.js";
import {
  createCancelWorkflowRun,
  createDecideWorkflowApproval,
  type CancelWorkflowRun,
  type CancelWorkflowRunDependencies,
  createCreateWorkflowRun,
  createCreateWorkflowCandidateTestRun,
  type CreateWorkflowRun,
  type CreateWorkflowCandidateTestRun,
  type CreateWorkflowRunDependencies,
  type DecideWorkflowApproval,
  type WorkflowApprovalDecisionPort,
  type WorkflowApprovalQueryRepository,
  createGetWorkflowRun,
  createListWorkflowRuns,
  type GetWorkflowRun,
  type ListWorkflowRuns,
  type WorkflowRunQueryRepository,
  createValidateWorkflowTopology,
  type ValidateWorkflowTopology,
} from "../modules/workflow/index.js";
import { DomainError } from "../foundation/domain-error.js";
import {
  createWorkflowAuthoring,
  type WorkflowAuthoring,
  type WorkflowAuthoringRepository,
} from "../modules/workflow-authoring/index.js";
import {
  createWorkflowPublication,
  type WorkflowPublication,
  type WorkflowPublicationPort,
} from "../modules/workflow-publication/index.js";
import {
  createWorkflowCatalog,
  type WorkflowCatalog,
  type WorkflowCatalogRepository,
} from "../modules/workflow-catalog/index.js";
import {
  createWorkspaceBrand,
  type WorkspaceBrand,
  type WorkspaceBrandRepository,
} from "../modules/brand/index.js";

export interface ApplicationRuntimeDependencies {
  readonly clock: Clock;
  readonly runtimeStateReader: RuntimeStateReader;
  readonly workflowExecution?: Omit<
    CreateWorkflowRunDependencies,
    "clock" | "runtimeStateReader"
  > &
    Pick<
      CancelWorkflowRunDependencies,
      "cancellations" | "cancellationGraceMs"
    >;
  readonly workflowRunQueries?: WorkflowRunQueryRepository;
  readonly workflowApprovals?: {
    readonly queries: WorkflowApprovalQueryRepository;
    readonly decisions: WorkflowApprovalDecisionPort;
  };
  readonly workflowAuthoring?: {
    readonly repository: WorkflowAuthoringRepository;
    readonly nextId: () => string;
  };
  readonly workflowPublication?: {
    readonly port: WorkflowPublicationPort;
    readonly nextId: () => string;
  };
  readonly workflowCatalog?: WorkflowCatalogRepository;
  readonly workspaceBrand?: {
    readonly repository: WorkspaceBrandRepository;
    readonly nextId: () => string;
  };
}

export interface ApplicationRuntime {
  readonly workflow: {
    readonly validateTopology: ValidateWorkflowTopology;
    readonly createRun: CreateWorkflowRun;
    readonly cancelRun: CancelWorkflowRun;
    readonly getRun: GetWorkflowRun;
    readonly listRuns: ListWorkflowRuns;
    readonly createCandidateTestRun: CreateWorkflowCandidateTestRun;
    readonly decideApproval: DecideWorkflowApproval;
  };
  readonly workflowAuthoring: WorkflowAuthoring;
  readonly workflowPublication: WorkflowPublication;
  readonly workflowCatalog: WorkflowCatalog;
  readonly workspaceBrand: WorkspaceBrand;
  readonly runtimeFence: RuntimeFenceGuard;
}

export function createApplicationRuntime(
  dependencies: ApplicationRuntimeDependencies,
): ApplicationRuntime {
  const brandNotConfigured = () =>
    Promise.reject(
      new DomainError(
        "brand.not_configured",
        "Workspace Brand persistence is not configured in this process.",
      ),
    );
  const workspaceBrand: WorkspaceBrand = dependencies.workspaceBrand
    ? createWorkspaceBrand({
        repository: dependencies.workspaceBrand.repository,
        nextId: dependencies.workspaceBrand.nextId,
        now: () => dependencies.clock.now(),
      })
    : Object.freeze({
        list: brandNotConfigured,
        getDraft: brandNotConfigured,
        getRevision: brandNotConfigured,
        listRevisions: brandNotConfigured,
        getDefaultRevision: brandNotConfigured,
        create: brandNotConfigured,
        updateDraft: brandNotConfigured,
        publish: brandNotConfigured,
        setDefault: brandNotConfigured,
      });
  const workflowAuthoring: WorkflowAuthoring = dependencies.workflowAuthoring
    ? createWorkflowAuthoring({
        repository: dependencies.workflowAuthoring.repository,
        nextId: dependencies.workflowAuthoring.nextId,
        now: () => dependencies.clock.now(),
      })
    : Object.freeze({
        listCapabilities: () =>
          Promise.reject(
            new DomainError(
              "workflow_authoring.not_configured",
              "Workflow authoring persistence is not configured in this process.",
            ),
          ),
        list: () =>
          Promise.reject(
            new DomainError(
              "workflow_authoring.not_configured",
              "Workflow authoring persistence is not configured in this process.",
            ),
          ),
        get: () =>
          Promise.reject(
            new DomainError(
              "workflow_authoring.not_configured",
              "Workflow authoring persistence is not configured in this process.",
            ),
          ),
        create: () =>
          Promise.reject(
            new DomainError(
              "workflow_authoring.not_configured",
              "Workflow authoring persistence is not configured in this process.",
            ),
          ),
        update: () =>
          Promise.reject(
            new DomainError(
              "workflow_authoring.not_configured",
              "Workflow authoring persistence is not configured in this process.",
            ),
          ),
        archive: () =>
          Promise.reject(
            new DomainError(
              "workflow_authoring.not_configured",
              "Workflow authoring persistence is not configured in this process.",
            ),
          ),
      });
  const workflowPublication: WorkflowPublication =
    dependencies.workflowPublication
      ? createWorkflowPublication({
          port: dependencies.workflowPublication.port,
          nextId: dependencies.workflowPublication.nextId,
          now: () => dependencies.clock.now(),
        })
      : Object.freeze({
          list: () =>
            Promise.reject(
              new DomainError(
                "workflow_publication.not_configured",
                "Workflow publication persistence is not configured in this process.",
              ),
            ),
          get: () =>
            Promise.reject(
              new DomainError(
                "workflow_publication.not_configured",
                "Workflow publication persistence is not configured in this process.",
              ),
            ),
          submit: () =>
            Promise.reject(
              new DomainError(
                "workflow_publication.not_configured",
                "Workflow publication persistence is not configured in this process.",
              ),
            ),
          recordEval: () =>
            Promise.reject(
              new DomainError(
                "workflow_publication.not_configured",
                "Workflow publication persistence is not configured in this process.",
              ),
            ),
          review: () =>
            Promise.reject(
              new DomainError(
                "workflow_publication.not_configured",
                "Workflow publication persistence is not configured in this process.",
              ),
            ),
          publish: () =>
            Promise.reject(
              new DomainError(
                "workflow_publication.not_configured",
                "Workflow publication persistence is not configured in this process.",
              ),
            ),
        });
  const workflowCatalog: WorkflowCatalog = dependencies.workflowCatalog
    ? createWorkflowCatalog({
        repository: dependencies.workflowCatalog,
        now: () => dependencies.clock.now(),
      })
    : Object.freeze({
        list: () =>
          Promise.reject(
            new DomainError(
              "workflow_catalog.not_configured",
              "Workflow catalog persistence is not configured in this process.",
            ),
          ),
        get: () =>
          Promise.reject(
            new DomainError(
              "workflow_catalog.not_configured",
              "Workflow catalog persistence is not configured in this process.",
            ),
          ),
      });
  const createRun: CreateWorkflowRun = dependencies.workflowExecution
    ? createCreateWorkflowRun({
        clock: dependencies.clock,
        runtimeStateReader: dependencies.runtimeStateReader,
        ...dependencies.workflowExecution,
      })
    : () =>
        Promise.reject(
          new DomainError(
            "workflow_execution.not_configured",
            "Workflow execution persistence is not configured in this process.",
          ),
        );
  const createCandidateTestRun: CreateWorkflowCandidateTestRun =
    dependencies.workflowExecution
      ? createCreateWorkflowCandidateTestRun({
          clock: dependencies.clock,
          runtimeStateReader: dependencies.runtimeStateReader,
          ...dependencies.workflowExecution,
        })
      : () =>
          Promise.reject(
            new DomainError(
              "workflow_execution.not_configured",
              "Workflow execution persistence is not configured in this process.",
            ),
          );
  const getRun: GetWorkflowRun = dependencies.workflowRunQueries
    ? createGetWorkflowRun(dependencies.workflowRunQueries)
    : () =>
        Promise.reject(
          new DomainError(
            "workflow_query.not_configured",
            "Workflow query persistence is not configured in this process.",
          ),
        );
  const listRuns: ListWorkflowRuns = dependencies.workflowRunQueries
    ? createListWorkflowRuns(dependencies.workflowRunQueries)
    : () =>
        Promise.reject(
          new DomainError(
            "workflow_query.not_configured",
            "Workflow query persistence is not configured in this process.",
          ),
        );
  const cancelRun: CancelWorkflowRun = dependencies.workflowExecution
    ? createCancelWorkflowRun({
        clock: dependencies.clock,
        runtimeStateReader: dependencies.runtimeStateReader,
        ids: dependencies.workflowExecution.ids,
        transactionManager: dependencies.workflowExecution.transactionManager,
        cancellations: dependencies.workflowExecution.cancellations,
        cancellationGraceMs: dependencies.workflowExecution.cancellationGraceMs,
      })
    : () =>
        Promise.reject(
          new DomainError(
            "workflow_execution.not_configured",
            "Workflow execution persistence is not configured in this process.",
          ),
        );
  const decideApproval: DecideWorkflowApproval =
    dependencies.workflowExecution && dependencies.workflowApprovals
      ? createDecideWorkflowApproval({
          clock: dependencies.clock,
          runtimeStateReader: dependencies.runtimeStateReader,
          ids: dependencies.workflowExecution.ids,
          digest: dependencies.workflowExecution.digest,
          queries: dependencies.workflowApprovals.queries,
          decisions: dependencies.workflowApprovals.decisions,
        })
      : () =>
          Promise.reject(
            new DomainError(
              "workflow_approval.not_configured",
              "Workflow approval decisions are not configured in this process.",
            ),
          );

  return Object.freeze({
    workflow: Object.freeze({
      validateTopology: createValidateWorkflowTopology(),
      createRun,
      createCandidateTestRun,
      decideApproval,
      cancelRun,
      getRun,
      listRuns,
    }),
    workflowAuthoring,
    workflowPublication,
    workflowCatalog,
    workspaceBrand,
    runtimeFence: createRuntimeFenceGuard(
      dependencies.runtimeStateReader,
      dependencies.clock,
    ),
  });
}
