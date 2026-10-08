"""End-to-end API checks against a running LA_BOT.

    python apps/api/scripts/smoke_check.py [BASE_URL] [RESULTS_JSON]

BASE_URL defaults to http://localhost:3000. Every advocate count is compared
with a count computed independently from apps/api/data/advocates.csv, so the
directory must hold only that file's rows (other imported advocates change the
totals). Chat checks work with an AI provider and without one (offline mode,
answers built from the retrieved passages). Each call is recorded as
METHOD / URL / REQUEST / STATUS / RESPONSE in RESULTS_JSON
(default e2e-results.json). Exit code 1 if any check fails.
"""

import csv
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000").rstrip("/")
OUT = sys.argv[2] if len(sys.argv) > 2 else "e2e-results.json"
CSV = Path(__file__).resolve().parents[1] / "data" / "advocates.csv"
with open(CSV, encoding="utf-8-sig") as _fh:
    rows = list(csv.DictReader(_fh))
log: list[dict] = []
failures: list[str] = []


def call(method: str, path: str, body: dict | None = None) -> tuple[int, object]:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        BASE + path, data=data, method=method, headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            status, raw = r.status, r.read()
    except urllib.error.HTTPError as e:
        status, raw = e.code, e.read()
    try:
        payload = json.loads(raw)
    except ValueError:
        payload = raw.decode()[:300]
    return status, payload


def expect_count(**f: str) -> int:
    def ok(r: dict) -> bool:
        return (
            (not f.get("practice_area") or r["practice_area"] == f["practice_area"])
            and (not f.get("state") or r["state"] == f["state"])
            and (not f.get("language_code") or r["language_code"] == f["language_code"])
            and (not f.get("city") or f["city"].lower() in r["city"].lower())
        )

    return sum(ok(r) for r in rows)


def record(name: str, method: str, path: str, body, status, payload, passed: bool, note=""):
    summary = payload
    if isinstance(payload, dict) and "items" in payload:
        summary = {
            "total": payload["total"],
            "page": payload["page"],
            "page_size": payload["page_size"],
            "first": [
                {
                    k: i[k]
                    for k in (
                        "display_name",
                        "practice_areas",
                        "state_code",
                        "city",
                        "languages",
                        "is_sample",
                    )
                }
                for i in payload["items"][:2]
            ],
        }
    log.append(
        {
            "test": name,
            "method": method,
            "url": BASE + path,
            "request": body,
            "status": status,
            "response": summary,
            "passed": passed,
            "note": note,
        }
    )
    if not passed:
        failures.append(name)


def search(name: str, **f: str) -> None:
    path = "/api/v1/advocates?" + urllib.parse.urlencode({**f, "page": 1, "page_size": 20})
    status, payload = call("GET", path)
    want = expect_count(**f)
    items = payload.get("items", []) if isinstance(payload, dict) else []
    passed = (
        status == 200
        and payload["total"] == want
        and all(
            (not f.get("state") or i["state_code"] == f["state"])
            and (not f.get("language_code") or f["language_code"] in i["languages"])
            and (
                not f.get("practice_area")
                or f["practice_area"].upper().replace(" ", "_") in i["practice_areas"]
            )
            and i["is_sample"] is True
            for i in items
        )
    )
    record(name, "GET", path, None, status, payload, passed, f"expected total from CSV: {want}")


search("1 Cyber Law + TN", practice_area="Cyber Law", state="TN")
search("2 Family Law + TN + ta", practice_area="Family Law", state="TN", language_code="ta")
search("3 KA + kn", state="KA", language_code="kn")
search("4 City Chennai", city="Chennai")
search("5 Language hi", language_code="hi")
search("6 Clear (no filters)")
search("Practice area by code CYBER_LAW", practice_area="Cyber Law")
search("Document Guidance", practice_area="Document Guidance")
search("Advocate Required", practice_area="Advocate Required")
search("Legacy code CT kept as written", state="CT")
search("Convention code CG", state="CG")

# 8: no match
path = "/api/v1/advocates?" + urllib.parse.urlencode({"city": "Atlantis", "state": "TN"})
status, payload = call("GET", path)
record(
    "8 No match",
    "GET",
    path,
    None,
    status,
    payload,
    status == 200 and payload["total"] == 0 and payload["items"] == [],
)

