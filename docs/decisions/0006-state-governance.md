# ADR-0006：按状态域治理，不采用全局万能状态引擎

- 状态：Accepted
- 日期：2026-07-27

## 背景

Kanvas 的 Workflow、异步执行、人工审批、浏览器模型回退、编辑器选择与撤销重做都会产生大量状态。如果由单一 `status`、单一前端 Store 或队列状态承担全部语义，会导致状态组合爆炸、恢复困难和业务事实丢失。

## 决策

- WorkflowRun 和 NodeRun 使用数据库持久化的显式状态转换，CapabilityRun / Attempt 记录逻辑调用和真实执行。
- 执行、审批、计费和 Artifact 可用性是独立状态维度。
- 队列只负责调度；数据库中的 WorkflowRun、NodeRun 和 CapabilityRun / Attempt 是业务事实。
- TanStack Query 管理服务端缓存状态。
- Zustand 管理面板、选择、工具和视口等本地 UI 状态。
- Editor Document Model 管理可持久化设计内容。
- Editor Command History 独立管理撤销和重做。
- 指针移动、拖拽和渲染热点保留在 Canvas Runtime，不持续进入 React 全局状态。
- XState 等通用状态库不作为全局依赖，只允许在局部复杂交互经过验证后采用。

## 服务端转换要求

一次状态转换必须：

- 校验当前状态、事件和目标状态。
- 记录 Actor、Reason、时间和幂等键。
- 原子更新 Run / Step 并写入状态事件或 Outbox。
- 支持重试、取消、人工等待、外部回调和崩溃恢复。
- 生成可查询的审计和 Artifact 血缘。

## 结果

- Redis 或队列数据需要重建时，系统仍能从数据库识别待执行和待恢复步骤。
- 不把 BullMQ 的 `waiting / active / completed / failed` 直接暴露为 Workflow 或 Capability 业务状态。
- 不把 Artifact 列表等 Server State 复制到 Zustand。
- 不用一个不断增长的枚举表达多个正交状态。
- 具体 Workflow、Node、CapabilityRun / Attempt 状态集合和并发控制已由 ADR-0017 定稿；可靠性参数仍需通过 Durability Spike 校准。
