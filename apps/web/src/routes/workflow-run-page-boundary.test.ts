import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./workflow-run-page.tsx", import.meta.url),
  "utf8",
);

describe("Workflow result user boundary", () => {
  it("keeps raw node payloads out and presents only selected Workflow output", () => {
    expect(source).not.toContain('t("workflows.runSession.technicalDetails")');
    expect(source).not.toContain("node.error ?? node.output");
    expect(source).toContain("workflowRunDisplayOutputFields(");
    expect(source).toContain("run.data?.output");
    expect(source).toContain("candidateDocument?.outputSchema");
  });

  it("uses the pinned Candidate display when a test Run has no published template", () => {
    expect(source).toContain("fetchWorkflowCandidate");
    expect(source).toContain("candidateDocument?.presentation?.title");
    expect(source).not.toContain("technicalTemplateName");
  });

  it("makes continued editing the primary result action", () => {
    expect(source).toContain('t("workflows.runSession.continueInCanvas")');
    expect(source).toContain("createWorkflowResultDraftV1");
    expect(source).toContain("brandKitRevisionId:");
  });

  it("separates partial outcomes and per-Artifact Asset adoption", () => {
    expect(source).toContain('run.data.outcome === "partial_success"');
    expect(source).toContain("workflowRunAvailableArtifacts");
    expect(source).toContain("assetAdoptions[visibleArtifact.artifactId]");
    expect(source).toContain("prepareWorkflowRunAssetAdoption");
  });

  it("keeps Workflow Approval and browser execution attached to the Run", () => {
    expect(source).toContain("run.data.pendingApprovals?.map");
    expect(source).toContain("decideWorkflowApproval(");
    expect(source).toContain(
      "run.data?.browserExecution?.requiredCapabilityKeys",
    );
    expect(source).toContain("useBrowserRuntimes");
    expect(source).toContain("browser.keepOpenShort");
  });
});
