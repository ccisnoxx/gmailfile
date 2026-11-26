# Gmail 账号管理面板

单管理员、同源部署的 Gmail 资料管理工具。需求基线见 [产品与技术规格](gmail-account-manager-spec.md)。

账号管理、CSV/流式加密导出、Session 设备管理、防篡改审计、加密备份/恢复、深色模式、离线 PWA、密钥轮换与 WebAuthn/Passkey 均已实现，当前迁移版本为 `0005`。
本仓库只发布应用代码、部署示例和通用运维说明；**示例配置不是任何实际实例的配置或上线证明**。
真实域名、主机、网络、生产验证证据、发布/镜像清单和恢复拓扑由运营者在私有配置库维护。
公开与私有资料的边界见 [公开仓库发布规范](docs/public-repository.md)，部署步骤见 [部署手册](docs/production-deployment.md)。

GitHub 仓库仅用于代码存储和同步，不启用 GitHub Actions；提交和推送不要求运行测试。
检查、测试和构建命令保留，按开发需要手动执行。

## 安装与启动开发环境

工具基线：Python 3.12.13、uv 0.13.4、Node 24.16.0、pnpm 11.25.0。
uv 0.13.4 包含 CA 信任安全修复（GHSA-hq85-5cpj-mr62）；开发机和构建环境均应使用该基线。
后端使用 `uv.lock`，前端使用 `pnpm-lock.yaml`；安装时禁止自动更新锁文件。
容器环境使用 Docker Compose，数据库固定 PostgreSQL 18.7-bookworm。

在项目根目录执行：

```bash
make install
cp .env.example .env
./scripts/generate-secrets.sh --directory "$PWD/.local/compose-secrets"
```

将 `.env` 的 `SECRETS_DIR` 改成上一步目录的**绝对路径**，其他 Secret 值不要写入 `.env`。
脚本不覆盖已有密钥；权限和离线备份说明见 [Secret 使用说明](secrets/README.md)。

已具备 Docker 时：

```bash
make compose-check
make up-dev
make dev-web
```

访问 <http://127.0.0.1:5173>，显示管理员登录页。Vite 将 `/api` 同源代理到本机 API。
先完成下节管理员初始化；页面可打开不等于生产验收完成。

Compose 自动等待数据库健康、运行 Alembic，只有迁移成功才启动 API；API 启动也会检查迁移版本。
PostgreSQL 没有宿主机端口映射，API 只映射至 `127.0.0.1:8000`。
不要使用 `docker compose down -v` 清理已有数据。
Docker29仅内部网络的容器可能静默不发布端口：生产overlay已用独立API入口桥修复并实测回环地址。开发overlay仍沿用原结构，不作为已验证的Docker29公网/回环入口，后续本机开发容器适配另行处理。

原生 PostgreSQL 17 的测试不能代替 PostgreSQL 18/Linux 容器验收；验证方法见 [验收指南](docs/validation.md)。

## 不使用容器时

连接独立开发 PostgreSQL，使用 Secret 文件配置 `DATABASE_PASSWORD_FILE` 和 `DATA_KEY_DIRECTORY`。
开发必须显式设 `APP_ENV=development`，设置本机地址、`ALLOWED_HOSTS`、数据库名/用户/端口。
用迁移角色运行后，再以应用角色启动 API：

```bash
cd backend
uv run --locked alembic upgrade head
# 将 DATABASE_USER / DATABASE_PASSWORD_FILE 切换成应用角色。
uv run --locked uvicorn app.main:create_app --factory \
  --host 127.0.0.1 --port 8000 --no-access-log --no-proxy-headers
```

`infra/postgres/init-roles.sh` 在 Compose 首次空库初始化时建立独立的 bootstrap、迁移和应用角色。
原生开发库应由数据库管理员建立相同的角色与权限，不连接已有业务库，不为测试清空公共 schema。

## 初始化与使用认证

先运行 `alembic upgrade head`（当前 head 为 `0005`），再通过交互终端初始化唯一管理员：

```bash
# 原生开发：在 backend/，使用上节的应用角色与 Secret 文件配置。
uv run --locked python -m app.cli create-admin
# Compose 环境准备并验收后：
docker compose --env-file .env -f infra/docker-compose.yml exec api python -m app.cli create-admin
```

密码至少 16 个字符（且校验已知泄露密码黑名单），通过终端隐藏输入并确认；不接受密码参数、管道或 Bootstrap 环境变量。
终端无法关闭回显时直接失败。已有管理员时拒绝重复创建；并发初始化也由事务锁和唯一约束保护。
请不要与 Gmail 密码复用。CLI 不提供 Web 注册或管理员创建路由。

