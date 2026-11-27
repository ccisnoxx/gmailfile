# 变更日志（Changelog）

本文件记录项目版本演进、数据库迁移基线与不可逆变更注意事项。

## [0.1.0] - 2026-11-27

### 新增与核心能力

- **认证与会话安全（迁移 `0001`–`0005`）**：单管理员 CLI 初始化（≥16 位强密码策略与离线黑名单）、Argon2id 哈希、TOTP + 一次性恢复码、WebAuthn/Passkey 无密码登录与 UV Step-Up、同源 `__Host-` Cookie、同步器 CSRF + Fetch Metadata 校验、闲置/绝对超时与双层限流。
- **账号与第三方应用管理（迁移 `0001`–`0007`）**：Gmail 规范化唯一性、乐观锁 `row_version` CAS、辅助邮箱 XOR 关联与统计、标签与第三方已注册应用/封禁状态管理、应用图标 SSRF 防护抓取（含公网 IP 固定连接、全局 8 秒时间预算、并发信号量、Nginx 独立限流、光栅尺寸与 PNG 解压炸弹校验）。
- **敏感字段按需保护**：Gmail 密码、绑定手机号、敏感备注均采用版本化 AES-256-GCM 加密；默认详情接口仅返回 `has_phone`/`has_notes`，通过独立 Step-Up 接口按需查看并 20 秒自动清除；覆盖已有 Gmail 密码同样要求最近重新验证。
- **回收站永久删除（迁移 `0007`）**：支持单条与批量不可逆永久删除，强制最近 5 分钟内 MFA Step-Up（批量额外要求输入 `DELETE <条数>`），自动将依赖站内辅助关联转为外部文本并释放邮箱唯一性。
- **防篡改审计与备份恢复**：PostgreSQL 触发器维护无间隙 SHA-256 哈希链与角色权限隔离，支持 Ed25519 非对称检查点签发/离线验签（兼容 HMAC-SHA256）、远程 Syslog 持久化磁盘补偿队列（`AUDIT_SYSLOG_SPOOL_FILE` 与 `flush-audit-spool`）、流式 `.gmenc` 加密导出、`age` 定时/异地加密备份及隔离恢复。
- **发布门禁与治理**：本地发布质量门禁涵盖 OpenAPI、文档基线一致性（`check-docs`）、Compose 4 组 overlay、Nginx 安全契约、构建物扫描、依赖锁文件/镜像摘要校验（`--online` 支持 `uv export` + `pip-audit` 与 `pnpm audit`）及本地全量发布门禁 `make gate-release-full`。

### 升级与回退注意事项

- **迁移 `0007` 不可逆边界**：迁移 `0007` 移除了 `audit_events.account_id -> gmail_accounts.id` 外键以保留已永久删除账号的历史审计链。若生产库已执行过永久删除，`0007 -> 0006` 的 `alembic downgrade` 会检测到孤立审计记录并明确拒绝回退；生产回退必须通过 `age` 加密备份执行隔离恢复与切换。
