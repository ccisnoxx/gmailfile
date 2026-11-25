"""Bound CSV bodies before FastAPI reads them; no multipart spool or raw file storage."""

import json
from uuid import uuid4


class CsvUploadLimit:
    def __init__(self, app, max_bytes, cookie_name="__Host-gm_session"):
        self.app, self.max_bytes = app, max_bytes
        self.cookie_token = f"{cookie_name}=".encode()

    async def __call__(self, scope, receive, send):
        if (
            scope["type"] != "http"
            or scope["path"] not in {"/api/v1/imports/csv/preview", "/api/v1/imports/csv/commit"}
            or scope["method"] != "POST"
        ):
            return await self.app(scope, receive, send)
        cookie_header = b"; ".join(
            value for key, value in scope["headers"] if key.lower() == b"cookie"
        )
        content_type = next(
            (value for key, value in scope["headers"] if key.lower() == b"content-type"), b""
        )
        media_type = content_type.split(b";", 1)[0].strip().lower()
        content = bytearray()
        status, code, message = 0, "", ""
        if self.cookie_token not in cookie_header:
            status, code, message = 401, "AUTH_REQUIRED", "会话已失效，请重新登录"
        elif media_type != b"text/csv":
            status, code, message = 415, "CSV_TYPE_INVALID", "仅接受 text/csv 上传"
        else:
            while True:
                part = await receive()
                if part["type"] == "http.disconnect":
                    return
                content.extend(part.get("body", b""))
                if len(content) > self.max_bytes:
                    status, code, message = (
                        413,
                        "CSV_TOO_LARGE",
                        "CSV 文件超过大小上限（最大10 MiB）",
                    )
                    break
                if not part.get("more_body", False):
                    break
        if status:
            content.clear()
            request_id = scope.get("state", {}).get("request_id") or str(uuid4())
            payload = json.dumps(
                {
                    "error": {"code": code, "message": message, "details": {}},
                    "request_id": request_id,
                }
            ).encode()
            await send(
                {
                    "type": "http.response.start",
                    "status": status,
                    "headers": [
                        (b"content-type", b"application/json"),
                        (b"cache-control", b"no-store"),
                    ],
                }
            )
            await send({"type": "http.response.body", "body": payload})
            return
        sent = False

        async def bounded_receive():
            nonlocal sent
            if not sent:
                sent = True
                return {"type": "http.request", "body": bytes(content), "more_body": False}
            return await receive()

        try:
            await self.app(scope, bounded_receive, send)
        finally:
            content.clear()
