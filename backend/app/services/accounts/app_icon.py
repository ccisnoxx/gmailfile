"""SSRF 防护的应用图标抓取与校验服务：仅使用标准库，仅接受光栅图标并转为安全 data URI。"""

from __future__ import annotations

import base64
import binascii
import http.client
import ipaddress
import re
import socket
import ssl
import struct
import threading
import time
import zlib
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit

from app.services.accounts.errors import AccountError

DOMAIN_RE = re.compile(
    r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$"
)
ICON_DATA_URI_RE = re.compile(
    r"^data:(image/(?:png|jpeg|webp|gif|x-icon|vnd\.microsoft\.icon));base64,([A-Za-z0-9+/=]+)$"
)
BLOCKED_SUFFIXES = (".local", ".localhost", ".internal", ".arpa", ".localdomain", ".home")
CGNAT_NET = ipaddress.ip_network("100.64.0.0/10")

MAX_ICON_BYTES = 65536
MAX_ICON_DATA_URI_LEN = 98304
MAX_HTML_BYTES = 65536
MAX_ICON_DIMENSION = 1024
MAX_ICON_PIXELS = 1024 * 1024
MAX_PNG_DECOMPRESSED_BYTES = 4 * 1024 * 1024
FETCH_TIMEOUT_SECONDS = 5.0
TOTAL_FETCH_BUDGET_SECONDS = 8.0
DEFAULT_MAX_CONCURRENT_ICON_FETCHES = 2
MAX_REDIRECTS = 3
MAX_CANDIDATES = 6
USER_AGENT = "GmailAccountManager-IconFetcher/1.0"


class IconFetchSlot:
    """线程安全且幂等释放的图标抓取并发槽位句柄。"""

    def __init__(self, semaphore: threading.BoundedSemaphore) -> None:
        self._semaphore = semaphore
        self._lock = threading.Lock()
        self._released = False

    def release(self) -> None:
        with self._lock:
            if self._released:
                return
            self._released = True
        self._semaphore.release()

    def __del__(self) -> None:
        self.release()


def try_acquire_icon_fetch_slot(semaphore: threading.BoundedSemaphore) -> IconFetchSlot | None:
    """非阻塞申请一个应用图标抓取并发槽位；满载时立即返回 None。"""
    if not semaphore.acquire(blocking=False):
        return None
    return IconFetchSlot(semaphore)


def _remaining_timeout(deadline: float | None) -> float:
    if deadline is None:
        return FETCH_TIMEOUT_SECONDS
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        return 0.0
    return min(FETCH_TIMEOUT_SECONDS, remaining)


def normalize_domain(raw: str | None) -> str | None:
    """规范化并严格校验公开域名，拒绝 IP 字面量、内网后缀及非法主机名。"""
    if raw is None:
        return None
    text = raw.strip()
    if not text:
        return None
    if "://" not in text:
        parsed = urlsplit(f"https://{text}")
    else:
        parsed = urlsplit(text)
        if parsed.scheme.lower() not in {"http", "https"}:
            raise AccountError(422, "APP_DOMAIN_INVALID", "应用域名仅支持 http/https 公开域名")
    if parsed.username or parsed.password or not parsed.hostname:
        raise AccountError(422, "APP_DOMAIN_INVALID", "请输入有效的应用域名（如 claude.ai）")
    host = parsed.hostname.rstrip(".").lower()
    if len(host) > 253 or host == "localhost" or host.endswith(BLOCKED_SUFFIXES):
        raise AccountError(422, "APP_DOMAIN_INVALID", "不支持本机或内网域名")
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        raise AccountError(422, "APP_DOMAIN_INVALID", "请填写公开域名，不支持直接输入 IP 地址")
    if not DOMAIN_RE.fullmatch(host):
        raise AccountError(422, "APP_DOMAIN_INVALID", "应用域名格式无效，请检查后重试")
    return host


