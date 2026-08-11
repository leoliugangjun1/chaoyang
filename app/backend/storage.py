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

from app.backend.product_understanding import build_product_understanding

APP_ROOT = Path(__file__).resolve().parents[1]
DATA_ROOT = APP_ROOT / "data"
PROJECTS_ROOT = APP_ROOT / "projects"
RULES_ROOT = APP_ROOT / "rules"
DATABASE_PATH = DATA_ROOT / "visual_research.db"
RULE_TYPES = {"product_validation", "image_search", "visual_planning"}


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
                CREATE TABLE IF NOT EXISTS rules (
                    rule_id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    rule_type TEXT NOT NULL,
                    version TEXT NOT NULL,
                    source_markdown_path TEXT NOT NULL,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    effective_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS project_rule_bindings (
                    version_id TEXT NOT NULL,
                    rule_type TEXT NOT NULL,
                    rule_id TEXT NOT NULL,
                    PRIMARY KEY(version_id, rule_type),
                    FOREIGN KEY(version_id) REFERENCES project_versions(version_id),
                    FOREIGN KEY(rule_id) REFERENCES rules(rule_id)
                );
                CREATE TABLE IF NOT EXISTS product_understanding_results (
                    version_id TEXT PRIMARY KEY,
                    status TEXT NOT NULL,
                    result_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY(version_id) REFERENCES project_versions(version_id)
                );
                CREATE TABLE IF NOT EXISTS market_analysis_results (
                    version_id TEXT PRIMARY KEY,
                    result_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY(version_id) REFERENCES project_versions(version_id)
                );
                CREATE TABLE IF NOT EXISTS visual_dashboards (
                    version_id TEXT PRIMARY KEY,
                    dashboard_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
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
        payload["rule_bindings"] = self.get_rule_bindings(payload["current_version_id"])
        payload["product_understanding"] = self.get_product_understanding(payload["current_version_id"])
        payload["market_analysis"] = self.get_market_analysis(payload["current_version_id"])
        payload["visual_dashboard"] = self.get_visual_dashboard(payload["current_version_id"])
        return payload

    def get_visual_dashboard(self, version_id: str) -> dict[str, Any] | None:
        with self._connection() as connection:
            row = connection.execute("SELECT dashboard_json FROM visual_dashboards WHERE version_id = ?", (version_id,)).fetchone()
        return json.loads(row["dashboard_json"]) if row else None

    def create_visual_dashboard(self, project_id: str) -> dict[str, Any]:
        project = self.get_project(project_id)
        if project is None:
            raise LookupError("未找到对应项目")
        if project["market_analysis"] is None:
            raise ValueError("请先完成市场分析")
        rule = project["rule_bindings"].get("visual_planning")
        if rule is None:
            raise ValueError("请先绑定视觉策划规则")
        rule_content = (APP_ROOT / rule["source_markdown_path"]).read_text(encoding="utf-8")
        headings = [line.lstrip("#").strip() for line in rule_content.splitlines() if line.startswith("## ")]
        if not headings:
            raise ValueError("视觉策划规则未定义可渲染模块")
        selected_images = [image for image in project["market_analysis"]["image_candidates"] if image["review_status"] == "selected"]
        dashboard = {"project_id": project_id, "version_id": project["current_version_id"], "layout_schema": {"sections_from_rule": True}, "sections": [{"id": uuid.uuid4().hex, "title": title, "content": "", "images": []} for title in headings], "selected_images": selected_images, "editable_fields": ["sections[].title", "sections[].content", "sections[].images"], "pdf_payload": {}}
        self._save_visual_dashboard(project, dashboard)
        return dashboard

    def update_visual_dashboard(self, project_id: str, dashboard: dict[str, Any]) -> dict[str, Any]:
        project = self.get_project(project_id)
        if project is None:
            raise LookupError("未找到对应项目")
        current = self.get_visual_dashboard(project["current_version_id"])
        if current is None:
            raise ValueError("请先生成视觉看板")
        if [item["id"] for item in dashboard.get("sections", [])] != [item["id"] for item in current["sections"]]:
            raise ValueError("不得修改视觉策划规则定义的看板结构")
        dashboard["selected_images"] = current["selected_images"]
        dashboard["layout_schema"] = current["layout_schema"]
        dashboard["editable_fields"] = current["editable_fields"]
        self._save_visual_dashboard(project, dashboard)
        return dashboard

    def _save_visual_dashboard(self, project: dict[str, Any], dashboard: dict[str, Any]) -> None:
        version_id = project["current_version_id"]
        destination = self._version_dir(project["project_id"], version_id) / "outputs" / "visual-dashboard.json"
        destination.write_text(json.dumps(dashboard, ensure_ascii=False, indent=2), encoding="utf-8")
        with self._connection() as connection:
            connection.execute("INSERT INTO visual_dashboards(version_id, dashboard_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(version_id) DO UPDATE SET dashboard_json = excluded.dashboard_json, updated_at = excluded.updated_at", (version_id, json.dumps(dashboard, ensure_ascii=False), now()))

    def export_visual_dashboard(self, project_id: str, export_type: str) -> Path:
        project = self.get_project(project_id)
        if project is None:
            raise LookupError("未找到对应项目")
        dashboard = project["visual_dashboard"]
        if dashboard is None:
            raise ValueError("请先生成视觉看板")
        outputs = self._version_dir(project_id, project["current_version_id"]) / "outputs"
        if export_type == "pdf":
            destination = outputs / "visual-dashboard.pdf"
            lines = [section["title"] for section in dashboard["sections"]] + [section["content"] for section in dashboard["sections"]]
            destination.write_bytes(_simple_pdf(lines))
            return destination
        if export_type == "images":
            destination = outputs / "visual-dashboard-images.zip"
            with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as archive:
                for image in dashboard["selected_images"]:
                    path = PROJECTS_ROOT / image["local_path"]
                    if path.is_file():
                        archive.write(path, arcname=path.name)
            return destination
        raise ValueError("导出类型无效")

    def get_market_analysis(self, version_id: str) -> dict[str, Any] | None:
        with self._connection() as connection:
            row = connection.execute("SELECT result_json, updated_at FROM market_analysis_results WHERE version_id = ?", (version_id,)).fetchone()
        if row is None:
            return None
        payload = json.loads(row["result_json"])
        payload["updated_at"] = row["updated_at"]
        return payload

    def run_market_analysis(self, project_id: str) -> dict[str, Any]:
        project = self.get_project(project_id)
        if project is None:
            raise LookupError("未找到对应项目")
        understanding = project["product_understanding"]
        if understanding is None or understanding["status"] != "confirmed":
            raise ValueError("请先确认产品事实和卖点证据")
        version_id = project["current_version_id"]
        version_dir = self._version_dir(project_id, version_id)
        weights = self._get_weights(version_id)
        images = [
            {"image_id": uuid.uuid4().hex, "project_id": project_id, "version_id": version_id, "category": "user_upload", "source_type": "user_upload", "source_url": "", "search_query": "", "local_path": str(path.relative_to(PROJECTS_ROOT).as_posix()), "page_type": "", "related_claims": [], "ai_reason": "用户上传图片，等待人工确认", "captured_at": now(), "evidence_status": "available", "review_status": "pending", "user_note": ""}
            for path in (version_dir / "source" / "uploads").glob("*") if path.is_file()
        ]
        result = {"status": "completed", "adapter": "local_markdown", "data": [], "conclusions": [], "sources": [{"type": "markdown", "path": path.relative_to(PROJECTS_ROOT).as_posix()} for path in (version_dir / "source").rglob("*.md")], "captured_at": now(), "screenshots": [], "missing_items": ["未配置联网调研 Skill，未执行联网检索"], "evidence_labels": [], "weights": weights, "image_candidates": images}
        self._save_market_analysis(project, result)
        return self.get_market_analysis(version_id) or result

    def update_weights(self, project_id: str, markdown: Any, web: Any) -> dict[str, Any]:
        project = self.get_project(project_id)
        if project is None:
            raise LookupError("未找到对应项目")
        if not isinstance(markdown, int) or not isinstance(web, int) or markdown < 0 or web < 0 or markdown + web != 10:
            raise ValueError("Markdown 与联网权重必须为非负整数，且总和固定为 10")
        with self._connection() as connection:
            connection.execute("UPDATE project_versions SET weights_json = ? WHERE version_id = ?", (json.dumps({"markdown": markdown, "web": web}), project["current_version_id"]))
        analysis = self.get_market_analysis(project["current_version_id"])
        if analysis:
            analysis["weights"] = {"markdown": markdown, "web": web}
            self._save_market_analysis(project, analysis)
        return self.get_project(project_id) or project

    def review_image_candidates(self, project_id: str, reviews: dict[str, str]) -> dict[str, Any]:
        project = self.get_project(project_id)
        if project is None:
            raise LookupError("未找到对应项目")
        analysis = self.get_market_analysis(project["current_version_id"])
        if analysis is None:
            raise ValueError("请先启动市场分析")
        valid = {"pending", "selected", "rejected"}
        for image in analysis["image_candidates"]:
            if image["image_id"] in reviews:
                status = reviews[image["image_id"]]
                if status not in valid:
                    raise ValueError("图片确认状态无效")
                image["review_status"] = status
        self._save_market_analysis(project, analysis)
        return self.get_market_analysis(project["current_version_id"]) or analysis

    def _get_weights(self, version_id: str) -> dict[str, int]:
        with self._connection() as connection:
            row = connection.execute("SELECT weights_json FROM project_versions WHERE version_id = ?", (version_id,)).fetchone()
        return json.loads(row["weights_json"]) if row else {"markdown": 8, "web": 2}

    def _save_market_analysis(self, project: dict[str, Any], result: dict[str, Any]) -> None:
        version_id = project["current_version_id"]
        destination = self._version_dir(project["project_id"], version_id) / "outputs" / "market-analysis.json"
        destination.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        with self._connection() as connection:
            connection.execute("INSERT INTO market_analysis_results(version_id, result_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(version_id) DO UPDATE SET result_json = excluded.result_json, updated_at = excluded.updated_at", (version_id, json.dumps(result, ensure_ascii=False), now()))

    def get_product_understanding(self, version_id: str) -> dict[str, Any] | None:
        with self._connection() as connection:
            row = connection.execute(
                "SELECT status, result_json, updated_at FROM product_understanding_results WHERE version_id = ?", (version_id,)
            ).fetchone()
        if row is None:
            return None
        payload = json.loads(row["result_json"])
        payload["status"] = row["status"]
        payload["updated_at"] = row["updated_at"]
        return payload

    def run_product_understanding(self, project_id: str) -> dict[str, Any]:
        project = self.get_project(project_id)
        if project is None:
            raise LookupError("未找到对应项目")
        rule = project["rule_bindings"].get("product_validation")
        if rule is None:
            raise ValueError("请先绑定产品事实校验规则")
        version_dir = self._version_dir(project_id, project["current_version_id"])
        documents = [(path, path.read_text(encoding="utf-8")) for path in (version_dir / "source").rglob("*.md")]
        if not documents:
            raise ValueError("当前版本没有可解析的 Markdown 资料")
        result = build_product_understanding(documents, rule)
        result["project_id"] = project_id
        result["version_id"] = project["current_version_id"]
        self._save_product_understanding(project, result, "pending_user_confirmation")
        return self.get_product_understanding(project["current_version_id"]) or result

    def update_product_understanding(self, project_id: str, result: dict[str, Any]) -> dict[str, Any]:
        project = self.get_project(project_id)
        if project is None:
            raise LookupError("未找到对应项目")
        current = self.get_product_understanding(project["current_version_id"])
        if current is None:
            raise ValueError("请先启动产品理解")
        facts = result.get("product_facts")
        evidence = result.get("selling_point_evidence")
        if not isinstance(facts, list) or not isinstance(evidence, list):
            raise ValueError("产品理解结果格式无效")
        original_ranks = [item["rank"] for item in current["selling_point_evidence"]]
        updated_ranks = [item.get("rank") for item in evidence if isinstance(item, dict)]
        if updated_ranks != original_ranks:
            raise ValueError("不得修改 Markdown 卖点原始顺序")
        current["product_facts"] = facts
        current["selling_point_evidence"] = evidence
        current["missing_items"] = result.get("missing_items", current.get("missing_items", []))
        self._save_product_understanding(project, current, "pending_user_confirmation")
        return self.get_product_understanding(project["current_version_id"]) or current

    def confirm_product_understanding(self, project_id: str) -> dict[str, Any]:
        project = self.get_project(project_id)
        if project is None:
            raise LookupError("未找到对应项目")
        result = self.get_product_understanding(project["current_version_id"])
        if result is None:
            raise ValueError("请先启动产品理解")
        if not result["product_facts"] or not result["selling_point_evidence"]:
            raise ValueError("产品事实和卖点证据均需存在后才能确认")
        for item in result["product_facts"]:
            item["status"] = "confirmed"
        for item in result["selling_point_evidence"]:
            item["status"] = "confirmed"
        self._save_product_understanding(project, result, "confirmed")
        return self.get_product_understanding(project["current_version_id"]) or result

    def _save_product_understanding(self, project: dict[str, Any], result: dict[str, Any], status: str) -> None:
        version_id = project["current_version_id"]
        version_dir = self._version_dir(project["project_id"], version_id)
        (version_dir / "product" / "product-facts.json").write_text(json.dumps(result["product_facts"], ensure_ascii=False, indent=2), encoding="utf-8")
        (version_dir / "product" / "selling-point-evidence.json").write_text(json.dumps(result["selling_point_evidence"], ensure_ascii=False, indent=2), encoding="utf-8")
        with self._connection() as connection:
            connection.execute(
                "INSERT INTO product_understanding_results(version_id, status, result_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(version_id) DO UPDATE SET status = excluded.status, result_json = excluded.result_json, updated_at = excluded.updated_at",
                (version_id, status, json.dumps(result, ensure_ascii=False), now()),
            )

    def list_rules(self, rule_type: str | None = None, include_archived: bool = False) -> list[dict[str, Any]]:
        query = "SELECT * FROM rules"
        conditions: list[str] = []
        values: list[str] = []
        if rule_type:
            self._validate_rule_type(rule_type)
            conditions.append("rule_type = ?")
            values.append(rule_type)
        if not include_archived:
            conditions.append("status = 'active'")
        if conditions:
            query += " WHERE " + " AND ".join(conditions)
        query += " ORDER BY effective_at DESC"
        with self._connection() as connection:
            return [dict(row) for row in connection.execute(query, values).fetchall()]

    def create_rule(self, name: str, rule_type: str, content: str, version: str = "1.0") -> dict[str, Any]:
        name = name.strip()
        self._validate_rule_type(rule_type)
        if not name:
            raise ValueError("规则名称不能为空")
        if not content.strip():
            raise ValueError("规则内容不能为空")
        rule_id = uuid.uuid4().hex
        timestamp = now()
        destination = RULES_ROOT / "active" / f"{rule_id}.md"
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(content, encoding="utf-8")
        payload = (rule_id, name, rule_type, version.strip() or "1.0", str(destination.relative_to(APP_ROOT).as_posix()), "active", timestamp, timestamp)
        with self._connection() as connection:
            connection.execute("INSERT INTO rules VALUES (?, ?, ?, ?, ?, ?, ?, ?)", payload)
        return self.get_rule(rule_id) or {}

    def get_rule(self, rule_id: str) -> dict[str, Any] | None:
        with self._connection() as connection:
            rule = connection.execute("SELECT * FROM rules WHERE rule_id = ?", (rule_id,)).fetchone()
        return dict(rule) if rule else None

    def archive_rule(self, rule_id: str) -> dict[str, Any]:
        rule = self.get_rule(rule_id)
        if rule is None:
            raise LookupError("未找到对应规则")
        if rule["status"] == "archived":
            return rule
        source = APP_ROOT / rule["source_markdown_path"]
        destination = RULES_ROOT / "archived" / source.name
        destination.parent.mkdir(parents=True, exist_ok=True)
        if source.exists():
            shutil.move(source, destination)
        with self._connection() as connection:
            connection.execute("UPDATE rules SET status = 'archived', source_markdown_path = ? WHERE rule_id = ?", (str(destination.relative_to(APP_ROOT).as_posix()), rule_id))
        return self.get_rule(rule_id) or rule

    def update_rule_name(self, rule_id: str, name: str) -> dict[str, Any]:
        name = name.strip()
        if not name:
            raise ValueError("规则名称不能为空")
        if self.get_rule(rule_id) is None:
            raise LookupError("未找到对应规则")
        with self._connection() as connection:
            connection.execute("UPDATE rules SET name = ? WHERE rule_id = ?", (name, rule_id))
        return self.get_rule(rule_id) or {}

    def bind_rules(self, project_id: str, bindings: dict[str, str]) -> dict[str, Any]:
        project = self.get_project(project_id)
        if project is None:
            raise LookupError("未找到对应项目")
        for rule_type, rule_id in bindings.items():
            self._validate_rule_type(rule_type)
            rule = self.get_rule(rule_id)
            if rule is None or rule["status"] != "active":
                raise ValueError("所选规则不可用")
            if rule["rule_type"] != rule_type:
                raise ValueError("规则类型与绑定位置不一致")
        with self._connection() as connection:
            for rule_type, rule_id in bindings.items():
                connection.execute(
                    "INSERT INTO project_rule_bindings(version_id, rule_type, rule_id) VALUES (?, ?, ?) ON CONFLICT(version_id, rule_type) DO UPDATE SET rule_id = excluded.rule_id",
                    (project["current_version_id"], rule_type, rule_id),
                )
        self._write_rule_bindings(project["project_id"], project["current_version_id"])
        return self.get_project(project_id) or project

    def get_rule_bindings(self, version_id: str) -> dict[str, dict[str, Any]]:
        with self._connection() as connection:
            rows = connection.execute(
                "SELECT b.rule_type, r.* FROM project_rule_bindings b JOIN rules r ON r.rule_id = b.rule_id WHERE b.version_id = ?",
                (version_id,),
            ).fetchall()
        return {row["rule_type"]: dict(row) for row in rows}

    def _write_rule_bindings(self, project_id: str, version_id: str) -> None:
        destination = self._version_dir(project_id, version_id) / "rules" / "rule-bindings.json"
        destination.write_text(json.dumps(self.get_rule_bindings(version_id), ensure_ascii=False, indent=2), encoding="utf-8")

    @staticmethod
    def _validate_rule_type(rule_type: str) -> None:
        if rule_type not in RULE_TYPES:
            raise ValueError("规则类型无效")

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
                converted = self._converted_destination(version_dir, original_name)
                converted.parent.mkdir(parents=True, exist_ok=True)
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
            connection.execute(
                "INSERT INTO project_rule_bindings(version_id, rule_type, rule_id) SELECT ?, rule_type, rule_id FROM project_rule_bindings WHERE version_id = ?",
                (version_id, previous_version_id),
            )
        self._write_rule_bindings(project["project_id"], version_id)
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
            primary = version_dir / "source" / "original.md"
            if not primary.exists():
                return primary
            safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", original_name)
            return version_dir / "source" / "markdown" / f"{uuid.uuid4().hex}_{safe_name}"
        if kind == "excel":
            primary = version_dir / "source" / "source.xlsx"
            if not primary.exists():
                return primary
            safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", original_name)
            return version_dir / "source" / "excel" / f"{uuid.uuid4().hex}_{safe_name}"
        safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", original_name)
        return version_dir / "source" / "uploads" / f"{uuid.uuid4().hex}_{safe_name}"

    @staticmethod
    def _converted_destination(version_dir: Path, original_name: str) -> Path:
        primary = version_dir / "source" / "excel-converted.md"
        if not primary.exists():
            return primary
        safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", Path(original_name).stem)
        return version_dir / "source" / "excel-converted" / f"{uuid.uuid4().hex}_{safe_name}.md"

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


def _simple_pdf(lines: list[str]) -> bytes:
    safe = [re.sub(r"[^ -~]", "?", line)[:100] for line in lines if line.strip()] or ["Visual dashboard"]
    stream = "BT /F1 18 Tf 50 780 Td " + " ".join(f"({line.replace('(', '[').replace(')', ']')}) Tj 0 -24 Td" for line in safe) + " ET"
    objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", f"<< /Length {len(stream)} >>\nstream\n{stream}\nendstream"]
    body = "%PDF-1.4\n"; offsets = [0]
    for index, obj in enumerate(objects, 1): offsets.append(len(body)); body += f"{index} 0 obj\n{obj}\nendobj\n"
    start = len(body); body += f"xref\n0 {len(objects)+1}\n0000000000 65535 f \n" + "".join(f"{offset:010} 00000 n \n" for offset in offsets[1:]) + f"trailer << /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{start}\n%%EOF"
    return body.encode("latin-1")
