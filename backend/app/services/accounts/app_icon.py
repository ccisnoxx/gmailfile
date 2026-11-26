"""SSRF 防护的应用图标抓取与校验服务：仅使用标准库，仅接受光栅图标并转为安全 data URI。"""

from __future__ import annotations

import base64
import binascii
import http.client
import ipaddress
import re
import socket
import ssl
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
FETCH_TIMEOUT_SECONDS = 5.0
MAX_REDIRECTS = 3
MAX_CANDIDATES = 6
USER_AGENT = "GmailAccountManager-IconFetcher/1.0"


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


def detect_safe_raster_mime(data: bytes) -> str | None:
    """仅按文件魔数识别安全光栅图片格式；绝不接受 SVG 或脚本内容。"""
    if not data or len(data) > MAX_ICON_BYTES:
        return None
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if len(data) >= 22 and data[:4] == b"\x00\x00\x01\x00":
        return "image/x-icon"
    return None


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


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    """直接连接已校验的公网 IP 并保留原域名 SNI/证书校验，防止 DNS Rebinding。"""

    def __init__(
        self,
        host: str,
        pinned_ip: str,
        port: int,
        timeout: float,
        context: ssl.SSLContext,
    ):
        super().__init__(host=host, port=port, timeout=timeout, context=context)
        self._pinned_ip = pinned_ip

    def connect(self) -> None:
        sock = socket.create_connection((self._pinned_ip, self.port), self.timeout)
        self.sock = self._context.wrap_socket(sock, server_hostname=self.host)


def _fetch_https_bytes(url: str, *, max_bytes: int) -> tuple[str, bytes] | None:
    """安全抓取单个公开 HTTPS URL；逐跳校验重定向与公网 IP，并限制最大读取字节数。"""
    current = url
    ssl_context = ssl.create_default_context()
    for _ in range(MAX_REDIRECTS + 1):
        parsed = urlsplit(current)
        if parsed.scheme.lower() != "https" or not parsed.hostname:
            return None
        if parsed.port not in (None, 443):
            return None
        host = normalize_domain(parsed.hostname)
        if not host:
            return None
        ips = resolve_public_ips(host, 443)
        path = parsed.path or "/"
        if parsed.query:
            path = f"{path}?{parsed.query}"
        conn = _PinnedHTTPSConnection(
            host=host,
            pinned_ip=ips[0],
            port=443,
            timeout=FETCH_TIMEOUT_SECONDS,
            context=ssl_context,
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
            resp = conn.getresponse()
            if resp.status in {301, 302, 303, 307, 308}:
                location = resp.getheader("Location")
                resp.read(1024)
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
            while total < max_bytes + 1:
                chunk = resp.read(min(8192, max_bytes + 1 - total))
                if not chunk:
                    break
                chunks.append(chunk)
                total += len(chunk)
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


def _discover_icon_urls(domain: str) -> list[str]:
    base_url = f"https://{domain}/"
    discovered: list[tuple[int, str]] = []
    html_result = _fetch_https_bytes(base_url, max_bytes=MAX_HTML_BYTES)
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


def fetch_domain_icon(raw_domain: str) -> tuple[str, str]:
    """从指定公开 HTTPS 域名抓取并验证图标，返回 (规范域名, data:image/...;base64,...)。"""
    domain = normalize_domain(raw_domain)
    if not domain:
        raise AccountError(422, "APP_DOMAIN_INVALID", "请输入有效的应用域名（如 claude.ai）")
    # 提前校验主域名公网解析，避免非法/内网目标进入候选抓取循环
    resolve_public_ips(domain, 443)
    for candidate in _discover_icon_urls(domain):
        if candidate.startswith("data:"):
            try:
                validated = validate_icon_data(candidate)
            except AccountError:
                continue
            if validated:
                return domain, validated
            continue
        fetched = _fetch_https_bytes(candidate, max_bytes=MAX_ICON_BYTES)
        if fetched is None:
            continue
        _, body = fetched
        mime = detect_safe_raster_mime(body)
        if mime is not None:
            encoded = base64.b64encode(body).decode("ascii")
            return domain, f"data:{mime};base64,{encoded}"
    raise AccountError(
        422,
        "APP_ICON_FETCH_FAILED",
        "未能从该域名获取到可用图标（仅支持公开 HTTPS 站点的 PNG/ICO/WebP/JPG 图标）",
    )
