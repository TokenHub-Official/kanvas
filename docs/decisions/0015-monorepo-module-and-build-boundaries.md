# ADR-0015：采用 pnpm/Turborepo 并以模块与依赖规则保护模块化单体

- 状态：Accepted
- 日期：2026-07-27

## 背景

Kanvas 需要同时提供 Web、HTTP Server 和异步 Worker，并让 Server/Worker 复用领域与应用能力而不共享进程状态。未来还可能加入独立 Python/GPU Worker、公开 Contract 和 Scenario Pack，但 V0 仍是一个产品和一个模块化单体，不是大量独立应用或微服务。

Monorepo 工具不能代替领域设计。过早按 `domain/application/infrastructure` 或每个 Bounded Context 创建 Workspace Package，会同时制造巨型技术包、循环依赖和发布边界假象。

## 决策

### 1. Workspace 与任务编排

- 使用 pnpm Workspace，仓库提交单一 Lockfile，并通过根 `packageManager` 锁定脚手架验证过的精确 pnpm 版本。
- 内部包依赖必须使用 `workspace:*`；开启 `disallowWorkspaceCycles`。
- 使用 Turborepo 编排、缓存和筛选 `build`、`check-types`、`test`、`lint` 等任务。
- Turborepo 的 Package Graph 来自 `package.json`，不把 Turbo 当作架构边界检查器。
- 不采用 Nx。当前收益不足以抵消第二套 Project/Tag/Generator 约定；当独立部署单元、语言运行时、团队所有权或 CI 图规模显著增长时再通过 ADR 重评。
- 不启用 TypeScript Project References，也不使用跨包 TypeScript `paths`。pnpm Package Graph 是唯一包依赖图，Turborepo 负责任务拓扑。
- Dependency Cruiser 是跨包和包内依赖守门器；ESLint 提供快速的禁用 Import/外部依赖反馈。

### 2. V0 目录与 Package

```text
apps/
  web/
  server/
  worker/
packages/
  application/
  contracts/
  database/
scenario-packs/
tools/
  scenario-validator/       # 首个 Scenario Pack 合入时创建
docs/
```

- `apps/*` 是可运行、可部署的图叶节点，永远不能被其他产品包 Import。
- `packages/application` 包含框架无关的 Domain、Application Use Case、Port 和纯 `createApplicationRuntime()` 工厂；内部按业务模块组织，不按技术层平铺。
- `packages/contracts` 只包含跨进程/前后端/内容包稳定协议和运行时 Schema；不包含 Domain Entity、Repository、ORM Row 或 Client 实现。
- `packages/database` 包含 Drizzle Schema、Repository/Query Adapter、Migration 和独立 Migration CLI，并依赖 Application 定义的 Port。
- V0 不创建 `core`、`infrastructure`、`common`、`shared`、`config`、`tooling`、`ui` 或 `api-client` Package。只有一个 Web 消费者时，UI 留在 `apps/web`；根配置留在仓库根。
- `scenario-packs/` 是 Manifest、Workflow、Skill Profile、Fixture 和 Eval 的内容目录，不是 pnpm Workspace。验证工具依赖 Contracts，核心产品代码不得反向依赖任何具体 Pack。
- 专用 Python/GPU Worker 将来位于独立运行边界，通过版本化 Capability/Artifact/Execution Protocol 通信，不通过 pnpm Package Import 集成。

### 3. 组合根与 Nest

- `apps/server` 创建自己的 Nest HTTP Application；`apps/worker` 创建自己的 Nest Application Context/Queue Consumer。
- 两者调用同一个框架无关 `createApplicationRuntime(dependencies)`，获得相同 Use Case 行为。
- 每个进程独立创建和关闭数据库连接池、Redis、对象存储、Provider Client、Timer 和 Trace Provider；禁止模块级 Singleton、Import-time Connect/Register 和跨进程内存状态。
- Server 与 Worker 不互相 Import，也不复用 Controller/Consumer。
- 可以复用无状态 Provider Factory；只有重复 Wiring 已形成维护问题时才新增很薄的 Nest Adapter Package。禁止用 `@Global()` 或共享完整 Nest Module Graph 充当业务组合根。
- Migration 不是常驻 App。`packages/database` 提供一次性 CLI，镜像通过独立命令运行；Server/Worker 启动不执行 Migration。

### 4. 构建与导出

