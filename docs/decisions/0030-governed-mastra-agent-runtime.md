# ADR-0030：采用 Kanvas 治理的 Mastra Agent Runtime

- 状态：Accepted
- 日期：2026-08-29
- 替代：[ADR-0008](0008-agent-ready-not-agent-first.md)、[ADR-0029](0029-mastra-agent-runtime-spike.md)

## 背景

ADR-0029 通过隔离 Spike 验证了 Mastra 可以承担进程内 Agent Loop 和 Tool 适配，而不接管
Kanvas 的 Workflow、Provider、预算、Artifact 或数据库事实。Agent 已进入用户可见生产路径，
继续使用 Spike 命名会错误表达当前责任和支持边界。

## 决策

1. `@kanvas/agent-runtime` 是唯一直接依赖 Mastra 的 Workspace Package。
2. Mastra 负责进程内模型循环、Tool Adapter 和流协议，不拥有持久业务状态。
3. MySQL 拥有 AgentThread、AgentRun、ModelCall / Attempt、ActionReceipt 和线程记忆事实。
4. `KanvasAgentModelPort` 必须通过 Workspace Binding、预算预留、Secret-scoped Transport 和
   Provider 协议适配器执行模型调用；禁止直接使用框架 Model Router 或 Provider SDK。
5. ToolView 根据当前权限、上下文和已发布能力动态投影；Tool 执行重新进入 Kanvas
   Application Command、授权、幂等和 Audit 边界。
6. Mastra Memory Processor 只生成有界观察；Kanvas 保存和提供观察，框架存储不成为第二主库。
7. Agent 不替代 Workflow。可发布、可恢复的生产流程仍由 WorkflowRevision 和 WorkflowRun
   表达，Agent 只通过受治理 Tool 调用它们。

## 后果

- 框架升级集中在 Adapter Package，并需要 Agent 行为与 Provider 上下文回放。
- 运行时可以复用成熟模型循环，同时保留 Kanvas 的授权、费用、审计和恢复语义。
- 任何新增 Mastra Workflow、Storage、Model Router 或持久 Memory 使用都需要新的 ADR。
