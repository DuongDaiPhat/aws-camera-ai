"""Compare a predeclared confidence candidate on checksum-bound additional videos.

Run from the AI service directory. This is offline video-level screening, not a
load/soak test or a claim of independent event-level release acceptance.
"""

import argparse
import json
import logging
from dataclasses import asdict
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field

from app.config import Settings
from app.services.fire_detector import FireDetector
from scripts.evaluate_fire_videos import SERVICE_DIR, checksum, evaluate_clip, summary
from scripts.sweep_fire_thresholds import replay

LOGGER = logging.getLogger(__name__)
REPOSITORY_ROOT = SERVICE_DIR.parents[1]


class ManifestModel(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class VideoInput(ManifestModel):
    path: str
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    expected_fire: bool = Field(alias="expectedFire")
    source_entry: str = Field(alias="sourceEntry")
    scene_group: str = Field(alias="sceneGroup")


class ExcludedVideo(VideoInput):
    reason: str


class VideoPolicy(ManifestModel):
    baseline: float = Field(gt=0, le=1)
    candidate: float = Field(gt=0, le=1)
    sample_fps: float = Field(gt=0, le=5, alias="sampleFps")
    jpeg_quality: int = Field(ge=1, le=100, alias="jpegQuality")
    required_frames: int = Field(ge=3, le=60, alias="requiredFrames")
    window_seconds: float = Field(gt=0, alias="windowSeconds")
    max_gap_seconds: float = Field(gt=0, alias="maxGapSeconds")
    clear_seconds: float = Field(gt=0, alias="clearSeconds")
    output_floor: float = Field(ge=0, le=1, alias="outputFloor")
    cpu_threads: int = Field(ge=1, le=64, alias="cpuThreads")


class VideoManifest(ManifestModel):
    dataset_id: str = Field(alias="datasetId")
    dataset_root: str = Field(alias="datasetRoot")
    source: str
    license: str
    policy: VideoPolicy
    clips: list[VideoInput] = Field(min_length=2)
    excluded_clips: list[ExcludedVideo] = Field(default_factory=list, alias="excludedClips")
    provenance: dict[str, str]
    limitations: list[str]


def verified_inputs(manifest: VideoManifest, repository: Path) -> list[Path]:
    """Reject duplicate units, class disagreement, traversal and changed source bytes."""
    root = (repository / manifest.dataset_root).resolve()
    if not root.is_relative_to(repository.resolve()):
        raise ValueError("Dataset must stay inside the repository")
    paths: list[Path] = []
    seen_names: set[str] = set()
    seen_hashes: set[str] = set()
    for item in manifest.clips:
        path = (root / item.path).resolve()
        if not path.is_relative_to(root):
            raise ValueError("Video path escapes dataset root")
        if path.parent.name != ("pos" if item.expected_fire else "neg"):
            raise ValueError("Declared label disagrees with source category")
        if path.name in seen_names or item.sha256 in seen_hashes:
            raise ValueError("Duplicate video cannot count as an independent evaluation unit")
        if checksum(path) != item.sha256:
            raise ValueError(f"Video checksum mismatch: {path.name}")
        seen_names.add(path.name)
        seen_hashes.add(item.sha256)
        paths.append(path)
    if len({item.expected_fire for item in manifest.clips}) != 2:
        raise ValueError("Both flame-positive and flame-negative videos are required")
    return paths


def detector_settings(manifest: VideoManifest, artifact: dict[str, object]) -> Settings:
    policy = manifest.policy
    return Settings(
        _env_file=None,
        fire_model_path=str(SERVICE_DIR / "models" / str(artifact["filename"])),
        fire_model_sha256=str(artifact["sha256"]),
        fire_model_version=str(artifact["modelVersion"]),
        fire_confidence_threshold=policy.baseline,
        fire_output_confidence_floor=policy.output_floor,
        fire_min_consecutive_frames=policy.required_frames,
        fire_confirmation_window_seconds=policy.window_seconds,
        fire_max_frame_gap_seconds=policy.max_gap_seconds,
        fire_clear_seconds=policy.clear_seconds,
        fire_cpu_threads=policy.cpu_threads,
    )


def run(manifest_path: Path, output: Path) -> None:
    manifest_sha = checksum(manifest_path)
    implementation = {
        path.relative_to(SERVICE_DIR).as_posix(): checksum(path)
        for path in (
            Path(__file__).resolve(),
            SERVICE_DIR / "scripts/evaluate_fire_videos.py",
            SERVICE_DIR / "scripts/sweep_fire_thresholds.py",
            SERVICE_DIR / "app/services/fire_detector.py",
            SERVICE_DIR / "app/services/fire_tracker.py",
            SERVICE_DIR / "app/config.py",
        )
    }
    manifest = VideoManifest.model_validate_json(manifest_path.read_text(encoding="utf-8"))
    paths = verified_inputs(manifest, REPOSITORY_ROOT)
    if manifest.policy.output_floor > min(manifest.policy.baseline, manifest.policy.candidate):
        raise ValueError("Saved output floor must cover both predeclared thresholds")
    artifact = json.loads((SERVICE_DIR / "model-manifest.json").read_text(encoding="utf-8"))[
        "fire"
    ]["artifact"]
    settings = detector_settings(manifest, artifact)
    detector = FireDetector(settings)
    output.mkdir(parents=True, exist_ok=False)
    reports = []
    with (output / "frames.jsonl").open("w", encoding="utf-8") as frames_log:
        for path in paths:
            result = evaluate_clip(
                path,
                output,
                detector,
                settings,
                manifest.policy.sample_fps,
                manifest.policy.jpeg_quality,
                frames_log,
            )
            reports.append(result)
            (output / "clips.json").write_text(
                json.dumps([asdict(item) for item in reports], indent=2), encoding="utf-8"
            )
            LOGGER.info(
                "Evaluated %s: fireEpisodes=%s", path.name, len(result.fire_episode_seconds)
            )
    if checksum(manifest_path) != manifest_sha:
        raise ValueError("Manifest changed during inference; refusing evaluation summary")
    if any(checksum(SERVICE_DIR / name) != digest for name, digest in implementation.items()):
        raise ValueError("Evaluation implementation changed during inference")
    baseline = {
        "dataset_id": manifest.dataset_id,
        "source": manifest.source,
        "manifest_sha256": manifest_sha,
        "implementation_sha256": implementation,
        "model": artifact,
        "settings": {
            "sample_fps": manifest.policy.sample_fps,
            "jpeg_quality": manifest.policy.jpeg_quality,
            "output_confidence_floor": manifest.policy.output_floor,
            "threshold": manifest.policy.baseline,
            "required_frames": settings.fire_min_consecutive_frames,
            "window_seconds": settings.fire_confirmation_window_seconds,
            "max_gap_seconds": settings.fire_max_frame_gap_seconds,
            "clear_seconds": settings.fire_clear_seconds,
            "cpu_threads": settings.fire_cpu_threads,
        },
        "fire_only": summary(reports, False),
        "production_fire_or_smoke": summary(reports, True),
        "limitations": manifest.limitations,
    }
    (output / "summary.json").write_text(json.dumps(baseline, indent=2), encoding="utf-8")
    comparison = {
        "manifest_sha256": manifest_sha,
        "input_sha256": {
            name: checksum(output / name) for name in ("summary.json", "clips.json", "frames.jsonl")
        },
        "deployment_settings_changed": False,
        "baseline": replay(output, manifest.policy.baseline),
        "candidate": replay(output, manifest.policy.candidate),
        "limitations": manifest.limitations,
    }
    (output / "comparison.json").write_text(json.dumps(comparison, indent=2), encoding="utf-8")
    LOGGER.info("Completed predefined comparison: %s", json.dumps(comparison["candidate"]))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()
    run(args.manifest, args.output_dir)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    main()
