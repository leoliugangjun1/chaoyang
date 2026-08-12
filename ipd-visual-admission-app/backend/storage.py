"""SQLite persistence for immutable source files and parser snapshots."""

from __future__ import annotations

import json
import os
import sqlite3
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from .excel_parser_adapter import ExcelParserAdapter, ExcelParserError


APP_ROOT = Path(__file__).resolve().parents[1]
DATA_ROOT = Path(os.environ.get("APP_DATA_ROOT", APP_ROOT / "data")).resolve()
DATABASE_PATH = DATA_ROOT / "ipd_visual_admission.sqlite3"
MAX_UPLOAD_BYTES = 25 * 1024 * 1024


def _utc_now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


class ProjectStore:
    """Owns durable project metadata, file versions, tasks and source snapshots."""

    def __init__(self, data_root: Path | None = None, parser: ExcelParserAdapter | None = None) -> None:
        self.data_root = (data_root or DATA_ROOT).resolve()
        self.database_path = self.data_root / DATABASE_PATH.name
        self.files_root = self.data_root / "files"
        self.snapshots_root = self.data_root / "snapshots"
        self.parser = parser or ExcelParserAdapter()
        self.data_root.mkdir(parents=True, exist_ok=True)
        self.files_root.mkdir(exist_ok=True)
        self.snapshots_root.mkdir(exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    def _initialize(self) -> None:
        with closing(self._connect()) as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS projects (
                    project_id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS file_versions (
                    file_version_id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL REFERENCES projects(project_id),
                    original_name TEXT NOT NULL,
                    stored_path TEXT NOT NULL UNIQUE,
                    snapshot_path TEXT,
                    byte_size INTEGER NOT NULL,
                    parser_status TEXT NOT NULL,
                    parser_error TEXT,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS validation_tasks (
                    task_id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL REFERENCES projects(project_id),
                    file_version_id TEXT REFERENCES file_versions(file_version_id),
                    stage TEXT NOT NULL,
                    status TEXT NOT NULL,
                    progress INTEGER NOT NULL DEFAULT 0,
                    error_code TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                """
            )
            connection.commit()

    def create_project(self, name: str) -> dict[str, Any]:
        cleaned_name = name.strip()
        if not 1 <= len(cleaned_name) <= 80:
            raise ValueError("项目名称应为 1 至 80 个字符")
        project_id = uuid4().hex
        created_at = _utc_now()
        with closing(self._connect()) as connection:
            connection.execute(
                "INSERT INTO projects (project_id, name, created_at) VALUES (?, ?, ?)",
                (project_id, cleaned_name, created_at),
            )
            connection.commit()
        return self.get_project_or_raise(project_id)

    def list_projects(self) -> list[dict[str, Any]]:
        with closing(self._connect()) as connection:
            rows = connection.execute(
                """
                SELECT p.project_id, p.name, p.created_at, COUNT(f.file_version_id) AS file_count
                FROM projects p
                LEFT JOIN file_versions f ON f.project_id = p.project_id
                GROUP BY p.project_id
                ORDER BY p.created_at DESC
                """
            ).fetchall()
        return [dict(row) for row in rows]

    def get_project_or_raise(self, project_id: str) -> dict[str, Any]:
        with closing(self._connect()) as connection:
            project = connection.execute(
                "SELECT project_id, name, created_at FROM projects WHERE project_id = ?", (project_id,)
            ).fetchone()
            if project is None:
                raise LookupError("未找到对应项目")
            files = connection.execute(
                """
                SELECT file_version_id, original_name, byte_size, parser_status, parser_error, created_at
                FROM file_versions WHERE project_id = ? ORDER BY created_at DESC
                """,
                (project_id,),
            ).fetchall()
        return {**dict(project), "files": [dict(file) for file in files]}

    def save_excel(self, project_id: str, filename: str, content: bytes) -> dict[str, Any]:
        self.get_project_or_raise(project_id)
        original_name = Path(filename).name
        if not original_name or Path(original_name).suffix.lower() != ".xlsx":
            raise ValueError("仅支持固定模板 .xlsx 文件")
        if not content:
            raise ValueError("上传文件为空")
        if len(content) > MAX_UPLOAD_BYTES:
            raise ValueError("单个 Excel 文件不能超过 25 MB")

        file_version_id = uuid4().hex
        project_file_root = self.files_root / project_id
        project_snapshot_root = self.snapshots_root / project_id
        project_file_root.mkdir(parents=True, exist_ok=True)
        project_snapshot_root.mkdir(parents=True, exist_ok=True)
        stored_path = project_file_root / f"{file_version_id}.xlsx"
        snapshot_path = project_snapshot_root / f"{file_version_id}.json"
        stored_path.write_bytes(content)
        created_at = _utc_now()
        parser_status = "parsed"
        parser_error: str | None = None
        try:
            snapshot = self.parser.parse(stored_path)
            snapshot_path.write_text(json.dumps(snapshot, ensure_ascii=False), encoding="utf-8")
        except ExcelParserError as error:
            parser_status = "failed"
            parser_error = str(error)

        with closing(self._connect()) as connection:
            connection.execute(
                """
                INSERT INTO file_versions
                (file_version_id, project_id, original_name, stored_path, snapshot_path, byte_size, parser_status, parser_error, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    file_version_id,
                    project_id,
                    original_name,
                    str(stored_path),
                    str(snapshot_path) if parser_status == "parsed" else None,
                    len(content),
                    parser_status,
                    parser_error,
                    created_at,
                ),
            )
            connection.commit()
        return self.get_file_version(project_id, file_version_id)

    def get_file_version(self, project_id: str, file_version_id: str) -> dict[str, Any]:
        with closing(self._connect()) as connection:
            row = connection.execute(
                """
                SELECT file_version_id, project_id, original_name, byte_size, parser_status, parser_error, created_at, snapshot_path
                FROM file_versions WHERE project_id = ? AND file_version_id = ?
                """,
                (project_id, file_version_id),
            ).fetchone()
        if row is None:
            raise LookupError("未找到对应文件版本")
        result = dict(row)
        snapshot_path = result.pop("snapshot_path")
        result["snapshot"] = None
        if snapshot_path:
            try:
                result["snapshot"] = json.loads(Path(snapshot_path).read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                result["parser_status"] = "failed"
                result["parser_error"] = "解析快照无法读取"
        return result

    def create_task(self, project_id: str, file_version_id: str | None, stage: str = "queued") -> dict[str, Any]:
        self.get_project_or_raise(project_id)
        if file_version_id:
            self.get_file_version(project_id, file_version_id)
        task_id = uuid4().hex
        timestamp = _utc_now()
        with closing(self._connect()) as connection:
            connection.execute(
                """
                INSERT INTO validation_tasks (task_id, project_id, file_version_id, stage, status, progress, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (task_id, project_id, file_version_id, stage, "queued", 0, timestamp, timestamp),
            )
            connection.commit()
        return {"task_id": task_id, "project_id": project_id, "file_version_id": file_version_id, "stage": stage, "status": "queued", "progress": 0}
