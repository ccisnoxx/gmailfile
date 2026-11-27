# Gmail 账号管理面板测试体系审计与测试计划（TEST_PLAN）

> 文档状态：Wave 0 ~ Wave 4 全部完成并验证（2026-11-26）  
> 审计日期：2026-11-25  
> 审计基线提交：`dc8ab44`（含 `a2b5866` 安全加固与 `dc8ab44` macOS 风格前端重构）  
> 配套文档：[风险矩阵](RISK_MATRIX.md) · [需求与测试追溯矩阵](TRACEABILITY_MATRIX.md)  
> 需求依据：[产品与技术规格](../../gmail-account-manager-spec.md) · [25 项验收对照](../acceptance-matrix.md) · [安全决策](../security-decisions.md) · [项目约定](../../AGENTS.md)

---

## 0. 审计结论摘要与 Wave 0 ~ Wave 4 进展

### 0.0 Wave 0 ~ Wave 4 实测状态（2026-11-26 全部完成）

| 验证维度 | 实测结果 | 覆盖说明 |
|---|---|---|
| 后端静态检查 + OpenAPI 契约 | **全绿**（Ruff check/format **97 文件 0 错**；`docs/openapi.json` 与 FastAPI 实时生成逐字节一致） | 无 API 契约漂移 |
| 后端单元测试（`pytest -m 'not integration'`） | **160 passed**（Wave 3 +7、Wave 4 +1：`test_release_gates.py` 含 `bench-csv-perf.py` 预算判定单测） | 含 `CsvUploadLimit`、`PASSWORD_DENYLIST_FILE`、`ExportSlot`、发布门禁、覆盖率与基准判定 |
| 后端集成测试（`pytest -m integration`，本机临时 PG17） | **245 passed**（后端全量 **405 passed**，51.22s；Wave 4 +2：`test_dst_and_localization.py`） | 全覆盖审计外发/CLI/黑名单/Step-Up/角色脚本/备份恢复/紧连接池并发导出/软删辅助账号/DST 夏令时（23h/25h 日界与 743h/721h 月界、`fold=0`）/闰年/跨年 `Pacific/Kiritimati`/公式变体与中文错误；**注：PG17 不能替代 PG18.7 Linux 容器 + 真 `age >= 1.2.1` 正式验收** |
| 后端行覆盖率门禁（`scripts/check-coverage.py`，零依赖 `sys.monitoring`） | **总计 `96.37%`（≥85%），核心安全模块 `95.20%`（≥90%）**；仅单测 `60.06%` / `53.72%` | 不修改已锁定 `uv.lock`，实测核心路由 `accounts/auth/operations/transfers`、`listing.py`、`main.py`、`password_policy.py`、`state_machine.py` 均达 100% |
| 性能与内存基线（`scripts/bench-csv-perf.py`，`TC-P2-001`~`002`） | **PASS**：10,000 行 CSV 导入（1.963 MiB）总耗时 **`22.920s`**（优化前 `76.506s`，提速 3.34x：preview `5.932s` + commit `16.987s`，`< 30s`）；20,000 行流式导出（60,000 标签关联，41 分块，4.30 MiB）TTFB **`0.002s`**（`< 2s`）、总耗时 **`1.859s`**、峰值内存增量 **`4.44 MiB`**（恒定内存 `< 32 MiB`）；全进程峰值 RSS **`258.08 MiB`**（`< 384 MiB` 容器限额） | 优化 `analyzer.py` 批量预取与 `importer.py` 500 条分批刷新后全部达标 |
| 本地发布门禁全检（`scripts/check-release-gates.py all`） | **5/5 PASS**（`check-openapi` / `compose-all` / `nginx` / `scan-dist` / `audit-deps`） | 4 组 Compose overlay、Nginx 静态契约（**macOS 未装 `nginx`，需 Linux 补跑 `nginx -t` 与实测 429**）、`frontend/dist/`（49 文件）+ `frontend/src/`（152 文件）与供应链锁文件/Dockerfile 摘要全通过 |
| 前端类型检查、Vitest 与生产构建 | **`tsc -b` 0 错；12 文件 / 100 passed；`vite build` 成功（244ms）** | 含 `wave4-dst-date-boundary.test.tsx`（闰年/跨年/非法日期）+ `TZ=America/New_York` 23h/25h DST 验证；生产 `dist/assets/` **0 个 `*preview*` 演示分包** |
| 无障碍与三浏览器多视口验收（`TC-P2-003`~`004`） | **`wave4-a11y-compat.spec.ts`：Chromium / Firefox / WebKit 三引擎 **15/15 passed**（25.0s）；`macos-keyboard-a11y.spec.ts` WCAG 2.2 AA **8/8 passed**（19.9s）** | 覆盖未认证登录页 + 4 个核心页面 + Dialog/Sheet/AlertDialog 零 Serious/Critical axe-core 违规，以及 `1280×720`/`1440×900`/`1920×1080` 三视口零溢出、零 `pageerror`/`console.error` 与滑块键盘交互 |
| 真实前后端全栈 Playwright E2E（`scripts/run-live-e2e.py`，零 API 桩） | **1 文件 / 4 passed**（13.4s：`TC-P0-011` / `TC-P0-012` / `TC-P0-013` / `TC-P1-006`） | 真实 FastAPI + 独立 PostgreSQL + 生产构建 `vite preview` + 真实 Chromium 全链路验证 |
| 核心功能 Playwright UI 冒烟（本机 Chromium，Wave 0 基线） | **5 文件 / 14 passed**（8.7s：`skeleton` / `accounts` / `management` / `security-settings` / `csv-import`） | 覆盖前端组件与交互回归 |

### 0.1 审计基线快照（修复前）与对比

| 维度 | 资产规模 | 当前实测状态 | 关键审计发现 |
|---|---|---|---|
| 后端单元测试（`pytest -m 'not integration'`） | 11 文件 / 85 函数 / **150 用例** | **150 passed**（1.90s） | 覆盖加密、密码策略、TOTP、离线黑名单函数、备份保留、异地 SSH 协议、发布溯源；但 `audit_sink` 外发与回滚丢弃、CLI `verify-audit`/`sign-audit-checkpoint`、中间件顺序未覆盖 |
| 后端集成测试（`pytest -m integration`） | 6 文件 / 94 函数 / **193 用例** | 需独立 `TEST_DATABASE_URL`（`gm_test*`） | 强项突出：随机 schema 隔离、Alembic 迁移/降级、事务锁并发、防篡改触发器与角色权限、流式 CSV 导出；但未直接执行 `infra/postgres/*.sh`、未测试 `PASSWORD_DENYLIST_FILE` 经 API 生效、未测流式导出连接池耗尽 |
| 前端组件测试（Vitest + Testing Library） | 10 文件 / **87 用例** | **87 passed**（4.78s） | 静态与组件覆盖高，但 4 个新增 `macos-*.test.tsx` 主要测 **mock/preview 模式**；`macos-settings.test.tsx` 的 live 桩未模拟 `/auth/reverify` 轮换 CSRF，掩盖了真实联调必现的 `403 CSRF_INVALID` 缺陷 |
| 前端 Playwright E2E | 3 文件 / **6 用例** | **严重失配（4/6 用例与 `dc8ab44` 新 UI 断链）且全部为路由响应桩** | `accounts.spec.ts` 与 `management.spec.ts` 仍依赖重构前选择器（`详情`/`编辑` 行按钮、默认展开的筛选栏、`已选当前页 0 条（不跨页）`、`sticky` 操作列）；`playwright.config.ts` 强依赖全局 `pnpm`；**零真实前后端联调 E2E** |
| 静态检查与契约 | Ruff、TSC、Prettier、OpenAPI | **全部通过**（`docs/openapi.json` 与 FastAPI 实时生成一致） | 无 ESLint / a11y 静态检查、无 Python 类型检查（mypy/pyright）、无测试覆盖率统计工具、无依赖漏洞自动审计命令 |
| Makefile 与 CI 配置 | `Makefile` 9 目标；`.github/workflows/` 空目录 | 符合 `AGENTS.md`（不启用 GitHub Actions，提交/推送不强制跑测试） | 缺少 `test-e2e`、`check-openapi`、`compose-check-all`、`gate-release` 等本地/发布前门禁目标；`README.md` 与 `docs/implementation-plan.md` 仍写旧迁移 `0003` 及 8 位密码 |

### 0.2 本次审计发现的高危/阻塞级问题（需优先处置）

以下问题均为代码静态审计与契约核对发现的实证缺陷（详见 [RISK_MATRIX.md](RISK_MATRIX.md)）：

