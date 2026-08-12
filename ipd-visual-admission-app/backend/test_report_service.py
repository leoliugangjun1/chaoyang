from __future__ import annotations

import unittest

from backend.report_service import ReportValidationError, build_report, render_markdown


class ReportServiceTest(unittest.TestCase):
    def test_report_schema_shape_and_markdown(self) -> None:
        summary = {
            "admission_status": "rejected",
            "hard_fail_checks": [{"rule_id": "core_claim_evidence", "hard_fail": True, "finding": "缺证据", "source_refs": ["a.xlsx#GTM!A1"]}],
            "completeness": {"marketing_score": 10, "manual_score": 5, "raw_score": 15, "audited_completeness_percent": 15.8, "missing_fields": ["manual:质检"]},
            "claim_checks": [{"rule_id": "functional_validation", "status": "fail", "risk": "功能验证缺失", "required_action": "补报告", "owner_role": "质量或研发", "source_refs": []}],
            "visualization_checks": [],
            "communication_checks": [],
        }
        report = build_report("review-001", ["a.xlsx#GTM!A1"], summary)
        self.assertEqual(report["admission_status"], "rejected")
        self.assertEqual(report["completeness"]["audited_max_score"], 95)
        self.assertIn("不通过", render_markdown(report))

    def test_hard_fail_cannot_be_overridden(self) -> None:
        summary = {"admission_status": "approved", "hard_fail_checks": [{"rule_id": "model_version", "hard_fail": True, "finding": "缺失", "source_refs": []}], "completeness": {}}
        with self.assertRaises(ReportValidationError):
            build_report("review-002", [], summary)


if __name__ == "__main__":
    unittest.main()
