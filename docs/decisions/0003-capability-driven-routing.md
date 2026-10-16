# ADR-0003：Capability 驱动的实现选择与路由

- 状态：Accepted
- 日期：2026-07-26

## 背景

OpenAI、OpenRouter、TokenHub/NewAPI 以及专用媒体服务在协议、能力、参数、计费、异步任务和文件处理上存在差异。OpenAI-compatible 只能覆盖部分协议兼容，不能代表能力兼容。

如果业务工作流直接引用供应商和模型，模型变化会持续污染业务代码。

## 决策

业务层只请求稳定 Capability，并按以下层次拆分契约、实现和运行配置：

```text
CapabilityDefinition
└── CapabilityContractRevision

CapabilityImplementation
└── ImplementationRevision

CapabilityBinding
```

- `CapabilityDefinition`：稳定的业务能力身份，例如 `image.background.remove`。
- `CapabilityContractRevision`：不可变输入输出 Schema、错误、Artifact、幂等、取消、副作用、数据出口和调用者契约。
- `CapabilityImplementation`：Browser Runtime、Internal Worker、Provider Adapter 或受信插件提供的一个执行实现。
- `ImplementationRevision`：不可变 Adapter、模型包、参数映射和运行时实现版本。
- `CapabilityBinding`：当前实例或 Workspace 对 Endpoint、凭据引用、模型、预算、路由、健康和回退的可变配置。

WorkflowRevision 只固定 `CapabilityContractRevision`。运行开始时由 RoutePolicy 解析可用 Binding，并生成不可变 `ExecutionPlanSnapshot`，其中固定 ImplementationRevision、Provider、模型、参数、策略结果和回退链。

ExecutionPlanSnapshot 不保存 API Key、临时 Token、签名 URL、Worker、队列位置和租约等 Secret 或瞬时运行状态。同一个 CapabilityRun 重试时不静默重新路由；原实现被安全撤销时进入明确的阻塞或重新计划状态。

V0 不允许管理员通过任意 URL、HTTP、Shell、SQL 或脚本创建实现。管理员可以配置已安装、受信的 Implementation 与 Binding，例如 OpenAI-compatible Endpoint、模型映射、凭据引用和路由策略。

Human Capability 由 Approval 节点承担，Composite Capability 由 Workflow 承担，不再建立重叠抽象。

## 结果

- 不创建以供应商命名的业务 Tool。
- 不使用无法表达输入、输出和限制的万能 `generate()`。
- TokenHub/NewAPI 是可替换 Gateway/Endpoint，不是 Kanvas 唯一入口。
- ChatGPT 订阅不作为 API Provider。
- 所有真实调用记录 Model、参数、费用、耗时和错误。
- 开源扩展通过受信 Provider / Capability 插件注册 Implementation，不要求修改核心业务代码。
- 不开放通用 HTTP 节点，避免绕过数据出口、权限、审计和幂等治理。