1. **生产路由暴露未认证 `/preview/*` 预览页与调试参数**（`frontend/src/app/router.tsx:27-58`）：8 条 `/preview/*` 路由挂载在 `<AuthPage />` 之外且无 `import.meta.env.DEV` 隔离，模拟数据随 `frontend/dist` 打包上线；正式页亦支持 `?ui_state=loading|error|empty|showcase`。
2. **新系统设置页 Live 模式在 `reverify` 后必现 `403 CSRF_INVALID`**（`frontend/src/features/settings/use-settings-data.ts:285-688, 878-896`）：`changePassword`、`regenerateRecoveryCodes`、`terminateSession`、`logoutOtherSessions`、`updateRetentionPolicy` 先调用 `authReverify`（后端轮换新 CSRF），随后立即使用旧闭包 `csrfHeaders` 发起写操作。
3. **新系统设置页 Live 模式伪造备份成功、伪造恢复验证与伪造策略持久化**（`frontend/src/features/settings/use-settings-data.ts:690-901, 970-1152`）：`runImmediateBackup` 与 `runRestoreVerification` 在 `mode="live"` 下仅用 `setTimeout` 伪造归档/验证通过结果，违背规格“恢复仅限 CLI、禁止伪造成功”的红线；`auditRetentionDays`/`backupRetentionDays` 仅存前端内存；Live 模式混入 `MOCK_ADMIN_SECURITY`、`MOCK_TOTP_SECURITY` 与硬编码 `trashCount: 3`。
4. **新账号详情页 Live 模式多个业务缺陷**（`frontend/src/features/accounts/detail/account-detail-page.tsx` & `account-basic-info-form.tsx`）：
   - 第 666 行 `'logged-in'` 错调 `accountsMarkVerified` 而非 `accountsMarkLoggedIn`；
   - 第 568–569 行编辑已关联内部辅助账号（`recovery_account_id != null`）的记录时，同时提交 `recovery_account_id` 与 `recovery_email_external`，触发后端 `422 RECOVERY_INVALID`；
   - 备注前端硬限 500 字（`MAX_NOTES_LENGTH = 500`）而后端允许 20,000 字，编辑长备注会导致静默截断；
   - 审计时间线事件键名错配（`account_verified`/`account_logged_in`/`totp_enabled` 与后端 `AUDIT_EVENTS` 不一致）。
5. **账号列表页统计口径偏差、规格缺列与 E2E 全面失配**（`frontend/src/features/accounts/accounts-page.tsx:312-350` & `account-table.tsx:418-438`）：
   - `disabled` 取自当前页 `listState.items`，导致 `risk = abnormal - disabled` 混用全局与单页口径；缺少规格要求的“待验证”和“超过 30 天未验证”卡片；点击“风险账号”仅筛选 `restricted` 漏掉 `login_failed`；
   - `columns.registered` 实际渲染 `created_at`（“创建时间”）而非 `registered_at`（“注册时间”）；`columns.verified` 渲染聚合“最后活动”而非 `last_verified_at`；移除 `account_no`/`purpose` 列及操作列 `sticky`；
   - 新旧双套路由并存（顶部导航跳转遗留 `/security` 与 `/operations`，未打通 `/settings` 与 `/transfers/csv`）；`csv-adapter.ts:376` 筛选导出传空 `{}` 筛选条件。
6. **后端边界与稳定性隐患**：
   - `CsvUploadLimit` 位于 `request_context` 外层，413/415 响应跳过 `ALLOWED_HOSTS`、`X-Request-ID` 响应头及结构化访问日志，且在认证/CSRF 前读取最高 10 MiB 请求体；`content-type` 未 `.strip()`；
   - `POST /api/v1/exports/csv` 流式导出占用 `pool_size=5, max_overflow=0` 连接直至客户端下载结束，存在慢速下载耗尽连接池风险；
   - `POST /api/v1/auth/password` 未对 `step_up_totp_required` 检查 `mfa_reauthenticated_at`，且 `ChangePasswordInput` 提前抛通用 `VALIDATION_ERROR` 掩盖了 `WEAK_PASSWORD` 友好提示；`PASSWORD_DENYLIST_FILE` 路径缺失时静默放行。

---

## 1. 功能清单

按模块梳理规格（P0/P1/明确不做）、安全加固与当前代码实现（含后端 35 个 API 路由、3 个 CLI 命令、4 个迁移、运维脚本与前端 10 条业务路由 + 8 条暴露预览路由）：

### 1.1 认证、会话、CSRF 与安全基础（M-AUTH）

| 功能 ID | 功能点 | 规格级别 | 当前实现位置 | 实现状态 |
|---|---|---|---|---|
| `F-AUTH-01` | 单管理员 CLI 初始化（无公开注册/无环境变量密码/强制 TTY 隐藏输入/16 位强密码策略） | P0 + 加固 | `backend/app/cli.py:create_admin`、`core/password_policy.py` | 已实现（README 仍写旧的 8 位） |
| `F-AUTH-02` | 预会话（10 分钟）与 CSRF 同步器 Token（仅前端内存、刷新轮换不续期、Origin + Sec-Fetch-Site 校验） | P0 | `api/v1/auth.py:/session`、`services/auth/session_manager.py` | 已实现 |
| `F-AUTH-03` | 管理员登录（Argon2id 验证及过时哈希自动升级、密码 + TOTP / 恢复码、Cookie `__Host-gm_session` / `gm_dev_session`） | P0 | `api/v1/auth.py:/login`、`services/auth/state_machine.py` | 已实现 |
| `F-AUTH-04` | 强制首次 TOTP 绑定、验证器重绑（10 分钟加密候选 Secret）、时间步防重放、10 个一次性恢复码（生成一次展示+浏览器内存下载） | P0 | `api/v1/auth.py:/totp/setup\|confirm\|regenerate-recovery-codes`、`totp_manager.py` | 已实现（新 `/settings` 存在重绑入口缺失与 CSRF 缺陷） |
| `F-AUTH-05` | 敏感操作最近 5 分钟重新验证 & 生产强制高风险 TOTP Step-Up | P0 + 加固 | `api/v1/auth.py:/reverify`、`session_manager.py:require_recent` | 已实现（改密未强检 `mfa_reauthenticated_at`） |
| `F-AUTH-06` | 管理员改密（16 位下限 + 弱模式/离线泄露字典 + 撤销全部会话） | P0 + 加固 | `api/v1/auth.py:/password`、`core/password_policy.py` | 已实现（`WEAK_PASSWORD` 被 422 通用错误遮蔽；新设置页有 CSRF 缺陷） |
| `F-AUTH-07` | 应用层双维度（全局 admin + IP）持久化失败计数、指数退避（1/2/4/8s）与 5 次锁定 15 分钟 | P0 | `services/auth/context.py:buckets/check_throttle/fail` | 已实现（覆盖 6 类凭据校验入口） |
| `F-AUTH-08` | 服务端闲置超时（默认 15m，可配 1–720m）与绝对 12h 过期；仅可信用户交互触发节流 `POST /auth/activity`；前端锁定清缓存与代次隔离 | P0 | `api/v1/auth.py:/activity`、`frontend/src/features/auth/use-idle-session.ts` | 已实现 |
| `F-AUTH-09` | 多设备 Session 列表、单条撤销与撤销其他设备（不续期 `last_seen`） | P0/P1 | `api/v1/operations.py:/auth/sessions*`、`services/operations.py` | 已实现（遗留 `/operations` 正常；新 `/settings` 有 CSRF 缺陷） |

### 1.2 加密存储与敏感凭据按需访问（M-CRYPTO）

| 功能 ID | 功能点 | 规格级别 | 当前实现位置 | 实现状态 |
|---|---|---|---|---|
| `F-CRY-01` | 应用层 AES-256-GCM 加密（密码、手机号、备注、TOTP Secret、待确认 TOTP），每次独立 12B nonce + 实体/ID/字段/版本 AAD | P0 | `backend/app/core/encryption.py` | 已实现 |
| `F-CRY-02` | 多版本密钥共存读取（`data_key_vN`）与仅当前版本写入（`ACTIVE_DATA_KEY_VERSION`），启动强校验 32B | P0 | `core/config.py:validate_secret_files`、`core/encryption.py` | 已实现 |
| `F-CRY-03` | 列表/详情响应字段白名单（绝不含密码及密文）、全响应 `Cache-Control: no-store` | P0 | `schemas/accounts.py`、`main.py` | 已实现 |
| `F-CRY-04` | 密码独立 `POST /reveal-password` 与 `/copy-password-event`（最近重验 + Step-Up TOTP、不入 Query/Mutation 缓存、20s 自动清除、切后台/关抽屉/切账号立即清除、剪贴板指纹尽力清理、晚到响应隔离） | P0 + 加固 | `api/v1/accounts.py`、`features/accounts/password-control.tsx`、`detail/use-password-secret.ts` | 已实现 |

### 1.3 Gmail 账号与标签管理（M-ACCOUNTS）

