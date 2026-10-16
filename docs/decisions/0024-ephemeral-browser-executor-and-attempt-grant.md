# ADR-0024：采用临时 Browser Executor、Attempt Grant 与数据库租约

- 状态：Accepted
- 日期：2026-07-27

## 背景

ADR-0002 已将 Browser Runtime、Internal Worker 和 Remote Provider 定义为同级执行后端，ADR-0013 与 ADR-0018 又要求 Browser 输出只能通过 Attempt Lease、UploadSession 和事务化 Complete 进入正式 Artifact。

Browser 不是可信计算环境，也不是稳定在线的服务器。页面会刷新、休眠、断网或被关闭，客户端可以伪造能力声明，浏览器暴露的 User-Agent、GPU、屏幕和硬件信息还具有明显的指纹风险。与此同时，专业内部用户的浏览器版本和运行基线可控，WebGPU/WASM 确实可以稳定承载一部分工具型视觉能力，不能把 Browser 简化成普通上传页面。

因此需要一个无 UI 的 Browser Attempt Control Plane，在不建立设备管理平台的前提下解决：

- 运行时与已发布 Browser Implementation 的精确匹配。
- 从 MySQL 领取 Browser Attempt，而不是伪装成 BullMQ Worker。
- Human Session、执行授权和 Attempt Lease 的职责分离。
- 断线、权限撤销、取消、租约失效、Worker 回退和迟到结果仲裁。
- 不采集永久设备身份或原始硬件指纹。

## 决策

### 1. Browser Executor 是临时执行代理，不是 Device

一次页面运行实例注册一个短生命周期 `BrowserExecutorSession`。它固定：

- Workspace 与创建它的 Principal 审计身份。
- Authentication Reference 的不可逆 Hash 与 Authority Version。
- Runtime Release ID/Digest。
- Capability Manifest Version/Digest。
- `active / draining / revoked / closed` 状态与到期时间。

不创建永久 Device ID，不跨 Browser Session 关联设备，也不保存：

- User-Agent。
- GPU Vendor/Model。
- 屏幕尺寸、Canvas Fingerprint。
- Hardware Concurrency、Device Memory。
- IP 衍生设备画像或其他跨会话指纹。

`createdByPrincipalId` 只回答“谁授权创建了这次执行代理”，不表示浏览器属于该 Principal。

### 2. Capability Probe 不是硬件证明

Executor 注册版本化的 `BrowserExecutorCapability`：

```text
ImplementationRevisionId
ImplementationDigest
AdapterKey
Backend = webgpu | wasm
ProbeProfileVersion
ProbeResultDigest
```

Server 只接受当前 Workspace 中已发布、Target 为 Browser 且身份完全一致的 Implementation。Probe 表示“该版本 Runtime 按给定 Profile 自检通过”，不是安全 Attestation；客户端声明仍是不可信提示，最终输出必须通过 Contract、媒体和质量验证。

V0 不持久化原始 Feature/GPU 列表。实现兼容性由已发布 Implementation、Runtime Release 和 Probe Profile 的版本化组合表达。

### 3. Human Session 只签发执行权

注册和 Claim 必须经过当前 Human Session、Workspace Scope、`workflow.run / capability.run` 与当前 Authority Version 授权。

成功 Claim 后签发高熵、Opaque、短期 `AttemptGrant`，只允许：

```text
heartbeat_attempt
prepare_or_upload_declared_output
complete_or_acknowledge_this_attempt
```

并绑定：

```text
workspaceId
attemptId
assignmentId
leaseGeneration
executionGeneration
output scope
expiresAt
```

数据库只保存 Token Hash。一个原始 Grant 可以用域分离派生 Authentication Hash 与 Attempt Lease Hash，但两个用途不能混为可复用的一般 API Token。

Heartbeat、上传和 Complete 不要求 Human Session 持续有效。普通 Logout 不等于撤销已经授权的执行；安全事件或管理员强制撤销必须显式提升 Authority Version、撤销 Executor/Grant，并通过 Heartbeat/Complete Fence 生效。

