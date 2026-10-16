import assert from "node:assert/strict";
import { test } from "node:test";
import { isPublicPath } from "./public-files.mjs";

test("public exports exclude credentials, history and private overlays", () => {
  for (const path of [
    ".git/config",
    "eval-data/image-atomic-designer-review-v1/source-selection.json",
    ".gitlab-ci.yml",
    "Dockerfile.test",
    "apps/server/.env.local",
    ".env",
    "deploy/secrets/key.pem",
    "output/a.png",
    "docs/evidence/request.json",
    ".tmp/a",
    "apps/worker/:memory:.ses",
  ]) {
    assert.equal(isPublicPath(path), false, path);
  }
});
test("public exports retain examples and portable deployment sources", () => {
  for (const path of [
    ".env.example",
    "apps/server/.env.example",
    "deploy/split.env.example",
    "Dockerfile",
    "deploy/compose.yaml",
    ".github/workflows/ci.yml",
    "LICENSE",
  ]) {
    assert.equal(isPublicPath(path), true, path);
  }
});