本机 HTTP 开发显式设置 `SESSION_COOKIE_SECURE=false`，使用 `gm_dev_session`；
`APP_BASE_URL=http://127.0.0.1:5173` 必须与实际 Vite 访问来源一致。
生产不能关闭安全 Cookie，始终使用 `__Host-gm_session`（HttpOnly、Secure、Strict、Path=/、无 Domain）。
开发 Compose overlay 已配置上述本机例外，不能用于公网。不要在 HTTP 公网提交任何凭据。

认证流程：

1. 页面获取 10 分钟的登录前预会话和 CSRF Token。所有修改操作都携带 CSRF；Token 只在前端内存。
2. 首次输入正确密码后进入受限会话，可选择绑定 TOTP 验证器或直接绑定 WebAuthn/FIDO2 通行密钥（Passkey）。完成前没有账号访问权限。
3. 首次绑定 TOTP 或 Passkey 成功后都会展示 10 个离线恢复码，仅此一次，可当场下载。离线保存后清除展示；刷新、隐藏页面、退出或超时也会清除。
4. 后续可使用「密码 + TOTP」或直接通过「Passkey 无密码一步登录（Discoverable + UV）」。TOTP 允许前后各一个 30 秒时间步，已使用时间步不能重放；WebAuthn 挑战单次原子消费防重放，并启用签名计数反克隆检测。
5. 已绑定至少 1 个通行密钥时，可在系统设置按需停用 TOTP（系统始终强制保留至少一种有效二步因子）；高风险敏感操作（查看/复制密码、加密导出、改密、会话/密钥管理）均支持 Passkey UV Step-Up 或「密码 + TOTP」验证。
6. 认证器丢失时使用「密码 + 一次性恢复码」登录：立即撤销其他会话并进入受限态，重新绑定 TOTP 或 Passkey 后恢复完整权限；停用 TOTP 时，离线 `backup_tool.py switch` 同样使用「密码 + 一次性恢复码」兜底。

改密撤销所有会话并返回登录；重绑确认或恢复码重生成撤销其他会话，旧恢复码整批失效。
重绑未确认前保留原有效 TOTP，候选 Secret 加密保存在当前会话中，10 分钟后不能确认；
完整认证会话在最终确认时也检查 5 分钟重新验证窗口。
恢复码展示响应丢失后不能取回原文，重新验证后重新生成即可。下载文件由浏览器在内存中制作，不在服务器落明文临时文件。

服务端默认闲置 15 分钟、绝对 12 小时；管理员可在运维设置修改闲置时间（1—720 分钟），
立即应用所有会话且不重置 last_seen/绝对期限，先撤销按旧阈值已过期的会话，不能通过调大时间复活旧 Cookie。
登录和重新验证轮换 Session Secret 与 CSRF，
刷新和其他 GET 不更新 last_seen；刷新仅轮换 CSRF，不延长闲置/绝对寿命。其他标签持有旧 CSRF 时会提示刷新，不自动重放修改操作。
浏览器倒计时使用服务器时间差，防止客户端时钟偏差导致重查循环。

应用按管理员全局及 IP 分别持久化失败计数，覆盖登录、MFA 确认、恢复码、重新验证、重绑、改密及重生成入口。
15 分钟窗口内按 1/2/4/8 秒退避，第 5 次失败锁定 15 分钟，锁定不因窗口先结束而提前解除。
不同密码/TOTP/恢复码错误使用相同提示。公网的 Nginx 第二层限流留在阶段 5。

AES-256-GCM 支持读取 `DATA_KEY_DIRECTORY/data_key_vN` 中所有已配置的 32 字节原始密钥，
仅用 `ACTIVE_DATA_KEY_VERSION` 写入；每次独立 12 字节 nonce，并绑定实体、记录、字段和版本 AAD。
管理员 TOTP、待确认 Secret、Gmail 密码、完整手机号和敏感备注均使用此服务。
应用 Secret 文件和数据密钥仍需按 [Secret 说明](secrets/README.md) 单独离线备份。

## 账号管理

完成登录和 MFA 后默认进入账号列表。安全设置可从右上角进入，再返回账号列表。

