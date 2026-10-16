# ADR-0020：版本化配置、Secret Reference 与显式 Provider 路由

- 状态：Accepted
- 日期：2026-07-27
- 修订：数据库托管 Secret 的默认静态存储方式已由
  [ADR-0027](0027-optional-provider-secret-encryption.md) 部分替代；版本固定、
  轮换、吊销、Resolver 与 Provider 路由不变量继续有效。

## 背景

Kanvas 的 Capability 可以运行在 Browser、Internal Worker 和多个 Remote Provider。内部 TokenHub/NewAPI、OpenAI、OpenRouter 与开源自部署 Endpoint 在协议、能力、价格、数据出口、错误和回退上不同。若把配置做成任意 Key/Value 覆盖、在 Dispatch 时重新选择 Credential/模型，或让 SDK/Gateway 隐式 Retry，会使同一 Run 的身份、费用和副作用不可解释。

平台还必须允许安全吊销即时生效，同时保持普通轮换、Retry 和历史审计的确定性。

## 决策

### 1. 配置使用固定责任层和约束求交

Deployment Config、Instance Policy Revision、Workspace Policy Revision 和 Capability Binding 分离。安全、预算、数据出口和资源上限通过约束求交，只能收紧；仅代码明确允许的默认标量可以覆盖。

V0 不实现通用配置 DSL、任意深合并或动态 Schema Registry。四个固定配置域使用代码内类型、合并函数和发布校验。

Published Policy/Route/Model/Pricing Revision 不可修改。Run Snapshot 保存引用、Digest 和有序候选链；普通配置更新只影响新 Run。

### 2. Credential 身份与 Secret 材料分离

Credential 表达 Provider Account、Authority、Billing 和 Egress Identity；SecretVersion 表达不可变认证材料。账号、权限、计费或出口身份改变必须创建新 Credential。

V0 支持 `encrypted_database` 与 `deployment_reference`。数据库材料采用每版本随机 DEK、AES-256-GCM、KEK 包裹和绑定 Scope/Identity 的 AAD；KEK 不进入数据库。Secret 明文不进入 API Response、Snapshot、Queue、Log、Trace、Audit 或 Support Bundle。

ExecutionPlanSnapshot 固定 Credential ID、Epoch 与 Pinned SecretVersion ID，不固定材料。Attempt 不得静默解析更新的 Active Version；Dispatch 同时验证 Credential、Pinned Version、Endpoint、Authority、Egress 和 Budget 当前仍允许。

常规轮换允许旧版本在绝对 `drainDeadline` 前为已 Pin 的 Run 创建 Attempt；新 Run 只选择新版本。安全吊销立即 Revoke，无 Drain；Revoke Version 永不重新 Active，恢复必须产生新 Version/Epoch。

OAuth 固定身份、Issuer/Audience/Client 和 Auth Policy Revision，动态解析短时 Token；Token Scope 不能超出 Snapshot。

### 3. Provider Adapter 与模型事实分层

代码注册受信 Adapter Descriptor，数据库保存 ProviderEndpoint。首批 Adapter：

- OpenAI Native，分别建模 Responses 与 Images API Surface。
- OpenRouter Native，处理其路由、Typed Error、流中错误、Usage 和实际上游。
- Generic OpenAI-compatible，TokenHub/NewAPI 是可替换 Preset/Gateway Profile。

“OpenAI-compatible”不表示能力兼容。远端模型发现只进入 TTL Cache/Staging；只有经过 Probe/人工/Eval 证据批准的 ModelProfileRevision 与 ModelDeployment 可以执行。PricingRevision 不可变，历史 Usage 不随新价格重算。

ImplementationRevision 固定 Adapter/API Surface、默认参数、Mapper、Parser、Stream/Error Normalization、Idempotency 与 Artifact 映射。Provider/AI SDK 可以用于实现，但不得成为领域边界或自行进行未建模 Retry/Fallback。

### 4. Retry、Fallback 与 Gateway Routing 显式化

