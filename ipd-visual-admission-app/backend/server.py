"""本地静态页面与最小健康检查服务。"""

from __future__ import annotations

import json
import mimetypes
import os
import re
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

from .storage import ProjectStore


APP_ROOT = Path(__file__).resolve().parents[1]
FRONTEND_ROOT = APP_ROOT / "out"
PROJECT_STORE = ProjectStore()


class ApplicationHandler(BaseHTTPRequestHandler):
    """提供静态页面和骨架阶段所需 API。"""

    server_version = "IPDVisualAdmission/0.1"

    def do_GET(self) -> None:  # noqa: N802
        request_path = urlparse(self.path).path
        if request_path == "/api/health":
            self._send_json(HTTPStatus.OK, {"status": "ok", "service": "ipd-visual-admission"})
            return
        if request_path == "/api/bootstrap":
            self._send_json(HTTPStatus.OK, {"projects": PROJECT_STORE.list_projects()})
            return
        if request_path == "/api/projects":
            self._send_json(HTTPStatus.OK, {"projects": PROJECT_STORE.list_projects()})
            return
        if request_path == "/api/skills":
            self._send_json(HTTPStatus.OK, {"skills": PROJECT_STORE.list_skills()})
            return
        project_match = re.fullmatch(r"/api/projects/([a-f0-9]{32})", request_path)
        if project_match:
            try:
                self._send_json(HTTPStatus.OK, PROJECT_STORE.get_project_or_raise(project_match.group(1)))
            except LookupError as error:
                self._send_json(HTTPStatus.NOT_FOUND, {"message": str(error)})
            return
        file_match = re.fullmatch(r"/api/projects/([a-f0-9]{32})/files/([a-f0-9]{32})", request_path)
        if file_match:
            try:
                self._send_json(HTTPStatus.OK, PROJECT_STORE.get_file_version(file_match.group(1), file_match.group(2)))
            except LookupError as error:
                self._send_json(HTTPStatus.NOT_FOUND, {"message": str(error)})
            return
        binding_match = re.fullmatch(r"/api/projects/([a-f0-9]{32})/skills", request_path)
        if binding_match:
            try:
                self._send_json(HTTPStatus.OK, {"bindings": PROJECT_STORE.get_project_bindings(binding_match.group(1))})
            except LookupError as error:
                self._send_json(HTTPStatus.NOT_FOUND, {"message": str(error)})
            return
        if request_path.startswith("/api/"):
            self._send_json(HTTPStatus.NOT_FOUND, {"message": "未找到接口"})
            return
        self._serve_static(request_path)

    def do_POST(self) -> None:  # noqa: N802
        request_path = urlparse(self.path).path
        try:
            if request_path == "/api/projects":
                payload = self._read_json()
                self._send_json(HTTPStatus.CREATED, PROJECT_STORE.create_project(str(payload.get("name", ""))))
                return
            if request_path.startswith("/api/projects/") and request_path.endswith("/validation-tasks"):
                project_id = request_path.split("/")[3]
                payload = self._read_json()
                self._send_json(HTTPStatus.CREATED, PROJECT_STORE.create_validation_task(project_id, payload.get("file_version_id")))
                return
            upload_match = re.fullmatch(r"/api/projects/([a-f0-9]{32})/files", request_path)
            if upload_match:
                upload = self._read_multipart_file()
                self._send_json(
                    HTTPStatus.CREATED,
                    PROJECT_STORE.save_excel(upload_match.group(1), upload["filename"], upload["content"]),
                )
                return
            skill_match = re.fullmatch(r"/api/projects/([a-f0-9]{32})/skills", request_path)
            if skill_match:
                payload = self._read_json()
                self._send_json(HTTPStatus.OK, PROJECT_STORE.bind_skill(skill_match.group(1), str(payload.get("skill_id", ""))))
                return
            self._send_json(HTTPStatus.NOT_FOUND, {"message": "未找到接口"})
        except ValueError as error:
            self._send_json(HTTPStatus.BAD_REQUEST, {"message": str(error)})
        except LookupError as error:
            self._send_json(HTTPStatus.NOT_FOUND, {"message": str(error)})

    def _read_json(self) -> dict[str, object]:
        if "application/json" not in self.headers.get("Content-Type", ""):
            raise ValueError("请求格式应为 JSON")
        try:
            payload = json.loads(self._read_body().decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ValueError("JSON 请求内容无效") from error
        if not isinstance(payload, dict):
            raise ValueError("JSON 请求内容无效")
        return payload

    def _read_multipart_file(self) -> dict[str, object]:
        content_type = self.headers.get("Content-Type", "")
        boundary_match = re.search(r"boundary=([^;]+)", content_type)
        if "multipart/form-data" not in content_type or boundary_match is None:
            raise ValueError("请求格式应为 multipart/form-data")
        boundary = boundary_match.group(1).strip('"').encode("utf-8")
        uploads: list[dict[str, object]] = []
        for part in self._read_body().split(b"--" + boundary):
            if b"Content-Disposition:" not in part or b"\r\n\r\n" not in part:
                continue
            headers, content = part.split(b"\r\n\r\n", 1)
            filename_match = re.search(r'filename="([^"]*)"', headers.decode("utf-8", errors="replace"))
            if filename_match is None or not filename_match.group(1):
                continue
            uploads.append({"filename": filename_match.group(1), "content": content[:-2] if content.endswith(b"\r\n") else content})
        if len(uploads) != 1:
            raise ValueError("每次只能上传一个固定模板 Excel 文件")
        return uploads[0]

    def _read_body(self) -> bytes:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as error:
            raise ValueError("请求长度无效") from error
        if length <= 0:
            raise ValueError("请求内容为空")
        if length > 25 * 1024 * 1024:
            raise ValueError("单次上传不能超过 25 MB")
        return self.rfile.read(length)

    def _serve_static(self, request_path: str) -> None:
        requested = "index.html" if request_path in {"", "/"} else unquote(request_path.lstrip("/"))
        candidate = (FRONTEND_ROOT / requested).resolve()
        if FRONTEND_ROOT not in candidate.parents and candidate != FRONTEND_ROOT:
            self._send_json(HTTPStatus.FORBIDDEN, {"message": "不允许访问该文件"})
            return
        if not candidate.is_file():
            candidate = FRONTEND_ROOT / "index.html"
        if not candidate.is_file():
            self._send_json(HTTPStatus.SERVICE_UNAVAILABLE, {"message": "前端尚未构建"})
            return
        data = candidate.read_bytes()
        content_type = mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
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
    port = int(os.environ.get("APP_PORT", "4180"))
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
