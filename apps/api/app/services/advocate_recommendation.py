"""Chat -> advocate directory bridge.

Turns a classified question into a short list of verified advocates, ranked
only by data the directory really holds (no ratings or popularity exist):

1. practice-area match — the question's own category first, then closely
   related areas (e.g. a cyber-crime question also surfaces IT/data-protection
   advocates);
2. same state as the asking user, when their profile states one;
3. more years of experience, where recorded;
4. a stable tiebreak so results don't shuffle between requests.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy import case, literal, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.logging import get_logger
from app.models.user import AdvocateProfile, VerificationStatus

logger = get_logger("app.advocate_recommendation")

# Categories that have no practice area of their own, or whose matter is
# better served by a neighbouring one. Every key/value is a practice-area code
# (the directory stores the classifier's category codes).
_RELATED: dict[str, tuple[str, ...]] = {
    "CYBER_LAW": ("IT_LAW", "DATA_PROTECTION", "CRIMINAL_LAW"),
    "IT_LAW": ("CYBER_LAW", "DATA_PROTECTION", "CONTRACT_LAW"),
    "DATA_PROTECTION": ("IT_LAW", "CYBER_LAW"),
    "CONSUMER_LAW": ("CONTRACT_LAW",),
    "CONTRACT_LAW": ("CORPORATE_LAW", "ADVOCATE_REQUIRED"),
    "EMPLOYMENT_LAW": ("CONTRACT_LAW",),
    "CORPORATE_LAW": ("CONTRACT_LAW", "TAX_LAW"),
    "PROPERTY_LAW": ("CONTRACT_LAW", "FAMILY_LAW"),
    "FAMILY_LAW": ("PROPERTY_LAW",),
    "CRIMINAL_LAW": ("CYBER_LAW", "ADVOCATE_REQUIRED"),
    "TAX_LAW": ("CORPORATE_LAW",),
    "IP_LAW": ("CONTRACT_LAW", "IT_LAW"),
    "DOCUMENT_GUIDANCE": ("CONTRACT_LAW",),
    "ADVOCATE_REQUIRED": (),
}


@dataclass(frozen=True, slots=True)
class AdvocateRecommendation:
    profile: AdvocateProfile
    display_name: str | None
    matched_area: str
    exact_match: bool
    same_state: bool


def practice_areas_for(category: str) -> tuple[str, ...]:
    """The category itself followed by its related areas ('' list if unknown)."""
    if category == "OUT_OF_SCOPE" or category not in _RELATED:
        return ()
    return (category, *_RELATED[category])


async def recommend_advocates(
    db: AsyncSession,
    *,
    category: str,
    state_code: str | None = None,
    limit: int = 3,
) -> list[AdvocateRecommendation]:
    areas = practice_areas_for(category)
    if not areas:
        return []

    # Best (lowest) index of any wanted area an advocate practises: 0 = the
    # question's own category.
    area_rank = case(
        *[(AdvocateProfile.practice_areas.any(a), i) for i, a in enumerate(areas)],  # type: ignore[arg-type]
        else_=len(areas),
    )
    same_state = (
        case((AdvocateProfile.state_code == state_code, 0), else_=1) if state_code else literal(1)
    )
    stmt = (
        select(AdvocateProfile, area_rank.label("area_rank"))
        .options(selectinload(AdvocateProfile.user))
        .where(
            AdvocateProfile.verification_status == VerificationStatus.VERIFIED,
            area_rank < len(areas),
        )
        .order_by(
            area_rank,
            same_state,
            AdvocateProfile.experience_years.desc().nulls_last(),
            AdvocateProfile.created_at.desc(),
            AdvocateProfile.id,
        )
        .limit(limit)
    )
    rows = (await db.execute(stmt)).all()
    results = [
        AdvocateRecommendation(
            profile=profile,
            display_name=profile.user.display_name,
            matched_area=areas[min(int(rank), len(areas) - 1)],
            exact_match=int(rank) == 0,
            same_state=bool(state_code and profile.state_code == state_code),
        )
        for profile, rank in rows
    ]
    logger.info("advocates_recommended", category=category, state=state_code, count=len(results))
    return results


def areas_label(areas: Sequence[str]) -> str:
    return ", ".join(a.replace("_", " ").title() for a in areas)
