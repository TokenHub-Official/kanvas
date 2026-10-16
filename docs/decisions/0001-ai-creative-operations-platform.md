# ADR-0001：产品定位为 AI Creative Operations Platform

- 状态：Superseded by [ADR-0032](0032-agent-first-dynamic-skills.md)
- Project / Deliverable scope: Superseded by [ADR-0035](0035-retire-project-deliverable-and-converge-internal-formats.md)
- 日期：2026-07-26

## 背景

> 本 ADR 保留最初面向视觉团队和创意生产的范围依据。以 Workflow 为产品核心的优先级已由
> ADR-0032 替代；Canvas、Workflow、Artifact 与 Capability 继续作为 Agent 背后的业务对象。

原始需求同时包含基础图片工具、电商、人像、社媒、品牌、视频、办公和 Agent。如果直接按功能构建，产品会退化为大量互相割裂的 AI 工具入口。

## 决策

Kanvas 定位为专业视觉团队的 AI Creative Operations Platform，以完整生产工作流为核心。

首期重点验证：

- 商品营销素材套图。
- 活动与社媒素材套图。
- 批量基础生产处理。

## 结果

- 原子工具必须服务于工作流。
- Project、ProjectDeliverable、DeliverableItem、StoredObject、Asset、Artifact、Workflow、CapabilityRun / Attempt 和人工确认成为核心对象。
- 不以复刻 Canva、Photoshop、PPT 或视频编辑器为目标。
- Kanvas 暂作为内部代号，开源前重新命名。
