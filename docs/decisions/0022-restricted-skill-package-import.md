# ADR-0022：V0 采用受限 Skill Package 导入 Profile

- 状态：Accepted
- 日期：2026-07-27

## 背景

Kanvas 的场景流程和 Skill 必须动态维护，但动态内容会带来 Archive、主动内容、远程拉取、Prompt Injection、依赖与供应链风险。只禁止脚本不足以形成可实现的导入边界。

## 决策

- V0 只允许获授权 Principal 从本地上传或已有 StoredObject 显式导入单层 ZIP。
- 所有内容先进入 Quarantine；Archive Inventory、Safe Extract、Media Probe、Canonical Manifest 与 Package Hash 通过后才能创建 Draft。
- 拒绝路径穿越、链接/设备、重名、加密/嵌套 Archive、Archive Bomb 与未知格式。
- 脚本源码允许作为非执行文件保留、查看和导出；不进入 Agent 的脚本或参考读取接口。仍拒绝二进制可执行文件、HTML 和 SVG；允许格式使用 Magic Bytes、受限解析器和资源上限。
- `kanvas.yaml` 通过版本化 Schema；Package Hash 由 Canonical Manifest 与有序资源 Hash 计算。
- 包文本始终是不可信数据，不能改变策略、授权、预算、审批、Egress 或 ToolView；外链不自动抓取。
- 发布继续使用不可变 Candidate/Revision；安全撤销在 Run 创建与每次 Dispatch Fail Closed。
- 公共 Registry、签名信任、自动更新、依赖求解和通用 Sandbox 不进入 V0。

## 结果

- 数据库动态维护不等于执行动态代码。
- 同一逻辑包拥有稳定内容身份，可审计、审核和撤销。
- V0 能安全支持内部场景包导入，同时避免提前建设完整供应链平台。
- SVG/HTML 等能力若未来需要，必须以独立 Sanitizer/Renderer Capability 和安全 Spike 扩展 Allowlist。

详细协议见 [SKILL-PACKAGE-SECURITY.md](../SKILL-PACKAGE-SECURITY.md)。

## 2026-09-14 导入兼容性调整

- ZIP 支持根目录或唯一一级目录中的 `SKILL.md`，采用相对于 Skill 根目录的资源路径；多个 Skill 或外部混杂文件要求拆包。
- 优先读取经 CRC 验证的 Unicode Path 信息，支持带标记或未标记的 UTF-8；旧 ZIP 默认 CP437，可显式选择 GB18030/GBK、Big5、Shift JIS。路径转换后继续检查规范化、冲突和越界。
- 源码保留不代表运行能力。发布前告知作者脚本不会执行，运行时明确说明不能伪称完成依赖脚本的步骤。
