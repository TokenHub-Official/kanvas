# ADR-0002：三类执行后端

- 状态：Accepted
- 日期：2026-07-26

## 背景

项目面向内部专业用户，浏览器、操作系统和硬件可控。当前 WebGPU、WASM 和浏览器模型运行时已经能够稳定承担部分工具型视觉模型。仅将浏览器用于裁剪和压缩会浪费隐私、成本和交互延迟优势。

同时，浏览器无法稳定覆盖所有设备、输入规模和复杂生成任务。

## 决策

三类 Execution Target 作为同级执行后端：

1. Browser Runtime。
2. Internal Worker。
3. Remote Provider。

同一个 Capability 可以有多个实现。Router 根据质量、成本、延迟、隐私、输入规模和设备基准选择实现，并保留自动或人工回退。

## 结果

- 背景移除、主体分割、选区、物品移除、OCR 和轻量超分进入浏览器候选能力。
- 浏览器任务同样产生 CapabilityRun、CapabilityAttempt、StoredObject / Artifact 和 UsageLedgerEntry。
- 必须定义设备支持矩阵、模型 Manifest、缓存、完整性校验、取消、超时和回退。
- 具体模型和运行时仍需技术评测。
