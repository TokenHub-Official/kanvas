# ADR-0010：统一执行事实源与 Workflow 可靠性语义

- 状态：Accepted
- 日期：2026-07-27

## 背景

Kanvas 的 Workflow、队列、Worker、Provider、Browser Runtime 和 Artifact 都会产生状态。如果 WorkflowRun、队列 Job、供应商任务和 Artifact 各自维护一套“执行是否成功”的业务事实，再通过同步保持一致，最终会出现无法解释的组合，例如：

- Workflow 节点失败，但队列 Job 已完成。
- Artifact 已生成，但节点仍显示运行中。
- Provider 重复回调导致重复扣费或重复推进。
- 超时后的 Attempt 成功返回，覆盖了取消决定。
- Redis 数据丢失后无法判断哪些业务调用需要恢复。

远程和浏览器执行都不能保证物理上的 exactly-once。平台需要定义逻辑调用、真实尝试、编排推进、内容提交和消息投递各自的唯一事实源。

## 决策

### 统一执行模型

```text
WorkflowRun
  └── NodeRun
        └── CapabilityRun
              └── CapabilityAttempt 1..n
                    └── Artifact / Usage / Diagnostics
```

- `CapabilityRun` 表示一次逻辑能力调用，是该调用成功、失败、取消或等待的唯一业务事实源。
- `CapabilityAttempt` 表示一次真实执行、重试、租约或 Provider 请求。
- `NodeRun` 只负责 Workflow 图的编排状态，由 Workflow Orchestrator 单写。
- `WorkflowRun` 总状态由 NodeRun 推导并物化，仍由 Orchestrator 单写。
- `Artifact` 表示已经提交的不可变内容及其可用性、隔离和血缘，不承担执行状态。
- Redis / BullMQ Job 只负责投递、延迟和租约，不是业务事实源。
- 未来 Agent 的 Tool Call 也必须创建或引用 `CapabilityRun`，不能形成第四套执行状态。

### 数据与投递

- MySQL 8.0 是 Workflow、Node、CapabilityRun、Attempt、Approval、Artifact 元数据、Usage 和审计的事实源。
- 业务状态转换与 Outbox 消息在同一 MySQL 事务中提交。
- Redis 消费 Outbox 并负责投递；Redis 状态可以重建。
- 不采用全量 Event Sourcing。关系表保存当前状态，追加事件保存审计和恢复证据，不形成第二套可变状态。
- 每次更新携带状态版本或等价的并发控制，拒绝过期完成和重复推进。

## 最小执行过程

1. 创建固定到 `WorkflowRevision` 的 WorkflowRun。
2. 解析 WorkflowRevision、CapabilityContractRevision 和当前 Binding。
3. 保存不可变 `ExecutionPlanSnapshot` 及其 Hash，固定 ImplementationRevision、Provider、模型、参数、策略结果、权限上下文和回退链，但不保存 Secret 与瞬时运行状态。
4. Orchestrator 为就绪节点创建 NodeRun 和 CapabilityRun。
5. 在同一事务写入 Outbox。
6. Worker 领取投递并创建 CapabilityAttempt，使用稳定幂等键执行。
7. 成功时原子或可恢复地提交 Attempt、CapabilityRun 结果、Artifact 元数据和 Usage。
8. Orchestrator 根据 CapabilityRun 推进 NodeRun 和 WorkflowRun。
9. Approval 节点绑定目标对象、参数和执行计划 Hash 后暂停，收到不可变 ApprovalDecision 后继续。
10. 重复回调、重复完成、乱序回调和超时后返回通过幂等键与状态版本拒绝或归档。

## V0 必须定义的可靠性语义

- 队列采用至少一次投递。
- 每个 Capability 定义幂等能力：原生幂等、支持幂等键或不幂等。
- 错误结构标记可重试、不可重试、需要人工和需要重新规划。
- 定义 Attempt 超时、心跳、租约失效和最大重试次数。
- 取消采用协作式语义，并定义取消与完成竞态的优先规则。
- 固定并行使用多条激活边，汇合使用 `all_success / all_settled`；Map 独立声明 `fail_fast / collect_all`。
- `map` 声明最大元素数、并发上限和 Workflow 总步骤上限。
- V0 的 `map` 只有一层；NodeRun Scope 必须使用稳定业务 ID，不能使用数组下标。
- Workflow 和节点均可声明预算、时间和资源上限。
- 明确未提交对象何时通过 MySQL 事务创建 StoredObject/Artifact 并进入 available。
- 外部回调必须验证来源、关联请求 ID、幂等键和当前状态版本。
- 发布 Revision 的弃用与安全撤销不会修改历史执行计划。
- 一个 CapabilityRun 最多采纳一个 Attempt；多候选属于多个逻辑调用或集合输出，不属于重试 Attempt。
- Browser / Client Attempt 通过租约、心跳和 UploadSession 提交，迟到结果不能覆盖已经采纳的 Attempt。
- Attempt 完成、StoredObject、Artifact、AttemptOutput、状态转换和 Outbox 必须在同一 MySQL 事务内提交。
- Workflow 生命周期与业务 Outcome 分离，批量允许终态完成但结果为 partial success。

## Artifact 与执行血缘

Artifact 内容不可变。内容血缘通过 `ArtifactEdge` 表达，例如：

- `derived-from`
- `supersedes`
- `composed-from`
- `generated-from`

`variant-of`、`template-of`、`related-to` 等业务资产关系进入 `AssetRelation`，不与内容血缘混用。

每次模型或 Provider 调用至少记录：

- 实际 Provider、Endpoint 和模型标识。
- CapabilityContractRevision、ImplementationRevision 和实际 Binding。
- Prompt / Instructions 摘要与参数。
- 输入和输出 Artifact Hash。
- Provider 原始请求 ID。
- 耗时、成本和用量。

这些记录保证执行血缘、审计和问题定位，不承诺非确定性 AI 输出可以逐像素复现。

## 结果

- 队列、Workflow、Artifact 和未来 Agent 不再争夺执行事实。
- Redis 丢失或重建不改变业务状态。
- 重试、回调和取消竞态具有可测试语义。
- MySQL Outbox、幂等键和状态版本增加实现成本，但显著降低双写和重复副作用风险。
- BullMQ、自建 Orchestrator 或未来 Temporal 类引擎都必须适配该领域事实模型，而不是反向替代它。

## 必须验证

通过 Durability / Chaos Spike 覆盖：

- Worker 在领取、执行、上传和提交各阶段崩溃。
- Outbox 重放和 Redis 重复投递。
- Provider 重复、乱序和延迟回调。
- 超时后成功、取消与完成竞态。
- 对象存储上传成功但数据库提交失败。
- 数据库成功但进度事件未送达。
- 不幂等 Provider 的重试与人工恢复。

Spike 决定自建执行器的边界以及何时需要 Temporal 类持久化执行引擎，但不能改变上述业务事实源。

## 未包含

- 数据库锁、扫描批次、归档和分区的具体参数。
- 通用补偿事务 DSL。

最终状态枚举、Workflow V0 协议、BullMQ 两队列拓扑、Lease/Fence、Retry、Cancel 和 Redis 重建语义已由 [ADR-0017](0017-bounded-workflow-runtime-and-database-owned-reliability.md) 定稿；具体容量参数仍由 Durability Spike 决定。
