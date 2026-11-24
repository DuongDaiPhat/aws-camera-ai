"""Build reproducible evidence figures and an exact CloudWatch log viewer."""

import html
import importlib.util
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs/test/REKOGNITION_2026-11-22"
DATA = OUT / "data"


def main():
    spec = importlib.util.spec_from_file_location(
        "face_eval", ROOT / "tools/scripts/rekognition-eval.py"
    )
    evaluation = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(evaluation)
    scores = json.loads((DATA / "labeled-scores.json").read_text())
    bad = [
        r
        for r in scores
        if r["target"] and max([s for s in r["scores"]["original"] if s is not None] or [0]) < 90
    ]
    items = []
    for r in bad:
        available = [s for s in r["scores"]["original"] if s is not None]
        score_text = f"{max(available):.2f}" if available else "N/A"
        label = f"{Path(r['video']).stem.replace('has_known_face_', '')} t={r['time']:g}s"
        items.append(
            (
                Image.open(ROOT / r["cropPath"]),
                label + f"\nscore={score_text} face={r['faceWidthPixels']:.0f}px",
            )
        )
    evaluation.sheet(
        items,
        OUT / "screenshots/false-negative-examples.jpg",
        cols=6,
        width=240,
        height=245,
    )
    hand = (
        ROOT / "artifacts/rekognition-eval-2026-11-22/crops/has_known_face_no_glasses__038__f1.jpg"
    )
    evaluation.sheet(
        [(Image.open(hand), "t=76s: hand detected as face")],
        OUT / "screenshots/ai-false-face-hand.jpg",
        cols=1,
        width=600,
        height=420,
    )
    refs = {
        r["Face"]["FaceId"]: e["variant"]
        for e in json.loads((DATA / "enrollment.json").read_text())
        for r in e["faceRecords"]
    }
    edges = json.loads((DATA / "transformation-edges.json").read_text())
    items = []
    for r in edges:
        score = max(
            [
                m["Similarity"]
                for m in r.get("matches", [])
                if refs.get(m["Face"]["FaceId"]) == "original"
            ]
            or [0]
        )
        items.append(
            (
                Image.open(ROOT / "artifacts/rekognition-eval-2026-11-22" / (r["case"] + ".jpg")),
                r["case"] + f"\nscore={score:.2f}, faces={r['faceCount']}",
            )
        )
    evaluation.sheet(
        items,
        OUT / "screenshots/transformation-edges.jpg",
        cols=3,
        width=350,
        height=285,
    )
    logs = json.loads((DATA / "cloudwatch.json").read_text())
    interesting = [
        r for r in logs if "Face completed" in r["message"] or "Face input failed" in r["message"]
    ]
    # Every displayed line is copied from the AWS response, without invented messages.
    cases = json.loads((DATA / "e2e-results.json").read_text())
    selected_ids = {
        r["id"]
        for r in cases
        if r["name"]
        in [
            "known-glasses",
            "stranger",
            "whole-multiple-faces",
            "provider-error-and-retry",
        ]
    }
    selected = [
        r for r in interesting if any(identifier in r["message"] for identifier in selected_ids)
    ]
    lines = "\n".join(r["message"].strip() for r in selected)
    (OUT / "logs/cloudwatch-selected.txt").write_text(lines, encoding="utf-8")
    body = (
        """<!doctype html><html lang="vi"><meta charset="utf-8"><title>CloudWatch logs — Face Lambda dev</title>
<style>body{background:#0b1420;color:#e2ebf5;margin:38px;font:15px/1.65 Consolas,monospace}h1{font:26px Segoe UI;color:white}p{font:16px Segoe UI;color:#9db5cb}pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:24px;border:1px solid #34506b;background:#111e2c;border-radius:8px}a{color:#90caff}</style>
<h1>CloudWatch — camerai-s4-dev-face</h1><p>ap-southeast-1 · AWS logs exported from filter_log_events · 22/11/2026</p><p>Exact source: <a href="cloudwatch.txt">cloudwatch.txt</a> · <a href="../data/cloudwatch.json">raw AWS response</a></p><pre>"""
        + html.escape(lines)
        + """</pre><p>This is a local viewer of exported AWS logs, not the AWS Console.</p></html>"""
    )
    (OUT / "logs/index.html").write_text(body, encoding="utf-8")
    print("Built FN, detector-error and edge figures; exact CloudWatch log viewer.")


if __name__ == "__main__":
    main()
