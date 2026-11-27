# 开发指南与接口概览

本指南涵盖本地开发（容器与非容器）、管理 CLI、完整命令列表与 OpenAPI 接口契约生成；产品交互行为见 [使用说明](usage.md)，验收与门禁证据边界见 [验证与验收指南](validation.md)。

## 工具链与锁文件约束

- **运行时基线**：Python 3.12.13、`uv` 0.13.4、Node.js 24.16.0、`pnpm` 11.25.0、PostgreSQL 18.7-bookworm。
- `uv` 0.13.4 包含 CA 信任安全修复（`GHSA-hq85-5cpj-mr62`），开发机与构建环境均应使用该基线。
- 后端使用 `backend/uv.lock`，前端使用 `frontend/pnpm-lock.yaml`；安装命令（`make install`）严格按锁文件安装，禁止自动改写锁文件。

## 容器开发环境说明

通过 `make compose-check && make up-dev && make dev-web` 启动本地开发栈后：

- Compose 按顺序等待数据库健康并运行 Alembic（当前迁移 head 为 `0008`），迁移成功才启动 API；API 启动时也会校验迁移版本。
- PostgreSQL 不映射宿主机端口，API 仅映射至 `127.0.0.1:8000`；Vite 开发服务器监听 <http://127.0.0.1:5173> 并将 `/api` 同源代理到本机 API。
- 请勿使用 `docker compose down -v` 清理已有数据。
- **Docker 29 说明**：仅内部网络的容器在 Docker 29 下可能静默不发布端口。生产 overlay 已通过独立 API 入口桥修复并实测回环地址；开发 overlay 仍沿用原结构，不作为已验证的 Docker 29 公网/回环入口。
- 原生 PostgreSQL 17 测试不能替代 PostgreSQL 18 / Linux 容器验收，详见 [验证与验收指南](validation.md)。

## 不使用容器（原生 PostgreSQL 开发）

连接独立开发 PostgreSQL 时，使用 Secret 文件配置 `DATABASE_PASSWORD_FILE` 与 `DATA_KEY_DIRECTORY`：

- 显式设置 `APP_ENV=development`、`ALLOWED_HOSTS`、数据库主机/端口/库名/用户，以及与实际 Vite 访问来源一致的 `APP_BASE_URL=http://127.0.0.1:5173`。
- 本机 HTTP 开发显式设置 `SESSION_COOKIE_SECURE=false`，此时使用 `gm_dev_session` Cookie；生产环境禁止关闭安全 Cookie，始终使用 `__Host-gm_session`（`HttpOnly`、`Secure`、`SameSite=Strict`、`Path=/`、无 `Domain`）。开发配置绝不能用于 HTTP 公网。
- `infra/postgres/init-roles.sh` 在 Compose 首次空库初始化时建立独立的 bootstrap、迁移与应用角色。原生开发库应由 DBA 建立相同的角色与权限，不连接已有业务库，不为测试清空公共 schema。

先用迁移角色升级数据库至当前迁移 head（`0008`），再切换应用角色启动 API：

```bash
cd backend
uv run --locked alembic upgrade head
# 将 DATABASE_USER / DATABASE_PASSWORD_FILE 切换为应用角色后启动：
uv run --locked uvicorn app.main:create_app --factory \
  --host 127.0.0.1 --port 8000 --no-access-log --no-proxy-headers
```

## 常用管理 CLI（`python -m app.cli`）

所有管理命令均在 `backend/` 目录下运行（Compose 环境使用 `docker compose --env-file .env -f infra/docker-compose.yml exec api python -m app.cli ...`）：

- **初始化唯一管理员**（先确保已完成 `alembic upgrade head`）：
  ```bash
  uv run --locked python -m app.cli create-admin
  ```
  密码至少 16 个字符并校验已知泄露密码黑名单，通过终端隐藏输入并确认；不接受命令行参数、管道或环境变量，终端无法关闭回显时直接失败。系统不提供 Web 注册或管理员创建路由，请勿与 Gmail 密码复用。
- **离线解密 `.gmenc` 加密导出**（主 CSV 供无损恢复，请勿直接用 Excel/LibreOffice 打开；电子表格查阅使用 `--spreadsheet-safe-copy`，详规见 [CSV 操作说明](csv-transfer.md)）：
  ```bash
  uv run --locked python -m app.cli decrypt-export \
    --input accounts.gmenc --output accounts-recovery.csv \
    --spreadsheet-safe-copy accounts-view-only.csv
  ```
- **数据密钥离线轮换与校验**（新增 `data_key_vN` 后执行，务必保留历史密钥文件供旧备份与回滚使用）：
  ```bash
  uv run --locked python -m app.cli rotate-keys --target-version 2 --dry-run
  uv run --locked python -m app.cli rotate-keys --target-version 2
  uv run --locked python -m app.cli verify-keys
  ```
- **防篡改审计校验与队列维护**（详见 [运维手册](operations.md)）：
  `verify-audit`、`sign-audit-checkpoint`、`verify-audit-checkpoint`、`flush-audit-spool`。

## 完整命令对照

