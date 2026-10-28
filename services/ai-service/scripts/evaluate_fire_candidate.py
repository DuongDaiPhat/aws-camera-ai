"""Evaluate a separately exported, checkpoint-preserving candidate on frozen videos.

No model staging, deployment threshold change, training or external delivery.
The inspected source videos are diagnostic material, not a fresh holdout.
"""

import argparse
import json
import logging
from dataclasses import asdict
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.config import Settings
from app.services.fire_detector import FireDetector
from scripts.evaluate_fire_manifest import REPOSITORY_ROOT, VideoManifest, verified_inputs
from scripts.evaluate_fire_videos import SERVICE_DIR, ClipReport, checksum, evaluate_clip, summary

LOGGER = logging.getLogger(__name__)


class CandidateModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class CandidateHead(CandidateModel):
    preserves_checkpoint_mode: Literal[True]
    output_confidence_floor: float = Field(ge=0, le=1)
    export_end_to_end: bool


class CandidateOnnx(CandidateModel):
    path: str
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    size_bytes: int = Field(gt=0)
    mode: Literal["nms-free-one-to-one", "one-to-many-embedded-nms"]


class CandidateExport(CandidateModel):
    status: Literal["EXPORT_AND_LOCAL_IMAGE_PARITY_PASSED"]
    checkpoint_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    checkpoint_unchanged: Literal[True]
    prediction_head: CandidateHead
    onnx: CandidateOnnx


def candidate_settings(
    manifest: VideoManifest, exported: CandidateExport, model_version: str
) -> Settings:
    path = Path(exported.onnx.path).resolve()
    if not path.is_relative_to(REPOSITORY_ROOT):
        raise ValueError("Candidate model must be inside the repository")
    if checksum(path) != exported.onnx.sha256 or path.stat().st_size != exported.onnx.size_bytes:
        raise ValueError("Candidate model bytes differ from the parity report")
    if exported.prediction_head.output_confidence_floor > manifest.policy.output_floor:
        raise ValueError("Embedded graph floor omits declared evaluation predictions")
    policy = manifest.policy
    return Settings(
        _env_file=None,
        fire_model_path=str(path),
        fire_model_sha256=exported.onnx.sha256,
        fire_model_version=model_version,
        fire_confidence_threshold=policy.baseline,
        fire_output_confidence_floor=policy.output_floor,
        fire_cpu_threads=policy.cpu_threads,
        fire_min_consecutive_frames=policy.required_frames,
        fire_confirmation_window_seconds=policy.window_seconds,
        fire_max_frame_gap_seconds=policy.max_gap_seconds,
        fire_clear_seconds=policy.clear_seconds,
    )


def implementation_hashes() -> dict[str, str]:
    return {
        name: checksum(SERVICE_DIR / name)
        for name in (
            "scripts/evaluate_fire_candidate.py",
            "scripts/evaluate_fire_manifest.py",
            "scripts/evaluate_fire_videos.py",
            "app/services/fire_detector.py",
            "app/services/fire_tracker.py",
            "app/config.py",
        )
    }


def evaluate(
    manifest: VideoManifest, paths: list[Path], settings: Settings, output: Path
) -> list[ClipReport]:
    detector = FireDetector(settings)
    reports = []
    with (output / "frames.jsonl").open("w", encoding="utf-8") as frames_log:
        for path in paths:
            report = evaluate_clip(
                path,
                output,
                detector,
                settings,
                manifest.policy.sample_fps,
                manifest.policy.jpeg_quality,
                frames_log,
            )
            reports.append(report)
            (output / "clips.json").write_text(
                json.dumps([asdict(item) for item in reports], indent=2), encoding="utf-8"
            )
            LOGGER.info(
                "%s: fire=%s combined=%s",
                report.clip,
                report.fire_episode_seconds,
                report.combined_episode_seconds,
            )
    return reports


def run(manifest_path: Path, export_report: Path, model_version: str, output: Path) -> None:
    manifest_sha, export_sha = checksum(manifest_path), checksum(export_report)
    implementation = implementation_hashes()
    manifest = VideoManifest.model_validate_json(manifest_path.read_text(encoding="utf-8"))
    exported = CandidateExport.model_validate_json(export_report.read_text(encoding="utf-8"))
    if exported.checkpoint_sha256 != manifest.provenance["checkpointSha256"]:
        raise ValueError("Export does not belong to the frozen checkpoint")
    if (
        export_sha != manifest.provenance["exportReportSha256"]
        or exported.onnx.sha256 != manifest.provenance["modelSha256"]
    ):
        raise ValueError("Export candidate differs from the frozen model selection")
    settings = candidate_settings(manifest, exported, model_version)
    paths = verified_inputs(manifest, REPOSITORY_ROOT)
    output.mkdir(parents=True, exist_ok=False)
    reports = evaluate(manifest, paths, settings, output)
    if checksum(manifest_path) != manifest_sha or checksum(export_report) != export_sha:
        raise ValueError("Frozen manifest or export report changed during inference")
    if implementation_hashes() != implementation:
        raise ValueError("Evaluation implementation changed during inference")
    if checksum(Path(settings.fire_model_path)) != exported.onnx.sha256:
        raise ValueError("Candidate model changed during inference")
    grouped = {}
    for group in sorted({Path(item.path).parts[0] for item in manifest.clips}):
        selected = [
            report
            for report, item in zip(reports, manifest.clips, strict=True)
            if Path(item.path).parts[0] == group
        ]
        grouped[group] = {
            "fire_only": summary(selected, False),
            "production_fire_or_smoke": summary(selected, True),
        }
    result = {
        "dataset_id": manifest.dataset_id,
        "manifest_sha256": manifest_sha,
        "export_report_sha256": export_sha,
        "implementation_sha256": implementation,
        "model": {
            "modelVersion": model_version,
            **exported.onnx.model_dump(by_alias=True),
            "checkpointSha256": exported.checkpoint_sha256,
        },
        "prediction_head": exported.prediction_head.model_dump(by_alias=True),
        "settings": {
            "sample_fps": manifest.policy.sample_fps,
            "jpeg_quality": manifest.policy.jpeg_quality,
            "threshold": manifest.policy.baseline,
            "output_confidence_floor": manifest.policy.output_floor,
            "required_frames": manifest.policy.required_frames,
            "window_seconds": manifest.policy.window_seconds,
            "max_gap_seconds": manifest.policy.max_gap_seconds,
            "clear_seconds": manifest.policy.clear_seconds,
            "cpu_threads": manifest.policy.cpu_threads,
        },
        "fire_only": summary(reports, False),
        "production_fire_or_smoke": summary(reports, True),
        "datasets": grouped,
        "deployment_settings_changed": False,
        "limitations": manifest.limitations,
    }
    (output / "summary.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    LOGGER.info("Completed checkpoint-preserving candidate: %s", json.dumps(result["datasets"]))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--export-report", type=Path, required=True)
    parser.add_argument("--model-version", required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    run(args.manifest, args.export_report, args.model_version, args.output_dir)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    main()
