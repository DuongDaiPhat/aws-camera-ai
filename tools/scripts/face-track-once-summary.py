"""Summarize actual dev replays and source identity without inventing verdicts."""

import csv
import hashlib
import json
import re
import shutil
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

import cv2

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs/test/FACE_TRACK_ONCE_2026-11-22"


def save(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, default=str), encoding="utf-8")


def manifest():
    files = []
    for p in sorted((ROOT / "local_image/Dataset_2").rglob("*")):
        if not p.is_file():
            continue
        row = {
            "file": str(p.relative_to(ROOT)).replace("\\", "/"),
            "bytes": p.stat().st_size,
        }
        digest = hashlib.sha256()
        with p.open("rb") as f:
            for chunk in iter(lambda: f.read(1024 * 1024), b""):
                digest.update(chunk)
        row["sha256"] = digest.hexdigest()
        if p.suffix.lower() == ".mp4":
            cap = cv2.VideoCapture(str(p))
            fps = cap.get(cv2.CAP_PROP_FPS)
            row.update(
                fps=fps,
                frames=int(cap.get(cv2.CAP_PROP_FRAME_COUNT)),
                width=int(cap.get(3)),
                height=int(cap.get(4)),
            )
            row["seconds"] = round(row["frames"] / fps, 3)
            cap.release()
        files.append(row)
    groups = defaultdict(list)
    for row in files:
        groups[row["sha256"]].append(row["file"])
    save(
        OUT / "data/manifest.json",
        {"files": files, "duplicates": [g for g in groups.values() if len(g) > 1]},
    )


def _parse_cloudwatch_events(aws_events):
    requests = defaultdict(set)
    aws_lines = defaultdict(list)
    empty_jobs = set()
    for event in aws_events:
        message = event["message"]
        match = re.search(
            r"jobId=([\w-]+).*operation=SearchFacesByImage awsRequestId=([\w-]+)",
            message,
        )
        if match:
            requests[match[1]].add(match[2])
            aws_lines[match[1]].append(message.strip())
        match = re.search(r"jobId=([\w-]+).*operation=none reason=empty-collection-v1", message)
        if match:
            empty_jobs.add(match[1])
    return requests, aws_lines, empty_jobs


def _collect_crop_index(trace):
    crop_dir = OUT / "evidence/crops"
    crop_dir.mkdir(exist_ok=True)
    crop_cases = {
        "TC06-no-glasses-acceptance",
        "TC06-glasses-acceptance",
        "TC08-extra-no-glasses-acceptance",
        "TC08-glasses-aligned",
        "TC07-separated-aligned",
        "TC10-before-delete-aligned",
        "TC10-after-delete-aligned",
        "TC02-glasses-postfix-supplement",
    }
    crop_index = []
    for dispatch in trace:
        if dispatch["type"] != "dispatch" or dispatch.get("case") not in crop_cases:
            continue
        candidates = [
            (i, t)
            for i, t in enumerate(trace)
            if t["type"] == "assess"
            and t.get("case") == dispatch["case"]
            and t.get("trackId") == dispatch["trackId"]
            and t.get("passed")
            and t.get("qualityScore") == dispatch["qualityScore"]
            and t["at"] <= dispatch["at"]
        ]
        if not candidates:
            continue
        i, assessed = candidates[-1]
        crop = next(
            (
                t
                for t in trace[i + 1 :]
                if t["type"] == "crop"
                and t.get("case") == dispatch["case"]
                and t.get("trackId") == dispatch["trackId"]
            ),
            None,
        )
        if not crop or not (ROOT / crop["path"]).exists():
            continue
        source = ROOT / crop["path"]
        if hashlib.sha256(source.read_bytes()).hexdigest() != assessed["imageSha256"]:
            raise ValueError("Dispatch crop digest mismatch")
        destination = crop_dir / f"{dispatch['case']}_{dispatch['trackId']}.jpg"
        shutil.copy2(source, destination)
        crop_index.append(
            {
                "case": dispatch["case"],
                "eventId": dispatch["eventId"],
                "trackId": dispatch["trackId"],
                "qualityScore": dispatch["qualityScore"],
                "sha256": assessed["imageSha256"],
                "file": destination.relative_to(OUT).as_posix(),
            }
        )
    return crop_index


