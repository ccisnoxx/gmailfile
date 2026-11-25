# 安全决策

## 阶段 0 已落实

- 生产默认启用 TOTP，禁止关闭 TOTP、开启 debug、公开 OpenAPI/Swagger、通配主机或跨域。
- 阶段 0 交付时仅有最小健康接口；当前认证实现在下一节记录，阶段 2 已开放受完整认证保护的账号接口，不提供临时明文或认证绕过入口。
- 所有敏感存储从首条 Alembic 迁移开始使用 ciphertext/nonce/key_version；无可写的明文密码/手机号/备注列。
- 管理员密码与恢复码只有 hash 列。Session/CSRF Secret 只有 32 字节 hash 列。
- 数据库保证最多一名管理员、规范化邮箱唯一、辅助邮箱 XOR/非自身、枚举、归档一致性及 row_version 下限。
- API 使用独立非超级用户数据库角色；迁移使用独立 owner 角色。Secret 不进入镜像、仓库和环境示例。
- API 启动校验密钥长度与迁移版本；未迁移或数据库不可用时启动失败，迁移完成后才启动新 API。
- API 错误只返回通用中文错误和 request_id；不回显 Pydantic input、SQL 或异常消息；访问日志不含请求体、Cookie 和查询串。
- 代理头默认完全不信任。阶段 5 根据实际宿主机/容器网络配置精确信任来源，不设置 `forwarded-allow-ips=*`。
- PostgreSQL 18 使用 `/var/lib/postgresql` 持久卷；镜像和依赖使用精确版本。

## 阶段 1 已实现的安全合同（验证方法见 validation.md）

- 使用锁定版本 pwdlib 推荐 Argon2id；正确验证时升级过时哈希。CLI 仅从真实 TTY 隐藏输入，不允许 getpass 回显降级或重复初始化。
- 首次密码验证、恢复码登录进入 `mfa_pending`。恢复登录立即撤销其他会话；绑定确认后提升权限并替换整批恢复码。
- TOTP 用 PyOTP 验证前后各一个时间步，持久化已接受时间步防重放。候选 Secret 绑定到具体 Session，10 分钟过期；未确认不替换原因子。
- 恢复码每批 10 个，每个 128 bit 随机熵，只有生成响应含原文；数据库保存 SHA-256，消费使用 `used_at IS NULL` 的原子 UPDATE。
- Session Secret 和 CSRF 各自 256 bit 随机熵，只保存哈希并常量时间比较。默认 15 分钟闲置、12 小时绝对过期；重新验证不延长绝对寿命。
- 预会话 10 分钟，登录成功后删除并创建新认证 Session。登录/重新验证/绑定完成轮换 Secret 与 CSRF；刷新仅轮换 CSRF，不更新 last_seen。
- 所有修改接口（含登录、绑定、注销）验证同步器 CSRF；校验 Origin，拒绝 Fetch Metadata `cross-site` 和 `same-site`，防兄弟子域触发刷新轮换。
- 生产强制 `__Host-gm_session` 安全 Cookie；显式本机 HTTP 开发例外使用不同名称 `gm_dev_session`。开发关闭 MFA 遗留会话切回强制模式后自动降为受限态。
- 敏感操作窗口默认且最多 5 分钟。重绑最终确认也检查窗口；改密撤销全部会话，重绑确认/恢复码重生成撤销其他会话。
- IP 和管理员全局分别记录退避：15 分钟窗口，1/2/4/8 秒，第 5 次失败锁 15 分钟。覆盖所有密码/MFA/恢复码实际验证入口；返回统一提示。Nginx 层在阶段 5。
- 登录、TOTP 绑定/确认、恢复码消费/重生成、改密、重新验证、Session/CSRF 轮换、注销和会话撤销共用 PostgreSQL 事务级锁；闲置时限修改也在锁内执行。先取锁再读取认证状态，锁持有至该状态转换事务结束。普通认证校验、活动续期、账号/标签、CSV 和运维查询不获取全局认证锁。已知认证失败提交失败记录/审计；未知异常或解密失败回滚，不把失败转换为成功。
- AESGCM 使用独立随机 12 字节 nonce、32 字节密钥、实体/ID/字段/版本 AAD；读所有已配置版本、当前版本写。未知密钥、认证失败统一响应。
- 审计只接受内部事件名和白名单 operation，不接收任意请求 metadata，不保存凭据或原始 User-Agent。
- 前端凭据/Token/二维码/恢复码仅内存，不进入 Query 缓存。提交清空输入；隐藏、退出点击和到期立即清除敏感展示，并拦截晚到的展示响应。
- 前端计时使用服务器时间差；到期重查不能重新启用同一会话并触发循环。CSRF 失效明确要求刷新，不自动重放修改操作。