Run Snapshot 固定有序 RouteCandidate。Retry 保持 Candidate；Fallback 只前移到已固定的下一 Candidate，并要求允许的错误类别、非 Unknown Side Effect、当前授权和剩余预算。

Timeout、断流或 Gateway 失联不证明未执行；无法 Query/Reconcile 时禁止自动 Fallback。

Gateway Candidate 声明 `KANVAS_FIXED | GATEWAY_MANAGED` 与 `FULL | PARTIAL | OPAQUE` 透明度。Gateway-managed Route 作为单个不透明候选，记录 Requested/Actual Model/Provider；无可验证费用上界时不能进入 Hard-budget 自动链。禁止同时依赖 Kanvas Fallback 和未建模的 Gateway 隐式 Fallback。

### 5. 预算使用 Reservation 与 Append-only Usage

Run 创建估算，Dispatch 前在 MySQL 预留预算。Attempt 完成后以不可变 PricingRevision 对 Provider Reported Usage/Charge 和 Kanvas Calculated Cost 对账。

费用未知时保留 Unknown Hold 并阻断新的付费 Fallback。UsageLedger Append-only，更正使用 Adjustment Entry，不覆盖历史事实。

## 关键不变量

1. ExecutionPlanSnapshot 发布后不可变。
2. Attempt 只能执行 Snapshot 中的 RouteCandidate。
3. Credential Resolve 不得静默选择更新的 SecretVersion。
4. Secret Rotation 不改变 Credential Identity；Identity 改变必须 Replace Credential。
5. Revoke SecretVersion 永不可执行，Draining Version 必须有绝对 Dispatch Deadline。
6. OAuth 固定授权含义，不固定短时 Token 材料。
7. Discovery、Provider Claim 和动态价格不能直接改变执行。
8. Unknown External Side Effect 禁止自动 Retry/Fallback，除非有可验证幂等证明。
9. Hard-budget Route 必须有可验证费用上界。
10. 任一拒绝路径不得先解密 Secret 或发起 Provider Request。

## 后果

正面：

- 普通轮换、紧急吊销、Retry 和审计具有明确边界。
- TokenHub/NewAPI 是默认可选渠道，不成为核心依赖。
- Provider 漂移、双层路由与后补费用可以显式表达。
- 内部和开源自部署共享同一协议与 Secret Port。

代价：

- Provider/Model/Pricing 发布和 Credential 轮换需要显式状态机。
- 长时间等待的 Run 可能因 Secret Retire 或策略收紧而需要重新计划。
- Gateway-managed Route 只能提供受限可解释性。
- 预算预留与 Unknown Cost Reconciliation 增加实现成本。

## 不采用

- 通用配置 Key/Value、任意深合并和 Policy DSL。
- Secret Reveal API、明文日志或 Queue Payload Credential。
- Dispatch 时重新选择 Active Credential/Model。
- Provider `/models` 自动进入可执行目录。
- 所有供应商统一为一个 OpenAI DTO 或万能 `generate()`。
- SDK、OpenRouter 或 NewAPI 的不可见默认 Retry/Fallback。
- Timeout 后直接切换 Provider。
- ProviderDefinition、Discovery Candidate、Capability Evidence 和 Invocation Profile 的 V0 独立表。

## Gate

- Config Merge/Revision Digest、Secret Envelope/Rotation/Revoke、Endpoint SSRF 与 Provider Contract 测试通过。
- OpenAI Responses/Images、OpenRouter Routing/Stream Error、Generic Compatible Feature Probe 通过。
- 并发 Budget Reservation、Unknown Cost、Usage Adjustment 和 Unknown Side Effect 恢复通过。
- 任一调用都能关联 Run、Attempt、Endpoint、Requested/Actual Model、Credential Version Identity、PricingRevision 和 Provider Request ID。

详细协议见 [CONFIG-SECRETS-PROVIDERS.md](../CONFIG-SECRETS-PROVIDERS.md)。
