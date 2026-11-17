"""Validate documentation fixtures only; no network, AWS or database access."""

import json
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker


def main():
    root = Path(__file__).resolve().parent
    schema = json.loads((root / "queue-v1.schema.json").read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    cases = json.loads((root / "fixture-manifest.json").read_text(encoding="utf-8"))
    failures = []
    for case in cases:
        selected = schema
        if case["definition"]:
            selected = {
                "$schema": schema["$schema"],
                "$defs": schema["$defs"],
                "$ref": "#/$defs/" + case["definition"],
            }
        payload = json.loads((root / case["file"]).read_text(encoding="utf-8"))
        validator = Draft202012Validator(selected, format_checker=FormatChecker())
        actual = "valid" if validator.is_valid(payload) else "invalid"
        if actual != case["expected"]:
            failures.append(f"{case['file']}: expected {case['expected']}, got {actual}")
    if failures:
        raise SystemExit("\n".join(failures))
    print(f"PASS: schema and {len(cases)} fixture expectations (structure only)")


if __name__ == "__main__":
    main()
