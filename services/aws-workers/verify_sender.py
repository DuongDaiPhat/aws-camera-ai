"""Run Sender unit tests and require more than 90% line and branch coverage."""

import json
import sys
import unittest
from pathlib import Path

from coverage import Coverage


def main():
    root = Path(__file__).resolve().parent
    output = root / ".build"
    output.mkdir(exist_ok=True)
    coverage = Coverage(
        data_file=None,
        branch=True,
        include=[str(root / "sender" / "handler.py")],
    )
    with coverage.collect():
        suite = unittest.defaultTestLoader.discover(str(root / "sender"), pattern="test_*.py")
        result = unittest.TextTestRunner().run(suite)
    if not result.wasSuccessful():
        return 1

    report = output / "sender-coverage.json"
    coverage.json_report(outfile=str(report))
    totals = json.loads(report.read_text(encoding="utf-8"))["totals"]
    lines = totals["covered_lines"] / totals["num_statements"]
    branches = totals["covered_branches"] / totals["num_branches"]
    print(f"Sender line coverage {lines:.2%} and branch coverage {branches:.2%}")
    return int(lines <= 0.90 or branches <= 0.90)


if __name__ == "__main__":
    sys.exit(main())
