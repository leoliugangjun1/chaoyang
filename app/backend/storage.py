"""项目、版本和本地文件的持久化服务。"""

from __future__ import annotations

import json
import re
import shutil
import sqlite3
import uuid
import zipfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from xml.etree import ElementTree


APP_ROOT = Path(__file__).resolve().parents[1]
DATA_ROOT = APP_ROOT / "data"
PROJECTS_ROOT = APP_ROOT / "projects"
DATABASE_PATH = DATA_ROOT / "visual_research.db"


def now() -> str:
    return datetime.now(UTC).isoformat()


class ProjectStore:
    def __init__(self) -> None:
        DATA_ROOT.mkdir(parents=True, exist_ok=True)
        PROJECTS_ROOT.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connection(self) -> sqlite3.Connection:
        connection = sqlite3.connect(DATABASE_PATH)
        connection.row_factory = sqlite3.Row
        return connection

    def _initialize(self) -> None:
        with self._connection() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS projects (
                    project_id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    current_version_id TEXT
                );
                CREATE TABLE IF NOT EXISTS project_versions (
                    version_id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    version_number TEXT NOT NULL,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    weights_json TEXT NOT NULL,
                    FOREIGN KEY(project_id) REFERENCES projects(project_id)
                );
                CREATE TABLE IF NOT EXISTS project_files (
                    file_id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    version_id TEXT NOT NULL,
                    original_name TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    relative_path TEXT NOT NULL,
                    size_bytes INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(project_id) REFERENCES projects(project_id),
                    FOREIGN KEY(version_id) REFERENCES project_versions(version_id)
                );
                """
            )

    def list_projects(self) -> list[dict[str, Any]]:
        with self._connection() as connection:
            rows = connection.execute(
                "SELECT * FROM projects ORDER BY updated_at DESC"
            ).fetchall()
        return [dict(row) for row in rows]

    def create_project(self, name: str) -> dict[str, Any]:
        name = name.strip()
        if not name:
            raise ValueError("项目名称不能为空")
        project_id = uuid.uuid4().hex
        version_id = uuid.uuid4().hex
        timestamp = now()
        version_dir = self._version_dir(project_id, version_id)
        self._create_version_directories(version_dir)
        with self._connection() as connection:
            connection.execute(
                "INSERT INTO projects VALUES (?, ?, ?, ?, ?)",
                (project_id, name, timestamp, timestamp, version_id),
            )
            connection.execute(
                "INSERT INTO project_versions VALUES (?, ?, ?, ?, ?, ?)",
                (version_id, project_id, "1.0", "active", timestamp, '{"markdown": 8, "web": 2}'),
            )
        return self.get_project(project_id)

    def get_project(self, project_id: str) -> dict[str, Any] | None:
        with self._connection() as connection:
            project = connection.execute(
                "SELECT * FROM projects WHERE project_id = ?", (project_id,)
            ).fetchone()
            if project is None:
                return None
            versions = connection.execute(
                "SELECT * FROM project_versions WHERE project_id = ? ORDER BY created_at DESC",
                (project_id,),
            ).fetchall()
            files = connection.execute(
                "SELECT * FROM project_files WHERE project_id = ? ORDER BY created_at ASC",
                (project_id,),
            ).fetchall()
        payload = dict(project)
        payload["versions"] = [self._version_payload(row) for row in versions]
        payload["files"] = [dict(row) for row in files]
        return payload

    def save_uploads(self, project_id: str, uploads: list[dict[str, Any]]) -> dict[str, Any]:
        project = self.get_project(project_id)
        if project is None:
            raise LookupError("未找到对应项目")
        if not uploads:
            raise ValueError("请至少选择一个文件")

        version_id, version_dir = self._fork_version(project)
        file_rows: list[tuple[Any, ...]] = []
        for upload in uploads:
            original_name = str(upload["filename"])
            content = bytes(upload["content"])
            kind = self._classify_upload(original_name)
            destination = self._destination_for_upload(version_dir, kind, original_name)
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(content)
            relative_path = destination.relative_to(PROJECTS_ROOT).as_posix()
            file_rows.append(
                (uuid.uuid4().hex, project_id, version_id, original_name, kind, relative_path, len(content), now())
            )
            if kind == "excel":
                converted = version_dir / "source" / "excel-converted.md"
                converted.write_text(self._xlsx_to_markdown(content), encoding="utf-8")
                converted_relative_path = converted.relative_to(PROJECTS_ROOT).as_posix()
                file_rows.append(
                    (uuid.uuid4().hex, project_id, version_id, f"{Path(original_name).stem}.md", "converted_markdown", converted_relative_path, converted.stat().st_size, now())
                )

        with self._connection() as connection:
            connection.executemany(
                "INSERT INTO project_files VALUES (?, ?, ?, ?, ?, ?, ?, ?)", file_rows
            )
            connection.execute(
                "UPDATE projects SET updated_at = ?, current_version_id = ? WHERE project_id = ?",
                (now(), version_id, project_id),
            )
        return self.get_project(project_id) or project

    def _fork_version(self, project: dict[str, Any]) -> tuple[str, Path]:
        existing_versions = project["versions"]
        version_id = uuid.uuid4().hex
        version_number = f"{len(existing_versions) + 1}.0"
        version_dir = self._version_dir(project["project_id"], version_id)
        previous_version_id = project["current_version_id"]
        previous_dir = self._version_dir(project["project_id"], previous_version_id)
        if previous_dir.exists():
            shutil.copytree(previous_dir, version_dir)
        self._create_version_directories(version_dir)
        with self._connection() as connection:
            connection.execute(
                "INSERT INTO project_versions VALUES (?, ?, ?, ?, ?, ?)",
                (version_id, project["project_id"], version_number, "active", now(), '{"markdown": 8, "web": 2}'),
            )
        return version_id, version_dir

    @staticmethod
    def _create_version_directories(version_dir: Path) -> None:
        for path in (
            version_dir / "source" / "uploads",
            version_dir / "rules",
            version_dir / "research" / "screenshots",
            version_dir / "product",
            version_dir / "outputs",
        ):
            path.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def _version_dir(project_id: str, version_id: str) -> Path:
        return PROJECTS_ROOT / project_id / "versions" / version_id

    @staticmethod
    def _classify_upload(filename: str) -> str:
        suffix = Path(filename).suffix.lower()
        if suffix in {".md", ".markdown"}:
            return "markdown"
        if suffix == ".xlsx":
            return "excel"
        if suffix in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
            return "image"
        raise ValueError(f"不支持的文件类型：{suffix or '无扩展名'}")

    @staticmethod
    def _destination_for_upload(version_dir: Path, kind: str, original_name: str) -> Path:
        if kind == "markdown":
            return version_dir / "source" / "original.md"
        if kind == "excel":
            return version_dir / "source" / "source.xlsx"
        safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", original_name)
        return version_dir / "source" / "uploads" / f"{uuid.uuid4().hex}_{safe_name}"

    @staticmethod
    def _version_payload(row: sqlite3.Row) -> dict[str, Any]:
        payload = dict(row)
        payload["weights"] = json.loads(payload.pop("weights_json"))
        return payload

    @staticmethod
    def _xlsx_to_markdown(content: bytes) -> str:
        """将第一个工作表转为可追溯的 Markdown 表格。"""
        try:
            with zipfile.ZipFile(__import__("io").BytesIO(content)) as archive:
                shared_strings: list[str] = []
                if "xl/sharedStrings.xml" in archive.namelist():
                    root = ElementTree.fromstring(archive.read("xl/sharedStrings.xml"))
                    shared_strings = ["".join(node.itertext()) for node in root]
                sheet_name = next(
                    name for name in archive.namelist() if name.startswith("xl/worksheets/sheet") and name.endswith(".xml")
                )
                root = ElementTree.fromstring(archive.read(sheet_name))
        except (KeyError, StopIteration, zipfile.BadZipFile, ElementTree.ParseError) as error:
            raise ValueError(f"Excel 文件无法转换：{error}") from error

        namespace = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
        rows: list[list[str]] = []
        max_columns = 0
        for row in root.findall(".//x:sheetData/x:row", namespace):
            cells: list[str] = []
            for cell in row.findall("x:c", namespace):
                cell_type = cell.get("t")
                value_node = cell.find("x:v", namespace)
                value = "" if value_node is None or value_node.text is None else value_node.text
                if cell_type == "s" and value.isdigit() and int(value) < len(shared_strings):
                    value = shared_strings[int(value)]
                elif cell_type == "inlineStr":
                    value = "".join(cell.itertext())
                cells.append(value.replace("|", "\\|"))
            max_columns = max(max_columns, len(cells))
            rows.append(cells)
        if not rows or max_columns == 0:
            return "# Excel 转换结果\n\n资料为空。\n"
        normalized = [row + [""] * (max_columns - len(row)) for row in rows]
        header = normalized[0]
        return "\n".join([
            "# Excel 转换结果",
            "",
            "| " + " | ".join(header) + " |",
            "| " + " | ".join(["---"] * max_columns) + " |",
            *["| " + " | ".join(row) + " |" for row in normalized[1:]],
            "",
        ])
