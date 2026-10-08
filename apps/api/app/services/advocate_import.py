"""Bulk-load verified advocates into the public directory from a CSV file.

Columns are matched by header name (case/spacing-insensitive, common aliases
accepted). Required: a name, a state and a city, plus an email or an id.
Optional: phone, practice area(s), language(s), experience, fee, bio. Cells
holding several values separate them with ``;``, ``|``, ``/`` or ``,``.

State and language codes are stored exactly as written in the file (TN
stays TN, ta stays ta; see app/core/india.py); full names ("Tamil Nadu",
"Tamil") are converted to codes. Practice-area names map one-to-one onto the
platform's category codes ("Cyber Law" -> CYBER_LAW).

Rows are upserted, never deleted: a row matches an existing advocate by its
id column (stored as ``AdvocateProfile.external_id``), else by email. New
advocates are listed as VERIFIED; an existing advocate's verification status
is left alone so an admin's rejection survives a re-import. ``is_sample``
marks synthetic demo records so the directory never presents them as real
advocates.

Imported accounts get an unusable password, so they can't sign in until the
advocate sets one through "forgot password".
"""

from __future__ import annotations

import asyncio
import csv
import io
import re
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.india import parse_language_code, parse_state_code
from app.core.logging import get_logger
from app.models.user import AdvocateProfile, User, UserRole, VerificationStatus
from app.services.legal_classifier import LEGAL_CATEGORIES

logger = get_logger("app.advocate_import")

# Not a bcrypt hash, so security.verify_password() always returns False.
UNUSABLE_PASSWORD_HASH = "!imported:no-password-set"
# Placeholder domain (RFC 2606) for rows that have an id but no email.
_NO_EMAIL_DOMAIN = "advocates.invalid"

_PRACTICE_AREAS = tuple(c for c in LEGAL_CATEGORIES if c != "OUT_OF_SCOPE")
_PRACTICE_AREA_ALIASES = {
    "INTELLECTUAL_PROPERTY": "IP_LAW",
    "INFORMATION_TECHNOLOGY": "IT_LAW",
    "LABOUR_LAW": "EMPLOYMENT_LAW",
    "LABOR_LAW": "EMPLOYMENT_LAW",
    "COMPANY_LAW": "CORPORATE_LAW",
    "REAL_ESTATE": "PROPERTY_LAW",
    "DOCUMENTATION": "DOCUMENT_GUIDANCE",
    "LITIGATION": "ADVOCATE_REQUIRED",
}

# Normalised header -> field. First match wins per field.
_HEADER_ALIASES: dict[str, tuple[str, ...]] = {
    "external_id": ("advocate_id", "external_id", "id", "advocate_code", "code"),
    "name": ("name", "display_name", "full_name", "advocate_name"),
    "email": ("email", "email_id", "email_address", "mail"),
    "phone": ("phone", "phone_number", "mobile", "mobile_number", "contact", "contact_number"),
    "practice_areas": (
        "practice_area",
        "practice_areas",
        "specialization",
        "specialisation",
        "specializations",
        "area",
    ),
    "state": ("state", "state_code", "state_ut"),
    "city": ("city", "town", "location"),
    "languages": ("language_code", "language_codes", "languages", "language"),
    "experience_years": ("experience_years", "experience", "years_of_experience", "years"),
    "consultation_fee": ("consultation_fee", "fee", "fees"),
    "bio": ("bio", "about", "description"),
}

_MULTI_SPLIT = re.compile(r"[;|/,]")
_MAX_ERRORS_REPORTED = 200


@dataclass(frozen=True, slots=True)
class AdvocateRow:
    line: int
    external_id: str | None
    name: str
    email: str
    phone: str | None
    practice_areas: list[str]
    state_code: str
    city: str
    languages: list[str]
    experience_years: int | None
    consultation_fee: Decimal | None
    bio: str | None


@dataclass(frozen=True, slots=True)
class RowError:
    line: int
    message: str


@dataclass(slots=True)
class ImportReport:
    total_rows: int = 0
    created: int = 0
    updated: int = 0
    unchanged: int = 0
    errors: list[RowError] = field(default_factory=list)

    @property
    def failed(self) -> int:
        return len(self.errors)


class CsvFormatError(ValueError):
    """The file as a whole can't be read (not CSV, or required columns missing)."""


# ---------------------------------------------------------------------------
# Value normalisation
# ---------------------------------------------------------------------------


def _norm_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.strip().lower()).strip("_")


