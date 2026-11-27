# Gmail 账号管理面板

单管理员、同源部署的自托管 Gmail 资料管理工具。采用服务端字段级 AES-256-GCM 加密，定位为受控宿主机上的服务端可解密保险库（非客户端零知识方案），威胁模型与应急响应见 [安全政策](SECURITY.md)。

## 核心功能

- **账号生命周期管理**：支持新增/编辑、Gmail 地址规范化去重、可选辅助邮箱（外部文本或站内关联）、标签与第三方已注册应用登记、回收站批量恢复，以及受 MFA Step-Up 保护的不可逆永久删除。
- **敏感凭据隔离访问**：Gmail 密码、手机号与敏感备注按字段加密存储，普通列表与详情不返回明文；查看或复制需最近 5 分钟重新验证（Step-Up），前端仅在组件内存短时展示并自动清除。
- **强认证与会话治理**：仅支持通过 CLI 初始化唯一管理员，支持 TOTP 与 WebAuthn/Passkey 无密码登录、一次性恢复码、可配置闲置锁定、活动设备会话管理与失败退避锁定。
- **迁移、审计与离线备份**：支持两阶段预览/提交 CSV 导入、非敏感公式防护 CSV 导出、带口令流式加密导出（`.gmenc`）、防篡改哈希链审计日志，以及 `age` 加密每日备份与隔离恢复。
- **工作台体验**：提供全局统计与聚合图表、多维筛选与 URL 同步、整批事务批量操作、浅色/深色主题切换与离线提示 PWA。

## 技术栈与环境基线

| 维度 | 基线版本 / 说明 |
| --- | --- |
| 后端 | Python 3.12.13、`uv` 0.13.4、FastAPI、SQLAlchemy、Alembic（锁文件 `backend/uv.lock`） |
| 前端 | Node.js 24.16.0、`pnpm` 11.25.0、React、Vite、TypeScript 6.0.3（锁文件 `frontend/pnpm-lock.yaml`） |
| 数据库与容器 | PostgreSQL 18.7-bookworm、Docker Compose |

## 快速开始（开发环境）

1. **安装依赖并生成本地开发 Secret**：

   ```bash
   make install
   cp .env.example .env
   ./scripts/generate-secrets.sh --directory "$PWD/.local/compose-secrets"
   ```

   将 `.env` 中的 `SECRETS_DIR` 设为上一步目录的**绝对路径**，其余 Secret 保持通过文件挂载，不要写入 `.env`（权限与离线保管见 [Secret 说明](secrets/README.md)）。

2. **启动数据库、自动迁移与开发服务**：

   ```bash
   make compose-check
   make up-dev
   make dev-web
   ```

3. **初始化唯一管理员**（密码至少 16 位，终端隐藏输入）：

   ```bash
   docker compose --env-file .env -f infra/docker-compose.yml exec api python -m app.cli create-admin
   ```

4. **打开前端页面**：访问 <http://127.0.0.1:5173> 完成登录，按引导绑定 TOTP 或 Passkey，并离线保存首次展示的 10 个一次性恢复码。

> 不使用容器的原生开发流程、数据库角色配置、完整 CLI 与接口说明见 [开发指南](docs/development.md)；各功能交互细则见 [使用说明](docs/usage.md)。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `make install` | 按锁文件安装前后端依赖 |
| `make compose-check` / `make up-dev` | 校验 Compose 配置并启动开发数据库、迁移与 API |
| `make dev-api` / `make dev-web` | 原生启动本机后端 / 前端开发服务 |
| `make generate-api` | 导出 `docs/openapi.json` 并重新生成前端 TypeScript 客户端 |
| `make check` | 后端 Ruff 检查/格式、前端 TypeScript 检查/格式与生产构建 |
| `make test` | 后端非数据库单元测试与前端组件测试 |
| `make test-db` | 真实 PostgreSQL 集成测试（需配置 `TEST_DATABASE_URL`） |
| `make gate-release` | 本地发布前静态契约、文档、配置、离线依赖与单测覆盖率门禁 |

完整测试、Playwright E2E 与全量发布门禁说明见 [开发指南](docs/development.md) 与 [验证与验收指南](docs/validation.md)。

## 项目结构

- `backend/`：FastAPI 应用、领域服务、Alembic 迁移、管理 CLI 与 pytest 测试。
- `frontend/`：React/Vite 前端工作台、OpenAPI 生成客户端、Vitest 与 Playwright 测试。
- `infra/`：Docker Compose 示例、PostgreSQL 角色初始化与升级脚本、备份/恢复镜像、Nginx 与 Certbot 模板。
- `scripts/`：Secret 生成、备份/恢复/异地取回、白名单发布打包、质量门禁与验收脚本。
- `docs/`：开发、使用、CSV 迁移、生产部署、运维恢复与安全决策文档；完整需求基线见 [产品与技术规格](gmail-account-manager-spec.md)。

## 文档索引

| 分类 | 文档 |
| --- | --- |
| 开发与契约 | [开发指南](docs/development.md) · [OpenAPI 契约](docs/openapi.json) · [验证与验收指南](docs/validation.md) |
| 功能与迁移 | [使用说明](docs/usage.md) · [CSV 与加密导出](docs/csv-transfer.md) |
| 部署与运维 | [生产部署手册](docs/production-deployment.md) · [备份、恢复与升级](docs/operations.md) · [异地 SSH 备份](docs/offsite-ssh.md) · [Secret 说明](secrets/README.md) |
| 安全与治理 | [安全政策与应急响应](SECURITY.md) · [安全决策](docs/security-decisions.md) · [公开与私有仓库边界](docs/public-repository.md) · [变更日志](CHANGELOG.md) · [许可协议](LICENSE) |

## 公开仓库与安全边界

- 本仓库只发布应用代码、部署示例与通用运维说明；示例域名（`accounts.example.com`）、文档保留 IP、示例网段与路径不能直接用于生产，真实实例配置与运维台账由运营者在私有侧维护（见 [公开仓库发布规范](docs/public-repository.md)）。
- GitHub 仓库仅用于代码存储和同步，不启用 GitHub Actions；检查、测试与构建命令按开发或发布需要手动执行。
- 数据密钥（`data_key_vN`）必须单独离线备份；丢失对应版本的全部历史密钥后，重置管理员密码也无法解密历史数据。
