"""本地 Web 服务的最小入口，后续任务在此扩展 API 路由。"""

from __future__ import annotations

import json
import mimetypes
import os
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse


APP_ROOT = Path(__file__).resolve().parents[1]
FRONTEND_ROOT = APP_ROOT / "frontend"


class ApplicationHandler(BaseHTTPRequestHandler):
    """提供静态界面和当前阶段需要的本地 API。"""

    server_version = "VisualResearchWorkbench/0.1"

    def do_GET(self) -> None:  # noqa: N802
        request_path = urlparse(self.path).path
        if request_path == "/api/health":
            self._send_json(HTTPStatus.OK, {"status": "ok", "service": "local"})
            return

        if request_path == "/api/bootstrap":
            self._send_json(
                HTTPStatus.OK,
                {"projects": [], "message": "尚未创建项目"},
            )
            return

        if request_path.startswith("/api/"):
            self._send_json(HTTPStatus.NOT_FOUND, {"message": "未找到接口"})
            return

        self._serve_static(request_path)

    def _serve_static(self, request_path: str) -> None:
        requested = "index.html" if request_path in {"", "/"} else unquote(request_path.lstrip("/"))
        candidate = (FRONTEND_ROOT / requested).resolve()
        if FRONTEND_ROOT not in candidate.parents and candidate != FRONTEND_ROOT:
            self._send_json(HTTPStatus.FORBIDDEN, {"message": "不允许访问该文件"})
            return

        if not candidate.is_file():
            candidate = FRONTEND_ROOT / "index.html"

        content_type = mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
        data = candidate.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", f"{content_type}; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send_json(self, status: HTTPStatus, payload: dict[str, object]) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format: str, *args: object) -> None:
        print(f"{self.address_string()} - {format % args}")


def main() -> None:
    port = int(os.environ.get("APP_PORT", "4173"))
    server = ThreadingHTTPServer(("127.0.0.1", port), ApplicationHandler)
    print(f"本地应用已启动：http://127.0.0.1:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("本地应用已停止")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
