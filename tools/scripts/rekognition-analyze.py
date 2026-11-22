"""Aggregate predeclared ground truth independently of Rekognition similarity."""

import csv
import itertools
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "docs/test/REKOGNITION_2026-11-22/data"


def main():  # noqa: C901 - Offline evaluation/report orchestration
    enrollment = json.loads((DATA / "enrollment.json").read_text())
    refs = {}
    for e in enrollment:
        # Manually verified subject is largest face. Poster in angle 1 is excluded.
        target = max(
            e["faceRecords"],
            key=lambda r: r["Face"]["BoundingBox"]["Width"] * r["Face"]["BoundingBox"]["Height"],
        )
        refs[target["Face"]["FaceId"]] = (e["variant"], e["angle"])
    rows = [json.loads(line) for line in (DATA / "detections.jsonl").read_text().splitlines()]
    labeled = []
    for r in rows:
        for f in r["faces"]:
            box = f["detail"]["BoundingBox"]
            cx = box["Left"] + box["Width"] / 2
            cy = box["Top"] + box["Height"] / 2
            # Hand-reviewed fixed scene position: gray shirt at x~600,y~450.
            is_target = "no_known" not in r["video"] and (
                "many" not in r["video"] or (0.43 < cx < 0.50 and 0.55 < cy < 0.70)
            )
            if r["sampleId"] == "has_known_face_no_glasses__038" and f["index"] == 1:
                is_target = False  # Hand falsely detected as a face; verified in crop sheet.
            scores = {variant: [None] * 5 for variant in ("original", "mirror")}
            for m in f["matches"]:
                ref = refs.get(m["Face"]["FaceId"])
                if ref:
                    scores[ref[0]][ref[1]] = m["Similarity"]
            labeled.append(
                {
                    "sampleId": r["sampleId"],
                    "video": r["video"],
                    "time": r["time"],
                    "faceIndex": f["index"],
                    "target": is_target,
                    "faceWidthPixels": box["Width"] * 1280,
                    "cropFaceCount": f["cropFaceCount"],
                    "scores": scores,
                    "cropPath": f["cropPath"],
                }
            )
    (DATA / "labeled-scores.json").write_text(json.dumps(labeled, indent=2), encoding="utf-8")
    combos = [(0,) + c for n in range(5) for c in itertools.combinations(range(1, 5), n)]
    results = []
    for variant in ["original", "mirror"]:
        for combo in combos:
            videos = []
            tp = fn = fp = tn = abstain = positive_abstain = negative_abstain = 0
            for video in sorted({r["video"] for r in rows}):
                v = [r for r in labeled if r["video"] == video]
                counts = {
                    "tp": 0,
                    "fn": 0,
                    "fp": 0,
                    "tn": 0,
                    "abstain": 0,
                    "positiveAbstain": 0,
                    "negativeAbstain": 0,
                }
                for f in v:
                    available = [
                        f["scores"][variant][i]
                        for i in combo
                        if f["scores"][variant][i] is not None
                    ]
                    score = max(available) if available else None
                    predicted = score is not None and score >= 90 and f["cropFaceCount"] == 1
                    counts[
                        "tp"
                        if f["target"] and predicted
                        else "fn"
                        if f["target"]
                        else "fp"
                        if predicted
                        else "tn"
                    ] += 1
                    if not available or f["cropFaceCount"] != 1:
                        counts["abstain"] += 1
                        counts["positiveAbstain" if f["target"] else "negativeAbstain"] += 1
                videos.append({"video": video, **counts})
                tp += counts["tp"]
                fn += counts["fn"]
                fp += counts["fp"]
                tn += counts["tn"]
                abstain += counts["abstain"]
                positive_abstain += counts["positiveAbstain"]
                negative_abstain += counts["negativeAbstain"]
            results.append(
                {
                    "variant": variant,
                    "angles": combo,
                    "n": len(combo),
                    "tp": tp,
                    "fn": fn,
                    "fp": fp,
                    "tn": tn,
                    "abstain": abstain,
                    "positiveAbstain": positive_abstain,
                    "negativeAbstain": negative_abstain,
                    "fnClassifiedUnknown": fn - positive_abstain,
                    "tnClassifiedUnknown": tn - negative_abstain,
                    "recall": tp / (tp + fn) if tp + fn else None,
                    "fpr": fp / (fp + tn) if fp + tn else None,
                    "videos": videos,
                }
            )
    (DATA / "subset-results.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    with (DATA / "subset-results.csv").open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(
            f,
            fieldnames=[
                "variant",
                "angles",
                "n",
                "tp",
                "fn",
                "fp",
                "tn",
                "abstain",
                "positiveAbstain",
                "negativeAbstain",
                "fnClassifiedUnknown",
                "tnClassifiedUnknown",
                "recall",
                "fpr",
            ],
        )
        w.writeheader()
        w.writerows({k: v for k, v in r.items() if k != "videos"} for r in results)
    print(
        "Face opportunities:",
        len(labeled),
        "positive:",
        sum(f["target"] for f in labeled),
    )
    for variant in ["original", "mirror"]:
        for n in range(1, 6):
            best = max(
                [r for r in results if r["variant"] == variant and r["n"] == n],
                key=lambda r: r["recall"],
            )
            print(json.dumps(best))
    print(
        "No detection frame counts:",
        {
            v: sum(not r["faces"] for r in rows if r["video"] == v)
            for v in sorted({r["video"] for r in rows})
        },
    )


if __name__ == "__main__":
    main()