| 功能 ID | 功能点 | 规格级别 | 当前实现位置 | 实现状态 |
|---|---|---|---|---|
| `F-ACC-01` | Gmail 账号 CRUD（编号 `GM-000001`、UTC 时间存储、本地时区展示、编辑密码留空不覆盖、手机号/备注详情按需解密） | P0 | `api/v1/accounts.py`、`services/accounts/detail.py`、`account-form.tsx`、`account-detail-page.tsx` | 后端完整；新详情页存在联调缺陷（XOR/500 字截断） |
| `F-ACC-02` | Gmail 地址规范化（`gmail.com`/`googlemail.com` 去点号与 `+tag`，他域仅小写去空白）及软删除保留唯一性 | P0 | `schemas/accounts.py:normalize_email`、DB `uq_gmail_accounts_gmail_email_normalized` | 已实现 |
| `F-ACC-03` | 辅助邮箱二选一 XOR（外部文本或关联已有账号）、禁止自关联/同主邮箱、主邮箱改名反向冲突校验、专用选项搜索分页 | P0 | `services/accounts/detail.py:recovery`、`api/v1/accounts.py:/accounts/options` | 已实现（新建/编辑未拒绝新指向已删账号） |
| `F-ACC-04` | 乐观锁 `row_version` 原子 CAS（单条编辑/动作、标签删除联动、批量操作、CSV 更新），409 冲突阻断覆盖并要求重载 | P0 | `services/accounts/detail.py:cas`、`tags.py:delete_tag` | 已实现 |
| `F-ACC-05` | 状态流转（6 种状态）、归档与取消归档时间一致、软删除与回收站逐条恢复、快速标记“今天已登录/已验证” | P0 | `api/v1/accounts.py:/archive\|restore\|mark-verified\|mark-logged-in` | 后端完整；新详情页 `logged-in` 错调 `mark-verified` |
| `F-ACC-06` | 标签管理（新增、重命名、删除仅解绑并递增关联账号 `row_version`） | P0 | `api/v1/accounts.py:/tags*`、`services/accounts/tags.py` | 已实现 |
| `F-ACC-07` | 全局 6 项统计卡片（含 IANA 时区本月边界与 >30 天未验证口径） | P0 | `api/v1/accounts.py:/dashboard/summary`、`features/accounts/account-summary.tsx` | 后端完整；前端重构后缺 2 项且 `disabled`/`risk` 口径错乱 |
| `F-ACC-08` | 服务端搜索（编号/邮箱/辅助邮箱，LIKE 转义）、多条件筛选、6 字段白名单排序（空值置末+UUID 稳定）、分页与 URL 状态恢复 | P0 | `repositories/accounts.py`、`features/accounts/query-state.ts` | 后端完整；前端重构后列字段映射与固定操作列偏移 |
| `F-ACC-09` | 批量状态修改与批量标签追加（最多 100 条、逐条 `row_version`、整批事务原子回滚、网络未知不自动重放） | P0 | `api/v1/accounts.py:/batch-status\|batch-tags`、`account-batch-bar.tsx` | 已实现 |
| `F-ACC-10` | 辅助邮箱使用量统计页（按地址小写聚合外部与关联、按注册时间取最近关联、下钻精确列表） | P0/P1 | `api/v1/accounts.py:/recovery-emails`、`recovery-usage-view.tsx` | 已实现 |

### 1.4 CSV 迁移与导出（M-CSV）

| 功能 ID | 功能点 | 规格级别 | 当前实现位置 | 实现状态 |
|---|---|---|---|---|
| `F-CSV-01` | 两阶段 CSV 导入（原始 `text/csv` 限 10 MiB / 10000 行 / 256 列、严格 UTF-8/BOM、手工映射、重复策略 `skip/update/error`、10 分钟会话绑定一次性 SHA-256 凭据、全批保存点事务回滚、错误不回显敏感值） | P0 | `api/v1/transfers.py`、`core/upload.py`、`services/csv_transfer/*`、`csv-import-panel.tsx`、`csv-import-page.tsx` | 已实现（中间件顺序有边界隐患） |
| `F-CSV-02` | 默认非敏感分批流式 CSV 导出（`all`/`filtered` 全匹配、`REPEATABLE READ READ ONLY` + 服务端游标、`expunge`、UTF-8 BOM + 公式防注入、UTC 文件名、审计落盘） | P0 + 加固 | `api/v1/transfers.py:/exports/csv`、`services/csv_transfer/exporter.py` | 后端已实现；新 `/transfers/csv` 筛选导出传空条件 |

### 1.5 防篡改审计、系统状态与配置（M-OPS）

| 功能 ID | 功能点 | 规格级别 | 当前实现位置 | 实现状态 |
|---|---|---|---|---|
| `F-OPS-01` | 白名单审计事件记录、防篡改 SHA-256 哈希链触发器（无间隙 `seq`）、禁止 `UPDATE/DELETE/TRUNCATE` 触发器、独立 `gm_audit_writer` 只写角色 | P0 + 加固 | `alembic/versions/0004_*.py`、`services/audit_integrity.py`、`infra/postgres/*` | 已实现 |
| `F-OPS-02` | 审计分页筛选查询、在线完整性校验 API（`GET /audit-events/integrity`）、CLI `verify-audit` & `sign-audit-checkpoint`（HMAC-SHA256） | P0 + 加固 | `api/v1/operations.py`、`cli.py`、`services/audit_integrity.py` | 已实现（CLI 子命令无自动化测试） |
| `F-OPS-03` | 事务提交后审计外发（`gmail_manager.audit` JSON 流 + 可选 UDP/TCP/Unix Syslog，回滚不外发，外发失败告警不阻断提交） | 加固 | `core/audit_sink.py` | 已实现（仅解析函数有单测） |
| `F-OPS-04` | 系统版本（应用版本 + 实时 Alembic 版本）、真实备份状态读取（不伪造成功）、全局闲置锁定配置（调大不复活已过期会话）、健康检查 `/health/live` & `/health/ready` | P0 | `api/v1/operations.py`、`api/v1/system.py`、`services/operations.py` | 后端完整；新 `/settings` 伪造备份/恢复/保留策略 |

### 1.6 备份、异地传输、恢复切换与部署溯源（M-INFRA）

| 功能 ID | 功能点 | 规格级别 | 当前实现位置 | 实现状态 |
|---|---|---|---|---|
| `F-INF-01` | PostgreSQL 加密备份（`REPEATABLE READ` 快照 + `pg_dump` custom gzip 直接 `age` 加密 + 配置归档加密 + manifest + `flock` + 7 日/8 周/12 月保留 + 已演练副本保护） | P0 | `scripts/backup_tool.py`、`scripts/backup.sh`、`infra/backup/Dockerfile` | 已实现 |
| `F-INF-02` | 最小权限受限 SSH 异地备份（固定强制命令 `upload/status/fetch`、3 文件受限 USTAR 流、验证后替换 `current` 保留 `previous`、独立 0600 源机私钥） | P0/P1 | `infra/backup/receiver.py`、`scripts/install-offsite-receiver.py`、`scripts/prepare-offsite-identity.py`、`scripts/fetch-backup.sh` | 已实现 |
| `F-INF-03` | 隔离恢复与受控配置切换（消费完整 age 流、单事务新库恢复、表行数/约束/审计链全量校验、多版本密钥抽样解密、切换前 `SWITCH` + 管理员密码与 TOTP Step-Up、撤销历史会话、原子替换 `.env`） | P0 + 加固 | `scripts/backup_tool.py`、`scripts/restore.sh`、`backend/app/ops/verify_restore.py` | 已实现 |
| `F-INF-04` | 生产安全基线（Docker Compose 固定 `@sha256` 摘要、非 root、只读根文件系统、最小能力、内网隔离、Nginx 双层限流 + 安全响应头 + CSP + TLS + Certbot 续期） | P0 + 加固 | `infra/docker-compose*.yml`、`infra/nginx/*`、`infra/systemd/*`、`core/release_meta.py` | 已实现（示例配置） |
| `F-INF-05` | 发布打包与溯源部署（白名单源码包、洁净工作区检查、确定性归档 SHA-256、CycloneDX 1.5 SBOM、OCI 标签校验、按依赖部署与不降级回滚） | 加固 | `scripts/package-release.py`、`scripts/deploy.py`、`core/release_meta.py` | 已实现 |
| `F-INF-06` | 隔离 PG18 验收与自然调度观察（不改时钟、不自动顺延、截止全量停机复查） | 加固 | `infra/docker-compose.acceptance.yml`、`scripts/acceptance_checks.py`、`scripts/acceptance_schedule.py` | 已实现 |

### 1.7 明确范围外 / P1 未实现项（需防回归/防越界）

- **P1 后续项**：带密码流式加密导出（`POST /api/v1/exports/encrypted` 尚未实现，且不得出现明文敏感导出替代品）、回收站批量恢复、密钥轮换管理 CLI、深色模式、图表独立聚合接口（`registration-trend` / `status-distribution`）、PWA、WebAuthn/FIDO2。
- **明确不做（红线约束）**：公开注册、多用户/RBAC、Google API / 自动注册登录 / 验证码抓取、第三方 CDN / 外部字体或统计脚本、`localStorage` JWT、`dangerouslySetInnerHTML` 渲染用户输入、网页端数据库恢复覆盖按钮。

---

## 2. 现有测试体系审计评估

详细的功能-测试覆盖矩阵见 [TRACEABILITY_MATRIX.md](TRACEABILITY_MATRIX.md)。

### 2.1 优势（值得保留的工程实践）

- **数据库测试强隔离**：`backend/tests/conftest.py` 强制 `TEST_DATABASE_URL` 存在且数据库名以 `gm_test` 开头（缺失即 `pytest.fail` 而非 `skip`），每用例独立随机 PostgreSQL Schema + Alembic `upgrade head`，结束 `DROP SCHEMA CASCADE`。
- **安全与并发测试深度高**：`test_auth.py`（41 项）和 `test_auth_locking.py`（7 项）真实覆盖事务锁顺序、跨会话 TOTP 原子防重放、并发 CSV 凭据单次消费、标签删除并发递增版本、代理头不可信防护、退避锁定不提前重置。
- **迁移与防篡改实库验证**：`test_migrations.py`（19 项）覆盖空库升降级、`0002 -> head` 数据保真、`0003 -> 0004` 存量审计链回填、并发插入无间隙链与触发器防篡改。
- **告警即失败 & 零敏感落盘**：`pyproject.toml` 开启 `filterwarnings = ["error"]`；Playwright 关闭 trace/screenshot/video 防止认证材料残留。

### 2.2 核心短板与结构性盲区

