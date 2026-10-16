import { describe, expect, it } from "vitest";

import {
  parseSkillPublicationDocument,
  parseWorkflowPublicationDocument,
  PublicationDocumentError,
  skillPackageDigest,
} from "../src/runtime/publication-documents.js";

const id = (suffix: string): string =>
  `01J${"0".repeat(23 - suffix.length)}${suffix}`;
const digest = (character: string): string => `sha256:${character.repeat(64)}`;

function skillDocument() {
  return {
    schemaVersion: 1,
    manifest: {
      key: "product-foundation",
      compatibility: ">=0.1.0",
    },
    resources: [
      {
        path: "SKILL.md",
        resourceKind: "instructions",
        storedObjectId: id("1"),
        contentDigest: digest("a"),
        mediaType: "text/markdown",
        byteSize: 128,
      },
    ],
    workflowEntrypoints: [
      {
        entrypointKey: "default",
        workflowRevisionId: id("2"),
      },
    ],
  };
}

describe("publication documents", () => {
  it("strictly parses the Workflow publication envelope", () => {
    expect(
      parseWorkflowPublicationDocument({
        schemaVersion: 1,
        topology: {},
        inputSchema: {},
        outputSchema: {},
      }),
    ).toEqual({
      schemaVersion: 1,
      topology: {},
      inputSchema: {},
      outputSchema: {},
    });

    expect(() =>
      parseWorkflowPublicationDocument({
        schemaVersion: 1,
        topology: {},
        inputSchema: {},
        outputSchema: {},
        executable: "javascript",
      }),
    ).toThrow(PublicationDocumentError);
  });

  it("parses versioned Workflow presentation without workflow-specific layout fields", () => {
    const document = parseWorkflowPublicationDocument({
      schemaVersion: 1,
      topology: {},
      inputSchema: {},
      outputSchema: {},
      presentation: {
        schemaVersion: 1,
        title: "商品海报",
        description: "根据商品素材生成广告海报。",
        category: "海报制作",
        tags: ["商品", "广告"],
        cover: { artifactId: id("7"), alt: "红色商品海报示例" },
        inputUi: {
          schemaVersion: 1,
          fields: [{ key: "legacy", placeholder: "旧配置" }],
        },
        availability: {
          standalone: true,
          canvas: true,
          directLink: true,
        },
      },
    });
    expect(document.presentation).toMatchObject({
      title: "商品海报",
      tags: ["商品", "广告"],
      availability: { canvas: true },
    });
    expect(document.presentation).not.toHaveProperty("inputUi");
  });

  it("rejects duplicate presentation tags and unknown display fields", () => {
    const presentation = {
      schemaVersion: 1,
      title: "商品海报",
      description: "根据商品素材生成广告海报。",
      tags: ["商品", "商品"],
      availability: {
        standalone: true,
        canvas: true,
        directLink: true,
      },
    };
    expect(() =>
      parseWorkflowPublicationDocument({
        schemaVersion: 1,
        topology: {},
        inputSchema: {},
        outputSchema: {},
        presentation,
      }),
    ).toThrow(/tags must be unique/u);
    expect(() =>
      parseWorkflowPublicationDocument({
        schemaVersion: 1,
        topology: {},
        inputSchema: {},
        outputSchema: {},
        presentation: { ...presentation, tags: [], heroLayout: "poster" },
      }),
    ).toThrow(PublicationDocumentError);
  });

  it("rejects normalized path collisions in Skill resources", () => {
    const document = skillDocument();

    expect(() =>
      parseSkillPublicationDocument({
        ...document,
        resources: [
          ...document.resources,
          {
            ...document.resources[0],
            path: "skill.md",
            storedObjectId: id("3"),
          },
        ],
      }),
    ).toThrow(/path collision/u);
  });

  it("derives the package digest without mutable object identities", () => {
    const first = parseSkillPublicationDocument(skillDocument());
    const second = parseSkillPublicationDocument({
      ...skillDocument(),
      resources: [
        {
          ...skillDocument().resources[0],
          storedObjectId: id("9"),
        },
      ],
    });

    expect(skillPackageDigest(first)).toBe(skillPackageDigest(second));
    expect(skillPackageDigest(first)).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it("rejects unsafe paths and unknown manifest-envelope fields", () => {
    expect(() =>
      parseSkillPublicationDocument({
        ...skillDocument(),
        resources: [
          {
            ...skillDocument().resources[0],
            path: "../SKILL.md",
          },
        ],
      }),
    ).toThrow(PublicationDocumentError);
    expect(() =>
      parseSkillPublicationDocument({
        ...skillDocument(),
        installScript: "bootstrap.sh",
      }),
    ).toThrow(PublicationDocumentError);
  });
});
