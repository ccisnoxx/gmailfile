# 安全政策与应急响应手册

## 支持范围与漏洞报告

- 本仓库维护单管理员自托管 Gmail 凭据管理面板的应用源码与示例部署模板。
- 请**不要**在公开 Issue、PR 或讨论区提交真实凭据、生产域名/IP、密钥材料或未披露的高危安全漏洞细节。
- 发现安全问题请通过仓库私有安全公告（GitHub Security Advisories）或直接联系项目维护者提交复现步骤、影响范围与建议修复方案。

---

## 威胁模型与加密字段边界

本系统定位为**服务端可解密凭据保险库**（非客户端零知识密码管理器），安全目标建立在“受控宿主机 + 隔离 Secret + 独立离线备份”的信任前提上。

| 数据类别 | 存储形态 | 访问门槛 |
| --- | --- | --- |
| Gmail 登录密码 | 字段级 AES-256-GCM（独立 12B nonce + 实体/ID/字段/版本 AAD） | `POST /api/v1/accounts/{id}/reveal-password`（完整认证 + CSRF + 最近 5 分钟 Step-Up + 审计） |
| 绑定手机号、敏感备注 | 字段级 AES-256-GCM（同上） | `POST /api/v1/accounts/{id}/reveal-sensitive`（完整认证 + CSRF + 最近 5 分钟 Step-Up + 审计）；普通详情仅返回 `has_phone`/`has_notes` |
| 管理员 TOTP Secret / 待确认 Secret | 字段级 AES-256-GCM | 仅后端认证状态机内部解密 |
| 管理员密码 / 恢复码 / Session / CSRF | Argon2id 或 SHA-256 哈希（无明文列） | 常量时间比对 |
| 主邮箱、辅助邮箱关系、状态、用途、标签、已注册应用、时间戳 | PostgreSQL 可检索明文列 | 完整认证（`authenticated`） |

**明确接受的安全边界：**

- 仅数据库文件泄露而数据密钥未泄露时，加密字段不可解密。
- 宿主机 `root` 失陷、API 容器被远程代码执行，或 Secret 目录与数据库同时泄露时，攻击者可解密全部字段。
- 审计表采用 PostgreSQL 哈希链与防改删触发器提供“可发现篡改”能力；为了抵御同机特权篡改，生产应配置独立远程 Syslog（配合 `AUDIT_SYSLOG_SPOOL_FILE` 磁盘队列补偿瞬时断网）与 Ed25519 非对称检查点（将公钥与定期检查点复制至独立信任域离线校验）。

---

## 应急响应方案（Runbook）

### 场景 1：宿主机或 API 容器失陷

1. **立即隔离**：在网络边界阻断公网入口（停止 Nginx 站点或防火墙封禁），保留容器与宿主机磁盘快照用于取证，切勿直接覆盖日志。
2. **默认视为凭据已暴露**：因宿主机持有 `/run/secrets/data_key_v*` 与数据库访问路径，必须假定库内全部 Gmail 密码、绑定手机号与敏感备注均已泄露。
3. **吊销与轮换**：
   - 立即修改受影响高价值 Gmail 账号密码并检查其 Google 安全活动与二步验证设备；
   - 在全新洁净宿主机上重新生成全部数据库角色密码、数据密钥（新版本 `data_key_vN`）、管理员密码、TOTP/Passkey 与 `age` 备份密钥；
   - 从失陷时间点之前且已校验完整性的异地加密备份执行隔离恢复并核验审计哈希链（`verify-audit` + `verify-audit-checkpoint`）。

### 场景 2：数据加密密钥（`data_key_vN`）泄露

1. **确认泄露范围**：核查数据库备份或密文是否同时外泄；若存在数据库备份同步泄露可能，立即按场景 1 对高价值 Gmail 密码执行改密。
2. **生成新版本密钥并在线下窗口轮换**：
   - 生成新的 32 字节原始随机密钥 `data_key_v(N+1)`，更新 `ACTIVE_DATA_KEY_VERSION=N+1`；
   - 执行 `uv run --locked python -m app.cli rotate-keys --target-version <N+1> --dry-run` 盘点，确认无误后执行正式轮换；
   - 执行 `uv run --locked python -m app.cli verify-keys --require-version <N+1>` 确认全库密文已升级至新密钥版本。
3. **重做基线备份并回收泄露副本**：立即触发一次新的加密备份与异地同步；确认历史备份归档与离线介质处置策略后，吊销泄露密钥的分发权限（保留受控离线冷备仅用于经授权的历史回溯）。

### 场景 3：管理员终端或浏览器失陷

1. **立刻终止全部活动会话**：在另一台可信设备登录并调用「安全设置 → 撤销其他/全部会话」，或直接修改管理员密码（服务端会自动撤销全部 Session 与预会话）。
2. **重置二步验证因子**：撤销失陷终端上的 Passkey 凭据，如怀疑 TOTP 验证器或恢复码文件同步泄露，重新绑定 TOTP 并重新生成整批一次性恢复码（旧恢复码整批立即失效）。
3. **审计回溯与止损**：
   - 使用 `verify-audit` 校验审计链完整性，排查失陷时间窗内的 `password_revealed`、`password_copied`、`sensitive_fields_revealed`、`sensitive_exported`、`account_updated` 与 `account_permanently_deleted` 事件；
   - 对曾被查看、导出或覆盖的 Gmail 账号立即逐一修改外部密码；若发生恶意永久删除，从最近一次健康异地加密备份隔离恢复。
