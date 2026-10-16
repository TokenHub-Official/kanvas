// Internal deployment overlays are preserved locally but never enter a public baseline.
export const privatePaths = new Set([
  "eval-data/image-atomic-designer-review-v1/source-selection.json",
  ".gitlab-ci.yml",
  "Dockerfile.test",
  "deploy/BUILD-CACHE.md",
  "deploy/GITLAB-TEST-ENVIRONMENT.md",
  "deploy/OPERATIONS-STANDALONE.md",
  "deploy/TEST-HANDOFF.md",
  "deploy/STANDALONE-VALIDATION.md",
]);
export function isPublicPath(path) {
  return (
    !privatePaths.has(path) &&
    !/(^|\/)(?:\.git|\.tmp|\.codex|\.agents|node_modules|dist|coverage|output|artifacts)(?:\/|$)/u.test(
      path,
    ) &&
    !/^(?:docs\/(?:evidence|ui-rework)\/|docs\/DUOMAI-)/u.test(path) &&
    !/(?:^|\/)\.env(?:\..*)?$/u.test(
      path.replace(/\.env\.example$/u, "example"),
    ) &&
    !/\.(?:pem|key|p12|ses)$/u.test(path)
  );
}