def _inspect_png(data: bytes) -> tuple[int, int] | None:
    if len(data) < 33 or data[12:16] != b"IHDR":
        return None
    width, height = struct.unpack(">II", data[16:24])
    if width <= 0 or height <= 0 or width > MAX_ICON_DIMENSION or height > MAX_ICON_DIMENSION:
        return None
    if width * height > MAX_ICON_PIXELS:
        return None
    pos = 8
    decompressor = zlib.decompressobj()
    decompressed = 0
    saw_idat = False
    while pos + 12 <= len(data):
        chunk_len = struct.unpack(">I", data[pos : pos + 4])[0]
        chunk_type = data[pos + 4 : pos + 8]
        chunk_end = pos + 8 + chunk_len
        if chunk_end + 4 > len(data):
            return None
        if chunk_type == b"IDAT":
            saw_idat = True
            remaining = MAX_PNG_DECOMPRESSED_BYTES - decompressed
            try:
                out = decompressor.decompress(data[pos + 8 : chunk_end], remaining + 1)
            except zlib.error:
                return None
            decompressed += len(out)
            if decompressed > MAX_PNG_DECOMPRESSED_BYTES:
                return None
        elif chunk_type == b"IEND":
            break
        pos = chunk_end + 4
    if not saw_idat:
        return None
    try:
        tail = decompressor.flush(MAX_PNG_DECOMPRESSED_BYTES - decompressed + 1)
    except zlib.error:
        return None
    if decompressed + len(tail) > MAX_PNG_DECOMPRESSED_BYTES:
        return None
    return width, height


def _inspect_jpeg(data: bytes) -> tuple[int, int] | None:
    pos = 2
    sof_markers = {
        0xC0,
        0xC1,
        0xC2,
        0xC3,
        0xC5,
        0xC6,
        0xC7,
        0xC9,
        0xCA,
        0xCB,
        0xCD,
        0xCE,
        0xCF,
    }
    while pos + 1 < len(data):
        while pos < len(data) and data[pos] != 0xFF:
            pos += 1
        while pos < len(data) and data[pos] == 0xFF:
            pos += 1
        if pos >= len(data):
            break
        marker = data[pos]
        pos += 1
        if marker in {0xD8, 0xD9, 0x01} or 0xD0 <= marker <= 0xD7:
            if marker == 0xD9:
                break
            continue
        if pos + 2 > len(data):
            return None
        seg_len = struct.unpack(">H", data[pos : pos + 2])[0]
        if seg_len < 2 or pos + seg_len > len(data):
            return None
        if marker in sof_markers:
            if seg_len < 7:
                return None
            height, width = struct.unpack(">HH", data[pos + 3 : pos + 7])
            return width, height
        pos += seg_len
    return None


def _inspect_webp(data: bytes) -> tuple[int, int] | None:
    if len(data) < 30:
        return None
    chunk = data[12:16]
    if chunk == b"VP8X":
        width = 1 + int.from_bytes(data[24:27], "little")
        height = 1 + int.from_bytes(data[27:30], "little")
        return width, height
    if chunk == b"VP8 ":
        width = struct.unpack("<H", data[26:28])[0] & 0x3FFF
        height = struct.unpack("<H", data[28:30])[0] & 0x3FFF
        return width, height
    if chunk == b"VP8L":
        bits = struct.unpack("<I", data[21:25])[0]
        return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
    return None


def _inspect_ico(data: bytes) -> tuple[int, int] | None:
    if len(data) < 22:
        return None
    count = struct.unpack("<H", data[4:6])[0]
    header_end = 6 + count * 16
    if count < 1 or count > 32 or header_end > len(data):
        return None
    max_w = 0
    max_h = 0
    for idx in range(count):
        base = 6 + idx * 16
        w = data[base] or 256
        h = data[base + 1] or 256
        size, offset = struct.unpack("<II", data[base + 8 : base + 16])
        if size == 0 or offset < header_end or offset + size > len(data):
            return None
        payload = data[offset : offset + size]
        if payload.startswith(b"\x89PNG\r\n\x1a\n"):
            dims = _inspect_png(payload)
            if dims is None:
                return None
            w, h = dims
        max_w = max(max_w, w)
        max_h = max(max_h, h)
    return max_w, max_h


def _inspect_raster_dimensions(data: bytes, mime: str) -> tuple[int, int] | None:
    if mime == "image/png":
        return _inspect_png(data)
    if mime == "image/gif":
        return struct.unpack("<HH", data[6:10]) if len(data) >= 10 else None
    if mime == "image/jpeg":
        return _inspect_jpeg(data)
    if mime == "image/webp":
        return _inspect_webp(data)
    if mime == "image/x-icon":
        return _inspect_ico(data)
    return None


