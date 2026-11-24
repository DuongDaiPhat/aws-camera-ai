"""Verify inferred subsets against independently indexed live collections."""

import json
import os
import uuid
from contextlib import suppress
from pathlib import Path

import boto3
from botocore.config import Config

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "docs/test/REKOGNITION_2026-11-22/data"
PRIVATE = ROOT / "artifacts/rekognition-eval-2026-11-22/enrollment"


def main():
    rek = boto3.client(
        "rekognition",
        region_name=os.environ["AWS_REGION"],
        config=Config(
            connect_timeout=5,
            read_timeout=30,
            retries={"total_max_attempts": 3, "mode": "standard"},
        ),
    )
    samples = json.loads((DATA / "labeled-scores.json").read_text())
    output = DATA / "subset-live-verification.jsonl"
    done = (
        {
            (r["subset"], r["sampleId"], r["faceIndex"])
            for r in [json.loads(line) for line in output.read_text().splitlines()]
        }
        if output.exists()
        else set()
    )
    for angles in [[0], [0, 3, 4]]:
        subset = "-".join(map(str, angles))
        collection = "camerai-s4-dev-owner-" + str(
            uuid.uuid5(uuid.NAMESPACE_URL, "face-eval-20261122-subset-" + subset)
        )
        with suppress(rek.exceptions.ResourceAlreadyExistsException):
            rek.create_collection(CollectionId=collection)
        for angle in angles:
            rek.index_faces(
                CollectionId=collection,
                Image={"Bytes": (PRIVATE / f"normalized-original-{angle}.jpg").read_bytes()},
                ExternalImageId=f"angle-{angle}",
                MaxFaces=1,
                QualityFilter="AUTO",
            )
        for sample in samples:
            key = (subset, sample["sampleId"], sample["faceIndex"])
            if key in done:
                continue
            available = [
                sample["scores"]["original"][i]
                for i in angles
                if sample["scores"]["original"][i] is not None
            ]
            expected = max(available) if available else None
            actual, request_id = None, None
            if sample["cropFaceCount"] == 1:
                response = rek.search_faces_by_image(
                    CollectionId=collection,
                    Image={"Bytes": (ROOT / sample["cropPath"]).read_bytes()},
                    FaceMatchThreshold=0,
                    MaxFaces=100,
                    QualityFilter="NONE",
                )
                matches = response.get("FaceMatches", [])
                actual = matches[0]["Similarity"] if matches else None
                request_id = response["ResponseMetadata"]["RequestId"]
            row = {
                "subset": subset,
                "collection": collection,
                "sampleId": sample["sampleId"],
                "faceIndex": sample["faceIndex"],
                "target": sample["target"],
                "expectedSimilarity": expected,
                "actualSimilarity": actual,
                "known": actual is not None and actual >= 90,
                "requestId": request_id,
                "classificationMatches": (actual is not None and actual >= 90)
                == (expected is not None and expected >= 90),
            }
            with output.open("a") as f:
                f.write(json.dumps(row) + "\n")
        print("Verified live collection", subset, flush=True)
    rows = [json.loads(line) for line in output.read_text().splitlines()]
    summary = {
        "rows": len(rows),
        "classificationMismatches": [r for r in rows if not r["classificationMatches"]],
    }
    (DATA / "subset-live-summary.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps({"rows": len(rows), "mismatches": len(summary["classificationMismatches"])}))


if __name__ == "__main__":
    main()
