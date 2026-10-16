# ADR-0012：内容存储、Artifact、Asset 与交付物分层

- Status: Partially Superseded by [ADR-0035](0035-retire-project-deliverable-and-converge-internal-formats.md); the StoredObject, Artifact, Asset, and Editorial Selection decisions remain Accepted
- 日期：2026-07-27

## 背景

Kanvas 同时需要表达物理文件、机器执行产物、用户可管理资产、内容血缘、候选变体和项目交付目标。如果把这些语义全部放入 Artifact，存储生命周期、业务身份、权限和当前版本会混在一起；如果强制每个中间产物都创建 Asset，又会让 Mask、Preview、Depth Map 和临时转码污染团队资产库。

视觉生产也不是单一线性版本树。内容生成血缘、业务资产关系和设计师当前采纳结果必须分别拥有明确事实源。

## 决策

采用以下分层：

```text
StoredObject
    ↑
Artifact
    ↑ optional
Asset

Project
└── ProjectDeliverable
```

V0 保留 Project 作为一次业务需求和交付容器，不引入 WorkItem。只有一个 Project 下出现多个具有独立负责人、状态、截止时间和审批的任务时，才重新评估 WorkItem。

### StoredObject

`StoredObject` 表示物理对象存储事实，至少记录：

- Workspace。
- Storage Provider 与 Storage Key。
- Byte Size、MIME Type 和 SHA-256。
- 上传、校验和隔离状态。

不使用全局 `UNIQUE(content_hash)`。V0 使用 `(workspace_id, sha256)` 普通索引且不做物理去重。对象 Key 永不复用；Storage Profile、Container 与 Key 的唯一性和提交协议由 [ADR-0018](0018-immutable-object-identity-and-transactional-artifact-commit.md) 细化。

### Artifact

`Artifact` 表示不可变业务内容：

- 指向 StoredObject 或结构化内容。
- 记录 Workspace、Project、产生它的 CapabilityRun 和业务 Metadata。
- 进入 `available` 后内容、StoredObject 引用和内容 Hash 不可修改。
- Availability 只表达 `staging | quarantined | available | rejected | expired`，不承担执行状态。
- `asset_id` 可空。

用户管理、审批和交付的 Artifact 必须属于 Asset；Mask、Preview、Embedding、Depth Map、临时转码等机器中间产物可以不属于 Asset。

一个 Artifact 最多属于一个 Asset。跨 Project、模板、Brand Kit 和其他业务对象复用时创建显式 ArtifactReference，不改变 Artifact 所有权。

### Asset

`Asset` 是用户认知中的稳定逻辑资产，不直接保存文件内容。

`Asset.current_artifact_id` 保留，并严格定义为 Editorial Selection：设计师当前明确采纳的 Artifact。它不是最新版本、lineage head，也不根据生成或 supersedes 自动更新。

修改 currentArtifact 必须通过显式 Command，在事务内校验：

- Artifact 属于该 Asset。
- Artifact 当前可用。
- Actor 有选择权限。
- 写入 AuditEvent。

回滚可以把 currentArtifact 指向旧 Artifact，不重写内容血缘。审批必须绑定具体 Artifact，不能只绑定动态 current。

### 内容与业务关系

`ArtifactEdge` 只表达内容如何产生：

- `derived-from`
- `supersedes`
- `composed-from`
- `generated-from`

方向统一为 Source 是输入或旧内容，Target 是输出或新内容。Edge 不能自指；`supersedes` 和派生关系不能形成环。

`AssetRelation` 表达业务资产关系：

- `variant-of`
- `template-of`
- `related-to`
- `channel-version-of`
- `language-version-of`

同一逻辑资产的内容修订使用同一 Asset 下的新 Artifact 和 `supersedes`；并列候选、新渠道或新用途通常创建新 Asset，再通过 AssetRelation 表达关系。

### ProjectDeliverable

`ProjectDeliverable` 表示 Project 必须交付的业务目标，例如首页 Hero、App Icon、1:1 渠道图或视频 Banner。

- Deliverable 可以声明类型、渠道、尺寸、格式、数量、截止时间和验收状态。
- 候选与最终 Artifact 通过显式关联进入 Deliverable。
- Approval 绑定具体 Deliverable 和 Artifact / Revision，而不是模糊绑定整个 Project 或动态 current。

批量 Deliverable 使用 `DeliverableItem` 表示稳定交付槽位：

- `itemKey` 在同一 Deliverable 内唯一，来自 SKU、导入清单或 Source Artifact ID。
- Item 可以记录 Source Artifact、稳定 Output Asset 和当前接受的不可变 Artifact。
- Item 跨 WorkflowRun 稳定，不能使用数组下标替代。
- DeliverableItem 不拥有独立负责人、截止时间或任务流程，因此不等于 WorkItem。
- Package 和 Manifest 属于 Deliverable 级附件，不混入单项执行状态。

## 关键不变量

- StoredObject 是物理内容事实，Artifact 是不可变业务内容，Asset 是逻辑资产身份。
- Artifact 可以没有 Asset；如果有，只能属于一个。
- 用户可管理和交付的 Artifact 必须属于 Asset。
- Asset.currentArtifactId 是唯一当前采纳事实，ArtifactEdge 不推导 current。
- 生成新 Artifact 不自动成为 current。
- ArtifactEdge 只表达内容血缘，AssetRelation 只表达业务资产关系。
- 跨 Workspace 引用必须经过授权，不能通过全局 Hash 推断其他 Workspace 是否拥有内容。
- StoredObject、Artifact、Asset、Reference 和 Deliverable 都显式携带或可确定 Workspace 边界。
- Approval、Review 和 Delivery 永远绑定不可变 Artifact、Candidate 或 Revision。
- 批量交付项通过 DeliverableItem 表达，最终接受 Artifact 必须属于该 Item 的 Output Asset。
- V0 不引入 ArtifactVersion；同一 Asset 下不可变 Artifact 构成其内容历史。

## MySQL V0 约束

- `UNIQUE(workspace_id, storage_provider, storage_key)`。
- `INDEX(workspace_id, sha256)`，不做全局 Hash 唯一。
- `UNIQUE(source_artifact_id, target_artifact_id, relation)`。
- `UNIQUE(source_asset_id, target_asset_id, relation)`。
- `UNIQUE(project_deliverable_id, item_key)`。
- Asset、Project、Draft 等可编辑对象使用 `version` 乐观锁。
- currentArtifact 同 Asset、可用性和 Edge 防环由应用事务校验。
- Workspace、Project、Asset、Artifact、Deliverable 和常用状态建立组合索引；最终索引形态由真实查询验证。

## 结果

- 中间执行产物不会制造大量隐藏 Asset。
- 存储去重、内容身份和用户资产不再混为同一对象。
- 当前采纳、内容血缘和业务变体各有唯一事实源。
- Project 不需要过早引入 WorkItem，也能明确表达多个交付目标及其审批对象。
- 多一个 StoredObject 与 ProjectDeliverable 层次，但降低后续权限、存储迁移和交付建模成本。

## 未包含

- 未来是否基于生产收益引入 Workspace 内物理去重。
- ArtifactReference 的泛型或专用表最终形态。
- WorkItem、Campaign 和跨 Workspace 共享协议。
- Artifact 与画布 Document 的最终 Schema。
