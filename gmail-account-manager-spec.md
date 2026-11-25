# Gmail 账号管理面板——产品与技术规格

> 供 Codex 直接作为开发依据使用\
> 文档版本：v1.0\
> 编写日期：2026-11-23\
> 状态：需求基线已确认

---

## 1. 项目概述

开发一个部署在 Linux 云服务器上的单用户 Gmail 账号管理面板，用于记录、检索和维护人工注册的 Gmail 账号资料。

系统通过公网域名访问，前端使用 React，后端使用 FastAPI，数据存储在 PostgreSQL。Nginx 负责 HTTPS、React 静态文件、API 反向代理、安全响应头和请求限流。

### 1.1 推荐访问地址

文档统一使用以下示例子域名：

```text
accounts.example.com
```

实际域名由运营者通过环境变量配置并保存在私有配置库，不写入公开仓库。`example.com` 仅用于文档示例。

### 1.2 核心定位

本系统是一个：

- 单管理员使用的账号资料管理后台；
- 面向 Windows 和 macOS 桌面浏览器；
- 以数据表格、筛选、快速录入和状态维护为核心的管理工具；
- 公网可访问，但没有公开注册入口；
- 不负责自动注册 Gmail、自动登录、获取验证码或规避 Google 风控。

### 1.3 已确认的技术方向

```text
Frontend:   React + TypeScript + Vite
UI:         Tailwind CSS + shadcn/ui
Data UI:    TanStack Query + TanStack Table
Forms:      React Hook Form + Zod
Backend:    FastAPI + Pydantic
ORM:        SQLAlchemy + Alembic + psycopg
Database:   PostgreSQL
Crypto:     Argon2id + AES-256-GCM
Proxy:      Nginx
Deployment: Docker Compose + host Nginx + Certbot
```

---

## 2. 安全边界与风险说明

### 2.1 公网访问结论

系统可以直接部署到公网，不强制使用 Tailscale。但是“进入面板需要密码”并不等于不再存在安全风险。

该系统集中保存多个邮箱的登录密码，属于高价值敏感应用。公网部署至少需要同时防范：

- 暴力破解和凭证填充；
- 管理员密码泄露；
- 会话 Cookie 被盗；
- CSRF、XSS 和依赖漏洞；
- API 越权或敏感字段误返回；
- PostgreSQL 或数据库备份泄露；
- 云服务器 root 权限失陷；
- 加密密钥丢失；
- 误删除、磁盘故障和服务器账号异常。

因此，本规格把 HTTPS、登录限流、安全会话、二步验证、敏感字段加密、异地备份和安全更新定义为生产上线条件，而不是可选装饰。

### 2.2 明确接受的安全边界

Gmail 密码由 FastAPI 在服务端解密，因此：

- 单独泄露 PostgreSQL 数据库时，攻击者不能直接得到 Gmail 明文密码；
- 单独泄露数据库备份时，攻击者不能直接得到 Gmail 明文密码；
- 如果攻击者完全取得云服务器 root 权限，可能同时取得数据库密文和应用加密密钥，进而解密 Gmail 密码。

第一版接受这一边界。系统不采用浏览器端零知识加密或 KDBX 文件同步方案。

---

## 3. 产品范围

### 3.1 第一版必须实现（P0）

- 单管理员登录，无公开注册；
- 管理员密码验证；
- TOTP 二步验证；
- Gmail 账号新增、查看、编辑、归档和软删除；
- Gmail 地址重复检测；
- 注册时间自动填写，也允许修改；
- 辅助邮箱文本记录或关联已有账号；
- 状态、用途、标签和二步验证状态管理；
- 一键复制 Gmail、密码和辅助邮箱；
- Gmail 密码默认隐藏；
- 显示密码前进行敏感操作校验；
- 搜索、筛选、排序、分页和批量状态修改；
- 总量、状态、本月新增等基础统计；
- CSV 批量导入；
- 默认不包含密码的 CSV 导出；
- PostgreSQL 自动备份并二次加密；
- 闲置自动锁定和服务端 Session 失效；
- 审计日志；
- Docker Compose 部署；
- Nginx 公网 HTTPS 访问。

### 3.2 第二阶段功能（P1）

- 带密码的加密导出；
- 回收站和批量恢复；
- 辅助邮箱使用量统计页面；
- 登录设备和 Session 管理；
- 深色模式；
- 更丰富的图表；
- 密钥轮换管理命令；
- PWA 安装；
- WebAuthn/FIDO2 替代或补充 TOTP。

### 3.3 明确不做

第一版不得实现以下功能：

- 批量注册 Gmail；
- 自动登录 Gmail；
- 自动获取短信或邮箱验证码；
- 自动绕过 Google 风控；
- Google API 接入；
- 自动判断 Gmail 是否正常；
- 多用户、组织、角色和权限系统；
- 第三方 OAuth 登录；
- 浏览器自动填充扩展；
- Redis、Celery、Kafka、Elasticsearch 或 Kubernetes；
- 公开 API；
- 手机原生 App。

---

## 4. 用户与主要使用场景

### 4.1 用户角色

第一版只有一个角色：

```text
Administrator
```

系统数据库内部可以保留用户表，但不提供用户注册或多用户管理界面。

### 4.2 主要流程

1. 管理员访问 `https://accounts.example.com`。
2. 输入管理员密码和 TOTP 验证码。
3. 进入账号列表首页。
4. 新增 Gmail 账号资料。
5. 根据邮箱、辅助邮箱、状态、用途、日期或标签检索账号。
6. 打开详情抽屉查看完整资料。
7. 重新验证后显示或复制 Gmail 密码。
8. 手动更新“最后登录”“最后验证”和账号状态。
9. 归档不用的账号，或将误删记录从回收站恢复。
10. 定期导出非敏感 CSV，系统自动完成数据库备份。

---

## 5. 页面与信息架构

### 5.1 登录页

页面元素：

- 产品名称；
- 管理员密码输入框；
- TOTP 验证码输入框；
- 登录按钮；
- 登录错误提示；
- 不显示“注册”“忘记密码”或用户名输入框。

首次部署后，通过服务器 CLI 创建管理员。首次成功输入管理员密码后，强制完成 TOTP 绑定，未绑定前不得进入账号数据页面。

### 5.2 账号首页

首页同时承担仪表盘和账号列表功能。

顶部统计卡片：

- 账号总数；
- 正常账号数；
- 待验证账号数；
- 异常账号数；
- 本月新增数；
- 超过 30 天未验证的账号数。

