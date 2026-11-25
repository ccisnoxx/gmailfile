# Gmail 账号管理面板需求与测试追溯矩阵（TRACEABILITY_MATRIX）

> 审计日期：2026-11-25（Wave 0 ~ Wave 4 同步：2026-11-26）  
> 审计基线：`dc8ab44`  
> 配套文档：[测试计划](TEST_PLAN.md) · [风险矩阵](RISK_MATRIX.md) · [25 项验收对照](../acceptance-matrix.md)

> **Wave 0 ~ Wave 4 状态更新（2026-11-26，全部 30 项规划用例 `TC-P0-001`~`TC-P2-005` 自动化闭环）**：
> - **Wave 0 已闭环**：`AC-07`、`AC-15`/`AC-16`、`AC-17`、`AC-18`、`AC-20`、`AC-23` 与 `AC-24` 的实证回归缺陷均已修复并补齐自动化回归。
> - **Wave 1 已闭环**：后端集成测试新增 **+12 项**，前端真实路由 OpenAPI 有状态 CSRF 契约测试新增 **+4 项**，闭环 `AC-04`、`AC-05`、`AC-07`、`AC-15`/`16`、`AC-18`、`AC-21`。
> - **Wave 2 已闭环**：新增 `scripts/run-live-e2e.py` + `frontend/e2e-live/fullstack.spec.ts`（**4/4 真实全栈通过**，`TC-P0-011`~`013`、`TC-P1-006`，零 API 桩）与 `backend/tests/integration/test_db_roles_and_recovery.py`（**3/3 通过**，`TC-P0-010`、`TC-P1-007`），闭环 `AC-06`、`AC-13`、`AC-18`/`AC-19`、`AC-20`、`AC-22` 与 `AC-23`。
> - **Wave 3 已闭环**：后端新增 `test_export_and_boundaries.py`（+2）与 `test_release_gates.py`（+7），`scripts/check-release-gates.py all` **5/5 PASS** 与 `Makefile` 本地门禁闭环 `AC-08`、`AC-09`、`AC-11`、`AC-16`、`AC-19` 与 `AC-25`。
> - **Wave 4 已闭环**：新增 `scripts/bench-csv-perf.py`（`TC-P2-001`~`002`，优化后 10k 导入 `22.920s`/RSS `258.08 MiB`、20k 流式导出 TTFB `0.002s`/内存增量 `4.44 MiB`）、`backend/tests/integration/test_dst_and_localization.py`（+2，`TC-P2-005`）、`frontend/tests/wave4-dst-date-boundary.test.tsx`（+2）及 `frontend/e2e/wave4-a11y-compat.spec.ts`（Chromium/Firefox/WebKit 三引擎 **15/15 通过**，`TC-P2-003`~`004` + 既有 `macos-keyboard-a11y.spec.ts` **8/8 通过**）；全仓库后端 **405/405 通过**（160 单元 + 245 PG17 集成，总覆盖率 **`96.37%`**、核心安全模块 **`95.20%`**），前端 **12 文件 / 100 Vitest 通过**。
> - **仅剩实例部署留证项**：上线前在 Linux 生产/验收环境补跑 PG18.7 + 真实 `age >= 1.2.1` + 真实 `nginx -t`/公网 TLS/429 及自然调度留证（`AC-01`、`AC-02`、`AC-08`、`AC-09`、`AC-20`）。

**覆盖状态图例**：
- `已覆盖`：已有与真实行为一致的自动化测试（含数据库/组件级验证）且当前通过。
- `部分覆盖`：核心逻辑有测试，但存在边界缺口、缺少真实集成/CLI/外发测试，或新 UI 未覆盖。
- `仅桩覆盖`：仅存在 Mock/Stub 测试（无法发现真实契约/CSRF/Cookie 集成缺陷）。
- `存在回归缺陷`：审计发现现行代码存在缺陷，或已有测试（如 Playwright E2E）已失配。
- `需实例留证`：依赖公网域名、TLS 证书、防火墙、真实自然调度或离线保管，无法仅靠代码单测替代。

---

## 1. 规格第 20 节 25 项上线验收标准追溯表

