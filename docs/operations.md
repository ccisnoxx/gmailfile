# 备份、恢复与升级

本手册描述通用操作，不记录具体生产状态。实例版配置、发布/升级/回退见私有台账；通用步骤见 [部署手册](production-deployment.md)。
先准备 Secret 和独立目录，再执行手工备份与隔离演练，最后启用唯一每日调度。
所有示例路径由运营者在私有侧替换，不能直接覆盖已有环境。

## 备份产物和工具

一份完整备份是 `gmail-manager-<UTC>-<随机ID>/`，只含：

- `database.dump.age`：`pg_dump --format=custom --compress=gzip:6` 的输出直接送入 age，不先落盘明文；不是 SQL 或 zstd 文件。
- `deployment.tar.gz.age`：gzip tar 流直接 age 加密，含 Compose、已有 infra/Nginx、迁移、锁文件、应用源代码/版本文件、脚本、操作文档。实际站点配置用 `--config /absolute/site.conf`、`--config /absolute/.env` 显式追加；不把 Secret/数据密钥/备份私钥放入此配置包。
- `manifest.json`：格式版本、应用版本、迁移版本、工具版本、同一数据库快照的表行数和密文文件传输校验和；没有凭据、邮箱或业务明文。

源库用只读 REPEATABLE READ 快照，`pg_dump --snapshot` 与行数清单一致。角色/密码是集群对象，不在单库 dump 中；恢复前按下节重建独立角色。
源库仅信任本项目维护的数据库；pg_restore 会执行源库管理员定义的代码，不从未知来源恢复 dump。

先检查 pg_dump、pg_restore 和 age；本项目要求两个 PG 客户端与服务器**同主版本**，生产为 18。
PG17 仅通过 `--allow-pg17-test` 在 `gm_test*`/`gm_restore*` 隔离环境使用，不是 PG18 验收。
age 至少 1.2.1（安全修复），备份镜像固定官方 1.3.2 发行包并校验上游 SHA-256；本机较早 1.2.1 产物兼容同一 v1 文件格式。

