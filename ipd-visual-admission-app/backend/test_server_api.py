"""HTTP-level checks for the project and fixed-template upload routes."""

from __future__ import annotations

import json
import subprocess
import tempfile
import threading
import unittest
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path

from backend import server
from backend.excel_parser_adapter import ExcelParserAdapter
from backend.storage import ProjectStore


class ServerApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        parser_python = r"C:\Users\Administrator\Documents\默认项目\excel-parser-mcp\.venv\Scripts\python.exe"
        server.PROJECT_STORE = ProjectStore(Path(self.temp_dir.name), ExcelParserAdapter(parser_python))
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.ApplicationHandler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=2)
        self.temp_dir.cleanup()

    def test_create_upload_and_read_snapshot(self) -> None:
        status, payload = self._request_json("POST", "/api/projects", {"name": "接口验证项目"})
        self.assertEqual(status, 201)
        project_id = payload["project_id"]

        status, file_payload = self._upload(project_id, "审核资料.xlsx", self._workbook_bytes())
        self.assertEqual(status, 201)
        self.assertEqual(file_payload["parser_status"], "parsed")

        status, loaded = self._request_json("GET", f"/api/projects/{project_id}/files/{file_payload['file_version_id']}")
        self.assertEqual(status, 200)
        self.assertGreater(len(loaded["snapshot"]["chunks"]), 0)

    def test_empty_project_and_invalid_file_are_visible(self) -> None:
        status, payload = self._request_json("GET", "/api/bootstrap")
        self.assertEqual(status, 200)
        self.assertEqual(payload["projects"], [])

        _, project = self._request_json("POST", "/api/projects", {"name": "错误验证项目"})
        status, error = self._upload(project["project_id"], "审核资料.txt", b"not an excel file")
        self.assertEqual(status, 400)
        self.assertIn("固定模板", error["message"])

    def _request_json(self, method: str, path: str, payload: dict[str, object] | None = None) -> tuple[int, dict[str, object]]:
        body = json.dumps(payload).encode("utf-8") if payload is not None else None
        connection = HTTPConnection("127.0.0.1", self.httpd.server_port, timeout=10)
        connection.request(method, path, body, {"Content-Type": "application/json"} if body else {})
        response = connection.getresponse()
        data = json.loads(response.read().decode("utf-8"))
        connection.close()
        return response.status, data

    def _upload(self, project_id: str, filename: str, content: bytes) -> tuple[int, dict[str, object]]:
        boundary = "----ipd-upload-boundary"
        body = b"".join([
            f"--{boundary}\r\n".encode(),
            f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'.encode(),
            b"Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n",
            content,
            f"\r\n--{boundary}--\r\n".encode(),
        ])
        connection = HTTPConnection("127.0.0.1", self.httpd.server_port, timeout=30)
        connection.request("POST", f"/api/projects/{project_id}/files", body, {"Content-Type": f"multipart/form-data; boundary={boundary}"})
        response = connection.getresponse()
        data = json.loads(response.read().decode("utf-8"))
        connection.close()
        return response.status, data

    def _workbook_bytes(self) -> bytes:
        fixture = Path(self.temp_dir.name) / "fixture.xlsx"
        parser_python = server.PROJECT_STORE.parser.parser_python
        script = (
            "from openpyxl import Workbook; "
            "workbook = Workbook(); sheet = workbook.active; sheet.title = '资料'; "
            "sheet.append(['SKU', '核心卖点']); sheet.append(['LP-001-V2', '6.5cm 加宽腰头']); "
            f"workbook.save(r'{fixture}')"
        )
        subprocess.run([str(parser_python), "-c", script], check=True)
        return fixture.read_bytes()


if __name__ == "__main__":
    unittest.main()
