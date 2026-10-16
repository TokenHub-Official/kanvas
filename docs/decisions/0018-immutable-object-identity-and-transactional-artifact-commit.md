# ADR-0018：采用不可变对象身份与事务化 Artifact 提交

- 状态：Accepted
- 日期：2026-07-27

## 背景

ADR-0012 已区分 StoredObject、Artifact 和 Asset，ADR-0017 已要求 `CompleteAttempt` 在 MySQL 中原子提交执行与内容事实。仍需确定 Presigned URL/Multipart 下的字节不可变性、上传成功但业务失败后的所有权、Complete/GC 竞态，以及 S3-compatible 与 Local 的共同语义。

对象存储不参与 MySQL 事务。仅依赖随机 Key、Temp/Final Prefix 或对象 Tag，会留下覆盖、双写和误删窗口。

## 决策

### 1. 直接写唯一 Key，数据库决定可见性

Server 为每个 UploadSession 生成永不复用的 Key。Producer 直接写入该 Key，不执行 Temp → Final Copy/Move。对象存在不代表 StoredObject/Artifact 存在，MySQL 事务是内容进入 Kanvas 的唯一提交点。

V0 不做物理去重；`(workspace_id, sha256)` 仅普通索引。

### 2. Seal 后 Object Identity 必须不可变

Production Adapter 必须保证：

> Seal 成功后，不存在任何仍有效的写路径可以改变已绑定 Object Identity 对应的 Bytes。

允许 Conditional Create、Server-owned Streaming、Version-bound Identity 或 Server 控制完成的 Multipart。若 Provider 不可靠支持 Conditional Create，Single PUT 降级为 Server-owned Upload。随机 Key、短 URL 或默认 Versioning 本身都不满足合同。

### 3. UploadSession 生命周期与 Cleanup 正交

```text
open → sealing → verifying → verified → committed
                    ↘ rejected
open / sealing / verifying / verified → aborted
```

时间流逝不产生 `expired` 状态。Complete 校验 `expiresAt`；Reaper 到 `cleanupEligibleAt` 后锁行并转 `aborted(reason=expired)`。

```text
none → claimed → done
               ↘ failed → claimed
```

Complete 与 Reaper 锁同一 Session。Complete 只接受 `verified + cleanup none + unexpired`；Claim 后永远禁止提交。物理 Abort/Delete 在事务外执行并可重试。

### 4. 可信验证固定内容事实

Verification Result 固定 Object Identity、Size、Full SHA-256、Detected Media Type、Profile Version 和时间。不信任文件名、Declared MIME、客户端 Hash 或 ETag。Provider Checksum 仅在文档与 Probe 证明覆盖完整对象时使用，否则流式重算。

### 5. CompleteAttempt 事务化提交

事务前完成 Seal、媒体校验、Contract 校验和 Canonical Manifest。事务内统一按：

```text
CapabilityRun → CapabilityAttempt → UploadSession（按 ID）
```

锁定并重验 Current Attempt、Lease/Fence、取消顺序、输出精确集合和 Session 资格，再创建 StoredObject、Artifact、AttemptOutput、Lineage、Usage，设置 Accepted Attempt、终结 Attempt/CapabilityRun 并写 Outbox。事务中不调用对象存储或推进 NodeRun/WorkflowRun。

相同 Attempt/Manifest 重试返回原结果，不同 Manifest Conflict。失败事务不留下正式内容事实，物理对象继续归 Session。

### 6. Producer 共用协议，不增加 ArtifactCommit

User Import 使用 `CommitUserUpload`；Browser、Worker、Provider 和 Server 输出使用 `CompleteAttempt`。二者复用 Session、Storage Port、Verification 和 StoredObject 规则，但各自提交业务关系。

### 7. GC 与 Retention 分离

未提交对象由 Session Reaper 清理；Lifecycle 只兜底 Abort 未完成 Multipart。已提交对象使用 `active → deletion_pending → deleted | missing`。Key 永不复用，因此 V0 不需要 Deletion Generation 或独立 ObjectDeletionRecord，StoredObject 行保留为 Tombstone。

### 8. Local 只承诺单节点

Local 通过鉴权 HTTP 写同文件系统 `.part`，流式 Hash、Fsync 和排他原子 Rename。V0 支持 Range，不实现 Multipart 或多节点 Local。

## 关键不变量

1. Storage Profile、Container、Key 在 Session 与 StoredObject 中分别唯一。
2. 一个 UploadSession 只创建一个 StoredObject。
3. Committed StoredObject 的 Identity、Size、SHA-256 和 Media Type 不可修改。
4. Complete 与 Cleanup 行锁竞争只允许一方获胜。
5. 相同 Seal/Completion Manifest 幂等，不同 Manifest 冲突。
6. GC 永远不删除 Committed Session 对象。
7. URL、Credential、本地绝对路径不进入日志、审计或持久化业务 Payload。
8. 下载、删除和提交都重新校验 Workspace/Subject，不能接受客户端 Key。

## 后果

正面：

- 不需要对象存储与 MySQL 的分布式事务。
- 避免 Copy/Move 的额外成本和失败窗口。
- 所有 Producer 和 Local/S3 共享一个业务提交模型。
- 不可靠 S3-compatible 行为在启用前被 Probe 阻断。

代价：

- Adapter 必须提供并验证 Write Protection。
- 不支持条件创建的 Provider 会增加 Server 上传带宽。
- Verification 可能需要完整读取媒体。
- 必须实现 Reaper、Retention Worker 和 Compatibility Probe。

## 不采用

- Temp → Final Copy/Move。
- 仅依赖随机 Key。
- 默认要求 Bucket Versioning。
- 提交后首次读取再验证。
- 按 Prefix/Tag 自动删除完整对象。
- V0 物理去重、Local Multipart、多节点 Local。
- ArtifactCommit、Deletion Generation 和独立 ObjectDeletionRecord。

## 必须通过的 Gate

- Presigned Replay 不能改变已 Seal Identity。
- Multipart Complete 响应丢失恢复为同一 Identity。
- Complete/GC、Complete/Cancel、重复 Complete 的并发断言成立。
- 上传成功/MySQL 失败只留下可恢复或可清理对象。
- Local 在 Fsync/Rename/DB Commit 崩溃点不产生错误正式 Artifact。
- 每个 Production Profile 通过自动 Compatibility Probe。

详细协议见 [STORAGE-AND-UPLOADS.md](../STORAGE-AND-UPLOADS.md)。
