# 最小权限 SSH 异地备份

本功能是现有 backup 服务的传输步骤，不另加 cron、timer 或后台接收 daemon。
真实端点、管理入口、私网路由与恢复路径只在私有侧维护；这里的地址/路径均为示例。

## 先在私有侧定制，再安装

公开的 `infra/backup/ssh_config.example` 使用文档地址 `192.0.2.10` 和示例别名 `backup-receiver`。
身份准备脚本用 `192.0.2.20` 演示精确源机路由检查；接收端固定目录示例为 `/srv/example/gmail-manager-backups`。
部署时同时调整私有实例的准备脚本、接收端/安装器、offsite overlay、发布/验收检查；不能只改客户端路径。
管理员使用自己已核验的管理连接，不能复制个人私钥或转发 Agent。备用跳板不在公开仓库记录。

## 接收端只开放固定命令

专用账号密码锁定，无 sudo/Docker/补充组；账号 `/bin/sh` 仅用于 OpenSSH 启动强制命令。
home 与 `.ssh` 由 `root:专用组 0750` 持有，`authorized_keys` 为 `root:专用组 0640`，账号不能修改入口。
固定接收程序 root:root 0755，运行时以普通账号执行；数据目录才归该账号所有（0700）。
公钥行使用 `restrict`、精确来源和 `python3 -I` 强制命令，只接受 `gmail-backup upload/status/fetch`。
禁止 Shell、SFTP、PTY、端口/Agent/X11 转发、用户 rc、客户端路径和任意删除命令。
公钥未安装时文件保持空，身份未启用；无需改变或重载 sshd。

经授权，将私有实例的安装器与接收程序放入专用暂存目录，再执行：

```sh
python3 /private/staging/install-offsite-receiver.py \
  --receiver-source /private/staging/receiver.py
```

安装器拒绝接管权限/内容不符的已有对象，不覆盖程序或非空公钥。
旧目录迁移先核对标记/精确三文件，再用同文件系统 rename，不复制第二份成功副本。
只对已知项目文件改 owner/mode，不递归处理其他数据；部分失败保留禁用身份与备份，先核对再恢复。

## 专用私钥只在源机生成

从可信管理连接取得接收机 Ed25519 主机公钥并核验指纹，不盲信未认证的 ssh-keyscan。
将这个**公钥**与定制后的准备脚本送至源机：

```sh
python3 /private/staging/prepare-offsite-identity.py \
  --host-public-key /private/staging/receiver-host-ed25519.pub
```

脚本先检查 Linux/root 和精确路由来源，之后才 mkdir 或 ssh-keygen；源机不可达时不在其他机器代生成。
实例 `SECRETS_DIR/offsite` 的父目录 root 0700，文件如下：

- `backup_ssh_identity`：0600、数值 UID/GID 10001:10001，只留源机，只读挂给同 UID 备份容器。
- `backup_ssh_identity.pub`：仅此公钥送往接收端。
- `backup_ssh_config`、`backup_known_hosts`：root 0444，严格绑定接收端与已核验主机公钥。

SSH 私钥不能改成普通 Secret 的 0444；Compose 文件 bind 不保证重映射 owner，必须实测 Linux 容器读取权限。
已有身份拒绝覆盖；部分失败保留文件，不能换另一台主机补生成。

接收机管理员确认来源/命令限制后安装源机公钥：

```sh
python3 /private/staging/install-offsite-receiver.py \
  --public-key /private/staging/source-backup.pub
```

不接受不同公钥覆盖，也不改个人管理入口。撤销时只移除该专用公钥，保留备份数据，不需改私网密钥或重启服务。

## 单次验证与容器验收分开

先在源机使用私有 SSH 配置检查 `gmail-backup status`，再验证合成密文上传与取回，以及 Shell/SFTP/PTY/转发拒绝。
原生检查要覆盖容器内凭据路径为源机私有路径，不能复制第二套私钥。
容器内由 offsite overlay 只读挂载三项文件，使用 `OFFSITE_SSH_CONFIG` 与专用 `OFFSITE_HOST`；不改变固定接收目录。
单次主机认证通过不等于容器可读取，更不等于每日调度成功；分别按 [验收指南](validation.md) 留证。

## 新副本确认后才删除旧的

1. 内核 flock 串行化上传、状态、取回；进程退出不留下永久忙锁。
2. 按固定顺序接收 manifest、数据库密文、部署包密文三个普通 USTAR 文件，不调用通用解包。
3. 拒绝路径/链接/扩展头/重复/缺失/多余条目、截断及异常尾部；校验 manifest 白名单、age 头与传输摘要。
4. incoming 文件/目录 fsync 后，旧 current 暂移 previous，再原子发布新 current；发布后完整复验才删 previous。
5. 失败恢复/保留旧副本，未知文件或链接导致停止，不删除最后可恢复副本。

同一成功包重传返回 unchanged；旧时间包或同时间不同内容拒绝。
确认阶段断线是结果未知，先用 `backup_tool.py offsite-status` 查询，不自动重放。
取回入口为 `scripts/fetch-backup.sh --directory /absolute/new-retrieval-directory`。
status/fetch 在锁内恢复明确受管理的 rename 状态，不顺手清理未知文件。

接收边界：单包最多 2 GiB，每文件开始前保留至少 256 MiB 磁盘余量，单连接最多 15 分钟。
超限失败而不截断；需要扩容时先调整容量与合同。接收机不持 age 私钥或应用数据密钥，摘要校验不替代隔离解密恢复。
本地保留与季度演练见 [运维手册](operations.md)。

参考：[OpenSSH authorized_keys](https://man.openbsd.org/sshd.8#AUTHORIZED_KEYS_FILE_FORMAT)、[Python tarfile 流模式](https://docs.python.org/3.11/library/tarfile.html)。
