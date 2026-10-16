# ADR-0026：采用独立 Workflow Identity 与 Candidate 固定的统一测试执行

- 状态：Accepted
- 日期：2026-08-09

## 背景

Kanvas 已经具备不可变 WorkflowRevision、WorkflowRun、NodeRun、
CapabilityRun / Attempt、Approval、Artifact、Usage 和可靠恢复，也已经具备
WorkflowDraft、PublicationCandidate、PublicationCheck、ReviewDecision 和发布 Store。

现有模型仍不足以承载独立 Workflow 作者与模板产品：

1. `workflowKey` 分散在 Draft 与 Revision 中，没有稳定 Workflow 聚合承载名称、
   说明、归属、目录状态和版本摘要。
2. 正式 WorkflowRun 只能固定 `workflowRevisionId`，而发布前真实测试必须固定不可变
   Candidate；直接执行可变 Draft 会破坏审计和恢复。
3. 另建测试执行器会复制 NodeRun、Attempt、取消、费用、Artifact 和恢复状态机。
4. 把测试 Candidate 伪装成 Published Revision 会污染正式版本号，并违反只有批准
   Candidate 才能生成 Published Revision 的既有决策。

本 ADR 细化 [ADR-0009](0009-versioned-skill-workflow-packages.md)：正式运行仍固定
WorkflowRevision；发布前测试固定 PublicationCandidate。二者使用同一执行内核。

## 决策

### 1. 建立稳定 `workflow_definition`

新增 Workspace-scoped `workflow_definition` 聚合，作为独立 Workflow 的稳定产品身份。

V0 字段固定为：

```text
workflow_definition
├── id
├── workspace_id
├── workflow_key
├── display_name
├── description?
├── category?
├── lifecycle_status: active | archived
├── version
├── created_by_principal_id
├── updated_by_principal_id
├── created_at
└── updated_at
```

约束：

- `(workspace_id, workflow_key)` 唯一。
- `(workspace_id, id)` 唯一，用于复合外键。
- `workflow_key` 创建后不可修改。
- 名称和说明属于稳定产品身份，不进入执行拓扑。
- Tags、封面、模板推荐位和搜索权重在 WF-04 出现真实目录需求时再增加；WF-01 不提前
  建设通用 Catalog Metadata。
- WorkflowDraft 与 WorkflowRevision 新增 `workflow_definition_id`。迁移窗口内为兼容
  既有 Bootstrap 和历史 Revision 保持可空；所有新作者写入必须非空，待历史数据与
  回滚证据稳定后再以独立 Migration 收紧为不可空。
- `workflow_key` 在 Draft / Revision 中保留一个兼容窗口，作为不可变快照；新写入必须
  与 Definition 一致。只有查询和回滚证据证明不再需要时，才另行移除重复列。

### 2. Candidate 是唯一发布前测试快照

- `SubmitWorkflowCandidate` 从指定 Draft Version 创建现有
  `PublicationCandidate(subjectKind = workflow)`。
- 不新增 `TestCandidate`、`PreviewRevision` 或平行 Candidate 生命周期。
- Candidate 创建后不可修改；测试失败后作者修改 Draft 并提交新 Candidate。
- Candidate 测试要求 `workflow.author` 与 `workflow.run`，且继续执行 Workspace、
  Capability、数据出口、额度和 Provider 策略。
- 测试输出默认不自动登记为 Asset、Deliverable 或模板预览。
- Eval PublicationCheck 可以引用 Candidate Test Run ID、Execution Plan Hash、结果
  摘要和证据 Digest；浏览器不能自行写入 `passed`。

### 3. WorkflowRun 使用不可变 Definition Reference

WorkflowRun 支持且只支持两种定义来源：

```text
published_revision
publication_candidate
```

数据库形态：

```text
workflow_run
├── definition_kind
├── workflow_revision_id?
└── publication_candidate_id?
```

必须通过 Check Constraint 保证：

- `published_revision` 恰好具有 `workflow_revision_id`。
- `publication_candidate` 恰好具有 `publication_candidate_id`。
- 两个 ID 不能同时存在或同时为空。
- Candidate 必须属于同一 Workspace、`subject_kind = workflow`，且内容 Digest 与运行
  固定事实一致。

现有 WorkflowRun 全部回填为 `published_revision`，读取协议保持兼容。

### 4. 统一执行内核

Application 在创建 Run 前将 Revision 或 Candidate 解析为统一只读
`ExecutableWorkflowDefinition`：

```text
ExecutableWorkflowDefinition
├── kind
├── id
├── workspaceId
├── workflowDefinitionId
├── workflowKey
├── canonicalDigest
├── topology
├── inputSchema
└── outputSchema
```

随后继续使用同一套：

