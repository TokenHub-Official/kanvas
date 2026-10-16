# ADR-0021：有界可观测性与带 Fencing 的部署恢复

- 状态：Accepted
- 日期：2026-07-27

## 背景

Kanvas 的一次 Workflow 可能跨越 HTTP、MySQL Outbox、BullMQ、Worker、Browser、Provider Callback、Approval 和对象存储，并持续数小时或数天。若用一个长 Trace、一个 Correlation ID、Redis Queue State 或日志承担业务解释，Telemetry 采样、过期或 Redis 丢失后就无法恢复。

平台还必须同时支持内部基础设施和单机开源自部署。应用升级、Migration、对象与数据库备份、KEK 恢复和后台进程误启动如果没有一致协议，会产生重复外部副作用或 DB 引用缺失对象。

## 决策

### 1. Telemetry 与持久事实分离

Pino JSON Log 用于诊断，OpenTelemetry Trace 表达一次有界 Operational Hop，OpenTelemetry Metric 表达聚合 SLI；MySQL Domain State/Outbox、UsageLedger 和 Audit 才是持久事实。

OTel JavaScript V0 使用稳定 Trace/Metric；Log SDK 后置。Telemetry Export 失败不阻断业务，且必须有界；Trace/Log/Metric/Health 永不授权、去重、推进或恢复业务。

### 2. 长 Workflow 使用领域 ID 与 Timeline

不创建跨审批和长任务的巨型 Trace。异步消息保存 Message Creation Trace Context，Consumer 默认使用 Span Link。长期关联使用 WorkflowRun、NodeRun、CapabilityRun、Attempt、Outbox Event 和 Provider Request ID。

V0 提供 Operational Timeline Query，从现有 MySQL 事实投影并关联 Trace Reference；不增加新的 Timeline Authority。

外部 Baggage 丢弃，Trace Context 只作诊断。日志与 Telemetry 使用字段 Allowlist，不记录 Secret、Body、Prompt、Artifact 内容/URL、Header/Cookie、SQL 参数和 Provider Raw Payload。Metric Label 禁止动态租户与执行 ID。

### 3. Audit 分层

权限、Credential/Secret、Approval、发布、安全策略、Recovery/Override 和敏感访问能力签发属于 Tier A，与命令在同一 MySQL 事务 Append AuditEvent。

普通 Workflow/Attempt/Artifact/Usage Transition 属于 Tier B：Domain Fact 与不可变 Outbox 是耐久证据，幂等 Projector 生成 AuditView。内部诊断属于 Tier C，只进 Telemetry。

AuditView 不授权，行 Digest 不宣称抵抗 DB Admin。Outbox/Event 在 Required Projector Checkpoint 前不能清理。

### 4. 进程按 Role 运行但共享事实协议

代码保持 Web、Server、Worker 与一次性 Migrator。Worker 通过显式 Role 运行 Orchestration、Execution、Outbox Relay、Scheduler、Reconciler 和 Maintenance。

单机 Compose 默认五个长期容器：MySQL、Redis、Web、Server、Worker；生产可以按 Role 拆 Worker/Control。正确性只依赖 MySQL Lease/CAS/Inbox/Fencing，不依赖容器数量或进程单例。

Liveness 不检查外部依赖；Startup 检查配置/Schema；Readiness 按 Role 检查接流量条件。Shutdown 先停止接流量/Claim，再有界 Drain，遗留由领域 Lease/Reaper 恢复。

### 5. Runtime State 与 Generation 阻止恢复期副作用

InstanceRuntimeState 明确 `ACTIVE | DRAINING | MAINTENANCE | RESTORING | VERIFYING | READ_ONLY` 与 `executionGeneration`。

Claim、Heartbeat、Complete、Provider 调用、Callback Adoption、Relay、Scheduler、Reconciler 和 Maintenance 都必须通过 RuntimeFenceGuard。进入强隔离状态增加 Generation，旧执行不能继续提交。

恢复还必须先隔离网络与外部 Credential；数据库 Runtime State 不能自动识别运维人员是否恢复了旧数据库，因此不替代 Runbook 和 Deployment Guard。

### 6. Migration 是 Release Step，不是启动副作用

Migrator 是显式一次性命令。MySQL Named Lock 只防双 Migrator；正确性来自不可变 Checksum、Expand/Backfill/Contract Phase、Build Schema Min/Max 与 Release Manifest。

