"""Bound CSV bodies before FastAPI reads them; no multipart spool or raw file storage."""

import json
from uuid import uuid4


class CsvUploadLimit:
    def __init__(self, app, max_bytes):
        self.app, self.max_bytes = app, max_bytes

    async def __call__(self, scope, receive, send):
        if (
            scope["type"] != "http"
            or scope["path"] not in {"/api/v1/imports/csv/preview", "/api/v1/imports/csv/commit"}
            or scope["method"] != "POST"
        ):
            return await self.app(scope, receive, send)
        headers = dict(scope["headers"])
        content = bytearray()
        status, code, message = 0, "", ""
        if headers.get(b"content-type", b"").split(b";", 1)[0].lower() != b"text/csv":
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
            payload = json.dumps(
                {
                    "error": {"code": code, "message": message, "details": {}},
                    "request_id": str(uuid4()),
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