| 命令 | 用途 |
| --- | --- |
| `make install` | 按锁文件安装前后端依赖 |
| `make generate-api` | 从 FastAPI 导出 `docs/openapi.json` 并生成前端 TypeScript 客户端 |
| `make check` | 后端 Ruff 静态检查/格式、前端 TS strict 检查/格式与生产构建 |
| `make test` | 后端非数据库单元测试与前端组件测试 |
| `make test-db` | 真实 PostgreSQL 集成测试（需指定独立测试库） |
| `make dev-api` / `make dev-web` | 原生启动本机后端 / 前端开发服务 |
| `make compose-check` | 仅校验开发 Compose 配置，不启动容器 |
| `make up-dev` | 构建并启动开发数据库、迁移任务与 API |
| `make audit-deps-offline-integrity` | 离线校验锁文件、精确版本固定与基础镜像摘要（不查 CVE 库） |
| `make audit-deps-online-strict` | 严格在线 CVE 漏洞库审计（缺工具、断网或命中高危即失败） |
| `make gate-release` | 本地发布前静态契约、文档、配置、离线供应链、单测与覆盖率门禁 |
| `make gate-release-live` | 本地真实全栈门禁（`gate-release` + PG18 集成测试 + 全量覆盖率 + 实时 E2E） |
| `make gate-release-full` | 私有发布机完整严格门禁（含在线漏洞审计、无障碍、三引擎兼容与实时 E2E） |
| `cd frontend && pnpm test:e2e` | Chromium 认证/账号 UI 冒烟测试（可用 `PLAYWRIGHT_CHROME_EXECUTABLE` 指定本机 Chrome） |

测试边界说明：

- `make test-db` 需设置 `TEST_DATABASE_URL`，数据库名必须以 `gm_test` 开头；每个用例自动创建并销毁随机独立 schema，通过 Alembic 建表，未提供数据库时明确失败（不静默跳过）。生产迁移只用 Alembic，不使用 ORM `create_all()`。
- `pnpm test:e2e` 使用 API 响应拦截桩验证 UI 状态与键盘交互，不能替代真实联调；认证用例关闭 trace、截图和视频以避免落盘认证材料。

## 接口概览与 OpenAPI 生成

完整接口定义以 [docs/openapi.json](openapi.json) 为唯一权威来源。前端模型与客户端由 `make generate-api` 自动生成到 `frontend/src/api/generated`，禁止手工修改生成目录；生成命令不需要数据库或真实 Secret。

- **TypeScript 版本锁定**：固定 `6.0.3` 以兼容 Hey API `0.99.0` 依赖的经典 Compiler API，不直接升级至 7 后绕过类型生成。
- **错误与文档暴露**：普通错误统一返回 `error.code/message/details` 与 `request_id`；生产环境默认关闭 `/api/docs`、OpenAPI 与 debug。

主要 API 模块：

- **认证、MFA 与会话**：`GET /api/v1/auth/session`、`POST /api/v1/auth/login|logout|reverify|password|activity`、`POST /api/v1/auth/totp/setup|confirm|regenerate-recovery-codes|disable`、`GET /api/v1/auth/webauthn/credentials`、`POST /api/v1/auth/webauthn/(register|login|step-up)/(options|verify)`、`PATCH/DELETE /api/v1/auth/webauthn/credentials/{id}`、`GET/DELETE /api/v1/auth/sessions`（含 `{id}` 与 `others`）。
- **账号管理与回收站**：`GET/POST /api/v1/accounts`、`GET/PATCH/DELETE /api/v1/accounts/{id}`、`GET /api/v1/accounts/options`、`POST /api/v1/accounts/{id}/archive|unarchive|restore|mark-verified|mark-logged-in|apps`、`POST /api/v1/accounts/batch-status|batch-tags|batch-verify|batch-delete|batch-restore`，以及强制最近 5 分钟 MFA Step-Up 的回收站不可逆永久删除 `DELETE /api/v1/accounts/{id}/permanent` 与 `POST /api/v1/accounts/batch-permanent-delete`。
- **敏感字段按需访问**：`POST /api/v1/accounts/{id}/reveal-password|copy-password-event|reveal-sensitive`（完整认证 + CSRF + 最近 5 分钟 Step-Up + 审计）。
- **辅助邮箱、应用与标签**：`GET /api/v1/recovery-emails`、`GET /api/v1/recovery-email-accounts`（邮箱通过查询参数 `email` 传递，避免写入访问日志路径）、`POST /api/v1/recovery-emails/link-internal`、`GET/POST /api/v1/apps`、`GET /api/v1/apps/usage`、`PATCH/DELETE /api/v1/apps/{id}`、`POST /api/v1/apps/fetch-icon`、`GET/POST/PATCH/DELETE /api/v1/tags`。
- **统计与图表**：`GET /api/v1/dashboard/summary|insights|registration-trend|status-distribution|recovery-email-usage`。
- **导入导出、审计与系统状态**：`POST /api/v1/imports/csv/preview|commit`、`POST /api/v1/exports/csv`、`POST /api/v1/exports/encrypted`（MFA Step-Up 保护的 `.gmenc` 流式加密导出）、`GET /api/v1/audit-events`、`GET /api/v1/settings`、`PATCH /api/v1/settings/idle`、`GET /api/v1/system/version|backup-status`、`GET /api/v1/health/live|ready`。
