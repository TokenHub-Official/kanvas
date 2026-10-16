import { Value } from "@sinclair/typebox/value";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

import {
  AgentInteractionViewSchema,
  AgentRunViewSchema,
  AgentThreadTaskSchema,
  AgentThreadMessageSchema,
  AgentThreadViewSchema,
  ArchiveAgentThreadBodySchema,
  CreateWorkspaceAgentMessageBodySchema,
  RenameAgentThreadBodySchema,
  ResolveAgentInteractionBodySchema,
  RegenerateAgentResponseBodySchema,
  SelectAgentResponseBranchBodySchema,
  archiveWorkspaceAgentThreadRoute,
  cancelAgentRunRoute,
  createWorkspaceAgentMessageRoute,
  confirmAgentActionRoute,
  declineAgentActionRoute,
  getAgentRunRoute,
  getWorkspaceAgentThreadRoute,
  listWorkspaceAgentThreadsRoute,
  renameWorkspaceAgentThreadRoute,
  regenerateWorkspaceAgentResponseRoute,
  resolveAgentInteractionRoute,
  selectWorkspaceAgentResponseBranchRoute,
  routeRegistry,
  streamWorkspaceAgentThreadRoute,
} from "../src/api/index.js";

describe("Workspace Agent contract", () => {
  it("accepts complete model output beyond the user input character limit", () => {
    const text = `${"完整方案内容。".repeat(1500)}END-OF-RESPONSE`;
    const ajv = new Ajv2020({ strict: false });
    const registerFormats = addFormats as unknown as (
      instance: Ajv2020,
    ) => void;
    registerFormats(ajv);
    expect(
      ajv.validate(AgentThreadMessageSchema, {
        id: "01K00000000000000000000001",
        role: "assistant",
        createdAt: "2026-09-20T00:00:00.000Z",
        parts: [
          { type: "text", text },
          { type: "reasoning", text },
        ],
        relatedContent: [],
      }),
    ).toBe(true);
  });

  it("carries only bounded semantic facts for localized built-in tasks", () => {
    const presentations = [
      {
        kind: "skill_images_update",
        resourceName: "Seasonal poster",
        imageCount: 2,
      },
      {
        kind: "skill_create",
        resourceName: "Seasonal poster",
        imageCount: 2,
      },
      { kind: "brand_publish", resourceName: "Kanvas" },
    ];
    for (const presentation of presentations) {
      expect(
        Value.Check(AgentThreadTaskSchema, {
          id: "01K00000000000000000000001",
          kind: "skill",
          lifecycleStatus: "waiting_approval",
          title: "Seasonal poster",
          presentation,
        }),
      ).toBe(true);
    }
    expect(
      Value.Check(AgentThreadTaskSchema, {
        id: "01K00000000000000000000001",
        kind: "skill",
        lifecycleStatus: "waiting_approval",
        title: "Seasonal poster",
        presentation: {
          kind: "skill_create",
          resourceName: "Seasonal poster",
          imageCount: 9,
        },
      }),
    ).toBe(false);
  });

  it("registers message enqueue and bounded Run read routes", () => {
    expect(routeRegistry).toContain(createWorkspaceAgentMessageRoute);
    expect(routeRegistry).toContain(getAgentRunRoute);
    expect(routeRegistry).toContain(cancelAgentRunRoute);
    expect(routeRegistry).toContain(confirmAgentActionRoute);
    expect(routeRegistry).toContain(resolveAgentInteractionRoute);
    expect(routeRegistry).toContain(declineAgentActionRoute);
    expect(routeRegistry).toContain(listWorkspaceAgentThreadsRoute);
    expect(routeRegistry).toContain(getWorkspaceAgentThreadRoute);
    expect(routeRegistry).toContain(streamWorkspaceAgentThreadRoute);
    expect(routeRegistry).toContain(regenerateWorkspaceAgentResponseRoute);
    expect(routeRegistry).toContain(selectWorkspaceAgentResponseBranchRoute);
    expect(routeRegistry).toContain(renameWorkspaceAgentThreadRoute);
    expect(routeRegistry).toContain(archiveWorkspaceAgentThreadRoute);
    expect(createWorkspaceAgentMessageRoute).toMatchObject({
      method: "POST",
      idempotency: "required",
      security: ["sessionOrServiceToken"],
    });
  });

  it("accepts bounded question responses and rejects incomplete transport shapes", () => {
    const ajv = new Ajv2020({ strict: false });
    const registerFormats = addFormats as unknown as (
      instance: Ajv2020,
    ) => unknown;
    registerFormats(ajv);
    expect(
      ajv.validate(AgentInteractionViewSchema, {
        id: "01K00000000000000000000001",
        kind: "question",
        lifecycleStatus: "pending",
        version: 1,
        questions: [
          {
            key: "format",
            header: "Output",
            question: "Which result should be prepared?",
            options: [
              { key: "outline", label: "Outline", recommended: true },
              { key: "draft", label: "Full draft" },
            ],
          },
        ],
        createdAt: "2026-08-24T20:00:00.000Z",
        updatedAt: "2026-08-24T20:00:00.000Z",
      }),
    ).toBe(true);
    expect(
      Value.Check(ResolveAgentInteractionBodySchema, {
        expectedVersion: 1,
        outcome: "submitted",
        answers: [{ questionKey: "format", optionKeys: ["outline"] }],
      }),
    ).toBe(true);
    expect(
      Value.Check(ResolveAgentInteractionBodySchema, {
        expectedVersion: 1,
        outcome: "submitted",
      }),
    ).toBe(false);
    expect(
      Value.Check(ResolveAgentInteractionBodySchema, {
        expectedVersion: 1,
        outcome: "skipped",
        answers: [],
      }),
    ).toBe(false);
  });

  it("requires bounded optimistic Thread mutations", () => {
    expect(
      Value.Check(RenameAgentThreadBodySchema, {
        title: "Autumn campaign",
        expectedVersion: 2,
      }),
    ).toBe(true);
    expect(
      Value.Check(RenameAgentThreadBodySchema, {
        title: "   ",
        expectedVersion: 2,
      }),
    ).toBe(false);
    expect(
      Value.Check(ArchiveAgentThreadBodySchema, { expectedVersion: 2 }),
    ).toBe(true);
    expect(
      Value.Check(RegenerateAgentResponseBodySchema, {
        assistantMessageId: "01K00000000000000000000001",
      }),
    ).toBe(true);
    expect(
      Value.Check(RegenerateAgentResponseBodySchema, {
        agentRunId: "01K00000000000000000000001",
      }),
    ).toBe(true);
    expect(
      Value.Check(RegenerateAgentResponseBodySchema, {
        assistantMessageId: "01K00000000000000000000001",
        agentRunId: "01K00000000000000000000002",
      }),
    ).toBe(false);
    expect(
      Value.Check(SelectAgentResponseBranchBodySchema, {
        assistantMessageId: "01K00000000000000000000001",
        expectedVersion: 2,
      }),
    ).toBe(true);
  });

  it("accepts meaningful messages and rejects whitespace-only input", () => {
    expect(
      Value.Check(CreateWorkspaceAgentMessageBodySchema, {
        message: "Prepare a campaign visual from the current brand.",
        attachments: [
          {
            assetId: "01K00000000000000000000006",
            artifactId: "01K00000000000000000000007",
          },
        ],
        brandContext: {
          brandKitId: "01K00000000000000000000008",
          brandKitRevisionId: "01K00000000000000000000009",
        },
        references: [
          {
            kind: "canvas",
            resourceId: "01K0000000000000000000000A",
            version: 4,
          },
          {
            kind: "workflow",
            resourceId: "01K0000000000000000000000B",
          },
        ],
        skillRevisionId: "01K0000000000000000000000C",
        entryContext: {
          originSurface: "canvas",
          canvasDraftId: "01K00000000000000000000004",
          canvasDraftVersion: 3,
          pageKey: "page-1",
          selectedElementKeys: ["headline"],
          returnTo:
            "/w/01K00000000000000000000001/boards/01K00000000000000000000004",
        },
      }),
    ).toBe(true);
    expect(
      Value.Check(CreateWorkspaceAgentMessageBodySchema, {
        message: "Use this private conversation upload.",
        attachments: [{ artifactId: "01K00000000000000000000007" }],
      }),
    ).toBe(true);
    expect(
      Value.Check(CreateWorkspaceAgentMessageBodySchema, { message: "   " }),
    ).toBe(false);
    const ajv = new Ajv2020({ strict: false });
    const registerFormats = addFormats as unknown as (
      instance: Ajv2020,
    ) => unknown;
    registerFormats(ajv);
    expect(
      ajv.validate(AgentRunViewSchema, {
        threadId: "01K00000000000000000000001",
        runId: "01K00000000000000000000002",
        lifecycleStatus: "running",
        messages: [
          {
            id: "01K00000000000000000000003",
            role: "user",
            parts: [{ type: "text", text: "Prepare a campaign visual." }],
            relatedContent: [],
            createdAt: "2026-08-24T20:00:00.000Z",
          },
        ],
        actions: [],
      }),
    ).toBe(true);
    expect(
      ajv.validate(AgentThreadViewSchema, {
        id: "01K00000000000000000000001",
        title: "Prepare a campaign visual",
        lifecycleStatus: "active",
        version: 2,
        actionConfirmationRequired: false,
        agent: {
          id: "01K0000000000000000000000E",
          displayName: "Example Studio 节气海报 Agent",
        },
        latestRun: {
          id: "01K00000000000000000000002",
          lifecycleStatus: "failed",
          failureKind: "limit",
          updatedAt: "2026-08-24T20:00:02.000Z",
        },
        messages: [
          {
            id: "01K00000000000000000000003",
            role: "assistant",
            parts: [
              {
                type: "reasoning",
                text: "I checked the request and available production path.",
              },
              {
                type: "tool-call",
                toolCallId: "tool-call-1",
                toolName: "prepare_campaign",
              },
              {
                type: "text",
                text: "The production plan is ready for confirmation.",
              },
            ],
            relatedContent: [],
            createdAt: "2026-08-24T20:00:01.000Z",
          },
        ],
        relatedContent: [
          {
            kind: "workflow",
            resourceId: "01K00000000000000000000004",
            title: "Campaign visual",
            state: "available",
          },
          {
            kind: "brand",
            resourceId: "01K00000000000000000000006",
            brandKitRevisionId: "01K00000000000000000000007",
            title: "Campaign Brand",
            state: "available",
          },
        ],
        tasks: [
          {
            id: "01K00000000000000000000005",
            kind: "workflow",
            lifecycleStatus: "waiting_approval",
            title: "Campaign visual",
          },
          {
            id: "01K00000000000000000000008",
            kind: "capability",
            lifecycleStatus: "running",
            title: "Extract palette",
            capabilityContractRevisionId: "01K00000000000000000000009",
            capabilityRunId: "01K0000000000000000000000A",
            browserExecution: {
              requiredCapabilityKeys: ["browser.image.palette.extract"],
            },
          },
        ],
        createdAt: "2026-08-24T20:00:00.000Z",
        updatedAt: "2026-08-24T20:00:02.000Z",
      }),
    ).toBe(true);
  });
});