筛选栏：

- 搜索：账号编号、Gmail 地址、辅助邮箱；
- 账号状态；
- 用途；
- 标签；
- 二步验证状态；
- 注册日期范围；
- 是否已归档；
- 重置筛选；
- 新增账号按钮。

账号表格列：

| 列 | 默认显示 | 说明 |
|---|---:|---|
| 账号编号 | 是 | 示例 `GM-000001` |
| Gmail 邮箱 | 是 | 支持一键复制 |
| 注册时间 | 是 | 浏览器本地时区显示 |
| 辅助邮箱 | 是 | 支持一键复制 |
| 状态 | 是 | 使用状态 Badge |
| 二步验证 | 是 | 已开启、未开启、未知 |
| 用途 | 是 | 可筛选 |
| 最后验证 | 是 | 可快速标记为今天 |
| 标签 | 是 | 最多展示若干个，超出折叠 |
| 更新时间 | 否 | 可通过列设置打开 |
| 操作 | 是 | 详情、编辑、归档 |

表格能力：

- 服务端分页；
- 服务端排序；
- 多条件筛选；
- 列显示开关；
- 行选择；
- 批量修改状态；
- 批量添加标签；
- 固定操作列；
- 空状态、错误状态和骨架加载状态。

### 5.3 账号详情抽屉

点击任意账号行，从右侧打开详情抽屉。

展示内容：

- 账号编号；
- Gmail 邮箱和复制按钮；
- 密码占位符、显示按钮和复制按钮；
- 注册时间；
- 辅助邮箱；
- 绑定手机号；
- 账号状态；
- 二步验证状态；
- 最后登录时间；
- 最后验证时间；
- 密码修改时间；
- 账号用途；
- 标签；
- 备注；
- 创建时间和修改时间。

可执行操作：

- 标记“今天已登录”；
- 标记“今天已验证”；
- 编辑；
- 归档；
- 删除；
- 恢复。

密码不得随账号详情接口一起返回。只有点击“显示密码”或“复制密码”时，才调用独立敏感接口。

### 5.4 新增和编辑账号

新增与编辑共用同一个表单组件，可以使用 Dialog 或右侧 Sheet。

字段顺序：

1. Gmail 地址；
2. Gmail 登录密码；
3. 注册时间，默认当前时间；
4. 辅助邮箱；
5. 绑定手机号；
6. 账号状态；
7. 二步验证状态；
8. 账号用途；
9. 标签；
10. 最后登录时间；
11. 最后验证时间；
12. 密码修改时间；
13. 备注。

保存前校验：

- Gmail 地址格式；
- Gmail 地址规范化后是否重复；
- 密码是否为空；
- 注册时间是否有效；
- 辅助邮箱是否为空；
- 辅助邮箱不能与主邮箱相同；
- 辅助邮箱关联账号不能指向自身；
- 手机号长度和格式基础校验；
- 提交时携带 `row_version`，防止覆盖另一台设备上的修改。

### 5.5 辅助邮箱页面

展示每个辅助邮箱的关联情况：

| 字段 | 说明 |
|---|---|
| 辅助邮箱 | 文本地址或系统内账号 |
| 关联账号数 | 使用该地址作为辅助邮箱的账号数量 |
| 正常账号数 | 关联账号中的正常数量 |
| 异常账号数 | 关联账号中的异常数量 |
| 最近关联时间 | 最近一条关联记录的注册时间 |

点击后进入或打开关联账号列表。

### 5.6 设置页面

- 修改管理员密码；
- TOTP 重新绑定；
- 下载和重新生成恢复码；
- 自动锁定时间；
- CSV 导入；
- CSV 导出；
- 当前系统版本；
- 最近备份状态；
- 当前 Session；
- 注销其他 Session；
- 审计日志入口。

备份恢复的最终执行应优先通过服务器 CLI 完成，避免 Web 页面误操作覆盖生产数据库。

---

## 6. 字段与业务规则

### 6.1 必填字段

| 字段 | 说明 |
|---|---|
| Gmail 地址 | 唯一账号标识，规范化后不可重复 |
| Gmail 登录密码 | 使用应用层可逆加密存储 |
| 注册时间 | 默认当前时间，数据库存 UTC |
| 辅助邮箱 | 外部邮箱文本或关联已有账号，二选一 |

### 6.2 建议字段

| 字段 | 示例 |
|---|---|
| 账号状态 | 正常、待验证、受限、无法登录、停用 |
| 账号用途 | 工作、测试、订阅、社交、备用 |
| 标签 | 项目 A、长期账号、需要检查 |
| 二步验证状态 | 未开启、已开启、未知 |
| 绑定手机号 | 完整手机号，加密保存 |
| 最后验证时间 | 最近一次确认可以正常使用的时间 |
| 最后登录时间 | 最近一次人工登录的时间 |
| 密码修改时间 | 最近一次修改 Gmail 密码的时间 |
| 备注 | 敏感备注，加密保存 |
| 创建时间 | 自动生成 |
| 修改时间 | 自动更新 |

### 6.3 状态枚举

数据库保存稳定英文代码，前端显示中文：

```text
normal                 正常
pending_verification   待验证
restricted             受限
login_failed           无法登录
disabled               已停用
archived               已归档
```

### 6.4 二步验证状态

```text
unknown      未知
disabled     未开启
enabled      已开启
```

系统只记录状态，不保存 Gmail 的 TOTP Seed 或恢复码。

### 6.5 Gmail 地址规范化

保存原始显示值，同时生成 `gmail_email_normalized` 用于唯一性检查。

对于 `gmail.com` 和 `googlemail.com`：

1. 转为小写；
2. 将 `googlemail.com` 统一为 `gmail.com`；
3. 去除本地部分中的点号；
4. 去除 `+tag` 后缀；
5. 去除首尾空格。

示例：

```text
User.Name+test@googlemail.com
```

规范化为：

```text
username@gmail.com
```

对于其他域名，只做小写和首尾空格清理，不去除点号或 `+tag`。

### 6.6 时间处理

- PostgreSQL 使用 `TIMESTAMPTZ`；
- API 使用 ISO 8601；
- 数据库存储 UTC；
- 前端按浏览器本地时区显示；
- 日期筛选在前端转换为明确的 UTC 起止时间；
- 不在数据库中保存模糊的本地时间字符串。

---

## 7. 数据库设计

