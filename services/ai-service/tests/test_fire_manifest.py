"""Prevent changed, duplicated or mislabelled bytes from producing plausible metrics."""

import hashlib
from pathlib import Path

import pytest

from scripts.evaluate_fire_manifest import VideoInput, VideoManifest, VideoPolicy, verified_inputs


def video_manifest(repository: Path) -> VideoManifest:
    clips = []
    for group, data in (("pos", b"positive"), ("neg", b"negative")):
        path = repository / "dataset" / group / f"{group}.avi"
        path.parent.mkdir(parents=True)
        path.write_bytes(data)
        clips.append(
            VideoInput(
                path=f"{group}/{group}.avi",
                sha256=hashlib.sha256(data).hexdigest(),
                expected_fire=group == "pos",
                source_entry=path.name,
                scene_group=group,
            )
        )
    return VideoManifest(
        dataset_id="test",
        dataset_root="dataset",
        source="fixture",
        license="fixture",
        policy=VideoPolicy(
            baseline=0.5,
            candidate=0.65,
            sample_fps=5,
            jpeg_quality=85,
            required_frames=3,
            window_seconds=5,
            max_gap_seconds=1,
            clear_seconds=10,
            output_floor=0.1,
            cpu_threads=2,
        ),
        clips=clips,
        provenance={},
        limitations=[],
    )


def test_checksum_bound_inputs_refuse_changed_bytes(tmp_path: Path) -> None:
    manifest = video_manifest(tmp_path)
    assert len(verified_inputs(manifest, tmp_path)) == 2
    (tmp_path / "dataset/pos/pos.avi").write_bytes(b"replacement")
    with pytest.raises(ValueError, match="checksum mismatch"):
        verified_inputs(manifest, tmp_path)


def test_duplicate_video_cannot_inflate_sample_count(tmp_path: Path) -> None:
    manifest = video_manifest(tmp_path)
    manifest.clips.append(manifest.clips[0].model_copy())
    with pytest.raises(ValueError, match="Duplicate video"):
        verified_inputs(manifest, tmp_path)


def test_labels_and_paths_cannot_silently_change_the_denominator(tmp_path: Path) -> None:
    manifest = video_manifest(tmp_path)
    manifest.clips[0].expected_fire = False
    with pytest.raises(ValueError, match="label disagrees"):
        verified_inputs(manifest, tmp_path)
    manifest.clips[0].path = "../outside.avi"
    with pytest.raises(ValueError, match="escapes dataset"):
        verified_inputs(manifest, tmp_path)