1. **Mock 漂移掩盖 Live 致命 Bug**：前端 87 个 Vitest 用例与 6 个 Playwright 用例全部基于手写 `fetch`/`page.route` 桩。新 macOS 页面的测试桩不仅未校验 OpenAPI 响应必填字段，还将 `/auth/reverify` 模拟成“返回相同 CSRF Token”，直接掩盖了 Live 设置页的 `403 CSRF_INVALID` 缺陷；`macos-settings.test.tsx` 甚至把 Live 下不该存在的假备份/假恢复演练写成了通过断言。
2. **Playwright E2E 严重滞后且大面积失效**：仅有 6 条用例且全部基于旧版表格 DOM（无任何 `/accounts/:accountId`、`/transfers/csv`、`/settings`、`/operations`、`/security` 覆盖），在 `dc8ab44` 合并后因未纳入执行而静默失效，且 `.last-run.json` 残留旧版 `passed` 状态造成误导。
3. **新旧 UI 双轨测试分裂**：`accounts.test.tsx`/`management.test.tsx`/`operations.test.tsx` 测旧交互或无 Router 独立挂载，而真实 `router.tsx` 将 `/accounts/:accountId` 指向 `AccountDetailPage`、将 `/settings` 指向 `SettingsPage`，但路由集成测试（`routing-and-modules.test.tsx`）自建精简 `createMemoryRouter`，**从未测试真实的 `router.tsx` 定义**（因而未捕获 `/preview/*` 公开暴露和双轨跳转割裂）。
4. **安全加固新增模块的“最后一公里”测试缺口**：`audit_sink.py` 的 SQLAlchemy 事务钩子与 Syslog 发送、CLI `verify-audit` / `sign-audit-checkpoint`、API 层的 `PASSWORD_DENYLIST_FILE`、以及 `infra/postgres/*.sh` 角色脚本实库执行均未纳入自动化测试。
5. **工具链与门禁缺失**：
   - 无覆盖率采集与阈值门禁（未装 `pytest-cov`、`@vitest/coverage-v8`）；
   - 无前端 ESLint / 无障碍自动扫描（`axe-core`）；
   - 无依赖漏洞扫描命令（`pip-audit` / `pnpm audit`）及前端构建产物密钥/外部 CDN 扫描；
   - `Makefile` 缺少 E2E、OpenAPI 漂移检查、多 Compose overlay 校验和统一发布前门禁目标；`playwright.config.ts` 仅测 Chromium 且 `webServer` 强依赖系统 `pnpm`。

---

## 3. 缺失测试清单

| 类别 | 缺失测试项 | 风险等级 | 建议层级 |
|---|---|---|---|
| **安全与访问控制** | 生产路由禁止暴露未认证 `/preview/*` 与 `?ui_state=` 调试开关；构建产物 `dist/` 不含 mock 敏感示例与第三方 CDN | P0 | 前端路由单测 + 构建扫描 + Playwright |
| **安全与认证** | 新设置页 Live 模式下 `reverify` 轮换 CSRF 后衔接改密/重生成恢复码/撤销会话/改闲置的真实链式调用 | P0 | 前端 Live 集成 + 真实后端 E2E |
| **安全与认证** | `POST /api/v1/auth/password` 在 `step_up_totp_required=True` 下经恢复码重生成后（仅有 `reauthenticated_at` 无 `mfa_reauthenticated_at`）的 Step-Up 强校验；弱密码错误码 `WEAK_PASSWORD` vs `VALIDATION_ERROR` 契约 | P0 | 后端集成测试 |
| **安全与认证** | `PASSWORD_DENYLIST_FILE` 经 `create-admin` CLI 与 `POST /auth/password` 端到端拦截（明文/SHA-1/SHA-256），及配置文件路径不存在时的启动失败门禁 | P1 | 后端单测 + 集成测试 |
| **审计防篡改与外发** | `audit_sink.py` 事务提交后外发 JSON（含 `seq`/`prev_hash`/`event_hash`）、事务回滚绝不外发幽灵日志、Syslog（UDP/TCP/Unix）转发成功及连接失败时记录 `audit_sink_failed` 且不阻断提交 | P0 | 后端集成测试（真实 PG 触发器 + 本地 socket 桩） |
| **审计 CLI** | `python -m app.cli verify-audit`（正常返回 0、篡改返回 1）与 `sign-audit-checkpoint`（缺密钥报错、链损坏拒绝签发、输出可用 `verify_audit_checkpoint` 验签） | P0 | 后端集成测试 |
| **数据库迁移与角色** | 真实容器/PostgreSQL 中执行 `init-roles.sh`、`upgrade-backup-role.sh`、`upgrade-audit-role.sh`（幂等/重复拒绝、无 TTY 拒绝、`gm_app` 不可篡改 `audit_events`、`gm_audit_writer` 仅可 `INSERT`、`gm_backup` 只读） | P0 | 容器/PG18 集成测试 |
| **账号核心（Live UI）** | `/accounts/:accountId` 关联内部辅助账号（`recovery_account_id`）编辑保存不触发 XOR 422；“标记已登录”调用 `/mark-logged-in`；>500 字备注完整编辑保存；删除账号时关联新账号拒绝软删目标 | P0 | 前端测试 + 真实后端 E2E + 后端集成 |
| **账号列表与统计** | 首页统计卡片与 `/dashboard/summary` 6 项指标跨分页一致；“风险账号”筛选涵盖 `restricted` + `login_failed`；表格注册时间/最后验证列字段准确及操作列 `sticky` | P0 | 前端测试 + Playwright E2E |
| **系统设置（Live 诚实性）** | Live `/settings` 绝不提供/伪造网页备份与恢复演练成功；保留策略只读展示或调用真实接口；无硬编码 `trashCount: 3` 或 Mock 凭据指标 | P0 | 前端 Live 测试 + Playwright E2E |
| **CSV 与连接池** | `CsvUploadLimit` 中间件位置（413/415 仍校验 Host、带 `X-Request-ID`、写访问日志、未认证不预读 10 MiB、`text/csv ; charset=utf-8` 容错）；慢速流式 CSV 导出并发下的连接池耗尽防护；`/transfers/csv` 筛选导出携带真实过滤条件 | P0 / P1 | 后端集成 + 并发压力测试 + 前端测试 |
| **真实全栈 E2E** | 真实 FastAPI + 独立 PG18 + Vite/Nginx 端到端旅程：登录+TOTP 绑定+恢复码下载 → 账号 CRUD/辅助账号/标签/乐观锁 409 → Step-Up 密码查看与 20s 清除 → CSV 两阶段导入与流式导出 → 闲置锁定与多标签页 CSRF 失效 | P0 | Playwright Real-Stack E2E |
| **Nginx 与公网边界** | `nginx -t` 模板渲染语法检查；多认证端点限流（`/login`、`/reverify`、`/password`、`/totp/*`）；伪造 `X-Forwarded-For` / `Forwarded` 无法绕过限流；安全响应头与 CSP 无控制台违规 | P1 | 容器化 Nginx 冒烟测试 |
| **备份与恢复实操** | 真实 `pg_dump` + `age` + `pg_restore` 端到端（含 `0004` 审计链 + 多版本密钥 + `switch` Step-Up + 权限恢复 + Session 撤销 + 回退路径）自动化验证 | P1 | PG18 容器验收脚本测试 |
| **非功能（性能/无障碍/跨浏览器）** | 10,000 行 CSV 导入内存/耗时基线；50,000 行流式 CSV 导出峰值内存基线；WCAG/axe-core 无障碍自动检测；Firefox / WebKit 跨浏览器冒烟 | P2 | 性能基准脚本 + Playwright a11y/多浏览器 |

---

## 4. P0 / P1 / P2 测试用例列表

> 编号规则：`TC-P0-*` 为上线阻塞/核心安全与数据正确性用例；`TC-P1-*` 为重要功能、运维与边界用例；`TC-P2-*` 为体验、性能、无障碍与跨浏览器用例。

### 4.1 P0 测试用例（发布阻塞级，必须 100% 通过）

