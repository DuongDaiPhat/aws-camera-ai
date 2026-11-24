"""Summarize observed E2E evidence without inferring missing AWS calls or results."""

import json
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs/test/FACE_REACCEPTANCE_2026-11-23"
pipeline = [
    json.loads(line)
    for line in (OUT / "evidence/pipeline.jsonl").read_text(encoding="utf-8").splitlines()
]
mqtt = [
    json.loads(line)
    for line in (OUT / "evidence/frigate-events.jsonl").read_text(encoding="utf-8").splitlines()
]
cloud_file = OUT / "evidence/cloudwatch.json"
cloud = (
    json.loads(cloud_file.read_text(encoding="utf-8")) if cloud_file.exists() else {"events": []}
)
provider = {}
for entry in cloud["events"]:
    message = entry["message"]
    job = re.search(r"jobId=([\w-]+)", message)
    request = re.search(r"awsRequestId=([\w-]+)", message)
    if job and request and "operation=SearchFacesByImage" in message:
        provider.setdefault(job[1], set()).add(request[1])

summary = []
for file in sorted((OUT / "data").glob("TC*.json")):
    data = json.loads(file.read_text(encoding="utf-8"))
    if not all(key in data for key in ["case", "video", "events", "jobs"]):
        continue
    label = data["case"]
    trace = [row for row in pipeline if row.get("case") == label]
    jobs = data["jobs"]
    job_ids = {job["id"] for job in jobs}
    puts = {
        row.get("requestId")
        for row in pipeline
        if row["type"] == "aws-sdk"
        and row.get("operation") == "PutObjectCommand"
        and any(f"/face/{job}." in row.get("key", "") for job in job_ids)
    }
    sends = {
        row.get("requestId")
        for row in pipeline
        if row["type"] == "aws-sdk"
        and row.get("operation") == "SendMessageCommand"
        and row.get("jobId") in job_ids
    }
    states = []
    for job in jobs:
        body = (job.get("cached_result") or {}).get("payload", {}).get("body", {})
        results = body.get("results", [])
        meta = results[0].get("metadata", {}) if results else {}
        states.append(
            {
                "jobId": job["id"],
                "revision": job["revision"],
                "status": body.get("personStatus"),
                "qualityReason": meta.get("qualityReason"),
                "collectionVersion": body.get("collectionVersion"),
                "similarity": meta.get("similarity"),
                "searchRequestIds": sorted(provider.get(job["id"], set())),
            }
        )
    known_updates = []
    event_ids = {event["id"] for event in data["events"]}
    for record in data.get("after", {}).get("tracks", []):
        if (
            record.get("state") != "KNOWN"
            or record.get("eventId") not in event_ids
            or not record.get("lastResultAt")
        ):
            continue
        for row in mqtt:
            observed = row["message"]["after"]
            if (
                observed["id"] == record["trackId"]
                and data["startedAt"] <= row["at"] <= data["endedAt"]
            ):
                # frame_time is an actual person observation; event delivery/end
                # can lag by seconds and must not inflate the visible KNOWN span.
                known_updates.append(
                    round(
                        (observed["frame_time"] * 1000 - record["lastResultAt"]) / 1000,
                        3,
                    )
                )
    summary.append(
        {
            "case": label,
            "video": data["video"],
            "startedAt": data["startedAt"],
            "events": len(data["events"]),
            "eventStatuses": dict(
                Counter(event.get("person_status") or "NOT_ANALYZED" for event in data["events"])
            ),
            "jobs": len(jobs),
            "putObject": len(puts - {None}),
            "sendMessage": len(sends - {None}),
            "searchFacesByImage": sum(len(provider.get(job, set())) for job in job_ids)
            if all(job in provider for job in job_ids)
            else None,
            "results": states,
            "gateRejected": dict(
                Counter(
                    row.get("rejectionReason")
                    for row in trace
                    if row["type"] == "assess" and not row["passed"]
                )
            ),
            "verifiedContinuations": sum(row["type"] == "verified-continuation" for row in trace),
            "knownObservedSecondsAfterResult": max(known_updates, default=0),
            "dispatches": [
                {
                    key: row.get(key)
                    for key in [
                        "at",
                        "trackId",
                        "qualityScore",
                        "capturedAt",
                        "retry",
                        "samplesCollected",
                        "cropFile",
                        "imageSha256",
                    ]
                }
                for row in trace
                if row["type"] == "dispatch"
            ],
        }
    )
(OUT / "data/summary.json").write_text(
    json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
)
print(
    json.dumps(
        [
            {
                key: row[key]
                for key in [
                    "case",
                    "events",
                    "eventStatuses",
                    "jobs",
                    "searchFacesByImage",
                    "knownObservedSecondsAfterResult",
                ]
            }
            for row in summary
            if any(
                tag in row["case"]
                for tag in ["verified", "TC10-", "TC09-unknown-cap", "continuity"]
            )
        ],
        ensure_ascii=False,
        indent=2,
    )
)
