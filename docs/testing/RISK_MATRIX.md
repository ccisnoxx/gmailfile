# Gmail 账号管理面板风险矩阵（RISK_MATRIX）

> 审计日期：2026-11-25（Wave 0 ~ Wave 4 同步：2026-11-26）  
> 审计基线：`dc8ab44`  
> 配套文档：[测试计划](TEST_PLAN.md) · [需求与测试追溯矩阵](TRACEABILITY_MATRIX.md)

> **Wave 0 ~ Wave 4 处置进展（全部 22 项风险已完成代码/测试闭环）**：
> - **Wave 0 已闭环**：实证阻断缺陷 `RSK-01`、`RSK-02`、`RSK-03`、`RSK-04`、`RSK-05`、`RSK-06`、`RSK-08`、`RSK-09`、`RSK-10` 均已修复并补齐自动化回归测试。
> - **Wave 1 已闭环**：`RSK-15` 中的 `audit_sink.py`（修复保存点回滚幽灵日志与 `SysLogHandler` 吞异常）及 `cli.py` 审计子命令（`TC-P0-008`/`009`）、`RSK-08`/`RSK-09`（`TC-P0-003`/`015`、`TC-P1-001`）以及前端 OpenAPI 有状态 CSRF 夹具与真实 `buildRoutes(false)` 路由集成测试已完成闭环。
> - **Wave 2 已闭环**：真实前后端全栈 Playwright E2E（`scripts/run-live-e2e.py` + `frontend/e2e-live/fullstack.spec.ts`，4/4 通过）闭环 `RSK-11`、`RSK-14`、`RSK-16`（`TC-P0-011`~`013`、`TC-P1-006`）；独立 PostgreSQL 集群实测 `infra/postgres/*.sh` 角色脚本与 `scripts/backup_tool.py` 全链路备份/恢复/Step-Up 切换/回退（`test_db_roles_and_recovery.py`，3/3 通过）闭环 `RSK-15`（`TC-P0-010`）与 `RSK-19`（`TC-P1-007`）。
> - **Wave 3 已闭环**：流式导出并发槽位保护（`DEFAULT_MAX_CONCURRENT_EXPORTS=2`，`429 EXPORT_BUSY` + 幂等释放）闭环 `RSK-07`（`TC-P1-002`）；软删除辅助账号新建/改绑拦截（`422 RECOVERY_INVALID`）闭环 `RSK-18`（`TC-P1-004`）；Nginx `gm_login` 扩展与 `/api/redoc` 封锁 + `scripts/check-release-gates.py`（5/5 PASS）+ `scripts/check-coverage.py`（**总计 `96.37%`、核心安全 `95.20%`**，405/405 通过）+ `Makefile` `gate-release` 闭环 `RSK-12`、`RSK-20` 与 `RSK-22`（`TC-P1-008`~`010`）。
> - **Wave 4 已闭环**：10,000 行 CSV 导入 / 20,000 行流式导出实测基准与批处理优化（`scripts/bench-csv-perf.py`，10k 导入 `76.5s -> 22.92s`、20k 导出 TTFB `2ms`/内存增量 `4.44 MiB`/RSS `258.08 MiB`）+ DST/公式变体测试（`test_dst_and_localization.py`）闭环 `RSK-17`（`TC-P2-001`~`002`、`TC-P2-005`）；`@axe-core/playwright` 登录页+全页无障碍与 Chromium/Firefox/WebKit 三引擎 `1280×720`/`1440×900`/`1920×1080` 多视口套件（`wave4-a11y-compat.spec.ts` 15/15 + `macos-keyboard-a11y.spec.ts` 8/8）闭环 `RSK-21`（`TC-P2-003`~`004`）。
> - **上线前实机/Linux 容器留证边界**：正式发布前仍须按 [docs/validation.md](../validation.md) 在 Linux 容器环境完成 PG18.7 + 真实 `age >= 1.2.1` 恢复演练及真实 `nginx -t`/公网 429 压测留证。

---

## 1. 风险评分标准

采用 **风险值 = 可能性（L, 1–5）× 影响度（I, 1–5）** 二维模型：