### 7.1 `admin_users`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | UUID | 主键 |
| `password_hash` | TEXT | Argon2id 哈希 |
| `totp_secret_ciphertext` | BYTEA | 加密后的 TOTP Secret |
| `totp_secret_nonce` | BYTEA | AES-GCM nonce |
| `totp_enabled` | BOOLEAN | 是否已启用 |
| `password_changed_at` | TIMESTAMPTZ | 密码修改时间 |
| `created_at` | TIMESTAMPTZ | 创建时间 |
| `updated_at` | TIMESTAMPTZ | 修改时间 |

只允许存在一个有效管理员。不得提供公开创建接口。

### 7.2 `admin_recovery_codes`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | UUID | 主键 |
| `admin_user_id` | UUID | 外键 |
| `code_hash` | TEXT | 恢复码哈希，不保存明文 |
| `used_at` | TIMESTAMPTZ | 使用时间 |
| `created_at` | TIMESTAMPTZ | 创建时间 |

恢复码只在生成时展示一次。

### 7.3 `user_sessions`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | UUID | Session 公共选择器 |
| `admin_user_id` | UUID | 外键 |
| `token_hash` | BYTEA | 随机 Session Secret 的 SHA-256 哈希 |
| `csrf_token_hash` | BYTEA | CSRF Token 哈希 |
| `created_at` | TIMESTAMPTZ | 创建时间 |
| `last_seen_at` | TIMESTAMPTZ | 最近活动时间 |
| `expires_at` | TIMESTAMPTZ | 绝对过期时间 |
| `reauthenticated_at` | TIMESTAMPTZ | 最近一次敏感操作重新验证时间 |
| `ip_address` | INET | 登录 IP |
| `user_agent` | TEXT | 浏览器信息 |
| `revoked_at` | TIMESTAMPTZ | 注销时间 |

数据库只保存随机 Session Secret 的哈希，Cookie 中保存选择器和 Secret。

### 7.4 `gmail_accounts`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | UUID | 主键 |
| `account_no` | BIGINT IDENTITY | 唯一顺序编号 |
| `gmail_email` | TEXT | 原始展示邮箱 |
| `gmail_email_normalized` | TEXT | 唯一索引 |
| `password_ciphertext` | BYTEA | Gmail 密码密文 |
| `password_nonce` | BYTEA | Gmail 密码 nonce |
| `password_key_version` | SMALLINT | 加密密钥版本 |
| `registered_at` | TIMESTAMPTZ | 注册时间 |
| `recovery_account_id` | UUID NULL | 自关联已有 Gmail 账号 |
| `recovery_email_external` | TEXT NULL | 外部辅助邮箱 |
| `phone_ciphertext` | BYTEA NULL | 手机号密文 |
| `phone_nonce` | BYTEA NULL | 手机号 nonce |
| `phone_key_version` | SMALLINT NULL | 手机号密钥版本 |
| `status` | VARCHAR(32) | 账号状态 |
| `two_factor_status` | VARCHAR(16) | 二步验证状态 |
| `last_login_at` | TIMESTAMPTZ NULL | 最后人工登录时间 |
| `last_verified_at` | TIMESTAMPTZ NULL | 最后验证时间 |
| `password_changed_at` | TIMESTAMPTZ NULL | Gmail 密码修改时间 |
| `purpose` | VARCHAR(100) NULL | 用途 |
| `notes_ciphertext` | BYTEA NULL | 备注密文 |
| `notes_nonce` | BYTEA NULL | 备注 nonce |
| `notes_key_version` | SMALLINT NULL | 备注密钥版本 |
| `archived_at` | TIMESTAMPTZ NULL | 归档时间 |
| `deleted_at` | TIMESTAMPTZ NULL | 软删除时间 |
| `row_version` | INTEGER | 乐观锁版本，默认 1 |
| `created_at` | TIMESTAMPTZ | 创建时间 |
| `updated_at` | TIMESTAMPTZ | 修改时间 |

约束：

- `gmail_email_normalized` 唯一；
- `recovery_account_id` 和 `recovery_email_external` 必须且只能填写一个；
- `recovery_account_id` 不能等于当前记录 `id`；
- `row_version >= 1`；
- 枚举字段使用数据库 `CHECK` 约束；
- 删除操作默认只设置 `deleted_at`；
- 归档操作设置 `status = archived` 和 `archived_at`。

账号编号由前端或序列化层格式化为：

```text
GM-000001
```

### 7.5 `tags`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | UUID | 主键 |
| `name` | VARCHAR(50) | 标签名称，唯一 |
| `created_at` | TIMESTAMPTZ | 创建时间 |

### 7.6 `gmail_account_tags`

| 字段 | 类型 | 说明 |
|---|---|---|
| `account_id` | UUID | 联合主键、外键 |
| `tag_id` | UUID | 联合主键、外键 |

### 7.7 `audit_events`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | UUID | 主键 |
| `event_type` | VARCHAR(64) | 事件类型 |
| `account_id` | UUID NULL | 相关账号 |
| `session_id` | UUID NULL | 相关 Session |
| `ip_address` | INET NULL | 操作 IP |
| `user_agent` | TEXT NULL | 浏览器信息 |
| `metadata` | JSONB | 不含敏感明文的附加信息 |
| `created_at` | TIMESTAMPTZ | 创建时间 |

审计事件包括：

```text
login_success
login_failed
logout
mfa_failed
password_reverified
account_created
account_updated
account_archived
account_deleted
account_restored
password_revealed
password_copied
csv_imported
csv_exported
sensitive_exported
settings_changed
```

不得写入审计日志：

- Gmail 明文密码；
- 管理员密码；
- TOTP Secret；
- 恢复码；
- 完整手机号；
- 数据加密密钥；
- Session Secret；
- CSV 原始文件内容。

---

## 8. 密码和敏感数据安全设计

### 8.1 管理员密码

管理员密码用于身份验证，应采用 Argon2id 哈希保存，不得可逆加密。

实现要求：

- 使用 `pwdlib[argon2]` 或等效成熟库；
- 不自行实现 Argon2；
- 参数以库的安全推荐值为基线，并允许以后升级；
- 登录成功后，如果当前哈希参数已过时，自动重新哈希；
- 管理员密码不得与任何 Gmail 密码复用；
- 不在日志、错误报告或指标中出现密码内容。

### 8.2 Gmail 密码和其他敏感字段

以下字段必须使用应用层 AES-256-GCM 可逆加密：