- **新增/编辑**使用同一表单；注册时间默认为当前时间，按浏览器时区输入和显示，API 统一返回 UTC ISO 8601。
- 地址保留原始显示值。仅 `gmail.com` / `googlemail.com` 去点号、去 `+tag` 并统一域名；其他域名仅小写和去首尾空格用于唯一性。
- 辅助邮箱可填外部文本或关联已有账号，不能同时填写、与主邮箱相同或关联自身。切换方式时请求明确将另一项设为 `null`。
- 编辑时密码框始终为空；留空不会提交 `password`，原密文保持不变。不会读取密码回填表单，也不会提交掩码占位符。
- 归档、删除需确认。删除只设置 `deleted_at`，在“已删除记录”逐条恢复；不提供永久删除，也不释放邮箱唯一性。
- 对既有账号的所有修改（含人工时间标记、归档、删除、恢复）带 `row_version`。冲突返回 409，界面要求手动重新加载，不自动重放。
- 标签支持新增、重命名、删除和账号关联。删除只解除关联并递增关联账号版本，不删除账号。
- 已删除的辅助账号仍保留被引用关系和显示地址；恢复后可继续使用。Gmail 二步验证只记录状态，不保存 Seed 或恢复码。

**密码按需访问：**普通列表/详情不返回密码和任何密文字段；独立 POST 要求完整认证、CSRF 和最近 5 分钟重新验证。
前端密码 mutation 返回 `void`，密码不进入 Query/Mutation 缓存或持久化存储。20 秒后、关闭详情、切换界面/路由、隐藏、锁定或退出立即清除，晚到响应不能恢复展示。
每次显示/复制都有审计；复制事件请求不带密码。剪贴板清理只尽力执行，浏览器可能拒绝权限，不承诺绝对成功。

### 检索和批量管理

- 首页六项是**全局统计**，不随筛选变化。总数含归档、不含软删除；异常为 `restricted/login_failed/disabled`。本月按 `registered_at` 和浏览器 IANA 时区；超过 30 天未验证排除归档/删除，从未验证按注册时间起算，恰好 30 天不计入。
- 搜索编号、Gmail、辅助邮箱；状态、用途（精确匹配）、标签 ID、二步验证、注册日期、归档条件可组合。“更多筛选与排序”展开高级条件；重置保留当前的普通/已删除入口。
- 日期按浏览器本地日历转换成 UTC，开始日包含，结束日的**次日零点不包含**，兼容夏令时。排序仅允许规格六字段的正/倒序，空值在最后、UUID 为同值排序的稳定次序。
- 查询、排序、分页写入 URL；刷新和前进/后退可恢复。服务端分页默认 30、上限 100；已有配置可调低，响应返回有效上限。账号列表不再返回数组，而是 `{ items, total, page, page_size, max_page_size }`。不下载全量账号做本地筛选。
- 列设置可显示更新时间或隐藏资料列，身份和操作列固定；宽表仅在表格区域滚动，操作列固定在右侧。当前页全选只选择该页，改条件、换页、刷新或成功修改后清空选择。
- 批量状态/标签均需确认，每条携带 `id/row_version`。整批同一事务，任一冲突、删除记录或无效标签均回滚；提示定位账号，刷新重选后由用户重新提交。网络断开显示结果未知，不声称未提交，不自动重放。标签仅追加并保留原有关联；归档和取消归档同步维护归档时间。
- 辅助账号选择有专用服务端搜索/分页，不依赖列表当前页；已有的非当前页或已删除引用仍显示为当前关联并允许保留。
- 辅助邮箱页按地址去首尾空格、小写合并外部文本和系统内关联，不折叠 Gmail 点号/`+` 别名；关联记录含归档、不含删除。最近关联使用关联记录的 `registered_at`，不使用 `updated_at`；可进入精确关联账号列表。

### 闲置锁定

前端监听可信的键盘、指针、输入、滚轮及触摸交互，仅交互时最多每 60 秒提交一次 `POST /auth/activity`（较短闲置配置下间隔相应缩短）。没有定时保活或后台查询续期。
该请求验证原 Session/CSRF、更新 last_seen，返回时间边界但不轮换 Token；服务端仍独立拒绝闲置或绝对到期的 Session。
客户端以服务器时差计算期限，同一会话已知的绝对截止不能被延迟响应推后。
锁定/退出/认证失效清除 Query 缓存、账号详情和密码；取消查询并检查代次，晚到的账号或重新验证响应不能重新展示敏感资料。

## CSV、Session 与运维设置

从“安全设置 → 迁移与运维”进入：