- **可能性（Likelihood）**：`5` 几乎必然 / 代码中已实证必现；`4` 高概率（常规用户路径或简单攻击即可触发）；`3` 中等（特定并发/配置/运维场景触发）；`2` 较低（需特定前置条件）；`1` 极低（极端故障）。
- **影响度（Impact）**：`5` 灾难级（凭据/密钥泄露、越权、数据损毁、伪造合规/备份成功）；`4` 严重（核心业务阻断、数据不一致、安全防线失效）；`3` 中等（部分功能错误、统计失真、运维降级）；`2` 轻微（体验/提示瑕疵、文档过时）；`1` 极微。
- **风险等级**：
  - **Critical（严重，16–25 分）**：发布阻断，必须立即修复并建立 P0 回归测试。
  - **High（高危，10–15 分）**：发布前必须修复或有明确强缓解与 P0/P1 测试护栏。
  - **Medium（中危，5–9 分）**：纳入近期迭代修复与 P1/P2 测试覆盖。
  - **Low（低危，1–4 分）**：按需优化并持续监控。

---

## 2. 本次审计实证发现的现存缺陷风险（代码级证据）

以下风险均已在当前工作区代码中定位到精确文件与行号，是本次测试体系升级的首要靶点：

| 风险 ID | 风险类别 | 风险描述与精确代码证据 | L | I | 分值 | 等级 | 为何现有测试未捕获 | 关联用例与缓解建议 |
|---|---|---|---|---|---|---|---|---|
| `RSK-01` | 访问控制 / 暴露面 | **生产路由暴露 8 条未认证 `/preview/*` 路由及 URL 调试开关**：`frontend/src/app/router.tsx:27-58` 将 `/preview/accounts`、`/preview/account-detail`、`/preview/settings/*`、`/preview/transfers/csv` 等直接注册在 `<AuthPage />` 之外且无 `import.meta.env.DEV` 守卫；同时 `accounts-page.tsx:366`、`settings-page.tsx:332` 在生产页面开放 `?ui_state=loading\|error\|empty\|showcase`。公网匿名用户可直接访问完整 UI 框架与 Mock 夹具，增大攻击面并泄漏内部界面结构。 | 5 | 4 | **20** | **Critical** | `routing-and-modules.test.tsx` 自建简化 router，未测试真实 `router.tsx`；4 个 `macos-*.test.tsx` 主动把 `/preview/*` 当成被测入口。 | `TC-P0-001`；用 `import.meta.env.DEV` 门控 preview 路由与 `ui_state`，并在生产构建后扫描 `dist/` 确认剥离。 |
| `RSK-02` | 认证 / CSRF 阻断 | **新系统设置页 Live 模式在 `reverify` 后必现 `403 CSRF_INVALID`**：`frontend/src/features/settings/use-settings-data.ts:285-383, 463-475, 552-573, 639-646, 878-891`。`changePassword`、`regenerateRecoveryCodes`、`terminateSession`、`logoutOtherSessions`、`updateRetentionPolicy` 先调用 `authReverify`（后端 `sessions.rotate` 轮换新 CSRF Token），随后立即使用旧 React 渲染闭包的 `csrfHeaders` 调用写接口，真实后端必然返回 `403 CSRF_INVALID` 并强制登出/刷新。 | 5 | 4 | **20** | **Critical** | `macos-settings.test.tsx:686-753` 桩实现中 `/auth/reverify` 返回了与旧会话**完全相同**的 `csrf_token`，且断言用了旧 token，直接掩盖缺陷。 | `TC-P0-002`、`TC-P0-011`；`reverify` 返回最新 `SessionResponse` 并在串行调用中显式传递新 `csrf_token`；测试桩强制模拟 CSRF 轮换。 |
| `RSK-03` | 运维合规 / 虚假状态 | **Live `/settings` 伪造“立即备份成功”与“4 步恢复验证通过”，且假持久化保留策略**：`use-settings-data.ts:690-901, 970-1152` 在 `mode="live"` 下不调用任何后端接口，仅靠 `setTimeout` 伪造 `gmailfile_*.pgdump.age`（64.5 MB）成功与 24 行恢复验证通过报告，将 `backup` 状态覆写为“备份正常”；`auditRetentionDays`/`backupRetentionDays` 仅存前端 state 却提示“已更新”；且混入 `MOCK_ADMIN_SECURITY`/`MOCK_TOTP_SECURITY`/`trashCount: 3`。严重违背“恢复仅限 CLI、绝不伪造备份成功”的核心安全合同。 | 5 | 5 | **25** | **Critical** | `macos-settings.test.tsx:477-525` 在 preview 模式下将假备份/假恢复演练写为正向断言，Live 测试未点击备份/恢复/策略按钮。 | `TC-P0-004`；Live 模式移除假执行按钮与 Mock 回退，仅展示真实只读状态并引导 CLI；新增 Live 诚实性断言。 |
| `RSK-04` | 数据完整性 / 核心功能 | **新详情页 Live 模式“标记已登录”错调接口 + 关联辅助账号保存必触发 422 + 长备注截断**：`account-detail-page.tsx:666` 将 `'logged-in'` 映射到 `accountsMarkVerified`；第 568–569 行叠加 `account-basic-info-form.tsx:45-46` 在编辑关联内部辅助账号的记录时同时提交 `recovery_account_id` 和 `recovery_email_external`，违反 XOR 触发 `422 RECOVERY_INVALID`；第 71 行 `MAX_NOTES_LENGTH = 500` 远小于后端 20,000 字符上限，编辑长备注会截断数据；第 99–110 行审计标签键名与后端 `AUDIT_EVENTS` 不一致。 | 5 | 4 | **20** | **Critical** | `macos-account-detail.test.tsx` 仅用外部辅助邮箱样本（`recovery_account_id: null`）且未测试 `logged-in` 与 >500 字备注。 | `TC-P0-005`、`TC-P0-006`；修复接口映射、XOR 表单模型与 20,000 字上限，并在真实 E2E 覆盖。 |
| `RSK-05` | 回归测试失效 / 规格偏移 | **Playwright E2E 4/6 失效 & 账号列表重构偏离规格**：`accounts-page.tsx:312-350` 将 `disabled` 按当前页统计并与全局 `abnormal` 相减导致统计错乱，丢失“待验证”与“超过 30 天未验证”卡片，侧边栏“风险账号”漏掉 `login_failed`；`account-table.tsx:418-438` 将 `registered` 列错误绑定 `created_at`、丢失 `account_no`/`purpose` 及操作列 `sticky`；导致 `e2e/accounts.spec.ts` 与 `e2e/management.spec.ts` 大面积失配且因未运行未被发现。 | 5 | 3 | **15** | **High** | `dc8ab44` 仅跑了更新后的 Vitest，未运行 Playwright E2E；`test-results/.last-run.json` 残留旧成功记录。 | `TC-P0-007`、`TC-P0-014`；对齐规格统计/列/固定列，修复 E2E 并在 G1 门禁强制运行。 |
| `RSK-06` | 功能割裂 / 导出偏差 | **前后端双轨路由割裂 & 新 CSV 筛选导出丢弃筛选条件**：`router.tsx` 同时存在 `/security`+`/operations` 与 `/settings`+`/transfers/csv`，但 `AccountsPage` 顶部导航仍跳旧页；新 `/transfers/csv` 的 `csv-adapter.ts:376` 筛选导出写死 `filters: {}`，未传递当前筛选条件；侧边栏统计请求失败时静默回退 `DEFAULT_SIDEBAR_COUNTS`（12,548 条假数据）。 | 4 | 3 | **12** | **High** | 缺少跨页面导航集成测试与新导出适配器的筛选参数测试。 | `TC-P1-003`、`TC-P1-005`；收敛唯一生产导航入口，传递真实 `AccountQuery`，失败显示错误态而非 Mock 假数。 |
| `RSK-07` | 可用性 / DoS | **流式 CSV 导出长时占用紧缩数据库连接池**：`backend/app/db/session.py:19-20` 固定 `pool_size=5, max_overflow=0`，而 `transfers.py:63-67` 的 `StreamingResponse` 在独立 `REPEATABLE READ READ ONLY` 事务中持有连接直至客户端读取完毕。5 个慢速或挂起下载即可耗尽整个连接池，阻断登录、健康检查和所有 API。 | 3 | 4 | **12** | **High** | `test_streaming_csv_export_batches_cursor_and_tags_without_ciphertexts` 仅串行单连接快速读取，未测并发慢消费。 | `TC-P1-002`；为导出增加并发限流/超时控制或独立连接池边界，补并发慢消费测试。 |
| `RSK-08` | 中间件边界 / 安全日志 | **`CsvUploadLimit` 位于 `request_context` 外层导致的边界缺陷**：`main.py:103` 注册顺序使 `CsvUploadLimit` 成为最外层中间件，413/415 响应跳过 `ALLOWED_HOSTS` 校验、缺 `X-Request-ID` 响应头、无结构化访问日志；未认证请求携带 `text/csv` 即可触发最高 10 MiB 内存读取；`content-type` 分割未 `.strip()`。 | 3 | 3 | **9** | **Medium** | `test_entry_upload_limit_and_type` 仅断言 413/415 状态码，未验证 Host 校验、日志、未登录大包与空白 MIME 参数。 | `TC-P0-015`；调整中间件顺序或下沉大小校验，增加边界集成用例。 |
| `RSK-09` | 认证策略一致性 | **改密 Step-Up 一致性、错误码遮蔽与黑名单路径静默放行**：(a) `state_machine.py:86` `change_password` 仅调用 `require_recent(row)` 未传 `require_mfa=step_up_totp_required`（经恢复码重生成后存在仅密码重验窗口）；(b) `ChangePasswordInput` 校验先抛 `422 VALIDATION_ERROR` 掩盖了 `WEAK_PASSWORD` 具体原因；(c) `password_policy.py:115` 当 `PASSWORD_DENYLIST_FILE` 路径写错不存在时静默返回 `False`（fail-open）。 | 3 | 3 | **9** | **Medium** | 无 API 层 `PASSWORD_DENYLIST_FILE` 与恢复码后改密的集成测试。 | `TC-P0-003`、`TC-P1-001`；统一 Step-Up 检查、启动校验 `password_denylist_file` 存在性并明确弱密码响应契约。 |
| `RSK-10` | 文档与运维漂移 | **核心说明文档滞后于 `0004` 安全加固**：`README.md:5, 68, 77` 及 `docs/implementation-plan.md:4` 仍写迁移 head 为 `0003`、密码最少 8 位，易误导部署与升级演练。 | 4 | 2 | **8** | **Medium** | 仅 `test_package_release.py` 校验代码/Compose 版本一致，未校验核心文档基线声明。 | Wave 0 同步文档；可在发布检查中核对版本说明。 |

