"""Deterministic A-C review stages over the saved Excel Parser snapshot."""

from __future__ import annotations

import re
from typing import Any


STAGES = ("locating", "hard_fail", "completeness")
SKU_PATTERN = re.compile(r"(?:SKU|型号|产品型号|版本)\s*[:：]?\s*([A-Za-z0-9][A-Za-z0-9_-]{2,})", re.IGNORECASE)
MATERIAL_PATTERN = re.compile(r"(锦纶|尼龙|聚酯纤维|氨纶|棉)\s*[^\d]{0,8}(\d{1,3})\s*%")


def _chunks(snapshot: dict[str, Any]) -> list[dict[str, Any]]:
    return [chunk for chunk in snapshot.get("chunks", []) if isinstance(chunk, dict)]


def _text(snapshot: dict[str, Any]) -> str:
    return "\n".join(str(chunk.get("render_text", "")) for chunk in _chunks(snapshot))


def _refs(snapshot: dict[str, Any]) -> list[str]:
    return [str(chunk.get("source_uri")) for chunk in _chunks(snapshot) if chunk.get("source_uri")]


def locate(snapshot: dict[str, Any]) -> dict[str, Any]:
    documents = []
    for chunk in _chunks(snapshot):
        content = str(chunk.get("render_text", ""))
        lowered = content.lower()
        if any(term in content for term in ("GTM", "卖点", "VOC", "营销", "用户画像")):
            doc_type = "marketing_package"
        elif any(term in content for term in ("说明书", "成分", "使用说明", "注意事项")):
            doc_type = "manual"
        else:
            doc_type = "other"
        documents.append({
            "doc_type": doc_type,
            "module": chunk.get("block_type", "unknown"),
            "source_refs": [chunk.get("source_uri")] if chunk.get("source_uri") else [],
            "field_map": {"text": content[:120]},
            "missing_fields": [],
            "confidence": "high" if lowered else "low",
        })
    return {"documents": documents, "source_refs": _refs(snapshot)}


def hard_fail(snapshot: dict[str, Any]) -> dict[str, Any]:
    content = _text(snapshot)
    refs = _refs(snapshot)
    sku_match = SKU_PATTERN.search(content)
    model_check = {
        "rule_id": "model_version",
        "hard_fail": not bool(sku_match),
        "manual_review": not bool(content.strip()),
        "finding": "已定位型号/SKU/版本" if sku_match else "没有明确的型号、SKU 或产品版本",
        "source_refs": refs[:3] if sku_match else [],
    }
    has_claim = any(term in content for term in ("卖点", "USP", "功能优势", "核心卖点"))
    has_product_evidence = any(term in content for term in ("检测报告", "质检报告", "测试报告", "规格表", "实测", "说明书"))
    evidence_check = {
        "rule_id": "core_claim_evidence",
        "hard_fail": bool(has_claim and not has_product_evidence),
        "manual_review": bool(has_claim and not content.strip()),
        "finding": "核心卖点存在本产品证据线索" if has_product_evidence else "核心卖点没有可定位的本产品证据",
        "source_refs": refs[:3] if has_product_evidence else [],
    }
    material_values: dict[str, set[str]] = {}
    for material, value in MATERIAL_PATTERN.findall(content):
        material_values.setdefault(material, set()).add(value)
    conflict = next(((material, values) for material, values in material_values.items() if len(values) > 1), None)
    conflict_check = {
        "rule_id": "cross_document_conflict",
        "hard_fail": conflict is not None,
        "manual_review": False,
        "finding": f"{conflict[0]}在多个资料中的参数不一致" if conflict else "未发现可确认的跨资料参数冲突",
        "source_refs": refs[:5] if conflict else [],
    }
    return {"checks": [model_check, evidence_check, conflict_check]}


def completeness(snapshot: dict[str, Any]) -> dict[str, Any]:
    content = _text(snapshot)
    refs = _refs(snapshot)
    marketing_fields = ["场景", "动机", "痛点", "卖点", "用户", "VOC", "证据", "参考"]
    manual_fields = ["型号", "SKU", "成分", "规格", "尺码", "功能", "适用", "质检", "联系人"]
    marketing_score = round(80 * sum(field in content for field in marketing_fields) / len(marketing_fields), 2)
    manual_score = round(15 * sum(field in content for field in manual_fields) / len(manual_fields), 2)
    missing = [f"marketing:{field}" for field in marketing_fields if field not in content]
    missing.extend(f"manual:{field}" for field in manual_fields if field not in content)
    raw_score = round(marketing_score + manual_score, 2)
    return {
        "marketing_score": marketing_score,
        "manual_score": manual_score,
        "raw_score": raw_score,
        "audited_max_score": 95,
        "audited_completeness_percent": round(raw_score / 95 * 100, 1),
        "unreviewed_weight": 5,
        "missing_fields": missing,
        "source_refs": refs[:3],
    }


def run_ac(snapshot: dict[str, Any]) -> dict[str, Any]:
    locating = locate(snapshot)
    hard_fail_result = hard_fail(snapshot)
    completeness_result = completeness(snapshot)
    hard_fails = hard_fail_result["checks"]
    status = "rejected" if any(item["hard_fail"] for item in hard_fails) else "conditional_approval"
    if any(item["manual_review"] for item in hard_fails) or not _chunks(snapshot):
        status = "manual_review"
    return {
        "stages": {"locating": locating, "hard_fail": hard_fail_result, "completeness": completeness_result},
        "admission_status": status,
        "hard_fail_checks": hard_fails,
        "completeness": completeness_result,
    }