| 用例 ID | 模块 | 标题 | 层级 | 核心前置条件与操作 | 预期验收结果 |
|---|---|---|---|---|---|
| `TC-P0-001` | M-AUTH / 路由安全 | 生产构建与路由禁止暴露未认证 `/preview/*` 与调试参数 | 前端单测 + E2E + 构建检查 | 导入真实 `router.tsx`；以生产模式构建 `frontend/dist`；未登录访问 `/preview/accounts`、`/preview/settings`、`/preview/transfers/csv` 及 `/?ui_state=showcase` | 生产路由不包含 `/preview/*`（返回 404 或重定向登录）；构建产物无 mock 预览路由代码；正式页面忽略 `?ui_state=` 参数 |
| `TC-P0-002` | M-AUTH / Live CSRF | 新设置页 `reverify` 轮换 CSRF 后串行执行敏感操作不触发 403 | 前端 Live 测试 + 真实 E2E | 后端真实启动（或 Mock 严格在 `/auth/reverify` 返回**全新** `csrf_token`）；在 `/settings` 依次触发改密、重生成恢复码、撤销其他会话、修改闲置超时 | 后续写请求必须携带 `/auth/reverify` 返回的新 `X-CSRF-Token`；请求返回 200；旧 CSRF 不被复用 |
| `TC-P0-003` | M-AUTH / Step-Up | 生产模式下改密与密码查看统一强制 TOTP Step-Up | 后端集成 | `step_up_totp_required=True`；使用恢复码完成恢复码重生成（仅刷新 `reauthenticated_at` 未刷新 `mfa_reauthenticated_at`），尝试调用 `/reveal-password`、`/copy-password-event`、`/auth/password` | `/reveal-password` 与 `/copy-password-event` 返回 `403 REAUTH_REQUIRED`；确认 `/auth/password` 安全策略一致并记录审计 |
| `TC-P0-004` | M-OPS / 诚实状态 | Live `/settings` 绝不伪造备份执行、恢复演练或保留策略持久化 | 前端 Live 测试 + E2E | 以 `mode="live"` 挂载 `SettingsPage`，后端返回 `backup-status: unconfigured` 或 `failed` | 页面忠实显示“未配置/失败”；无虚假 `setTimeout` 备份成功按钮或假 24 行恢复报告；明确引导使用服务器 CLI 恢复；`trashCount` 等数字全部来自真实 API |
| `TC-P0-005` | M-ACCOUNTS / 详情页 | 详情页编辑内部关联辅助账号（`recovery_account_id`）保存成功 | 前端 Live 测试 + 真实 E2E | 创建账号 A，再创建账号 B 设 `recovery_account_id=A.id`；打开 `/accounts/{B.id}` 修改用途或备注并保存 | `PATCH` 请求仅提交 `recovery_account_id: A.id` 且 `recovery_email_external: null`（不违反 XOR）；返回 200 且 `row_version` 递增 |
| `TC-P0-006` | M-ACCOUNTS / 详情页 | 详情页“标记今天已登录”正确调用 `/mark-logged-in` 且长备注不截断 | 前端 Live 测试 + 真实 E2E | 打开含 1,200 字备注的账号详情页；触发“今天已登录”动作；编辑备注至 1,500 字保存 | 请求路径为 `POST /api/v1/accounts/{id}/mark-logged-in` 并更新 `last_login_at`；备注保存完整无 500 字截断 |
| `TC-P0-007` | M-ACCOUNTS / 统计与筛选 | 首页统计卡片与后端全局 6 项口径一致且筛选语义准确 | 前端测试 + 真实 E2E | 造数 40 条（跨 2 页，含 normal/pending/restricted/login_failed/disabled/archived/deleted/>30 天未验证）；进入首页 | 顶部完整展示全局统计（不因翻页或筛选改变）；`disabled`/`risk` 与后端汇总一致；点击“风险/异常”筛选结果包含所有异常状态；表格“注册时间”显示 `registered_at`、“最后验证”显示 `last_verified_at` |
| `TC-P0-008` | M-OPS / 审计外发 | 防篡改审计事务提交后外发 JSON，回滚不产生幽灵日志，Syslog 故障不阻断业务 | 后端集成 | 监听 `gmail_manager.audit` logger 及本地 UDP/Unix socket；(a) 正常创建账号提交；(b) 触发 409 冲突回滚；(c) 指向不可达 Syslog 端口 | (a) 提交后输出含 `seq`/`prev_hash`/`event_hash` 的白名单 JSON，无明文密码/手机号；(b) 回滚后 0 条外发；(c) Syslog 异常记录 `audit_sink_failed` 但主事务仍提交成功 |
| `TC-P0-009` | M-OPS / 审计 CLI | `app.cli verify-audit` 与 `sign-audit-checkpoint` 全流程验证 | 后端集成 | 独立 PG schema 写入 5 条审计事件；运行 `verify-audit` 与 `sign-audit-checkpoint`；关闭触发器篡改第 3 条再重跑 | 完好链：`verify-audit` 退出码 0，`sign-audit-checkpoint` 输出可被 `verify_audit_checkpoint` 验签的 JSON；缺密钥退出码 1；篡改后 `verify-audit` 退出码 1 且 `sign-audit-checkpoint` 拒绝签发 |
| `TC-P0-010` | M-INFRA / DB 角色 | 真实 PostgreSQL 执行 `init-roles.sh` 与 `upgrade-audit-role.sh` / `upgrade-backup-role.sh` | PG18 容器集成 | 在全新 PG18 实例及 `0003` 旧库实例中以无 TTY `psql` 执行角色脚本并跑 `alembic upgrade head` | `gm_app` 可正常 CRUD 业务表及 `SELECT/INSERT audit_events`，但 `UPDATE/DELETE/TRUNCATE audit_events` 被权限拒绝；`gm_audit_writer` 仅可 `INSERT audit_events`；`gm_backup` 仅只读；脚本重复执行拒绝不改密 |
| `TC-P0-011` | M-E2E / 核心旅程 | 真实全栈 E2E：首次登录 → TOTP 绑定 → 恢复码下载 → 账号 CRUD → 乐观锁 409 | Playwright Real-Stack | 启动真实 FastAPI + PG18（`gm_test_*`）+ Vite；CLI 初始化管理员；真实浏览器完整操作 | Cookie 属性、CSRF 轮换、TOTP 绑定前访问 `/api/v1/accounts` 403、绑定后全流程 CRUD、双页并发编辑触发 409 禁存并重载后成功，全程零 `pageerror` |
| `TC-P0-012` | M-E2E / 凭据安全 | 真实全栈 E2E：Step-Up 查看/复制密码、20 秒自动清除、切换页面立即清除与剪贴板清理 | Playwright Real-Stack | 启用 `STEP_UP_TOTP_REQUIRED=true`；进入详情页查看与复制密码；验证 DOM、Storage、20s 计时及切后台事件 | 未重验返回 `REAUTH_REQUIRED`；输入密码+TOTP 重验后可查看/复制；明文不出现在 `localStorage`/`sessionStorage`；20s 后及 `visibilitychange(hidden)` 立即变回掩码；审计表落盘 `password_revealed` 与 `password_copied` |
| `TC-P0-013` | M-E2E / CSV 与运维 | 真实全栈 E2E：CSV 两阶段导入（冲突拒绝/重预览/提交）+ 流式 CSV 导出 + 审计链校验 | Playwright Real-Stack | 在真实后端下通过前端上传含重复与公式字符的 CSV，先触发并发改版 409，再重新预览提交，最后导出 CSV 并打开审计完整性校验 | 首次提交 409 整批回滚；重预览后原子写入；导出文件含 UTF-8 BOM、公式前缀加 `'`、无密码/手机号/备注列；`/audit-events/integrity` 返回 `valid: true` |
| `TC-P0-014` | M-E2E / 既有回归修复 | 修复并恢复既有 Playwright 6 条冒烟用例（`skeleton` / `accounts` / `management`） | Playwright Stub | 适配 `dc8ab44` 新 UI 选择器与交互（下拉菜单、折叠筛选、分页文案、固定操作列、路由跳转）；同步补齐桩响应字段与 OpenAPI 一致 | 6/6 稳定通过；操作列恢复 `position: sticky`；1280×720 无页面级横向溢出 |
| `TC-P0-015` | M-CSV / 中间件边界 | `CsvUploadLimit` 保护：未认证大包拒绝、413/415 含 Host 校验与请求 ID、MIME 参数空白容错 | 后端集成 | 发送未登录 11 MiB CSV、恶意 Host 头 415 请求、`Content-Type: text/csv ; charset=utf-8` 合法请求 | 恶意 Host 优先返回 `400 INVALID_HOST`；413/415 带 `X-Request-ID` 与 `Cache-Control: no-store` 且写结构化日志；合法带空白参数的 `text/csv` 正常解析 |

### 4.2 P1 测试用例（重要功能、边界与运维稳定性）