---

## 3. 系统固有高风险领域矩阵（架构与安全边界）

| 风险 ID | 领域 | 潜在失效模式 | L | I | 分值 | 等级 | 现有测试防线 | 残余缺口与对应测试计划 |
|---|---|---|---|---|---|---|---|---|
| `RSK-11` | 认证与会话 | 会话 Cookie 泄露/降级、未绑 TOTP 越权访问业务接口、TOTP 或恢复码并发重放、跨站/兄弟子域 CSRF 攻击 | 2 | 5 | **10** | **High** | `test_auth.py`（41 项）+ `test_auth_locking.py` + `auth.test.tsx` 覆盖极强 | 缺真实浏览器 Cookie 属性（`HttpOnly/SameSite/Secure`）与真实后端全栈验证 → `TC-P0-011`、`TC-P1-006` |
| `RSK-12` | 暴力破解防护 | Nginx 仅对 `/api/v1/auth/login` 施加 `gm_login`（5r/m），`/reverify`/`/password`/`/totp/*` 仅走 `gm_api`（10r/s）；代理头配置失误可能致 IP 限流失效 | 3 | 4 | **12** | **High** | 应用层退避与忽略不可信转发头已测；`test_deploy.py` 测网关 IP 校验 | 缺少容器化 Nginx 实测 429 与伪造 `XFF`/`Forwarded` 攻击验证 → `TC-P1-008` |
| `RSK-13` | 密码学与密钥管理 | AES-GCM nonce 复用、AAD 跨字段/跨记录替换、多版本密钥切换失败、离线密钥遗失导致永久无法恢复 | 2 | 5 | **10** | **High** | `test_security.py` + `test_backup.py` 覆盖 AAD/nonce/多版本/错误密钥 | 密钥轮换 CLI 属 P1 未实现；持续通过 L3 隔离恢复多版本抽样验证 → `TC-P1-007` |
| `RSK-14` | 前端凭据泄漏 | Gmail 密码/恢复码/TOTP Secret 落入 TanStack Query/Mutation 缓存、`localStorage`、剪贴板残留或切后台后晚到响应回填 DOM | 3 | 5 | **15** | **High** | `accounts.test.tsx`、`auth.test.tsx`、`macos-account-detail.test.tsx` 已有 jsdom 验证 | 缺少真实 Chromium 下的 `visibilitychange`、剪贴板权限拒绝与内存清理全栈验证 → `TC-P0-012` |
| `RSK-15` | 防篡改审计链 | 审计日志被应用角色篡改/删除、并发插入产生序号间隙、事务回滚产生幽灵外发日志、Syslog 不可达导致业务失败 | 3 | 4 | **12** | **High** | `test_migrations.py` 测触发器/并发/角色 SQL 模拟；`test_operations.py` 测完整性接口 | **重大缺口**：`audit_sink.py` 钩子与外发、`cli.py` 审计子命令、`infra/postgres/*.sh` 实库脚本均无自动化测试 → `TC-P0-008`、`TC-P0-009`、`TC-P0-010` |
| `RSK-16` | 数据并发与乐观锁 | 多标签/批量/CSV/标签删除并发写导致静默覆盖或部分提交 | 2 | 4 | **8** | **Medium** | `test_accounts.py`、`test_management.py`、`test_auth_locking.py` 覆盖充分 | 缺真实前后端并发冲突端到端与前端新详情页冲突交互验证 → `TC-P0-011`、`TC-P0-013` |
| `RSK-17` | CSV 注入与资源耗尽 | 超大/畸形 CSV 导致 OOM（10 MiB 内数百万空行/列）、电子表格公式注入（`=+-@` 及前导控制符）、两阶段凭据重放或并发重复提交 | 3 | 4 | **12** | **High** | `test_operations.py`、`test_service_modules.py`、`test_auth_locking.py` 覆盖解析上限/公式转义/并发消费 | 缺少 10,000 行真量级内存/耗时基线及边界变体压测 → `TC-P2-001`、`TC-P2-005` |
| `RSK-18` | 关联数据一致性 | 软删除账号被新账号选为 `recovery_account_id`；主邮箱改名引发反向循环/同邮箱冲突 | 3 | 3 | **9** | **Medium** | `test_accounts.py` 覆盖 XOR/自关联/改名反向检查；CSV 分析器拒绝已删目标 | API `create/patch` 对“新选已删辅助账号”缺少显式校验与测试 → `TC-P1-004` |
| `RSK-19` | 备份与异地恢复 | 备份静默失败被当成功、异地传输损坏覆盖最后一份好副本、恢复切换复活旧 Cookie 或未恢复角色权限导致 API 不可用或审计可改 | 2 | 5 | **10** | **High** | `test_backup.py`、`test_offsite.py`、`test_acceptance_schedule.py` 单测覆盖极强 | 单测大量 monkeypatch；需在 L3 PG18 容器持续执行真实 `pg_dump`/`age`/`pg_restore`/`switch` 全链路演练 → `TC-P1-007` |
| `RSK-20` | 供应链与发布溯源 | 基础镜像飘移、脏工作区打包、依赖高危 CVE、私有配置/Secret 误打包进公开包或前端构建产物 | 2 | 5 | **10** | **High** | `test_package_release.py`、`test_deploy.py` 覆盖白名单/摘要/SBOM/OCI 标签 | 缺少自动化依赖漏洞审计（`pip-audit`/`pnpm audit`）及前端 `dist/` 内容扫描门禁 → `TC-P1-010` |
| `RSK-21` | 浏览器兼容性与无障碍 | Firefox/WebKit 下 `backdrop-filter`/日期控件/剪贴板行为差异；弹窗/表格键盘导航断裂或 ARIA 缺失 | 3 | 2 | **6** | **Medium** | Playwright 仅配 Chromium；无自动 a11y 扫描 | 纳入 Wave 4 的 `@axe-core/playwright` 与三引擎冒烟 → `TC-P2-003`、`TC-P2-004` |
| `RSK-22` | 测试体系治理 | 无覆盖率度量与防回退阈值；手动测试易在快速迭代中遗漏 E2E（如 `dc8ab44`） | 4 | 3 | **12** | **High** | `AGENTS.md` 规定不用 GitHub Actions，依赖手动自律 | 通过 Makefile 统一 `gate-release` 脚本、覆盖率阈值和发布清单硬性勾选闭环 → TEST_PLAN §7 |

