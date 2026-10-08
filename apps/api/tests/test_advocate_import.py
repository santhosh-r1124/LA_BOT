"""CSV advocate import: parsing/normalisation (pure) and the upsert + admin
upload endpoint (needs Postgres — see conftest.db_client)."""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.core import security
from app.models.user import AdvocateProfile, User, UserRole, VerificationStatus
from app.services import advocate_import
from app.services.advocate_import import (
    CsvFormatError,
    normalize_language,
    normalize_practice_area,
    normalize_state,
    parse_csv,
)
from tests.test_admin import _admin_headers

HEADER = "advocate_id,name,email,phone,practice_area,state,city,language_code\n"


def _csv(*rows: str) -> str:
    return HEADER + "\n".join(rows) + "\n"


def _uid() -> str:
    return f"T{uuid.uuid4().hex[:10].upper()}"


# ---------------------------------------------------------------------------
# Normalisation
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "code"),
    [
        ("TN", "TN"),
        ("tn", "TN"),
        ("CG", "CT"),  # vehicle-registration code for Chhattisgarh
        ("GO", "GA"),
        ("OD", "OR"),
        ("TS", "TG"),
        ("UK", "UT"),
        ("Tamil Nadu", "TN"),
        ("jammu & kashmir", "JK"),
        ("Orissa", "OR"),
        ("Narnia", None),
    ],
)
def test_normalize_state(raw: str, code: str | None) -> None:
    assert normalize_state(raw) == code


@pytest.mark.parametrize(
    ("raw", "code"),
    [
        ("Consumer Law", "CONSUMER_LAW"),
        ("IT Law", "IT_LAW"),
        ("Data Protection", "DATA_PROTECTION"),
        ("Advocate Required", "ADVOCATE_REQUIRED"),
        ("Intellectual Property", "IP_LAW"),
        ("criminal", "CRIMINAL_LAW"),
        ("OUT_OF_SCOPE", None),
        ("Astrology", None),
    ],
)
def test_normalize_practice_area(raw: str, code: str | None) -> None:
    assert normalize_practice_area(raw) == code


@pytest.mark.parametrize(
    ("raw", "code"), [("ta", "ta"), ("TA", "ta"), ("Tamil", "ta"), ("Oriya", "or"), ("xx", None)]
)
def test_normalize_language(raw: str, code: str | None) -> None:
    assert normalize_language(raw) == code


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------


def test_parse_maps_the_supplied_file_format() -> None:
    rows, errors = parse_csv(
        _csv(
            "ADV1,Mohan Menon,Mohan.Menon@Example.com,92645 93090,Data Protection,RJ,Jaipur,ta",
            'ADV2,Deepa K,deepa@example.com,,"Tax Law; IP Law",CG,Raipur,"hi, en"',
        )
    )
    assert errors == []
    first, second = rows
    assert first.email == "mohan.menon@example.com"
    assert first.phone == "9264593090"
    assert first.practice_areas == ["DATA_PROTECTION"]
    assert (first.state_code, first.city, first.languages) == ("RJ", "Jaipur", ["ta"])
    assert second.practice_areas == ["TAX_LAW", "IP_LAW"]
    assert second.state_code == "CT"
    assert second.languages == ["hi", "en"]
    assert second.phone is None


def test_parse_accepts_header_aliases_semicolons_and_bom() -> None:
    text = "﻿Full Name;Email ID;Mobile;Specialization;State;City;Languages;Experience\n"
    text += "Asha Rao;asha@example.com;+91 98765 43210;Family Law;Karnataka;Mysuru;Kannada;12\n"
    rows, errors = parse_csv(text)
    assert errors == []
    (row,) = rows
    assert row.external_id is None
    assert row.phone == "+919876543210"
    assert row.state_code == "KA"
    assert row.languages == ["kn"]
    assert row.experience_years == 12


def test_parse_reports_bad_rows_without_dropping_good_ones() -> None:
    rows, errors = parse_csv(
        _csv(
            "ADV1,Good Row,good@example.com,1,Tax Law,KA,Mysuru,kn",
            "ADV2,,nobody@example.com,1,Tax Law,KA,Mysuru,kn",
            "ADV3,Bad State,bad@example.com,1,Tax Law,ZZ,Mysuru,kn",
            "ADV4,Bad Area,area@example.com,1,Astrology,KA,Mysuru,kn",
            "ADV1,Dup Id,dup@example.com,1,Tax Law,KA,Mysuru,kn",
            "ADV6,Dup Email,good@example.com,1,Tax Law,KA,Mysuru,kn",
        )
    )
    assert [r.external_id for r in rows] == ["ADV1"]
    messages = {e.line: e.message for e in errors}
    assert "name is empty" in messages[3]
    assert "unknown state 'ZZ'" in messages[4]
    assert "unknown practice area 'Astrology'" in messages[5]
    assert "duplicate advocate id" in messages[6]
    assert "duplicate email" in messages[7]


def test_parse_rejects_files_missing_required_columns() -> None:
    with pytest.raises(CsvFormatError, match="state"):
        parse_csv("name,email,city\nA,a@example.com,X\n")
    with pytest.raises(CsvFormatError, match="empty"):
        parse_csv("   ")