- Gmail 登录密码；
- 完整绑定手机号；
- 敏感备注；
- 管理员 TOTP Secret。

实现要求：

- 使用 Python `cryptography` 库的 `AESGCM`；
- 每次加密生成独立的 12 字节随机 nonce；
- 同一密钥下绝不复用 nonce；
- 使用 AAD 将密文绑定到具体记录和字段；
- 认证标签由 AES-GCM 密文携带；
- 解密认证失败必须返回通用错误，不泄露内部信息。

建议 AAD 格式：

```text
{entity_type}:{entity_id}:{field_name}:v{key_version}
```

例如：

```text
gmail_account:550e8400-e29b-41d4-a716-446655440000:password:v1
```

### 8.3 数据加密密钥

使用 32 字节随机数据密钥，不能由管理员密码直接派生。

生产环境通过只读 Secret 文件挂载：

```text
/run/secrets/data_key_v1
```

并设置：

```text
ACTIVE_DATA_KEY_VERSION=1
```

要求：

- 密钥不写入 PostgreSQL；
- 密钥不提交到 Git；
- 密钥不写入 Docker 镜像；
- 密钥不输出到日志；
- 密钥文件只允许 root 和 API 容器读取；
- 密钥必须单独离线备份；
- 数据库记录保留 `key_version`，为轮换保留能力；
- 应用允许同时读取旧版本密钥和当前写入密钥。

建议配置形式：

```text
/run/secrets/data_key_v1
/run/secrets/data_key_v2
```

应用只使用 `ACTIVE_DATA_KEY_VERSION` 对新数据加密，但可使用所有已配置旧密钥解密历史数据。

### 8.4 密码显示和复制

- 列表接口和普通详情接口绝不返回密码明文或密码密文；
- 显示密码使用独立 `POST` 接口；
- 最近 5 分钟没有重新验证管理员密码时，要求重新输入管理员密码；
- 密码响应设置 `Cache-Control: no-store`；
- 前端使用 mutation 请求，不进入 TanStack Query 缓存；
- 密码只保存在当前组件内存状态；
- 20 秒后自动从界面清除；
- 关闭抽屉、切换路由、页面隐藏、退出或锁定时立即清除；
- 复制后尝试在 20 秒后清空剪贴板，但不得把浏览器剪贴板清理描述为绝对保证；
- 每次显示或复制均写入审计事件。

---

## 9. 身份认证、会话和 CSRF

### 9.1 无注册模式

- 不存在 `/register`；
- 不存在公开管理员创建接口；
- 管理员通过 CLI 初始化；
- 生产初始化命令必须交互式读取密码，避免密码出现在 shell history；
- 初始化后不得保留 Bootstrap 密码环境变量。

建议命令：

```bash
docker compose exec api python -m app.cli create-admin
```

### 9.2 TOTP 二步验证

公网生产环境强制启用 TOTP：

- 首次登录绑定；
- 显示二维码和手工 Secret；
- 验证成功后才启用；
- 生成一次性恢复码；
- 恢复码只展示一次并只保存哈希；
- 重新绑定 TOTP 必须输入当前管理员密码和现有 TOTP，或使用恢复码；
- 开发环境允许通过明确配置临时关闭，生产环境启动时如果关闭应拒绝启动或记录高优先级错误。

### 9.3 服务端 Session

不使用存放在 `localStorage` 的 JWT。

采用高熵随机服务端 Session：

- Cookie 名称：`__Host-gm_session`；
- `HttpOnly=true`；
- `Secure=true`；
- `SameSite=Strict`；
- `Path=/`；
- 不设置 `Domain`；
- Session Secret 至少 256 bit 随机值；
- PostgreSQL 只保存 Session Secret 的 SHA-256 哈希；
- 每次登录和重新验证后轮换 Session Secret；
- 注销后服务端立即撤销 Session。

建议超时：

```text
闲置超时：15 分钟
绝对有效期：12 小时
敏感操作重新验证有效期：5 分钟
```

前端闲置计时器只负责界面锁定，后端必须独立验证 `last_seen_at` 和 `expires_at`。

### 9.4 CSRF

所有修改数据的请求必须验证 CSRF Token。

推荐同步器 Token 模式：

1. Session 创建时生成独立 CSRF Token；
2. 数据库保存 Token 哈希；
3. 登录时将原始 Token 返回给前端内存；页面刷新后，`GET /auth/session` 生成并轮换新 Token，再返回给前端；
4. 前端对 `POST/PATCH/PUT/DELETE` 请求发送 `X-CSRF-Token`；
5. 后端使用常量时间比较验证；
6. Token 不保存到 `localStorage`。

`SameSite=Strict` 不能替代 CSRF Token。

### 9.5 登录防护

同时在 Nginx 和应用层实施：

- Nginx 对登录接口按 IP 限流；
- 应用按 IP 和管理员账号组合记录失败；
- 连续失败采用指数退避；
- 建议 15 分钟内失败 5 次后临时锁定；
- 返回统一错误文案，不区分密码错误和 TOTP 错误；
- 失败事件写入审计日志；
- 可选接入 Fail2ban 封禁持续攻击来源。

隐藏登录路径不能作为主要安全措施。

---

## 10. API 设计

统一前缀：

```text
/api/v1
```

所有 JSON 请求和响应使用 UTF-8。错误响应使用统一结构。

### 10.1 统一错误格式

```json
{
  "error": {
    "code": "ACCOUNT_EMAIL_DUPLICATE",
    "message": "该 Gmail 地址已存在",
    "details": {}
  },
  "request_id": "uuid"
}
```

生产环境不得返回堆栈、SQL、密钥路径或内部异常详情。

### 10.2 认证接口

```http
POST /api/v1/auth/login
POST /api/v1/auth/logout
GET  /api/v1/auth/session
POST /api/v1/auth/reverify
POST /api/v1/auth/totp/setup
POST /api/v1/auth/totp/confirm
POST /api/v1/auth/totp/regenerate-recovery-codes
GET  /api/v1/auth/sessions
DELETE /api/v1/auth/sessions/{session_id}
```

### 10.3 账号接口

```http
GET    /api/v1/accounts
POST   /api/v1/accounts
GET    /api/v1/accounts/{account_id}
PATCH  /api/v1/accounts/{account_id}
DELETE /api/v1/accounts/{account_id}

POST /api/v1/accounts/{account_id}/archive
POST /api/v1/accounts/{account_id}/restore
POST /api/v1/accounts/{account_id}/mark-verified
POST /api/v1/accounts/{account_id}/mark-logged-in
POST /api/v1/accounts/{account_id}/reveal-password
POST /api/v1/accounts/{account_id}/copy-password-event
```