---

## 4. 风险分布热力汇总

| 风险等级 | 数量 | 风险编号清单 | 处置策略 |
|---|---:|---|---|
| **Critical（16–25）** | **4** | `RSK-01`, `RSK-02`, `RSK-03`, `RSK-04` | **Wave 0 立即修复**，全部对应 P0 阻塞回归用例，修复前不建议执行生产打包发布 |
| **High（10–15）** | **12** | `RSK-05`, `RSK-06`, `RSK-07`, `RSK-11`, `RSK-12`, `RSK-13`, `RSK-14`, `RSK-15`, `RSK-17`, `RSK-19`, `RSK-20`, `RSK-22` | Wave 0–3 逐项补齐代码修复、真实全栈 E2E、审计/角色集成测试及发布前本地门禁 |
| **Medium（5–9）** | **6** | `RSK-08`, `RSK-09`, `RSK-10`, `RSK-16`, `RSK-18`, `RSK-21` | Wave 1–4 纳入专项集成测试、中间件加固与兼容性/无障碍自动化 |
| **Low（1–4）** | **0** | — | — |

> 注：以上合计 **22 项风险**（4 Critical + 12 High + 6 Medium），其中 10 项为本次审计在现行代码中发现的实证缺陷（`RSK-01`~`RSK-10`），12 项为系统持续演进中的高价值安全/架构风险（`RSK-11`~`RSK-22`）。
