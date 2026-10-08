"""Integration tests for /api/v1/documents/*. Needs Postgres — see
conftest.db_client. Draft generation is monkeypatched
(app.services.document_assistant.generation.generate_draft) so these test
persistence, RBAC/ownership and validation without needing a real
ANTHROPIC_API_KEY or network access. The offline tests deliberately do NOT
patch it: with no provider configured (the suite's default) the endpoint must
return a template draft for every document type, end to end.
"""

from __future__ import annotations

import re

import pytest
from httpx import AsyncClient

from app.core.errors import ServiceUnavailableError
from app.models.document_request import AssistantDocumentType
from app.services.document_assistant import generation as generation_module
from app.services.document_assistant.questions import questions_for
from tests.conftest import unique_email

TEMPLATE_LABEL = (
    "TEMPLATE DRAFT - generated without AI from your answers. Review with an advocate before use."
)

# A realistic answer for every question id in questions.py.
SAMPLE_ANSWERS: dict[str, str] = {
    "landlord_name": "Ramesh Kumar",
    "tenant_name": "Priya Nair",
    "property_address": "Flat 4B, Lotus Residency, Indiranagar, Bengaluru",
    "state_code": "Karnataka",
    "monthly_rent": "25000",
    "security_deposit": "75000",
    "lease_start_date": "1 November 2026",
    "lease_duration_months": "11",
    "special_terms": "No pets\nTenant pays society maintenance",
    "employer_name": "Acme Technologies Pvt Ltd",
    "employee_name": "Asha Verma",
    "designation": "Software Engineer",
    "monthly_salary": "90000",
    "employment_start_date": "3 January 2027",
    "probation_period_months": "6",
    "key_terms": "Notice period of two months\nConfidentiality",
    "disclosing_party": "Acme Technologies Pvt Ltd",
    "receiving_party": "Beta Consulting LLP",
    "purpose": "Evaluating a possible partnership",
    "effective_date": "1 December 2026",
    "term_months": "24",
    "mutual_or_one_way": "Mutual",
    "full_name": "Jane Doe",
    "address": "123 Main Street, Pune",
    "facts_to_declare": "I changed my name from Jane Smith to Jane Doe.\nI have no pending cases.",
    "supporting_documents": "Marriage certificate",
    "declarant_name": "Jane Doe",
    "facts_declared": "I am a resident of Pune.",
    "party_a_name": "Acme Traders",
    "party_b_name": "Beta Supplies",
    "business_purpose": "Joint distribution of packaged foods",
    "firm_name": "Sharma and Sons",
    "partner_names": "Anil Sharma, Vijay Sharma",
    "capital_contribution": "Rs. 5 lakh each",
    "profit_sharing_ratio": "50:50",
    "authorizer_name": "Meena Rao",
    "authorized_person_name": "Karthik Rao",
    "validity_period": "Three months",
    "service_provider_name": "Brightline Design Studio",
    "client_name": "Zenith Retail Pvt Ltd",
    "service_description": "Website design and maintenance",
    "fee_amount": "Rs. 1,20,000 payable in two instalments",
    "duration": "12 months",
    "sender_name": "Anil Sharma",
    "recipient_name": "Zenith Builders Pvt Ltd",
    "subject_matter": "Non-delivery of a flat",
    "facts_and_grievance": "I booked flat 12 in 2022.\nPossession was due in 2023 and not given.",
    "relief_sought": "Deliver possession or refund the money with interest",
    "document_description": "Letter of undertaking to vacate a shop",
    "key_facts": "The tenant will vacate by 31 December 2026",
}

VALID_AFFIDAVIT_ANSWERS = {
    "purpose": "Name change",
    "full_name": "Jane Doe",
    "address": "123 Main St, Pune",
    "state_code": "mh",
    "facts_to_declare": "I have changed my name from X to Y.",
}


def _patch_generation(
    monkeypatch: pytest.MonkeyPatch, *, draft: str = "DRAFT AFFIDAVIT\n\n..."
) -> None:
    async def fake_generate(
        document_type: AssistantDocumentType, *, answers: dict[str, str], settings: object
    ) -> str:
        return draft

    monkeypatch.setattr(generation_module, "generate_draft", fake_generate)


async def _register(db_client: AsyncClient) -> dict[str, object]:
    resp = await db_client.post(
        "/api/v1/auth/register",
        json={"email": unique_email(), "password": "correct horse battery staple"},
    )
    assert resp.status_code == 201
    return resp.json()


