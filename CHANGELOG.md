# 变更日志（Changelog）

本文件记录项目版本演进、数据库迁移基线与不可逆变更注意事项。

## [Unreleased] - 2026-11-28

### 安全与发布边界修复

- **Passkey-only TOTP 绑定鉴权边界**：已完整认证且仅启用通行密钥（Passkey）的会话在发起 TOTP `setup` 与 `confirm` 时强制要求近期既有 MFA Step-Up，防止仅凭密码重验新增二步验证因子；首次绑定与恢复码登录后的 `mfa_pending` 受限重绑流程保持独立通路；同步对齐前端 `step_up_totp_required=false` 场景下的绑定弹窗校验状态。
- **发布包文件清单全集校验与签名绑定**：将发布清单 `files` 字段设为必填且非空，校验发布目录实际普通文件集合与清单完全一致并拒绝符号链接与路径越界；将规范化文件清单摘要（`files_sha256`、`file_count`）纳入 Ed25519 源码与归档签名证明；`scripts/deploy.py` 导入业务模块前禁用字节码写出，防止从解压目录直接运行时生成 `__pycache__` 触发误拒。
- **嵌套保存点事务审计外发修复**：修复 SQLAlchemy `begin_nested()` 保存点释放提前触发 `after_commit` 外发审计、以及 `flush()` 内部逻辑子事务异常回滚误清空外层待发审计桶的问题，确保审计记录仅在顶层事务提交后按序外发。
- **应用图标抓取全局硬截止**：将阻塞式 DNS 解析、TCP 连接、TLS 握手与正文单次非阻塞缓冲读取（`read1`）统一纳入 `deadline` 硬截止时间预算，防止慢速流或挂起解析拖超总超时。

### 前端入口与状态一致性修复

- **命令面板深链接与分页保留**：将 `?modal=create`、`?modal=tags`、`?inspect=<id>` 等一次性动作参数与列表筛选签名（`listSearchKey`）解耦，修复命令面板打开新建表单或账号详情后立即自关的问题；消费参数时保留当前 `page` 与筛选条件，并防止 `defaultViewId` 首帧覆盖关闭深链接入口。
- **统一多入口辅助邮箱校验规则**：新增集中校验模块 `account-validation.ts`，让列表弹窗表单、详情抽屉与完整详情页共用辅助邮箱可选与四态（初始为空、主动清空、保留站内关联、切换外部地址）及 Gmail 规范化主辅同名校验。
- **快速领号备注文案去敏**：收口应用快速领号备注占位提示为非敏感业务用途说明，不再引导将手机号写入明文 `gmail_account_apps.note` 字段。
- **完整详情异步写回调代次守卫**：为完整详情页全部异步变更回调统一增加组件挂载态、认证会话状态、`queryClient.clear()` 缓存清理及跨账号切换代次守卫，防止退出或切号后迟到响应回填缓存或串写编辑草稿。

### 恢复、备份验收与文档对齐

- **加密导出 `.gmenc` 无损往返与边界明确**：为 CSV 标签增加 `\|` 与 `\\` 无损转义编解码（兼容手写单反斜杠）；识别系统导出表头时默认忽略只读 `account_no` 映射，支持加密导出解密后直接按默认映射导入空库；在 `docs/csv-transfer.md` 明确 CSV 凭据迁移与整库备份恢复的边界。
- **备份恢复 14 表清单对齐与存量兼容**：备份/异地接收端 `TABLES` 同步补齐迁移 `0005`–`0008` 新增的 4 张业务表（`admin_webauthn_credentials`、`webauthn_challenges`、`registered_apps`、`gmail_account_apps`）并新增与 SQLAlchemy `Base.metadata` 的一致性单测；引入 `counts_version: 2` 严格校验新备份 14 表计数，同时兼容升级前存量 10 表历史备份及 `< 0005` 历史库 `switch`。
- **发布门禁与测试追溯文档整理**：明确 `docs/production-deployment.md` 中 `check-release-gates.py` 静态门禁范围及正式发布留证要素，更新 `docs/testing/TRACEABILITY_MATRIX.md` 分离历史 `dc8ab44` 审计记录与当前 `0008` 基线状态。

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
