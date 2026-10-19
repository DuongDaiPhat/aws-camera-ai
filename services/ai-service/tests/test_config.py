"""Test cau hinh doc tu bien moi truong.

Bai hoc: bo test dau tien chi dung gia tri MAC DINH cua Settings, nen khong
phat hien duoc `LOG_LEVEL=debug` trong .env.example lam service chet luc khoi
dong. Cac test o day nap cau hinh tu bien moi truong THAT.
"""

import logging

import pytest

from app.config import Settings, get_settings


@pytest.mark.parametrize("gia_tri", ["debug", "DEBUG", "Debug", " info ", "warning"])
def test_log_level_viet_thuong_van_dung_duoc(gia_tri: str) -> None:
    """`logging` chi nhan ten muc viet hoa, nhung .env thuong viet thuong."""
    settings = Settings(log_level=gia_tri)

    assert settings.log_level == gia_tri.strip().upper()
    # Khong duoc nem ValueError: Unknown level
    logging.getLogger("kiem_tra").setLevel(settings.log_level)


def test_log_level_sai_bi_tu_choi_ngay() -> None:
    """Sai cau hinh phai bao loi ro rang, khong chay voi gia tri vo nghia."""
    with pytest.raises(ValueError, match="LOG_LEVEL khong hop le"):
        Settings(log_level="verbose")


def test_doc_duoc_cau_hinh_tu_bien_moi_truong(monkeypatch: pytest.MonkeyPatch) -> None:
    """Toan bo nguong phai cau hinh duoc qua env (US-15, US-17)."""
    monkeypatch.setenv("LOG_LEVEL", "debug")
    monkeypatch.setenv("FACE_PROVIDER", "rekognition")
    monkeypatch.setenv("FACE_MATCH_THRESHOLD", "0.75")
    monkeypatch.setenv("FALL_IMMOBILITY_SECONDS", "20")
    monkeypatch.setenv("FIRE_MIN_CONSECUTIVE_FRAMES", "5")
    get_settings.cache_clear()

    settings = get_settings()

    assert settings.log_level == "DEBUG"
    assert settings.face_provider == "rekognition"
    assert settings.face_match_threshold == 0.75
    assert settings.fall_immobility_seconds == 20
    assert settings.fire_min_consecutive_frames == 5

    get_settings.cache_clear()


def test_gia_tri_mac_dinh_khop_voi_tai_lieu() -> None:
    """FR-ADM-04: moi tham so phai co gia tri mac dinh hop ly."""
    get_settings.cache_clear()
    settings = Settings()

    assert settings.face_provider == "local"
    assert settings.face_match_threshold == 0.60  # US-10: nguong T_known
    assert settings.fall_immobility_seconds == 3  # US-17
    assert settings.fire_min_consecutive_frames == 3  # US-18
    assert settings.pose_min_visibility == 0.60


@pytest.mark.parametrize(
    "override",
    [
        {"pose_min_visibility": 1.01},
        {"pose_min_association_iou": 0},
        {"fall_motion_speed_threshold": float("nan")},
        {"pose_max_tracks": 0},
        {"fall_immobility_seconds": 60},
        {"fall_recovery_angle_deg": 20},
        {"fall_max_valid_frame_gap_seconds": 5},
        {"pose_track_ttl_seconds": 4},
    ],
)
def test_invalid_pose_configuration_rejected(override: dict) -> None:
    with pytest.raises(ValueError):
        Settings(_env_file=None, **override)
