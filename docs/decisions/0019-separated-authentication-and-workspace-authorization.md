# ADR-0019：分离认证引擎与 Workspace 授权

- 状态：Accepted
- 日期：2026-07-27

## 背景

Kanvas 同时服务内部部署和开源自部署，需要本地登录、企业 OIDC、Session、Organization/Workspace、多角色、服务自动化、Capability 执行、Provider Credential 和 Artifact 下载。若直接把认证库的 Organization/Role 当业务权限，或只在 HTTP 入口检查一次，会在 Worker、下载 URL、跨 Workspace ID 和迟到任务中形成越权。

## 决策

### 1. Authentication 与 Authorization 分离

Better Auth 1.6.25 作为 V0 默认 Authentication Engine，使用 Drizzle/MySQL 和数据库 Opaque Session。它只拥有 Auth User/Account/Session/Verification，不拥有 Kanvas Organization、Workspace、Role 或 Permission。HTTP 集成使用 Kanvas 自有 Fastify 薄 Bridge，不依赖社区 NestJS Module。

Kanvas Application 只接收 Opaque `authSubjectId`，通过 HumanPrincipal 建立业务主体。OIDC Issuer/Subject、Email/Password 和 Account Linking 留在 Auth Engine。

Better Auth 只有通过 NestJS + Fastify、Cookie/Header、Enrollment、OIDC 和 Session Security Gate 后才锁为依赖；失败时替换 Auth Adapter，不改变 Principal/Membership 模型。

### 2. Workspace 是内容安全边界

Organization 管理 Workspace 生命周期和企业治理；Workspace 管理内容、Credential、预算、策略和数据隔离。Instance Admin、Organization Role、Workspace Role 不继承。

- Organization Role：`owner | admin | member`。
- Workspace Role：`owner | admin | editor | reviewer | viewer`。
- Owner 只由 Membership 表达，不在 Organization/Workspace 复制 Owner ID。
- 至少保留一个 Active Owner。
- 固定 Role Matrix 写在代码并版本化；V0 不做自定义 RBAC。

### 3. RBAC 只生成候选权限

每次授权还检查可信 Workspace Scope、资源所有权、数据分类、Capability/Binding、Credential、预算、Approval Policy、Retention 和当前状态。Guard 只做认证；Application Command/Query 是主要授权点；Repository 强制 Workspace Scope；关键事务重验 Membership/Grant Version。

### 4. Human 与 Service Principal 分离

ServicePrincipal 通过单 Workspace ServiceGrant 和单 Grant ServiceApiToken 获得固定 Permission Enum 子集：

- 不能交互登录、接受邀请、成为 Owner 或完成人工 Approval。
- Token 只显示一次，DB 只存 Prefix/Hash/Expiry/Revocation。
- Effective Permission 是 Principal、Grant、Token 和当前 ABAC 的交集。

同部署 Server/Worker 使用 Deployment Identity，不伪装成人类或 Service API Token。Browser Attempt 使用仅绑定 Attempt 的短期 Grant。

### 5. Session 与 Enrollment

Browser 使用同源 `__Host-` Secure/HttpOnly/SameSite Cookie 和数据库 Session；V0 禁用 Cookie Permission Cache。Mutation 同时校验 Origin、Fetch Metadata 和 Session-bound CSRF。

Public Sign-up 默认关闭。Invitation/Bootstrap Token 先建立短期签名 Enrollment State，使 Auth Hook 只允许受邀身份注册/登录；Authentication 成功仍不产生 Membership，必须以 Verified Human Session 事务接受 Invitation。

Email 不是身份主键，不做 Provider-specific Alias 合并。Account Linking 必须从已有 Session 显式发起。

### 6. Bootstrap 不采用首用户抢占

CLI 创建一次性 Setup Token，兑换要求 Human Session，并支持 `auth_subject | verified_email_hash | unbound` Binding。单个事务创建 Instance Admin、初始 Organization/Workspace 和两个 Owner Membership。Instance Admin 不自动访问 Workspace 内容。

### 7. 执行与下载重新授权

Run Create 固定当时 Authority、Permission/Policy Revision 和 Decision Digest。每个 Attempt Dispatch 再检查当前 Membership/ServiceGrant、Capability、Credential、Egress 和 Budget；Worker 不能信任 Job Payload 中的 Workspace/Credential。

Human 权限被暂停、撤销或降权后，其 V0 Run 不再 Dispatch 新 Attempt。已开始副作用按 Attempt Cancel/SideEffect 协议处理。

Artifact 下载在签发 URL 前执行当前授权。普通内容使用最短实用 TTL 的精确 Presign；撤权阻止未来签发但不承诺撤销已发 URL。高敏感内容使用 Authenticated Proxy Stream。

## 关键不变量

1. 一个 Auth Subject 最多映射一个 HumanPrincipal。
2. Organization/Workspace Membership 在 Scope + Principal 上唯一。
3. 上层管理员没有隐式 Workspace 内容访问。
4. Active Workspace、Route Metadata、UI Projection 和 Snapshot 不是授权事实。
5. Service Token 只绑定一个 Grant/Workspace，不能扩张 Grant Permission。
6. Provider Secret 永不返回调用者。
7. 所有租户 Repository 操作携带可信 Workspace Scope。
8. Approval Decision 绑定不可变 Policy Revision，并执行 Eligible/Assignment/Separation 条件。
9. Background Worker 重新从 MySQL 解析 Attempt、Plan、Workspace、Credential 和当前 Policy。
10. Invitation、Setup Token、Service Token 和 Session 都可撤销、不可记录明文。

## 后果

正面：

- 内部 OIDC、本地自部署和未来替换 Auth Engine 共享同一领域授权。
- Organization 管理员不会因治理权限获得设计资产。
- Worker、下载和 Credential Resolve 不再成为入口授权的绕过路径。
- V0 固定角色足以交付，同时保留资源/数据/审批条件。

代价：

- 每个 Application Use Case 都要显式传 Actor/Workspace Scope。
- Dispatch 和敏感下载需要额外数据库授权读取。
- 邀请关闭注册需要 Enrollment Hook 与端到端 Auth 测试。
- Better Auth/Fastify 基础集成已由 Kanvas 薄 Bridge 和真实 MySQL Gate 关闭；
  完整认证安全矩阵仍是 V0 发布前的独立 Gate。

## 不采用

- Better Auth Organization/Admin Plugin 作为 Kanvas 权限事实。
- Stateless JWT 浏览器 Session。
- Email 作为 Principal ID 或自动 Account Merge。
- 第一个注册用户自动成为管理员。
- Instance/Org Admin 隐式访问全部 Workspace。
- ServicePrincipal 复用 Human Role。
- 只在 HTTP Guard 检查权限。
- 长期 Presigned URL 或“已发 URL 可立即撤销”的错误承诺。
- V0 SAML/SCIM、自定义 RBAC、Policy DSL 和用户模拟。

## Gate

- NestJS + Fastify Auth 集成、Session 撤销、OIDC 与 Enrollment 全链路通过。
- IDOR、Owner 竞争、Invite/Bootstrap 并发、Service Scope、CSRF、Credential Confusion 和 Worker Job Tamper 测试通过。
- 任一拒绝路径不产生 Secret Decrypt、Storage URL、Provider Request 或业务写入。

详细模型和矩阵见 [IDENTITY-AND-AUTHORIZATION.md](../IDENTITY-AND-AUTHORIZATION.md)。
