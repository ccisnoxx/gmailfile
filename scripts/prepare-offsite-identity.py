#!/usr/bin/env python3
"""异地身份准备示例；地址/目录需在私有库定制，先校验源机再写入。"""

import argparse
import os
import re
import stat
import subprocess
import sys
from pathlib import Path

DIRECTORY = Path("/opt/example/gmail-manager/secrets/offsite")
CONTAINER_UID = 10001


class PrepareError(Exception):
    pass


def require(condition, message):
    if not condition:
        raise PrepareError(message)


def check_source():
    require(
        sys.platform == "linux" and os.geteuid() == 0, "只能在app-host以root执行，不能在本机代生成"
    )
    route = subprocess.run(
        ["ip", "-4", "route", "get", "192.0.2.10"], capture_output=True, text=True, check=True
    )
    require(
        re.search(r"\bdev wg0\b", route.stdout)
        and re.search(r"\bsrc 192\.0\.2\.20\b", route.stdout),
        "必须是WG源192.0.2.20，尚未开始生成任何密钥或目录",
    )


def private_directory(path, mode):
    if path.exists() or path.is_symlink():
        info = path.lstat()
        require(
            stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and stat.S_IMODE(info.st_mode) == mode,
            "目录所有者/权限不符合合同，不接管已有路径",
        )
    else:
        path.mkdir(mode=mode)
        path.chmod(mode)


def prepare(host_public_key):
    check_source()  # Must run BEFORE any mkdir, key generation, or credential write.
    require(
        host_public_key.is_file()
        and not host_public_key.is_symlink()
        and host_public_key.stat().st_size < 1024,
        "必须提供经可信管理连接核验的backup-host主机公钥",
    )
    public = host_public_key.read_text().strip()
    require(re.fullmatch(r"ssh-ed25519 [A-Za-z0-9+/=]+(?: [^\r\n]*)?", public), "主机公钥格式无效")
    subprocess.run(
        ["ssh-keygen", "-l", "-f", str(host_public_key)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=True,
    )
    parent = DIRECTORY.parent.parent
    if parent.exists() or parent.is_symlink():
        info = parent.lstat()
        require(
            stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022,
            "项目父目录不可接管",
        )
    else:
        parent.mkdir(mode=0o755)
    private_directory(DIRECTORY.parent, 0o700)
    private_directory(DIRECTORY, 0o700)
    names = (
        "backup_ssh_identity",
        "backup_ssh_identity.pub",
        "backup_ssh_config",
        "backup_known_hosts",
    )
    require(
        not any((DIRECTORY / n).exists() or (DIRECTORY / n).is_symlink() for n in names),
        "已有身份或配置文件，保留且拒绝覆盖；部分失败请按文档核对",
    )
    key = DIRECTORY / "backup_ssh_identity"
    subprocess.run(
        ["ssh-keygen", "-t", "ed25519", "-N", "", "-C", "gmail-manager-app-host", "-f", str(key)],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=True,
    )
    os.chown(key, CONTAINER_UID, CONTAINER_UID)
    key.chmod(0o600)
    host_type, blob, *_ = public.split()
    known = DIRECTORY / "backup_known_hosts"
    known.write_text(f"192.0.2.10 {host_type} {blob}\n")
    known.chmod(0o444)
    config = DIRECTORY / "backup_ssh_config"
    config.write_text("""Host backup-receiver
    HostName 192.0.2.10
    Port 22
    User gmail-backup
    IdentityFile /run/secrets/backup_ssh_identity
    UserKnownHostsFile /run/secrets/backup_known_hosts
    StrictHostKeyChecking yes
    BatchMode yes
    IdentitiesOnly yes
    ForwardAgent no
    ClearAllForwardings yes
    RequestTTY no
    ServerAliveInterval 30
    ServerAliveCountMax 3
""")
    config.chmod(0o444)
    print("app-host专用身份已生成；私钥留在源机。仅传递.pub，接收端未激活前不执行上传或调度。")


class SafeParser(argparse.ArgumentParser):
    def error(self, message):
        self.print_usage(sys.stderr)
        self.exit(2, "参数不正确；只接受已核验的主机公钥文件。\n")


def main():
    parser = SafeParser(description=__doc__)
    parser.add_argument("--host-public-key", type=Path, required=True)
    args = parser.parse_args()
    try:
        prepare(args.host_public_key)
    except Exception as exc:
        print(
            str(exc)
            if isinstance(exc, PrepareError)
            else "身份准备失败；保留部分文件，不在其他主机补生成。",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
