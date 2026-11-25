#!/usr/bin/env python3
"""受限接收端安装示例；先在私有库定制来源/目录，不生成密钥、启调度或改sshd。"""

import argparse
import grp
import importlib.util
import os
import pwd
import stat
import subprocess
import sys
import tempfile
from pathlib import Path

USER = "gmail-backup"
HOME = Path("/var/lib/gmail-manager-backup")
DATA = Path("/srv/example/gmail-manager-backups")
LEGACY = Path("/root/example-gmail-manager-backups")
PROGRAM = Path("/usr/local/libexec/gmail-manager-backup-receiver")
FORCED = "/usr/bin/python3 -I /usr/local/libexec/gmail-manager-backup-receiver"


class InstallError(Exception):
    pass


def require(condition, message):
    if not condition:
        raise InstallError(message)


def attributes(path, uid, gid, mode, *, directory=False):
    info = path.lstat()
    require(
        (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode))
        and info.st_uid == uid
        and info.st_gid == gid
        and stat.S_IMODE(info.st_mode) == mode,
        "现有路径的类型/所有者/权限不符合本项目合同，停止且不接管",
    )


def create_directory(path, gid, mode):
    if path.exists() or path.is_symlink():
        attributes(path, 0, gid, mode, directory=True)
    else:
        path.mkdir(mode=mode)
        os.chown(path, 0, gid)
        path.chmod(mode)


def atomic_file(path, content, uid, gid, mode):
    fd, temporary = tempfile.mkstemp(prefix=".gm-install-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fchown(stream.fileno(), uid, gid)
            os.fchmod(stream.fileno(), mode)
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        Path(temporary).unlink(missing_ok=True)


def install(source):
    require(os.geteuid() == 0, "必须由本项目backup-host管理员执行")
    require(source.is_file() and not source.is_symlink(), "接收程序来源必须是普通文件")
    spec = importlib.util.spec_from_file_location("gmail_receiver", source)
    receiver = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(receiver)
    require(
        receiver.ROOT == DATA and receiver.MAGIC == "gmail-account-manager-backup-v1",
        "接收程序目标不匹配",
    )
    try:
        account = pwd.getpwnam(USER)
    except KeyError:
        try:
            grp.getgrnam(USER)
        except KeyError:
            pass
        else:
            raise InstallError("同名组已存在但账号不存在，停止人工核对") from None
        subprocess.run(
            [
                "useradd",
                "--system",
                "--user-group",
                "--home-dir",
                str(HOME),
                "--shell",
                "/bin/sh",
                "--no-create-home",
                USER,
            ],
            check=True,
        )
        account = pwd.getpwnam(USER)
    require(
        account.pw_dir == str(HOME)
        and account.pw_shell == "/bin/sh"
        and grp.getgrgid(account.pw_gid).gr_name == USER
        and set(os.getgrouplist(USER, account.pw_gid)) == {account.pw_gid},
        "现有账号不符合专用身份合同",
    )
    locked = subprocess.run(["passwd", "-S", USER], capture_output=True, text=True, check=True)
    require(locked.stdout.split()[1] == "L", "账号密码未锁定，停止人工核对")
    create_directory(HOME, account.pw_gid, 0o750)
    create_directory(HOME / ".ssh", account.pw_gid, 0o750)
    authorized = HOME / ".ssh/authorized_keys"
    if authorized.exists() or authorized.is_symlink():
        attributes(authorized, 0, account.pw_gid, 0o640)
        require(authorized.stat().st_size == 0, "已有公钥，安装升级需另行核对，不覆盖")
    else:
        atomic_file(authorized, b"", 0, account.pw_gid, 0o640)
    if LEGACY.exists() or LEGACY.is_symlink():
        require(not DATA.exists() and not DATA.is_symlink(), "新旧目录同时存在，停止迁移")
        require(
            stat.S_ISDIR(LEGACY.lstat().st_mode)
            and {p.name for p in LEGACY.iterdir()} == {"current", ".gmail-manager-backups"}
            and receiver.regular(LEGACY / ".gmail-manager-backups")
            and (LEGACY / ".gmail-manager-backups").read_text() == receiver.MAGIC,
            "旧备份目录不是预期的单副本结构",
        )
        receiver.validate_bundle(LEGACY / "current")
        # rename never falls back to a cross-filesystem copy; no second successful copy is created.
        LEGACY.rename(DATA)
        receiver.sync_directory(LEGACY.parent)
        receiver.sync_directory(DATA.parent)
    else:
        require(DATA.is_dir() and not DATA.is_symlink(), "必须有已经核对的项目备份目录")
        require(
            {p.name for p in DATA.iterdir()}
            <= {"current", ".gmail-manager-backups", ".receiver.lock"},
            "新目录含未知状态，停止",
        )
        require((DATA / ".gmail-manager-backups").read_text() == receiver.MAGIC, "项目标记不匹配")
        receiver.validate_bundle(DATA / "current")
    paths = [DATA, DATA / ".gmail-manager-backups", DATA / "current"]
    paths += [DATA / "current" / name for name in receiver.FILES]
    if (DATA / ".receiver.lock").exists():
        paths.append(DATA / ".receiver.lock")
    for path in paths:
        info = path.lstat()
        require(stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode), "目录含非普通文件，停止")
        os.chown(path, account.pw_uid, account.pw_gid, follow_symlinks=False)
        path.chmod(0o700 if stat.S_ISDIR(info.st_mode) else 0o600)
    receiver.sync_directory(DATA)
    create_directory(PROGRAM.parent, 0, 0o755)
    require(not PROGRAM.exists() and not PROGRAM.is_symlink(), "接收程序已存在，升级需单独核对")
    atomic_file(PROGRAM, source.read_bytes(), 0, 0, 0o755)
    print("接收程序及无公钥专用账号已准备；原备份已原子迁移。未激活SSH身份，未启动服务或调度。")


