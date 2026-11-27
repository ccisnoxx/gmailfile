# Gmail 账号管理面板需求与测试追溯矩阵（TRACEABILITY_MATRIX）

> 当前维护日期：2026-11-27（迁移基线：`0008`，含安全与一致性修复闭环）  
> 历史初审基线归档：`dc8ab44`（2026-11-25 初审发现的回归项已在 2026-11-26 Wave 0~4 及 2026-11-27 修复批次中全部闭环）  
> 配套文档：[测试计划](TEST_PLAN.md) · [风险矩阵](RISK_MATRIX.md) · [25 项验收对照](../acceptance-matrix.md)

> **当前主干验证状态说明（避免将 `dc8ab44` 历史初审记录误读为现存缺陷）**：
> - **现行状态**：规格第 20 节 25 项上线验收标准中，代码与本地自动化层已闭环 **23 / 25** 项；剩余需在真实公网/Linux 生产拓扑独立留证的条目为 `AC-01`、`AC-02`（以及 `AC-08`、`AC-09`、`AC-20` 的真实宿主机/PG18 自然调度部分）。
> - **2026-11-27 安全与一致性加固增量**：
>   1. 认证边界：`Passkey-only` 态绑定/确认新 TOTP 强制校验既有 MFA Step-Up（`test_auth_totp_passkey_boundary.py`、`test_wave4_webauthn.py`）；
>   2. 发布与备份：发布清单 `files` 必填且纳入 Ed25519 源码证明摘要并核对目录文件全集（`test_deploy.py`）；备份恢复 `TABLES` 同步覆盖 `0008` 全部 14 张业务表并与 SQLAlchemy `Base.metadata` 自动对齐（`test_csv_roundtrip_and_backup_tables.py`）；
>   3. 事务审计与导入导出：`begin_nested()` 保存点释放不再提前外发审计（`test_audit_sink_spool.py`）；`.gmenc` 加密导出支持 `\|` / `\\` 标签无损转义与空库默认导入（`test_csv_roundtrip_and_backup_tables.py`）；图标抓取纳入全局硬截止时限（`test_app_icons_and_permanent_delete.py`）；
>   4. 前端一致性：命令面板 `?modal=create` / `?inspect=<id>` 深链接保持弹窗/抽屉常驻且保留分页、完整详情页统一辅助邮箱四态可选校验、快速领号备注移除敏感引导、完整详情异步写回调统一挂载与缓存清理守卫（`p0-p1-optimizations.test.tsx`、`macos-account-detail.test.tsx`）。
> - **历史基线说明**：下方表格“历史初审记录与闭环验证”列保留 `dc8ab44` 阶段定位过的风险编号（`RSK-*` / `TC-*`）仅供回归溯源，不代表当前 `main` 仍存在对应缺陷。

**当前覆盖状态图例**：
- `已覆盖`：已有与当前真实行为一致的自动化测试（单元、数据库集成、组件或全栈 E2E）且在当前主干通过。
- `已覆盖（兼需实例留证）`：代码、配置与契约层已完成自动化校验，上线前仍需在目标 Linux / 公网域名 / PG18 实例留存运行证据。
- `需实例留证`：依赖公网域名、真实 TLS 证书签发续期或宿主机网络拓扑，需在目标实例直接验收。

---

## 1. 规格第 20 节 25 项上线验收标准追溯表（当前状态）