# 9: invalid filters -> 422 with the field named
for label, query, field in (
    ("9a lower-case state tn", {"state": "tn"}, "state"),
    ("9b upper-case language TA", {"language_code": "TA"}, "language_code"),
    ("9c unknown practice area", {"practice_area": "Space Law"}, "practice_area"),
    ("9d unknown state ZZ", {"state": "ZZ"}, "state"),
):
    path = "/api/v1/advocates?" + urllib.parse.urlencode(query)
    status, payload = call("GET", path)
    details = payload.get("error", {}).get("details") or [] if isinstance(payload, dict) else []
    record(
        label,
        "GET",
        path,
        None,
        status,
        payload,
        status == 422 and any(d.get("field") == field for d in details),
    )

# Pagination
status, p2 = call("GET", "/api/v1/advocates?page=2&page_size=20")
status1, p1 = call("GET", "/api/v1/advocates?page=1&page_size=20")
ids1 = {i["id"] for i in p1["items"]}
ids2 = {i["id"] for i in p2["items"]}
record(
    "Pagination page 2",
    "GET",
    "/api/v1/advocates?page=2&page_size=20",
    None,
    status,
    p2,
    status == 200 and p2["page"] == 2 and len(ids2) == 20 and not ids1 & ids2,
)

# Facets
status, facets = call("GET", "/api/v1/advocates/facets")
record(
    "Facets",
    "GET",
    "/api/v1/advocates/facets",
    None,
    status,
    {k: facets[k] for k in ("total", "sample_count")}
    | {
        "states": [s["code"] for s in facets["states"]][:12],
        "languages": [s["code"] for s in facets["languages"]],
        "practice_areas": [s["label"] for s in facets["practice_areas"]],
    },
    status == 200
    and facets["total"] == 1000
    and facets["sample_count"] == 1000
    and len(facets["practice_areas"]) == 14,
)

# 7: RAG question (knowledge base state decides the expected shape)
status, st = call("GET", "/api/v1/status")
kb = st["knowledge_base"]
record(
    "Status",
    "GET",
    "/api/v1/status",
    None,
    status,
    {
        "knowledge_base": kb,
        "advocate_directory": st["advocate_directory"],
        "llm": {k: st["llm"][k] for k in ("configured", "mode", "provider", "model")},
    },
    status == 200,
)
NOTICE = "I couldn't find sufficiently relevant material in the legal library"
# Offline mode (no AI provider configured) replies from the passages alone.
OFFLINE_NOTICE = "Nothing in the legal library matched your question"
for q in (
    "What are the essential elements of a valid contract in India?",
    "What remedies are available for breach of contract?",
    "What are the main cyber offences under Indian law?",
    "What does Indian data protection law require from businesses?",
    "What is the difference between civil and criminal liability?",
):
    body = {"message": q}
    status, payload = call("POST", "/api/v1/chat/messages", body)
    msg = payload.get("assistant_message", {}) if isinstance(payload, dict) else {}
    sources = msg.get("sources") or []
    content = msg.get("content", "")
    offline = isinstance(payload, dict) and payload.get("answer_mode") == "sources_only"
    if sources:
        passed = status == 200 and not content.startswith((NOTICE, OFFLINE_NOTICE))
        note = "grounded: sources returned"
    elif offline:
        passed = status == 200 and content.startswith(OFFLINE_NOTICE)
        note = "offline, no passage matched: the reply must say so"
    else:
        passed = status == 200 and content.startswith(NOTICE)
        note = "no relevant source retrieved: reply must start with the notice"
    record(
        f"7 RAG: {q}",
        "POST",
        "/api/v1/chat/messages",
        body,
        status,
        {
            "content": content[:260],
            "sources": sources,
            "disclaimer": (payload.get("disclaimer") or "")[:120]
            if isinstance(payload, dict)
            else None,
        },
        passed,
        note,
    )

# Path traversal / injection probes
for label, path in (
    (
        "SQL injection in city",
        "/api/v1/advocates?" + urllib.parse.urlencode({"city": "' OR 1=1 --"}),
    ),
    ("LIKE wildcard in city", "/api/v1/advocates?city=%25"),
    ("Path traversal id", "/api/v1/advocates/..%2F..%2Fetc%2Fpasswd"),
):
    status, payload = call("GET", path)
    ok = (status == 200 and payload["total"] == 0) if "city" in path else status in (404, 422)
    record(f"Security: {label}", "GET", path, None, status, payload, ok)

with open(OUT, "w", encoding="utf-8") as fh:
    json.dump(log, fh, indent=2, ensure_ascii=False)
for e in log:
    print(f"{'PASS' if e['passed'] else 'FAIL'}  {e['status']}  {e['test']}  {e['note']}")
print(f"\n{len(log) - len(failures)}/{len(log)} passed; details in {OUT}")
sys.exit(1 if failures else 0)
