# 部署、升级和回退

本页及 `infra/`、发布/身份准备脚本都是**公开示例**。真实实例配置、固定边界脚本、发布清单和恢复拓扑在私有侧维护。
示例域名 `accounts.example.com`、`/opt/example` 路径、文档 IP 和 Docker 示例网段都必须在私有侧替换；不能直接覆盖现有服务器。

先完成 [只读环境检查](deployment-environment.md) 和 [上线清单](phase5-launch-checklist.md)，明确变更授权和保护对象。
既有实例继续使用已部署的私有配置与发布器，不通过拉取公开示例更新生产配置。

## 在私有侧形成实例配置

同步定制这些文件，再进行实例验收；真实值不回填公开仓库：

- `.env.example` 的私有副本：域名、绝对 Secret 路径及普通应用配置；密码/私钥仍使用 Secret 文件。
- Compose 的 production/offsite 实例版：网段、单 IP 代理信任、配置挂载路径及备份身份别名。
- Nginx 站点、proxy 片段和 Certbot unit：监听、TLS 终止点、可信来源、证书和静态目录。
- `scripts/deploy.py` 实例版：部署根、域名、网络、代理 IP、异地身份和获准源机检查。
- 异地接收/身份准备/隔离验收脚本：固定接收目录、来源、SSH 端点和 Secret 路径；客户端与接收端必须一致。

Nginx 示例展示可选受信 PROXY protocol 上游。若公网直连 Nginx，私有配置应移除该监听模式及对应 real-IP 设置；
无论拓扑如何，都覆盖 XFF/Proto/Real-IP、清除 Forwarded，并只信任实测 socket peer，不能使用 `*` 或整段网段。
本机开发仍不信任代理头。API 仅映射回环，PG 不映射宿主机端口。
Docker 仅内部网络时可能没有宿主机端口发布，故示例仅让 API 加入独立入口网络，PG 继续仅内部。

## 构建并打包应用

在项目根目录使用锁文件，不启动本机 Docker 也可制作源码/静态包：

```sh
(cd frontend && pnpm install --frozen-lockfile && pnpm build)
python3 scripts/package-release.py --release-id example-release-1 \
  --directory "$PWD/.local/releases"
```

`example-release-1` 是示例 ID，不代表实际发布。白名单包不含 `.env`、`.local`、Secret、备份、node_modules 或虚拟环境。
打包脚本自动读取真实 Git `HEAD`（`git_commit`、`git_tree`、`git_tag`、`working_tree_clean`），默认要求工作区干净，并生成 CycloneDX SBOM（`sbom.cdx.json`）与确定性源码归档摘要（`source_archive_sha256`）。
实例版配置由私有流程单独提供；不要将它放回公开源码目录后重新公开打包。
源/静态发布与实例配置的最终组合必须通过私有发布器的 `plan`、溯源摘要核验和精确 Compose 校验（含基础镜像 `@sha256:<digest>` 与 `STEP_UP_TOTP_REQUIRED=true`）。
构建阶段自动将 `git_commit`、`git_tree`、`source_archive_sha256`、`sbom_sha256` 写入镜像 OCI 标签，部署阶段同时校验镜像 ID 与溯源标签。
上传时核验发布包传输校验和；发布 ID、实际镜像 ID/RepoDigest、锁文件和 schema 基线只写入私有清单。
新发布不覆盖旧目录/镜像标签，旧发布与镜像保留以便恢复。

## 首次部署按依赖顺序推进

1. 核对容量、路由、端口和目录/卷归属，保存本次目标配置、符号链接及 `ABSENT` 状态；不打包其他站点或 Secret。
2. 在私有实例 Secret 目录运行生成器，拒绝覆盖已有密码/数据密钥；只上传 age 公开 recipient，解密私钥另行离线保存。
3. 安装实例版 HTTP-01 引导站点，其他请求返回 503。先 `nginx -t`，再 reload；从公网核验挑战文件。
4. 使用独立 Certbot 配置/work/log 目录签发精确域名证书，不复用其他项目的 DNS/ACME 凭据，不重写共享 Nginx。
5. 安装实例版正式站点、proxy 片段和续期 unit。验证主机名/证书链、HTTP 跳转、安全头、续期 dry-run 与 timer 状态。
6. 用私有发布器构建新 ID，保存镜像记录；在独立 PG18 项目验证应用回归和漏洞，再部署。