### 4. Assignment 与 Attempt 分离

`CapabilityAttempt` 继续表示一次领域执行；`BrowserAttemptAssignment` 表示这次 Attempt 的 Browser 调度所有权。

```text
CapabilityAttempt 0..1 BrowserAttemptAssignment
BrowserAttemptAssignment 1..n lifecycle events
```

V0 一个 Browser Attempt 最多创建一个 Assignment，不允许页面刷新后重新取得同一 Attempt 的所有权。Reconnect 创建新的 Executor Session；若旧租约已经失效，Fallback/Retry 必须创建新的 Attempt。

Assignment 保存当前投影：

- Executor Session。
- Attempt Lease Generation。
- Server Execution Generation。
- Attempt Grant Hash。
- Lease、Heartbeat 和 Terminal 时间。
- `active / cancel_requested / completed / failed / fenced / expired / revoked`。

只为 Claim、Cancel Signal 和 Terminal/Fence 写 append-only Event。每次 Heartbeat 只更新有界投影与指标，不制造无限审计事件。

### 5. Browser Claim 直接以 MySQL 仲裁

Browser 不创建或消费 Attempt Dispatch Queue。Claim 从可信 Workspace Scope 内有界扫描：

```text
Attempt.target = browser
AND Attempt.status = created
AND notBefore <= now
AND CapabilityRun.currentAttemptId = Attempt.id
AND CapabilityRun.status = queued
AND no cancel / accepted result
AND exact Session Capability exists
```

候选只是提示。真正 Claim 在短事务内按统一锁序：

```text
CapabilityRun
→ CapabilityAttempt
→ CapabilityImplementationRevision
→ BrowserExecutorSession
```

重新验证：

- Workspace、Current Attempt、状态、取消和 Deadline。
- Execution Target Gate。
- ExecutionPlanSnapshot、Contract/Binding/Implementation ID、Digest、Adapter 与 Target。
- Executor Session 仍 Active、未到期且没有另一条活动 Assignment。
- Human Authentication Reference 与 Authority Version 仍匹配。

随后原子：

- `Attempt created → running`。
- 增加 Lease Generation，保存 Lease Token Hash、Lease/Execution Deadline。
- `CapabilityRun queued → running`。
- 创建 Assignment、Grant Hash 与 `claimed` Event。

一个 Session 在 V0 同时最多拥有一个 Active/Cancel-requested Assignment。需要浏览器并行时使用多个明确 Executor，避免在首版引入客户端 GPU 调度器。

### 6. Heartbeat 使用 Grant、Lease 与双代际 Fence

Heartbeat 不依赖 Redis，也不依赖 Human Session。短事务按：

```text
CapabilityRun
→ CapabilityAttempt
→ BrowserAttemptAssignment
→ BrowserExecutorSession
```

验证：

- Attempt Grant Hash。
- Attempt Lease Token Hash 与 Lease Generation。
- Server Execution Generation。
- Current Attempt、Assignment、Workspace 和 Execution Target。
- 当前 Lease 尚未过期，新 Lease 单调延长且不超过 Execution Deadline。
- Executor 未 Revoked/Closed，Grant/Session 未到期。

结果只允许：

```text
renewed
cancel_requested
revoked
rejected
```

Draining 只阻止新 Claim，不中断已经领取的 Attempt。Revoked/Closed 使现有执行失去提交资格，并将其交给 Lease/Reconciler 收敛。

### 7. 上传不是提交，Complete 才决定业务可见性

Browser 不通过 Control-plane JSON 上传大对象。输出先进入 Attempt 绑定的 UploadSession；客户端只提交有界 Canonical Completion Manifest。

Complete 必须遵守 ADR-0018 的锁序：

```text
CapabilityRun
→ CapabilityAttempt
→ BrowserAttemptAssignment
→ BrowserExecutorSession
→ UploadSession（按 ID）
```

