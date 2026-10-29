"""Candidate evaluation must preserve the checkpoint mode and checksum-bound model."""

import hashlib
from pathlib import Path

import pytest
from pydantic import ValidationError

from scripts import evaluate_fire_candidate
from scripts.evaluate_fire_candidate import (
    CandidateExport,
    CandidateHead,
    CandidateOnnx,
    candidate_settings,
)
from scripts.evaluate_fire_manifest import VideoManifest
from scripts.evaluate_fire_videos import SERVICE_DIR


def exported_candidate(path: Path) -> CandidateExport:
    data = b"candidate fixture"
    path.write_bytes(data)
    return CandidateExport(
        status="EXPORT_AND_LOCAL_IMAGE_PARITY_PASSED",
        checkpoint_sha256="1" * 64,
        checkpoint_unchanged=True,
        prediction_head=CandidateHead(
            preserves_checkpoint_mode=True, output_confidence_floor=0.1, export_end_to_end=False
        ),
        onnx=CandidateOnnx(
            path=str(path),
            sha256=hashlib.sha256(data).hexdigest(),
            size_bytes=len(data),
            mode="one-to-many-embedded-nms",
        ),
    )


def evaluation_manifest() -> VideoManifest:
    return VideoManifest.model_validate_json(
        (SERVICE_DIR / "evaluation/manifests/kmu-2012-followup-v1.json").read_text(encoding="utf-8")
    )


def test_changed_model_cannot_reuse_a_successful_parity_report(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(evaluate_fire_candidate, "REPOSITORY_ROOT", tmp_path)
    path = tmp_path / "candidate.onnx"
    exported = exported_candidate(path)
    assert candidate_settings(evaluation_manifest(), exported, "candidate").fire_model_path == str(
        path
    )
    path.write_bytes(b"different candidate")
    with pytest.raises(ValueError, match="model bytes differ"):
        candidate_settings(evaluation_manifest(), exported, "candidate")


def test_embedded_floor_cannot_omit_declared_predictions(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(evaluate_fire_candidate, "REPOSITORY_ROOT", tmp_path)
    exported = exported_candidate(tmp_path / "candidate.onnx")
    exported.prediction_head.output_confidence_floor = 0.6
    with pytest.raises(ValueError, match="graph floor"):
        candidate_settings(evaluation_manifest(), exported, "candidate")


def test_switched_head_is_not_a_checkpoint_preserving_candidate(tmp_path: Path) -> None:
    report = exported_candidate(tmp_path / "candidate.onnx").model_dump(by_alias=True)
    report["predictionHead"]["preservesCheckpointMode"] = False
    with pytest.raises(ValidationError):
        CandidateExport.model_validate(report)