Server/Worker 启动只做 Schema Compatibility Check，不自动 Migration。Compose Dependency Graph 只改善启动体验，不是部署控制器；长期服务不依赖已退出的 Migrate Container。

### 7. BackupSet 协调数据库、对象与密钥

可恢复点必须由 BackupSet 同时描述 DB Snapshot/Binlog Position、Object Snapshot/Version Boundary、Reference Closure、Schema/Migration、KEK Version Reference、Config 与 Image Digest。

正常 Artifact 仍遵守 Object Seal/Verify 后 MySQL 事务 Commit。Backup/GC 额外保证：对象删除保留覆盖声明的 DB 恢复窗口，且恢复数据库的所有 Available StoredObject 都存在于 Object Boundary。DB 可 PITR 不代表全系统可任意 PITR。

Compose 默认使用 Quiesced Named BackupSet；只有能证明 Object Version/Deletion Retention 与 DB Position 的部署才能声明 Coordinated PITR。Redis 不备份。

Restore 先进入非执行状态并增加 Generation，完成全量引用闭包、Schema、Ledger、Outbox 和 KEK 验证，在 Read-only/Dry-run 后按 Control → Worker → Ingress 激活。

## 关键不变量

1. Telemetry 永不成为业务事实源。
2. Trace 只表达有界 Hop；长 Workflow 使用耐久领域 ID。
3. Trace Context 不参与授权、幂等或恢复。
4. Log/Trace/Support Bundle 使用 Allowlist，敏感 Payload 不得输出。
5. 控制面安全变化必须原子产生 Tier A AuditEvent。
6. Domain Fact 与已提交 Outbox Payload 是不可变耐久证据。
7. Available Artifact 必须引用已 Seal/Verify 的不可变 Object。
8. 可声明 Recovery Point 必须同时固定 DB Position 与 Object Coverage Boundary。
9. Migration 正确性来自 Compatibility Window，不来自进程启动顺序。
10. 所有执行与后台 Role 必须验证 Runtime State 与 Generation。
11. Restore 必须在普通应用启动前进入非执行状态。
12. Unknown External Effect 进入 Reconciliation，不盲目 Retry。

## 后果

正面：

- Telemetry 过期或 Collector/Redis 丢失不破坏执行解释。
- 长 Workflow 可以从稳定 ID 下钻到每个 Operational Hop。
- 开源单机部署与内部分角色部署共享同一可靠性协议。
- Migration、Restore 和误启动 Worker 具有 Fail-closed Gate。
- 不再把数据库 PITR 错误等同于 Artifact 全系统 PITR。

代价：

- 需要 Timeline Query、Audit Projector、RuntimeFenceGuard、BackupSet Manifest 和 Restore Drill。
- Audit/Outbox Retention 与 Metric Cardinality 需要专门测试。
- 单机一致 Backup 默认需要维护窗口。
- 生产 Role 拆分、Telemetry Backend 和在线备份由部署者承担。

## 不采用

- 一个跨数日 Trace 或万能 Correlation ID。
- OTel Log SDK 作为 V0 唯一日志链。
- 请求体、Prompt、Header、SQL 参数或 Artifact 内容进入 Telemetry。
- 所有业务变化都同步写 Audit 热点表。
- Health/Queue Event 驱动业务状态。
- App 启动自动 Migration。
- `depends_on: service_completed_successfully` 作为 Release Controller。
- 只备份 MySQL、恢复 Redis Queue Dump，或宣称任意全系统 PITR。
- 恢复后直接启动普通 Server/Worker。
- 依靠单 Worker/单 Scheduler 保证正确性。

## Gate

- Trace Link、Timeline、Leak、Metric Cardinality 和 Collector Down 测试通过。
- Tier A 原子性、Tier B Projector 重放与 Outbox Retention Checkpoint 通过。
- 每个 Role 的 Startup/Ready/Drain/Fence 与 SIGTERM/SIGKILL/Redis Flush 通过。
- Migration Upgrade/Checksum/Compatibility 与双 Migrator测试通过。
- Quiesced BackupSet 完整恢复，Missing Object/KEK/旧 Generation/误 Worker 启动均 Fail Closed。

详细协议见 [OBSERVABILITY-AND-OPERATIONS.md](../OBSERVABILITY-AND-OPERATIONS.md)。