说明：

- `DELETE` 默认软删除；
- `PATCH` 必须提交 `row_version`；
- 版本冲突返回 `409 Conflict`；
- `reveal-password` 必须满足最近重新验证要求；
- `copy-password-event` 只记录客户端复制事件，不传输密码。

### 10.4 查询参数

示例：

```http
GET /api/v1/accounts
  ?search=gmail
  &status=normal
  &purpose=work
  &tag=long_term
  &two_factor_status=enabled
  &registered_from=2026-01-01T00:00:00Z
  &registered_to=2026-12-31T23:59:59Z
  &archived=false
  &sort=-registered_at
  &page=1
  &page_size=30
```

支持排序字段：

```text
account_no
registered_at
last_verified_at
last_login_at
created_at
updated_at
```

`page_size` 默认 30，最大 100。

### 10.5 仪表盘接口

```http
GET /api/v1/dashboard/summary
GET /api/v1/dashboard/registration-trend
GET /api/v1/dashboard/status-distribution
GET /api/v1/dashboard/recovery-email-usage
```

第一版首页可以只调用 `summary`，其他图表接口按 P1 开发。

### 10.6 标签和辅助邮箱

```http
GET    /api/v1/tags
POST   /api/v1/tags
PATCH  /api/v1/tags/{tag_id}
DELETE /api/v1/tags/{tag_id}

GET /api/v1/recovery-emails
GET /api/v1/recovery-emails/{encoded_email}/accounts
```

删除正在使用的标签时，只解除关联，不删除账号。

### 10.7 导入导出

```http
POST /api/v1/imports/csv/preview
POST /api/v1/imports/csv/commit
POST /api/v1/exports/csv
POST /api/v1/exports/encrypted
```

CSV 导入采用两阶段：

1. 预览、字段映射、格式验证和重复检测；
2. 用户确认后提交导入。

导入文件限制：

- 最大 10 MB；
- 只允许 CSV；
- 只在内存或受控临时目录处理；
- 请求结束后立即删除临时文件；
- 不记录文件内容；
- 单次导入使用数据库事务；
- 返回逐行错误结果。

默认 CSV 导出不包含：

- Gmail 密码；
- 手机号；
- 敏感备注；
- TOTP 或恢复码。

带密码的加密导出属于 P1，必须重新验证密码和 TOTP，并以流式方式加密，不得把明文导出文件长期写入服务器磁盘。

### 10.8 审计与运维

```http
GET /api/v1/audit-events
GET /api/v1/system/version
GET /api/v1/system/backup-status
GET /api/v1/health/live
GET /api/v1/health/ready
```

公网 Nginx 只开放必要健康检查；详细运行状态不得匿名公开。

---

## 11. 前端技术设计

### 11.1 技术栈

```text
React
TypeScript（strict）
Vite
React Router
TanStack Query
TanStack Table
React Hook Form
Zod
Tailwind CSS
shadcn/ui
Lucide Icons
```

图表可在 P1 使用 Recharts。

### 11.2 状态管理原则

| 状态 | 方案 |
|---|---|
| 服务端数据 | TanStack Query |
| 搜索和筛选 | URL Search Params |
| 表单 | React Hook Form |
| 组件开关、抽屉、弹窗 | React 本地状态 |
| 少量全局 UI 状态 | Zustand，仅确有必要时加入 |

第一版不使用 Redux。

### 11.3 API Client

FastAPI 自动生成 OpenAPI 3.1 Schema。使用 Hey API 或等效工具生成 TypeScript Client，禁止前后端重复手写模型。

建议脚本：

```bash
pnpm generate:api
```

生成目录只由脚本更新，不手工修改。

### 11.4 前端目录建议

```text
frontend/
├── src/
│   ├── api/
│   │   ├── generated/
│   │   ├── client.ts
│   │   └── query-keys.ts
│   ├── app/
│   │   ├── router.tsx
│   │   └── providers.tsx
│   ├── components/
│   │   ├── accounts/
│   │   ├── dashboard/
│   │   ├── layout/
│   │   └── ui/
│   ├── features/
│   │   ├── auth/
│   │   ├── accounts/
│   │   ├── audit/
│   │   ├── import-export/
│   │   ├── recovery-emails/
│   │   ├── settings/
│   │   └── tags/
│   ├── hooks/
│   ├── lib/
│   ├── pages/
│   ├── styles/
│   ├── types/
│   └── main.tsx
├── public/
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
└── vite.config.ts
```

### 11.5 UI 设计要求

- 默认简体中文；
- 桌面端优先，兼容常见笔记本分辨率；
- 视觉风格简洁、专业、信息密度适中；
- 表格区域充分利用横向空间；
- 密码永不直接显示在列表中；
- 危险操作使用明确确认框；
- 永久删除要求重新验证；
- 状态颜色必须同时配合文字，不只依赖颜色；
- 所有可交互控件支持键盘操作；
- 为 Dialog、Sheet、Table 和 Toast 提供可访问性标签；
- 不使用 `dangerouslySetInnerHTML` 渲染用户输入；
- 不引入第三方 CDN 脚本、字体或统计脚本；
- 所有资源由本系统域名提供。

---

## 12. 后端技术设计

### 12.1 技术栈

```text
FastAPI
Pydantic
SQLAlchemy
Alembic
psycopg 3
pwdlib[argon2]
cryptography
pyotp 或等效成熟 TOTP 库
pytest
```

第一版使用同步 SQLAlchemy Session 即可，不为了低并发单用户应用强制引入全异步数据库访问。

### 12.2 后端目录建议

```text
backend/
├── app/
│   ├── main.py
│   ├── api/
│   │   ├── dependencies.py
│   │   └── v1/
│   │       ├── accounts.py
│   │       ├── audit.py
│   │       ├── auth.py
│   │       ├── dashboard.py
│   │       ├── import_export.py
│   │       ├── recovery_emails.py
│   │       ├── system.py
│   │       └── tags.py
│   ├── core/
│   │   ├── config.py
│   │   ├── encryption.py
│   │   ├── errors.py
│   │   ├── logging.py
│   │   ├── security.py
│   │   └── sessions.py
│   ├── db/
│   │   ├── base.py
│   │   └── session.py
│   ├── models/
│   ├── repositories/
│   ├── schemas/
│   ├── services/
│   ├── utils/
│   └── cli/
├── alembic/
├── tests/
├── pyproject.toml
└── Dockerfile
```

