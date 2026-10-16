# ADR-0013：V0 以批量商品图处理固定批次、人工修正与 Browser 回退边界

- Status: Partially Superseded by [ADR-0035](0035-retire-project-deliverable-and-converge-internal-formats.md); the Scenario and Browser fallback boundaries remain Accepted
- 日期：2026-07-27

## 背景

Kanvas 需要用第一方真实场景验证 Capability、Workflow、Artifact、Browser Runtime 和可靠性，但不能把商品图业务流程写入平台内核。批量商品图处理同时暴露 Capability 粒度、批量身份、部分成功、人工 Mask 修正、Browser 断线和对象提交等高返工风险。

如果直接使用数组下标表示批量项、把质量分数当业务结论、允许重试 Attempt 覆盖历史输出，或把上传成功等同于 Artifact 已提交，MySQL 执行事实和用户交付事实会冲突。

## 决策

- 场景 A“批量商品图基础处理”是 V0 第一个实施的确定性生产流水线金丝雀。
- 场景 B“商品营销主图”保留为第二个非确定性创意决策金丝雀，但严格裁剪为确认 Brief、生成候选、人工选择、固定模板渲染和交付。
- 场景包位于 monorepo 的独立 `scenario-packs/` 边界，通过公开 Workflow、Capability 和 Skill Profile 使用核心平台。
- 场景 A V0 一次 Run 只接受一个 OutputProfile，只允许单层 `map`，不支持输入乘多尺寸的嵌套展开。
- 场景 A 的首批执行 Capability 为 `image.background.remove`、`image.background.compose` 和 `artifact.package`。
- Canvas 适配属于 `image.background.compose` 的整体渲染语义；独立缩放出现真实复用调用方后再发布 `image.resize`。
- Capability 只输出机器质量信号；回退和人工检查由版本化策略决定并进入 ExecutionPlanSnapshot。
- `ProjectDeliverable` 表示整个批次，`DeliverableItem` 表示跨 WorkflowRun 稳定的交付槽位。它不是 WorkItem。
- NodeRun Scope 使用 DeliverableItem ID，不使用数组下标。
- Mask 人工修正创建新 Artifact 和 ArtifactEdge；不可变 ApprovalDecision 引用最终 Mask，后续 Compose 节点消费该决定，不修改已有 NodeRun、CapabilityRun 或 Attempt。
- 一个 CapabilityRun 最多采纳一个 Attempt。多候选通过多个 CapabilityRun 或契约声明的集合输出表达，不复用 Attempt 重试语义。
- Browser、Worker 和迟到结果通过租约、UploadSession、Attempt 版本及 `acceptedAttemptId` 条件更新治理。
- `CompleteAttempt` 在同一 MySQL 事务创建 StoredObject、Artifact、AttemptOutput，采纳 Attempt，推进状态并写 Outbox。
- V0 不增加 ArtifactCommit、CapabilityRunRevision、CorrectionRun 或通用 Deliverable Artifact Assignment。
- Workflow 生命周期与业务结果分离；批量允许 `completed + partial_success`。
- Map 自身完成有界 Fan-out 聚合，不创建独立 Join NodeRun；固定并行与汇合使用运行时激活边和 Join Policy。

## 关键不变量

1. DeliverableItem 的 `itemKey` 在同一 ProjectDeliverable 内唯一且跨 WorkflowRun 稳定。
2. NodeRun Scope 不依赖输入顺序或数组下标。
3. Workflow V0 不允许嵌套 `map`。
4. Capability 输出质量信号不直接等于业务接受、拒绝或交付决定。
5. 人工修改 Mask 必须创建新 Artifact，不能覆盖模型输出。
6. ApprovalDecision 只引用不可变 Artifact 和固定计划，不修改 WorkflowRevision 或历史执行事实。
7. 一个 CapabilityRun 最多存在一个被采纳 Attempt。
8. 回退 Attempt 不能覆盖已经采纳的 Attempt。
9. 多候选是 Capability 输出或多个逻辑 CapabilityRun，不是多个重试 Attempt。
10. 只有赢得 Attempt 条件提交的对象才能创建正式 StoredObject 和 Artifact。
11. 未提交对象可以按 TTL 回收，但不能被历史 Run 当作正式输出。
12. 批量部分成功不删除成功 Artifact，也不伪装成完整成功。
13. 最终 Delivery 固定具体 Artifact，不绑定动态 Asset current。

## MySQL V0 约束

- `UNIQUE(project_deliverable_id, item_key)`。
- `UNIQUE(workflow_run_id, node_key, scope_key)`。
- CapabilityRun 的 `accepted_attempt_id` 通过带版本或空值条件的更新设置。
- `UNIQUE(capability_attempt_id, output_role, output_index)`。
- UploadSession 绑定 Workspace、Attempt、对象 Key、过期时间和完成状态。
- Attempt 完成、StoredObject、Artifact、AttemptOutput、状态转换和 Outbox 在同一事务提交。
- `accepted_artifact_id` 必须属于 DeliverableItem 的 `output_asset_id`，由应用事务校验。

## 结果

- 第一条纵向切片能够真实验证 Browser、Worker、MySQL、Redis、对象存储、Artifact 和交付边界。
- 批量项具有稳定业务身份，但不引入任务管理语义。
- Mask 修正保留完整血缘和审批事实，不需要为修正复制 WorkflowRun。
- 生成候选、失败重试和 Provider 回退不会在 Attempt 层混为一谈。
- Canvas 适配不产生无意义中间 Artifact，同时保留未来独立缩放能力的演进空间。

## 未包含

- 具体浏览器模型、许可证和质量门槛。
- 具体文件数、像素和内存默认限制。
- 通用多尺寸矩阵和嵌套 `map`。
- 完整画布编辑器。
- WorkItem、PIM 和外部 SKU 同步。
- 场景 B 的最终 Workflow Contract。

通用 Workflow V0 与队列可靠性由 [ADR-0017](0017-bounded-workflow-runtime-and-database-owned-reliability.md) 定稿。