| 验收项 | 规格要求 | 主要实现文件 | 现有自动化测试 | 当前覆盖状态 | 风险 / 缺口与补充用例 |
|---|---|---|---|---|---|
| `AC-01` | `accounts.example.com` 通过有效 HTTPS 访问 | `infra/nginx/accounts.example.com.conf`、`infra/systemd/gmail-manager-cert-renew.*` | `test_config.py`（强制 HTTPS 配置） | `需实例留证` | 缺容器化 Nginx 语法/TLS 冒烟；实域名与续期归 L3 → `TC-P1-008` |
| `AC-02` | HTTP 自动跳转 HTTPS | `infra/nginx/accounts.example.com.conf:9-22` | 无自动化测试 | `需实例留证` | 补 Nginx 容器 301 重定向验证 → `TC-P1-008` |
| `AC-03` | 无公开注册接口，仅 CLI 初始化唯一管理员 | `backend/app/cli.py`、`api/v1/auth.py`、`models/auth.py` | `test_http.py`、`test_auth.py`（CLI 初始化/防重复）、`test_migrations.py`（单管理员约束） | `已覆盖` | 补充生产路由 `/preview/*` 零暴露检查 → `TC-P0-001` |
| `AC-04` | 管理员密码使用 Argon2id（含过时升级与 16 位策略） | `core/security.py`、`core/password_policy.py` | `test_security.py`、`test_auth.py` | `部分覆盖` | 缺 API 经 `PASSWORD_DENYLIST_FILE` 拦截与 `WEAK_PASSWORD` 契约测试 → `TC-P1-001` |
| `AC-05` | 生产环境强制 TOTP（含高风险 Step-Up） | `core/config.py`、`services/auth/totp_manager.py`、`state_machine.py` | `test_config.py`、`test_auth.py`、`accounts.test.tsx` | `部分覆盖` | 改密 Step-Up 一致性及真实全栈绑定/Step-Up E2E 缺失 → `TC-P0-003`、`TC-P0-011`、`TC-P0-012` |
| `AC-06` | Session 使用 `HttpOnly + Secure + SameSite=Strict` Cookie（`__Host-`） | `services/auth/session_manager.py` | `test_security.py`、`test_auth.py` | `部分覆盖` | 缺真实浏览器 Cookie 行为与轮换全栈 E2E → `TC-P0-011` |
| `AC-07` | 所有修改请求验证 CSRF（含 Origin / Fetch Metadata） | `services/auth/session_manager.py`、`frontend/src/features/*` | `test_auth.py`、`test_accounts.py`、`test_operations.py`、`test_service_modules.py`、`auth.test.tsx` | `存在回归缺陷` | **后端完整，但前端新 `/settings` 在 `reverify` 后使用过期 CSRF（`RSK-02`）** → `TC-P0-002`、`TC-P1-006` |
| `AC-08` | 登录接口同时有 Nginx 和应用层限流 | `services/auth/context.py`、`infra/nginx/accounts.example.com.conf` | `test_auth.py`（退避/锁定/忽略伪造头）、`test_deploy.py`（网关 IP） | `部分覆盖` | 缺 Nginx 层 429 实测及非 login 认证入口 Nginx 限流评审 → `TC-P1-008` |
| `AC-09` | PostgreSQL 和 FastAPI 内部端口不向公网暴露 | `infra/docker-compose.yml`、`docker-compose.production.yml` | `test_deploy.py`（回环端口检查） | `部分覆盖` / `需实例留证` | 补 Compose 全量 overlay 静态检验 → `TC-P1-009` |
| `AC-10` | Gmail 密码、手机号、敏感备注、TOTP 使用 AES-256-GCM 加密 | `core/encryption.py`、`services/accounts/detail.py`、`totp_manager.py` | `test_security.py`、`test_accounts.py`、`test_migrations.py`、`test_backup.py` | `已覆盖` | 结合 L3 恢复抽样覆盖多版本密钥 → `TC-P1-007` |
| `AC-11` | 数据密钥不在 DB、Git、镜像或构建物内 | `backend/Dockerfile`、`infra/backup/Dockerfile`、`scripts/package-release.py`、`scripts/generate-secrets.py` | `test_secrets.py`、`test_package_release.py`、`acceptance_checks.py` | `部分覆盖` | 缺前端 `frontend/dist` 构建物密钥/外链自动扫描 → `TC-P1-010` |
| `AC-12` | 列表和普通详情接口不返回密码或密文 | `schemas/accounts.py`、`services/accounts/listing.py`、`detail.py` | `test_accounts.py`、`test_management.py`、`test_operations.py` | `已覆盖` | 补真实全栈网络响应断言 → `TC-P0-011` |
| `AC-13` | 查看密码需要最近重新验证（+ Step-Up TOTP）且前端 20s 清理 | `services/accounts/detail.py`、`password-control.tsx`、`detail/use-password-secret.ts` | `test_accounts.py`、`test_auth.py`、`accounts.test.tsx`、`macos-account-detail.test.tsx` | `部分覆盖` | 缺真实 Chromium 下的 20s/后台隐藏/剪贴板权限全栈 E2E → `TC-P0-012` |
| `AC-14` | Gmail 规范化地址不可重复（软删除仍保留） | `schemas/accounts.py:normalize_email`、DB 唯一约束 | `test_email_normalization.py`、`test_accounts.py`、`test_migrations.py`、`test_operations.py` | `已覆盖` | — |
| `AC-15` | 支持新增、编辑、筛选、归档、软删除和恢复 | `api/v1/accounts.py`、`features/accounts/*` | `test_accounts.py`、`accounts.test.tsx`、`macos-accounts.test.tsx`、`macos-account-detail.test.tsx`、`e2e/accounts.spec.ts` | `存在回归缺陷` | **新详情页 `logged-in` 调错接口、关联辅助账号编辑 422、500 字截断；Playwright `accounts.spec.ts` 失效（`RSK-04`/`05`）** → `TC-P0-005`、`TC-P0-006`、`TC-P0-014` |
| `AC-16` | 支持辅助邮箱文本和账号关联两种模式（XOR/非自身） | `services/accounts/detail.py`、`recovery-selector.tsx` | `test_accounts.py`、`test_migrations.py`、`accounts.test.tsx`、`management.test.tsx` | `存在回归缺陷` | 新详情页未提供关联模式编辑并破坏 XOR（`RSK-04`）；API 未拒绝新选已软删账号（`RSK-18`）→ `TC-P0-005`、`TC-P1-004` |
| `AC-17` | 支持状态、用途、标签、时间筛选、排序、分页与 URL 恢复 | `repositories/accounts.py`、`query-state.ts`、`account-filters.tsx`、`account-table.tsx` | `test_management.py`、`management.test.tsx`、`routing-and-modules.test.tsx`、`e2e/management.spec.ts` | `存在回归缺陷` | **首页统计口径与列映射偏移、风险筛选不全、操作列失 sticky、`management.spec.ts` 失效（`RSK-05`）** → `TC-P0-007`、`TC-P0-014`、`TC-P2-005` |
| `AC-18` | 支持 CSV 导入预览和提交（10 MiB、两阶段、事务） | `api/v1/transfers.py`、`core/upload.py`、`services/csv_transfer/*`、`csv-import-panel.tsx`、`csv-import-page.tsx` | `test_operations.py`、`test_auth_locking.py`、`test_service_modules.py`、`operations.test.tsx`、`macos-csv-import.test.tsx` | `部分覆盖` | `CsvUploadLimit` 中间件顺序缺陷（`RSK-08`）；缺真实全栈 E2E 与 10,000 行性能基线 → `TC-P0-013`、`TC-P0-015`、`TC-P2-001` |
| `AC-19` | 默认导出不含敏感字段（全匹配、流式、公式防护） | `api/v1/transfers.py:/exports/csv`、`services/csv_transfer/exporter.py`、`csv-adapter.ts` | `test_operations.py`、`test_service_modules.py`、`macos-csv-import.test.tsx` | `存在回归缺陷` | **新 `/transfers/csv` 筛选导出传空 `{}`（`RSK-06`）；流式导出连接池耗尽风险（`RSK-07`）** → `TC-P0-013`、`TC-P1-002`、`TC-P1-003`、`TC-P2-002` |
| `AC-20` | 自动备份成功且完成恢复演练（防伪造、异地、切换 Step-Up） | `scripts/backup_tool.py`、`infra/backup/*`、`backend/app/ops/verify_restore.py`、`features/settings/*` | `test_backup.py`、`test_offsite.py`、`test_acceptance_schedule.py`、`operations.test.tsx` | `存在回归缺陷` / `需实例留证` | **新 `/settings` Live 模式伪造备份成功和恢复演练（`RSK-03`）**；缺自动化 PG18 真工具链回归 → `TC-P0-004`、`TC-P1-007` |
| `AC-21` | 日志与审计不含敏感明文（含 0004 防篡改审计链与外发） | `core/logging.py`、`core/errors.py`、`core/audit_sink.py`、`alembic/versions/0004_*.py` | `test_http.py`、`test_auth.py`、`test_accounts.py`、`test_operations.py`、`test_migrations.py`、`test_security.py` | `部分覆盖` | **`audit_sink.py` 事务钩子与外发、CLI `verify-audit`/`sign-audit-checkpoint` 零自动化测试（`RSK-15`）** → `TC-P0-008`、`TC-P0-009` |
| `AC-22` | Alembic Migration 可从空数据库完整执行（含 0004 与角色脚本） | `backend/alembic/versions/0001..0004`、`infra/postgres/*.sh` | `test_migrations.py`、`test_auth.py`、`acceptance_checks.py` | `部分覆盖` | 未直接执行 `init-roles.sh`/`upgrade-backup-role.sh`/`upgrade-audit-role.sh` 脚本测试 → `TC-P0-010` |
| `AC-23` | 后端、前端和关键 E2E 测试通过 | `backend/tests/*`、`frontend/tests/*`、`frontend/e2e/*` | 后端单测 150、集成 193、前端 Vitest 87、Playwright 6 | `存在回归缺陷` | Playwright 4/6 失效、无真实全栈 E2E、无覆盖率统计与跨浏览器/无障碍测试 → `TC-P0-011`~`014`、`TC-P2-003`、`TC-P2-004` |
| `AC-24` | README 及手册包含完整部署、升级、备份、恢复与密钥丢失说明 | `README.md`、`docs/*.md` | `test_package_release.py`（仅检代码配置一致性） | `部分覆盖` | `README.md` 与 `implementation-plan.md` 仍写旧版 `0003` 迁移与 8 位密码（`RSK-10`） |
| `AC-25` | 生产构建关闭 debug、公开 Swagger/OpenAPI，无堆栈与通配 CORS | `core/config.py`、`main.py`、`infra/nginx/accounts.example.com.conf` | `test_config.py`、`test_http.py` | `部分覆盖` | 缺生产 `dist/` 静态扫描与容器化 Nginx 屏蔽检查 → `TC-P0-001`、`TC-P1-008`、`TC-P1-010` |

