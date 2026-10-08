"""Unit tests for the offline template drafts
(app.services.document_assistant.templates). No database, no network."""

from __future__ import annotations

import re

import pytest

from app.models.document_request import AssistantDocumentType
from app.services.document_assistant import templates
from app.services.document_assistant.questions import questions_for

LABEL = (
    "TEMPLATE DRAFT - generated without AI from your answers. Review with an advocate before use."
)
PLACEHOLDER = re.compile(r"\[[A-Z][A-Z0-9 /,.'()\-:]*\]")


def _draft(
    document_type: AssistantDocumentType, answers: dict[str, str] | None = None
) -> templates.TemplateDraft:
    return templates.build_template_draft(document_type, answers or {})


@pytest.mark.parametrize("document_type", list(AssistantDocumentType))
def test_every_document_type_builds_from_empty_answers(
    document_type: AssistantDocumentType,
) -> None:
    draft = _draft(document_type)
    assert draft.text.splitlines()[0] == LABEL
    assert draft.title and draft.body and draft.notes.startswith("## Notes")
    # Nothing was answered, so everything the user must supply is a placeholder.
    assert len(PLACEHOLDER.findall(draft.text)) >= 5
    # The state is unknown: the Notes say so rather than guessing one.
    assert "did not name a state" in draft.notes


@pytest.mark.parametrize("document_type", list(AssistantDocumentType))
def test_drafts_are_deterministic(document_type: AssistantDocumentType) -> None:
    answers = {q.key: f"Answer for {q.key}" for q in questions_for(document_type)}
    assert _draft(document_type, answers).text == _draft(document_type, answers).text


@pytest.mark.parametrize("document_type", list(AssistantDocumentType))
def test_drafts_contain_no_invented_law_or_figures(document_type: AssistantDocumentType) -> None:
    answers = {q.key: f"Answer for {q.key}" for q in questions_for(document_type)}
    answers["state_code"] = "Maharashtra"
    text = _draft(document_type, answers).text
    assert not re.search(r"\b(?:section|sec\.|article|clause no\.?)\s+\d", text, re.IGNORECASE)
    assert not re.search(r"\b\d+\s*(?:%|per cent|percent)", text)
    assert not re.search(r"stamp duty[^.\n]{0,40}(?:Rs\.?|INR|₹|%)", text, re.IGNORECASE)
    # Only one statute is named at all, and only in the partnership notes.
    named = re.findall(r"[A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+)* Act, \d{4}", text)
    expected = ["Indian Partnership Act, 1932"] if "PARTNERSHIP" in document_type.value else []
    assert named == expected


def test_state_is_recognised_from_a_name_or_a_code() -> None:
    for answer in ("Tamil Nadu", "tn", "TN"):
        draft = _draft(AssistantDocumentType.NDA, {"state_code": answer})
        assert "You named Tamil Nadu." in draft.notes
        assert "courts at [CITY], Tamil Nadu" in draft.body


def test_an_unrecognised_state_is_quoted_back_and_never_guessed() -> None:
    draft = _draft(AssistantDocumentType.NDA, {"state_code": "Bangalore"})
    assert 'You named "Bangalore", which was not recognised' in draft.notes
    assert "courts at [CITY], [STATE]" in draft.body


def test_rental_agreement_uses_the_answers() -> None:
    draft = _draft(
        AssistantDocumentType.RENTAL_AGREEMENT,
        {
            "landlord_name": "Ramesh Kumar",
            "tenant_name": "Priya Nair",
            "property_address": "Flat 4B, Indiranagar, Bengaluru",
            "state_code": "KA",
            "monthly_rent": "25000",
            "security_deposit": "2500000",
            "lease_start_date": "1 November 2026",
            "lease_duration_months": "11",
            "special_terms": "No pets\nTenant pays society maintenance",
        },
    )
    body = draft.body
    assert body.startswith("# RENTAL AGREEMENT")
    assert "Ramesh Kumar" in body and "Priya Nair" in body
    assert "Flat 4B, Indiranagar, Bengaluru" in body
    assert "a term of 11 months starting on 1 November 2026" in body
    assert "rent of Rs. 25,000 for each month" in body
    assert "security deposit of Rs. 25,00,000" in body  # Indian digit grouping
    assert "8.1 No pets" in body and "8.2 Tenant pays society maintenance" in body
    assert "SPECIAL TERMS" in body and "law of Karnataka" in body


