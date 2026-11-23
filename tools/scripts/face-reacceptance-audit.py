"""Check acceptance criteria against saved video, SDK and CloudWatch evidence."""

import json
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs/test/FACE_REACCEPTANCE_2026-11-23"
summary = {
    r["case"]: r for r in json.loads((OUT / "data/summary.json").read_text(encoding="utf-8"))
}
checks = []


def check(name, condition, detail):
    checks.append({"criterion": name, "passed": bool(condition), "observed": detail})


def load(label):
    return json.loads((OUT / f"data/{label}.json").read_text(encoding="utf-8"))


def one_known(label):
    r = summary[label]
    check(
        label,
        r["eventStatuses"] == {"KNOWN": 1} and r["jobs"] == r["searchFacesByImage"] == 1,
        r,
    )


for label in [
    "TC02-no-glasses-verified",
    "TC02-glasses-replay",
    "TC02-lock-no-glasses-verified",
    "TC02-lock-glasses-verified",
    "TC05-no-glasses-continuity",
    "TC05-glasses-continuity",
]:
    one_known(label)
    r = summary[label]
    if "lock-" in label:
        check(
            f"{label}: >=10s visible KNOWN",
            r["knownObservedSecondsAfterResult"] >= 10,
            r["knownObservedSecondsAfterResult"],
        )
    if "continuity" in label:
        d = load(label)
        tracks = [t for t in d["after"]["tracks"] if t["eventId"] == d["events"][0]["id"]]
        canonical = {t["canonicalTrackId"] for t in tracks}
        check(
            f"{label}: one logical track/event",
            len(tracks) == 2 and len(canonical) == 1 and r["verifiedContinuations"] >= 1,
            {"rawTracks": len(tracks), "canonicalIds": sorted(canonical)},
        )

for label in ["TC08-no-glasses-verified", "TC08-glasses-verified"]:
    r = summary[label]
    check(
        label,
        r["eventStatuses"].get("KNOWN", 0) >= 1
        and r["eventStatuses"].get("UNKNOWN", 0) >= 1
        and r["eventStatuses"].get("NOT_ANALYZED", 0) == 0
        and r["jobs"] == r["searchFacesByImage"] == 2,
        r,
    )

for label in ["TC09-known-filename-verified", "TC09-stranger-verified"]:
    r = summary[label]
    check(
        label,
        r["eventStatuses"] == {"UNKNOWN": 1} and r["jobs"] == r["searchFacesByImage"] == 1,
        r,
    )

r = summary["TC09-undetermined-retry-verified"]
check(
    "UNDETERMINED -> KNOWN on same event",
    r["events"] == 1
    and r["jobs"] == r["searchFacesByImage"] == 2
    and [x["status"] for x in r["results"]] == ["UNDETERMINED", "KNOWN"]
    and r["results"][0]["qualityReason"] == "NO_FACE_DETECTED",
    r,
)

r = summary["TC09-undetermined-cap-verified"]
d = load(r["case"])
t = next(t for t in d["after"]["tracks"] if t["eventId"] == d["events"][0]["id"])
check(
    "UNDETERMINED maximum two retries",
    r["events"] == 1
    and r["jobs"] == r["searchFacesByImage"] == 3
    and all(
        x["status"] == "UNDETERMINED" and x["qualityReason"] == "IMAGE_UNAVAILABLE"
        for x in r["results"]
    )
    and t["undeterminedRetriesUsed"] == 2
    and t["currentRevision"] == 3,
    r,
)

r = summary["TC09-unknown-cap"]
d = load(r["case"])
t = next(t for t in d["after"]["tracks"] if t["eventId"] == d["events"][0]["id"])
gain = (
    r["dispatches"][1]["qualityScore"] - r["dispatches"][0]["qualityScore"]
    if len(r["dispatches"]) == 2
    else 0
)
check(
    "UNKNOWN maximum one recheck with real quality gain",
    r["events"] == 1
    and r["jobs"] == r["searchFacesByImage"] == 2
    and all(x["status"] == "UNKNOWN" for x in r["results"])
    and gain >= 0.15
    and t["unknownRecheckUsed"],
    {"qualityGain": gain, "evidence": r},
)

