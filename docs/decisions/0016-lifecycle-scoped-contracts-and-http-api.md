# ADR-0016：采用生命周期分层的 Contract Authority 与 Schema 驱动 HTTP API

- 状态：Accepted
- 日期：2026-07-27

## 背景

Kanvas 的协议不只服务于 NestJS HTTP Server。Web、Server、Worker、未来 Python/GPU Worker、动态 Workflow/Skill、Agent Tool 和开源 Scenario Pack 都需要消费可存储、可验证、可版本化的契约。

以 Nest Class DTO、TypeScript Interface、OpenAPI 或某个 Agent Provider 的 Tool Schema 作为唯一事实源，会产生跨语言丢失、运行时不可验证或供应商绑定。简单宣称某个 JSON 文件永远是唯一事实源，又会混淆内置代码契约、数据库动态 Draft、已发布 Revision 和历史执行事实。

## 决策

### 1. Contract Authority 按生命周期划分

Kanvas 不定义跨所有生命周期的万能文件真源，而为每一阶段指定唯一权威：

| 生命周期                            | Authority                                           |
| ----------------------------------- | --------------------------------------------------- |
| 内置契约开发                        | TypeBox TypeScript Source                           |
| 内置契约分发与运行时                | 确定性生成、禁止手改的 JSON Schema 2020-12 Artifact |
| 动态 Workflow/Skill/Capability 编辑 | 数据库中的 Draft/Candidate JSON Schema              |
| 发布                                | 带 Canonical Digest 的不可变 ContractRevision       |
| 执行与审计                          | Run 固定引用的 ContractRevision 与 Digest           |

相同 `contractId + revision` 必须对应相同 Canonical Digest。Repository Artifact 与数据库 Revision 不做隐式合并；发生冲突时拒绝启动、发布或执行。

### 2. Schema 技术

- 使用 JSON Schema Draft 2020-12 作为可交换的 Canonical Contract Format。
- 内置契约使用 TypeBox 编写并确定性导出 JSON Schema；TypeBox 精确版本在脚手架按稳定 TypeScript 版本选择并锁定，不追随 `latest`。
- 动态契约直接以受控 JSON Schema 编辑、校验、发布，不要求反向生成 TypeBox。
- AJV 2020 负责运行时验证。Zod 不作为平台契约、HTTP DTO 或动态 Schema 的第二套默认事实源。
- OpenAPI 3.1、Agent/Provider Tool Schema、表单数据 Schema 和前端 TypeScript 类型都是 Canonical Contract 的投影，不得反向修改源契约。

### 3. HTTP Contract Registry

`packages/contracts` 维护无框架依赖的 Route Contract，包含 `operationId`、method、OpenAPI 风格 path、request schemas、response schemas、安全、幂等和分页元数据。

`apps/server` 提供很薄的 Nest/Fastify Adapter：

- 一个组合 Decorator 从 Route Contract 同时生成 Nest Route Binding 和 Contract Metadata；Controller 不再重复写 `@Post('/path')`。
- Pipe/Guard/Interceptor 绑定已编译 AJV Validator、授权和响应验证。
- OpenAPI 3.1 从同一 Registry 确定性生成并由标准 OpenAPI 工具校验。

不自建通用 Router、JSON Schema Validator、OpenAPI Parser 或 Client Generator，也不让第三方 Nest-TypeBox Adapter 成为架构依赖。Adapter 的可行性必须在空脚手架 Gate 中证明。

### 4. HTTP V0 约定

- 公共 REST 基线路径为 `/api/v1`；WorkflowRevision、CapabilityContractRevision 等内容 Revision 与 URL Major 独立演进。
- 长任务通过资源化 Run API 创建，成功受理返回 `202 Accepted`、`Location` 和最小 Run View；不使用 `/execute` 风格 RPC，也不以 HTTP 请求保持执行生命周期。
- 错误使用 RFC 9457 `application/problem+json`，并增加稳定 `code`、`traceId` 和可选 JSON Pointer `errors`。
- 列表使用不透明 Cursor；Cursor 绑定排序、过滤条件和稳定 Tie-breaker，不默认返回昂贵的总数。
- 会创建副作用的 POST 按 Route Contract 要求 `Idempotency-Key`。同 Key 同请求重放原响应；同 Key 不同请求返回 `409`；处理中重试返回 `409` 和 `Retry-After`。
- 并发敏感 Draft 的修改使用强、Opaque `ETag`/`If-Match`；缺失返回 `428`，不匹配返回 `412`。
- 批量异步任务的逐项成功或失败属于 Run/Item Outcome，不使用 `207 Multi-Status` 表达后台执行结果。

### 5. Runtime Validation 与安全

