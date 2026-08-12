"""Integration checks for immutable Excel file versions and parser snapshots."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from backend.excel_parser_adapter import ExcelParserAdapter
from backend.storage import ProjectStore


class StorageIntegrationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        parser_python = Path(r"C:\Users\Administrator\Documents\默认项目\excel-parser-mcp\.venv\Scripts\python.exe")
        self.store = ProjectStore(self.root, ExcelParserAdapter(str(parser_python)))

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_project_upload_snapshot_and_immutable_versions(self) -> None:
        project = self.store.create_project("测试审核项目")
        workbook = self._create_workbook()

        first = self.store.save_excel(project["project_id"], "审核资料.xlsx", workbook)
        second = self.store.save_excel(project["project_id"], "审核资料.xlsx", workbook)

        self.assertEqual(first["parser_status"], "parsed")
        self.assertNotEqual(first["file_version_id"], second["file_version_id"])
        self.assertIn("chunks", first["snapshot"])
        self.assertGreater(len(first["snapshot"]["chunks"]), 0)
        self.assertIn("#", first["snapshot"]["chunks"][0]["source_uri"])
        self.assertIn("!A1:C2", first["snapshot"]["chunks"][0]["source_uri"])
        loaded = self.store.get_project_or_raise(project["project_id"])
        self.assertEqual(len(loaded["files"]), 2)

    def test_empty_and_wrong_extension_are_rejected(self) -> None:
        project = self.store.create_project("测试审核项目")
        with self.assertRaisesRegex(ValueError, "固定模板"):
            self.store.save_excel(project["project_id"], "审核资料.csv", b"x")
        with self.assertRaisesRegex(ValueError, "为空"):
            self.store.save_excel(project["project_id"], "审核资料.xlsx", b"")

    def _create_workbook(self) -> bytes:
        fixture = self.root / "fixture.xlsx"
        script = (
            "from openpyxl import Workbook; "
            "workbook = Workbook(); "
            "sheet = workbook.active; sheet.title = '资料'; "
            "sheet.append(['SKU', '核心卖点', '证据']); "
            "sheet.append(['LP-001-V2', '6.5cm 加宽腰头', '检测报告 A-01']); "
            f"workbook.save(r'{fixture}')"
        )
        parser_python = self.store.parser.parser_python
        import subprocess
        subprocess.run([str(parser_python), "-c", script], check=True)
        return fixture.read_bytes()


if __name__ == "__main__":
    unittest.main()