one_known("TC10-cache-prime")
r = summary["TC10-cache-hit"]
d = load(r["case"])
meta = d["events"][0]["ai_results"][0]["metadata"]
check(
    "Real embedding hit with zero face Put/Send/Search",
    r["eventStatuses"] == {"KNOWN": 1}
    and r["jobs"] == r["putObject"] == r["sendMessage"] == r["searchFacesByImage"] == 0
    and meta.get("cacheHit")
    and meta.get("matchMethod") == "embedding",
    {"metadata": meta, "evidence": r},
)
r = summary["TC10-after-delete"]
prime = summary["TC10-cache-prime"]
elapsed = (
    datetime.fromisoformat(r["startedAt"].replace("Z", "+00:00"))
    - datetime.fromisoformat(prime["startedAt"].replace("Z", "+00:00"))
).total_seconds()
check(
    "Version invalidates proven cache inside 300s TTL",
    r["eventStatuses"] == {"UNKNOWN": 1}
    and r["jobs"] == r["searchFacesByImage"] == 1
    and elapsed < 300
    and r["results"][0]["collectionVersion"] > prime["results"][0]["collectionVersion"],
    {"secondsSincePrimeStarted": elapsed, "evidence": r},
)

trace = [
    json.loads(line)
    for line in (OUT / "evidence/pipeline.jsonl").read_text(encoding="utf-8").splitlines()
]
for label in ["TC09-undetermined-cap-verified", "TC09-unknown-cap"]:
    rows = [r for r in trace if r.get("case") == label]
    d = load(label)
    t = next(t for t in d["after"]["tracks"] if t["eventId"] == d["events"][0]["id"])
    mqtt = [
        json.loads(line)
        for line in (OUT / "evidence/frigate-events.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    last_visible = max(
        r["message"]["after"]["frame_time"] * 1000
        for r in mqtt
        if r["message"]["after"]["id"] == t["trackId"]
    )
    check(
        f"{label}: continued visible frames after cap",
        last_visible - t["lastResultAt"] >= 5000,
        {"secondsVisibleAfterLastResult": (last_visible - t["lastResultAt"]) / 1000},
    )
    if "undetermined" in label:
        gaps = []
        for i, row in enumerate(rows):
            if row["type"] == "dispatch" and row["retry"]:
                previous = next(r for r in reversed(rows[:i]) if r["type"] == "result")
                gaps.append(
                    (
                        datetime.fromisoformat(row["at"].replace("Z", "+00:00"))
                        - datetime.fromisoformat(previous["at"].replace("Z", "+00:00"))
                    ).total_seconds()
                )
        check(
            "UNDETERMINED retries respect >=4000ms cooldown",
            len(gaps) == 2 and min(gaps) >= 4,
            gaps,
        )
d = load("TC10-cache-hit")
face_calls = [
    r
    for r in trace
    if r["type"] == "aws-sdk"
    and d["startedAt"] <= r["at"] <= d["endedAt"]
    and (
        (r.get("operation") == "PutObjectCommand" and "/face/" in r.get("key", ""))
        or (r.get("operation") == "SendMessageCommand" and r.get("messageType") == "face.job")
    )
]
check("Cache-hit interval has no orphan face upload/job send", not face_calls, face_calls)
check(
    "Video 6 excluded from E2E",
    not any("vid6" in r.get("video", "") for r in trace if r["type"] == "video-start"),
    "No Video 6 replay in this evidence set",
)
result = {
    "allRequiredChecksPassed": all(c["passed"] for c in checks),
    "e2eResolution": [1920, 1080],
    "distanceEstimateResolutionProvidedByUser": [1280, 720],
    "acceptedUnmet": ["TC08-extra-no-glasses", "TC08-extra-glasses"],
    "checks": checks,
}
(OUT / "data/acceptance-checks.json").write_text(
    json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
)
print(
    json.dumps(
        {
            "passed": sum(c["passed"] for c in checks),
            "total": len(checks),
            "failed": [c["criterion"] for c in checks if not c["passed"]],
        },
        ensure_ascii=False,
    )
)
raise SystemExit(0 if result["allRequiredChecksPassed"] else 1)