def summarize():
    trace = [
        json.loads(s)
        for s in (OUT / "evidence/pipeline.jsonl").read_text(encoding="utf-8").splitlines()
        if s.strip()
    ]
    aws_events = (
        json.loads((OUT / "evidence/cloudwatch.json").read_text(encoding="utf-8")).get("events", [])
        if (OUT / "evidence/cloudwatch.json").exists()
        else []
    )
    requests, aws_lines, empty_jobs = _parse_cloudwatch_events(aws_events)
    summary = []
    raw_events = [
        json.loads(s)
        for s in (OUT / "evidence/frigate-events.jsonl").read_text(encoding="utf-8").splitlines()
        if s.strip()
    ]
    for p in sorted((OUT / "data").glob("TC*.json")):
        data = json.loads(p.read_text(encoding="utf-8"))
        if "events" not in data or "video" not in data:
            continue
        rows = [t for t in trace if t.get("case") == data["case"]]
        gates = [t for t in rows if t["type"] == "assess"]
        dispatches = [t for t in rows if t["type"] == "dispatch"]
        locked_updates = [
            t
            for t in rows
            if t["type"] == "track"
            and t.get("messageType") != "end"
            and (t.get("after") or {}).get("state") == "KNOWN"
            and t["after"].get("lastResultAt")
        ]
        job_ids = {j["id"] for j in data["jobs"]}
        event_ids = {e["id"] for e in data["events"]}
        track_ids = {e["track_id"] for e in data["events"]}
        sdk = [
            t
            for t in trace
            if t["type"] == "aws-sdk"
            and (
                t.get("jobId") in job_ids
                or any(f"/events/{e}/face/" in t.get("key", "") for e in event_ids)
            )
        ]
        frigate = [
            r["message"]["after"] for r in raw_events if r["message"]["after"]["id"] in track_ids
        ]
        providers = Counter()
        methods = Counter()
        for e in data["events"]:
            for a in e.get("ai_results") or []:
                meta = a.get("metadata") or {}
                if meta.get("provider"):
                    providers[meta["provider"]] += 1
                if meta.get("matchMethod"):
                    methods[meta["matchMethod"]] += 1
        metrics_before = data.get("before", {}).get("metrics") or {}
        metrics_after = data.get("after", {}).get("metrics") or {}
        row = {
            "case": data["case"],
            "video": data["video"],
            "startedAt": data["startedAt"],
            "endedAt": data["endedAt"],
            "events": len(data["events"]),
            "eventIds": [e["id"] for e in data["events"]],
            "personStatuses": dict(
                Counter(e.get("person_status") or "NOT_ANALYZED" for e in data["events"])
            ),
            "names": sorted({e["person_name"] for e in data["events"] if e.get("person_name")}),
            "jobs": len(data["jobs"]),
            "awsSdkTraceCoverageComplete": data["startedAt"] >= "2026-11-22T15:45:58.901Z",
            "resultReceipts": sum(bool(j.get("cached_result")) for j in data["jobs"]),
            "revisions": [j["revision"] for j in data["jobs"]],
            "collectionVersions": sorted(
                {j["envelope"]["payload"].get("collectionVersion") for j in data["jobs"]}
            ),
            "faceS3PutRequests": [
                t.get("requestId") for t in sdk if t["operation"] == "PutObjectCommand"
            ],
            "faceSqsSendRequests": [
                t.get("requestId") for t in sdk if t["operation"] == "SendMessageCommand"
            ],
            "awsSdkAttempts": [t.get("attempts") for t in sdk],
            "jobIds": [j["id"] for j in data["jobs"]],
            "searchRequestIds": sorted({r for j in data["jobs"] for r in requests[j["id"]]}),
            "emptyCollectionJobs": sum(j["id"] in empty_jobs for j in data["jobs"]),
            "searchLogCoverageComplete": all(
                j["id"] in requests or j["id"] in empty_jobs for j in data["jobs"]
            ),
            "cloudwatchOperations": [line for j in data["jobs"] for line in aws_lines[j["id"]]],
            "gateSamples": len(gates),
            "gatePassed": sum(g["passed"] for g in gates),
            "gateRejections": dict(
                Counter(g.get("rejectionReason") for g in gates if not g["passed"])
            ),
            "maxFaceWidthPx": max(
                [g["metrics"]["faceWidthPx"] for g in gates if g.get("metrics")] or [0]
            ),
            "dispatches": dispatches,
            "knownFreezeObservedSeconds": round(
                max(
                    [
                        (
                            datetime.fromisoformat(t["at"]).timestamp() * 1000
                            - t["after"]["lastResultAt"]
                        )
                        / 1000
                        for t in locked_updates
                    ]
                    or [0]
                ),
                3,
            ),
            "stationaryObserved": any(f.get("stationary") for f in frigate),
            "maxMotionlessCount": max([f.get("motionless_count", 0) for f in frigate] or [0]),
            "trackIds": sorted(track_ids),
            "matchedKnownFaceIds": sorted(
                {
                    e["matched_known_face_id"]
                    for e in data["events"]
                    if e.get("matched_known_face_id")
                }
            ),
            "elapsedSeconds": round(
                (
                    datetime.fromisoformat(data["endedAt"])
                    - datetime.fromisoformat(data["startedAt"])
                ).total_seconds(),
                3,
            ),
            "providers": dict(providers),
            "localMatchMethods": dict(methods),
            "metricDelta": {k: v - metrics_before.get(k, 0) for k, v in metrics_after.items()},
            "evidence": str(p.relative_to(OUT)).replace("\\", "/"),
        }
        summary.append(row)
    save(OUT / "data/summary.json", summary)
    save(OUT / "data/crop-index.json", _collect_crop_index(trace))
    save(
        OUT / "data/acceptance-summary.json",
        [
            r
            for r in summary
            if r["case"].endswith(("-acceptance", "-aligned"))
            or r["case"] == "TC10-empty-long"
            or "-supplement" in r["case"]
        ],
    )
    selected = [
        r
        for r in summary
        if r["case"].endswith(("-acceptance", "-aligned"))
        or r["case"] == "TC10-empty-long"
        or "-supplement" in r["case"]
    ]
    lines = [
        "# Kết quả từng lượt replay",
        "",
        "Dữ liệu tổng hợp từ DB, trace SDK và CloudWatch. `NOT_ANALYZED` tương ứng person_status=NULL/chưa phân tích trên giao diện. Đếm S3 chỉ gồm PutObject ảnh nhận diện. Dấu `?` nghĩa chưa đủ log, không được coi là 0 call.",
        "",
        "| Lượt / bằng chứng | Video | Event / kết quả | Job / S3 / SQS / Search | Gate đạt/tổng; từ chối | Cache |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for r in sorted(selected, key=lambda row: row["startedAt"]):
        calls = str(len(r["searchRequestIds"])) if r["searchLogCoverageComplete"] else "?"
        statuses = ", ".join(f"{k}×{v}" for k, v in r["personStatuses"].items()) or "không có event"
        rejected = ", ".join(f"{k}×{v}" for k, v in r["gateRejections"].items()) or "—"
        methods = ", ".join(f"{k}×{v}" for k, v in r["localMatchMethods"].items()) or "—"
        s3 = str(len(r["faceS3PutRequests"])) if r["awsSdkTraceCoverageComplete"] else "?"
        sqs = str(len(r["faceSqsSendRequests"])) if r["awsSdkTraceCoverageComplete"] else "?"
        lines.append(
            f"| [{r['case']}]({r['evidence']}) | `{r['video']}` | {r['events']}: {statuses} | {r['jobs']} / {s3} / {sqs} / {calls} | {r['gatePassed']}/{r['gateSamples']}; {rejected} | {methods} |"
        )
    (OUT / "RESULTS.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    with (OUT / "data/summary.csv").open("w", newline="", encoding="utf-8-sig") as f:
        fields = [
            "case",
            "video",
            "events",
            "personStatuses",
            "names",
            "jobs",
            "searchRequestIds",
            "faceS3PutRequests",
            "faceSqsSendRequests",
            "resultReceipts",
            "gateSamples",
            "gateRejections",
            "providers",
            "localMatchMethods",
            "stationaryObserved",
        ]
        writer = csv.DictWriter(f, fields, extrasaction="ignore")
        writer.writeheader()
        for row in summary:
            writer.writerow(
                {
                    k: json.dumps(row[k], ensure_ascii=False)
                    if isinstance(row[k], (dict, list))
                    else row[k]
                    for k in fields
                }
            )
    print(
        json.dumps(
            [
                {
                    k: r[k]
                    for k in (
                        "case",
                        "events",
                        "personStatuses",
                        "jobs",
                        "providers",
                        "localMatchMethods",
                    )
                }
                for r in summary
            ],
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    if "--summary-only" not in sys.argv:
        manifest()
    summarize()