| 用例 ID | 模块 | 标题 | 层级 | 核心前置条件与操作 | 预期验收结果 |
|---|---|---|---|---|---|
| `TC-P1-001` | M-AUTH / 密码策略 | `PASSWORD_DENYLIST_FILE` 经 CLI 与 `/auth/password` 全路径拦截及错误码一致性 | 后端单测 + 集成 | 配置含明文、HIBP SHA-1、SHA-256 的离线黑名单文件；分别用 CLI 初始化和 API 改密提交命中密码及弱密码；再将配置指向不存在路径 | 命中黑名单被拒绝且错误不回显密码原文；弱密码返回明确错误码/中文指引；配置路径不存在时启动校验报错而非静默跳过 |
| `TC-P1-002` | M-CSV / 连接池安全 | 流式 CSV 导出并发慢速消费不导致数据库连接池耗尽 | 后端集成 / 并发 | 制造 6 个并发慢速读取 `/api/v1/exports/csv` 流响应，同时发起 `/health/ready` 与 `/accounts` 查询 | 系统对导出并发或流生命周期具备可控边界（如信号量限制/缓冲释放/池参数合理），核心查询与健康检查不发生超时雪崩 |
| `TC-P1-003` | M-CSV / 前端筛选导出 | `/transfers/csv` 筛选导出传递真实筛选条件且与 `/operations` 一致 | 前端测试 + E2E | 设置状态/标签/日期筛选后点击“导出当前筛选结果” | `POST /api/v1/exports/csv` 请求体 `scope: "filtered"` 携带完整 `filters`（非空 `{}`）；下载文件名含 UTC 时间戳 |
| `TC-P1-004` | M-ACCOUNTS / 关联边界 | 新建或切换 `recovery_account_id` 拒绝新关联已软删除账号，保留已有软删除关联 | 后端集成 | 账号 A 软删除后：(a) 新建账号 B 指向 A；(b) 已关联 A 的老账号 C 修改备注保持关联 A；(c) 账号 D 从外部邮箱切换关联到已删 A | (b) 允许保留；确认 (a)/(c) 符合业务契约（若应禁止则统一返回 `422 RECOVERY_INVALID`） |
| `TC-P1-005` | M-ACCOUNTS / 导航收敛 | 顶部导航与侧边栏路由一致性（消除 `/security`+`/operations` 与 `/settings`+`/transfers/csv` 双轨割裂） | 前端路由测试 + E2E | 使用真实 `router.tsx` 测试全部导航入口跳转、浏览器前进/后退及查询串保留 | 点击各导航项路由唯一且可预期，刷新不丢状态，无死链或未授权泄露 |
| `TC-P1-006` | M-AUTH / 闲置与多标签 | 多标签页并发刷新 CSRF 冲突提示不自动重放；缩短闲置时限立即淘汰其他活跃会话 | 真实 E2E + 后端集成 | 开两个浏览器标签页 A/B：标签 B 刷新触发 CSRF 轮换，标签 A 提交编辑；另测改小 `idle_minutes` 后旧活跃会话请求 | 标签 A 收到 `CSRF_INVALID` 提示手动刷新且不重放写请求；缩短闲置时限后超过新阈值的会话立返 401 |
| `TC-P1-007` | M-INFRA / 备份恢复全链路 | PG18 容器真实 `pg_dump` + `age` + 异地 SSH 上传/取回 + 独立新库恢复 + `switch` Step-Up + 回退 | 容器集成验收 | 基于 `docker-compose.acceptance.yml` 准备 v1/v2 双密钥、42 条合成账号与审计链；执行完整备份、篡改检测、恢复、切换与回退 | 全表行数、约束、0004 审计链、8 组密钥抽样解密全过；错误 age 私钥或缺失 v1 密钥失败；`switch` 撤销历史会话、验证密码+TOTP、保留旧库并原子替换 `.env` |
| `TC-P1-008` | M-INFRA / Nginx 边界 | 容器化 Nginx 实测：HTTPS 重定向、安全响应头/CSP、限流 429、伪造转发头无效、屏蔽 `/docs` 与 `/health/ready` | 容器冒烟测试 | 用 `nginx -t` 校验 `infra/nginx/accounts.example.com.conf`（替换测试域名）并挂接测试 API | HTTP 301 至 HTTPS；HSTS/XFO/nosniff/CSP/no-store 全存在；`/api/v1/auth/login` 突刺超限返 429；伪造 `X-Forwarded-For` 不绕过；`/api/docs` 与 `/api/v1/health/ready` 公网返 404 |
| `TC-P1-009` | M-INFRA / Compose 校验 | 全部 Compose 组合配置校验（dev / production+offsite / regression / acceptance） | Shell / Makefile | 对 4 组 Compose overlay 传入合成环境变量运行 `docker compose config --quiet` | 全部组合语法、secret 引用、网络隔离、只读根文件系统及固定 `@sha256` 摘要校验通过 |
| `TC-P1-010` | M-INFRA / 供应链与产物扫描 | 依赖漏洞审计 + 前端 `dist/` 构建产物安全扫描 | 脚本检查 | 运行 `pip-audit`（或 uv 漏洞检查）与 `pnpm audit`；扫描 `frontend/dist` | 无未评审高危/严重 CVE；`dist/` 不含真实 Secret、不含 `http://` 第三方 CDN/字体/统计外链、不含 `dangerouslySetInnerHTML` |

### 4.3 P2 测试用例（性能、无障碍、兼容性与体验细节）

| 用例 ID | 模块 | 标题 | 层级 | 核心前置条件与操作 | 预期验收结果 |
|---|---|---|---|---|---|
| `TC-P2-001` | 性能 / CSV 导入 | 10,000 行（接近 10 MiB）合法 CSV 两阶段预览与事务提交性能与内存基线 | 性能基准测试 | 生成 10,000 行合成 UTF-8 CSV（含标签与中文备注）；执行 `preview` 与 `commit` 并监控 API 容器 RSS | 预览与提交在可接受时限内完成（如 < 30s），API 容器峰值内存 < `mem_limit`（384 MiB）不触发 OOMKill |
| `TC-P2-002` | 性能 / 流式导出 | 20,000+ 账号流式 CSV 导出峰值内存恒定性验证 | 性能基准测试 | 隔离库写入 20,000 条账号（每条 3 标签）；调用 `POST /api/v1/exports/csv` 流式读取 | 内存增量保持常数级（每批 500 条释放），首字节响应时间（TTFB）< 2s，导出行数精确等于 20,000 |
| `TC-P2-003` | 无障碍 / A11y | 核心页面键盘可达性与 WCAG 2.1 AA 自动扫描 | Playwright + `@axe-core/playwright` | 扫描登录页、账号列表、详情页、新增/编辑弹窗、CSV 导入、系统设置 | 零 Serious/Critical 无障碍违规；所有 Dialog/Sheet/AlertDialog/Table/Tab 具语义化 ARIA 标签；焦点管理与 Escape 关闭正常 |
| `TC-P2-004` | 跨浏览器与响应式 | Chromium / Firefox / WebKit 及 1280×720、1440×900、1920×1080 视口布局验收 | Playwright 多项目 | 在三引擎下运行核心 E2E 冒烟与视口检查 | 无控制台报错、无 CSP 违规、表格仅容器内横向滚动、页面级无水平溢出、毛玻璃透明度滑块与表单控件表现正常 |
| `TC-P2-005` | 体验 / 边界时区与本地化 | DST 跨夏令时日期范围筛选、闰年/跨年本月统计、特殊 Unicode 邮箱备注与 CSV 公式变体 | 后端集成 + 前端测试 | 使用 `America/New_York`、`Asia/Shanghai`、`Pacific/Kiritimati` 测试日期筛选边界与统计；测试 `\t=`、`\r+`、前置空格 `-` 等公式变体 | 半开区间 `[start, next_local_midnight)` 精确无偏移；公式变体全部前置单引号转义；错误提示全简体中文无英文堆栈 |

---

## 5. 测试数据与环境方案

### 5.1 测试数据原则与合成工厂规范

严格遵循 [安全决策](../security-decisions.md) 与 [公开仓库发布规范](../public-repository.md)：

1. **零真实凭据原则**：所有测试邮箱使用 RFC 2606 保留域（`@example.test`）或明显合成前缀（`synthetic-*@gmail.com` / `gm-test-*@gmail.com`）；所有管理员密码、Gmail 密码、TOTP Secret、恢复码、AES 密钥、age 密钥均在测试运行期动态随机生成（`secrets` / `os.urandom` / `crypto.randomUUID`），**严禁写入 Git、日志、快照或 Playwright 产物**。
2. **统一数据工厂（Factory / Fixture）建议**：
   - **后端**：抽取共用工厂模块 `backend/tests/factories.py`（当前 `test_auth.py`/`test_accounts.py`/`test_operations.py` 存在跨文件 `from test_auth import ...` 耦合），提供：
     - `SyntheticKeyring`（支持 v1/v2/损坏密钥）；
     - `AdminFactory`（支持普通密码、过时 Argon2 参数、16+ 位密码短语、TOTP 绑定/未绑定）；
     - `AccountFactory`（覆盖 6 种状态、3 种 2FA、外部/内部辅助邮箱、长备注 20KB、多标签、归档、软删除、多版本加密）；
     - `CsvFixtureBuilder`（快速生成 UTF-8 BOM、CRLF、引号换行、公式注入、10,000 行/256 列边界、损坏编码/NUL 字节测试流）。
   - **前端**：建立基于 OpenAPI 类型校验的 **Contract-Checked Mock Factory**（`frontend/tests/fixtures/api-contract.ts`），强制：
     - 所有桩响应必须满足 `src/api/generated/types.gen.ts` 全部必填字段（防止缺 `step_up_totp_required`/`max_page_size`/`month_from` 等漂移）；
     - 状态化模拟服务端 **CSRF 轮换**（`/auth/login`、`/auth/reverify`、`/auth/totp/confirm`、`/auth/session` 必须颁发新 Token 并拒绝旧 Token），从根源杜绝类似 `use-settings-data.ts` 的假绿测试。

### 5.2 分层测试环境架构

| 环境层 | 名称 | 数据库与依赖 | 启动方式 | 覆盖测试范围 | 隔离与清理规则 |
|---|---|---|---|---|---|
| **L0** | 本地极速单测环境 | 无数据库；仅临时目录合成密钥 | `make check && make test` | Ruff、TSC、Prettier、后端单测（150+）、前端 Vitest（87+）、OpenAPI 漂移检查 | `tmp_path` 自动清理；jsdom `afterEach` 清空 Storage 与 Mock |
| **L1** | 隔离 PG18 集成环境 | 独立 Docker PostgreSQL `18.7-bookworm@sha256:...`（库名 `gm_test_local`） | `infra/docker-compose.regression.yml` 或本地 PG18 容器 + `make test-db` | 后端集成测试（193+）、Alembic 升降级、防篡改审计触发器、并发锁、CLI 集成、`audit_sink` | 每用例随机 `gm_test_<uuid>` schema，结束 `DROP SCHEMA CASCADE`；禁止连业务库 |
| **L2** | 本地全栈 E2E 环境 | 隔离 PG18（`gm_test_e2e`）+ 真实 FastAPI（`APP_ENV=test`, `STEP_UP_TOTP_REQUIRED=true`）+ Vite/Preview + Chromium | 新增 `make test-e2e-live`（或独立 compose profile） | 真实全栈 Playwright E2E（`TC-P0-011`~`013`）+ 可选 Nginx 反向代理冒烟（`TC-P1-008`） | 每次启动全新空库并跑 `alembic upgrade head` + CLI 创建合成管理员；关闭 trace/video/screenshot |
| **L3** | 隔离容器验收环境 | 全套容器（PG18 + Migrate + API + Backup + Restore + 受限 SSH 靶机） | `infra/docker-compose.acceptance.yml` + `scripts/acceptance_checks.py` + `scripts/acceptance_schedule.py` | 非 root Secret 权限、多版本密钥备份/取回/新库恢复/审计链/自然调度、发布溯源校验 | 显式 `--project-name gmail-manager-accept-<批次>`、无宿主机端口、无自动重启、截止全量停机并复查 |

