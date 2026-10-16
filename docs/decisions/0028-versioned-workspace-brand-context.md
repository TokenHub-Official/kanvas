# ADR-0028：采用版本化 Workspace Brand Context

- 状态：Accepted
- 日期：2026-08-21
- 产品规格：[Workspace Brand Contract V1](../WORKSPACE-BRAND-CONTRACT-V1.md)

## 背景

Kanvas 画板已经预留品牌入口，但当前只有空状态。Workspace Asset 可以承载 Logo 和
品牌图片，Editor Document 可以表达颜色、字体和文字样式，WorkflowRun 可以固定执行
Revision；这些事实尚未形成一个可跨作品和执行复用的品牌上下文。

如果把品牌实现为资产筛选，无法表达颜色、文字样式和规则；如果让画板或 Workflow
动态读取“最新品牌”，历史作品与运行会随管理修改漂移；如果复制品牌文件，又会形成
独立于 Asset / Artifact 的第二套内容事实。

## 决策

采用 Workspace 范围的版本化 Brand Context：

1. `BrandKit` 是 Workspace 内稳定身份，承载名称、生命周期、默认状态和当前版本指针。
2. `BrandKitDraft` 是使用乐观锁保护的可编辑工作副本。保存草稿不影响已发布版本。
3. 发布从明确 Draft Version 生成不可变 `BrandKitRevision`；已发布内容不得原地修改。
4. Workspace 最多有一个默认 BrandKit。新 CanvasDraft 只在创建时解析默认品牌并固定
   明确 BrandKitRevision；后续默认品牌或最新版本变化不改变已有画板。
5. BrandKitDraft 编辑品牌素材时选择现有 Asset / Artifact；发布时固定明确 Artifact。
   BrandKitRevision 不动态读取 `Asset.currentArtifact`，也不复制文件。
6. 品牌颜色和文字样式使用受控 Contract，并在画板中投影为普通 Paint、Font Reference
   和 TextNode 样式，不创建不可编辑的品牌节点。
7. Workflow / AI 品牌上下文属于后续切片。接入后，WorkflowRun 必须固定明确
   BrandKitRevision，品牌素材作为实际输入时继续进入 Artifact 血缘。
8. 首期权限为 `brand.read` 与 `brand.manage`。`brand.manage` 包含创建、编辑、发布、
   归档和设置默认；没有真实独立审核职责前不增加 `brand.publish`。

## 第一纵向切片

第一个纵向切片只验证品牌颜色：

```text
创建 BrandKit
→ 编辑语义颜色
→ 发布 BrandKitRevision
→ 设为 Workspace 默认品牌
→ 新 CanvasDraft 固定该 Revision
→ 画板品牌面板应用颜色
→ Undo / 保存 / 刷新 / 导出保持一致
```

该切片已经验证版本、权限和画板固定语义。随后 BRAND-01 在相同不变量下扩展 Logo 的
Asset / Artifact 固定引用、文字样式、简明指南、“用此品牌创作”和画板主动更新品牌版本。
BRAND-01 不建设视觉模板、品牌评分、AI 自动合规裁决、跨 Workspace 同步或 Canva 全量
Brand Kit 分类。

## 不变量

1. BrandKit、Draft、Revision 和所有引用显式属于同一 Workspace。
2. 同一 Workspace 最多一个 Active 默认 BrandKit。
3. BrandKitDraft 并发修改必须检测 Expected Version，禁止静默覆盖。
4. BrandKitRevision 发布后不可变，并具有稳定 Revision Number 与内容摘要。
5. CanvasDraft 和 WorkflowRun 固定 Revision，不固定动态“最新品牌”。
6. 新 BrandKitRevision 只产生可更新事实，不自动改写已有作品。
7. 已发布品牌素材固定 Artifact；Asset Editorial Selection 变化不改变历史 Revision。
8. 品牌内容读取、修改、发布和设置默认都必须重新执行 Workspace 授权。
9. 普通用户界面不暴露 BrandKitRevision ID、Artifact ID、Digest 或执行实现细节。
10. 品牌不拥有独立文件存储，不绕过 Asset / Artifact、Workflow、Capability 或 Audit。

## 后果

- 品牌管理修改与历史作品、运行之间具有稳定边界。
- 颜色闭环先验证了版本、权限和画板固定语义；Logo、文字样式和简明指南沿同一 Revision
  扩展，没有引入第二套资产或编辑器对象。
- Workflow 品牌上下文仍可沿同一 Revision 扩展。
- BrandKit 需要新的 Contract、持久化、权限和 CanvasDraft 引用；这是保证可追踪性所需的
  明确复杂度。
- 发布新版本不会自动修复历史作品；批量重映射必须作为带预览、冲突与撤销的独立能力。
