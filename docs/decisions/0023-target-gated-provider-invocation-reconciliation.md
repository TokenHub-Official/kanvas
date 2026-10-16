# ADR-0023：采用 Target Gate 与可查询的 Provider Invocation 事实

- 状态：Accepted
- 日期：2026-07-27

## 背景

ADR-0002 已确认 Browser、Worker、Provider 是同级执行后端，ADR-0017 已确认 MySQL 是执行事实源、Redis/BullMQ 只负责唤醒。实现 Execution Target 路由后又暴露出两个不能留给具体 Provider Adapter 决定的问题：

- 新 Target 若在对应 Runtime 就绪前被 Binding 选中，会产生永久 `created` Attempt 或无 Consumer 的 Queue Backlog。
- Remote Provider 可能已经接受请求，但进程在 Provider Request ID 持久化前崩溃。Timeout、连接中断和 Lease 失效都不能证明副作用没有发生。

SDK 自动 Retry、创建新 Attempt 或切换 Provider 都无法修复这个未知窗口，反而可能重复生成、重复扣费或越过已固定 Route。

## 决策

### 1. Execution Target 必须显式启用

Workflow Engine 默认只启用 `worker`。`provider` 与 `browser` 必须在相应 Runtime、事实表、恢复协议和部署 Gate 就绪后由部署配置显式开启。

Run Start 在同一 MySQL 事务内校验：

```text
ExecutionPlan Binding
= canonical CapabilityBinding
= canonical ImplementationRevision
= Execution Target
= Implementation Digest / Adapter
```

禁用 Target 或事实不一致时，Inbox provisional Receipt、Run/Node/Capability/Attempt 与 Outbox 全部回滚。

Target-aware 版本上线采用：

```text
Drain
→ 停止旧 Orchestrator / Execution / Relay
→ 部署新协议
→ 提升 executionGeneration
→ 最后开放非 Worker Binding
```

V0 不承诺旧二进制与新增 Target 消息的混合版本零停机。

### 2. Worker 与 Provider 使用独立 Transport Route

逻辑队列调整为：

```text
kanvas-orchestration
kanvas-execution
kanvas-provider-execution
```

Worker 与 Provider 使用不同 Queue、Job Name 和稳定 Consumer Name。Browser 不伪装成 Queue Worker，后续通过 Browser Control Plane Claim。

这项决策只修订 ADR-0017 中“固定两个逻辑队列”的数量，不改变 BullMQ 不是业务事实源、Job `attempts=1`、领域 Retry 创建新 Attempt 等规则。

### 3. Provider 身份必须在 Run 创建时冻结

Provider Binding 必须产生严格的 `ProviderRouteSnapshot v1`，至少固定：

- Provider Key 与 API Surface。
- Provider Endpoint。
- Credential Identity 与 Epoch，但不包含 Secret。
- 可选 Model Deployment 与 Pricing Revision。
- Route Candidate Digest 与 Request Scope Digest。
- Query Mode 与 `notFoundIsAuthoritative`。

缺失、畸形或包含未知字段的 Provider Route 不能创建 Run。Dispatch 不得从当前 Active Binding、当前 Credential 或远端模型目录重新选择身份。

### 4. Attempt 与 Invocation 使用 0..1，Observation 使用 1..N

```text
CapabilityRun
  └── CapabilityAttempt 0..1 ProviderInvocation
                            └── ProviderInvocationObservation 1..n
```

`CapabilityAttempt` 仍表示一次真实领域执行。一个 Provider Attempt 在首次外部 I/O 前创建且最多创建一个 `ProviderInvocation`。

Submit、受控的同 Key 重发、Query、Cancel、Callback 与 Fetch 是同一 Invocation 的 Operation/Observation，不创建隐藏 Invocation。领域 Retry 或 Fallback 必须创建新 Attempt；一个 Capability 若语义上需要多个独立外部副作用，应拆成多个 Capability/Workflow 节点。

### 5. 稳定请求身份先于外部调用持久化

Invocation 在外部调用前保存：

```text
requestScopeDigest
stableRequestKey = deterministic(instance namespace, Attempt, Route)
requestFingerprint = digest(pinned route, normalized input)
```

数据库约束：

```text
UNIQUE(capabilityAttemptId)
UNIQUE(requestScopeDigest, stableRequestKey)
```

同 Key 不同 Fingerprint 在网络调用前 Fail Closed。Provider Request ID 是外部关联事实，但默认只建 Scope Index，不假设所有 Provider 都保证其全局唯一。

外部调用永远在 MySQL 事务外进行。调用前先提交 `submission_started` 意图；因此“意图已提交但 Socket 尚未发送”也保守进入 Unknown，而不是声称 `not_started`。

### 6. Unknown 通过独立 Invocation Lease 查询收敛

