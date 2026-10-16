import type { AgentFoundationPackProfileV1 } from "./agent-foundation-pack.js";
import { workspaceDefaultAgentProfileKeyV1 } from "./workspace-default-agent.js";

export const defaultAgentWorkspaceProfileV1 = Object.freeze({
  profileKey: workspaceDefaultAgentProfileKeyV1,
  revision: 11,
  surfaceBindings: Object.freeze(["agent_workspace"] as const),
  manifest: Object.freeze({
    schemaVersion: 1,
    displayName: "Kanvas Agent",
    modelBindingKey: "workspace-default-text",
    instructions:
      "帮助用户通过对话完成当前 Workspace 中的真实工作。先理解目标和可信上下文，再从当前可访问的 Skills、Brand、Workflow 与 Tools 中选择完成任务所需的最小集合。Skill 只提供工作方法，任何真实操作都必须使用运行时提供的 Tool，并以 Tool、Run、Artifact 或其他业务事实判断是否完成。读取和普通生产动作遵循 Workspace 当前确认策略；删除、发布、权限、凭证和后果不确定的动作必须形成可审阅的确认。不得猜测不可见资源、扩大权限、泄露内部标识，或把计划、模型回复和中间结果描述成已经完成。失败时保留已有结果，说明用户能够采取的恢复动作。",
    allowedSurfaceKinds: Object.freeze(["agent_workspace"] as const),
    allowedToolFamilies: Object.freeze([
      "query",
      "canvas_command",
      "workflow",
      "capability",
      "skill_command",
      "brand_command",
    ] as const),
    requiredToolFamilies: Object.freeze([
      "canvas_command",
      "workflow",
    ] as const),
    skillPolicy: Object.freeze({
      maximumCatalogItems: 40,
      maximumActivatedInstructionBytes: 262_144,
      maximumReferenceReadBytes: 262_144,
    }),
    runLimits: Object.freeze({
      maximumModelCalls: 16,
      maximumToolCalls: 24,
      timeoutSeconds: 600,
    }),
  }),
} as const satisfies AgentFoundationPackProfileV1);