> **关键约束**：按 [docs/validation.md](../validation.md)，本机原生 PostgreSQL 17（或 `.local/pg` 仅用于快速调试）的测试结果**不能替代** PostgreSQL 18.7 Linux 容器验收。

---

## 6. 推荐实施顺序

遵循“**先止血生产级缺陷与修复失配 E2E → 再补齐安全/联调测试与门禁 → 最后扩展非功能与自动化验收**”原则，分 5 个阶段推进：

### Wave 0：阻断级缺陷止血与现有 E2E 修复（优先级：立即，1–2 天）

1. **修复本次审计暴露的 6 项 P0 缺陷**（单独提交修复 PR/commit，每项附带对应回归测试）：
   - 给 `router.tsx` 的 `/preview/*` 加上 `import.meta.env.DEV` 条件编译保护，移除生产页面 `?ui_state=` 调试后门；
   - 修复 `use-settings-data.ts` 在 `reverify` 后使用新返回 `csrf_token`；
   - 移除 Live `SettingsPage` 的虚假 `runImmediateBackup` / `runRestoreVerification` / 假保留策略持久化与 Mock 混入，严格对齐 CLI 恢复与真实 API 状态；
   - 修复 `AccountDetailPage` 中 `'logged-in'` 错调 `accountsMarkVerified`、内部辅助账号编辑 XOR 冲突及 500 字备注截断；
   - 修复 `AccountsPage` 全局统计口径（补齐 6 项或对齐规格）、“风险”筛选漏 `login_failed`、`AccountTable` 列映射与 `sticky` 操作列，并明确 `/settings` 与 `/transfers/csv` 路由导航策略；
   - 修复 `CsvUploadLimit` 中间件注册顺序与 MIME `.strip()`，核对 `change_password` 的 Step-Up 策略及 `PASSWORD_DENYLIST_FILE` 缺失报错。
2. **修复破损的 Playwright 冒烟用例**（`TC-P0-014`），并将 `playwright.config.ts` 的 `webServer` 改为使用 `./node_modules/.bin/vite --port 4173`（消除 corepack/fnm 环境下 `/bin/sh: pnpm: command not found` 问题）。
3. **同步过期文档**：更新 `README.md` 和 `docs/implementation-plan.md` 中滞后的迁移版本（`0003` → `0004`）与管理员密码长度基线（8 → 16 位）。

### Wave 1：补齐 P0 后端与前端高危安全测试（已完成 — 2026-11-26）

1. 新增后端集成测试与同步修复：
   - `backend/tests/integration/test_audit_sink.py`（4 项：提交白名单 JSON 零敏感外发、顶层回滚零外发、CSV 保存点回滚零幽灵日志、UDP/Unix Syslog 转发与下线故障告警不阻断提交 — `TC-P0-008`）；同步修复 `backend/app/core/audit_sink.py` 中保存点回滚残留幽灵审计记录及 `SysLogHandler` 吞掉 `OSError` 未记 `audit_sink_failed` 两项缺陷；
   - `backend/tests/integration/test_cli_audit.py`（4 项：`verify-audit` 与 `sign-audit-checkpoint` 有效链验签、密钥缺失/过短失败、篡改第 3 条记录拒绝签发、`SafeArgumentParser` 不回显密码参数 — `TC-P0-009`）；同步补齐 `backend/app/cli.py:sign_audit` 的 `OSError` 友好提示；
   - `backend/tests/integration/test_security_hardening.py`（4 项：`PASSWORD_DENYLIST_FILE` 经 API 改密与 CLI `create-admin` 拦截明文/SHA-1/SHA-256 及缺文件 fail-closed、Step-Up 一致性覆盖改密/查看/复制、以及 `CsvUploadLimit` 全栈集成边界 — `TC-P0-003`/`015`、`TC-P1-001`）；同步加固 `backend/app/core/password_policy.py` 缺失黑名单文件时 fail-closed。
2. 新建前端 **OpenAPI 强类型有状态 CSRF 轮换契约夹具**（`frontend/tests/fixtures/api-contract.ts`）与真实 `router.tsx`（`buildRoutes(false)`）集成测试（`frontend/tests/wave1-contract-router.test.tsx`，4 项，覆盖 `TC-P0-001`/`002`/`004`/`005`/`006`），并同步补齐 `AccountHeaderCard` “更多”菜单的 `标记今天已登录` 交互入口。

### Wave 2：建设真实前后端全栈 E2E 与数据库脚本集成测试（已完成 — 2026-11-26）

1. 在 `frontend/e2e-live/`（配套 `frontend/playwright.live.config.ts`、`frontend/e2e-live/totp.ts` 与 `scripts/run-live-e2e.py`）落地 4 条真实全栈 Playwright E2E（`TC-P0-011`、`TC-P0-012`、`TC-P0-013`、`TC-P1-006`），直连真实 FastAPI + 隔离 PostgreSQL（支持外部 PG18 `TEST_DATABASE_URL` 或自动拉起临时实例）+ 生产构建 `vite preview`，零路由桩验证真实 Cookie、CSRF 轮换、TOTP 首次绑定与 1s 指数退避、跨会话 409 冲突、Step-Up 密码查看/复制/后台清除/审计入链、CSV 并发 409 整批回滚与原子提交、流式 BOM 防公式注入导出、0004 审计链完整性及多标签页 CSRF 失效。
2. 新增 `backend/tests/integration/test_db_roles_and_recovery.py`（3 项，覆盖 `TC-P0-010` 与 `TC-P1-007`）：在独立临时 PostgreSQL 集群中真实执行 `infra/postgres/init-roles.sh`、`upgrade-backup-role.sh`、`upgrade-audit-role.sh`（全新库 + `0003` 升级路径 + 重复执行拒绝不改密 + 四角色最小权限实测），以及 `scripts/backup_tool.py` 全链路演练（真实 `pg_dump`、受限 `receiver.py` USTAR 上传/取回、密文篡改/错误私钥/缺失 v1 密钥拒收、新库 `pg_restore`、v1+v2 多版本密钥抽样解密、0004 审计链校验、`switch` Step-Up 切换/会话撤销/权限恢复/原子替换 `.env` 与回退）。（注：本机以 PG17 + AES-GCM 兼容包装跑通，正式发布前需在 PG18.7 Linux 容器内以真实 `age >= 1.2.1` 复跑同套用例留证。）

### Wave 3：Makefile 本地质量门禁、并发连接池边界与供应链/Nginx 检查（已完成 — 2026-11-26）

1. **流式 CSV 导出并发边界与软删辅助账号保护**：
   - 在 `backend/app/services/csv_transfer/exporter.py`、`app/main.py` 与 `app/api/v1/transfers.py` 实现有界并发槽位保护（`DEFAULT_MAX_CONCURRENT_EXPORTS = 2`，超限返回 `429 EXPORT_BUSY` 且不写入伪造审计，支持 `finally` + `BackgroundTask` + `__del__` 幂等释放），并在 `app/services/accounts/detail.py` 禁止新建或改绑 `recovery_account_id` 指向已软删除账号（`422 RECOVERY_INVALID`，同时保留既有历史软删关联的正常编辑）。
   - 新增 `backend/tests/integration/test_export_and_boundaries.py`（2 项，覆盖 `TC-P1-002` 与 `TC-P1-004`）：实库验证紧连接池（`pool_size=5, max_overflow=0`）下并发慢导出不饿死 `/health/ready` 与 `/accounts`、mid-stream `gen.close()` 零泄漏归还连接与信号量，以及软删除辅助账号 5 组边界路径。
2. **Nginx 限流加固与统一本地质量门禁**：
   - 在 `infra/nginx/accounts.example.com.conf` 将 `gm_login` 限流扩展覆盖 `/api/v1/auth/(reverify|password|totp/(setup|confirm|regenerate-recovery-codes))$` 并新增 `location = /api/redoc { return 404; }`。
   - 新增 `scripts/check-release-gates.py`（`check-openapi`、`compose-all`、`nginx`、`scan-dist`、`audit-deps`、`all`）、零外部依赖行覆盖率门禁 `scripts/check-coverage.py`（Python 3.12 `sys.monitoring` + `co_lines`，实测全量 `96.36%` / 核心安全模块 `95.14%`）及 7 项对应单元测试 `backend/tests/unit/test_release_gates.py`（覆盖 `TC-P1-008`、`TC-P1-009`、`TC-P1-010`）。
   - 在 `Makefile` 新增全手动触发的本地质量门禁目标（严格遵守 `AGENTS.md`，不新增 GitHub Actions 或 Git Hook）：`check-openapi`、`compose-check-all`、`check-nginx`、`scan-dist`、`audit-deps`、`test-cov`、`test-cov-db`、`test-e2e`、`test-e2e-live`、`gate-release`。

### Wave 4：非功能测试体系化（已完成 — 2026-11-26）