- **CSV 导入**：UTF-8/BOM、10 MiB、手工映射、规范化重复 skip/update/error、绑定内容与版本的两阶段确认；全批事务，错误不回显敏感原文。
- **CSV 导出**：全部未删除（含归档），或当前筛选的全部结果，不受页码影响。固定非敏感字段、UTC 文件名、CSV 转义/公式防注入、审计。
- **带密码流式加密导出（`.gmenc`）**：`POST /api/v1/exports/encrypted` 导出完整敏感字段（密码/手机号/备注），强制 MFA Step-Up 验证、复用并发导出槽位并禁止明文落盘。离线解密命令：
  ```bash
  cd backend && uv run --locked python -m app.cli decrypt-export --input accounts.gmenc --output accounts.csv
  ```
- **数据密钥离线轮换与校验**：新增新版本 `data_key_vN` 后使用 CLI 演练、轮换与校验（保留旧密钥文件供历史备份与回滚使用）：
  ```bash
  cd backend
  uv run --locked python -m app.cli rotate-keys --target-version 2 --dry-run
  uv run --locked python -m app.cli rotate-keys --target-version 2
  uv run --locked python -m app.cli verify-keys
  ```
- **回收站批量恢复与辅助邮箱统计**：回收站支持多选并原子批量恢复（`POST /api/v1/accounts/batch-restore`）；独立 `/recovery-emails` 路由支持搜索、排序与关联账号预览。
- **Session 设备管理、深色模式、统计图表与 PWA**：活动会话展示脱敏白名单设备/系统/浏览器标签与活跃过滤；支持浅色/深色/跟随系统主题切换（WCAG 2.2 AA）；内置安全聚合趋势/状态/2FA 图表；支持同源离线 PWA 安装（Service Worker 严格不缓存 `/api/*` 与凭据响应）。
- **审计**：按事件、账号/Session ID、日期过滤并分页，只返回白名单事件和脱敏操作代码。
- **状态与锁定**：当前应用/迁移版本、真实备份状态；可改闲置期限，改密/TOTP/恢复码原功能保留。

规则与空值/软删除/关联语义见 [CSV 操作说明](docs/csv-transfer.md)。
每日备份唯一调度者为 Compose `operations` profile 的 backup 服务（02:00 UTC），默认不启用；
手工备份、Secret、7 日/8 周/12 月保留、异地单副本、取回、隔离恢复/明确切换及回退见 [运维手册](docs/operations.md)。
恢复只有 CLI，无网页覆盖数据库按钮。
私网受限 SSH 的准备、源机密钥生成与安装见 [异地 SSH 说明](docs/offsite-ssh.md)；实际链路和证据只在私有运维资料中维护。

## 常用命令

| 命令 | 用途 |
|---|---|
| `make install` | 使用锁文件安装前后端依赖 |
| `make generate-api` | 从 FastAPI 导出 OpenAPI，再生成 TypeScript 客户端 |
| `make check` | Python 静态检查/格式、TS strict、前端格式和生产构建 |
| `make test` | 后端非数据库测试、前端组件测试 |
| `make test-db` | 真实 PostgreSQL 集成测试，必须指定独立测试库 |
| `make dev-api` / `make dev-web` | 原生启动本机开发服务 |
| `make compose-check` | 只验证 Compose 配置，不启动容器 |
| `cd frontend && pnpm test:e2e` | Chromium 认证/账号 UI 冒烟测试，需已安装 Playwright Chromium；或通过 `PLAYWRIGHT_CHROME_EXECUTABLE` 指定本机 Chrome |

数据库测试设置 `TEST_DATABASE_URL`，数据库名必须以 `gm_test` 开头。每个测试创建随机独立 schema，
通过 Alembic 建表，结束时仅删除自己的 schema；未提供数据库时明确失败，不会跳过后声称通过。
生产迁移只用 Alembic，不使用 ORM `create_all()`。

前端 E2E 的 API 响应是拦截桩，用于验证 UI 状态和键盘操作；不能代替真实前后端联调。
可重复的检查入口和环境要求见 [验收指南](docs/validation.md)。
认证 E2E 关闭 trace、截图和视频，避免在失败产物中保留认证材料。

## 接口与生成代码

当前提供：

