"""Small process boundary around the installed excel_parser package."""

from __future__ import annotations

import json
import sys
from pathlib import Path

from excel_parser import parse_workbook


def main() -> None:
    if len(sys.argv) != 2:
        raise ValueError("需要一个 Excel 文件路径")
    source_path = Path(sys.argv[1]).resolve()
    if source_path.suffix.lower() != ".xlsx" or not source_path.is_file():
        raise ValueError("仅支持可读取的 .xlsx 文件")
    result = parse_workbook(path=str(source_path))
    print(json.dumps(result.to_json(), ensure_ascii=False, default=str))


if __name__ == "__main__":
    main()