| 验收项 | 规格要求 | 主要实现文件 | 自动化验证位置 | 当前覆盖状态 | 历史初审记录（`dc8ab44`）与闭环说明 |
|---|---|---|---|---|---|
| `AC-01` | `accounts.example.com` 通过有效 HTTPS 访问 | `infra/nginx/accounts.example.com.conf`、`infra/systemd/gmail-manager-cert-renew.*` | `test_config.py`、`test_release_gates.py`（Nginx 门禁） | `需实例留证` | 静态配置门禁已覆盖；实域名 TLS 与续期归实例验收（`TC-P1-008`） |
| `AC-02` | HTTP 自动跳转 HTTPS | `infra/nginx/accounts.example.com.conf:9-22` | `test_release_gates.py`（`check_nginx` 301 检查） | `需实例留证` | 配置规则已纳入发布门禁；公网 80→443 实测归实例验收（`TC-P1-008`） |
| `AC-03` | 无公开注册接口，仅 CLI 初始化唯一管理员 | `backend/app/cli.py`、`api/v1/auth.py`、`app/router.tsx` | `test_http.py`、`test_auth.py`、`test_migrations.py`、`wave1-contract-router.test.tsx` | `已覆盖` | 已闭环生产路由 `/preview/*` 隔离检查（`TC-P0-001`） |
| `AC-04` | 管理员密码使用 Argon2id（含过时升级与 16 位策略） | `core/security.py`、`core/password_policy.py` | `test_security.py`、`test_auth.py`、`test_wave1_p1.py` | `已覆盖` | 已补齐 `PASSWORD_DENYLIST_FILE` 与 `WEAK_PASSWORD` 契约测试（`TC-P1-001`） |
| `AC-05` | 生产环境强制 MFA（TOTP / Passkey 含高风险 Step-Up） | `core/config.py`、`services/auth/totp_manager.py`、`webauthn_manager.py`、`state_machine.py` | `test_config.py`、`test_auth.py`、`test_wave4_webauthn.py`、`test_auth_totp_passkey_boundary.py`、`fullstack.spec.ts` | `已覆盖` | 已闭环改密 Step-Up、WebAuthn Passkey 及 `Passkey-only` 下绑定 TOTP 的既有 MFA 校验（`TC-P0-003`/`011`/`012`） |
| `AC-06` | Session 使用 `HttpOnly + Secure + SameSite=Strict` Cookie（`__Host-`） | `services/auth/session_manager.py` | `test_security.py`、`test_auth.py`、`fullstack.spec.ts` | `已覆盖` | 已补真实浏览器 Cookie 与会话轮换全栈 E2E（`TC-P0-011`） |
| `AC-07` | 所有修改请求验证 CSRF（含 Origin / Fetch Metadata） | `services/auth/session_manager.py`、`frontend/src/features/*` | `test_auth.py`、`test_accounts.py`、`wave1-contract-router.test.tsx`、`fullstack.spec.ts` | `已覆盖` | `dc8ab44` 历史问题 `/settings` `reverify` 后旧 CSRF 已修复并自动化回归（`RSK-02` / `TC-P0-002`） |
| `AC-08` | 登录接口同时有 Nginx 和应用层限流 | `services/auth/context.py`、`infra/nginx/accounts.example.com.conf` | `test_auth.py`、`test_deploy.py`、`test_release_gates.py` | `已覆盖（兼需实例留证）` | 应用层退避与 Nginx `limit_req` 门禁已覆盖；宿主机 429 压测归实例留证（`TC-P1-008`） |
| `AC-09` | PostgreSQL 和 FastAPI 内部端口不向公网暴露 | `infra/docker-compose.yml`、`docker-compose.production.yml` | `test_deploy.py`、`test_release_gates.py`（`compose-all`） | `已覆盖（兼需实例留证）` | Compose 全 overlay 回环/内网绑定已静态门禁化（`TC-P1-009`） |
| `AC-10` | Gmail 密码、手机号、敏感备注、TOTP 使用 AES-256-GCM 加密 | `core/encryption.py`、`services/accounts/detail.py`、`totp_manager.py` | `test_security.py`、`test_accounts.py`、`test_migrations.py`、`test_backup.py` | `已覆盖` | 含 AAD 绑定实体/ID/字段/密钥版本与轮换校验（`TC-P1-007`） |
| `AC-11` | 数据密钥不在 DB、Git、镜像或构建物内 | `backend/Dockerfile`、`scripts/package-release.py`、`scripts/check-release-gates.py` | `test_secrets.py`、`test_package_release.py`、`test_release_gates.py`（`scan-dist`） | `已覆盖` | 已纳入打包私钥扫描与 `frontend/dist` 产物扫描（`TC-P1-010`） |
| `AC-12` | 列表和普通详情接口不返回密码或密文 | `schemas/accounts.py`、`services/accounts/listing.py`、`detail.py` | `test_accounts.py`、`test_management.py`、`p0-p1-optimizations.test.tsx`、`fullstack.spec.ts` | `已覆盖` | 应用快速领号备注同步收口为非敏感说明，防止引导写入手机号 |
| `AC-13` | 查看密码需要最近重新验证（+ Step-Up）且前端 20s 清理 | `services/accounts/detail.py`、`password-control.tsx`、`detail/use-password-secret.ts` | `test_accounts.py`、`accounts.test.tsx`、`macos-account-detail.test.tsx`、`fullstack.spec.ts` | `已覆盖` | 含退出清缓存与卸载后禁止迟到响应回填详情缓存（`TC-P0-012`） |
| `AC-14` | Gmail 规范化地址不可重复（软删除仍保留） | `schemas/accounts.py:normalize_email`、DB 唯一约束 | `test_email_normalization.py`、`test_accounts.py`、`test_migrations.py` | `已覆盖` | — |
| `AC-15` | 支持新增、编辑、筛选、归档、软删除、永久删除和恢复 | `api/v1/accounts.py`、`features/accounts/*` | `test_accounts.py`、`accounts.test.tsx`、`macos-account-detail.test.tsx`、`p0-p1-optimizations.test.tsx`、`e2e/*.spec.ts` | `已覆盖` | `dc8ab44` 详情动作/截断与命令面板深链接自关问题均已闭环（`TC-P0-005`/`006`/`014`） |
| `AC-16` | 支持辅助邮箱文本、账号关联与暂不设置（XOR/非自身） | `services/accounts/detail.py`、`account-validation.ts`、`account-form.tsx`、`account-basic-info-form.tsx` | `test_accounts.py`、`test_wave1_p1.py`、`accounts.test.tsx`、`macos-account-detail.test.tsx` | `已覆盖` | 列表弹窗、抽屉编辑与完整详情页已共用 `account-validation.ts` 四态规则（`TC-P0-005`、`TC-P1-004`） |
| `AC-17` | 支持状态、用途、标签、应用、时间筛选、排序、分页与 URL 恢复 | `repositories/accounts.py`、`query-state.ts`、`account-filters.tsx` | `test_management.py`、`management.test.tsx`、`wave4-dst-date-boundary.test.tsx`、`p0-p1-optimizations.test.tsx` | `已覆盖` | 含跨 DST 本地日历边界与命令面板消费一次性参数保留分页（`TC-P0-007`、`TC-P2-005`） |
| `AC-18` | 支持 CSV 导入预览和提交（10 MiB、两阶段、保存点原子回滚） | `api/v1/transfers.py`、`core/upload.py`、`services/csv_transfer/*` | `test_operations.py`、`test_csv_roundtrip_and_backup_tables.py`、`macos-csv-import.test.tsx`、`fullstack.spec.ts` | `已覆盖` | 含上传大小中间件、10k 行性能基线、`.gmenc` 空库重导与 `\|` 标签无损转义（`TC-P0-013`/`015`、`TC-P2-001`） |
| `AC-19` | 默认导出不含敏感字段（全匹配、流式、公式防护）与 `.gmenc` 加密导出 | `api/v1/transfers.py`、`services/csv_transfer/exporter.py`、`core/export_crypto.py` | `test_operations.py`、`test_export_and_boundaries.py`、`test_export_crypto.py`、`macos-csv-import.test.tsx` | `已覆盖` | `dc8ab44` 筛选条件透传与连接池释放均已闭环（`TC-P1-002`/`003`、`TC-P2-002`） |
| `AC-20` | 自动备份成功且完成恢复演练（防伪造、异地、14 表计数验收、Step-Up） | `scripts/backup_tool.py`、`infra/backup/*`、`ops/verify_restore.py` | `test_backup.py`、`test_offsite.py`、`test_csv_roundtrip_and_backup_tables.py`、`test_db_roles_and_recovery.py` | `已覆盖（兼需实例留证）` | 恢复行数校验已同步覆盖 `0008` 全量 14 张表并兼容旧版清单；PG18 定时自然调度归实例留证（`TC-P0-004`、`TC-P1-007`） |
| `AC-21` | 日志与审计不含敏感明文（防篡改哈希链与顶层提交后外发） | `core/logging.py`、`core/audit_sink.py`、`services/audit_integrity.py` | `test_audit_sink.py`、`test_audit_sink_spool.py`、`test_cli_audit.py`、`test_migrations.py` | `已覆盖` | 已闭环 `begin_nested()` 保存点释放不提前外发、外层回滚零外发及 Syslog Spool 补偿（`TC-P0-008`/`009`） |
| `AC-22` | Alembic Migration 可从空数据库完整执行（`0001`..`0008` 与角色脚本） | `backend/alembic/versions/0001..0008`、`infra/postgres/*.sh` | `test_migrations.py`、`test_migration_0008.py`、`test_db_roles_and_recovery.py` | `已覆盖` | 已包含真实角色初始化与升级脚本集成验证（`TC-P0-010`） |
| `AC-23` | 后端、前端和关键 E2E 测试通过 | `backend/tests/*`、`frontend/tests/*`、`frontend/e2e/*`、`frontend/e2e-live/*` | 见下方第 2 节最新基线 | `已覆盖` | 单元、PG 集成、Vitest 组件/路由契约与 Playwright E2E 均已对齐现行实现（`TC-P0-011`~`014`） |
| `AC-24` | README 及手册包含完整部署、升级、备份、恢复、CSV 边界与密钥丢失说明 | `README.md`、`docs/*.md`、`core/release_meta.py` | `test_package_release.py`、`test_release_gates.py`（`check_docs`） | `已覆盖` | 已明确静态门禁范围、发布证明 `files` 完整性及 `.gmenc` 与整库备份边界 |
| `AC-25` | 生产构建关闭 debug、公开 Swagger/OpenAPI，无堆栈与通配 CORS | `core/config.py`、`main.py`、`infra/nginx/accounts.example.com.conf` | `test_config.py`、`test_http.py`、`test_release_gates.py` | `已覆盖` | 已由配置强校验与 `scan-dist` / `nginx` 门禁共同保障（`TC-P0-001`、`TC-P1-010`） |

