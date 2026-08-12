from __future__ import annotations

import json
import unittest

from backend.llm_client import InvalidLLMOutput, JsonTaskRunner
from backend.review_engine import run_review


class DToFTest(unittest.TestCase):
    def test_claims_visualization_and_communication_are_structured(self) -> None:
        snapshot = {"chunks": [{"render_text": "SKU LP-001-V2\n核心卖点：6.5cm 加宽腰头\nVOC 用户关注卷边\n规格表 检测报告\n场景 通勤\nSlogan 稳定支撑\n流量词 加宽", "source_uri": "资料.xlsx#GTM!A1:C8"}]}
        result = run_review(snapshot)
        self.assertTrue(result["claim_checks"])
        self.assertTrue(result["visualization_checks"])
        self.assertTrue(result["communication_checks"])
        self.assertEqual(result["admission_status"], "approved")

    def test_invalid_json_retries_once_then_manual_review_can_handle_code(self) -> None:
        calls = []
        def call(_: dict[str, object]) -> str:
            calls.append(1)
            return "not-json"
        with self.assertRaises(InvalidLLMOutput):
            JsonTaskRunner(call).run({"claim_id": "claim-001"})
        self.assertEqual(len(calls), 2)


if __name__ == "__main__":
    unittest.main()