---

## 2. 模块级现有测试覆盖矩阵

### 2.1 后端测试覆盖矩阵（共 343 个已收集 pytest 用例）

| 功能域 | 覆盖的代码模块 / 接口 / 脚本 | 现有测试文件 | 收集用例数 | 覆盖深度 | 明确缺口 |
|---|---|---|---:|---|---|
| **应用配置与 HTTP 边界** | `core/config.py`, `main.py`, `core/errors.py`, `api/v1/system.py` | `unit/test_config.py`, `unit/test_http.py` | 13 + 11 = **24** | Unit | 缺 `PASSWORD_DENYLIST_FILE` 不存在报错、`CsvUploadLimit` 与 `request_context` 交互顺序 |
| **密码学与安全原语** | `core/encryption.py`, `core/security.py`, `core/password_policy.py`, `services/audit_integrity.py`, `core/audit_sink.py`（仅 URL 解析） | `unit/test_security.py`, `unit/test_service_modules.py` | 28 + 10 = **38** | Unit | **`audit_sink.py` 钩子/外发/回滚丢弃/Syslog 失败处理无测试** |
| **邮箱规范化** | `schemas/accounts.py:email_value/normalize_email` | `unit/test_email_normalization.py` | **9** | Unit | 覆盖充分 |
| **认证、TOTP、限流与 CLI** | `api/v1/auth.py`, `services/auth/*`, `cli.py:create_admin` | `integration/test_auth.py` | **41** | Integration（PG） | 缺 `cli.py` `verify-audit` & `sign-audit-checkpoint`；缺 API 层 `PASSWORD_DENYLIST_FILE` 与恢复码后改密 Step-Up |
| **事务锁与并发隔离** | `api/dependencies.py`, `AUTH_LOCK`, `ACCOUNT_WRITE_LOCK` | `integration/test_auth_locking.py` | **7** | Integration（PG 并发） | 缺流式 CSV 导出并发连接池测试 |
| **数据库迁移与防篡改触发器** | `alembic/versions/0001..0004`, DB CHECK/FK/UNIQUE/Trigger | `integration/test_migrations.py` | **19** | Integration（PG） | 角色权限为 SQL 模拟，未执行 `infra/postgres/*.sh` 真实脚本 |
| **账号 CRUD、加密、标签、密码查看** | `api/v1/accounts.py`（核心）, `services/accounts/detail.py`, `tags.py` | `integration/test_accounts.py` | **51** | Integration（PG） | 缺“新建/切换指向已软删除辅助账号”显式契约用例 |
| **列表筛选、统计、批量与闲置活动** | `repositories/accounts.py`, `services/accounts/listing.py`, `/dashboard/summary`, `/recovery-emails`, `/batch-*`, `/auth/activity` | `integration/test_management.py` | **35** | Integration（PG） | 缺跨 DST 复杂时区组合与大规模性能基线 |
| **CSV 导入导出、Session、审计与系统运维** | `api/v1/transfers.py`, `api/v1/operations.py`, `services/csv_transfer/*`, `services/operations.py` | `integration/test_operations.py` | **40** | Integration（PG） | 缺 10,000 行/20,000 行压测、慢速流消费与 `CsvUploadLimit` 中间件顺序测试 |
| **备份、恢复与异地 SSH** | `scripts/backup_tool.py`, `infra/backup/receiver.py`, `scripts/prepare-offsite-identity.py`, `scripts/acceptance_schedule.py`, `ops/verify_restore.py` | `unit/test_backup.py`, `unit/test_offsite.py`, `unit/test_acceptance_schedule.py` | 13 + 30 + 17 = **60** | Unit（含大量 monkeypatch） | 缺真实 `pg_dump`+`age`+`pg_restore`+`switch` 端到端自动化集成回归 |
| **Secret、打包溯源与部署** | `scripts/generate-secrets.py`, `scripts/package-release.py`, `scripts/deploy.py`, `core/release_meta.py` | `unit/test_secrets.py`, `unit/test_package_release.py`, `unit/test_deploy.py` | 4 + 3 + 12 = **19** | Unit | 缺依赖漏洞审计、Compose 全 overlay 检查及 `dist/` 安全扫描 |