async def test_list_document_types_is_public(client: AsyncClient) -> None:
    resp = await client.get("/api/v1/documents/types")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == len(AssistantDocumentType)
    affidavit = next(t for t in body if t["document_type"] == "AFFIDAVIT")
    keys = {q["key"] for q in affidavit["questions"]}
    assert "full_name" in keys
    assert "state_code" in keys


def _answers_for(document_type: AssistantDocumentType, *, required_only: bool) -> dict[str, str]:
    return {
        q.key: SAMPLE_ANSWERS[q.key]
        for q in questions_for(document_type)
        if q.required or not required_only
    }


def test_sample_answers_cover_every_question() -> None:
    keys = {q.key for t in AssistantDocumentType for q in questions_for(t)}
    assert keys <= set(SAMPLE_ANSWERS), keys - set(SAMPLE_ANSWERS)


async def test_create_without_api_key_returns_a_template_draft(db_client: AsyncClient) -> None:
    # Deliberately unpatched — conftest never configures a provider (offline mode).
    resp = await db_client.post(
        "/api/v1/documents",
        json={"document_type": "AFFIDAVIT", "answers": VALID_AFFIDAVIT_ANSWERS},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["generation_mode"] == "template"
    assert body["disclaimer"]
    document = body["document"]
    assert document["document_type"] == "AFFIDAVIT"
    assert document["state_code"] == "MH"
    draft = document["draft_text"]
    assert draft.splitlines()[0] == TEMPLATE_LABEL
    assert "Jane Doe" in draft and "Name change" in draft
    assert "## Notes" in draft

    # Stored and readable like an AI draft.
    fetched = await db_client.get(f"/api/v1/documents/{document['id']}")
    assert fetched.status_code == 200
    assert fetched.json()["draft_text"] == draft


@pytest.mark.parametrize("required_only", [False, True])
@pytest.mark.parametrize("document_type", list(AssistantDocumentType))
async def test_every_document_type_gets_a_template_draft(
    db_client: AsyncClient, document_type: AssistantDocumentType, required_only: bool
) -> None:
    answers = _answers_for(document_type, required_only=required_only)
    resp = await db_client.post(
        "/api/v1/documents", json={"document_type": document_type.value, "answers": answers}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["generation_mode"] == "template"
    document = body["document"]
    assert document["document_type"] == document_type.value
    assert document["state_code"] == "KA"
    assert document["answers"] == answers

    draft = document["draft_text"]
    lines = draft.splitlines()
    assert lines[0] == TEMPLATE_LABEL
    assert lines[2].startswith("# ")  # the document title
    assert "## Notes" in draft
    # The state the user named drives the stamp duty / registration wording.
    notes = draft.split("## Notes")[1]
    for word in ("Karnataka", "stamp duty", "notarisation", "registration"):
        assert word.lower() in notes.lower(), word
    # The user's own words are used, not invented ones.
    first_required = next(q.key for q in questions_for(document_type) if q.required)
    assert answers[first_required].splitlines()[0] in draft
    # Optional items left unanswered become bracketed placeholders, never guesses.
    if required_only and document_type is not AssistantDocumentType.OTHER:
        assert re.search(r"\[[A-Z][A-Z /,'()\-]+\]", draft)
    # No statute section numbers, case citations or stamp-duty figures.
    assert not re.search(r"\b(?:section|sec\.|article)\s+\d", draft, re.IGNORECASE)
    assert not re.search(r"\bv\.?\s+[A-Z]", draft)
    assert not re.search(r"stamp duty[^.\n]{0,40}(?:Rs\.?|INR|\u20b9|%|per cent)", draft, re.I)


async def test_template_draft_for_unrecognised_state_is_still_created(
    db_client: AsyncClient,
) -> None:
    answers = {**VALID_AFFIDAVIT_ANSWERS, "state_code": "somewhere in India"}
    resp = await db_client.post(
        "/api/v1/documents", json={"document_type": "AFFIDAVIT", "answers": answers}
    )
    assert resp.status_code == 200
    document = resp.json()["document"]
    assert document["state_code"] is None
    assert "not recognised" in document["draft_text"]


async def test_a_configured_provider_that_fails_is_still_an_error(
    db_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def failing(*_args: object, **_kwargs: object) -> str:
        raise ServiceUnavailableError("limit reached", code="llm_rate_limited")

    monkeypatch.setattr(generation_module, "generate_draft", failing)
    tokens = await _register(db_client)
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}
    resp = await db_client.post(
        "/api/v1/documents",
        json={"document_type": "AFFIDAVIT", "answers": VALID_AFFIDAVIT_ANSWERS},
        headers=headers,
    )
    # No silent template substitution when a provider is configured but failing.
    assert resp.status_code == 503
    assert resp.json()["error"]["code"] == "llm_rate_limited"
    listing = await db_client.get("/api/v1/documents", headers=headers)
    assert listing.json() == []


async def test_create_rejects_missing_required_answers(
    db_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_generation(monkeypatch)
    resp = await db_client.post(
        "/api/v1/documents", json={"document_type": "AFFIDAVIT", "answers": {}}
    )
    assert resp.status_code == 422
    fields = {d["field"] for d in resp.json()["error"]["details"]}
    assert "answers.full_name" in fields
    assert "answers.purpose" in fields


async def test_anonymous_user_can_create_a_draft(
    db_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_generation(monkeypatch)
    resp = await db_client.post(
        "/api/v1/documents",
        json={"document_type": "AFFIDAVIT", "answers": VALID_AFFIDAVIT_ANSWERS},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["generation_mode"] == "ai"
    assert body["document"]["document_type"] == "AFFIDAVIT"
    assert body["document"]["draft_text"] == "DRAFT AFFIDAVIT\n\n..."
    assert body["document"]["state_code"] == "MH"  # normalized to uppercase
    assert body["disclaimer"]


async def test_get_document_request_readable_without_auth_when_anonymous(
    db_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_generation(monkeypatch)
    created = await db_client.post(
        "/api/v1/documents",
        json={"document_type": "AFFIDAVIT", "answers": VALID_AFFIDAVIT_ANSWERS},
    )
    document_id = created.json()["document"]["id"]

    resp = await db_client.get(f"/api/v1/documents/{document_id}")
    assert resp.status_code == 200
    assert resp.json()["id"] == document_id


async def test_get_unknown_document_request_is_404(db_client: AsyncClient) -> None:
    resp = await db_client.get("/api/v1/documents/00000000-0000-0000-0000-000000000000")
    assert resp.status_code == 404


async def test_logged_in_user_document_request_is_listed_and_owned(
    db_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_generation(monkeypatch)
    tokens = await _register(db_client)
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}

    created = await db_client.post(
        "/api/v1/documents",
        json={"document_type": "AFFIDAVIT", "answers": VALID_AFFIDAVIT_ANSWERS},
        headers=headers,
    )
    document_id = created.json()["document"]["id"]

    listing = await db_client.get("/api/v1/documents", headers=headers)
    assert listing.status_code == 200
    ids = [d["id"] for d in listing.json()]
    assert document_id in ids


async def test_anonymous_cannot_list_document_requests(db_client: AsyncClient) -> None:
    resp = await db_client.get("/api/v1/documents")
    assert resp.status_code == 401


async def test_other_users_cannot_read_an_owned_document_request(
    db_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_generation(monkeypatch)
    owner_tokens = await _register(db_client)
    owner_headers = {"Authorization": f"Bearer {owner_tokens['access_token']}"}
    created = await db_client.post(
        "/api/v1/documents",
        json={"document_type": "AFFIDAVIT", "answers": VALID_AFFIDAVIT_ANSWERS},
        headers=owner_headers,
    )
    document_id = created.json()["document"]["id"]

    other_tokens = await _register(db_client)
    other_headers = {"Authorization": f"Bearer {other_tokens['access_token']}"}

    resp = await db_client.get(f"/api/v1/documents/{document_id}", headers=other_headers)
    assert resp.status_code == 403


@pytest.mark.parametrize(
    ("answer", "stored"),
    [
        ("Tamil Nadu", "TN"),
        ("tn", "TN"),
        ("Orissa", "OD"),
        ("Telangana", "TS"),
        ("somewhere in India", None),
    ],
)
async def test_free_text_state_answers_never_fail_the_request(
    db_client: AsyncClient, monkeypatch: pytest.MonkeyPatch, answer: str, stored: str | None
) -> None:
    _patch_generation(monkeypatch)
    resp = await db_client.post(
        "/api/v1/documents",
        json={
            "document_type": "AFFIDAVIT",
            "answers": {**VALID_AFFIDAVIT_ANSWERS, "state_code": answer},
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["document"]["state_code"] == stored
