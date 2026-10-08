"""Indian states/UTs and languages: codes, display names, and parsing of
user- or file-supplied values.

State codes follow the convention used by the advocate data (TN, TS, OD,
CG, UK, GO, ...). The ISO 3166-2:IN variants that differ (CT, GA, OR, TG,
UT) are accepted too. Whatever valid code a file uses is stored exactly as
written: codes are case-sensitive and never rewritten into another code.
"""

from __future__ import annotations

# Mirrors packages/shared/src/legal.ts (INDIAN_STATES / INDIAN_STATE_NAMES).
STATE_NAMES: dict[str, str] = {
    "AN": "Andaman and Nicobar Islands",
    "AP": "Andhra Pradesh",
    "AR": "Arunachal Pradesh",
    "AS": "Assam",
    "BR": "Bihar",
    "CH": "Chandigarh",
    "CG": "Chhattisgarh",
    "DN": "Dadra and Nagar Haveli and Daman and Diu",
    "DL": "Delhi",
    "GO": "Goa",
    "GJ": "Gujarat",
    "HR": "Haryana",
    "HP": "Himachal Pradesh",
    "JK": "Jammu & Kashmir",
    "JH": "Jharkhand",
    "KA": "Karnataka",
    "KL": "Kerala",
    "LA": "Ladakh",
    "LD": "Lakshadweep",
    "MP": "Madhya Pradesh",
    "MH": "Maharashtra",
    "MN": "Manipur",
    "ML": "Meghalaya",
    "MZ": "Mizoram",
    "NL": "Nagaland",
    "OD": "Odisha",
    "PY": "Puducherry",
    "PB": "Punjab",
    "RJ": "Rajasthan",
    "SK": "Sikkim",
    "TN": "Tamil Nadu",
    "TS": "Telangana",
    "TR": "Tripura",
    "UP": "Uttar Pradesh",
    "UK": "Uttarakhand",
    "WB": "West Bengal",
}
# ISO 3166-2:IN codes that differ from the convention above. Valid and kept
# as written (a file using CT keeps CT), they just aren't the default.
LEGACY_STATE_NAMES: dict[str, str] = {
    "CT": "Chhattisgarh",
    "GA": "Goa",
    "OR": "Odisha",
    "TG": "Telangana",
    "UT": "Uttarakhand",
}
ALL_STATE_NAMES: dict[str, str] = {**STATE_NAMES, **LEGACY_STATE_NAMES}

_STATE_NAME_ALIASES = {
    "orissa": "OD",
    "pondicherry": "PY",
    "uttaranchal": "UK",
    "new delhi": "DL",
    "nct of delhi": "DL",
    "j&k": "JK",
    "jammu and kashmir": "JK",
}

# Mirrors packages/shared/src/legal.ts (LANGUAGE_NAMES).
LANGUAGE_NAMES: dict[str, str] = {
    "en": "English",
    "hi": "Hindi",
    "bn": "Bengali",
    "te": "Telugu",
    "mr": "Marathi",
    "ta": "Tamil",
    "ur": "Urdu",
    "gu": "Gujarati",
    "kn": "Kannada",
    "ml": "Malayalam",
    "or": "Odia",
    "pa": "Punjabi",
    "as": "Assamese",
    "ks": "Kashmiri",
    "kok": "Konkani",
    "mai": "Maithili",
    "ne": "Nepali",
    "sa": "Sanskrit",
    "sd": "Sindhi",
}
_LANGUAGE_ALIASES = {"oriya": "or", "bangla": "bn", "panjabi": "pa"}


def _state_from_name(value: str) -> str | None:
    name = " ".join(value.lower().replace("&", " & ").split())
    if name in _STATE_NAME_ALIASES:
        return _STATE_NAME_ALIASES[name]
    name = name.replace(" & ", " and ")
    for code, state_name in STATE_NAMES.items():
        if state_name.lower().replace(" & ", " and ") == name:
            return code
    return None


def parse_state_code(value: str) -> str:
    """Strict parsing for stored data (CSV import). Returns the code exactly
    as written when it is a valid upper-case code, or the code for a full
    state name. Raises ``ValueError`` with a user-facing reason otherwise."""
    raw = value.strip()
    if raw in ALL_STATE_NAMES:
        return raw
    if raw.upper() in ALL_STATE_NAMES and len(raw) == 2:
        raise ValueError(f"state code {raw!r} must be upper-case ({raw.upper()!r})")
    if code := _state_from_name(raw):
        return code
    raise ValueError(f"unknown state {raw!r}")


def normalize_state(value: str) -> str | None:
    """Lenient parsing for free-text answers ("tn", "Tamil Nadu"): the
    upper-cased code if valid, the code for a state name, else ``None``."""
    raw = value.strip()
    if raw.upper() in ALL_STATE_NAMES:
        return raw.upper()
    return _state_from_name(raw) if raw else None


def parse_language_code(value: str) -> str:
    """Strict parsing for stored data: the code exactly as written when it is
    a valid lower-case code, or the code for a language name."""
    raw = value.strip()
    if raw in LANGUAGE_NAMES:
        return raw
    if raw.lower() in LANGUAGE_NAMES:
        raise ValueError(f"language code {raw!r} must be lower-case ({raw.lower()!r})")
    key = raw.lower()
    if key in _LANGUAGE_ALIASES:
        return _LANGUAGE_ALIASES[key]
    for code, name in LANGUAGE_NAMES.items():
        if name.lower() == key:
            return code
    raise ValueError(f"unknown language {raw!r}")
