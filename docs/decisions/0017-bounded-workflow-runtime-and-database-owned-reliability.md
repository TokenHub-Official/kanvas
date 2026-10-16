# ADR-0017：采用有界 Workflow V0 与数据库主导的可靠执行协议

- 状态：Accepted
- 日期：2026-07-27

## 背景

ADR-0009 已确认 Workflow 是动态、声明式、不可变发布的执行定义，ADR-0010 已确认 MySQL 保存 WorkflowRun、NodeRun、CapabilityRun 和 CapabilityAttempt 的执行事实，Redis/BullMQ 只负责投递。此前仍未确定：

- Workflow V0 的最终节点、引用和汇合语义。
- 四层执行对象的状态枚举及单写责任。
- Retry、Lease、Timeout、Cancel、迟到回调和部分成功的精确规则。
- BullMQ 是否承担 Flow、自动 Retry、业务 Lease 或取消事实。
- Redis 丢失后如何仅从 MySQL 恢复非终态执行。

如果这些问题留到业务编码时隐式决定，批量 `map`、Browser 回退、Provider 回调和人工 Approval 会分别创造不兼容的执行路径。

## 决策

### 1. Workflow V0 是有界声明式图

WorkflowRevision 使用 JSON Schema 2020-12 校验。V0 只有四种节点：

- `invoke`：调用一个固定 CapabilityContractRevision。
- `map`：对有界集合执行一个内联 `invoke`，使用稳定 Scope Key，禁止嵌套。
- `switch`：使用受限比较操作符选择输出边。
- `approval`：创建绑定 Revision、Node Input、Execution Plan 和 Decision Schema 的人工决策。

不建立显式 `parallel` 或 `join` 节点。一个节点激活多条输出边即形成固定并行；具有多个已激活输入边的节点通过 `joinPolicy = all_success | all_settled` 汇合。只等待本次运行中已激活的输入边，不能等待未被 `switch` 选中的静态边。

这项决策细化 ADR-0009 中“`parallel/join` 节点”的表述：保留有界并行与汇合能力，但不增加两类运行时节点。

### 2. 数据引用不是表达式语言

节点输入、Map Item、Switch Value 和 Workflow Output 使用 Tagged Value Reference 与 RFC 6901 JSON Pointer。来源只允许：

- Workflow Input。
- 已完成 Node Output。
- 任意终态 Node Result Envelope。
- 当前 Map Item。
- Literal。

不支持字符串插值、`eval`、CEL、JSONata、JMESPath、环境变量、Secret 或任意 Runtime Variable。Secret、Workspace、Subject、Credential 和其他受控上下文由执行层注入，不能由 Workflow 数据引用。

### 3. 状态与结果分离

| 对象              | Lifecycle Status                                                           | 正交字段                                                     |
| ----------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------ |
| WorkflowRun       | `queued / running / waiting / cancelling / completed / failed / cancelled` | `outcome`, `waitingReason`, `cancelRequestedAt`              |
| NodeRun           | `pending / running / waiting / completed / failed / cancelled / skipped`   | `waitingReason`, `scopeKey`                                  |
| CapabilityRun     | `queued / running / completed / failed / cancelled`                        | `currentAttemptId`, `acceptedAttemptId`, `cancelRequestedAt` |
| CapabilityAttempt | `created / running / completed / failed / cancelled / abandoned`           | `sideEffectState`, `retryDisposition`, Lease/Fence           |

Workflow Outcome 固定为：

```text
full_success | partial_success | no_usable_output
```

- 只有终态 WorkflowRun 可以具有 Outcome。
- `completed + full_success` 和 `completed + partial_success` 合法。
- `failed + no_usable_output` 合法。
- `cancelled` 的 Outcome 为 `null`；已提交 Artifact 保留，但取消不自动接受或交付它们。
- `waitingReason` 在 V0 只允许 `approval`，Retry Backoff 和 Provider Callback 不伪装成人工等待。
- `abandoned` 表示 Attempt 的可信执行所有权因 Lease/Deadline 丢失；外部效果是否发生由 `sideEffectState = not_started | started | committed | unknown` 单独表达。

四层不是同一个状态机的复制：Workflow/Node 表达编排，CapabilityRun 表达逻辑调用，Attempt 表达真实副作用所有权，任何一层不得用来替代另一层的事实。

### 4. 单写责任

- Workflow Orchestrator 单写 WorkflowRun、NodeRun 和激活边；“单写”是事务入口，不是单进程或全局锁。
- Execution Service 写 CapabilityRun、CapabilityAttempt、Lease、Retry 决策和取消意图。
- Approval Service 写 ApprovalRequest 和不可变 ApprovalDecision。
- `CompleteAttempt` 写 Attempt、CapabilityRun、StoredObject、Artifact、AttemptOutput、Usage 和 Outbox，但不写 NodeRun/WorkflowRun。
- Orchestrator 只在 Run Start、CapabilityRun Terminal、ApprovalDecision、Cancel 等真实业务事实出现时被唤醒；重复或过期唤醒通过 Inbox/CAS 变成 No-op。
- Reconciler 只能调用相同 Application Command 修复过期 Lease、漏投递和取消 Deadline，不能直接改写业务表。