1. **10,000 行 CSV 导入与 20,000 行流式导出性能/内存基线（`TC-P2-001`、`TC-P2-002`）**：
   - 新增 [scripts/bench-csv-perf.py](../../scripts/bench-csv-perf.py)（配套 `make bench-csv`）与预算判定单测；首轮实测暴露 10,000 行导入耗时 `76.506s` 超出 `30s` 基线，随后优化 `analyzer.py`（1,000 条分块预查询已有邮箱、缓存标签/辅助账号校验、跳过新 UUID 反向关联查询）与 `importer.py`/`detail.py`（预加载标签缓存、500 条分批 `stage_create` 刷盘、跳过丢弃的 `detail()` 回读并保持每条审计/保存点/桩覆盖语义完全兼容），将总耗时由 `76.506s` 压缩至 **`22.920s`**（preview `5.932s` + commit `16.987s`，进程峰值 RSS `258.08 MiB < 384 MiB`）；20,000 行（60,000 标签关联）流式导出 TTFB **`0.002s`**、总耗时 **`1.859s`**、峰值内存增量 **`4.44 MiB`**（恒定内存达标）。
2. **WCAG 2.1/2.2 AA 无障碍与三浏览器多视口验收（`TC-P2-003`、`TC-P2-004`）**：
   - 新增 [frontend/e2e/wave4-a11y-compat.spec.ts](../../frontend/e2e/wave4-a11y-compat.spec.ts)（配套 `make test-a11y`、`make test-compat`），在 **Chromium / Firefox / WebKit** 三引擎及 **`1280×720`、`1440×900`、`1920×1080`** 三视口实测 **15/15 通过**（覆盖未认证登录页初始态与校验态、4 个核心页面及 Dialog/Sheet 零 Serious/Critical axe-core 违规、零 `pageerror`/`console.error`、零页面级横向溢出与滑块键盘调节），并回归验证既有 `macos-keyboard-a11y.spec.ts` WCAG 2.2 AA **8/8 通过**。
3. **跨夏令时/闰年/跨年/Unicode 与公式注入变体（`TC-P2-005`）**：
   - 加固 `backend/app/services/accounts/listing.py:summary()` 使用显式 `datetime(..., fold=0)` 计算本地月初零点，新增 [backend/tests/integration/test_dst_and_localization.py](../../backend/tests/integration/test_dst_and_localization.py)（2 项，覆盖 `America/New_York` 23h/25h 日界与 743h/721h 月界、`Asia/Shanghai` 闰年 `2024-02-29`、`Pacific/Kiritimati` UTC+14 跨年、多语言 Unicode、`\t=`/`\r+`/`\n-`/`   -`/`\u00a0@` 公式变体与简体中文零堆栈错误）及 [frontend/tests/wave4-dst-date-boundary.test.tsx](../../frontend/tests/wave4-dst-date-boundary.test.tsx)（2 项 + `TZ=America/New_York` 23h/25h 验证）。

---

## 7. 质量门禁

> **重要合规说明（遵循 [AGENTS.md](../../AGENTS.md)）**：  
> 本仓库约定 **GitHub 仅用于代码存储和同步，不启用 GitHub Actions，不将测试或 CI 作为 `git commit` / `git push` 的前置条件**。  
> 因此，以下质量门禁全部设计为**本地按需执行、发布打包前执行与容器验收阶段执行的显式门禁**，不新增 `.github/workflows/*.yml`，也不安装强制阻断提交的 Git Hook。

### 7.1 四级质量门禁定义

| 门禁等级 | 触发时机 | 执行入口（含建议新增目标） | 通过标准（硬性阈值） |
|---|---|---|---|
| **G0：开发快速自检** | 功能/修复开发过程中按需执行 | `make check && make test` | Ruff check/format 0 错；`tsc -b` 0 错；Prettier 0 差异；`vite build` 成功；后端单测（≥150）100% 通过；前端 Vitest（≥87）100% 通过；零 `filterwarnings` 告警 |
| **G1：功能合入/里程碑自验** | 完成模块改动、前端大改或迁移变更后手动执行 | `make check-openapi` + `make test-db` + `make test-e2e` + `make compose-check-all` | `docs/openapi.json` 与 `frontend/src/api/generated` 零漂移；PG18 集成测试（≥193）100% 通过（不可跳过）；Playwright UI 冒烟与真实全栈 E2E 100% 通过；所有 Compose overlay `config --quiet` 通过 |
| **G2：发布打包前门禁** | 运行 `scripts/package-release.py` 打包候选发布前 | `make gate-release`（串联 G0+G1+覆盖率+安全扫描） | 工作区洁净（`working_tree_clean=true`）；后端核心安全模块（`core/`、`services/auth/`、`services/audit_integrity.py`、`services/accounts/`）行覆盖率 ≥ 90%，整体后端 ≥ 85%，前端核心业务逻辑 ≥ 80%；无未豁免 High/Critical 依赖漏洞；`frontend/dist` 零 `/preview/` 生产代码、零外部 CDN、零密钥片段；SBOM 与归档 SHA-256 校验通过 |
| **G3：生产部署与运维验收门禁** | 执行 `scripts/deploy.py` 生产上线或升级前 | `infra/docker-compose.regression.yml` + `infra/docker-compose.acceptance.yml` + [phase5-launch-checklist.md](../phase5-launch-checklist.md) | 独立 PG18 回归容器全绿；非 root Secret 最小权限验证通过；手工备份 + 异地取回 + 独立新 PG18 集群全量恢复（含 0004 审计链 + 多版本密钥抽样解密）通过；首次正式自然调度独立留证；[25 项验收标准](../acceptance-matrix.md) 逐项留证且**不得合并或以响应桩替代** |

### 7.2 已落地的 `Makefile` 本地门禁目标（全手动触发，不接入 CI）

Wave 3 已在根 [Makefile](../../Makefile) 中落地以下可重复执行的本地门禁命令（遵循 `AGENTS.md`，不新增 GitHub Actions 或提交前 Hook）：

- `make check-openapi`：验证 `docs/openapi.json` 与当前 FastAPI 契约逐字节一致。
- `make compose-check-all`：使用临时合成环境变量依次对 `dev`、`production+offsite`、`regression`、`acceptance` 4 组 Compose overlay 运行 `docker compose config` 并校验 `@sha256` 镜像固定、非 root、只读根文件系统、能力清空、内网隔离与无明文密码环境变量。
- `make check-nginx`：校验 `infra/nginx/{accounts.example.com.conf,proxy.conf,gmail-manager-http.conf}` 的 7 项安全头、location 不覆写 `add_header`、敏感认证路径 `gm_login` 限流与 404 隔离（本机安装 `nginx` 时自动执行 `nginx -t`）。
- `make scan-dist`：扫描 `frontend/dist` 与 `frontend/src`，断言零 `*preview*` 产物、零外部 CDN/字体外链、零 `.map` source map、零 `dangerouslySetInnerHTML` 与零秘密标记。
- `make audit-deps-offline-integrity`（别名 `make audit-deps`）：离线校验 `uv.lock`/`pnpm-lock.yaml`、精确版本固定与 Dockerfile `@sha256` 摘要（不查询 CVE 库）。
- `make audit-deps-online-strict`：严格在线漏洞库审计（叠加离线校验与 `pip-audit` + `pnpm audit --prod --audit-level=high`；缺工具、漏洞库不可达、异常退出或命中阈值漏洞均严格失败）。
- `make test-cov` / `make test-cov-db`：基于 Python 3.12 `sys.monitoring` + `co_lines` 的零外部依赖覆盖率门禁（`test-cov-db` 强制 `backend/app >= 85%` 且核心安全模块 `>= 90%`，实测 `96.36%` / `95.14%`）。
- `make test-e2e` / `make test-a11y` / `make test-compat` / `make test-e2e-live`：分别执行前端 UI 冒烟、键盘与 axe-core 无障碍、Chromium/Firefox/WebKit 三引擎兼容与真实全栈 Playwright E2E。
- `make gate-release`：一键串联 `check`、`check-openapi`、`check-docs`、`compose-check-all`、`check-nginx`、`scan-dist`、`audit-deps-offline-integrity`、`test` 与 `test-cov`。
- `make gate-release-live`：快速真实全栈门禁（`gate-release` + `test-db` + `test-cov-db` + `test-e2e-live`）。
- `make gate-release-full`：私有发布机完整严格发布门禁（`gate-release` + `audit-deps-online-strict` + `test-db` + `test-cov-db` + `test-e2e` + `test-a11y` + `test-compat` + `test-e2e-live`）。

### 7.3 明确禁止的“伪通过”红线

沿用并强化 [docs/validation.md](../validation.md) 与 [docs/acceptance-matrix.md](../acceptance-matrix.md) 的质量红线：

1. **禁止以跳过当通过**：未配置 `TEST_DATABASE_URL` 时 `make test-db` 必须失败而非跳过。
2. **禁止以桩代真**：Playwright 路由响应桩不可替代真实前后端全栈 E2E；PG17 测试不可替代 PG18 Linux 容器验收。
3. **禁止前端伪造运维结果**：Live 模式下绝不允许用定时器或 Mock 数据伪装备份成功、恢复验证通过或配置已持久化。
4. **禁止将敏感材料写入测试产物**：Playwright 保持 `trace/screenshot/video: 'off'`；所有失败日志、报错响应与断言输出严禁打印密码、TOTP、恢复码、Cookie、CSRF Token 或数据密钥。