def normalize_practice_area(value: str) -> str | None:
    key = _norm_key(value).upper()
    if not key:
        return None
    if key in _PRACTICE_AREAS:
        return key
    if key in _PRACTICE_AREA_ALIASES:
        return _PRACTICE_AREA_ALIASES[key]
    if f"{key}_LAW" in _PRACTICE_AREAS:
        return f"{key}_LAW"
    return None


def _split_multi(value: str) -> list[str]:
    return [part.strip() for part in _MULTI_SPLIT.split(value) if part.strip()]


def _clean_phone(value: str) -> str | None:
    cleaned = re.sub(r"[^\d+]", "", value)
    return cleaned[:32] or None


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------


def _column_map(headers: list[str]) -> dict[str, str]:
    by_norm = {_norm_key(h): h for h in headers if h}
    mapping: dict[str, str] = {}
    for field_name, aliases in _HEADER_ALIASES.items():
        for alias in aliases:
            if alias in by_norm:
                mapping[field_name] = by_norm[alias]
                break
    missing = [f for f in ("name", "state", "city") if f not in mapping]
    if "email" not in mapping and "external_id" not in mapping:
        missing.append("email or advocate_id")
    if missing:
        raise CsvFormatError(f"Missing required column(s): {', '.join(missing)}.")
    return mapping


def _parse_row(line: int, record: dict[str, Any], cols: dict[str, str]) -> AdvocateRow:
    def cell(name: str) -> str:
        column = cols.get(name)
        value = record.get(column) if column else None
        return str(value).strip() if value is not None else ""

    problems: list[str] = []
    name = cell("name")
    if not name:
        problems.append("name is empty")

    external_id = cell("external_id") or None
    email = cell("email").lower()
    if email and "@" not in email:
        problems.append(f"email {email!r} is not an email address")
    if not email:
        if external_id is None:
            problems.append("needs an email or an advocate id")
        else:
            email = f"{_norm_key(external_id)}@{_NO_EMAIL_DOMAIN}"

    state_code: str | None = None
    if state_raw := cell("state"):
        try:
            state_code = parse_state_code(state_raw)
        except ValueError as exc:
            problems.append(str(exc))
    else:
        problems.append("state is empty")

    city = cell("city")
    if not city:
        problems.append("city is empty")

    practice_areas: list[str] = []
    for part in _split_multi(cell("practice_areas")):
        area = normalize_practice_area(part)
        if area is None:
            problems.append(f"unknown practice area {part!r}")
        elif area not in practice_areas:
            practice_areas.append(area)

    languages: list[str] = []
    for part in _split_multi(cell("languages")):
        try:
            lang = parse_language_code(part)
        except ValueError as exc:
            problems.append(str(exc))
            continue
        if lang not in languages:
            languages.append(lang)

    experience_years: int | None = None
    if raw := cell("experience_years"):
        try:
            experience_years = int(float(raw))
            if not 0 <= experience_years <= 70:
                raise ValueError
        except ValueError:
            problems.append(f"experience {raw!r} is not a number of years (0-70)")
            experience_years = None

    fee: Decimal | None = None
    if raw := cell("consultation_fee").replace(",", "").replace("₹", ""):
        try:
            fee = Decimal(raw)
            if fee < 0:
                raise InvalidOperation
        except InvalidOperation:
            problems.append(f"fee {raw!r} is not an amount")
            fee = None

    if problems:
        raise ValueError("; ".join(problems))
    assert state_code is not None
    return AdvocateRow(
        line=line,
        external_id=external_id,
        name=name[:150],
        email=email[:320],
        phone=_clean_phone(cell("phone")),
        practice_areas=practice_areas,
        state_code=state_code,
        city=city[:100],
        languages=languages,
        experience_years=experience_years,
        consultation_fee=fee,
        bio=cell("bio")[:2000] or None,
    )


def parse_csv(text: str) -> tuple[list[AdvocateRow], list[RowError]]:
    """Parse and validate every row. Raises :class:`CsvFormatError` only when
    the file itself is unusable; bad rows come back as :class:`RowError`."""
    text = text.lstrip("﻿")
    if not text.strip():
        raise CsvFormatError("The file is empty.")
    header = text.splitlines()[0]
    delimiter = max(",;\t|", key=header.count)
    reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
    cols = _column_map(list(reader.fieldnames or []))

    rows: list[AdvocateRow] = []
    errors: list[RowError] = []
    seen_ids: set[str] = set()
    seen_emails: set[str] = set()
    for record in reader:
        line = reader.line_num
        if not any((v or "").strip() for v in record.values() if isinstance(v, str)):
            continue  # blank line
        try:
            row = _parse_row(line, record, cols)
        except ValueError as exc:
            errors.append(RowError(line, str(exc)))
            continue
        if row.external_id and row.external_id in seen_ids:
            errors.append(RowError(line, f"duplicate advocate id {row.external_id!r} in file"))
            continue
        if row.email in seen_emails:
            errors.append(RowError(line, f"duplicate email {row.email!r} in file"))
            continue
        if row.external_id:
            seen_ids.add(row.external_id)
        seen_emails.add(row.email)
        rows.append(row)
    return rows, errors


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------


