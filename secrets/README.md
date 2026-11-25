# Secret 的生成与访问

仓库只保存本说明。真实密钥、密码、备份和导入文件不得提交。

生产 age 身份与合成验收钥分开。私钥不进入 Git/镜像/日志/聊天/常驻备份容器。
age 身份、全部生产数据密钥与管理员恢复码分别离线保存，由用户确认保管；文件已生成不等于已离线保存。
真实路径和验证记录只在私有配置库保存，见 [公开仓库发布规范](../docs/public-repository.md)。

```bash
./scripts/generate-secrets.sh --directory "$PWD/.local/compose-secrets"
```

脚本生成四个独立数据库密码和一个 32 字节原始 AES 数据密钥，拒绝覆盖已有文件，不输出值。

生产环境由 root 执行，目录使用绝对路径，例如 `/opt/example/gmail-manager/secrets`。
父目录必须归 root 所有且为 **0700**，不得复制到可被其他用户遍历的目录。
开发目录归开发者所有。文件为 0444：宿主机访问由 0700 父目录保护；Compose 将具体文件
单独只读挂载后，指定容器中的非 root 用户才可读取。Compose 文件来源 Secret 不可靠地
支持重映射 uid/gid/mode，不能假定设置这些属性就能解决权限问题。

挂载范围：

- PostgreSQL：初始化密码、应用密码、迁移密码、备份密码；不挂载数据加密密钥。
- 迁移进程：仅迁移密码。
- API：仅应用密码和数据加密密钥。
- 备份服务：独立 db_backup_password 和 backup_recipients；不挂载应用数据密钥或 age 解密私钥。
- 可选异地 overlay：仅经授权的 backup_ssh_config、backup_ssh_identity、backup_known_hosts；不默认复用个人 root 身份。

`data_key_v1` 不经过 Base64 编码，密钥须单独离线备份。数据库备份与其解密密钥不能只存放于
同一处。阶段 1 已实现多版本读取、AAD 和当前版本写入；轮换管理命令仍属 P1。

Linux 容器下的实际 owner/mode 和非 root 可读性需要单独验证；方法见 [验收指南](../docs/validation.md)，现场结果只在私有台账保留。

## 阶段 4 的新增 Secret

已有部署只新增备份数据库密码，不覆盖旧文件：

```bash
./scripts/generate-secrets.sh --directory /absolute/project/secrets --backup-only
```

备份 role 通过 `infra/postgres/upgrade-backup-role.sh` 在取得数据库变更授权后创建；不是公开 API，已存在角色时拒绝重设密码。
age 私钥在离线恢复环境生成并保存，只有公开接收方文件放在服务器 Secret 目录；操作见 `docs/operations.md`。
恢复需要全部实际密文 key_version 的数据密钥，不能仅复制当前写入密钥。数据密钥和 age 私钥各自单独离线备份，均不纳入配置 tar 包。
应用/API 不读取备份数据库密码或异地身份；备份/API 共享的仅是 API 只读挂载的状态/加密产物卷。
验收时确认备份服务只有所需的只读 Secret，没有数据密钥或 age 私钥。

## WG异地SSH身份

专用身份文件位于 `SECRETS_DIR/offsite`，不由通用Secret生成器在开发机生成。
在私有配置库定制 `scripts/prepare-offsite-identity.py` 的源地址与目录；它先检查 Linux/root 和指定源机路由，再建目录和生成，不能删除源机检查。

SSH私钥为例外：文件 `backup_ssh_identity` 必须 **0600、数值UID/GID 10001:10001**，父目录root **0700**，
只读挂载给同UID备份容器。不要将它改成普通Secret的0444，也不假定Compose会重映射UID。
公钥、主机known_hosts和配置不含私钥；只复制源机 .pub 到接收机，由root安装来源限定/固定命令的公钥行。
无口令私钥只用于无人值守备份，不能放在本机、接收机、镜像、日志或Git；不复用个人root身份。
完整流程见 [异地 SSH 说明](../docs/offsite-ssh.md)；Linux 容器实际可读性、专用身份验证及自然调度结果分别记录。
