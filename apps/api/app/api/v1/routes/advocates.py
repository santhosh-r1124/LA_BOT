"""Advocate registration, self-service profile (Phase 1), and public
marketplace discovery (Phase 7).

Consultation booking is Phase 8 — search/profile here is read-only. Listings
include the advocate's email and phone so consumers can get in touch directly.
"""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.api.deps import DbSession, SettingsDep, require_roles
from app.core import security
from app.core.errors import ConflictError, NotFoundError, ValidationAppError
from app.core.india import ALL_STATE_NAMES, LANGUAGE_NAMES
from app.models.user import (
    AdvocateProfile,
    EmailVerificationToken,
    User,
    UserRole,
    VerificationStatus,
)
from app.schemas.advocate import (
    AdvocateDirectoryEntry,
    AdvocateFacets,
    AdvocateProfileOut,
    AdvocateProfileUpdateRequest,
    AdvocateRegisterRequest,
    FacetValue,
    PaginatedAdvocateDirectory,
)
from app.schemas.auth import TokenPair
from app.services.advocate_import import normalize_practice_area
from app.services.email import send_verification_email
from app.services.tokens import issue_token_pair

router = APIRouter()

# Only ADVOCATE-role accounts have (or may manage) an advocate profile.
AdvocateUser = Annotated[User, Depends(require_roles(UserRole.ADVOCATE))]
Limit = Annotated[int, Query(ge=1, le=100)]
Offset = Annotated[int, Query(ge=0)]

_STATE_CODE = re.compile(r"^[A-Z]{2}$")
_LANGUAGE_CODE = re.compile(r"^[a-z]{2,3}$")
_UPPER_WORDS = {"IT", "IP"}


def practice_area_label(code: str) -> str:
    """CYBER_LAW -> "Cyber Law" (the names used in advocate data files)."""
    return " ".join(w if w in _UPPER_WORDS else w.capitalize() for w in code.split("_"))


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _directory_entry(profile: AdvocateProfile) -> AdvocateDirectoryEntry:
    return AdvocateDirectoryEntry(
        id=profile.id,
        display_name=profile.user.display_name,
        practice_areas=profile.practice_areas,
        state_code=profile.state_code,
        city=profile.city,
        languages=profile.languages,
        consultation_fee=profile.consultation_fee,
        bio=profile.bio,
        experience_years=profile.experience_years,
        availability=profile.availability,
        is_sample=profile.is_sample,
        # Placeholder addresses (rows imported without an email) aren't contact details.
        email=None if profile.user.email.endswith(".invalid") else profile.user.email,
        phone=profile.phone,
    )


@router.post(
    "/register",
    response_model=TokenPair,
    status_code=status.HTTP_201_CREATED,
    summary="Register as an advocate",
)
async def register_advocate(
    payload: AdvocateRegisterRequest, db: DbSession, settings: SettingsDep
) -> TokenPair:
    email = payload.email.lower()
    existing = await db.scalar(select(User).where(User.email == email))
    if existing is not None:
        raise ConflictError("An account with this email already exists.", code="email_taken")

    user = User(
        email=email,
        hashed_password=security.hash_password(payload.password),
        role=UserRole.ADVOCATE,
        display_name=payload.display_name,
        state_code=payload.state_code,
    )
    db.add(user)
    await db.flush()  # populate user.id for the profile + verification token below

    db.add(
        AdvocateProfile(
            user_id=user.id,
            practice_areas=payload.practice_areas,
            state_code=payload.state_code,
            city=payload.city,
            languages=payload.languages,
            consultation_fee=payload.consultation_fee,
            bio=payload.bio,
            experience_years=payload.experience_years,
        )
    )

    raw_token, token_hash = security.generate_one_time_token()
    db.add(
        EmailVerificationToken(
            user_id=user.id,
            token_hash=token_hash,
            expires_at=datetime.now(UTC) + timedelta(hours=settings.email_verification_ttl_hours),
        )
    )
    await send_verification_email(to=user.email, token=raw_token, settings=settings)

    return await issue_token_pair(user=user, db=db, settings=settings)