Implementation 只在 Claim 时按上述顺序锁定其可变 Lifecycle 行；ExecutionPlan、Binding、Node 与 Workflow Context 使用已钉死事实的一致性读取，避免与 `Workflow → CapabilityRun` 的取消事务形成锁序反转。Complete 同时锁定 Executor Session，验证其未 Revoked/Closed，避免读取 Active 后被并发撤销的 TOCTOU。在一个 MySQL 事务内创建 StoredObject、Artifact、AttemptOutput、Usage、Outbox，并终结 Attempt、CapabilityRun、Assignment 与 UploadSession。

Presigned URL 或对象写入成功不表示 Result 被接受。旧 Assignment 可以留下尚未提交的对象，但迟到 Complete 只能得到 Fence/Conflict，这些对象继续归 UploadSession 并由 GC 回收。

### 8. Lease 失效后才允许 Fallback

Browser Lease 失效时，Reconciler 先终结旧 Browser Attempt，再按 ExecutionPlanSnapshot 中固定的 Retry/Fallback Policy 创建新的 Worker Attempt。不能让 Browser 与 Worker 共享同一个 Attempt。

竞态由同一锁序和条件更新决定：

```text
Browser Complete 先提交
→ acceptedAttemptId = Browser Attempt
→ Reconciler 不再创建 Fallback

Reconciler 先提交新 Current Attempt
→ 旧 Browser Complete 的 Current/Lease Fence 失败
→ Worker 才可能被采纳
```

最终仍由 `acceptedAttemptId` 保证一个 CapabilityRun 最多采纳一个 Attempt，但不能省略 Current Attempt、Lease、Cancel 和 Generation 校验。

## 关键不变量

1. Browser Target 未显式启用时不能创建或领取 Browser Attempt。
2. BrowserExecutorSession 不是永久 Device，不能保存可用于跨会话指纹化的原始硬件事实。
3. 一个 Browser Attempt 最多一个 Assignment；Reconnect 不恢复旧 Ownership。
4. 一个 V0 Executor 同时最多一个活动 Assignment。
5. Claim 需要 Human Session；执行阶段只接受受限 Attempt Grant。
6. Grant、Lease Generation 和 Execution Generation 任一不匹配都不能续租或提交。
7. Browser 不访问 Redis，不产生 Attempt Dispatch Outbox。
8. 上传对象在 Complete 事务成功前不成为 StoredObject/Artifact。
9. Lease 失效、Cancel 或 Revocation 后的迟到结果不能覆盖 Current/Accepted Attempt。
10. Browser 输出和能力声明都必须经过服务端版本、Contract、媒体和策略验证。

## 不采用

- 永久 Device Identity、设备配对或 Browser Fleet 管理。
- User-Agent/GPU/Canvas/Screen 指纹。
- WebSocket 编排、Push 唤醒或 Service Worker 长任务续跑。
- 浏览器 GPU 调度器、跨 Tab 抢占或同 Attempt Ownership 恢复。
- 每次 Claim 都携带一份无状态签名 Manifest 而不建立 Executor Session。
- 将 Human Session Cookie 当作长任务 Lease。
- 将 Presigned Upload、客户端 Hash 或 Browser Probe 当作可信完成证明。

## Gate

- 两个 Executor 并发 Claim 同一 Attempt，只能一个成功。
- 同一 Executor 并发 Claim 两个 Attempt，只能一个活动 Assignment。
- 旧 Grant、Lease Token、Lease Generation、Execution Generation 和已到期 Session 全部 Fail Closed。
- Heartbeat/Cancel、Complete/Cancel、Complete/Fallback 和 Browser/Worker Complete 竞态可重复通过。
- Logout 后有效 Grant 可以收敛；显式安全撤销后 Heartbeat/Complete 被拒绝。
- Workspace A 的 Session/Grant 不能观察或操作 Workspace B。
- Redis 完全不可用时 Browser Claim/Heartbeat 仍工作。
- MySQL 在 Claim/Complete 任一写点崩溃不产生 Ghost Assignment 或部分正式 Artifact。

详细协议见 [BROWSER-RUNTIME-CONTROL-PLANE.md](../BROWSER-RUNTIME-CONTROL-PLANE.md)。
