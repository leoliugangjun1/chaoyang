"""Small JSON contract runner with the required single retry."""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any


class InvalidLLMOutput(ValueError):
    """Raised after the allowed retry still does not produce a JSON object."""

    error_code = "LLM_OUTPUT_INVALID"


class JsonTaskRunner:
    """Run one task package and retry the exact package once on invalid JSON."""

    def __init__(self, call: Callable[[dict[str, Any]], str]) -> None:
        self.call = call

    def run(self, task_package: dict[str, Any]) -> dict[str, Any]:
        for attempt in (1, 2):
            raw = self.call(task_package)
            try:
                payload = json.loads(raw)
            except (TypeError, json.JSONDecodeError):
                if attempt == 2:
                    raise InvalidLLMOutput("LLM 输出不是有效 JSON")
                continue
            if not isinstance(payload, dict):
                if attempt == 2:
                    raise InvalidLLMOutput("LLM 输出必须是 JSON 对象")
                continue
            return payload
        raise InvalidLLMOutput("LLM 输出无效")