下面**只展示定制后的私有实例发布器用法**，不是直接执行公开模板的指令：

```sh
R=/opt/example/gmail-manager/releases/example-release-1
python3 "$R/scripts/deploy.py" plan --release "$R"
python3 "$R/scripts/deploy.py" build --release "$R" --execute
python3 "$R/scripts/deploy.py" deploy --release "$R" --execute
```

发布顺序：停止本项目 API/backup → PG 健康 → one-off Alembic → head 核对 → 本项目卷权限 → API 健康 → 宿主机回环 ready → 原子 current。
迁移失败不启动候选 API；健康或回环失败显式停候选，保留 PG、旧发布和配置。发布器不自动恢复数据库或启动调度。
构建器只管理本项目专属对象，结束即 stop；后续清理须核对身份和无活跃构建，不清理共享 builder/cache。

7. 用户在自己的安全 TTY 运行 `python -m app.cli create-admin`，密码隐藏输入、至少 16 字符（建议使用多词长密码短语，系统会拦截常见弱/泄露密码）；通过真实 HTTPS 绑定 TOTP 并保存恢复码。
8. 完成 [25 项验收标准](acceptance-matrix.md)，匿名边界检查与认证业务检查分开记录，不能用合成环境代替正式证据。

## 先恢复演练，再启唯一备份

在获准的私有实例执行：

```sh
python3 "$R/scripts/deploy.py" backup-once --release "$R" --execute
# 取回后在独立新 PG18 集群恢复，检查 schema/全表计数/约束/各密钥版本业务解密。
python3 "$R/scripts/deploy.py" enable-backup --release "$R" --execute
```

唯一正式调度是 Compose backup，每天 02:00 UTC；不使用验收改期变量，不另加 cron/systemd 备份任务。
配置包应通过 `--config` 收入实际普通配置、发布/镜像记录、站点和续期 unit，并随备份加密；不含任何 Secret/解密私钥。
服务启用、手工成功、自然触发、异地取回、隔离恢复与离线保管确认分别留证。
自然触发观察以真实时钟和新 attempt/副本为准，不用手工补跑冒充；失败保留最近可恢复副本。

运营者分别离线保存 age 身份、全部使用过的 `data_key_vN` 和管理员 TOTP 恢复码；三者用途不同，不能互相代替。
恢复与季度演练详见 [运维手册](operations.md)。

## 升级和回退

升级前取得停写授权、新备份和旧配置快照，核对 schema 兼容，再用新 ID 走同一发布流程。
只允许一个 backup 调度者。已有数据库、Secret、全部历史数据密钥、镜像及旧发布不得重新初始化。

同 schema 且确认旧应用兼容时，在私有实例使用旧发布器：

```sh
OLD_R=/opt/example/gmail-manager/releases/example-previous-release
python3 "$OLD_R/scripts/deploy.py" rollback --release "$OLD_R" --schema-compatible --execute
```

此操作不降级 schema；Nginx/续期配置从精确快照单独恢复，`nginx -t` 后 reload。
schema 不兼容则从升级前备份恢复到新库，验证后另行批准停写与配置切换，协调切换后的新增数据。
首次部署无旧版本时，只停本项目 API/backup 并撤回本次站点/续期变更；保留 PG、卷、Secret、证书和备份，不使用 `down -v`。

参考：[Nginx real-IP](https://nginx.org/en/docs/http/ngx_http_realip_module.html)、[响应头继承](https://nginx.org/en/docs/http/ngx_http_headers_module.html)、[Certbot webroot/续期](https://eff-certbot.readthedocs.io/en/stable/using.html)。
