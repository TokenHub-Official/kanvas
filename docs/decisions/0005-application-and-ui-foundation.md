# ADR-0005：采用 NestJS + Fastify 与 Studio-first Web 基线

- 状态：Partially Superseded（Web UI 决策已由 2026-08-10 起的全站 Ant Design / Tailwind
  迁移替代；服务端与应用边界继续 Accepted）
- 日期：2026-07-27

## 背景

Kanvas 同时包含专业创作工作台、资产与 Workflow、团队协作以及后续治理界面。它不是简单 CRUD API，也不应让企业后台组件体系决定 Studio 的视觉和交互。

需要在服务端长期领域边界、Studio 定制能力、开源贡献成本和实现速度之间取得平衡。

## 决策

> 2026-08-24 更新：本 ADR 保留为历史决策记录。当前 Web UI 事实源为
> `PRODUCT-UI-EXPERIENCE-NORTH-STAR.md`、`PRODUCT-UI-ARCHITECTURE.md` 与
> `TECHNOLOGY-SELECTION.md`；不再以本 ADR 的
> Radix / Admin 隔离结论指导新增实现。

### 服务端

- 使用 NestJS 组织 Module、Application Service、Guard、Interceptor 和依赖生命周期。
- 使用 FastifyAdapter 作为 HTTP Adapter。
- Domain 不依赖 NestJS、Fastify 或 ORM 对象。
- Capability、Workflow、Provider 和 Artifact 使用独立 JSON Schema / TypeBox contracts。
- Server 与 Worker 使用同一代码库和镜像，通过不同进程角色启动。

### Web

- 使用 React + Vite 构建登录后的 SPA 工作台。
- 使用 TanStack Router 和 TanStack Query。
- Studio 使用 Radix Primitives、自有组件层和 Tailwind CSS。
- CSS Variables 是 Design Token、暗色和运行时主题的事实源。
- SCSS 不作为默认依赖。
- Ant Design 不进入 Studio；只有独立且数据密集的 Admin 层形成后，才允许在隔离的 `ui-admin` 中引入。
- V0 保持一个 SPA，通过路由和包边界隔离 Studio 与 Admin，不引入微前端。

## 结果

- 接受 NestJS Decorator、DI 和 Module 样板成本，换取明确的应用边界和生命周期。
- 仍需通过架构约束避免全局 Module、循环依赖和贫血 Service。
- Studio 需要维护自有视觉组件，但不会被 Ant Design 的后台设计语言锁定。
- 管理端可以在明确边界内换取 Ant Design 的表格、表单和治理页面效率。
- Tailwind 只消费语义 Token；Canvas 动态几何状态属于 Editor Document / Renderer，不属于样式类。

## 未包含

- 数据库与 ORM。
- 画布引擎。
- 具体表单 Schema 库。
- 独立 Admin 应用或微前端。
