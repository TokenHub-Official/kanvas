# ADR-0007：使用 MySQL 作为唯一主关系数据库基线

- 状态：Accepted
- Project / Deliverable scope: Superseded by [ADR-0035](0035-retire-project-deliverable-and-converge-internal-formats.md); the MySQL decision remains Accepted
- 日期：2026-07-27

## 背景

内部已有统一采购和运维的 MySQL 8.0 服务。团队评估后决定不为 Kanvas 单独采购 PostgreSQL。

Kanvas 需要持久化 Workspace、ProjectDeliverable、DeliverableItem、Asset、Artifact、Skill、Workflow、Run/Node/Attempt、审批、额度、Usage Ledger、审计和 Transactional Outbox。后续采用的 ORM、Agent Runtime 或其他基础组件可能对 PostgreSQL 提供更完整的现成集成，但不应因此形成两套主业务数据库。

## 决策

- MySQL 8.0 是内部版本的关系数据库基线，也是开源和自部署版本的首要支持基线。
- 不把无痛切换 MySQL/PostgreSQL 作为第一优先级，也不在缺少完整测试矩阵时宣称双数据库支持。
- Domain 通过 Repository / Port 表达持久化意图，不依赖 ORM Model。
- Schema 和 Migration 在仓库中版本化，并使用真实 MySQL 执行集成与升级测试。
- ProjectDeliverable、DeliverableItem、Asset、Artifact、Skill、Workflow、CapabilityRun / Attempt、未来 AgentRun、审批、费用和审计等业务事实数据统一保存在 MySQL。
- StoredObject 和不可变 Skill Package 内容进入对象存储，MySQL 保存元数据、版本、Hash 和引用。
- Redis 负责队列与短期协调，不是业务事实源。
- Agent 框架的 Snapshot 或 Checkpoint 仅作为运行时实现细节；它不能取代 Kanvas 的 WorkflowRun、NodeRun、CapabilityRun / Attempt、审批、费用和审计记录。
- 如果 Agent 框架没有官方 MySQL Storage，优先实现 Kanvas Runtime Adapter、自定义 MySQL Storage Adapter，或仅使用不依赖其持久化层的运行时能力，不单独引入 PostgreSQL、LibSQL 或 MongoDB 作为第二套主数据库。

## 结果

- 复用内部现有数据库采购、运维、备份和监控能力。
- 开源自部署拓扑保持单一主关系数据库，降低安装和排障成本。
- 选择 ORM 和 Agent 框架时必须验证真实 MySQL 兼容性，不能只验证类型或启动成功。
- JSON、Generated Column、锁、在线 DDL 和事务行为必须在内部实际补丁版本与采购规格上验证。
- PostgreSQL 特有的存储扩展、JSON 查询、向量能力或框架集成不能成为核心实现的隐式依赖。
- 如果未来出现 MySQL 无法合理满足的独立检索或分析负载，应以明确的专用组件 ADR 处理，而不是悄然引入第二套业务事实源。

## 未包含

- MySQL 8.0 的准确补丁版本、配置基线和部署规格。
- 搜索、向量检索和分析型存储方案。
- BullMQ、对象存储和 Agent Runtime 的最终选择。

ORM、Migration 和数据访问边界由 [ADR-0014](0014-drizzle-mysql-data-access-and-migrations.md) 确定。