### 12.3 分层约束

- API Router 负责 HTTP 输入输出；
- Service 负责业务规则和事务边界；
- Repository 负责查询；
- Encryption Service 负责敏感字段加解密；
- ORM Model 不直接暴露给响应；
- Pydantic Response Model 明确列出可返回字段；
- 列表和普通详情 Schema 中不得出现密文字段；
- 禁止在 Router 中散落加密和权限逻辑。

### 12.4 日志

使用结构化日志，包含：

- 时间；
- 日志级别；
- request_id；
- 路径；
- 状态码；
- 耗时；
- 事件类型。

必须进行敏感字段脱敏。不得记录请求体中的密码、TOTP、手机号、备注原文或 Session Cookie。

---

## 13. Monorepo 结构

```text
gmail-account-manager/
├── frontend/
├── backend/
├── infra/
│   ├── nginx/
│   │   └── accounts.example.com.conf
│   ├── backup/
│   ├── systemd/
│   └── docker-compose.yml
├── scripts/
│   ├── deploy.sh
│   ├── backup.sh
│   ├── restore.sh
│   └── generate-secrets.sh
├── docs/
├── .env.example
├── .gitignore
├── Makefile
└── README.md
```

---

## 14. 部署架构

### 14.1 推荐拓扑

下图为通用单机参考架构。额外入口代理、私网链路和异地备份节点由运营者在私有配置库规划；公开示例不记录实际部署拓扑，见 `docs/public-repository.md`。

```text
Internet
   │
   │ HTTPS 443
   ▼
Host Nginx + Certbot
   ├── /              → React dist 静态文件
   └── /api/          → 127.0.0.1:8000 FastAPI
                              │
                              ▼
                     Docker internal network
                              │
                              ▼
                         PostgreSQL
```

推荐把 Nginx 和 Certbot安装在 Linux 宿主机上，Docker Compose 运行：

```text
api
postgres
backup
```

也可以将 Nginx 容器化，但第一版以宿主机 Nginx 为标准部署方式，减少证书续期和静态文件发布复杂度。

### 14.2 网络和端口

公网只开放：

```text
80/tcp    仅用于 ACME 和跳转 HTTPS
443/tcp   正式访问
22/tcp    SSH，应使用密钥登录并限制来源或强化防护
```

不得公开：

```text
5432/tcp  PostgreSQL
8000/tcp  FastAPI
```

FastAPI 只绑定：

```text
127.0.0.1:8000
```

PostgreSQL 只在 Docker 内部网络中可见。

### 14.3 DNS

为以下地址创建 A 记录；存在 IPv6 时再创建 AAAA 记录：

```text
accounts.example.com → 云服务器公网 IP
```

证书签发前必须确认 DNS 已解析到正确服务器。

### 14.4 TLS

- 使用 Certbot + Let’s Encrypt；
- HTTP 全部 301 跳转 HTTPS；
- 自动续期；
- 上线前运行续期演练；
- 禁止通过 HTTP 提交任何凭证；
- 不允许忽略证书错误继续使用。

### 14.5 Nginx 基线配置

以下仅作为 Codex 生成正式配置时的基线，部署前必须通过 `nginx -t`。

在 `http` 上下文定义限流区：

```nginx
limit_req_zone $binary_remote_addr zone=login_limit:10m rate=5r/m;
limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;
```

站点配置示意：

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name accounts.example.com;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name accounts.example.com;

    ssl_certificate /etc/letsencrypt/live/accounts.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/accounts.example.com/privkey.pem;

    server_tokens off;
    client_max_body_size 10m;

    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "no-referrer" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'" always;

    root /srv/example/gmail-manager/frontend/dist;
    index index.html;

    location = /api/v1/auth/login {
        limit_req zone=login_limit burst=5 nodelay;

        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Request-ID $request_id;
    }

    location /api/ {
        limit_req zone=api_limit burst=30 nodelay;

        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Request-ID $request_id;

        proxy_no_cache 1;
        proxy_cache_bypass 1;
    }

    location /assets/ {
        try_files $uri =404;
        expires 1y;
    }

    location / {
        try_files $uri $uri/ /index.html;
        expires -1;
    }
}
```

注意：

- `limit_req_zone` 必须位于 Nginx `http` 上下文；
- 如果 Nginx 版本对 HTTP/2 监听语法有不同要求，应按已安装版本调整；
- FastAPI 必须只信任来自本机 Nginx 的代理头；
- 不启用 API 响应缓存；
- 敏感接口由 FastAPI 额外返回 `Cache-Control: no-store`；
- CSP 上线后应通过浏览器控制台检查，不要为方便直接关闭。

---

## 15. Docker Compose 基线

运行服务：

```text
api
postgres
backup
```

要求：

- 固定镜像主要版本和精确依赖锁文件；
- `api` 使用非 root 用户；
- 容器不使用 `privileged`；
- PostgreSQL 不映射宿主机端口；
- API 仅映射到 `127.0.0.1:8000`；
- 配置健康检查；
- 数据库使用命名 Volume；
- Secret 使用只读文件挂载；
- 日志配置轮换，避免磁盘耗尽；
- 容器自动重启策略使用 `unless-stopped`；
- 数据库启动完成后再运行 Alembic Migration；
- Migration 失败时不得启动新版本 API。

Compose 结构示意：

```yaml
services:
  api:
    build: ../../backend
    restart: unless-stopped
    ports:
      - "127.0.0.1:8000:8000"
    depends_on:
      postgres:
        condition: service_healthy
    secrets:
      - data_key_v1
      - db_password
    environment:
      DATABASE_PASSWORD_FILE: /run/secrets/db_password
    networks:
      - app_internal

  postgres:
    image: postgres:18
    restart: unless-stopped
    expose:
      - "5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    secrets:
      - db_password
    environment:
      POSTGRES_DB: gmail_manager
      POSTGRES_USER: gmail_manager
      POSTGRES_PASSWORD_FILE: /run/secrets/db_password
    networks:
      - app_internal

  backup:
    build: ./backup
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    secrets:
      - db_password
    environment:
      POSTGRES_PASSWORD_FILE: /run/secrets/db_password
    networks:
      - app_internal

networks:
  app_internal:
    driver: bridge

volumes:
  postgres_data:

