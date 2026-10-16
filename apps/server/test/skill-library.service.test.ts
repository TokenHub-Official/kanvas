import { Readable } from "node:stream";
import { S3CompatibleStorageError } from "@kanvas/storage";

import type { TrustedWorkspaceScope } from "@kanvas/application";
import { parseSkillPublicationDocument } from "@kanvas/database/runtime";
import type { DatabaseRuntime } from "@kanvas/database/runtime";
import { describe, expect, it, vi } from "vitest";

import type { ServerStorageRuntime } from "../src/storage/server-storage-runtime.js";
import {
  SkillLibraryService,
  skillPublicationResource,
} from "../src/skills/skill-library.service.js";
import { buildSkillZip } from "../src/skills/skill-package.js";

const now = new Date("2026-09-04T12:00:00.000Z");
const authority = {
  workspaceId: "01K00000000000000000000001",
  organizationId: "01K00000000000000000000002",
  principalId: "01K00000000000000000000003",
  principalType: "human",
  authenticationRefType: "session",
  authenticationRefId: "skill-detail-test",
  authorityType: "human_membership",
  authorityId: "01K00000000000000000000004",
  authorityVersion: 1,
  authorizationModelVersion: 1,
  effectivePermissions: ["skill.read"],
  trusted: true,
} as const satisfies TrustedWorkspaceScope;

function importArchive(referenceCount = 8): Buffer {
  return buildSkillZip([
    {
      path: "SKILL.md",
      bytes: Buffer.from(
        [
          "---",
          "name: storage-concurrency",
          'description: "Exercise bounded package persistence."',
          "---",
          "",
          "# Storage concurrency",
          "",
          "Read the packaged references.",
          "",
        ].join("\n"),
      ),
    },
    ...Array.from({ length: referenceCount }, (_, index) => ({
      path: `references/${String(index + 1).padStart(2, "0")}.md`,
      bytes: Buffer.from(`Reference ${String(index + 1)}\n`),
    })),
  ]);
}

function importHarness(options: { readonly failIngestCall?: number } = {}) {
  const probeId = "01K00000000000000000000010";
  const failure = new Error("simulated resource persistence failure");
  const allocations = new Map<
    string,
    {
      readonly id: string;
      readonly compatibilityProbeId: string;
      readonly expectedSize: string;
      readonly expectedSha256: string;
      readonly expectedMediaType: string;
    }
  >();
  let activeIngests = 0;
  let maximumActiveIngests = 0;
  let ingestCalls = 0;
  let savedDraftId: string | undefined;
  let savedDocument: Readonly<Record<string, unknown>> | undefined;
  const ensureCompatibilityProbe = vi.fn(() =>
    Promise.resolve({ id: probeId }),
  );
  const allocateUploadSession = vi.fn(
    (input: {
      readonly id: string;
      readonly compatibilityProbeId: string;
      readonly expectedSize: string;
      readonly expectedSha256: string;
      readonly expectedMediaType: string;
    }) => {
      allocations.set(input.id, input);
      return Promise.resolve({ ...input, state: "open" as const });
    },
  );
  const ingest = vi.fn(async () => {
    const call = ++ingestCalls;
    activeIngests += 1;
    maximumActiveIngests = Math.max(maximumActiveIngests, activeIngests);
    await new Promise((resolve) => setTimeout(resolve, 5));
    activeIngests -= 1;
    if (call === options.failIngestCall) throw failure;
    return { state: "verified" as const };
  });
  const saveDraft = vi.fn(
    (input: {
      readonly draftId: string;
      readonly contentDocument: Readonly<Record<string, unknown>>;
    }) => {
      savedDraftId = input.draftId;
      savedDocument = input.contentDocument;
      return Promise.resolve();
    },
  );
  const database = {
    storageUploads: { allocateUploadSession },
    skillPackageImports: {
      createQuarantine: () => Promise.resolve({ version: 1 }),
      recordValidated: () => Promise.resolve({ version: 2 }),
      reject: () => Promise.resolve({ version: 2 }),
      linkDraft: () => Promise.resolve({ version: 3 }),
    },
    publicationGovernance: { saveDraft },
    skillLibrary: {
      commitPackageResource: ({
        uploadSessionId,
        storedObjectId,
      }: {
        uploadSessionId: string;
        storedObjectId: string;
      }) => {
        const allocation = allocations.get(uploadSessionId)!;
        return Promise.resolve({
          storedObjectId,
          byteSize: Number(allocation.expectedSize),
          sha256: allocation.expectedSha256,
          contentDigest: `sha256:${allocation.expectedSha256}`,
          mediaType: allocation.expectedMediaType,
        });
      },
      updatePresentation: () => Promise.resolve(),
      listDrafts: () =>
        Promise.resolve(
          savedDraftId
            ? [
                {
                  id: savedDraftId,
                  skillDefinitionId: savedDraftId,
                  skillKey: "workspace.storage-concurrency",
                  displayName: "Storage concurrency",
                  summary: "Exercise bounded package persistence.",
                  tags: [],
                  exampleRequests: [],
                  visibility: "private",
                  definitionVersion: 1,
                  presentationVersion: 1,
                  draftVersion: 1,
                  canonicalDigest: `sha256:${"a".repeat(64)}`,
                  passedCheckCount: 0,
                  publishedCurrent: false,
                  updatedAt: now,
                },
              ]
            : [],
        ),
    },
  } as unknown as DatabaseRuntime;
  const storage = {
    profileId: "test",
    container: "skills",
    profileConfigurationHash: `sha256:${"b".repeat(64)}`,
    cleanupGraceMilliseconds: 60_000,
    ensureCompatibilityProbe,
    packageUploads: { ingest },
  } as unknown as ServerStorageRuntime;
  return {
    activeIngests: () => activeIngests,
    allocations,
    ensureCompatibilityProbe,
    failure,
    ingest,
    maximumActiveIngests: () => maximumActiveIngests,
    probeId,
    saveDraft,
    savedDocument: () => savedDocument,
    service: new SkillLibraryService(database, storage),
  };
}