### 5. Retry、Lease 与完成

- Scheduler/Execution Service 在 MySQL 事务中创建 Attempt 与 Dispatch Outbox；Queue Job 只携带 ID。
- Worker 必须先以 Attempt Status、CapabilityRun `currentAttemptId`、Lease Generation 和 Opaque Fencing Token 做数据库 CAS，成功后才能执行。
- BullMQ Lock 与 Domain Lease 完全独立，不能用于 `CompleteAttempt` 授权。
- 每次领域 Retry 创建新的 Attempt，旧 Attempt 永不重开。
- Attempt 失败或 Lease Reaper 事务根据 ExecutionPlanSnapshot 中固定的 RetryPolicy：
  - 终结 CapabilityRun；或
  - 创建唯一的下一 Attempt、`notBefore` 与 Outbox `availableAt`。
- CapabilityRun 在 Retry 间保持 `running`，不先标记 `failed` 再扫描复活。
- `idempotencyMode = intrinsic | keyed | non_idempotent`。非幂等调用在 `sideEffectState = unknown` 时禁止自动 Retry，转入人工恢复。
- `CompleteAttempt` 只有在 Attempt 正在运行、Lease/Fence 有效、没有先到的取消、仍是 `currentAttemptId` 且 `acceptedAttemptId` 为空时才能采纳。
- 一个 CapabilityRun 最多采纳一个 Attempt；迟到输出只能记录 Observation/Diagnostic，不能创建正式 Artifact。

### 6. 取消和竞态

- Workflow Cancel 先写 `cancelRequestedAt` 并转入 `cancelling`，停止创建新工作，再向活动 CapabilityRun/Attempt 传播取消意图。
- Worker 的 AbortSignal、Provider Cancel 和 BullMQ 本机 `cancelJob` 只是协作式加速，不是取消事实源；BullMQ 只能取消当前 Worker 上活动的 Job，不能替代分布式取消协议。
- Complete 与 Cancel 的数据库事务先后决定结果：
  - Complete 先提交：已采纳 Artifact 保留，Cancel 阻断后续节点。
  - Cancel 先提交：Complete 不能采纳，上传对象进入临时清理。
- WorkflowRun 只有在没有可提交的活动 Attempt，或取消 Deadline 将其标记 `abandoned` 后，才能进入 `cancelled`。
- 终态 Run 永不重开。人工“重试失败项”创建新的 `retryOfWorkflowRunId` Run 和新 ExecutionPlanSnapshot。

### 7. BullMQ 边界与拓扑

BullMQ 被接受为 V0 队列实现，但不承担 Workflow Engine：

- 固定两个逻辑队列：`orchestration` 和 `execution`。Browser Attempt 通过服务端 Claim/Heartbeat 协议领取，不伪装成 BullMQ Worker。
- 不使用 BullMQ Flow 表达 Workflow Graph。
- Job `attempts` 显式为 `1`；业务 Retry 由新 CapabilityAttempt 表达。Outbox Relay 自己重试 enqueue 网络错误。
- stalled 重新投递必须先经过 Attempt Claim；参数 `maxStalledCount` 通过 Spike 调整，不能改变业务语义。
- 不使用 BullMQ Job ID 或 Deduplication 证明 Exactly-once；它们会受 Queue Scope、TTL 和 Job Removal 影响。
- `removeOnComplete`/`removeOnFail` 使用 Age + Count 有界保留，兼顾短期诊断；MySQL 保存长期事实。
- BullMQ Queue Event 只用于 Metric/Log，不能推进 NodeRun 或 WorkflowRun。
- Job Timeout 使用数据库 `executionDeadline`、Lease、AbortSignal 和 Reaper；不依赖 BullMQ 提供业务 Deadline。

执行资源需要隔离时，可以把 `execution` 拆成固定、部署配置允许的 Lane；禁止按 Workspace、Workflow 或 Capability 动态创建无界队列。

### 8. 部分成功、Fail-fast 与输出

- `map.failureMode = collect_all` 等待所有已创建 Scope 终结并输出结构化成功/失败集合；单项失败不自动使 Workflow 失败。
- `map.failureMode = fail_fast` 在首个失败后停止创建新 Scope，并协作取消活动 Scope；已提交输出不回滚。
- `joinPolicy = all_success` 要求所有已激活前驱成功完成。
- `joinPolicy = all_settled` 等待所有已激活前驱进入终态，并由下游读取结构化结果。
- Workflow Output 是 Required/Optional Value Selection，并在终结前通过 Output Schema。
- 所有 Required Output 可解析且没有允许的缺失/失败时为 `full_success`；Required Output 合法但存在被策略允许的单项失败、排除或 Optional Output 失败时为 `partial_success`；无法形成任何符合声明的 Required Usable Output 时为 `failed + no_usable_output`。

