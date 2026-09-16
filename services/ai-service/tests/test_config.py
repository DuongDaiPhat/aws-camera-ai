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
    assert settings.fall_immobility_seconds == 15  # US-17
    assert settings.fire_min_consecutive_frames == 3  # US-18