secrets:
  data_key_v1:
    file: /opt/example/gmail-manager/secrets/data_key_v1
  db_password:
    file: /opt/example/gmail-manager/secrets/db_password
```

正式实现时补齐数据库凭证 Secret、健康检查、资源限制和备份挂载。

---

## 16. 配置和 Secret

### 16.1 普通配置

`.env` 可以保存非敏感配置：

```text
APP_ENV=production
APP_NAME=Gmail Account Manager
APP_BASE_URL=https://accounts.example.com
ALLOWED_HOSTS=accounts.example.com
CORS_ORIGINS=
SESSION_IDLE_MINUTES=15
SESSION_ABSOLUTE_HOURS=12
REAUTH_WINDOW_MINUTES=5
ACTIVE_DATA_KEY_VERSION=1
DEFAULT_PAGE_SIZE=30
MAX_PAGE_SIZE=100
MAX_IMPORT_SIZE_MB=10
```

同源部署时不开放通配 CORS。生产环境应禁用或仅允许精确同源。

### 16.2 Secret

以下内容必须使用 Secret 文件或权限严格的宿主机文件：

```text
PostgreSQL 用户密码
数据加密密钥
备份加密接收方或密钥
```

不得提交：

```text
.env
任何 Secret 文件
真实数据库备份
导入 CSV
生产日志
证书私钥
```

仓库只提供：

```text
.env.example
secrets/README.md
```

---

## 17. CSV 导入导出

### 17.1 建议 CSV 字段

```text
account_no
gmail_email
password
registered_at
recovery_email
phone
status
two_factor_status
last_login_at
last_verified_at
password_changed_at
purpose
tags
notes
```

`account_no` 导入时可为空，由系统生成。

### 17.2 重复处理策略

预览阶段允许选择：

```text
skip     跳过已存在账号
update   更新已存在账号
error    遇到重复则阻止整批提交
```

默认选择 `skip`。

规范化后的 Gmail 地址是重复判断依据。

### 17.3 导出规则

默认普通 CSV：

- 不含 Gmail 密码；
- 不含完整手机号；
- 不含敏感备注；
- 不含管理员和 Session 数据；
- 文件名带 UTC 时间戳。

示例：

```text
gmail-accounts-2026-11-23T221800Z.csv
```

敏感导出属于 P1：

- 必须重新输入管理员密码和 TOTP；
- 必须使用标准加密库和有版本的文件格式；
- 明文只存在于进程内存；
- 以流式方式返回加密文件；
- 服务端不保留明文临时文件；
- 写入审计事件。

---

## 18. 备份与恢复

### 18.1 备份内容

必须备份：

1. PostgreSQL 数据库；
2. 数据加密密钥；
3. Session/CSRF Secret 可不用于历史数据恢复，但应备份部署配置；
4. Docker Compose 和 Nginx 配置；
5. Alembic Migration；
6. 应用版本信息。

数据库与数据加密密钥不得只保存在同一个未加密位置。

### 18.2 备份方式

每天运行 `pg_dump`，随后使用 `age` 或等效成熟工具对备份文件二次加密。

示例文件名：

```text
gmail-manager-db-2026-11-23T020000Z.sql.zst.age
```

建议保留策略：

```text
最近 7 天：每日一份
最近 8 周：每周一份
最近 12 个月：每月一份
```

至少一份备份必须存放在另一台服务器、对象存储、NAS 或离线磁盘中。

### 18.3 恢复要求

提供 CLI 脚本：

```text
scripts/backup.sh
scripts/restore.sh
```

恢复流程必须：

1. 验证备份文件可解密；
2. 验证 PostgreSQL Dump 完整性；
3. 停止写入；
4. 恢复到临时数据库；
5. 运行一致性检查；
6. 确认数据加密密钥可解密抽样记录；
7. 再切换为正式数据库。

至少每季度做一次恢复演练。只存在备份文件但从未测试恢复，不视为完成备份建设。

---

## 19. 测试要求

### 19.1 后端单元测试

必须覆盖：

- Gmail 地址规范化；
- 重复检测；
- AES-GCM 加密和解密；
- AAD 不匹配时解密失败；
- 错误密钥和错误 nonce；
- Argon2id 密码验证；
- TOTP 验证；
- Session 创建、过期、撤销和轮换；
- CSRF Token 验证；
- 辅助邮箱 XOR 规则；
- 状态转换；
- 乐观锁冲突；
- CSV 行校验。

### 19.2 API 集成测试

必须覆盖：

- 未登录访问返回 401；
- CSRF 缺失返回 403；
- 登录成功和失败；
- TOTP 错误；
- 账号 CRUD；
- 列表不返回密码或密文；
- 敏感密码接口要求重新验证；
- 权限和 Session 过期；
- 重复 Gmail 返回 409；
- 版本冲突返回 409；
- 软删除和恢复；
- 导入预览和提交；
- 审计事件产生。

### 19.3 前端测试

使用 Vitest、Testing Library 和 Playwright 或等效工具。

覆盖：

- 登录流程；
- TOTP 绑定；
- 列表筛选和分页；
- 新增和编辑表单；
- 详情抽屉；
- 密码显示和自动隐藏；
- 版本冲突提示；
- 归档和删除确认；
- CSV 导入预览；
- Session 超时自动回到登录页。

### 19.4 安全测试

- 检查生产响应无调试堆栈；
- 检查 Cookie 属性；
- 检查 CSRF；
- 检查 Nginx 安全响应头；
- 检查 API 无通配 CORS；
- 检查 PostgreSQL 未公开端口；
- 检查前端构建物无 Secret；
- 检查日志中无密码、Token 和密钥；
- 检查依赖漏洞；
- 检查上传大小限制；
- 检查登录限流；
- 检查备份可恢复。

---

## 20. 验收标准

第一版上线前必须满足：

1. `accounts.example.com` 通过有效 HTTPS 访问；
2. HTTP 自动跳转 HTTPS；
3. 无公开注册接口；
4. 管理员密码使用 Argon2id；
5. 生产环境强制 TOTP；
6. Session 使用 `HttpOnly + Secure + SameSite=Strict` Cookie；
7. 所有修改请求验证 CSRF；
8. 登录接口同时有 Nginx 和应用层限流；
9. PostgreSQL 和 FastAPI 内部端口未向公网暴露；
10. Gmail 密码、手机号和敏感备注以 AES-256-GCM 加密；
11. 数据加密密钥不在数据库、代码仓库或镜像内；
12. 列表和普通详情接口不返回密码或密文；
13. 查看密码需要最近重新验证；
14. Gmail 规范化地址不可重复；
15. 支持新增、编辑、筛选、归档、软删除和恢复；
16. 支持辅助邮箱文本和账号关联两种模式；
17. 支持状态、用途、标签和时间筛选；
18. 支持 CSV 导入预览和提交；
19. 默认导出不包含敏感字段；
20. 自动备份成功，且至少完成一次恢复演练；
21. 日志不包含敏感明文；
22. Alembic Migration 可从空数据库完整执行；
23. 后端、前端和关键 E2E 测试通过；
24. README 包含完整部署、升级、备份和恢复步骤；
25. 生产构建关闭调试模式和公开 Swagger 文档，或为文档增加管理员保护。

---

## 21. 推荐开发阶段

### 阶段 0：工程骨架

- 建立 Monorepo；
- React/Vite 初始化；
- FastAPI 初始化；
- PostgreSQL 和 Alembic；
- Docker Compose；
- 基础 CI；
- OpenAPI TypeScript Client 生成。

### 阶段 1：认证和安全基础

- 管理员 CLI 初始化；
- Argon2id；
- TOTP 和恢复码；
- 服务端 Session；
- CSRF；
- 登录限流；
- 审计日志；
- 数据加密服务。

不得先用临时明文方案开发后再“补安全”。敏感字段从第一条 Migration 开始就按密文结构设计。

### 阶段 2：账号核心功能

- 数据模型；
- CRUD；
- Gmail 规范化；
- 辅助邮箱关联；
- 标签；
- 详情抽屉；
- 密码显示和复制；
- 乐观锁。

### 阶段 3：管理体验

- 统计卡片；
- 服务端搜索、筛选、排序和分页；
- 批量状态和标签操作；
- 辅助邮箱页面；
- 闲置自动锁定；
- 响应式细节和无障碍。

### 阶段 4：迁移与运维

- CSV 导入预览；
- 非敏感 CSV 导出；
- 自动备份；
- 恢复脚本；
- 健康检查；
- 日志轮换；
- 管理员 Session 页面。

### 阶段 5：公网部署和加固

- DNS；
- Nginx；
- Certbot；
- HTTPS；
- 安全响应头；
- 防火墙；
- 登录攻击测试；
- 备份恢复演练；
- 生产验收。

---

## 22. Codex 实施约束

Codex 开发时必须遵守：

1. 先阅读本文件并生成实施计划；
2. 不擅自增加多用户、微服务或复杂基础设施；
3. 不用 JWT + `localStorage` 替换服务端 Session；
4. 不以 Base64、Fernet 默认封装或数据库明文代替明确的 AES-256-GCM 设计；
5. 不自行编写底层密码算法；
6. 不在任何列表或普通详情响应中加入密码密文；
7. 不在日志、测试快照和示例数据中放真实凭证；
8. 所有数据库修改都通过 Alembic Migration；
9. 所有 API 都声明 Pydantic Request/Response Schema；
10. 从 FastAPI OpenAPI 生成前端 TypeScript Client；
11. 所有敏感操作必须有服务端权限和重新验证检查，不能只靠前端隐藏按钮；
12. 每个阶段同步更新 README、测试和 `.env.example`；
13. 生产配置默认安全，开发环境的弱化选项必须显式开启；
14. 依赖必须锁定，禁止在生产镜像使用不固定的 floating tag；
15. 完成后提供部署、升级、备份、恢复和密钥丢失说明。

---

## 23. 默认假设

除非后续明确修改，Codex 按以下假设实现：

- 示例域名：`accounts.example.com`，部署时在私有配置中替换；
- 操作系统：受支持的 Debian/Ubuntu LTS；
- 单服务器部署；
- 单管理员；
- 简体中文界面；
- Windows 和 macOS 最新主流浏览器；
- 数据库存储 UTC，前端显示浏览器时区；
- PostgreSQL 18.x 作为保守生产基线；
- React、FastAPI、SQLAlchemy 等使用开发时稳定版本，并锁定精确版本；
- Nginx 运行在宿主机；
- React 静态文件由 Nginx 直接提供；
- FastAPI 和 PostgreSQL 运行在 Docker Compose；
- 不使用 Tailscale；
- 不使用 Cloudflare Access；
- 不依赖第三方 CDN；
- 生产环境必须启用 TOTP。

---

## 24. 官方参考资料

- FastAPI：容器部署与 Docker
  - https://fastapi.tiangolo.com/deployment/docker/
- FastAPI：由 OpenAPI 生成 TypeScript SDK
  - https://fastapi.tiangolo.com/advanced/generate-clients/
- Nginx：请求限流模块
  - https://nginx.org/en/docs/http/ngx_http_limit_req_module.html
- Nginx：反向代理模块
  - https://nginx.org/en/docs/http/ngx_http_proxy_module.html
- Nginx：响应头模块
  - https://nginx.org/en/docs/http/ngx_http_headers_module.html
- Certbot：Nginx 与证书管理
  - https://eff-certbot.readthedocs.io/en/stable/using.html
- OWASP：Password Storage Cheat Sheet
  - https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- OWASP：Session Management Cheat Sheet
  - https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- OWASP：Cross-Site Request Forgery Prevention Cheat Sheet
  - https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
- OWASP：Cryptographic Storage Cheat Sheet
  - https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html
- OWASP：Multifactor Authentication Cheat Sheet
  - https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html
- PostgreSQL：版本策略
  - https://www.postgresql.org/support/versioning/

---

## 25. 最终技术基线

```text
Public URL
└── https://accounts.example.com

Host
├── Nginx
├── Certbot
└── Firewall

Frontend
├── React
├── TypeScript
├── Vite
├── Tailwind CSS
├── shadcn/ui
├── TanStack Query
├── TanStack Table
├── React Hook Form
└── Zod

Backend
├── FastAPI
├── Pydantic
├── SQLAlchemy
├── Alembic
├── psycopg 3
├── Argon2id
├── AES-256-GCM
├── Server-side Session
├── CSRF Protection
└── TOTP MFA

Storage
├── PostgreSQL
├── Encrypted sensitive fields
├── Encrypted off-site backups
└── Versioned data encryption keys
```

该基线兼顾了 UI 可塑性、跨平台访问、数据管理效率和公网部署的必要安全性。后续开发应以本文件为需求和架构基准。