describe("Skill Library service", () => {
  it("persists imported Skill resources four at a time with one shared storage probe", async () => {
    const harness = importHarness();
    await expect(
      harness.service.importPackage({
        authority,
        idempotencyKey: "bounded-import",
        bytes: importArchive(),
        now,
      }),
    ).resolves.toMatchObject({
      skillKey: "workspace.storage-concurrency",
    });

    expect(harness.ensureCompatibilityProbe).toHaveBeenCalledTimes(1);
    expect(harness.ingest).toHaveBeenCalledTimes(10);
    expect(harness.maximumActiveIngests()).toBe(4);
    expect(
      new Set(
        [...harness.allocations.values()].map(
          (allocation) => allocation.compatibilityProbeId,
        ),
      ),
    ).toEqual(new Set([harness.probeId]));
    expect(
      (
        harness.savedDocument() as {
          readonly resources: readonly { readonly path: string }[];
        }
      ).resources.map((resource) => resource.path),
    ).toEqual([
      "SKILL.md",
      "references/01.md",
      "references/02.md",
      "references/03.md",
      "references/04.md",
      "references/05.md",
      "references/06.md",
      "references/07.md",
      "references/08.md",
    ]);
  });

  it("drains a failed import persistence batch before stopping without saving a Draft", async () => {
    const harness = importHarness({ failIngestCall: 3 });
    await expect(
      harness.service.importPackage({
        authority,
        idempotencyKey: "failed-bounded-import",
        bytes: importArchive(),
        now,
      }),
    ).rejects.toBe(harness.failure);

    expect(harness.ingest).toHaveBeenCalledTimes(5);
    expect(harness.maximumActiveIngests()).toBe(4);
    expect(harness.activeIngests()).toBe(0);
    expect(harness.saveDraft).not.toHaveBeenCalled();
  });

  it("rejects an image not attached to the authorized Run before accessing storage", async () => {
    const readObject = vi.fn();
    const database = {
      agentRuntime: { listRunMessages: () => Promise.resolve([]) },
      storageUploads: { readAuthorizedCommittedObject: readObject },
    } as unknown as DatabaseRuntime;
    const service = new SkillLibraryService(database);
    await expect(
      service.createDraft({
        authority,
        now,
        idempotencyKey: "foreign-file",
        body: {
          name: "solar",
          displayName: "Solar",
          description: "Solar guidance",
          summary: "Solar guidance",
          instructions: "Use this image",
          visibility: "private",
          tags: [],
          exampleRequests: [],
        },
        agentAttachments: {
          runId: "01K00000000000000000000005",
          files: [
            {
              path: "references/logo.png",
              artifactId: "01K00000000000000000000006",
            },
          ],
        },
      }),
    ).rejects.toMatchObject({ code: "skill_library.attachment_unavailable" });
    expect(readObject).not.toHaveBeenCalled();
  });
  it("stores Unicode logical file paths with ASCII storage keys", async () => {
    const reachedPublication = new Error("publication boundary reached");
    const allocations = new Map<
      string,
      {
        expectedSize: string;
        expectedSha256: string;
        expectedMediaType: string;
      }
    >();
    const keys: string[] = [];
    const database = {
      storageUploads: {
        allocateUploadSession: (input: {
          id: string;
          objectKey: string;
          expectedSize: string;
          expectedSha256: string;
          expectedMediaType: string;
        }) => {
          expect(input.objectKey).toMatch(/^[\x21-\x7e]+$/u);
          keys.push(input.objectKey);
          allocations.set(input.id, input);
          return Promise.resolve({ ...input, state: "committed" });
        },
      },
      skillLibrary: {
        commitPackageResource: ({
          uploadSessionId,
          storedObjectId,
        }: {
          uploadSessionId: string;
          storedObjectId: string;
        }) => {
          const input = allocations.get(uploadSessionId)!;
          return Promise.resolve({
            storedObjectId,
            byteSize: Number(input.expectedSize),
            sha256: input.expectedSha256,
            contentDigest: `sha256:${input.expectedSha256}`,
            mediaType: input.expectedMediaType,
          });
        },
      },
      publicationGovernance: {
        getDraft: () => Promise.resolve(undefined),
        saveDraft: () => Promise.reject(reachedPublication),
      },
    } as unknown as DatabaseRuntime;
    const storage = {
      profileId: "test",
      container: "skills",
      profileConfigurationHash: `sha256:${"a".repeat(64)}`,
      cleanupGraceMilliseconds: 60000,
      ensureCompatibilityProbe: () => Promise.resolve("probe"),
    } as unknown as ServerStorageRuntime;
    const service = new SkillLibraryService(database, storage);
    await expect(
      service.createDraft({
        authority,
        idempotencyKey: "unicode",
        now,
        body: {
          name: "solar",
          displayName: "Solar",
          description: "Solar term poster guidance",
          summary: "Solar term poster guidance",
          instructions: "Read references/白露.md",
          visibility: "private",
          tags: [],
          exampleRequests: [],
          files: [{ path: "references/白露.md", text: "露珠" }],
        },
      }),
    ).rejects.toBe(reachedPublication);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
  });
  it("projects stored resource facts into the exact publication shape", () => {
    const resource = skillPublicationResource({
      storedObjectId: "01K00000000000000000000001",
      sha256: "a".repeat(64),
      contentDigest: `sha256:${"a".repeat(64)}`,
      mediaType: "text/markdown",
      byteSize: 128,
    });

    expect(resource).toEqual({
      storedObjectId: "01K00000000000000000000001",
      contentDigest: `sha256:${"a".repeat(64)}`,
      mediaType: "text/markdown",
      byteSize: 128,
    });
    expect(() =>
      parseSkillPublicationDocument({
        schemaVersion: 1,
        manifest: {},
        resources: [
          { path: "SKILL.md", resourceKind: "instructions", ...resource },
        ],
        workflowEntrypoints: [],
      }),
    ).not.toThrow();
  });

  it("reads the published SKILL.md for the detail view", async () => {
    const definitionId = "01K00000000000000000000005";
    const revisionId = "01K00000000000000000000006";
    const markdown = [
      "---",
      "name: seasonal-poster",
      'description: "Use for internal seasonal posters."',
      "---",
      "",
      "# Workflow",
      "",
      "Create the final poster image.",
      "",
    ].join("\n");
    const database = {
      agentHub: {
        listSkills: () =>
          Promise.resolve([
            {
              id: definitionId,
              skillKey: "workspace.seasonal-poster",
              displayName: "Seasonal poster",
              summary: "Guides seasonal poster creation.",
              tags: ["poster"],
              exampleRequests: ["Create a Qingming poster"],

              ownerPrincipalId: authority.principalId,
              visibility: "workspace",
              version: 1,
              skillRevisionId: revisionId,
              skillRevision: 1,
              runtimeStatus: "enabled",
              activationVersion: 1,
              updatedAt: now,
            },
          ]),
      },
      skillLibrary: {
        readRevisionPackage: () =>
          Promise.resolve({
            skillDefinitionId: definitionId,
            skillKey: "workspace.seasonal-poster",
            displayName: "Seasonal poster",
            summary: "Guides seasonal poster creation.",
            skillRevisionId: revisionId,
            skillRevision: 1,
            packageDigest: `sha256:${"a".repeat(64)}`,
            manifest: {},
            resources: [
              {
                path: "SKILL.md",
                resourceKind: "instructions",
                mediaType: "text/markdown",
                byteSize: Buffer.byteLength(markdown),
                sha256: "a".repeat(64),
                contentDigest: `sha256:${"b".repeat(64)}`,
                storageProfileId: "skill-test",
                container: "skills",
                objectKey: "seasonal/SKILL.md",
                immutableIdentityHash: `sha256:${"c".repeat(64)}`,
              },
            ],
          }),
      },
    } as unknown as DatabaseRuntime;
    const openRead = vi.fn(() =>
      Promise.resolve({ body: Readable.from([Buffer.from(markdown)]) }),
    );
    const storage = {
      profiles: {
        resolve: () => ({
          adapter: {
            openRead,
          },
        }),
      },
    } as unknown as ServerStorageRuntime;

    const service = new SkillLibraryService(database, storage);

    await expect(
      service.getPublishedSkill({
        authority,
        skillDefinitionId: definitionId,
        now,
      }),
    ).resolves.toMatchObject({
      id: definitionId,
      description: "Use for internal seasonal posters.",
      instructions: "# Workflow\n\nCreate the final poster image.",
      resources: [{ path: "SKILL.md", resourceKind: "instructions" }],
    });
    openRead.mockRejectedValueOnce(
      new S3CompatibleStorageError(
        "s3_storage.object_missing",
        "Object is missing.",
      ),
    );
    await expect(
      service.getPublishedSkill({
        authority,
        skillDefinitionId: definitionId,
        now,
      }),
    ).rejects.toMatchObject({ code: "skill_library.integrity" });
  });
  it("reads only a file present in the authorized pinned revision", async () => {
    const file = {
      path: "scripts/check.py",
      mediaType: "text/x-python",
      byteSize: 12,
      sha256: "a".repeat(64),
      storageProfileId: "test",
      container: "skills",
      objectKey: "private/check.py",
      immutableIdentityHash: `sha256:${"b".repeat(64)}`,
    };
    const readRevisionPackage = vi.fn(() =>
      Promise.resolve({ resources: [file] }),
    );
    const openRead = vi.fn(() =>
      Promise.resolve({ body: Readable.from([Buffer.from("print('ok')\n")]) }),
    );
    const database = {
      skillLibrary: { readRevisionPackage },
    } as unknown as DatabaseRuntime;
    const storage = {
      profiles: { resolve: () => ({ adapter: { openRead } }) },
    } as unknown as ServerStorageRuntime;
    const service = new SkillLibraryService(database, storage);
    await expect(
      service.readFile({
        authority,
        skillDefinitionId: "definition",
        skillRevisionId: "revision",
        path: file.path,
        now,
      }),
    ).resolves.toMatchObject({
      bytes: Buffer.from("print('ok')\n"),
      mediaType: file.mediaType,
      filename: "check.py",
    });
    expect(readRevisionPackage).toHaveBeenCalledWith({
      authority,
      skillDefinitionId: "definition",
      skillRevisionId: "revision",
      now,
    });
    await expect(
      service.readFile({
        authority,
        skillDefinitionId: "definition",
        path: "../secret",
        now,
      }),
    ).rejects.toMatchObject({ code: "skill_library.not_found" });
    expect(openRead).toHaveBeenCalledTimes(1);
  });

  it("rejects stale draft reads before accessing file storage", async () => {
    const getDraft = vi.fn();
    const database = {
      skillLibrary: {
        listDrafts: () =>
          Promise.resolve([
            {
              id: "draft",
              draftVersion: 2,
              tags: [],
              exampleRequests: [],
              updatedAt: now,
            },
          ]),
      },
      publicationGovernance: { getDraft },
    } as unknown as DatabaseRuntime;
    const service = new SkillLibraryService(database);
    await expect(
      service.readFile({
        authority,
        draftId: "draft",
        draftVersion: 1,
        path: "references/notes.md",
        now,
      }),
    ).rejects.toMatchObject({ code: "publication.version_conflict" });
    expect(getDraft).not.toHaveBeenCalled();
  });
});