### 2.2 前端测试覆盖矩阵（共 87 个 Vitest 用例 + 6 个 Playwright 用例）

| 前端页面 / 路由 | 对应实现模块 | Vitest 覆盖 | Playwright 覆盖 | 覆盖深度与主要问题 |
|---|---|---|---|---|
| **登录 / MFA 绑定 / 恢复码 / 闲置锁定** (`/`) | `features/auth/*` | `auth.test.tsx`（14） | `skeleton.spec.ts`（2，Stub） | 逻辑覆盖强；缺少真实后端 Cookie/CSRF/TOTP 全栈 E2E |
| **账号列表主页** (`/`, `/accounts`) | `features/accounts/accounts-page.tsx`, `account-table.tsx`, `account-filters.tsx`, `account-batch-bar.tsx`, `recovery-usage-view.tsx` | `accounts.test.tsx`（18）、`management.test.tsx`（15）、`macos-accounts.test.tsx`（6） | `accounts.spec.ts`（2，**失效**）、`management.spec.ts`（2，**部分失效**） | **存在回归缺陷**：统计口径偏移、列字段错位、操作列失 `sticky`；E2E 未随 `dc8ab44` 同步更新 |
| **账号详情三栏页** (`/accounts/:accountId`) | `features/accounts/detail/*` | `macos-account-detail.test.tsx`（6，5 桩/preview + 1 live） | **0（无覆盖）** | **存在回归缺陷**：`logged-in` 错调接口、内部辅助账号编辑 XOR 422、500 字截断、审计事件键名错配 |
| **CSV 导入与批量操作页** (`/transfers/csv`, `/imports/csv`) | `features/transfers/*` | `macos-csv-import.test.tsx`（6，5 mock + 1 live） | **0（无覆盖）** | Live 筛选导出传空 `{}`；侧栏失败回退假数据；缺 E2E |
| **系统设置页** (`/settings`, `/settings/:section`) | `features/settings/*` | `macos-settings.test.tsx`（6，5 mock + 1 失真 live） | **0（无覆盖）** | **严重缺陷**：Live `reverify` 后 CSRF 过期必 403；Live 伪造备份与恢复演练成功；混入 Mock 默认值 |
| **遗留安全设置与运维页** (`/security`, `/operations`) | `features/auth/security-settings-panel.tsx`, `features/operations/*` | `operations.test.tsx`（9）、`auth.test.tsx`、`routing-and-modules.test.tsx`（4） | **0（无覆盖）** | 与新 `/settings`、`/transfers/csv` 形成双轨入口割裂 |
| **预览路由** (`/preview/*`) | `app/routes/*-preview-route.tsx` | `macos-*.test.tsx`（仅测渲染） | **0** | **严重安全风险**：未隔离于开发环境，暴露在生产 `router.tsx` 中 |
| **路由系统与总览页** | `app/router.tsx`, `pages/overview.tsx` | `routing-and-modules.test.tsx`（4，未测真实 `router.tsx`）、`overview.test.tsx`（3） | — | 真实 `router.tsx` 未被自动化测试直接验证 |

