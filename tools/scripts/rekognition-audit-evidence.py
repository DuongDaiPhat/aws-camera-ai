"""Check final claims and deliverables against the persisted live evidence."""

import hashlib
import json
import re
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs/test/REKOGNITION_2026-11-22"


def read(name):
    return json.loads((OUT / name).read_text(encoding="utf-8-sig"))


def main():
    checks = []

    def check(name, condition):
        if not condition:
            raise AssertionError(name)
        checks.append(name)

    manifest = read("data/manifest.json")
    check("9 input files", len(manifest["files"]) == 9)
    for row in manifest["files"]:
        check(
            "input hash " + row["name"],
            hashlib.sha256((ROOT / "local_image" / row["name"]).read_bytes()).hexdigest()
            == row["sha256"],
        )
    frames = read("data/frames.json")
    scores = read("data/labeled-scores.json")
    check("126 sampled frames", len(frames) == 126)
    check(
        "410 proposals / 86 target",
        len(scores) == 410 and sum(r["target"] for r in scores) == 86,
    )
    enrollment = read("data/enrollment.json")
    check(
        "10 validated references",
        len(enrollment) == 10 and all(len(r["faceRecords"]) == 1 for r in enrollment),
    )
    subsets = read("data/subset-results.json")
    check(
        "32 front-required configurations",
        len(subsets) == 32 and all(0 in r["angles"] for r in subsets),
    )
    original = [r for r in subsets if r["variant"] == "original"]
    mirror = [r for r in subsets if r["variant"] == "mirror"]
    one = next(r for r in original if r["n"] == 1)
    three = next(r for r in original if r["angles"] == [0, 3, 4])
    five = next(r for r in original if r["n"] == 5)
    check(
        "one front identifies all positive videos",
        all(r["tp"] > 0 for r in one["videos"] if r["video"] != "no_known_face.mp4"),
    )
    check(
        "3 angles equal 5-angle maximum",
        three["tp"] == five["tp"] == max(r["tp"] for r in original) == 63,
    )
    check(
        "FN and abstention separated",
        five["fn"] == 23 and five["fnClassifiedUnknown"] == 19 and five["positiveAbstain"] == 4,
    )
    check("no identity false positive", all(r["fp"] == 0 for r in subsets))
    check("mirror full set 62 correct", next(r for r in mirror if r["n"] == 5)["tp"] == 62)
    live = read("data/subset-live-summary.json")
    check(
        "820 independent live comparisons",
        live["rows"] == 820 and live["classificationMismatches"] == [],
    )
    e2e = read("data/e2e-results.json")
    check(
        "8 real pipeline cases",
        len(e2e) == 8
        and all(r["person_status"] == r["expected"] and r["receipts"] == 1 for r in e2e),
    )
    traces = read("data/lambda-invocations.json")
    check(
        "provider error fails record",
        len(traces[0]["payload"]["batchItemFailures"]) == 1
        and "InvalidImageFormatException" in traces[0]["log"],
    )
    check(
        "retry succeeds and replay hits cache",
        all(r["payload"]["batchItemFailures"] == [] for r in traces[1:])
        and "cacheHit=True" in traces[2]["log"],
    )
    edges = read("data/http-enrollment-edges.json")
    check("8 real HTTP edge cases", len(edges) == 8 and all(r["passed"] for r in edges))
    check("9 image transformation cases", len(read("data/transformation-edges.json")) == 9)
    mappings = read("data/duplicate-enrollment-mappings.json")
    check(
        "duplicate enrollment retains old and new mappings",
        len(mappings) == 2 and all(r["face_count"] == 5 for r in mappings),
    )
    check(
        "Lambda configured successfully",
        read("logs/lambda-final-config.txt")["LastUpdateStatus"] == "Successful",
    )
    check(
        "Lambda URL matches environment evidence",
        read("logs/lambda-final-config.txt")["URL"] == read("data/environment.json")["callbackUrl"],
    )
    report = (OUT / "BAO_CAO.md").read_text(encoding="utf-8")
    for target in re.findall(r"\]\(([^)]+)\)", report):
        if not target.startswith("https://"):
            check("report link " + target, (OUT / target).is_file())
    ui = list((OUT / "screenshots").glob("ui-*.jpg"))
    check("12 real UI screenshots", len(ui) == 12)
    for path in ui + [OUT / "screenshots/logs-01-cloudwatch.jpg"]:
        with Image.open(path) as im:
            check(
                "readable screenshot " + path.name,
                im.width >= 1200 and im.height >= 700,
            )
    for name in [
        "orchestrator-tests",
        "lambda-tests",
        "lint",
        "python-lint",
        "typecheck",
        "build",
        "evidence-secret-scan",
    ]:
        check("validation log " + name, (OUT / "logs" / (name + ".txt")).exists())
    summary = {
        "status": "passed",
        "checks": len(checks),
        "requirementsVerified": checks,
    }
    (OUT / "data/completion-audit.json").write_text(
        json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(f"Evidence audit passed: {len(checks)} assertions.")


if __name__ == "__main__":
    main()
