"""Adapter for the existing local excel-parser runtime."""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any


APP_ROOT = Path(__file__).resolve().parents[1]
WORKER_PATH = Path(__file__).with_name("excel_parser_worker.py")
DEFAULT_PARSER_PYTHON = (
    APP_ROOT.parent / "excel-parser-mcp" / ".venv" / "Scripts" / "python.exe"
)


class ExcelParserError(ValueError):
    """Raised when a workbook cannot be parsed into a source snapshot."""


class ExcelParserAdapter:
    """Runs excel_parser out of process to keep the app runtime dependency-free."""

    def __init__(self, parser_python: str | None = None) -> None:
        configured = parser_python or os.environ.get("EXCEL_PARSER_PYTHON")
        self.parser_python = Path(configured) if configured else DEFAULT_PARSER_PYTHON

    def parse(self, source_path: Path) -> dict[str, Any]:
        if not self.parser_python.is_file():
            raise ExcelParserError("Excel Parser 本地运行时不可用，请配置 EXCEL_PARSER_PYTHON")
        try:
            environment = {**os.environ, "PYTHONUTF8": "1"}
            completed = subprocess.run(
                [str(self.parser_python), str(WORKER_PATH), str(source_path)],
                capture_output=True,
                check=False,
                encoding="utf-8",
                errors="replace",
                env=environment,
                timeout=120,
            )
        except subprocess.TimeoutExpired as error:
            raise ExcelParserError("Excel Parser 处理超时，请检查文件规模") from error
        except OSError as error:
            raise ExcelParserError("Excel Parser 本地运行时无法启动") from error

        if completed.returncode != 0:
            message = completed.stderr.strip() or "Excel Parser 未返回可用结果"
            raise ExcelParserError(f"Excel 解析失败：{message[:300]}")
        try:
            payload = json.loads(completed.stdout)
        except json.JSONDecodeError as error:
            raise ExcelParserError("Excel Parser 输出格式无效") from error
        if not isinstance(payload, dict) or not isinstance(payload.get("chunks"), list):
            raise ExcelParserError("Excel Parser 输出缺少资料块")
        return payload
