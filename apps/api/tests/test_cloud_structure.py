"""Проверка канонической структуры папок, согласованной с расширением 1С."""
from __future__ import annotations

from app.services.cloud_exchange import FOLDERS, archive_month


def test_canonical_folder_names_match_1c():
    assert set(FOLDERS) == {
        "1c_to_plan",
        "plan_to_1c",
        "processed",
        "processed/1c_to_plan",
        "processed/plan_to_1c",
        "archive",
        "_state",
    }
    assert archive_month().startswith("archive/")
    assert len(archive_month().rsplit("/", 1)[1]) == 7
