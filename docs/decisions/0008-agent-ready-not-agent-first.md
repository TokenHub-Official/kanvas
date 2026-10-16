# ADR-0008：V0 采用 Agent-ready 而非 Agent-first

- 状态：Superseded by [ADR-0030](0030-governed-mastra-agent-runtime.md)
- 日期：2026-07-27

> 本 ADR 记录 Agent Runtime 进入产品前的约束。当前采用的治理边界由 ADR-0030 负责；
> Capability、权限、预算与执行仍由 Kanvas 持有的原则继续有效。

## 背景

Agent 的提效依赖稳定、可描述、可评测和可恢复的底层能力。如果 Capability 的参数、错误、重试、Artifact、费用和权限仍不稳定，Agent 的动态决策会放大不可复现、成本失控和排障困难。

但延后 Agent Runtime 不等于延后 Agent 可用性验证。如果 V0 只按人工界面和固定 Workflow 设计 Capability，未来可能发现工具粒度、Schema、描述、错误和恢复方式不适合模型发现与调用。

具体业务场景仍由上层 Workflow 和 Skill Bundle 组合，但项目会维护第一方参考场景作为能力契约和 Agent 评测的验收证据，具体边界见 ADR-0011。

## 决策

- V0 不以 Agent 为核心，不建设通用 Agent Runtime。
- V0 优先建设稳定 Capability、确定性 Workflow、Artifact、异步执行、人工确认、费用、权限和审计。
- V0 由用户显式选择 Workflow 或 Skill、确认参数并执行。
- 平台从 V0 保持 Agent-ready：Capability、Workflow 和编辑器 Command 提供稳定、机器可读且受治理的接口。
- Agent 后续只承担不确定性，包括 Brief 理解、缺失信息识别、Workflow 推荐、计划、参数准备、结果归类和有限修正。
- 确定性执行、状态、权限、审批、额度、计费和审计仍由平台负责。
- 人工、Workflow 和未来 Agent 的实际能力调用复用同一个 Capability 执行通路和 `CapabilityRun` 事实。
- Mastra、LangGraph 和通用 Agent Runtime 不进入 V0 基线。到达真实成熟条件后再进行 Runtime Spike。

## Capability 准入

不再使用单一递进的 `manual-only → workflow-ready → agent-ready` 状态作为授权事实。

Capability 静态声明至少包括：

```yaml
supportedInvokers:
  - user
  - workflow
  - agent
effect: read | compute | internal-write | external-write | destructive
egress: none | approved-provider | restricted-network
idempotency: native | key-supported | none
approvalMode: none | before-call | before-commit
```

Capability 的成熟度、来源、可见性、运行状态和支持调用者是不同维度，不能混入同一生命周期：

- 成熟度：`experimental | stable`。
- 来源：`builtin | internal | third-party`。
- 可见性：由 Organization、Workspace 和安装授权决定。
- 发布建议：`active | deprecated`。
- 运行状态：`enabled | disabled | revoked`。
- 调用者支持：`user | workflow | agent` 的集合。

`deprecated` 表示不建议新建调用但允许历史运行恢复；`revoked` 表示因安全或合规原因禁止继续调用。

每次调用必须经过动态策略决策：

```text
ToolEligibility =
  supportedInvokers
  ∩ Workspace grant
  ∩ User permission
  ∩ Artifact data classification
  ∩ Target and resource constraints
  ∩ Budget
  ∩ Current binding health
  ∩ Approval policy
```

Agent 只能看到本次上下文允许的 `ToolView`：

```text
ToolView =
  CapabilityContract
  + 当前可用 Binding
  + 收窄后的 Agent-facing Schema
  + 当前权限、数据出口和预算约束
```

不能把完整 Capability Registry 暴露给 Agent 后仅依赖 Prompt 约束。领域 Schema 也不直接等同于模型 Tool Schema，应根据不同模型支持的 JSON Schema 子集生成 Agent-facing 投影。

## Capability 契约要求

从 V0 起，每个可自动化调用的 Capability 至少声明：

- 简短、可发现的名称、描述和使用边界。
- 输入输出 Schema、字段语义和示例。
- 前置条件与后置条件。
- 结构化错误码、错误分类和是否可重试。
- 幂等性、超时、取消和异步完成方式。
- 副作用、数据外发和权限要求。
- 成本、延迟、并发和资源估算。
- 哪些输出提交为 Artifact，哪些只是诊断数据。

## V0 Shadow Agent Spike

V0 保留一个不执行任何 Tool 的 Shadow Agent / Eval Harness，只负责：

- 结构化 Brief。
- 识别冲突、缺失信息和需要澄清的约束。
- 推荐 Workflow。
- 填充候选参数。
- 输出可审查的执行计划和成本估算。

使用 30 至 50 个真实 Brief 评估：

- Workflow / Tool Top-1 和 Top-3 选择准确率。
- Schema 参数一次填充成功率。
- 不安全调用建议率。
- 设计师修改距离。
- 无意义澄清问题数量。
- 计划成本估算误差。

Shadow Agent 只验证 Capability 和 Workflow 的 Agent 可用性，不创建通用 Agent Runtime，也不自动执行。

## Runtime Spike 进入条件

- 至少 6 至 10 个具有代表性的稳定 Capability。
- 至少两个第一方参考场景持续用于生产和回归验证。
- 至少一个包含异步任务、有限分支、并行和人工节点的稳定 Workflow。
- Artifact、权限、费用、审计和统一执行事实链路完整。
- Capability 已明确 Schema、错误、取消、重试、幂等、副作用和 Agent-facing 投影。
- Shadow Agent 已建立黄金样例并达到另行确认的准入阈值。

## Agent 分阶段开放

1. Shadow / 建议：结构化 Brief、推荐 Workflow、生成计划和辅助评价，不执行。
2. 受控执行：计划经人工确认后调用低风险、可撤销的 Tool 或 Workflow。
3. 有界自动化：在预算、步骤、时间、重试和动态 Tool Allowlist 内修正。
4. 复杂 Agent：长期记忆、多 Agent、Agent Studio 等仅在明确业务证据出现后评估。

## V0 明确不定义

- `IAgentRuntime` 或 `AgentRuntimeEngine` 预留接口。
- Planner、MemoryProvider、AgentSnapshotStore。
- AgentDefinition Entrypoint。
- MultiAgentCoordinator、动态 Subagent 和长期自治。
- 通用反思、自我修正和长期记忆抽象。

这些接口没有稳定调用方，不作为未来框架的影子模型提前进入领域层。

## 结果

- 第一版集中于能够独立产生价值的专业工具、批处理和生产闭环。
- 不建设 Agent Runtime，也能持续验证 Capability 是否适合未来 Agent。
- Agent 框架不会提前影响领域模型、数据库和部署拓扑。
- 运行时策略比静态 `agent-ready` 标签更复杂，但能显式治理权限、副作用、数据出口和预算。
- Agent 上线速度由 Capability、Workflow 和评测成熟度决定，而不是日历版本。

## 未包含

- Agent Runtime 框架的最终选择。
- Agent 的默认模型和 Provider。
- Shadow Agent 的具体模型与实现库。
- 各评测指标的最终准入阈值。
