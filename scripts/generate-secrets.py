"""生成文件型 Secret；不覆盖已有文件，不把值打印到终端。"""

import argparse
import os
import secrets
import stat
from pathlib import Path


def generate(directory: Path, *, backup_only: bool = False, audit_only: bool = False) -> None:
    if backup_only and audit_only:
        raise ValueError("不能同时指定 --backup-only 和 --audit-only")
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = directory.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise ValueError("Secret 目录必须归当前用户所有，权限为 0700，且不能是符号链接")
    contents = {
        "db_admin_password": secrets.token_hex(32).encode() + b"\n",
        "db_migrator_password": secrets.token_hex(32).encode() + b"\n",
        "db_backup_password": secrets.token_hex(32).encode() + b"\n",
        "db_audit_password": secrets.token_hex(32).encode() + b"\n",
        "db_password": secrets.token_hex(32).encode() + b"\n",
        "data_key_v1": secrets.token_bytes(32),
    }
    if backup_only:
        contents = {"db_backup_password": contents["db_backup_password"]}
    elif audit_only:
        contents = {"db_audit_password": contents["db_audit_password"]}
    if any((directory / name).exists() or (directory / name).is_symlink() for name in contents):
        raise FileExistsError("目标已包含 Secret，拒绝覆盖")
    for name, content in contents.items():
        # Compose 文件型 Secret 保留宿主机权限。0700 父目录限制宿主机访问，
        # 只读文件允许取得该项挂载的非 root 容器用户读取。
        descriptor = os.open(directory / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o444)
        with os.fdopen(descriptor, "wb") as output:
            output.write(content)
        (directory / name).chmod(0o444)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument(
        "--backup-only", action="store_true", help="已有部署只生成新增备份凭据，不碰数据密钥"
    )
    parser.add_argument(
        "--audit-only", action="store_true", help="已有部署只生成新增审计只写角色凭据，不碰数据密钥"
    )
    args = parser.parse_args()
    generate(args.directory, backup_only=args.backup_only, audit_only=args.audit_only)
    print("Secret 已生成；请保持父目录 0700，并单独离线备份数据密钥。")