def detect_safe_raster_mime(data: bytes) -> str | None:
    """按文件魔数与光栅尺寸/解压炸弹边界校验安全图片格式；绝不接受 SVG、超大尺寸或压缩炸弹。"""
    if not data or len(data) > MAX_ICON_BYTES:
        return None
    mime: str | None = None
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        mime = "image/png"
    elif len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        mime = "image/webp"
    elif data.startswith(b"\xff\xd8\xff"):
        mime = "image/jpeg"
    elif data.startswith((b"GIF87a", b"GIF89a")):
        mime = "image/gif"
    elif len(data) >= 22 and data[:4] == b"\x00\x00\x01\x00":
        mime = "image/x-icon"
    if mime is None:
        return None
    dims = _inspect_raster_dimensions(data, mime)
    if dims is None:
        return None
    width, height = dims
    if (
        width <= 0
        or height <= 0
        or width > MAX_ICON_DIMENSION
        or height > MAX_ICON_DIMENSION
        or width * height > MAX_ICON_PIXELS
    ):
        return None
    return mime


def validate_icon_data(raw: str | None) -> str | None:
    """校验前端提交或已缓存的 data URI 图标，严格限定光栅格式与大小上限。"""
    if raw is None:
        return None
    text = raw.strip()
    if not text:
        return None
    if len(text) > MAX_ICON_DATA_URI_LEN:
        raise AccountError(422, "APP_ICON_INVALID", "应用图标体积超出上限（最大 64KB）")
    match = ICON_DATA_URI_RE.fullmatch(text)
    if not match:
        raise AccountError(
            422, "APP_ICON_INVALID", "仅支持 PNG/JPEG/WebP/GIF/ICO 格式的 base64 图标"
        )
    try:
        decoded = base64.b64decode(match.group(2), validate=True)
    except (binascii.Error, ValueError):
        raise AccountError(422, "APP_ICON_INVALID", "应用图标编码无效") from None
    detected = detect_safe_raster_mime(decoded)
    if detected is None:
        raise AccountError(422, "APP_ICON_INVALID", "图标内容不是有效的光栅图片")
    encoded = base64.b64encode(decoded).decode("ascii")
    return f"data:{detected};base64,{encoded}"


def _is_public_ip(raw_ip: str) -> bool:
    ip = ipaddress.ip_address(raw_ip)
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    if isinstance(ip, ipaddress.IPv4Address) and ip in CGNAT_NET:
        return False
    return bool(
        ip.is_global
        and not ip.is_private
        and not ip.is_loopback
        and not ip.is_link_local
        and not ip.is_multicast
        and not ip.is_reserved
        and not ip.is_unspecified
    )


def resolve_public_ips(host: str, port: int = 443) -> list[str]:
    """解析主机 DNS 并确保全部返回地址均为公网可路由 IP，阻断内网探测与重绑定。"""
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except OSError as exc:
        raise AccountError(422, "APP_ICON_FETCH_FAILED", "无法解析该应用域名") from exc
    ips: list[str] = []
    for info in infos:
        addr = info[4][0]
        if not _is_public_ip(addr):
            raise AccountError(422, "APP_DOMAIN_INVALID", "目标域名解析到非公网地址，已拒绝访问")
        if addr not in ips:
            ips.append(addr)
    if not ips:
        raise AccountError(422, "APP_ICON_FETCH_FAILED", "未解析到可用公网地址")
    return ips


class _DeadlineExceeded(Exception):
    """内部全局时间预算耗尽信号。"""