## 关键不变量

1. WorkflowRun 固定 WorkflowRevision、ExecutionPlanSnapshot 和 Contract Digest。
2. `UNIQUE(workflow_run_id, node_key, scope_key)`。
3. 同一 NodeRun 的固定调用槽只创建一个 CapabilityRun。
4. `UNIQUE(capability_run_id, attempt_number)`。
5. CapabilityRun 的 `currentAttemptId` 只能通过 Version/CAS 前移。
6. `acceptedAttemptId` 只能从 `null` 设置为属于当前 CapabilityRun 的已完成 Attempt，之后不可覆盖。
7. Attempt Claim/Heartbeat/Complete 必须匹配 Lease Generation 与 Token，且 Lease 不得超过 Execution Deadline。
8. `UNIQUE(capability_attempt_id, output_role, output_index)`。
9. 一个 ApprovalRequest 最多有一个有效 ApprovalDecision。
10. Outbox Event 与 Inbox Receipt 使用稳定 Event ID/Consumer ID 去重。
11. WorkflowRun、NodeRun、CapabilityRun 和 Attempt 的终态不可逆。
12. 任何 MySQL 业务事务内都不调用 Provider、对象存储、Redis 或 Browser。

## 后果

### 正面

- 场景 A 的批量、Browser 回退、人工 Mask 修正、部分成功和取消具有单一协议。
- Redis 清空、Job 重投或 Worker 崩溃不会改变业务事实。
- V0 保留有界并行能力，但避免 Parallel/Join/Expression/Compensation DSL 膨胀。
- 未来更换队列或引入持久化执行引擎时，仍必须适配相同领域事实。

### 代价

- 需要实现 Orchestrator、Execution Service、Outbox Relay、Lease Reaper 和 Reconciler 的清晰事务入口。
- Queue Job 完成与业务完成不再等价，运维界面必须同时展示 Transport 与 Domain 诊断。
- Timeout、取消和非幂等 Provider 会产生需要人工处理的 Unknown Side Effect。

## 不采用

- **BullMQ Flow 作为 Workflow Runtime**：Redis Flow State 不能取代 MySQL Revision、Approval、Artifact、Usage 和恢复事实。
- **BullMQ 自动 Attempts 作为业务 Retry**：会复用同一 Transport Job，无法表达新的 Attempt、路由、成本和副作用认知。
- **显式 Parallel/Join 节点**：V0 用激活边与 Join Policy 表达相同有界语义。
- **通用表达式语言**：增加安全、类型、调试与跨语言成本，V0 Tagged Value Reference 足够。
- **终态 Run 原地 Retry**：破坏不可逆历史和执行计划审计。
- **通用 Saga/Compensation DSL**：AI 与媒体副作用通常不可回滚，V0 保留 Artifact 并显式恢复。

## 必须完成的 Durability / Chaos Gate

1. Outbox 已提交但 Relay 在 enqueue 前崩溃。
2. enqueue 成功但 Relay 在 `publishedAt` 前崩溃。
3. `publishedAt` 已写入后 Redis 全量丢失。
4. 同一 Job 在保留期内及清理后被重复加入。
5. Attempt Claim 成功后 Worker 在外部调用前崩溃。
6. 外部调用已开始但 Provider Request ID 尚未持久化时崩溃。
7. 对象上传成功但 `CompleteAttempt` 前崩溃。
8. 两个 `CompleteAttempt`、两个 Lease Reaper 或 Retry 创建并发竞争。
9. 旧 Worker Lease 过期后，新 Attempt 已启动，旧 Worker 再完成。
10. Cancel 与 Complete 分别以两种事务顺序竞争。
11. Timeout/Abandon 后 Provider 重复或迟到回调。
12. 两个用户并发提交不同 ApprovalDecision。
13. Orchestrator 收到重复、乱序和旧 Aggregate Version Wake-up。
14. MySQL Commit 成功但客户端未收到确认。
15. Worker Graceful Shutdown 超时并最终丢失 BullMQ Lock。
16. 非幂等 Provider 在 Unknown Side Effect 下不会自动 Retry。

参数性结论——Lease Duration、Renew Interval、Attempt Deadline、Retry Backoff/Jitter、Outbox Batch/Poll/Lease、Orchestrator Batch、Map Limit/Concurrency、BullMQ Retention/Stalled 设置——必须由 Spike 测量并配置化，不在 ADR 写死。

详细协议和状态转移见 [WORKFLOW-EXECUTION.md](../WORKFLOW-EXECUTION.md)。
