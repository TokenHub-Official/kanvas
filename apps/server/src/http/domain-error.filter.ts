import {
  Catch,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import { DomainError } from "@kanvas/application";
import type { FastifyReply } from "fastify";

function statusFor(error: DomainError): number {
  if (error.code.startsWith("resource_library.")) {
    if (error.code.endsWith("not_found")) return 404;
    if (error.code.endsWith("integrity")) return 409;
    if (
      [
        "resource_library.version_conflict",
        "resource_library.request_conflict",
        "resource_library.archived",
        "resource_library.unavailable",
        "resource_library.reference_unavailable",
      ].includes(error.code)
    )
      return 409;
    return 400;
  }
  if (error.code === "agent_profile_publication.library_unavailable")
    return 409;
  if (error.code === "result_recovery.not_found") return 404;
  if (error.code === "result_recovery.conflict") return 409;
  if (error.code === "result_recovery.unavailable") return 409;
  if (error.code === "runtime_configuration.unavailable") return 503;
  if (error.code.startsWith("resource_lifecycle.")) {
    if (error.code.endsWith("not_found")) return 404;
    if (error.code.endsWith("forbidden")) return 403;
    return 409;
  }
  if (
    error.code === "workflow_run.idempotency_conflict" ||
    error.code === "workflow_run.route_unavailable" ||
    error.code === "workflow_run.already_terminal" ||
    error.code === "workflow_run.cancel_conflict" ||
    error.code === "workflow_approval.already_decided" ||
    error.code === "workflow_approval.cancelled" ||
    error.code === "workflow_approval.expired" ||
    error.code === "workflow_approval.run_terminal" ||
    error.code === "workflow_authoring.idempotency_conflict" ||
    error.code === "workflow_authoring.version_conflict" ||
    error.code === "workflow_authoring.state_conflict" ||
    error.code === "brand.idempotency_conflict" ||
    error.code === "brand.version_conflict" ||
    error.code === "brand.invalid_state" ||
    error.code === "brand.publication_blocked" ||
    error.code === "brand.publication_required" ||
    error.code === "brand.no_changes" ||
    error.code === "brand.logo_unavailable" ||
    error.code === "publication.identity_conflict" ||
    error.code === "publication.version_conflict" ||
    error.code === "publication.lifecycle_conflict" ||
    error.code === "publication.checks_incomplete" ||
    error.code === "publication.review_required" ||
    error.code === "agent.state_conflict" ||
    error.code === "agent.retry_requires_task_recovery" ||
    error.code === "agent.model_not_configured" ||
    error.code === "agent.identity_conflict"
  ) {
    return 409;
  }
  if (
    error.code === "skill_library.not_found" ||
    error.code === "workflow_revision.not_found" ||
    error.code === "workflow_authoring.not_found" ||
    error.code === "workflow_candidate.not_found" ||
    error.code === "workflow_publication.not_found" ||
    error.code === "workflow_template.not_found" ||
    error.code === "brand.not_found" ||
    error.code === "brand.revision_not_found" ||
    error.code === "brand.default_not_found" ||
    error.code === "publication.not_found" ||
    error.code === "workflow_run.not_found" ||
    error.code === "workflow_approval.not_found" ||
    error.code === "agent.interaction_not_found"
  ) {
    return 404;
  }
  if (
    error.code === "workflow_publication.forbidden" ||
    error.code === "workflow_approval.forbidden"
  ) {
    return 403;
  }
  if (
    error.code === "capability_binding.not_found" ||
    error.code === "workflow_revision.invoke_capability_missing"
  ) {
    return 409;
  }
  if (
    error.code === "skill_library.storage_unavailable" ||
    error.code === "workflow_execution.not_configured" ||
    error.code === "workflow_authoring.not_configured" ||
    error.code === "workflow_publication.not_configured" ||
    error.code === "workflow_catalog.not_configured" ||
    error.code === "brand.not_configured" ||
    error.code === "workflow_query.not_configured" ||
    error.code === "workflow_approval.not_configured" ||
    error.code === "workflow_run.runtime_not_active" ||
    error.code === "workflow_run.runtime_not_cancellable"
  ) {
    return 503;
  }
  return 400;
}

@Catch(DomainError)
export class DomainErrorFilter implements ExceptionFilter<DomainError> {
  public catch(exception: DomainError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<FastifyReply>();
    const status = statusFor(exception);
    response.status(status).send({
      type: `https://kanvas.invalid/problems/${exception.code.replaceAll(".", "-")}`,
      title: "Kanvas command was rejected",
      status,
      code: exception.code,
      detail: exception.message,
    });
  }
}
