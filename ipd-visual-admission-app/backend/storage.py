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
                CREATE TABLE IF NOT EXISTS skills (
                    skill_id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    skill_type TEXT NOT NULL,
                    version TEXT NOT NULL,
                    content TEXT NOT NULL,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    UNIQUE(skill_type, version)
                );
                CREATE TABLE IF NOT EXISTS project_skills (
                    project_id TEXT NOT NULL REFERENCES projects(project_id),
                    skill_type TEXT NOT NULL,
                    skill_id TEXT NOT NULL REFERENCES skills(skill_id),
                    bound_version TEXT NOT NULL,
                    bound_content TEXT NOT NULL,
                    bound_at TEXT NOT NULL,
                    PRIMARY KEY(project_id, skill_type)
                );
                CREATE TABLE IF NOT EXISTS stage_results (
                    task_id TEXT NOT NULL REFERENCES validation_tasks(task_id),
                    stage TEXT NOT NULL,
                    result_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY(task_id, stage)
                );
                CREATE TABLE IF NOT EXISTS admission_reports (
                    review_id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL REFERENCES projects(project_id),
                    task_id TEXT NOT NULL REFERENCES validation_tasks(task_id),
                    report_json TEXT NOT NULL,
                    report_markdown TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                """
            )
            connection.commit()
        self._seed_published_skill()

    def _seed_published_skill(self) -> None:
        skill_path = self.data_root.parent / "docs" / "ipd-visual-admission-review" / "SKILL.md"
        if not skill_path.is_file():
            skill_path = APP_ROOT / "docs" / "ipd-visual-admission-review" / "SKILL.md"
        if not skill_path.is_file():
            return
        content = skill_path.read_text(encoding="utf-8")
        with closing(self._connect()) as connection:
            exists = connection.execute("SELECT 1 FROM skills WHERE skill_type = 'visual_admission' AND version = 'V1.0'").fetchone()
            if exists is None:
                connection.execute(
                    "INSERT INTO skills (skill_id, name, skill_type, version, content, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    ("ipd-visual-admission-review-v1", "IPD 产品视觉准入审核", "visual_admission", "V1.0", content, "published", _utc_now()),
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

    def list_skills(self, include_archived: bool = False) -> list[dict[str, Any]]:
        query = "SELECT skill_id, name, skill_type, version, status, created_at FROM skills"
        params: tuple[object, ...] = ()
        if not include_archived:
            query += " WHERE status = 'published'"
        query += " ORDER BY created_at DESC"
        with closing(self._connect()) as connection:
            rows = connection.execute(query, params).fetchall()
        return [dict(row) for row in rows]

    def bind_skill(self, project_id: str, skill_id: str) -> dict[str, Any]:
        self.get_project_or_raise(project_id)
        with closing(self._connect()) as connection:
            skill = connection.execute("SELECT * FROM skills WHERE skill_id = ? AND status = 'published'", (skill_id,)).fetchone()
            if skill is None:
                raise LookupError("未找到可绑定的已发布 Skill")
            connection.execute(
                """
                INSERT INTO project_skills (project_id, skill_type, skill_id, bound_version, bound_content, bound_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(project_id, skill_type) DO UPDATE SET skill_id=excluded.skill_id,
                    bound_version=excluded.bound_version, bound_content=excluded.bound_content, bound_at=excluded.bound_at
                """,
                (project_id, skill["skill_type"], skill["skill_id"], skill["version"], skill["content"], _utc_now()),
            )
            connection.commit()
        return self.get_project_or_raise(project_id)

    def get_project_bindings(self, project_id: str) -> list[dict[str, Any]]:
        with closing(self._connect()) as connection:
            rows = connection.execute(
                "SELECT skill_id, skill_type, bound_version, bound_at FROM project_skills WHERE project_id = ?",
                (project_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    def create_validation_task(self, project_id: str, file_version_id: str | None) -> dict[str, Any]:
        self.get_project_or_raise(project_id)
        if not file_version_id:
            raise ValueError("启动审核前必须选择 Excel 文件")
        file_version = self.get_file_version(project_id, file_version_id)
        if file_version["parser_status"] != "parsed":
            raise ValueError("Excel 尚未解析成功，无法启动审核")
        if not self.get_project_bindings(project_id):
            raise ValueError("启动审核前必须绑定已发布 Skill")
        return self.create_task(project_id, file_version_id, "queued")

    def update_task(self, task_id: str, *, stage: str, status: str, progress: int, error_code: str | None = None) -> None:
        with closing(self._connect()) as connection:
            connection.execute(
                "UPDATE validation_tasks SET stage = ?, status = ?, progress = ?, error_code = ?, updated_at = ? WHERE task_id = ?",
                (stage, status, progress, error_code, _utc_now(), task_id),
            )
            connection.commit()

    def save_stage_result(self, task_id: str, stage: str, result: dict[str, Any]) -> None:
        with closing(self._connect()) as connection:
            connection.execute(
                "INSERT OR REPLACE INTO stage_results (task_id, stage, result_json, created_at) VALUES (?, ?, ?, ?)",
                (task_id, stage, json.dumps(result, ensure_ascii=False), _utc_now()),
            )
            connection.commit()

    def get_task(self, project_id: str, task_id: str) -> dict[str, Any]:
        with closing(self._connect()) as connection:
            task = connection.execute("SELECT * FROM validation_tasks WHERE project_id = ? AND task_id = ?", (project_id, task_id)).fetchone()
            if task is None:
                raise LookupError("未找到对应审核任务")
            results = connection.execute("SELECT stage, result_json FROM stage_results WHERE task_id = ? ORDER BY created_at", (task_id,)).fetchall()
        return {**dict(task), "stage_results": {row["stage"]: json.loads(row["result_json"]) for row in results}}

    def cancel_task(self, project_id: str, task_id: str) -> dict[str, Any]:
        self.get_task(project_id, task_id)
        with closing(self._connect()) as connection:
            connection.execute("DELETE FROM stage_results WHERE task_id = ?", (task_id,))
            connection.execute("DELETE FROM admission_reports WHERE task_id = ?", (task_id,))
            connection.commit()
        self.update_task(task_id, stage="cancelled", status="cancelled", progress=0, error_code="TASK_CANCELLED")
        return self.get_task(project_id, task_id)

    def retry_task(self, project_id: str, task_id: str) -> dict[str, Any]:
        task = self.get_task(project_id, task_id)
        if task["status"] not in {"failed", "manual_review"}:
            raise ValueError("只有失败或待人工确认任务可以重试")
        return self.create_validation_task(project_id, task["file_version_id"])

    def save_report(self, project_id: str, task_id: str, report: dict[str, Any], markdown: str) -> dict[str, Any]:
        review_id = str(report["review_id"])
        with closing(self._connect()) as connection:
            connection.execute(
                "INSERT OR REPLACE INTO admission_reports (review_id, project_id, task_id, report_json, report_markdown, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (review_id, project_id, task_id, json.dumps(report, ensure_ascii=False), markdown, _utc_now()),
            )
            connection.commit()
        return report

    def get_report(self, project_id: str, review_id: str) -> dict[str, Any]:
        with closing(self._connect()) as connection:
            row = connection.execute("SELECT report_json, report_markdown FROM admission_reports WHERE project_id = ? AND review_id = ?", (project_id, review_id)).fetchone()
        if row is None:
            raise LookupError("未找到对应准入报告")
        return {"report": json.loads(row["report_json"]), "markdown": row["report_markdown"]}

    def list_reports(self, project_id: str) -> list[dict[str, Any]]:
        with closing(self._connect()) as connection:
            rows = connection.execute(
                "SELECT review_id, task_id, created_at, json_extract(report_json, '$.admission_status') AS admission_status FROM admission_reports WHERE project_id = ? ORDER BY created_at DESC",
                (project_id,),
            ).fetchall()
        return [dict(row) for row in rows]