- Input Validation。
- Capability Route / ExecutionPlanSnapshot。
- WorkflowRun / NodeRun。
- CapabilityRun / Attempt。
- Outbox / Inbox。
- Approval。
- Timeout / Cancel / Reconciler。
- Artifact / Usage / Operational Timeline。

不得增加 Candidate 专用 NodeRun、队列、Worker Consumer 或结果表。

### 5. Approval 固定相同 Definition

现有 `workflow_approval_request.workflow_revision_id` 不能表达 Candidate Test Run。
它调整为与 WorkflowRun 相同的 Definition Reference：

```text
workflow_approval_request
├── definition_kind
├── workflow_revision_id?
└── publication_candidate_id?
```

并使用同样的互斥 Check Constraint。Approval 创建和决定时必须同时核对：

- WorkflowRun Definition Reference。
- Candidate / Revision Digest。
- Execution Plan Hash。
- Node Input / Request / Decision Schema Digest。
- 当前 Workspace 权限。

### 6. 正式入口继续只接受 Published Revision

以下入口只允许 `published_revision`：

- 普通独立 Workflow 运行。
- Skill Workflow Entrypoint。
- Deliverable Work Session。
- Production Schedule / Event Trigger（后续阶段）。

只有作者 Candidate Test Command 可以创建 `publication_candidate` Run。普通
`CreateWorkflowRun` 不接受 Candidate ID。

## 计划 Migration

下一条 Workflow Migration 使用当前序列的 `0030`，按以下顺序实施：

1. 创建 `workflow_definition`。
2. 从 WorkflowDraft / WorkflowRevision 的 `(workspace_id, workflow_key)` 并集回填
   Definition；冲突名称使用稳定 Key 作为临时 Display Name，后续由作者修改。
3. 为 WorkflowDraft / WorkflowRevision 增加可空 `workflow_definition_id`，回填并验证
   Workspace / Key 一致性。
4. 增加复合外键和新唯一索引；Application 新写入强制携带 Definition。数据库
   `NOT NULL` 收紧延后到兼容窗口关闭，避免一次性破坏既有 Bootstrap。
5. 为 WorkflowRun 增加 `definition_kind` 与可空 `publication_candidate_id`；回填现有
   Run 后将 `workflow_revision_id` 改为可空并增加互斥约束。
6. 对 WorkflowApprovalRequest 做同样的 Definition Reference 迁移。
7. 增加 Candidate Workspace 复合外键；`subject_kind = workflow` 由创建事务和读取
   Fail Closed 共同保证，因为 MySQL Check 不能跨表验证。
8. 更新 Drizzle Schema、Application Port、Query Projection 和 Migration Test。

Migration 不删除现有 Key、Revision 或外键列，避免一次性破坏 Bootstrap、Scenario
Pack、Deliverable 和历史查询。删除兼容列不属于 WF-01。

## 关键不变量

1. 可变 Draft 永不直接执行。
2. 每个 Run 恰好固定一个不可变 Revision 或 Candidate。
3. Candidate Test 与正式运行共享执行状态机和恢复协议。
4. Candidate 不能进入普通目录、Skill Entrypoint 或 Deliverable Intake。
5. Published Revision 号只由批准 Candidate 产生，测试不占用正式版本号。
6. Workflow Definition 是稳定产品身份，不是执行版本。
7. UI 的 React Flow 布局不是 Workflow Definition 或执行事实源。
8. 测试模式不绕过权限、额度、Secret、Provider 和数据出口治理。

## 库与实现边界

- `@xyflow/react` 继续作为 WF-01 图编辑 Adapter 候选；进入安装前重新核对官方维护、
  许可证、React 19 / TypeScript 兼容、包体积和可访问性。
- JSON Schema 继续使用现有 TypeBox + AJV Contract Authority，不新增 Zod 作为共享
  Workflow Schema 事实源。
- 是否引入表单库在独立运行表单出现时按真实复杂度决定；WF-00 不安装依赖。
- 任意第三方库只能停留在 Web / Adapter 层，不能改变本文领域身份和执行协议。

## 结果

- 独立 Workflow 可以拥有稳定名称、列表、Draft 和 Revision 历史。
- 发布前真实测试获得不可变身份，同时复用成熟的执行与恢复内核。
- 测试不污染正式 Revision 序号，也不复制运行状态机。
- WF-01 可以围绕清晰的 Query / Command 和 Migration 开始，而不先做页面猜测。

## 未包含

- Workflow 页面实现和 React Flow 依赖安装。
- Workflow 模板目录元数据。
- Candidate 测试 Run 的具体 HTTP Body。
- 多人编辑、DraftHistory、分支与合并。
- Schedule、Webhook、Agent 和公开市场。