def _call_with_deadline(deadline: float | None, fn, *args):
    """在受全局截止时间约束下执行可能阻塞的系统调用（如 getaddrinfo），超时立即中断等待。"""
    if deadline is None:
        return fn(*args)
    rem = _remaining_timeout(deadline)
    if rem <= 0:
        raise _DeadlineExceeded
    outcome: dict[str, object] = {}
    done = threading.Event()

    def _runner() -> None:
        try:
            outcome["value"] = fn(*args)
        except BaseException as exc:  # noqa: BLE001
            outcome["error"] = exc
        finally:
            done.set()

    worker = threading.Thread(target=_runner, name="gm-icon-dns", daemon=True)
    worker.start()
    if not done.wait(timeout=rem):
        raise _DeadlineExceeded
    if "error" in outcome:
        raise outcome["error"]  # type: ignore[misc]
    return outcome.get("value")


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    """直接连接已校验的公网 IP 并保留原域名 SNI/证书校验，防止 DNS Rebinding。"""

    def __init__(
        self,
        host: str,
        pinned_ip: str,
        port: int,
        timeout: float,
        context: ssl.SSLContext,
        *,
        deadline: float | None = None,
    ):
        super().__init__(host=host, port=port, timeout=timeout, context=context)
        self._pinned_ip = pinned_ip
        self._deadline = deadline

    def connect(self) -> None:
        connect_timeout = (
            _remaining_timeout(self._deadline) if self._deadline is not None else self.timeout
        )
        if connect_timeout <= 0:
            raise TimeoutError("icon fetch deadline exceeded before connect")
        sock = socket.create_connection((self._pinned_ip, self.port), connect_timeout)
        try:
            tls_timeout = (
                _remaining_timeout(self._deadline) if self._deadline is not None else self.timeout
            )
            if tls_timeout <= 0:
                raise TimeoutError("icon fetch deadline exceeded before TLS handshake")
            sock.settimeout(tls_timeout)
            self.sock = self._context.wrap_socket(sock, server_hostname=self.host)
        except BaseException:
            sock.close()
            raise


def _fetch_https_bytes(
    url: str, *, max_bytes: int, deadline: float | None = None
) -> tuple[str, bytes] | None:
    """安全抓取单个公开 HTTPS URL；逐跳校验重定向、公网 IP 与全局剩余预算，并限制最大读取字节数。"""
    current = url
    ssl_context = ssl.create_default_context()
    resolved_cache: dict[str, list[str]] = {}
    for _ in range(MAX_REDIRECTS + 1):
        if _remaining_timeout(deadline) <= 0:
            return None
        parsed = urlsplit(current)
        if parsed.scheme.lower() != "https" or not parsed.hostname:
            return None
        if parsed.port not in (None, 443):
            return None
        host = normalize_domain(parsed.hostname)
        if not host:
            return None
        try:
            if host in resolved_cache:
                ips = resolved_cache[host]
            else:
                ips = _call_with_deadline(deadline, resolve_public_ips, host, 443)
                resolved_cache[host] = ips
        except (_DeadlineExceeded, AccountError):
            return None
        timeout = _remaining_timeout(deadline)
        if timeout <= 0:
            return None
        path = parsed.path or "/"
        if parsed.query:
            path = f"{path}?{parsed.query}"
        conn = _PinnedHTTPSConnection(
            host=host,
            pinned_ip=ips[0],
            port=443,
            timeout=timeout,
            context=ssl_context,
            deadline=deadline,
        )
        try:
            conn.request(
                "GET",
                path,
                headers={
                    "Host": host,
                    "User-Agent": USER_AGENT,
                    "Accept": (
                        "image/png,image/webp,image/x-icon,image/jpeg,text/html;q=0.8,*/*;q=0.5"
                    ),
                    "Accept-Encoding": "identity",
                },
            )
            if deadline is not None:
                rem = _remaining_timeout(deadline)
                if rem <= 0:
                    return None
                if conn.sock is not None:
                    conn.sock.settimeout(rem)
            resp = conn.getresponse()
            if resp.status in {301, 302, 303, 307, 308}:
                location = resp.getheader("Location")
                if not location:
                    return None
                next_url = urljoin(current, location.strip())
                if urlsplit(next_url).scheme.lower() != "https":
                    return None
                current = next_url
                continue
            if resp.status != 200:
                return None
            content_type = (resp.getheader("Content-Type") or "").lower()
            chunks: list[bytes] = []
            total = 0
            reader = getattr(resp, "read1", None) or resp.read
            while total < max_bytes + 1:
                if deadline is not None:
                    rem = _remaining_timeout(deadline)
                    if rem <= 0:
                        return None
                    if conn.sock is not None:
                        conn.sock.settimeout(rem)
                chunk = reader(min(8192, max_bytes + 1 - total))
                if not chunk:
                    break
                chunks.append(chunk)
                total += len(chunk)
            if deadline is not None and _remaining_timeout(deadline) <= 0:
                return None
            if total == 0 or total > max_bytes:
                return None
            return content_type, b"".join(chunks)
        except (OSError, http.client.HTTPException, ssl.SSLError):
            return None
        finally:
            conn.close()
    return None


