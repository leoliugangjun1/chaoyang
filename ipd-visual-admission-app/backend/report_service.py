"""Schema-shaped report generation and Markdown rendering."""

from __future__ import annotations

import json
from typing import Any


VALID_STATUSES = {"approved", "conditional_approval", "rejected", "manual_review"}


class ReportValidationError(ValueError):
    """Raised when a report does not satisfy the local report contract."""


def build_report(review_id: str, source_path: list[str], summary: dict[str, Any]) -> dict[str, Any]:
    status = summary.get("admission_status")
    if status not in VALID_STATUSES:
        raise ReportValidationError("准入状态不在报告 Schema 范围内")
    hard_fail_checks = []
    for item in summary.get("hard_fail_checks", []):
        hard_fail_checks.append({
            "rule_id": str(item.get("rule_id", "unknown")),
            "hard_fail": bool(item.get("hard_fail", False)),
            "finding": str(item.get("finding", "")),
            "source_refs": [str(ref) for ref in item.get("source_refs", [])],
        })
    findings: list[dict[str, Any]] = []
    for item in summary.get("claim_checks", []):
        findings.append({
            "category": str(item.get("rule_id", "claim")),
            "status": str(item.get("status", "uncertain")),
            "finding": str(item.get("risk") or item.get("inference") or "卖点检查完成"),
            "source_refs": [str(ref) for ref in item.get("source_refs", [])],
            "required_action": str(item.get("required_action", "")),
            "owner_role": str(item.get("owner_role", "")),
        })
    for item in summary.get("visualization_checks", []):
        findings.append({
            "category": "visualization",
            "status": str(item.get("status", "uncertain")),
            "finding": str(item.get("risk") or "展示方案已生成"),
            "source_refs": [str(ref) for ref in item.get("source_refs", [])],
            "required_action": str(item.get("required_action", "")),
            "owner_role": str(item.get("owner_role", "视觉负责人")),
        })
    for item in summary.get("communication_checks", []):
        findings.append({
            "category": str(item.get("rule_id", "communication")),
            "status": str(item.get("status", "uncertain")),
            "finding": str(item.get("finding", "")),
            "source_refs": [str(ref) for ref in item.get("source_refs", [])],
            "required_action": str(item.get("required_action", "")),
            "owner_role": str(item.get("owner_role", "市场/GTM")),
        })
    completeness = summary.get("completeness") or {}
    report = {
        "review_id": review_id,
        "admission_status": status,
        "source_path": [str(path) for path in source_path],
        "hard_fail_checks": hard_fail_checks,
        "completeness": {
            "marketing_score": float(completeness.get("marketing_score", 0)),
            "manual_score": float(completeness.get("manual_score", 0)),
            "raw_score": float(completeness.get("raw_score", 0)),
            "audited_max_score": 95,
            "audited_completeness_percent": float(completeness.get("audited_completeness_percent", 0)),
            "unreviewed_weight": 5,
            "missing_fields": [str(field) for field in completeness.get("missing_fields", [])],
        },
        "usp_voc_brief": "VOC 仅用于说明市场相关性，不构成本产品功能证据。"[:200],
        "findings": findings,
        "manual_review_reasons": [str(summary.get("error_code"))] if summary.get("error_code") else [],
    }
    validate_report(report)
    return report


def validate_report(report: dict[str, Any]) -> None:
    required = {"review_id", "admission_status", "source_path", "hard_fail_checks", "completeness", "usp_voc_brief", "findings"}
    if not required.issubset(report):
        raise ReportValidationError("报告缺少必填字段")
    if report["admission_status"] not in VALID_STATUSES:
        raise ReportValidationError("报告状态无效")
    if not isinstance(report["source_path"], list) or not isinstance(report["findings"], list):
        raise ReportValidationError("报告数组字段无效")
    completeness = report["completeness"]
    for field in ("marketing_score", "manual_score", "raw_score", "audited_completeness_percent"):
        if not isinstance(completeness.get(field), (int, float)):
            raise ReportValidationError(f"完整度字段无效：{field}")
    if completeness.get("audited_max_score") != 95 or completeness.get("unreviewed_weight") != 5:
        raise ReportValidationError("完整度固定权重无效")
    if len(report["usp_voc_brief"]) > 200:
        raise ReportValidationError("USP-VOC 摘要超过 200 字")
    if any(check.get("hard_fail") for check in report["hard_fail_checks"]) and report["admission_status"] != "rejected":
        raise ReportValidationError("一票退回不能被覆盖为通过")


def render_markdown(report: dict[str, Any]) -> str:
    status_labels = {"approved": "通过", "conditional_approval": "有条件通过", "rejected": "不通过", "manual_review": "待人工确认"}
    lines = [f"# IPD 产品视觉准入报告：{report['review_id']}", "", f"- 准入状态：{status_labels[report['admission_status']]}", f"- 来源数量：{len(report['source_path'])}", "", "## 一票退回检查", ""]
    for check in report["hard_fail_checks"]:
        lines.append(f"- `{check['rule_id']}`：{'命中' if check['hard_fail'] else '未命中'}，{check['finding']}")
    completeness = report["completeness"]
    lines.extend(["", "## 完整度", "", f"营销资料 {completeness['marketing_score']:.2f}/80；说明书 {completeness['manual_score']:.2f}/15；审计完整度 {completeness['audited_completeness_percent']:.1f}%", "", "## 问题明细", ""])
    if not report["findings"]:
        lines.append("暂无问题明细。")
    for finding in report["findings"]:
        lines.append(f"- [{finding['status']}] {finding['category']}：{finding['finding']}；必需动作：{finding['required_action']}；责任角色：{finding['owner_role']}")
    return "\n".join(lines) + "\n"