- `GET /api/v1/auth/session`：预会话/认证状态与 CSRF 轮换。
- `POST /api/v1/auth/login`、`logout`、`reverify`、`password`：认证、注销、重新验证与改密。
- `POST /api/v1/auth/totp/setup`、`confirm`、`regenerate-recovery-codes`、`disable`：TOTP 绑定、恢复码与（存在 Passkey 时）停用。
- `GET /api/v1/auth/webauthn/credentials`、`POST /api/v1/auth/webauthn/(register|login|step-up)/(options|verify)`、`PATCH/DELETE /api/v1/auth/webauthn/credentials/{id}`：WebAuthn/Passkey 全链路管理与认证。
- `GET/POST /api/v1/accounts`、`GET/PATCH/DELETE /api/v1/accounts/{id}`：服务端查询/分页/新增/详情/编辑/软删除。
- `POST /api/v1/accounts/{id}/archive|restore|mark-verified|mark-logged-in`：携带 `row_version` 的账号操作。
- `POST /api/v1/accounts/{id}/reveal-password|copy-password-event`：独立敏感访问与复制审计。
- `GET /api/v1/dashboard/summary|registration-trend|status-distribution|recovery-email-usage`：全局 KPI 与图表安全聚合统计。
- `POST /api/v1/accounts/batch-status|batch-tags|batch-restore`：整批事务，输入所选账号 ID/版本与目标状态/标签或回收站批量恢复。
- `GET /api/v1/accounts/options`：非删除辅助账号搜索/分页，只返回 ID、编号和邮箱。
- `GET /api/v1/recovery-emails`、`GET /api/v1/recovery-emails/{encoded_email}/accounts`：分页使用量统计与按邮箱关联账号预览。
- `POST /api/v1/auth/activity`：仅用户交互触发、CSRF 保护、不轮换 Token 的会话活动确认。
- `GET/POST /api/v1/tags`、`PATCH/DELETE /api/v1/tags/{id}`：标签管理。
- `POST /api/v1/imports/csv/preview|commit`：原始 text/csv 请求；预览 options 为 JSON 查询参数，提交只带 receipt_id，Schema/客户端由 OpenAPI 生成。
- `POST /api/v1/exports/csv`、`POST /api/v1/exports/encrypted`：非敏感 CSV 导出与 MFA Step-Up 保护的 `.gmenc` 流式加密导出。
- `GET /api/v1/auth/sessions`、`DELETE /api/v1/auth/sessions/{id}|others`：不续期的 Session 管理。
- `GET /api/v1/audit-events`、`GET /api/v1/system/version|backup-status`：完整认证的审计与状态。
- `GET /api/v1/settings`、`PATCH /api/v1/settings/idle`：锁定设置；修改需 CSRF 和最近重新验证。
- `GET /api/v1/health/live`：最小存活结果。
- `GET /api/v1/health/ready`：数据库及迁移版本就绪；详细诊断不公开返回。

普通错误统一为 `error.code/message/details` 和 `request_id`。生产默认关闭 `/api/docs`、OpenAPI 和 debug。
前端业务模型来源于 `docs/openapi.json` 生成的 `frontend/src/api/generated`，不能手工修改生成目录。
生成命令不需要数据库或真实 Secret。

TypeScript 固定 6.0.3，保持 Hey API 0.99.0 依赖的经典 Compiler API；不直接升级到 7 后绕过类型生成。

## 目录和后续实施

- `frontend/`：React/Vite 应用、测试和生成客户端。
- `backend/`：FastAPI、Pydantic Schema、ORM、Alembic 和 pytest。
- `infra/`：示例 Compose、独立角色、备份/恢复镜像、异地 overlay、Nginx 和 Certbot 续期模板。
- `scripts/`：契约/Secret 生成、备份/恢复/取回、白名单发布包，以及需在私有库定制的发布/身份准备示例；管理员初始化在 `backend/app/cli.py`。
- [分阶段计划](docs/implementation-plan.md)、[安全决策](docs/security-decisions.md)、[25 项验收对照](docs/acceptance-matrix.md)。

## 部署、升级和恢复边界

示例域名为 `accounts.example.com`，示例目录位于 `/opt/example` 和 `/srv/example`。
示例 IP 使用文档保留地址；Compose 的私网网段也是示例，部署前必须独立规划并检查冲突。
Nginx 示例演示一个可选的受信 PROXY protocol 上游；不是必须采用的生产拓扑。
发布器和异地身份脚本中的固定地址/目录检查要与私有配置一起调整，不能删除检查或放宽成通配信任。

已交付部署前的备份/恢复/升级操作路径，见 [运维手册](docs/operations.md)。从 `0002` 升级需新增备份 Secret/只读角色、
运行 `0003` 后才启动匹配 API，不重建旧数据库或改写历史 Migration。

生产实例逐项记录服务启用、手工备份、首次自然调度、异地取回、隔离恢复和离线保管确认，不能互相代替。
真实发布 ID、镜像 ID、证书时间、原始日志及未完成事项保存在私有台账，不提交公开仓库。
生产恢复切换只在真正恢复事件另行授权，季度演练按运维交付执行。
数据密钥单独离线备份；丢失对应全部版本密钥后，管理员密码重置也不能解密历史数据。