def install_key(public_key):
    require(os.geteuid() == 0, "必须由本项目backup-host管理员执行")
    account = pwd.getpwnam(USER)
    authorized = HOME / ".ssh/authorized_keys"
    attributes(authorized, 0, account.pw_gid, 0o640)
    attributes(PROGRAM, 0, 0, 0o755)
    require(
        public_key.is_file() and not public_key.is_symlink() and public_key.stat().st_size < 1024,
        "仅接受独立Ed25519公钥文件",
    )
    import re

    text = public_key.read_text().strip()
    require(re.fullmatch(r"ssh-ed25519 [A-Za-z0-9+/=]+(?: [^\r\n]*)?", text), "公钥格式无效")
    subprocess.run(
        ["ssh-keygen", "-l", "-f", str(public_key)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=True,
    )
    key_type, blob, *_ = text.split()
    content = (
        f'restrict,from="192.0.2.20",command="{FORCED}" {key_type} {blob} gmail-manager-app-host\n'
    ).encode()
    require(authorized.read_bytes() in {b"", content}, "已有不同公钥，不覆盖或轮换")
    if authorized.read_bytes() != content:
        atomic_file(authorized, content, 0, account.pw_gid, 0o640)
    print("公钥已限制为WG来源及固定备份命令；未更改sshd配置或启动调度。")


class SafeParser(argparse.ArgumentParser):
    def error(self, message):
        self.print_usage(sys.stderr)
        self.exit(2, "参数不正确；只接受程序路径或公钥文件路径。\n")


def main():
    parser = SafeParser(description=__doc__)
    choice = parser.add_mutually_exclusive_group(required=True)
    choice.add_argument("--receiver-source", type=Path)
    choice.add_argument("--public-key", type=Path)
    args = parser.parse_args()
    try:
        if args.receiver_source:
            install(args.receiver_source)
        else:
            install_key(args.public_key)
    except Exception as exc:
        print(
            str(exc)
            if isinstance(exc, InstallError)
            else "安装失败；保留备份及已有状态，请按文档核对。",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