---

## 3. 正向 / 反向追溯汇总统计

| 维度 | 统计项 | 数值 | 说明 |
|---|---|---:|---|
| **规格 25 项验收标准** | 已覆盖（自动化闭环） | **4 / 25** | `AC-03`, `AC-10`, `AC-12`, `AC-14` |
| | 部分覆盖（含 1 项兼需实例留证 `AC-09`） | **12 / 25** | `AC-04`, `AC-05`, `AC-06`, `AC-08`, `AC-09`, `AC-11`, `AC-13`, `AC-18`, `AC-21`, `AC-22`, `AC-24`, `AC-25` |
| | 存在实证回归缺陷（含 1 项兼需实例留证 `AC-20`） | **7 / 25** | `AC-07`, `AC-15`, `AC-16`, `AC-17`, `AC-19`, `AC-20`, `AC-23` |
| | 纯实例部署留证项 | **2 / 25** | `AC-01`, `AC-02`（另 `AC-09`、`AC-20` 亦需实例独立留证） |
| **现有自动化测试规模** | 后端 pytest 总计 | **343** | 单元测试 **150**（实测全过）+ 集成测试 **193**（需 `gm_test*` PG） |
| | 前端 Vitest 总计 | **87** | 10 文件实测全过，但部分新页面 Live 桩失真 |
| | Playwright E2E 总计 | **6** | 全部为响应桩；**4 项受 `dc8ab44` 影响失配**；真实全栈 E2E 为 **0** |
| **规划新增测试规模** | P0 阻塞级用例 | **15** | `TC-P0-001` ~ `TC-P0-015`（覆盖全部 4 项 Critical 及核心 High 风险） |
| | P1 重要功能与运维用例 | **10** | `TC-P1-001` ~ `TC-P1-010`（覆盖策略、连接池、Nginx、容器恢复与供应链） |
| | P2 非功能与兼容性用例 | **5** | `TC-P2-001` ~ `TC-P2-005`（覆盖万级性能/内存、无障碍、三浏览器与复杂时区） |
