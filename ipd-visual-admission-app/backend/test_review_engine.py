"""Rule-level acceptance cases for A-C stages."""

from __future__ import annotations

import unittest

from backend.review_engine import run_ac


class ReviewEngineTest(unittest.TestCase):
    def test_voc_only_claim_is_rejected(self) -> None:
        result = run_ac({"chunks": [{"render_text": "SKU LP-001-V2\nUSP 全天提臀不滑落\nVOC 用户期待和竞品抱怨", "source_uri": "资料.xlsx#GTM!A1:C3"}]})
        checks = {item["rule_id"]: item for item in result["hard_fail_checks"]}
        self.assertTrue(checks["core_claim_evidence"]["hard_fail"])
        self.assertEqual(result["admission_status"], "rejected")

    def test_cross_document_conflict_is_rejected(self) -> None:
        snapshot = {"chunks": [
            {"render_text": "SKU LP-001-V2\n成分 锦纶80%", "source_uri": "marketing.xlsx#GTM!A1:B2"},
            {"render_text": "产品说明书\nSKU LP-001-V2\n成分 锦纶70%", "source_uri": "manual.xlsx#说明书!A1:B3"},
        ]}
        result = run_ac(snapshot)
        checks = {item["rule_id"]: item for item in result["hard_fail_checks"]}
        self.assertTrue(checks["cross_document_conflict"]["hard_fail"])
        self.assertGreaterEqual(len(checks["cross_document_conflict"]["source_refs"]), 2)
        self.assertEqual(result["admission_status"], "rejected")

    def test_empty_snapshot_requires_manual_review(self) -> None:
        result = run_ac({"chunks": []})
        self.assertEqual(result["admission_status"], "manual_review")
        self.assertTrue(result["hard_fail_checks"][0]["manual_review"])


if __name__ == "__main__":
    unittest.main()
