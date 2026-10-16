# ADR-0004：内部和自部署版本共享同一开源核心

- 状态：Accepted
- Project / Deliverable scope: Superseded by [ADR-0035](0035-retire-project-deliverable-and-converge-internal-formats.md); the shared-core decision remains Accepted
- 日期：2026-07-26

## 背景

Kanvas 先服务内部团队，成熟后计划开源。如果内部版和开源版从早期形成不同领域模型或不同主干，后续同步成本会持续增加。

## 决策

内部、开源和自部署版本共享同一核心代码、数据库模型和插件协议。

内部差异通过以下方式表达：

- 配置。
- 私有凭据。
- 私有 Workflow。
- 私有模板和品牌资产。
- 通过公开 SDK 构建的扩展插件。

## 结果

- Workspace、基础权限、ProjectDeliverable、StoredObject、Asset、Artifact、Workflow、Capability、Provider SDK、Browser Runtime 和 Usage Ledger 属于核心。
- 不维护长期内部 fork。
- TokenHub 默认集成必须可替换和删除。
- 企业服务可以围绕托管、部署、支持、合规集成和渠道开展，而不是依赖削弱开源核心。
- 最终许可证仍需结合商业模式和法律评审确定。