@router.get("/me", response_model=AdvocateProfileOut, summary="Get your advocate profile")
async def read_my_profile(user: AdvocateUser, db: DbSession) -> AdvocateProfileOut:
    profile = await db.scalar(select(AdvocateProfile).where(AdvocateProfile.user_id == user.id))
    if profile is None:
        raise NotFoundError("Advocate profile not found.")
    return AdvocateProfileOut.model_validate(profile)


@router.patch("/me", response_model=AdvocateProfileOut, summary="Update your advocate profile")
async def update_my_profile(
    payload: AdvocateProfileUpdateRequest, user: AdvocateUser, db: DbSession
) -> AdvocateProfileOut:
    profile = await db.scalar(select(AdvocateProfile).where(AdvocateProfile.user_id == user.id))
    if profile is None:
        raise NotFoundError("Advocate profile not found.")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(profile, field, value)
    await db.commit()
    await db.refresh(profile)
    return AdvocateProfileOut.model_validate(profile)


@router.get("", response_model=PaginatedAdvocateDirectory, summary="Search verified advocates")
async def search_advocates(
    db: DbSession,
    practice_area: Annotated[
        str | None, Query(description='Name or code, e.g. "Cyber Law" or CYBER_LAW')
    ] = None,
    state_code: Annotated[str | None, Query(description="Exact code, e.g. TN")] = None,
    state: Annotated[str | None, Query(description="Alias of state_code")] = None,
    city: Annotated[str | None, Query(description="Case-insensitive substring")] = None,
    language: Annotated[str | None, Query(description="Exact code, e.g. ta")] = None,
    language_code: Annotated[str | None, Query(description="Alias of language")] = None,
    min_experience_years: Annotated[int | None, Query(ge=0)] = None,
    max_consultation_fee: Annotated[Decimal | None, Query(ge=0)] = None,
    limit: Limit = 25,
    offset: Offset = 0,
    page: Annotated[int | None, Query(ge=1, description="1-based; use with page_size")] = None,
    page_size: Annotated[int | None, Query(ge=1, le=100)] = None,
) -> PaginatedAdvocateDirectory:
    """Public directory — only ever returns VERIFIED advocates (roadmap
    Phase 7). State and language codes are matched exactly, as stored (TN,
    ta); a malformed code is a 422, a well-formed code nobody uses is an
    empty page. "Consultation type" and ratings/reviews filters from FRD §8
    aren't included: neither exists as real data yet (Phase 8 concepts).
    """
    state_code = state_code or state
    language = language or language_code
    if page_size is not None:
        limit = page_size
    if page is not None:
        offset = (page - 1) * limit

    problems: list[dict[str, str]] = []
    area_code: str | None = None
    if practice_area:
        area_code = normalize_practice_area(practice_area)
        if area_code is None:
            problems.append(
                {"field": "practice_area", "message": f"Unknown practice area {practice_area!r}."}
            )
    if state_code and not _STATE_CODE.match(state_code):
        problems.append(
            {
                "field": "state",
                "message": f"State codes are two upper-case letters (e.g. TN), got {state_code!r}.",
            }
        )
    if language and not _LANGUAGE_CODE.match(language):
        problems.append(
            {
                "field": "language_code",
                "message": f"Language codes are lower-case (e.g. ta), got {language!r}.",
            }
        )
    if problems:
        raise ValidationAppError("Some search filters are invalid.", details=problems)

    conditions = [AdvocateProfile.verification_status == VerificationStatus.VERIFIED]
    if area_code:
        # ARRAY.any(scalar) -> "scalar = ANY(array_column)"; mypy's stubs only
        # model the relationship-comparator overload of .any() (a boolean
        # criterion), not pgvector/ARRAY's scalar-value one — correct at
        # runtime, not statically typeable with the installed stubs.
        conditions.append(AdvocateProfile.practice_areas.any(area_code))  # type: ignore[arg-type]
    if state_code:
        conditions.append(AdvocateProfile.state_code == state_code)
    if city and city.strip():
        conditions.append(
            AdvocateProfile.city.ilike(f"%{_escape_like(city.strip())}%", escape="\\")
        )
    if language:
        conditions.append(AdvocateProfile.languages.any(language))  # type: ignore[arg-type]
    if min_experience_years is not None:
        conditions.append(AdvocateProfile.experience_years >= min_experience_years)
    if max_consultation_fee is not None:
        conditions.append(AdvocateProfile.consultation_fee <= max_consultation_fee)

    count_stmt = select(func.count()).select_from(AdvocateProfile).where(*conditions)
    total = (await db.execute(count_stmt)).scalar_one()

    stmt = (
        select(AdvocateProfile)
        .options(selectinload(AdvocateProfile.user))
        .where(*conditions)
        .order_by(
            AdvocateProfile.experience_years.desc().nulls_last(),
            AdvocateProfile.created_at.desc(),
            AdvocateProfile.id,
        )
        .limit(limit)
        .offset(offset)
    )
    rows = (await db.execute(stmt)).scalars().all()
    return PaginatedAdvocateDirectory(
        items=[_directory_entry(p) for p in rows],
        total=total,
        limit=limit,
        offset=offset,
        page=offset // limit + 1,
        page_size=limit,
    )