- 内置可信 Schema 和动态作者 Schema 使用不同的编译策略。
- 内置 HTTP Contract 在启动/构建阶段编译，设置 `strict: true`、`coerceTypes: false`、`removeAdditional: false`、`useDefaults: false`；在请求大小受限时使用 `allErrors: true`。
- 动态 Schema 只有通过 Keyword Policy、大小/深度/正则复杂度预算、引用闭包、AJV 编译和发布检查后才能形成 Revision。
- 动态 Schema 禁止远程或文件 `$ref`、`loadSchema` 和请求路径即时编译；运行时只能按 Revision/Digest 读取已审批的编译缓存。
- 数据库存在性、权限、额度和其他异步业务规则不放入 AJV。
- 所有小型 JSON Control-plane Response 在生产验证；Binary、Artifact Stream、对象存储重定向不经过 AJV Response Validation。
- 服务端响应不符合契约属于实现错误：发送前终止并返回 `500` Problem，同时记录 `operationId`、schema revision/digest、AJV error 和 `traceId`，不得向客户端暴露内部校验细节。

### 6. Agent Tool Projection

Agent/Provider Tool Schema 是有损、供应商相关的提示层，不是授权或验证边界。

- 用户意图字段可以投影。
- Workspace、Subject、Credential、Billing、Permission、Execution Target 等字段只能由服务器注入。
- 无法安全表达、会改变授权/计费/执行语义或目标 Provider 不支持的结构必须拒绝暴露。
- 所有模型生成参数在执行前必须重新通过 Canonical Validator、Authorization 和 Policy Check。

当投影不能证明 `AcceptedByProjection` 是 Canonical Schema 的子集时可以保留降级投影，但必须把丢失约束记录为 Projection Diagnostic，且不能跳过二次验证。

### 7. 前端生成链

- Repository 提交确定性生成的 `openapi.json` 和 `openapi-typescript` 类型声明，并由 CI 重生成后检查零 Drift。
- 不提交生成的 Runtime Client，不在 V0 创建独立 `api-client` Package。
- Web 使用很薄的本地 Fetch Transport 处理认证、Request ID、Abort、Problem Details 和显式重试策略。
- TanStack Query Key、Cache Policy 和 Hook 由 Web 按用户旅程维护，不从 OpenAPI 自动生成。

## 后果

### 正面

- 同一契约可以被 TypeScript、Python、浏览器、Worker 和 Agent 投影消费。
- HTTP 框架、供应商 Tool Schema 和数据库 Revision 不再争夺领域事实源。
- 已发布执行可以固定 Revision 与 Digest，支持重放、审计和兼容性检查。
- OpenAPI 和前端类型可以在 PR 中审阅并由 CI 防漂移。

### 代价

- 需要维护 Contract Publication、Canonicalization、Digest、Projection Diagnostic 和兼容性治理。
- Nest/Fastify 需要一个自有但很薄的绑定层，并必须通过真实启动测试。
- 动态 Schema 的安全预算、缓存淘汰和 Provider 投影矩阵需要持续测试。

## 放弃方案

- **Nest Class DTO + `@nestjs/swagger` 为事实源**：依赖 Reflection/Decorator，跨语言与动态契约能力不足，并会与 Workflow/Capability Schema 重复。
- **Zod 4 作为统一平台契约**：本地表单体验很好，但 transform/refinement 不能完整投影到 JSON Schema，反向转换仍不应作为平台基线。
- **手写全部 JSON Schema**：动态契约必须支持，但内置 TypeScript 契约完全手写会失去静态推断和维护体验。
- **Fastify Route Schema 为唯一入口**：Fastify 原生能力优秀，但 Nest 不会自动把独立 Contract 注入 Fastify，且协议还需服务非 HTTP 消费者。
- **OpenAPI 为领域事实源**：OpenAPI 是 HTTP Projection，无法承担 Workflow、Capability、Event 与 Agent 的完整语义。
- **采用 `openapi-fetch` 作为 V0 Runtime Client**：其维护状态不适合作为新平台默认运行时依赖；V0 使用生成类型和本地 Fetch Transport。
- **Hey API 作为 V0 基线**：功能完整但当前演进面较大，保留为第二消费者或公开 SDK 出现后的重评候选。

## 必须通过的脚手架 Gate

1. TypeBox 到 JSON Schema 的生成在固定版本下确定且无 Drift。
2. AJV 2020 strict 能拒绝未知 Keyword、额外字段和错误格式，且不修改输入。
3. 一个 Route Contract 能同时产生 Nest Route、请求验证、响应验证和有效 OpenAPI 3.1。
4. Controller 不写重复 method/path，且 Nest/Fastify 实际注册路径与 OpenAPI 完全一致。
5. 不合约的 JSON Response 在发送前转为 `500` Problem；Binary Route 不经过该流程。
6. `Idempotency-Key` 覆盖首次、重放、不同指纹和处理中重试。
7. `ETag`/`If-Match` 覆盖成功、`428` 和 `412`。
8. 动态 Schema 发布拒绝外部引用、超预算结构和不可编译 Schema；请求路径不发生编译。
9. Agent 有损投影产生 Diagnostic，模型参数仍被 Canonical Validator 拒绝。
10. Python 验证器能消费一个发布后的 Capability Contract Fixture。
11. `openapi.json` 与前端生成类型可在 CI 中确定性重建。
12. OpenAPI/JSON Schema Compatibility Diff 能阻止未批准的 Breaking Change。

详细 Wire Format、错误、分页、目录和端到端示例见 [API-CONTRACTS.md](../API-CONTRACTS.md)。
