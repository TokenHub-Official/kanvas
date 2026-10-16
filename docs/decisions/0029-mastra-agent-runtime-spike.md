# ADR-0029：采用隔离的 Mastra Agent Runtime Spike

- 状态：Superseded by [ADR-0030](0030-governed-mastra-agent-runtime.md)
- 日期：2026-08-24
- 前置决策：[ADR-0008](0008-agent-ready-not-agent-first.md)

## 背景

Kanvas 已经具备稳定的 Canvas Command、Capability、Workflow、Artifact、Workspace
授权、预算、Provider 路由和审计边界。当前新的真实调用方是创作协作 Agent：它需要理解
目标、识别缺失信息、推荐已发布制作方案、准备参数、比较结果，并在人工确认后受控调用
现有能力。

继续自研模型 Tool Loop、流式事件、Tool Approval、上下文注入和 Agent Eval 会重复实现成熟
Agent Runtime 已经解决的问题；让外部框架接管 Kanvas Workflow、Capability 或 Provider
事实又会破坏现有治理边界。

## 决策

采用 `@mastra/core` 进行第一阶段 Agent Runtime Spike，并固定以下边界：

1. Mastra `Agent` 负责模型循环、流式事件、动态 Tool、结构化输出和 Agent 级暂停；
2. Mastra `Tool` 只是本次 `ToolView` 的运行时投影，不是 Capability 或 Command 的事实源；
3. Mastra Agent 通过 `AgentModelRuntime` 使用 Kanvas 配置的逻辑 ProviderModel。模型调用
   不创建 CapabilityRun 或 WorkflowRun；生产代码不得直接读取 Workspace Provider Secret；
4. Mastra Tool 的 `execute` 只能进入 Canonical Validation、授权、预算和 Application
   Command，不得直接调用 Provider 或写数据库；
5. Kanvas Workflow 继续表达可发布的视觉生产流程。Mastra Workflow 不替代 WorkflowDraft、
   PublicationCandidate、WorkflowRevision 或 WorkflowRun；
6. MySQL 继续拥有 AgentThread、AgentRun、AgentModelCall / Attempt、AgentActionReceipt 和
   Agent Model Usage 等业务事实。第一阶段不启用 Mastra Memory、Dynamic Workflow 或第二套
   主数据库；
7. Shadow Agent 只输出可审查计划，不执行 Tool；受控执行在独立 Gate 通过后开放；
8. `@mastra/core` 只存在于隔离的 `@kanvas/agent-runtime` Adapter 包，不进入 Domain 或
   Application 层。

## 第一纵向切片

```text
真实 Brief
→ Kanvas 投影候选 Workflow / Tool 摘要
→ Mastra Shadow Agent
→ 结构化计划、缺失信息和成本提示
→ Eval
```

同时实现 Mastra Tool Adapter，证明 Agent-facing JSON Schema 可以直接进入 Mastra，且：

- Tool Key 唯一且有界；
- `workspaceId`、`subjectId`、`credentialId`、权限、费用覆盖和执行目标不进入 Tool Schema；
- 高风险 Tool 不允许缺失审批模式；
- `before-call` 映射为 Mastra Tool Approval；
- `before-commit` 只允许生成预览，最终提交仍由独立受控 Tool 和 Kanvas 授权完成；
- Tool 执行继续进入调用方提供的 Canonical Executor。

第二个切片实现 `KanvasAgentModelPort` 与 Mastra AI SDK Model Adapter：

- Mastra Prompt、结构化输出和函数 Tool 被投影为无 Secret 的 Kanvas Model Request；
- 调用者不能注入 Provider Header、Provider Option、模型 ID 或 Credential；
- Provider 执行型 Tool 和未经过 Artifact 投影的文件输入直接拒绝；
- 非流式 Provider 结果可以投影为统一 Agent Stream，但仍只产生一次受治理模型调用；
- 确定性 Port 夹具验证完整 Shadow Agent 结构化计划链路；
- 生产 Port 尚未接通前，不允许直接使用 Mastra Model Router 作为临时旁路。

模型 Port 的生产实现直接进入独立的 AgentModelCall / Attempt 事实和逻辑 ProviderModel，
不再通过内部单节点 Kanvas Workflow 过桥。Capability 和 Workflow 只在 Agent 调用相应 Tool
时出现；本地 Canvas Command 不产生 CapabilityRun。

`createGovernedAgentModelPort` 负责在远程 I/O 前后写入 ModelCall / Attempt、路由摘要、稳定
失败分类与 Token Usage。它不选择具体 Provider；Provider Model Catalog 的 `text.generate`
证据与显式 Workspace Agent Model Binding 已进入合同和持久化。Binding 管理、Agent 预算预留
和 Secret-scoped Transport 仍是远程调用前的独立 Gate。

Tool-free Shadow Planner 只作为 Adapter、结构化输出、事实持久化和 Eval 的测试夹具。产品
Route 不得使用确定性响应、静态 Candidate 或关键词路由。首页产品切片必须从已发布的动态
SkillView、真实 Provider Binding 与当前 ToolView 生成计划。

## Spike Gate

Mastra 进入正式基线前必须证明：

1. Kanvas JSON Schema 无需复制为 Zod；
2. 每次 Turn 可以从当前权限、预算、数据分类和 Binding 健康动态生成 ToolView；
3. Kanvas Model Adapter 可以复用 Provider Settings、Secret、模型目录和传输能力，同时将
   Agent Model Usage 与 Capability Usage 分开记账；
4. Agent Stream 可以投影为产品状态，而不暴露 Provider、Tool 参数和内部 ID；
5. Tool Approval 不替代执行时重新授权；
6. 不引入第二套业务 Workflow、Capability、Provider 或主数据库事实；
7. 黄金 Brief 在 Workflow 推荐、参数填充、安全建议和无意义澄清指标上达到确认阈值。

任一边界无法在不修改 Kanvas 领域模型的前提下满足，则停止扩大 Mastra 接入，并使用同一
Adapter Contract Spike LangChain / LangGraph。

## 后果

- Agent Runtime 可以复用成熟框架能力，同时保持 Kanvas 领域与执行治理独立；
- 新增一个明确的 Framework Adapter 包和版本升级面；
- Mastra 的 Memory、Storage、Workflow、Model Router 和 Studio 不会因为安装 Core 自动成为
  产品事实；它们需要独立 ADR 和验收 Gate；
- 第一阶段不会提供用户可见的自主执行或多 Agent 功能。
