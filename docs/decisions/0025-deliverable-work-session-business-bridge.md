# ADR-0025：采用显式 Deliverable-Workflow 关联、稳定结果 Envelope 与原子人工决定

- Status: Superseded by [ADR-0035](0035-retire-project-deliverable-and-converge-internal-formats.md)
- 日期：2026-07-28

## 背景

Foundation 已经分别具备 Project/Deliverable、Workflow、Capability、
Attempt、Artifact、授权和 Audit，但这些事实尚未形成设计师可以恢复的业务闭环。
如果核心从 Workflow Input、Node Key 或日志猜测业务归属和主结果，场景变化会进入
平台内核；如果 UI 依次调用 Artifact 采纳、Candidate 创建和 Item 接受等低层接口，
中途失败会产生无法解释的半完成状态。

同时，机器成功不等于业务接受。拒绝如果只写入管理员 Audit，普通工作台无法在刷新
后恢复用户决定；提前把每个机器结果登记为 Candidate，又会混淆“可检查输出”和
“进入业务选择集”的语义。

## 决策

1. 使用不可变 `project_deliverable_workflow_run` 显式关联
   ProjectDeliverable、WorkflowRun 和创建时采用的 BriefRevision。
2. 使用不可变 `project_deliverable_workflow_entrypoint` 固定
   SkillRevision 与 EntryPoint，由 Scenario Pack 配置；核心不硬编码场景名称。
3. `StartDeliverableRun` 在同一 MySQL 事务创建 WorkflowRun 与业务关联。
4. Workflow 以 `DeliverableResults v1` 交付稳定结果身份，不允许核心按 Node Key
   或任意 JSON 猜测主结果。
5. 使用 append-only `deliverable_result_decision` 保存 accepted/rejected
   业务事实、原因、操作者、时间和幂等身份。
6. VSL-01 只允许决定最新 `completed/full_success` Run 的单个 primary Result。
7. Result 必须沿袭到该 Run 下 completed CapabilityRun 的 accepted Attempt，
   且存在指向同一 Artifact 的 AttemptOutput。
8. Reject 原子写 ResultDecision 与 Tier A Audit，不删除输出，也不终结仍可重试的
   DeliverableItem。
9. Accept 在一个事务内采纳 Artifact、登记 Candidate、更新 Asset current、
   接受 DeliverableItem 与 ProjectDeliverable、写 ResultDecision 和 Tier A Audit。
10. Candidate 不在 Review 时预创建，只在 Accept 事务中创建。
11. 使用原子 `CreateDeliverableWorkSession` 处理 Intake；它只接受业务输入，
    从已发布且启用的 Skill `intakeProfile` 解析结构并固定准确
    SkillRevision/WorkflowRevision。
12. 使用 append-only `deliverable_work_session_intake` 保存请求 Digest 和全部
    新建身份。并发重试必须返回原始聚合，Body 变化必须冲突，不能产生半完成事实。
13. HTTP Intake 不接受 Workflow Revision、Capability、Adapter、Model、
    Credential、Execution Target、Storage key 或 OutputProfile。

## 关键不变量

1. JSON 中的 ID 不代替可查询关联和外键完整性。
2. 一个 WorkflowRun 在 V0 只服务一个 ProjectDeliverable；Deliverable 可以保留
   多个历史 Run。
3. 同一 Item/Run/Artifact 只有一个终态 ResultDecision。
4. 同一幂等键只能绑定同一决定请求。
5. Workflow 成功不能自动接受 Deliverable。
6. 未被 CapabilityRun 接受的 Attempt 输出不能成为可接受的业务 Result。
7. 接受后 Item、Deliverable、Asset current 和 ResultDecision 指向同一不可变
   Artifact。
8. Application Command 在事务内重新授权；Query 的 `availableActions` 不是授权
   凭据。
9. 核心 Contract 不出现海报、商品图或背景移除等场景名称。
10. Scenario Pack 可以声明场景结构，但生产代码不得 Import Pack，也不得以
    Pack 名称分支；Core 只解释版本化 `intakeProfile`。

## 结果

- 工作台可以从 MySQL 恢复 Run、Review 历史和最终接受事实。
- Scenario Pack 可以替换 Workflow 和具体 Capability，而不改变核心业务桥接。
- API 暴露用户用例和聚合 Query，不暴露数据库 CRUD 编排。
- 后续批量和多候选可以扩展相同外层语义，但必须另行定义 Candidate 登记和选择规则。

## 未包含

- 项目列表和团队工作流。
- 真实背景移除模型、Browser/Worker 实现与质量门槛。
- Browser/Worker/回退的完整工作台投影。
- 正式 UI 和浏览器 E2E。Atomic Intake → queued 已通过 disposable MySQL
  8.0 Gate，但真实输出、Review/Accept 的跨进程 E2E 仍待验证。

完整业务边界由本 ADR 与当前 Contract / 集成测试共同保存。
