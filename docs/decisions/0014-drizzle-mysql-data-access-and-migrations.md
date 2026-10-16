# ADR-0014：采用 Drizzle、mysql2 与显式 SQL Migration

- 状态：Accepted
- 日期：2026-07-27

## 背景

Kanvas 已确认以 MySQL 8.0 作为唯一主业务关系数据库。首个纵向切片需要验证条件更新、行锁、死锁重试、Transactional Outbox、批量写入、JSON、Artifact Lineage 和不可变事实，而不只是普通 CRUD。

数据访问方案还必须适合模块化单体、Server/Worker 多进程、未来开源自部署和人工审阅升级脚本。Domain 不能依赖 ORM 对象，数据库迁移也不能依赖应用启动时的隐式同步。

## 决策

### 1. 组件

- 使用 Drizzle ORM 的最新稳定版和 `mysql2` Driver；首次脚手架时锁定精确版本并提交 Lockfile。
- 不采用 RC、Beta 或 Canary 版本作为生产基线。调研时 Drizzle 稳定版为 `0.45.2`，`1.0.0-rc.4` 仍属于候选版本；实际初始化时重新核验。
- Kysely + `mysql2` 是首选退出方案。如果真实 MySQL Spike 证明 Drizzle 的迁移、类型表达或事务能力不能稳定满足约束，可以切换 Kysely，不改变 Domain 和 Application 接口。
- Prisma 和 MikroORM 不作为核心事实层。前者的开发迁移流程依赖 Shadow Database 权限且抽象更重；后者的 Unit of Work、EntityManager Context 和实体图不匹配当前以显式命令、不可变事实和 Worker 为主的模型。

### 2. 分层和事务

- Drizzle Schema、Row Type、Query Builder 和 Driver 只存在于 Infrastructure。
- Domain 使用领域对象、值对象和 Repository Port；Application Service 使用语义化 Repository 和 Query Port，不暴露通用 `save/find/update` 接口。
- Application Service 持有事务边界，通过 `TransactionContext` 将同一数据库会话传给多个 Repository。
- `CompleteAttempt`、额度预留、发布、审批和 Outbox 写入等跨聚合命令必须在显式事务中完成。
- CAS 优先使用单条条件 `UPDATE`；需要读取后决策的额度或发布操作使用 `SELECT ... FOR UPDATE`。`SKIP LOCKED` 只用于 Outbox/队列式领取，不能当作无重复投递保证。
- 死锁和锁等待属于可预期结果。只在命令具备幂等键时做有限次数、带抖动的整事务重试。

### 3. Schema 与 Migration

Kanvas 不把单个文件声明为数据库的全部真相，而是区分：

- Drizzle TypeScript Schema：当前应用期望的数据模型和查询类型来源。
- 已提交且已应用后不可修改的 SQL Migration：Schema 演进与部署历史。
- 实际 MySQL Schema：运行时事实。

CI 必须从空 MySQL 8.0 实例执行全部 Migration，再检查其结果与 Drizzle Schema 一致。出现冲突时，不修改已应用 Migration；通过新的前向 Migration 和 Schema 修复重新收敛。

- 允许使用 Drizzle Kit 生成 Migration 初稿和 Snapshot，但 SQL 必须人工审阅后提交。
- 生产、自部署升级和 CI 只运行仓库内已提交的 SQL Migration；禁止 `drizzle-kit push` 和应用启动时自动改表。
- Migration 由独立的一次性命令执行，Server 和 Worker 启动不负责迁移。
- 生产变更采用 Expand → Migrate/Backfill → Contract。MySQL DDL 会隐式提交，因此不承诺依赖事务或 Down Migration 原地回滚。
- 已执行 Migration 不可修改。失败恢复使用兼容的应用回滚、前向修复 Migration 或从备份恢复。

### 4. MySQL 基线

- Storage Engine 使用 InnoDB。
- 数据库默认字符集使用 `utf8mb4`；默认排序规则优先 `utf8mb4_0900_ai_ci`，需由内部准确补丁版本验证。
- 连接会话时区固定为 UTC；业务时间使用 `DATETIME(3)`，API 使用带时区的 ISO 8601。
- 默认事务隔离级别沿用 InnoDB `REPEATABLE READ`。需要不同语义时在单个事务显式设置，不进行全局修改。
- 主键使用应用生成的 ULID，数据库列为 `CHAR(26) CHARACTER SET ascii COLLATE ascii_bin`。外部 ID 与数据库 ID 暂不维护双份。
- 金额和 Provider 成本禁止浮点数。内部额度使用整数最小单位；真实货币使用 `DECIMAL(20,8)` 和 ISO 4217 Currency。
- 开放枚举使用 `VARCHAR` 加应用校验，不使用 MySQL `ENUM`。
- JSON 只保存结构可变且不承担核心关联的快照/元数据；筛选、唯一性、关联和高频排序字段必须正规化。必要时使用 Generated Column 加索引。
- 核心所有权与不变量保留外键；业务事实不级联删除。审计、Usage 和 Outbox 等追加事实可以保存弱引用 ID，避免生命周期耦合。

准确 MySQL 8.0 补丁版本、SQL Mode、大小写、在线 DDL 和采购实例权限仍需在目标环境确认；这些属于部署兼容性证据，不重新打开 ORM 决策。

## 实施门槛

在首个业务表合入前，必须使用真实 MySQL 8.0 完成：

1. 从空库执行全部 Migration，并对已存在的前一版本执行升级。
2. 并发 `CompleteAttempt` 只能采纳一个 Attempt，且 Artifact、Output、状态和 Outbox 原子提交。
3. 两个 Relay 使用 `FOR UPDATE SKIP LOCKED` 领取 Outbox；允许重复投递，消费者通过幂等键去重。
4. 额度行锁、死锁注入和整事务有限重试。
5. 大 JSON、批量插入、Lineage 查询和关键租户索引的执行计划。
6. 在没有 `CREATE DATABASE` 权限的 CI/内部账号下运行迁移。
7. 从 Migration 重建后的数据库与 Drizzle Schema Drift 检查。

若 Drizzle 在这些测试中需要绕过其公共 API、产生不可审阅 Migration、无法表达所需 MySQL 类型/索引，或事务会话不能稳定跨 Repository 传递，则执行 Kysely 退出方案。

## 结果

- CRUD、类型推导和大部分查询保持轻量，MySQL 特有能力仍可显式使用。
- Domain、Application 和测试不会绑定 ORM Entity 或隐式 Unit of Work。
- 内部和自部署版本使用同一套可审阅、可重放的升级历史。
- 团队需要自行维护语义 Repository、事务上下文、Migration 检查和少量原生 SQL。

## 参考

- [Drizzle Transactions](https://orm.drizzle.team/docs/transactions)
- [Drizzle MySQL with mysql2](https://orm.drizzle.team/docs/mysql/get-started-mysql)
- [Drizzle Kit Generate](https://orm.drizzle.team/docs/drizzle-kit-generate)
- [Drizzle Kit Migrate](https://orm.drizzle.team/docs/drizzle-kit-migrate)
- [MySQL 8.0 InnoDB Transaction Isolation](https://dev.mysql.com/doc/refman/8.0/en/innodb-transaction-isolation-levels.html)
- [MySQL 8.0 Deadlocks](https://dev.mysql.com/doc/refman/8.0/en/innodb-deadlocks.html)
