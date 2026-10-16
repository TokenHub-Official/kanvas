# ADR-0027：Provider Secret 默认零配置存储，可选启用 KEK 加密

- 状态：Accepted
- 日期：2026-08-13
- 部分替代：[ADR-0020](0020-versioned-config-secrets-and-provider-routing.md) 中
  “`encrypted_database` 是数据库托管默认且缺少 KEK 时禁止写入”的决策

## 背景

Kanvas 同时面向内部部署与开源自部署。强制部署者在首次连接 Provider 前生成
KEK、只读文件和映射 JSON，会让本地开发与最小自部署无法开箱使用；临时目录中的
KEK 在机器重启或目录清理后丢失，还会使已有密文不可恢复。

Secret 不回显、版本固定、轮换、吊销和执行时延迟解析仍是必须保留的产品与运行
不变量。这里调整的是数据库静态存储方式，不是 API 暴露边界。

## 决策

数据库托管 Provider Secret 支持两个显式来源：

1. 未配置 `KANVAS_PROVIDER_ACTIVE_KEK_VERSION` 与
   `KANVAS_PROVIDER_KEK_MAP_FILE` 时，使用 `plaintext_database`。材料以 Base64
   编码保存在专用 `material_plaintext_base64` 列；Base64 只表示编码，不宣称
   加密。
2. 配置有效 Active KEK 与映射文件时，使用现有 `encrypted_database` Envelope
   Encryption。
3. `deployment_reference` 保持不变。

创建或轮换 SecretVersion 时按当前部署配置选择来源。读取严格按该
SecretVersion 的 `source_kind` 解析：

- `plaintext_database` 不需要 KEK；
- `encrypted_database` 必须能解析其固定 `kek_version`，缺少 KEK 时 fail closed；
- 不把已有记录从一种来源隐式转换为另一种来源。

因此，移除 KEK 配置不会把历史密文降级为明文，也不保证历史加密凭据继续可用。
需要切换部署模式时，管理员必须保留旧 KEK 直到相关 Run 与轮换窗口结束，并通过
显式新 SecretVersion 完成切换。

## 不变量

1. Secret 明文仍不进入 API Response、Browser Storage、URL、日志、Trace、
   Audit、Queue、Artifact 或 Support Bundle。
2. ExecutionPlanSnapshot 继续固定 SecretVersion；Resolver 不选择更新版本。
3. `plaintext_database` 与 `encrypted_database` 使用互斥数据库列，Destroy
   必须清空两者。
4. 配置过 KEK 的记录缺少对应 KEK 时必须失败，禁止按明文解释 ciphertext。
5. 生产部署应配置 KEK；零配置明文模式是开源最小可用基线，不是同等级的静态
   数据保护。

## 后果

- 本地开发和开源自部署可以不创建任何 KEK 文件直接连接 Provider。
- 数据库读权限在明文模式下等价于 Provider Key 读取权限，备份也包含可恢复的
  Provider Key。
- 生产部署仍需独立备份 KEK；删除 KEK 会使相应历史密文不可恢复。
- 模式切换通过创建或轮换显式产生新 SecretVersion，不提供批量隐式迁移。