Provider Invocation 使用独立于 BullMQ Lock 和普通 Attempt Lease 的 Reconciliation Lease：

```text
leaseGeneration
executionGeneration
opaque token hash
leaseExpiresAt
```

Query-capable Provider 在进程/Lease 失效后保持：

```text
Attempt = running
Attempt.sideEffectState = unknown
Invocation = query_pending / query_leased
```

不能先把 Attempt 终结为 `abandoned`，再在 Query 成功后重开。Query 结果统一转为 append-only Observation，再由同一事务中的 Reducer/CAS 更新 Invocation current facts：

- `accepted/running`：继续有界 Query。
- `succeeded`：原子提交 Invocation Terminal、Attempt/Capability Complete、输出事实与 Outbox。
- `failed/cancelled`：按固定策略终结，不由 SDK 隐式 Retry。
- 权威 `not_found`：证明没有远端 Effect 后，才允许终结旧 Attempt 并按 Retry Policy 创建新 Attempt。
- `unknown` 或不可查询：继续有界恢复；达到阈值或 `queryMode=none` 时进入 `manual`。

`provider_request_id` Query 在 ID 尚未持久化的崩溃窗口不可用；只有 `client_request_id` Query 能自动关闭该窗口。

### 7. Callback 与 Query 都不是直接事实源

外部输入处理链固定为：

```text
verify / normalize
→ append Observation
→ Reducer
→ Version + Lease + executionGeneration CAS
```

重复 Observation 由稳定 Key 去重。迟到、乱序、旧 Generation、Cancel-first 或已经 Terminal 的 Observation 可以保留受限摘要与 Adoption Outcome，但不能覆盖当前 Attempt、Accepted Attempt 或终态。

Observation 不保存 Secret、完整 Prompt、原始请求或原始响应。

### 8. Reconciler 必须有界且单候选隔离

Provider Reconciler 只扫描有索引、到期的 `submit_pending/query_pending` 或过期 Invocation Lease，按稳定顺序和 Batch Limit 领取。一个损坏 Candidate 记录稳定错误码并隔离，不能阻断同批健康 Candidate；Runtime Fence 失败仍立即终止整轮。

通用 Attempt Reaper 不处理 Provider Lease Expiry 的自动 Retry，只保留统一 Cancel Deadline 收敛。

## 关键不变量

1. Provider Target 未显式启用时不能创建 Provider Attempt。
2. 一个 Provider Attempt 最多一个 Invocation。
3. 一个 Scope 内 Stable Key 只绑定一个 Request Fingerprint。
4. 外部 I/O 前必须已经有 Invocation 与 Submission Intent。
5. Unknown External Effect 不能触发新 Attempt、Fallback 或第二个 Provider Create。
6. Provider Result 只有通过当前 Invocation Lease、Runtime Fence 和 Capability/Attempt CAS 才能采纳。
7. Attempt 终态不可逆；Query Recovery 在原 Attempt 仍为 `running` 时完成。
8. Redis 清空、重复 Job 和重复 Callback 不改变业务事实。
9. Provider Terminal、Attempt/Capability Terminal、正式输出/Usage/Artifact 与 Outbox 最终必须同事务提交。

## 后果

正面：

- 可解释“Provider 已接受但本地未知”的真实分布式窗口。
- Provider SDK、OpenRouter、TokenHub/NewAPI 和未来 Adapter 共享同一可靠性协议。
- Query/Callback、Cancel 与部署 Generation 的竞态可由 MySQL 测试。
- 未完成的 Browser/Provider Runtime 不会被配置误启用。

代价：

- 增加 Invocation、Observation、独立 Lease、Query Reconciler 与运维指标。
- Provider 若不能按稳定 Client Request ID 查询，部分 Unknown 只能人工恢复。
- Target-aware 协议首次启用需要有界停机升级。

## 不采用

- Attempt 下 1:N 顶层 Provider Invocation。
- Timeout 后直接新 Attempt或自动 Fallback。
- Provider/SDK 隐式 Retry、Fallback 或不可观测路由。
- 将 BullMQ Lock、Job ID 或 Provider Request ID 当作 Exactly-once 证明。
- 在数据库事务中调用 Provider。
- V0 Streaming、模型目录、自动多 Provider 路由、完整计价、Secret 管理或人工恢复 UI。

## Gate

- MySQL 约束、双 Claim、重复 Job、同 Key 不同 Fingerprint和 Observation 去重测试通过。
- `accepted-before-requestId` 崩溃可通过 Client Request ID Query 找回，且远端只创建一次。
- Query 的 `not_found/running/succeeded/failed/unknown` 与 Cancel/Complete 两种提交顺序通过。
- 旧 Lease/Generation、两个 Reconciler、迟到结果均不能覆盖当前事实。
- Provider Consumer 与 Query Reconciler就绪前，Provider Target 保持默认禁用。