角色密码使用[psql官方\password流程](https://www.postgresql.org/docs/18/app-psql.html)在客户端生成SCRAM verifier，不把明文密码拼入DDL；无控制TTY、单事务、Secret管道输入。

参考：[PG18 pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html)、[PG18 pg_restore](https://www.postgresql.org/docs/18/app-pgrestore.html)、[age 官方发行与安全修复](https://github.com/FiloSottile/age/releases)、[age 安全公告](https://github.com/FiloSottile/age/security/advisories/GHSA-32gq-x56h-299c)。

## 密钥只给需要它的进程

在离线恢复工作站生成 age 身份：

```bash
age-keygen -o /offline/private/backup-identity
age-keygen -y /offline/private/backup-identity > /private/transfer/backup_recipients
```

只将接收方文件 `backup_recipients` 安全放入本项目 Secret 目录（父目录 0700，Compose 文件只读 0444）。
私钥留在另一处离线介质，**不挂给备份容器**。备份容器只持有独立只读数据库凭据和 age 接收方；
不持有应用数据密钥、管理员密码、age 解密私钥。恢复机器才同时具备备份私钥、备份实际使用的所有 `data_key_vN` 及当前 ACTIVE_DATA_KEY_VERSION。
数据密钥必须另行离线备份；只保存数据库与 age 私钥不能解密业务密文。所有历史版本密钥丢失后，重置管理员密码也不能恢复历史密码/手机号/备注/TOTP。

原生脚本默认用仓库 `backend/.venv/bin/python`（已锁定依赖）；可用 `PYTHON_BIN` 指定已配备 psycopg 和应用依赖的解释器。
数据库认证用权限 0600 的 `PGPASSFILE` 或 `BACKUP_DB_PASSWORD_FILE`。后者被转成私有短期 pgpass，请求结束删除；拒绝 PGPASSWORD，不接受密码参数。

### 恢复使用独立镜像，不提升常驻备份服务权限

`infra/backup/Dockerfile`最后/default目标仍是`backup`，只包含备份工具；显式`restore`目标增加Python3.12与锁定的应用依赖，以便完成业务密文认证解密。
在已授权的构建环境、项目根目录构建：

```bash
docker build --target restore -f infra/backup/Dockerfile -t gmail-manager-restore:0.1.0 .
```

恢复目标默认只显示帮助，不会继承每日schedule。运行时才单独只读提供恢复身份及所需数据密钥，挂载权限须让恢复UID可读；不把它们交给`backup`服务。
恢复仍执行下方同一`restore` CLI，目标为新库，生产停写/切换仍另需授权。

隔离验收配置为`infra/docker-compose.acceptance.yml`，必须显式指定新的`--project-name gmail-manager-accept-<批次>`。
它只供测试，不与生产项目混用：`ACCEPTANCE_ID`、`ACCEPTANCE_DIR`、`SECRETS_DIR`、`RECOVERY_SECRETS_DIR`、`OFFSITE_SECRETS_DIR`均需明确，数据库名用`gm_test_accept_*`。
`scripts/acceptance_checks.py`产生实际迁移/造数/Secret结果；A/B都通过后才由`scripts/acceptance_schedule.py`观察一次真实schedule并取回恢复、停止本批成员。
`ACCEPTANCE_AT_UTC`只改变本次验收时刻，默认02:00；指定日期已错过时拒绝自动改到明天。同批结果占位不能静默覆盖，改期须保留原记录并由运营者明确确认。

## 手工备份：先取得一次真的成功

为本项目选择独立绝对目录，不能使用其他项目的备份目录。已有非本项目文件时拒绝接管。

```bash
export PGHOST=/absolute/project-socket  # 生产按实际私网主机配置
export PGPORT=5432 PGUSER=gm_backup
export BACKUP_DB_PASSWORD_FILE=/private/project/db_backup_password
/absolute/gmailfile/scripts/backup.sh \
  --database gmail_manager \
  --directory /absolute/project-backups \
  --recipients /private/project/backup_recipients
```

工具/凭据/dump/压缩/age/磁盘任一步失败均非零退出；原始 SQL 和错误行不输出。仅在文件流全部退出成功、fsync 完成后，原子发布完整目录。
失败的 `.partial-*` 清理；成功本地产物不会因异地失败而删除。进程崩溃或 SIGKILL 可能留下未发布的 `.partial-*`，不算成功，不自动清理未知残留；确认没有本项目活跃任务后再按精确路径处理。

本地保留最近 **7 个日历日每日最新、8 个 ISO 周每周最新、12 个日历月每月最新**的并集；不足的桶不捏造备份。
始终保留最新完整产物；带 `--record-verification` 成功演练的最近副本额外保护，即使超过时间窗口。
只清理根目录标记、命名、完成 manifest 和精确三文件清单匹配的本项目目录；不跟随符号链接，不删除未知文件。
若被保护的副本过旧，先完成新演练再更新保护标记，而不是先删除最后已验证副本。

## 每日只有一个调度责任

**唯一调度者：Compose `operations` profile 的 `backup` 服务，每天 02:00 UTC。不要再加宿主机 cron/systemd timer。**
生产overlay已将实际production.env、release/images记录、已安装Nginx站点/代理片段及续期unit只读挂入，并在唯一command追加`--config`。未使用生产overlay时配置包仅含仓库配置/模板，不声称已备份实际线上Nginx。
它调用同一个 backup 实现，flock 防止手工/定时同时运行；失败保留失败状态并等待次日，不自动重放传输不确定的任务。
备份命名卷的权限只由一次性 `backup-init` 初始化为 UID/GID 10001（只针对本项目新卷）；常驻备份进程非 root、只读根文件系统、最小能力、限内存/CPU、日志轮换。

经授权且手工备份、异地取回和恢复均成功后，使用私有实例发布器启用持续运行；以下路径仅为示例：

```bash
# 在获准的源机执行私有实例版本；不要直接运行公开示例。
R=$(readlink -f /opt/example/gmail-manager/current)
python3 "$R/scripts/deploy.py" enable-backup --release "$R" --execute
```

healthcheck 要求最近一次成功且不超过 36 小时，首个调度周期最多 26 小时启动宽限；配置存在不等于已运行。
API 仅读 `status.json`，完整认证后返回未配置/未运行/运行中/成功/失败/过期、本地最近成功时间及异地传输状态，不返回路径、命令或异常。
失败优先显示失败；即使历史成功尚新，也不能掩盖最新一次失败。API/PG/backup 均有日志大小轮换和资源上限；匿名 health 仍只返回最小存活/就绪结果。

## 异地备份：专用受限身份，只留一份

实例端点、来源地址与目录只在私有侧维护；公开的 offsite overlay、客户端和接收程序使用示例值。
接收端只运行每次 SSH 调用的固定程序，无新 daemon/定时器；公钥限制来源与命令，禁止 Shell/SFTP/转发。
源机原地生成专用私钥，`SECRETS_DIR/offsite` 的三项文件只读挂给 backup，不复用个人管理身份。

先上传 incoming、验证完整性、原子发布并再次验证 current，再删除 previous；失败保留旧副本。
确认阶段中断是结果未知，先用 `backup_tool.py offsite-status` 查询，不自动重放。
取回使用 `scripts/fetch-backup.sh --directory /absolute/new-retrieval-directory`，只下载三个加密/元数据文件并核对摘要。
安装、权限、协议限额与撤销方法见 [异地 SSH 说明](offsite-ssh.md)。

## 恢复到新库，不覆盖旧库

每季度至少一次在独立恢复环境完整演练，由运营者保留私有结果，不只记录“容器能启动”。
记录备份日期、PG/应用/schema 版本、取回结果、全表计数/约束、各密钥版本抽样数和是否切换。
生产停写及切换需要单独授权；演练只在独立集群恢复到新 `gm_restore_*` 库。
`--isolated` 模式要求隔离集群的源库为 `gm_test*`，不连接生产源库。也可先在独立集群建立空占位源库完成工具/停写检查。
恢复工作站可本地解密后向隔离集群传认证流；不把 age 身份交给常驻 backup。

```bash
export PGHOST=/absolute/project-socket PGPORT=5432 PGUSER=project_restore_admin
export PGPASSFILE=/private/project/restore-pgpass
export DATA_KEY_DIRECTORY=/offline/project-data-keys ACTIVE_DATA_KEY_VERSION=1
/absolute/gmailfile/scripts/restore.sh \
  --backup /absolute/project-backups/gmail-manager-UTC-ID \
  --identity /offline/private/backup-identity \
  --source-database gmail_manager \
  --target-database gm_restore_YYYYMMDD \
  --writers-stopped --record-verification
```

1. 验证完整标记与传输摘要；**完整消费 age 认证流**，检查 dump 目录及部署 tar 可读。
2. 运营者先停止 API/所有写入客户端；脚本拒绝仍有源库连接，不擅自终止进程。隔离环境也检查该条件。
3. 目标必须是尚不存在的新临时库，`pg_restore --single-transaction --exit-on-error`，不加 `--clean`/`--create`，不覆盖或删除任何旧库。
4. 核对快照每表行数、迁移 head、数据库 FK/CHECK/唯一约束、邮箱规范化、辅助关联以及 `audit_events` 全链 SHA-256 哈希链完整性。
5. 对每个实际使用的 key_version/敏感字段抽样做 AES-GCM 认证解密（含管理员 TOTP/候选 Secret），只返回样本数量，不输出明文。
6. 失败保留隔离临时库供检查，绝不切换；修复后选另一个新临时库重做。没有/错误 age 私钥、缺失/错误数据密钥均失败。

`--record-verification` 仅用于本项目管理的本地备份根目录，写入 `.last-verified.json` 保护该副本。
异地取回目录可不带此参数；异地演练结果另记台账，不伪造本地保护指针。

## 明确确认后，通过配置切换

先在目标环境创建既有独立迁移/应用/只读备份角色（从 Secret 读取密码，不在参数或 SQL 文档内放密码）。
保持 API/backup 停止，确认目标可用；以下为示例；生产配置切换须另行批准：

```bash
/absolute/gmailfile/scripts/restore.sh switch \
  --backup /absolute/project-backups/gmail-manager-UTC-ID \
  --source-database gmail_manager --target-database gm_restore_YYYYMMDD \
  --env-file /absolute/gmailfile/.env \
  --migrator-role gm_migrator --app-role gm_app --backup-role gm_backup \
  --writers-stopped
```

终端输入 `SWITCH` 后，若目标库已初始化管理员，脚本先要求管理员完成密码与 TOTP 二次验证（step-up）；通过后再禁止源/目标新连接，确认没有其他客户端，并通过保留的验证连接做**最终**一致性、审计链完整性与抽样解密校验。
同一受控流程恢复对象 owner、应用 DML/序列权限（显式撤销 `gm_app` 在 `audit_events` 上的 UPDATE/DELETE/TRUNCATE，可选配置 `--audit-role gm_audit_writer` 仅授 INSERT）、备份只读权限及未来迁移的默认权限；
撤销全部恢复出来的旧 Session、清除候选 TOTP/预会话/CSV 凭据，写固定恢复审计，避免复活备份后已撤销的 Cookie。
最后原子替换指定 `.env` 的唯一 `DATABASE_NAME`，原配置保留为 `.env.before-switch-*`。旧库不改名、不删除；不自动启动服务。

- 验证/确认失败：配置仍指向旧库，恢复连接准入；目标留在隔离环境，不提供 API。
- 配置发布前中断：核对 `.env`，旧库及原配置都在；目标可能已使历史 Session 失效，这是安全状态。重新选新临时库再恢复/验证。
- 发布结果未知：直接读取 `.env` 的 DATABASE_NAME 判定，不自动重放切换。若数据库仍被禁连，用独立 PostgreSQL 管理连接检查 `pg_database.datallowconn`，只对明确源/目标执行 `ALTER DATABASE <明确库名> ALLOW_CONNECTIONS true`；不要重启或删除其他库。
- 启动迁移/API 后，以应用角色检查迁移就绪、重新登录、账号/标签/关联、敏感读取和备份角色，再恢复流量和唯一备份调度。
- 回退：停新库写入，核对切换后新增数据；旧库保留。先撤销旧库历史认证状态（同上 user_sessions/预会话/CSV 清理并审计），再将原配置**原子**恢复，按旧应用/迁移兼容性检查后启动。不要直接复制配置并放开旧 Cookie；切换后的新数据需要显式协调，不宣称零数据损失。

备份恢复不是迁移降级工具。降级只在目标版本明确兼容时执行 Alembic downgrade；否则从升级前备份恢复到新库并走上述验证/切换流程。

## 审计防篡改、签名检查点与保留策略

1. 既有数据库升级到迁移 `0004` 时，先以 `scripts/generate-secrets.sh --directory /absolute/secrets --audit-only` 生成 `db_audit_password`，再在无控制终端环境运行 `infra/postgres/upgrade-audit-role.sh` 创建仅允许 `INSERT` 的 `gm_audit_writer` 并撤销 `gm_app` 在 `audit_events` 上的修改/删除/截断权限。
2. 迁移 `0004` 自动为存量 `audit_events` 回填单调序号与 SHA-256 哈希链，并启用 `BEFORE INSERT` 链计算触发器与 `BEFORE UPDATE OR DELETE` / `BEFORE TRUNCATE` 保护触发器。
3. 运维可通过 `python -m app.cli verify-audit` 或前端“迁移与运维 → 审计日志 → 校验哈希链”核对完整性；配置独立 Ed25519 私钥 `AUDIT_SIGNING_KEY_FILE`（与发布签名密钥严格分离）后可定期运行 `python -m app.cli sign-audit-checkpoint` 输出签名检查点，并用独立公钥通过 `verify-audit-checkpoint` 离线验签。
4. 生产环境配置 `AUDIT_SYSLOG_ADDRESS` 时**仅允许本机绝对 Unix 套接字路径**（如 `/dev/log` 或本机 rsyslog/syslog-ng 套接字），由本机系统日志守护进程负责持久化队列、TLS/mTLS、RELP/可靠 TCP 重试与远程日志服务器转发，避免 API 进程同步连接远端 TCP 阻塞启动或请求路径；配置 `AUDIT_SYSLOG_SPOOL_FILE` 时，瞬时不可达记录通过跨进程 `flock` 互斥锁与 `fsync` 落入 `0600` 本地队列，并支持 `flush-audit-spool` 安全并发重放（损坏行自动隔离至 `.quarantine` 文件而不静默丢弃）。即使不配 Syslog，`gmail_manager.audit` 也会输出独立结构化 JSON 流供采集器收集。
5. **保留与清理策略**：在线数据库默认至少保留 365 天（`AUDIT_RETENTION_DAYS`）审计记录，日常应用与定时任务严禁删改。达到合规清理窗口时，必须先完成全量加密备份、导出离线归档并核验 `verify-audit` 与最新签名检查点，再由 DBA 在变更授权下单独执行受控归档清理并记录新基线。

## 从阶段 3 升级

1. 保留现有数据库、全部数据密钥、配置与已验证备份；停写授权具备后才升级。
2. 已有 Secret 目录运行 `scripts/generate-secrets.sh --directory /absolute/secrets --backup-only`，只新增备份密码，绝不重生成应用密钥。
3. DBA 经授权以无控制终端的 `docker compose exec -T` 在本项目数据库运行 `infra/postgres/upgrade-backup-role.sh`（显式 POSTGRES_USER/POSTGRES_DB 和 GM_BACKUP_PASSWORD_FILE）；角色已存在则拒绝，不重设密码。首次空库由 init-roles 自动建立。
4. 用迁移角色 `alembic upgrade head`：`0002 → 0003` 新增 CSV 凭据及可空闲置设置。历史迁移未改写，既有数据保留；NULL 使用环境默认值。
5. 迁移成功才启动匹配应用。只检查健康不等于业务可用；完成认证、CSV、Session/审计检查后，再单独启备份 profile。
6. 版本、权限、备份与容器门禁未过，不发布公网。先按 [部署前检查](deployment-environment.md) 核对私有实例条件，再完成 HTTPS 与公网验收。
