import { httpStatus } from "../api/http-status.js";
import { ApiProblem } from "../api/transport.js";

/** Keep server diagnostics out of UI while preserving a concrete recovery action. */
export function skillErrorKey(error: unknown): string {
  if (!(error instanceof ApiProblem)) return "agent.skillErrors.connection";
  if (error.status === httpStatus.unauthorized)
    return "agent.skillErrors.session";
  if (error.status === httpStatus.forbidden)
    return "agent.skillErrors.permission";
  if (error.status === httpStatus.conflict) return "agent.skillErrors.conflict";
  if (error.status === httpStatus.payloadTooLarge)
    return "agent.skillErrors.limit";
  const keys: Record<string, string> = {
    "skill_archive.encoding_invalid": "encoding",
    "skill_archive.path_rejected": "path",
    "skill_archive.invalid_zip": "zip",
    "skill_archive.entry_rejected": "entry",
    "skill_archive.content_rejected": "content",
    "skill_archive.limit_exceeded": "limit",
    "skill_archive.required_file_missing": "missing",
    "skill_archive.multiple_skills": "multiple",
    "skill_library.invalid_package": "instructions",
    "skill_package.invalid": "instructions",
    "skill_import.invalid_argument": "unavailable",
    "skill_import.integrity_violation": "missingContent",
    "skill_import.identity_conflict": "conflict",
    "skill_library.integrity": "missingContent",
    "publication.checks_incomplete": "checks",
  };
  if (keys[error.code]) return `agent.skillErrors.${keys[error.code]}`;
  if (/storage|stored_object|upload/u.test(error.code))
    return "agent.skillErrors.storage";
  if (error.status === httpStatus.notFound) return "agent.skillErrors.notFound";
  return "agent.skillErrors.unavailable";
}