class _IconLinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.candidates: list[tuple[int, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "link":
            return
        mapping = {k.lower(): (v or "").strip() for k, v in attrs}
        rel_tokens = {token for token in mapping.get("rel", "").lower().split() if token}
        if not ({"icon", "apple-touch-icon", "apple-touch-icon-precomposed"} & rel_tokens):
            return
        href = mapping.get("href", "")
        if not href:
            return
        mime = mapping.get("type", "").lower()
        lower_href = href.lower()
        if "svg" in mime or lower_href.endswith(".svg") or lower_href.startswith("data:image/svg"):
            return
        priority = 10
        if "apple-touch-icon" in rel_tokens:
            priority = 30
        elif "png" in mime or ".png" in lower_href or ".webp" in lower_href:
            priority = 25
        elif "icon" in mime or ".ico" in lower_href:
            priority = 20
        sizes = mapping.get("sizes", "")
        size_match = re.search(r"(\d+)x(\d+)", sizes)
        if size_match:
            dim = int(size_match.group(1))
            if 32 <= dim <= 180:
                priority += 10
        self.candidates.append((priority, href))


def _discover_icon_urls(domain: str, *, deadline: float | None = None) -> list[str]:
    if _remaining_timeout(deadline) <= 0:
        return []
    base_url = f"https://{domain}/"
    discovered: list[tuple[int, str]] = []
    html_result = _fetch_https_bytes(base_url, max_bytes=MAX_HTML_BYTES, deadline=deadline)
    if html_result is not None:
        content_type, raw_html = html_result
        if "html" in content_type or b"<link" in raw_html[:8192].lower():
            parser = _IconLinkParser()
            parser.feed(raw_html.decode("utf-8", errors="ignore"))
            for score, href in parser.candidates:
                resolved = href if href.startswith("data:") else urljoin(base_url, href)
                discovered.append((score, resolved))
    discovered.append((15, f"https://{domain}/apple-touch-icon.png"))
    discovered.append((12, f"https://{domain}/favicon.ico"))
    discovered.sort(key=lambda item: item[0], reverse=True)
    seen: set[str] = set()
    urls: list[str] = []
    for _, url in discovered:
        if url not in seen:
            seen.add(url)
            urls.append(url)
        if len(urls) >= MAX_CANDIDATES:
            break
    return urls


def fetch_domain_icon(
    raw_domain: str, *, budget_seconds: float = TOTAL_FETCH_BUDGET_SECONDS
) -> tuple[str, str]:
    """从指定公开 HTTPS 域名抓取并验证图标，返回 (规范域名, data:image/...;base64,...)。"""
    domain = normalize_domain(raw_domain)
    if not domain:
        raise AccountError(422, "APP_DOMAIN_INVALID", "请输入有效的应用域名（如 claude.ai）")
    deadline = time.monotonic() + max(0.01, budget_seconds)
    # 提前校验主域名公网解析，避免非法/内网目标进入候选抓取循环，且将 DNS 解析纳入硬截止预算
    try:
        _call_with_deadline(deadline, resolve_public_ips, domain, 443)
    except _DeadlineExceeded as exc:
        raise AccountError(
            422, "APP_ICON_FETCH_FAILED", "获取应用图标超时，请检查域名可达性或稍后重试"
        ) from exc
    if _remaining_timeout(deadline) <= 0:
        raise AccountError(
            422, "APP_ICON_FETCH_FAILED", "获取应用图标超时，请检查域名可达性或稍后重试"
        )
    for candidate in _discover_icon_urls(domain, deadline=deadline):
        if _remaining_timeout(deadline) <= 0:
            break
        if candidate.startswith("data:"):
            try:
                validated = validate_icon_data(candidate)
            except AccountError:
                continue
            if validated:
                return domain, validated
            continue
        fetched = _fetch_https_bytes(candidate, max_bytes=MAX_ICON_BYTES, deadline=deadline)
        if fetched is None:
            continue
        _, body = fetched
        mime = detect_safe_raster_mime(body)
        if mime is not None:
            encoded = base64.b64encode(body).decode("ascii")
            return domain, f"data:{mime};base64,{encoded}"
    if _remaining_timeout(deadline) <= 0:
        raise AccountError(
            422, "APP_ICON_FETCH_FAILED", "获取应用图标超时，请检查域名可达性或稍后重试"
        )
    raise AccountError(
        422,
        "APP_ICON_FETCH_FAILED",
        "未能从该域名获取到可用图标（仅支持公开 HTTPS 站点的 PNG/ICO/WebP/JPG 图标）",
    )