def test_amounts_are_kept_as_the_user_wrote_them() -> None:
    draft = _draft(
        AssistantDocumentType.RENTAL_AGREEMENT,
        {"monthly_rent": "Rs. 2 lakh", "security_deposit": "₹5,000", "state_code": "DL"},
    )
    assert "rent of Rs. 2 lakh for each month" in draft.body
    assert "security deposit of ₹5,000" in draft.body
    assert "Rs. Rs." not in draft.body


def test_single_month_term_is_singular() -> None:
    draft = _draft(AssistantDocumentType.RENTAL_AGREEMENT, {"lease_duration_months": "1"})
    assert "a term of 1 month starting" in draft.body


def test_unanswered_optional_items_are_bracketed_placeholders() -> None:
    rental = _draft(AssistantDocumentType.RENTAL_AGREEMENT, {"landlord_name": "A"})
    assert "[NO SPECIAL TERMS AGREED / ADD ANY ADDITIONAL TERMS HERE]" in rental.body
    employment = _draft(AssistantDocumentType.EMPLOYMENT_AGREEMENT, {})
    assert "[PROBATION PERIOD, IF ANY - DELETE THIS CLAUSE IF THERE IS NONE]" in employment.body
    with_probation = _draft(
        AssistantDocumentType.EMPLOYMENT_AGREEMENT, {"probation_period_months": "3"}
    )
    assert "on probation for 3 months" in with_probation.body
    letter = _draft(AssistantDocumentType.AUTHORIZATION_LETTER, {})
    assert "valid for [VALIDITY PERIOD OR LAST DATE]" in letter.body


def test_nda_direction_follows_the_answer() -> None:
    base = {"disclosing_party": "Acme", "receiving_party": "Beta", "purpose": "Talks"}
    mutual = _draft(AssistantDocumentType.NDA, {**base, "mutual_or_one_way": "Mutual"})
    assert mutual.body.startswith("# MUTUAL NON-DISCLOSURE AGREEMENT")
    assert '"Party A"' in mutual.body and "Signed by Acme (Party A)" in mutual.body

    one_way = _draft(AssistantDocumentType.NDA, {**base, "mutual_or_one_way": "one-way"})
    assert one_way.body.startswith("# NON-DISCLOSURE AGREEMENT")
    assert '(the "Disclosing Party")' in one_way.body
    assert "CONFIRM WHETHER THIS IS A ONE-WAY OR A MUTUAL" not in one_way.body

    unclear = _draft(AssistantDocumentType.NDA, base)
    assert unclear.body.startswith("# NON-DISCLOSURE AGREEMENT")
    assert "CONFIRM WHETHER THIS IS A ONE-WAY OR A MUTUAL" in unclear.body
    both = _draft(AssistantDocumentType.NDA, {**base, "mutual_or_one_way": "mutual or one-way?"})
    assert "CONFIRM WHETHER THIS IS A ONE-WAY OR A MUTUAL" in both.body


def test_affidavit_numbers_every_statement_and_verifies_them_all() -> None:
    draft = _draft(
        AssistantDocumentType.AFFIDAVIT,
        {
            "purpose": "Name change",
            "full_name": "Jane Doe",
            "address": "Pune",
            "facts_to_declare": "I changed my name.\n\nI have no pending cases.",
            "supporting_documents": "Marriage certificate; Aadhaar card",
        },
    )
    numbered = [line for line in draft.body.splitlines() if re.match(r"\d+\. ", line)]
    assert [line.split(".")[0] for line in numbered] == ["1", "2", "3", "4", "5", "6"]
    assert "2. I changed my name." in numbered
    assert "3. I have no pending cases." in numbered
    assert "annexing the following documents" in numbered[4]
    assert "paragraphs 1 to 6" in draft.body
    assert "NOTARY / OATH COMMISSIONER / MAGISTRATE" in draft.body


