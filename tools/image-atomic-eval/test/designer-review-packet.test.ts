import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildPacketFileIntegrity,
  verifyDesignerReviewPacket,
} from "../src/designer-review-packet.js";

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "kanvas-review-packet-"));
  const files = {
    "contact-sheet.png": "sheet",
    "analysis/sample.json": JSON.stringify({
      schemaVersion: "kanvas.image-atomic-review-analysis/v1",
      sourceArtifactId: "01K00000000000000000000001",
    }),
    "previews/sample-source.png": "source",
    "previews/sample-denoise.png": "denoise",
    "previews/sample-light.png": "light",
    "previews/sample-compose.png": "compose",
  };
  for (const [path, value] of Object.entries(files)) {
    const target = resolve(root, path);
    await mkdir(resolve(target, ".."), {
      recursive: true,
    });
    await writeFile(target, value);
  }
  const packetFiles = await buildPacketFileIntegrity(root, Object.keys(files));
  await writeFile(
    resolve(root, "manifest.json"),
    `${JSON.stringify(
      {
        schemaVersion: "kanvas.image-atomic-designer-review-packet/v1",
        evidenceClass: "designer_review_pending",
        generatedAt: "2026-08-04T00:00:00.000Z",
        workspaceId: "01K00000000000000000000000",
        dataClassification: "internal",
        sourceCount: 1,
        capabilities: [
          "image.denoise",
          "image.light.enhance",
          "image.crop.suggest",
          "image.palette.extract",
          "image.quality.assess",
          "image.background.compose",
        ],
        missingCandidateCapabilities: {},
        contactSheet: "contact-sheet.png",
        packetFiles,
        sources: [
          {
            id: "sample",
            artifactId: "01K00000000000000000000001",
            sourceDigest: sha256("source"),
            analysisFile: "analysis/sample.json",
            previews: {
              source: "previews/sample-source.png",
              denoise: "previews/sample-denoise.png",
              light: "previews/sample-light.png",
              compose: "previews/sample-compose.png",
            },
          },
        ],
        approval: {
          reviewer: null,
          reviewedAt: null,
          manifestDigest: null,
          acceptedCapabilities: [],
          rejectedCapabilities: [],
          acceptedLimitations: [],
          thresholdChanges: [],
        },
      },
      null,
      2,
    )}\n`,
  );
  return root;
}

describe("designer review packet verifier", () => {
  it("verifies the closed generated-file inventory", async () => {
    const root = await fixture();

    await expect(verifyDesignerReviewPacket(root)).resolves.toMatchObject({
      evidenceClass: "designer_review_pending",
      sourceCount: 1,
      fileCount: 6,
    });
  });

  it("rejects a changed evidence file", async () => {
    const root = await fixture();
    await writeFile(resolve(root, "previews/sample-denoise.png"), "changed");

    await expect(verifyDesignerReviewPacket(root)).rejects.toThrow(
      "failed digest verification",
    );
  });

  it("rejects an untracked packet file", async () => {
    const root = await fixture();
    await writeFile(resolve(root, "untracked.txt"), "not evidence");

    await expect(verifyDesignerReviewPacket(root)).rejects.toThrow(
      "missing or untracked files",
    );
  });
});