---

## 2. 当前测试资产结构（迁移基线 `0008`）

| 测试层级 | 目录 / 入口 | 主要覆盖范围 | 运行要求说明 |
|---|---|---|---|
| **后端单元测试** | `backend/tests/unit/`（`pytest -m "not integration"`） | 配置与密码学、认证状态机与 `Passkey-only` TOTP 边界、嵌套保存点审计钩子与 Syslog Spool、`.gmenc` 加解密与空库往返导入、图标抓取 SSRF/超时硬截止、发布包文件全集验签、备份保留与 14 表元数据对齐 | 本地 Python + `uv.lock` 即可直接运行（其中 3 个 Unix datagram socket 测试需运行环境允许 `AF_UNIX` `SOCK_DGRAM`） |
| **后端数据库集成测试** | `backend/tests/integration/`（`make test-db`） | PostgreSQL 迁移 `0001`..`0008`、最小权限角色脚本、行锁/咨询锁并发、TOTP + WebAuthn 全链路、账号 CRUD/批量/应用领号、CSV 流式导入导出、防篡改审计触发器与恢复演练 | 需独立 `TEST_DATABASE_URL`（`gm_test*` PostgreSQL 实例） |
| **前端组件与路由契约测试** | `frontend/tests/`（`pnpm test`） | 登录/MFA/WebAuthn、持久壳层与 `⌘K` 命令面板深链接、列表筛选/批量/快速领号、抽屉与三栏完整详情（含四态辅助邮箱与退出缓存守卫）、CSV 迁移与系统设置 | 本地 Node + `pnpm-lock.yaml`（Vitest + jsdom） |
| **浏览器与全栈 E2E 测试** | `frontend/e2e/`、`frontend/e2e-live/`（`make test-e2e` / `make test-e2e-live`） | 跨浏览器键盘无障碍、响应式布局，以及零 API 桩真实后端 + PostgreSQL 全栈登录/Step-Up/查密/CSV 闭环 | 需 Playwright 浏览器内核（全栈 E2E 另需 PostgreSQL 测试库） |
| **静态与供应链发布门禁** | `scripts/check-release-gates.py` | OpenAPI 契约同步、文档与 `0008` 能力清单一致性、Compose 全 overlay、Nginx 安全头与限流、`frontend/dist` 产物扫描、锁文件哈希与在线漏洞审计 | 与上述动态测试套件互补；正式发布需同时记录静态门禁与动态测试执行结果 |