def _apply(obj: object, values: dict[str, Any]) -> bool:
    changed = False
    for name, value in values.items():
        if getattr(obj, name) != value:
            setattr(obj, name, value)
            changed = True
    return changed


async def import_rows(
    db: AsyncSession, rows: list[AdvocateRow], report: ImportReport, *, is_sample: bool = False
) -> None:
    """Upsert parsed rows into ``report``'s counters. The caller commits."""
    ids = [r.external_id for r in rows if r.external_id]
    by_external_id: dict[str, AdvocateProfile] = {}
    if ids:
        profiles = await db.scalars(
            select(AdvocateProfile)
            .options(selectinload(AdvocateProfile.user))
            .where(AdvocateProfile.external_id.in_(ids))
        )
        by_external_id = {p.external_id: p for p in profiles if p.external_id}
    users = await db.scalars(
        select(User)
        .options(selectinload(User.advocate_profile))
        .where(User.email.in_([r.email for r in rows]))
    )
    by_email = {u.email: u for u in users}

    for row in rows:
        profile = by_external_id.get(row.external_id) if row.external_id else None
        user = profile.user if profile is not None else by_email.get(row.email)
        if user is not None and user.role != UserRole.ADVOCATE:
            report.errors.append(
                RowError(row.line, f"{row.email} already belongs to a non-advocate account")
            )
            continue
        if profile is None and user is not None:
            profile = user.advocate_profile
        if user is not None and user.email != row.email:
            owner = by_email.get(row.email)
            if owner is not None and owner.id != user.id:
                report.errors.append(
                    RowError(row.line, f"{row.email} already belongs to another advocate")
                )
                continue

        profile_values: dict[str, Any] = {
            "practice_areas": row.practice_areas,
            "state_code": row.state_code,
            "city": row.city,
            "languages": row.languages,
            "phone": row.phone,
            "external_id": row.external_id,
            "is_sample": is_sample,
        }
        # Optional columns only overwrite when the file actually has a value.
        for name in ("experience_years", "consultation_fee", "bio"):
            if getattr(row, name) is not None:
                profile_values[name] = getattr(row, name)

        if user is None:
            user = User(
                email=row.email,
                hashed_password=UNUSABLE_PASSWORD_HASH,
                role=UserRole.ADVOCATE,
                display_name=row.name,
                state_code=row.state_code,
                email_verified=True,
            )
            db.add(user)
            profile = AdvocateProfile(
                user=user,
                verification_status=VerificationStatus.VERIFIED,
                verification_note="Imported from CSV.",
                **profile_values,
            )
            db.add(profile)
            by_email[row.email] = user
            report.created += 1
            continue

        user_changed = _apply(
            user, {"email": row.email, "display_name": row.name, "state_code": row.state_code}
        )
        if profile is None:
            profile = AdvocateProfile(
                user_id=user.id, verification_status=VerificationStatus.VERIFIED, **profile_values
            )
            db.add(profile)
            profile_changed = True
        else:
            profile_changed = _apply(profile, profile_values)
        if user_changed or profile_changed:
            report.updated += 1
        else:
            report.unchanged += 1
    await db.flush()


async def import_csv_text(db: AsyncSession, text: str, *, is_sample: bool = False) -> ImportReport:
    rows, errors = parse_csv(text)
    report = ImportReport(total_rows=len(rows) + len(errors), errors=errors)
    if rows:
        await import_rows(db, rows, report, is_sample=is_sample)
    report.errors.sort(key=lambda e: e.line)
    return report


def summarize(report: ImportReport) -> str:
    text = (
        f"{report.total_rows} rows: {report.created} added, {report.updated} updated, "
        f"{report.unchanged} unchanged, {report.failed} skipped"
    )
    for error in report.errors[:_MAX_ERRORS_REPORTED]:
        text += f"\n  line {error.line}: {error.message}"
    return text


async def import_csv_file(path: Path, *, is_sample: bool = False) -> ImportReport:
    """Import a file in its own session and commit (startup seeding, CLI)."""
    from app.db.session import get_sessionmaker

    text = await asyncio.to_thread(path.read_text, encoding="utf-8-sig")
    async with get_sessionmaker()() as db:
        report = await import_csv_text(db, text, is_sample=is_sample)
        await db.commit()
    return report
