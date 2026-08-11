"""本地 Web 服务的最小入口，后续任务在此扩展 API 路由。"""

from __future__ import annotations

import json
import mimetypes
import os
import re
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from app.backend.storage import ProjectStore


APP_ROOT = Path(__file__).resolve().parents[1]
FRONTEND_ROOT = APP_ROOT / "frontend"
PROJECT_STORE = ProjectStore()


class ApplicationHandler(BaseHTTPRequestHandler):
    """提供静态界面和当前阶段需要的本地 API。"""

    server_version = "VisualResearchWorkbench/0.1"

    def do_GET(self) -> None:  # noqa: N802
        parsed_url = urlparse(self.path)
        request_path = parsed_url.path
        if request_path == "/api/health":
            self._send_json(HTTPStatus.OK, {"status": "ok", "service": "local"})
            return

        if request_path == "/api/bootstrap":
            self._send_json(
                HTTPStatus.OK,
                {"projects": PROJECT_STORE.list_projects()},
            )
            return

        if request_path == "/api/projects":
            self._send_json(HTTPStatus.OK, {"projects": PROJECT_STORE.list_projects()})
            return

        if request_path == "/api/rules":
            query = parse_qs(parsed_url.query)
            rule_type = query.get("type", [None])[0]
            include_archived = query.get("include_archived", ["false"])[0] == "true"
            self._send_json(HTTPStatus.OK, {"rules": PROJECT_STORE.list_rules(rule_type, include_archived)})
            return

        project_match = re.fullmatch(r"/api/projects/([a-f0-9]{32})", request_path)
        if project_match:
            project = PROJECT_STORE.get_project(project_match.group(1))
            if project is None:
                self._send_json(HTTPStatus.NOT_FOUND, {"message": "未找到对应项目"})
                return
            self._send_json(HTTPStatus.OK, project)
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
                project = PROJECT_STORE.create_project(str(payload.get("name", "")))
                self._send_json(HTTPStatus.CREATED, project)
                return

            if request_path == "/api/rules":
                payload = self._read_json()
                rule = PROJECT_STORE.create_rule(
                    str(payload.get("name", "")),
                    str(payload.get("rule_type", "")),
                    str(payload.get("content", "")),
                    str(payload.get("version", "1.0")),
                )
                self._send_json(HTTPStatus.CREATED, rule)
                return

            upload_match = re.fullmatch(r"/api/projects/([a-f0-9]{32})/files", request_path)
            if upload_match:
                project = PROJECT_STORE.save_uploads(upload_match.group(1), self._read_multipart_files())
                self._send_json(HTTPStatus.CREATED, project)
                return

            bindings_match = re.fullmatch(r"/api/projects/([a-f0-9]{32})/rules", request_path)
            if bindings_match:
                payload = self._read_json()
                bindings = payload.get("bindings", {})
                if not isinstance(bindings, dict) or not all(isinstance(value, str) for value in bindings.values()):
                    raise ValueError("规则绑定格式无效")
                project = PROJECT_STORE.bind_rules(bindings_match.group(1), bindings)
                self._send_json(HTTPStatus.OK, project)
                return

            self._send_json(HTTPStatus.NOT_FOUND, {"message": "未找到接口"})
        except ValueError as error:
            self._send_json(HTTPStatus.BAD_REQUEST, {"message": str(error)})
        except LookupError as error:
            self._send_json(HTTPStatus.NOT_FOUND, {"message": str(error)})
        except Exception as error:  # noqa: BLE001
            print(f"服务错误：{error}")
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"message": "本地文件保存失败"})

    def do_PATCH(self) -> None:  # noqa: N802
        request_path = urlparse(self.path).path
        rename_match = re.fullmatch(r"/api/rules/([a-f0-9]{32})", request_path)
        if rename_match:
            try:
                payload = self._read_json()
                self._send_json(HTTPStatus.OK, PROJECT_STORE.update_rule_name(rename_match.group(1), str(payload.get("name", ""))))
            except ValueError as error:
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": str(error)})
            except LookupError as error:
                self._send_json(HTTPStatus.NOT_FOUND, {"message": str(error)})
            return
        archive_match = re.fullmatch(r"/api/rules/([a-f0-9]{32})/archive", request_path)
        if archive_match is None:
            self._send_json(HTTPStatus.NOT_FOUND, {"message": "未找到接口"})
            return
        try:
            self._send_json(HTTPStatus.OK, PROJECT_STORE.archive_rule(archive_match.group(1)))
        except LookupError as error:
            self._send_json(HTTPStatus.NOT_FOUND, {"message": str(error)})

    def _read_json(self) -> dict[str, object]:
        content_type = self.headers.get("Content-Type", "")
        if "application/json" not in content_type:
            raise ValueError("请求格式应为 JSON")
        try:
            return json.loads(self._read_body().decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ValueError("JSON 请求内容无效") from error

    def _read_multipart_files(self) -> list[dict[str, object]]:
        content_type = self.headers.get("Content-Type", "")
        boundary_match = re.search(r"boundary=([^;]+)", content_type)
        if "multipart/form-data" not in content_type or boundary_match is None:
            raise ValueError("请求格式应为 multipart/form-data")
        boundary = boundary_match.group(1).strip('"').encode("utf-8")
        uploads: list[dict[str, object]] = []
        for part in self._read_body().split(b"--" + boundary):
            if b"Content-Disposition:" not in part or b"\r\n\r\n" not in part:
                continue
            header_bytes, content = part.split(b"\r\n\r\n", 1)
            disposition = header_bytes.decode("utf-8", errors="replace")
            filename_match = re.search(r'filename="([^"]*)"', disposition)
            if filename_match is None or not filename_match.group(1):
                continue
            if content.endswith(b"\r\n"):
                content = content[:-2]
            uploads.append({
                "filename": filename_match.group(1),
                "content": content,
            })
        return uploads

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