- 仓库统一使用 ESM/NodeNext；首个脚手架必须验证 Nest、Drizzle、Migration、测试和生产镜像的 ESM 闭环。
- `application`、`contracts`、`database` 是 Compiled Internal Packages，优先用 `tsc` 生成 `dist/*.js`、Declaration 和 Source Map。
- Package `exports` 只指向 `dist` 的显式入口；开发和生产不使用不同的 Source/Dist Resolution。
- 每个 Package 声明自己的 `package.json`、依赖和 `tsconfig.json`，共同扩展根 `tsconfig.base.json`。
- Backend App 使用 Nest CLI 的 `tsc` Builder 起步；Web 使用 Vite。pnpm/Turborepo 管理整个仓库，不启用 Nest CLI 自带的 Monorepo/Library/Path Alias 体系。
- `build` 先构建 `^build`；`dev` 同时运行内部库 `tsc --watch` 和 App Watcher。
- 禁止 Deep Import、`src/` Import、未声明依赖和 Catch-all Public Export。公开包前再增加发布专用构建与 Changesets，不提前维护双格式发布流水线。

## 允许的依赖

| From                 | 允许依赖                                                                      |
| -------------------- | ----------------------------------------------------------------------------- |
| `contracts`          | 无产品内部包                                                                  |
| `application`        | `contracts/capability`、`contracts/workflow`、`contracts/events` 等协议子入口 |
| `database`           | `application` 的 Port/类型；必要的协议子入口                                  |
| `web`                | `contracts` 的 API/Workflow/Capability 子入口；Web 内部 UI                    |
| `server`             | `application`、`database`、允许的 `contracts` 子入口                          |
| `worker`             | `application`、`database`、允许的 `contracts` 子入口                          |
| `scenario-validator` | `contracts`；读取 `scenario-packs/` 数据                                      |
| `scenario-packs`     | 不 Import 产品源码；内容引用稳定 ID 和 Schema Version                         |

尤其禁止：

- `application → database/Nest/React/Drizzle/BullMQ/具体 Provider SDK`。
- `contracts → application/database`。
- `web → application/database`。
- `server ↔ worker`。
- 任意核心包或 App → 具体 `scenario-packs/*`。
- 一个业务模块 Deep Import 另一个模块的内部目录。

## Package 拆分触发条件

新的 Workspace Package 必须至少满足以下两项，或具有明确独立部署/发布要求：

1. 两个以上真实消费者需要同一稳定入口。
2. 独立发布、兼容或所有权生命周期。
3. 独立依赖重量或安全边界值得隔离。
4. 独立测试/构建耗时已成为可测瓶颈。
5. 已能定义小而稳定的公开 API，且依赖方向无环。

“目录很大”“符合 DDD 名称”或“将来可能复用”不是拆 Package 的充分理由。

## Architecture Fitness Gate

空脚手架必须自动验证：

1. pnpm 拒绝 Workspace Cycle；Dependency Cruiser 拒绝已定义的非法 Import 和任何循环。
2. `application` 无 Nest、React、Drizzle、BullMQ 和 Provider SDK 的直接或可达依赖。
3. `web` 无 Application/Database 可达依赖；Server/Worker 无彼此依赖。
4. `pnpm clean && pnpm build` 后仅通过 Package Export 和 `dist` 启动 Server、Worker、Migrator；构建产物不得 Import `src/*.ts`。
5. Server、Worker 可以分别使用 Turbo Filter 独立构建；删除/排除另一个 App 不影响构建。
6. 同一 Application Use Case 使用 Fake Port、HTTP Adapter 和 Queue Adapter 得到一致领域结果。
7. 删除整个 `scenario-packs/` 后产品构建仍通过；Scenario Validator 对坏 Manifest、未知 Contract Revision 和缺失 Artifact Fixture 明确失败。
8. Import 任意 Library 不连接数据库、Redis 或 Provider；只有 Composition Root 启动资源，Shutdown Hook 能独立释放。

## 结果

- 包数量保持最小，但依赖方向由自动规则而非团队记忆保护。
- Server/Worker 共享行为，不共享进程、Nest 容器或瞬时状态。
- Scenario 仍是可迁移、可安装的内容边界，不会反向进入核心。
- Compiled Package 增加 Watch/Build 配置，但消除开发与生产解析差异并允许 Turbo 缓存。
- 当实际规模证明 Nx、额外 Package 或独立 Runtime 有价值时，可以基于量化触发条件演进。

## 参考

- [pnpm Workspace 与 workspace: 协议](https://pnpm.io/workspaces)
- [Turborepo Package and Task Graphs](https://turborepo.dev/docs/core-concepts/package-and-task-graph)
- [Turborepo Internal Packages](https://turborepo.dev/docs/core-concepts/internal-packages)
- [Turborepo TypeScript Guide](https://turborepo.dev/docs/guides/tools/typescript)
- [Dependency Cruiser Rules](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md)
- [Nx Module Boundaries](https://nx.dev/docs/features/enforce-module-boundaries)