def test_partnership_names_are_split_and_a_lone_partner_is_flagged() -> None:
    several = _draft(
        AssistantDocumentType.PARTNERSHIP_DOCUMENT,
        {"partner_names": "Anil Sharma, Vijay Sharma and Meena Sharma", "firm_name": "Sharma & Co"},
    )
    assert "1. Anil Sharma, of [ADDRESS]" in several.body
    assert "3. Meena Sharma, of [ADDRESS]" in several.body
    assert "Signed by Meena Sharma (Partner)" in several.body
    assert "AT LEAST TWO PARTNERS" not in several.body

    lines = _draft(
        AssistantDocumentType.PARTNERSHIP_DOCUMENT, {"partner_names": "Anil Sharma\nVijay Sharma"}
    )
    assert "2. Vijay Sharma, of [ADDRESS]" in lines.body

    alone = _draft(AssistantDocumentType.PARTNERSHIP_DOCUMENT, {"partner_names": "Anil Sharma"})
    assert "AT LEAST TWO PARTNERS" in alone.body


def test_legal_notice_contains_a_demand_with_a_blank_deadline_not_an_invented_one() -> None:
    draft = _draft(
        AssistantDocumentType.LEGAL_NOTICE,
        {
            "sender_name": "Anil Sharma",
            "recipient_name": "Zenith Builders",
            "subject_matter": "Non-delivery of a flat",
            "facts_and_grievance": "I paid in 2022.",
            "relief_sought": "Refund the money",
        },
    )
    body = draft.body
    assert "Subject: Legal notice regarding non-delivery of a flat" in body
    assert "within [NUMBER] days of receiving this notice: Refund the money." in body
    assert "without prejudice to all my other rights" in body
    assert "registered post" in draft.notes.lower()


def test_free_text_is_cleaned_and_cannot_break_the_layout() -> None:
    draft = _draft(
        AssistantDocumentType.DECLARATION,
        {
            "declarant_name": "Jane\x00 Doe\x07",
            "address": "  12   Main\tStreet \r\n Pune ",
            "purpose": "School admission",
            "facts_declared": "First fact.\r\n\r\n   \r\nSecond fact.",
        },
    )
    assert "\x00" not in draft.text and "\x07" not in draft.text
    assert "I, Jane Doe, residing at 12 Main Street Pune," in draft.body
    assert "1. First fact.\n2. Second fact." in draft.body


def test_other_document_lists_the_key_facts() -> None:
    draft = _draft(
        AssistantDocumentType.OTHER,
        {
            "document_description": "Letter of undertaking",
            "key_facts": "Vacate by 31 December\nReturn the keys",
            "state_code": "Goa",
        },
    )
    assert "Document requested: Letter of undertaking" in draft.body
    assert "- Vacate by 31 December\n- Return the keys" in draft.body
    assert "You named Goa." in draft.notes


def test_notes_cover_the_four_things_every_draft_must_explain() -> None:
    for document_type in AssistantDocumentType:
        notes = _draft(document_type, {"state_code": "Kerala"}).notes
        assert "Information normally needed:" in notes
        assert "Clauses commonly included:" in notes
        assert "Supporting documents that may be relevant:" in notes
        assert "Execution, stamping and registration:" in notes
        assert "have a qualified advocate review it" in notes
        assert "not a legally executed document and not legal advice" in notes


@pytest.mark.parametrize(
    ("digits", "grouped"),
    [
        ("5", "5"),
        ("999", "999"),
        ("1000", "1,000"),
        ("25000", "25,000"),
        ("2500000", "25,00,000"),
        ("123456789", "12,34,56,789"),
        ("007", "7"),
        ("0", "0"),
    ],
)
def test_indian_digit_grouping(digits: str, grouped: str) -> None:
    assert templates._indian_grouping(digits) == grouped
