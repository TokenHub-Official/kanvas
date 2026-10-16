import { validateWorkflowTopology } from "@kanvas/application";
import { isWorkflowTopology } from "@kanvas/contracts/workflow";

import type { PublicationValidationPort } from "./publication-governance-store.js";
import type { WorkflowPublicationDocumentV1 } from "./publication-documents.js";

export function createDefaultPublicationValidationPort(): PublicationValidationPort {
  return Object.freeze({
    validateWorkflow(
      document: WorkflowPublicationDocumentV1,
    ): readonly string[] {
      if (!isWorkflowTopology(document.topology)) {
        return Object.freeze([
          "Workflow topology does not match the versioned Contract.",
        ]);
      }
      return Object.freeze(
        validateWorkflowTopology({
          topology: document.topology,
        }).diagnostics.map(({ code, nodeKey, path }) =>
          [code, nodeKey, path].filter(Boolean).join(":"),
        ),
      );
    },
    validateSkill(): readonly string[] {
      // The strict Skill envelope is parsed before this port. Resource,
      // security, compatibility, and eval authorities are immutable
      // Publication Checks and are re-verified by the publish transaction.
      return Object.freeze([]);
    },
  });
}
