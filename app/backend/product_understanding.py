"""基于当前规则与 Markdown 资料生成待确认的产品理解结果。"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any


HEADING_PATTERN = re.compile(r"^#{1,6}\s+(.+?)\s*$")
FACT_PATTERN = re.compile(r"^\s*[-*]\s*([^：:\n]{1,80})[：:]\s*(.+?)\s*$")
ORDERED_ITEM_PATTERN = re.compile(r"^\s*(\d+)[.、)]\s*(.+?)\s*$")


def build_product_understanding(documents: list[tuple[Path, str]], rule: dict[str, Any]) -> dict[str, Any]:
    """提取直接 Markdown 信息，不推断、不改写卖点排序。"""
    facts: list[dict[str, Any]] = []
    evidence: list[dict[str, Any]] = []
    known_fields: set[str] = set()
    rank = 1

    for path, content in documents:
        section = ""
        for line_number, raw_line in enumerate(content.splitlines(), start=1):
            heading_match = HEADING_PATTERN.match(raw_line)
            if heading_match:
                section = heading_match.group(1).strip()
                continue

            fact_match = FACT_PATTERN.match(raw_line)
            if fact_match:
                field, value = fact_match.groups()
                field_key = field.strip().casefold()
                if field_key not in known_fields:
                    known_fields.add(field_key)
                    facts.append({
                        "field": field.strip(),
                        "value": value.strip(),
                        "source": f"{path.name}:{line_number}",
                        "evidence_type": "fact",
                        "status": "pending_confirmation",
                        "user_note": "",
                    })

            if _is_selling_point_section(section):
                selling_point_match = ORDERED_ITEM_PATTERN.match(raw_line)
                if selling_point_match:
                    _, name = selling_point_match.groups()
                    evidence.append({
                        "rank": rank,
                        "name": name.strip(),
                        "product_view": "",
                        "user_view": "",
                        "evidence": [],
                        "source": f"markdown:{path.name}:{line_number}",
                        "status": "pending_confirmation",
                    })
                    rank += 1

    missing_items: list[str] = []
    if not facts:
        missing_items.append("未从 Markdown 中找到「字段：值」形式的产品事实")
    if not evidence:
        missing_items.append("未从卖点章节中找到有序卖点")

    return {
        "rule": {"rule_id": rule["rule_id"], "name": rule["name"], "version": rule["version"]},
        "product_facts": facts,
        "selling_point_evidence": evidence,
        "missing_items": missing_items,
        "image_understanding": [],
        "status": "pending_user_confirmation",
    }


def _is_selling_point_section(section: str) -> bool:
    normalized = section.casefold()
    return any(keyword in normalized for keyword in ("卖点", "selling point", "usp", "feature"))
