# ADR-0009：Skill 与 Workflow 分离，V0 采用最小不可变发布模型

- 状态：Accepted
- 日期：2026-07-27

## 背景

Workflow 是可执行图；Skill 是面向人或 Agent 的知识、上下文、模板和资源集合。两者语义不同，但语义不同不代表需要建设两套对称的运行时、依赖解析和包管理系统。

如果把 Skill 固定分类为 Prompt、Workflow、Agent 或 Template，会产生互斥类型问题；如果在 V0 就引入传递依赖、SemVer 范围、Lockfile、多版本解析、自动升级和 Fork 领域对象，又会在真实分发需求出现前复制 npm 生态的复杂度。

动态维护也不能意味着生产 Workflow 可被原地修改。运行、审计和回滚仍要求 Workflow 发布 Revision 不可变并固定执行血缘。

## 决策

- Skill 与 Workflow 保留概念分离。
- Workflow 是声明式、可版本化的执行定义，可以独立创建、发布和运行。
- Skill 是可发现、可分发的 Bundle / Envelope，可以包含 Instructions、References、Templates、Assets、Evals，并引用一个或多个可启动 Workflow。
- Skill 本身不参与执行状态机，实际执行始终进入 Workflow 和 Capability 通路。
- 不使用 `PROMPT_SKILL / WORKFLOW_SKILL / AGENT_SKILL` 等互斥类型枚举。
- V0 不定义 AgentDefinition Entrypoint。
- Workflow Draft 在 MySQL 动态维护；提交审核时生成不可变 `PublicationCandidate`；只有已批准 Candidate 才能生成不可变 `WorkflowRevision`。
- Skill 使用相同的 Draft、PublicationCandidate 和 SkillRevision 发布语义。
- WorkflowRun 必须固定到具体 WorkflowRevision。
- 发布内容可以进入对象存储；MySQL 保存身份、Revision、Hash、权限、索引和对象引用。
- V0 不支持 Skill 间传递依赖、SemVer 范围解析、Lockfile、自动升级和多版本依赖求解。
- Skill 引用的 Workflow 在发布时必须解析到当前实例内的具体 WorkflowRevision；如需要子图复用，V0 仅允许发布时内联展开。
- 修改外部内容时创建当前 Workspace 所有的新 Draft，并记录 `derivedFrom`；Fork 暂时只是 UI 文案，不建立独立领域语义。

## 生命周期与发布门禁

真正的发布生命周期简化为：

```text
draft | published | deprecated
```

运行状态单独管理：

```text
enabled | disabled | revoked
```

Validate、Test 和 Review 不作为互斥状态，而绑定不可变 PublicationCandidate 记录为：

- `PublicationCheck`：Schema、资源、安全、兼容性和 Eval 结果。
- `ReviewDecision`：审核人、结论、意见、Candidate ID 和内容 Hash。

发布链路：

```text
Mutable Draft
→ Immutable PublicationCandidate
→ PublicationCheck / ReviewDecision
→ Immutable Published Revision
```

- Draft 支持自动保存，通过 `version` 乐观锁处理并发。
- Candidate 是送审快照；创建后不可修改。
- 审核期间 Draft 可以继续编辑，不影响当前 Candidate。
- 发布只读取已批准 Candidate，不重新读取当前 Draft。
- 生成的 Revision 内容 Hash 必须与 Candidate 一致。
- V0 不为每次自动保存创建 DraftRevision；完整 DraftHistory 后置。

`deprecated` 表示不建议新安装或创建运行；`revoked` 表示因安全或合规原因禁止继续启用。

## V0 Workflow 边界

Workflow V0 只允许：

- `invoke`：调用平台注册 Capability。
- `switch`：基于已产生的结构化值和受限操作符确定分支。
- `map`：对有限集合执行一个内联 Invoke，并声明最大元素数、并发上限和 `collect_all / fail_fast`。
- `approval`：绑定明确对象、参数、输入 Hash 和执行计划 Hash 后暂停等待人工决定。

有限并行由一个节点激活多个输出边表达；汇合由下游 `joinPolicy = all_success | all_settled` 表达，只等待运行时已激活输入边。V0 不增加独立 `parallel` 或 `join` NodeRun。

Input Mapping 和最终 Output Selection 属于图语义，不单独定义节点。

V0 不允许：

- 任意循环或无界展开。
- 自由表达式、`eval` 或用户代码。
- HTTP、SQL、Shell 等通用逃逸节点。
- 运行时 Capability 搜索。
- 动态生成或修改图。
- Agent 节点。
- 运行时子 Workflow。
- 通用补偿事务 DSL。
- Schedule、Webhook Trigger 和用户自定义错误处理程序。
- 数据库或 Skill Package 中的任意 JavaScript、Shell 或 Python。

## 包结构

```text
skill-package/
├── SKILL.md
├── kanvas.yaml
├── workflows/
├── templates/
├── references/
├── assets/
└── evals/
```

`kanvas.yaml` 在 V0 只声明：

- 包身份和内容摘要。
- 资源清单。
- 可启动 Workflow。
- 所需 Capability。
- 数据分类和网络要求。
- 兼容的 Kanvas 版本。

该格式以开放 Agent Skills 的 `SKILL.md` 结构为输入参考，但 Kanvas 实现的是受限、安全的 Kanvas Profile，不承诺兼容其脚本执行语义。

## 安全边界

禁止脚本不足以保证安全。Skill 导入和发布还必须覆盖：

- Markdown、Prompt 和 References 的间接 Prompt Injection。
- SVG、HTML、字体、图片解析和压缩包攻击。
- 外链、SSRF、数据外泄和未批准网络访问。
- 解压大小、文件数量、嵌套层数和成本攻击。
- 模板变量逃逸和导出内容注入。
- 发布者身份、内容 Hash、审批记录和安全撤销。

外部 Registry、签名、发布者信任和供应链响应进入后续阶段，V0 默认只支持受信内部来源或管理员显式导入。

## 结果

- Workflow 在没有 Agent 和 Skill 包装时也能独立产生价值。
- Skill 保留知识与分发语义，但不会膨胀成第二套运行时或自制 npm。
- Workflow Run 具有稳定 Revision 和执行血缘。
- 自动保存、审核冻结和正式发布互不争夺同一个可变 Draft。
- V0 不承担依赖解析、Lockfile、自动升级和跨版本冲突处理。
- 内容 Hash 支持审计和完整性，不承诺远程模型或浏览器环境产生完全相同的 AI 输出。

## 未包含

- `kanvas.yaml` 的最终 JSON Schema。
- 公共 Skill Registry、Marketplace 和跨实例信任模型。
- 包签名与发布者身份协议。
- 动态脚本 Sandbox。
- DraftHistory、分支、合并和多人实时协同协议。
- Skill 间依赖和 SemVer 范围；只有真实生态需求出现后才重新评估。

Workflow JSON、状态、队列和可靠性语义由 [ADR-0017](0017-bounded-workflow-runtime-and-database-owned-reliability.md) 继续细化。