## 阶段 2 已实现

- 账号和标签服务复用认证校验及请求事务，不持有全局认证锁；GET 要求完整认证，修改还验证 CSRF；MFA 受限态不能访问。
- 账号/标签修改与 CSV 提交使用独立业务写锁，保留跨账号辅助邮箱校验、标签关联变更及版本递增的串行合同；不阻塞普通查询、导出、CSV 预览或认证状态转换。活动时间在事务收尾以数据库 `GREATEST` 单调更新，避免长请求提前持有 Session 行锁或较早请求覆盖较新活动。
- 所有既有账号修改通过 `UPDATE ... WHERE id AND row_version ... RETURNING` 原子检查并递增版本；标签删除关联时也递增账号版本。
- Gmail 规范化用独立字段，数据库唯一约束最终裁决为统一 409；软删除不释放唯一性。辅助邮箱 XOR/自身/同邮箱规则在边界与业务层校验。
- 账号/标签失败使用独立业务异常，回滚整个事务（含 CAS 与关联），不套用认证失败的提交语义。
- 密码、手机号、备注使用既有 AES-GCM，AAD 为 `gmail_account:<id>:<field>:v<version>`；编辑省略密码时不触碰原值。
- 列表不含手机号/备注原文，详情在完整认证后解密这两项；两类白名单响应均无密码和任何密文字段。所有 API no-store。
- 独立密码 POST 与复制事件 POST 要求最近重新验证；复制事件输入为空且拒绝额外字段，不接收密码。
- 审计扩展内部事件/operation 白名单与 account_id，不存邮箱、手机号、备注、密码或任意请求 metadata。
- 密码 mutation 的数据和变量不含明文；展示仅组件内存，20 秒清理与审计网络等待独立。隐藏/关闭/换路由/退出/锁定使代次失效。
- 详情重新验证也检查组件代次/挂载状态，晚到响应不能重新启用认证 UI。剪贴板只在仍为本次复制内容时尽力清理；写入本身晚到则立即尝试清空。
- 邮箱语法采用锁定的 email-validator 2.3.0（关闭 DNS/投递检查），原始显示值不被库的标准化结果覆盖。依据：[上游说明](https://github.com/JoshData/python-email-validator)。

## 阶段 3 已实现

- 列表采用有界服务端分页；搜索参数绑定、LIKE 字面量转义，排序字段来自 Pydantic 白名单，空值末尾并以 UUID 稳定排序。统计和辅助邮箱接口沿用完整认证与 no-store，不返回密码/密文。
- 批量输入最多 100 个唯一账号，每条 ID/row_version；复用既有 CAS 和归档规则，所有修改/关联/逐条审计处于同一事务。业务失败仍是 AccountError，整批回滚，业务错误 details 仅包含可定位的账号 ID 和预期版本；请求行校验只返回安全字段路径和行索引，不回显输入或任意键名。批量标签以并集追加；不改未选记录。
- 统计全局口径、异常集合、UTC 月份边界和辅助邮箱按地址分组由规格、服务实现和测试共同约束，不能以实现便利改变含义。没有新增数据库结构或迁移。
- 所有 GET（包括账号/标签/统计/辅助选择）不更新 last_seen。交互活动 POST 验证 Session 和 CSRF，可服务 MFA 受限界面的正常交互，但不提升权限、不轮换 Token、不延长 expires_at；过期后仍拒绝。
- 客户端只在可信交互时发送节流活动请求，无定时心跳、无后台轮询续期。同一会话的已知绝对截止及本地用户闲置截止不会因延迟的活动/重新验证响应而后移。
- 锁定/退出/认证失败清缓存并移除敏感组件；查询传递 AbortSignal，账号操作和重新验证使用代次隔离。页面隐藏仍立即清理密码/表单/详情；保留原来的 20 秒密码与晚到重新验证隔离。
- 界面锁定尝试注销服务端 Session；已被服务端闲置淘汰的 Session 返回 401，后续预会话用于重新登录。网络或 CSRF 失败不会自动重放修改请求。只有明确业务错误可称整批未提交，连接中断显示结果未知。

## 阶段 4 已实现

- CSV 使用受限原始 text/csv body，无长期文件或 multipart 临时 spool；实际字节在入口限 10 MiB。标准解析器严格 UTF-8/BOM，错误不回显输入。
- 服务端保存一次性、会话绑定、10 分钟的内容摘要/映射/策略/ID版本凭据；不保存文件、原始表头、敏感值。提交在业务写锁内读取和消费凭据，保证并发请求也只能消费一次；重传原文件、重新解析、重查主记录/辅助关联版本，复用原子 CAS、AES-GCM 与同一事务的标签/审计。
- update 未映射保留、空密码保留；软删除不隐式恢复；文件内首条优先，error 则整批拒绝。网络/未知错误为结果未知，不重放。
- 导出显式白名单、全部匹配而非一页、标准 CSV/BOM 与公式前缀处理，不提供敏感下载。
- Session 管理完整认证、修改 CSRF/重新验证、不 touch last_seen；响应无 Secret/hash/CSRF。审计只读白名单字段和 operation，不直接返回 JSON metadata。
- 全局闲置修改不改变 last_seen/expires_at，先撤销按旧阈值已过期的会话，调大不复活 Cookie；前端刷新重新取得边界，缩短可能立即退出。
- pg_dump custom gzip 流直接 age；配置 tar.gz 流直接 age。仅完整流/退出状态/fsync 成功才发布；失败状态、异地失败、本地成功时间分别记录。备份容器无应用数据密钥/age 私钥。
- 本地保留 7 日/8 周/12 月并集及最新/最近演练副本；只处理带本项目标记的精确文件清单。异地单成功副本先验证新传输再替换旧，失败不删除最后成功副本。
- 恢复全量消费 age 认证流、新库单事务、每表行数/业务一致性、多版本/字段抽样解密；不输出样本。
- 切换不用数据库改名/删除，改为明确确认后在禁止新连接边界内最终验证、修复角色权限、撤销恢复认证状态，再原子更新指定部署配置，保留旧库和原配置；失败重开准入，不自动恢复生产流量。
- 每日唯一责任为专用 backup 服务；手工成功、服务启用、自然触发、异地取回与恢复分别记录，不互相替代。

### 受限 SSH 与隔离验收

- 私网传输和独立 Ed25519 身份分别承担网络通道与进程授权；不复制个人 root 身份。
- 接收账号仅持有项目数据目录，home、公钥入口及程序由 root 持有；公钥固定来源、restrict 和 python3 -I 强制命令。
- 源机准备脚本先检查 Linux/root 和精确路由来源，再创建文件/生成密钥；私钥只留源机，管理连接不转发 Agent。
- USTAR 流只含三个明确普通文件，不通用解包；约束类型、大小、磁盘余量和连接时间。接收端只核对密文，不持解密私钥。
- 新 current 发布/fsync 后再次验证，成功才删 previous；失败保留旧副本，失去确认先查询，不自动重放。
- Linux 容器实际验证 UID/GID 与只读挂载；SSH 私钥 0600，不能套用普通 Secret 的 0444。
- 隔离验收使用独立项目/数据库/卷/网络，无宿主机端口或自动重启。独立 restore 目标不持 SSH 身份，默认只显示帮助。
- 调度控制器只观察既有 schedule；截止后停止本批所有运行成员并复查，单批结果不可覆盖，不自动重放。详见 [验收指南](validation.md)。

## 阶段 2—5 必须持续执行

生产代理链由私有实例配置确定，只信任经过实际 socket peer 核验的精确来源；禁止通配或整段 Docker 网段信任。
Nginx 覆盖 XFF 并清除 Forwarded，公开示例中的 PROXY protocol 链路是可选设计，不是现场拓扑。
证书使用独立配置及续期任务；不读取其他项目凭据、不接管共享任务。Secret 新生成，既有异地私钥不重生成，常驻 backup 不持解密私钥/数据密钥。

- 列表/详情白名单响应无密码及密文字段；密码独立 POST、重新验证、no-store、mutation、不进入 Query 缓存。
- 密码仅组件内存，20 秒或隐藏页面/关闭抽屉/换路由/锁定/退出即清除；复制审计不传密码，剪贴板清理尽力而为。
- 不使用 localStorage JWT，不在快照、示例或测试中保存真实凭据；不通过 HTML 注入渲染用户输入，不加载第三方 CDN。
- 修改使用原子 row_version 检查，批量和 CSV 不绕过；软删除不释放邮箱唯一性。
- CSV 10 MB、两阶段、事务、逐行错误、临时文件清理、无内容日志；默认导出字段白名单并防公式注入。
- 带密码导出只在 P1 实现，密码+TOTP 再验证，标准版本化流式加密，不落明文文件。
- 数据库每日 dump 后 age 加密，7 日/8 周/12 月保留、至少一份异地、数据密钥单独离线保存。
- 恢复验证解密与 dump、停止写入、临时库恢复、一致性检查、抽样解密，然后切换；每季度演练。
- 生产同源 HTTPS、续期演练、安全响应头/CSP、双层限流、受限健康检查、端口/日志/构建物/依赖检查。
- root 失陷可能获取密文和密钥，这是规格接受的边界。全部历史数据密钥丢失后，管理员密码重置不能恢复密文。

## 参考与兼容决策

- PostgreSQL 官方镜像 18 的 PGDATA/Volume：<https://hub.docker.com/_/postgres>
- FastAPI OpenAPI 客户端：<https://fastapi.tiangolo.com/advanced/generate-clients/>
- Hey API fetch：<https://heyapi.dev/docs/openapi/typescript/clients/fetch>
- TypeScript 固定 6.0.3：实测 7.0.2 缺少 Hey API 0.99.0 使用的经典 Compiler API，生成器报 AnyKeyword 错误。
  上游问题：<https://github.com/hey-api/hey-api/issues/4235>；不是通过手写模型绕过生成。

## 后续安全加固（溯源、防篡改审计、密码策略与流式导出）

- **发布溯源与基础镜像摘要固定**：应用版本、迁移 head、镜像坐标与基础镜像摘要集中维护在 `backend/app/core/release_meta.py`；Dockerfile、Compose 与 BuildKit 均固定到 `image@sha256:<digest>`。`scripts/package-release.py` 从真实 Git 仓库读取 `git_commit`、`git_tree`、`git_tag`、`git_tag_signed`、`working_tree_clean`，生成确定性 CycloneDX 1.5 SBOM（`sbom.cdx.json`）与规范化源码归档摘要（`source_archive_sha256`），默认拒绝未提交工作区。`scripts/deploy.py` 在构建和部署前核验洁净标记、源码归档摘要和 SBOM 摘要，并将这些溯源字段写入 OCI 镜像标签，部署前校验镜像 ID 与标签一致，建立源码到镜像的强绑定。
- **防篡改审计日志**：迁移 `0004` 为 `audit_events` 增加单调无间隙 `seq`、`prev_hash`、`event_hash`（SHA-256 哈希链），由 `SECURITY DEFINER` 的 `BEFORE INSERT` 触发器在事务级锁内计算，并由 `BEFORE UPDATE OR DELETE` / `BEFORE TRUNCATE` 触发器禁止任何篡改、删除或截断。撤销 `gm_app` 在 `audit_events` 上的 `UPDATE/DELETE/TRUNCATE` 权限，同时提供仅含 `INSERT` 权限的独立角色 `gm_audit_writer`（新库由 `init-roles.sh` 创建，既有库由 `upgrade-audit-role.sh` 升级）。事务提交后将白名单审计记录外发至 `gmail_manager.audit` JSON 流与可选远程 Syslog（`AUDIT_SYSLOG_ADDRESS`）；支持 `GET /api/v1/audit-events/integrity`、CLI `verify-audit` / `sign-audit-checkpoint`（HMAC-SHA256 定期检查点）以及恢复演练全链校验。在线审计记录默认至少保留 365 天（`AUDIT_RETENTION_DAYS`），清理必须先离线归档、校验哈希链并留存签名检查点后由 DBA 受控执行。
- **管理员密码策略与高风险操作 Step-Up**：初始化 CLI 与改密 API 统一将新管理员密码最低长度提升至 **16 位**（上限 1024），鼓励多词长密码短语，并离线拦截常见泄露密码、弱基础词、连续字符/键盘序列及简单重复模式，支持可选离线泄露字典（`PASSWORD_DENYLIST_FILE`，兼容明文与 HIBP SHA-1/SHA-256 哈希）。已有密码的登录校验不受阻断，便于管理员登录后升级密码。生产环境强制启用 `STEP_UP_TOTP_REQUIRED=true`：显示/复制第三方账号密码要求最近 5 分钟内完成「密码 + TOTP」二次验证，数据库恢复切换（`backup_tool.py switch`）同样在确认 `SWITCH` 后要求管理员密码与 TOTP 验证。后续规划将引入 WebAuthn/Passkey 作为抗钓鱼二步验证与高风险 step-up 因子。
- **分批流式 CSV 导出**：`POST /api/v1/exports/csv` 先在请求事务内完成认证、CSRF 校验与 `csv_exported` 审计落盘，再于独立的 `REPEATABLE READ READ ONLY` 快照事务中使用服务端游标（`stream_results=True`）仅投影非敏感列，按批加载标签、逐批编码并通过 `StreamingResponse` 输出，每批调用 `expunge_all()` 防止内存随数据量线性增长。

## 公开与私有资料边界

代码与通用安全合同公开；实例配置、原始验证、发布/镜像清单及恢复拓扑只在私有侧维护，见 [公开仓库发布规范](public-repository.md)。