@router.get(
    "/facets", response_model=AdvocateFacets, summary="Filter values present in the directory"
)
async def advocate_facets(db: DbSession) -> AdvocateFacets:
    listed = AdvocateProfile.verification_status == VerificationStatus.VERIFIED
    total, sample_count = (
        await db.execute(
            select(func.count(), func.count().filter(AdvocateProfile.is_sample)).where(listed)
        )
    ).one()

    async def unnest_counts(column: Any) -> list[tuple[str, int]]:
        value = func.unnest(column).label("value")
        sub = select(value).where(listed).subquery()
        rows = await db.execute(
            select(sub.c.value, func.count()).group_by(sub.c.value).order_by(sub.c.value)
        )
        return [(str(v), int(n)) for v, n in rows.all()]

    async def column_counts(column: Any) -> list[tuple[str, int]]:
        rows = await db.execute(
            select(column, func.count()).where(listed).group_by(column).order_by(column)
        )
        return [(str(v), int(n)) for v, n in rows.all()]

    return AdvocateFacets(
        total=int(total),
        sample_count=int(sample_count),
        practice_areas=[
            FacetValue(code=c, label=practice_area_label(c), count=n)
            for c, n in await unnest_counts(AdvocateProfile.practice_areas)
        ],
        states=[
            FacetValue(code=c, label=ALL_STATE_NAMES.get(c, c), count=n)
            for c, n in await column_counts(AdvocateProfile.state_code)
        ],
        languages=[
            FacetValue(code=c, label=LANGUAGE_NAMES.get(c, c), count=n)
            for c, n in await unnest_counts(AdvocateProfile.languages)
        ],
        cities=[
            FacetValue(code=c, label=c, count=n)
            for c, n in await column_counts(AdvocateProfile.city)
        ],
    )


@router.get(
    "/{profile_id}", response_model=AdvocateDirectoryEntry, summary="Get a verified advocate"
)
async def get_advocate(profile_id: uuid.UUID, db: DbSession) -> AdvocateDirectoryEntry:
    profile = await db.scalar(
        select(AdvocateProfile)
        .options(selectinload(AdvocateProfile.user))
        .where(
            AdvocateProfile.id == profile_id,
            AdvocateProfile.verification_status == VerificationStatus.VERIFIED,
        )
    )
    if profile is None:
        # Same 404 whether the id doesn't exist or exists but isn't verified —
        # an unverified advocate's profile isn't public, not even its existence.
        raise NotFoundError("Advocate not found.")
    return _directory_entry(profile)
