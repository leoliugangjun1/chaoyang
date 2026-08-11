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

        export_match = re.fullmatch(r"/api/projects/([a-f0-9]{32})/exports/(pdf|images)", request_path)
        if export_match:
            try:
                self._send_file(PROJECT_STORE.export_visual_dashboard(export_match.group(1), export_match.group(2)))
            except (LookupError, ValueError) as error:
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": str(error)})
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

            understanding_match = re.fullmatch(r"/api/projects/([a-f0-9]{32})/product-understanding/start", request_path)
            if understanding_match:
                self._send_json(HTTPStatus.OK, self._run_stage(understanding_match.group(1), "product_understanding", PROJECT_STORE.run_product_understanding))
                return

            confirmation_match = re.fullmatch(r"/api/projects/([a-f0-9]{32})/product-understanding/confirm", request_path)
            if confirmation_match:
                self._send_json(HTTPStatus.OK, PROJECT_STORE.confirm_product_understanding(confirmation_match.group(1)))
                return

            market_match = re.fullmatch(r"/api/projects/([a-f0-9]{32})/market-analysis/start", request_path)
            if market_match:
                self._send_json(HTTPStatus.OK, self._run_stage(market_match.group(1), "market_analysis", PROJECT_STORE.run_market_analysis))
                return
            board_match = re.fullmatch(r"/api/projects/([a-f0-9]{32})/visual-dashboard/start", request_path)
            if board_match:
                self._send_json(HTTPStatus.OK, self._run_stage(board_match.group(1), "visual_dashboard", PROJECT_STORE.create_visual_dashboard))
                return
            version_match = re.fullmatch(r"/api/projects/([a-f0-9]{32})/versions/([a-f0-9]{32})/switch", request_path)
            if version_match:
                self._send_json(HTTPStatus.OK, PROJECT_STORE.switch_version(version_match.group(1), version_match.group(2)))
                return
            task_match = re.fullmatch(r"/api/projects/([a-f0-9]{32})/tasks", request_path)
            if task_match:
                payload = self._read_json()
                self._send_json(HTTPStatus.CREATED, PROJECT_STORE.create_task(task_match.group(1), str(payload.get("stage", "manual"))))
                return
            cancel_match = re.fullmatch(r"/api/projects/([a-f0-9]{32})/tasks/([a-f0-9]{32})/cancel", request_path)
            if cancel_match:
                PROJECT_STORE.cancel_task(cancel_match.group(1), cancel_match.group(2))
                self._send_json(HTTPStatus.OK, {"status": "cancelled"})
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
        understanding_match = re.fullmatch(r"/api/projects/([a-f0-9]{32})/product-understanding", request_path)
        if understanding_match:
            try:
                self._send_json(HTTPStatus.OK, PROJECT_STORE.update_product_understanding(understanding_match.group(1), self._read_json()))
            except ValueError as error:
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": str(error)})
            except LookupError as error:
                self._send_json(HTTPStatus.NOT_FOUND, {"message": str(error)})
            return
        weights_match = re.fullmatch(r"/api/projects/([a-f0-9]{32})/weights", request_path)
        if weights_match:
            try:
                payload = self._read_json()
                self._send_json(HTTPStatus.OK, PROJECT_STORE.update_weights(weights_match.group(1), payload.get("markdown"), payload.get("web")))
            except ValueError as error:
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": str(error)})
            except LookupError as error:
                self._send_json(HTTPStatus.NOT_FOUND, {"message": str(error)})
            return
        images_match = re.fullmatch(r"/api/projects/([a-f0-9]{32})/image-candidates", request_path)
        if images_match:
            try:
                payload = self._read_json()
                reviews = payload.get("reviews", {})
                if not isinstance(reviews, dict) or not all(isinstance(key, str) and isinstance(value, str) for key, value in reviews.items()):
                    raise ValueError("图片确认格式无效")
                self._send_json(HTTPStatus.OK, PROJECT_STORE.review_image_candidates(images_match.group(1), reviews))
            except ValueError as error:
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": str(error)})
            except LookupError as error:
                self._send_json(HTTPStatus.NOT_FOUND, {"message": str(error)})
            return
        board_match = re.fullmatch(r"/api/projects/([a-f0-9]{32})/visual-dashboard", request_path)
        if board_match:
            try:
                self._send_json(HTTPStatus.OK, PROJECT_STORE.update_visual_dashboard(board_match.group(1), self._read_json()))
            except ValueError as error:
                self._send_json(HTTPStatus.BAD_REQUEST, {"message": str(error)})
            except LookupError as error:
                self._send_json(HTTPStatus.NOT_FOUND, {"message": str(error)})
            return
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

    @staticmethod
    def _run_stage(project_id: str, stage: str, operation: object) -> dict[str, object]:
        task = PROJECT_STORE.create_task(project_id, stage)
        for attempt in (1, 2):
            try:
                result = operation(project_id)  # type: ignore[operator]
                PROJECT_STORE.finish_task(task["task_id"], "completed", "completed", attempts=attempt)
                return result
            except (ValueError, LookupError) as error:
                PROJECT_STORE.finish_task(task["task_id"], "failed", "failed", str(error), attempt)
                if attempt == 2:
                    raise
        raise RuntimeError("阶段执行失败")

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

    def _send_file(self, path: Path) -> None:
        data = path.read_bytes()
        content_type = "application/pdf" if path.suffix == ".pdf" else "application/zip"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Disposition", f'attachment; filename="{path.name}"')
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