def test_rows_without_email_get_a_placeholder_address() -> None:
    rows, _ = parse_csv("advocate_id,name,state,city\nADV9,No Mail,DL,Delhi\n")
    assert rows[0].email == "adv9@advocates.invalid"


# ---------------------------------------------------------------------------
# Upsert (Postgres)
# ---------------------------------------------------------------------------


async def test_import_creates_verified_advocates_then_updates_in_place(
    db_txn_session: object,
) -> None:
    db = db_txn_session
    ext = _uid()
    email = f"{ext.lower()}@example.com"

    first = await advocate_import.import_csv_text(
        db,  # type: ignore[arg-type]
        _csv(f"{ext},Mohan Menon,{email},9264593090,Data Protection,RJ,Jaipur,ta"),
    )
    assert (first.created, first.updated, first.unchanged, first.failed) == (1, 0, 0, 0)

    profile = await db.scalar(  # type: ignore[attr-defined]
        select(AdvocateProfile).where(AdvocateProfile.external_id == ext)
    )
    assert profile.verification_status == VerificationStatus.VERIFIED
    user = await db.get(User, profile.user_id)  # type: ignore[attr-defined]
    assert user.role == UserRole.ADVOCATE
    assert not security.verify_password("anything", user.hashed_password)  # can't sign in

    again = await advocate_import.import_csv_text(
        db,  # type: ignore[arg-type]
        _csv(f"{ext},Mohan Menon,{email},9264593090,Data Protection,RJ,Jaipur,ta"),
    )
    assert (again.created, again.updated, again.unchanged) == (0, 0, 1)

    moved = await advocate_import.import_csv_text(
        db,  # type: ignore[arg-type]
        _csv(f"{ext},Mohan Menon,{email},9264593090,Tax Law,KL,Kochi,ml"),
    )
    assert (moved.created, moved.updated) == (0, 1)
    await db.refresh(profile)  # type: ignore[attr-defined]
    assert (profile.state_code, profile.city, profile.practice_areas) == (
        "KL",
        "Kochi",
        ["TAX_LAW"],
    )


async def test_import_never_takes_over_a_non_advocate_account(db_txn_session: object) -> None:
    db = db_txn_session
    email = f"consumer-{uuid.uuid4().hex[:8]}@example.com"
    db.add(User(email=email, hashed_password="x", role=UserRole.CONSUMER))  # type: ignore[attr-defined]
    await db.flush()  # type: ignore[attr-defined]

    report = await advocate_import.import_csv_text(
        db,  # type: ignore[arg-type]
        _csv(f"{_uid()},Some One,{email},1,Tax Law,KA,Mysuru,kn"),
    )
    assert report.created == 0
    assert "non-advocate account" in report.errors[0].message


# ---------------------------------------------------------------------------
# Admin upload + public directory
# ---------------------------------------------------------------------------


async def test_admin_upload_imports_and_directory_shows_contact(
    db_client: AsyncClient, db_txn_session: object
) -> None:
    headers = await _admin_headers(db_txn_session)
    ext = _uid()
    email = f"{ext.lower()}@example.com"
    body = _csv(
        f"{ext},Kavya Patel,{email},9583657431,Consumer Law,MP,Indore,te",
        "BAD1,Broken Row,broken@example.com,1,Consumer Law,ZZ,Indore,te",
    )

    dry = await db_client.post(
        "/api/v1/admin/advocates/import",
        params={"dry_run": "true"},
        headers=headers,
        files={"file": ("advocates.csv", body.encode(), "text/csv")},
    )
    assert dry.status_code == 200, dry.text
    assert dry.json()["dry_run"] is True
    assert dry.json()["created"] == 1

    resp = await db_client.post(
        "/api/v1/admin/advocates/import",
        headers=headers,
        files={"file": ("advocates.csv", body.encode(), "text/csv")},
    )
    assert resp.status_code == 200, resp.text
    report = resp.json()
    assert (report["created"], report["failed"]) == (1, 1)
    assert report["errors"][0]["line"] == 3

    search = await db_client.get(
        "/api/v1/advocates", params={"state_code": "MP", "city": "Indore", "language": "te"}
    )
    match = [a for a in search.json()["items"] if a["display_name"] == "Kavya Patel"]
    assert match and match[0]["phone"] == "9583657431" and match[0]["email"] == email


async def test_admin_upload_rejects_unreadable_files(
    db_client: AsyncClient, db_txn_session: object
) -> None:
    headers = await _admin_headers(db_txn_session)
    resp = await db_client.post(
        "/api/v1/admin/advocates/import",
        headers=headers,
        files={"file": ("x.csv", b"name,email\nA,a@example.com\n", "text/csv")},
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "bad_csv"


async def test_non_admins_cannot_upload(db_client: AsyncClient) -> None:
    resp = await db_client.post(
        "/api/v1/admin/advocates/import",
        files={"file": ("x.csv", _csv().encode(), "text/csv")},
    )
    assert resp.status_code == 401
