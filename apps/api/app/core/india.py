"""Indian states/UTs and languages: display names and lenient parsing of
user- or file-supplied values (codes, names, common legacy codes)."""

from __future__ import annotations

# Mirrors packages/shared/src/legal.ts (INDIAN_STATES / INDIAN_STATE_NAMES).
STATE_NAMES: dict[str, str] = {
    "AN": "Andaman and Nicobar Islands",
    "AP": "Andhra Pradesh",
    "AR": "Arunachal Pradesh",
    "AS": "Assam",
    "BR": "Bihar",
    "CH": "Chandigarh",
    "CT": "Chhattisgarh",
    "DN": "Dadra and Nagar Haveli and Daman and Diu",
    "DL": "Delhi",
    "GA": "Goa",
    "GJ": "Gujarat",
    "HR": "Haryana",
    "HP": "Himachal Pradesh",
    "JK": "Jammu and Kashmir",
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
    "OR": "Odisha",
    "PY": "Puducherry",
    "PB": "Punjab",
    "RJ": "Rajasthan",
    "SK": "Sikkim",
    "TN": "Tamil Nadu",
    "TG": "Telangana",
    "TR": "Tripura",
    "UP": "Uttar Pradesh",
    "UT": "Uttarakhand",
    "WB": "West Bengal",
}
# Vehicle-registration and older ISO codes seen in real-world data.
_STATE_CODE_ALIASES = {
    "CG": "CT",
    "GO": "GA",
    "OD": "OR",
    "TS": "TG",
    "UK": "UT",
    "UA": "UT",
    "DD": "DN",
}
_STATE_NAME_ALIASES = {
    "orissa": "OR",
    "pondicherry": "PY",
    "uttaranchal": "UT",
    "new delhi": "DL",
    "nct of delhi": "DL",
    "j&k": "JK",
    "jammu & kashmir": "JK",
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


def normalize_state(value: str) -> str | None:
    raw = value.strip()
    code = raw.upper()
    if code in STATE_NAMES:
        return code
    if code in _STATE_CODE_ALIASES:
        return _STATE_CODE_ALIASES[code]
    name = " ".join(raw.lower().replace("&", " & ").split())
    if name in _STATE_NAME_ALIASES:
        return _STATE_NAME_ALIASES[name]
    name = name.replace(" & ", " and ")
    for state_code, state_name in STATE_NAMES.items():
        if state_name.lower() == name:
            return state_code
    return None


def normalize_language(value: str) -> str | None:
    key = value.strip().lower()
    if key in LANGUAGE_NAMES:
        return key
    if key in _LANGUAGE_ALIASES:
        return _LANGUAGE_ALIASES[key]
    for code, name in LANGUAGE_NAMES.items():
        if name.lower() == key:
            return code
    return None
