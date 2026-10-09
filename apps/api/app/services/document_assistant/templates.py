"""Template drafts for the Legal Document Assistant (offline mode).

With no AI provider configured, ``POST /documents`` builds the draft here
instead of failing: a deterministic document assembled from the user's own
answers (``questions.py``) and standard, plain-English clauses. The same
answers always give the same text.

What a template draft promises, and what it does not:

* The first line says it is a template draft generated without AI, to be
  reviewed with an advocate.
* Facts come only from the answers. Anything not answered, and anything that
  needs a decision, is a ``[BRACKETED PLACEHOLDER]`` to fill in or delete.
* No statute section numbers, case names, stamp-duty figures or statutory
  time limits are given: those depend on the state and on the circumstances,
  and a wrong figure in a legal document is worse than a blank. Stamp duty,
  notarisation and registration are described as depending on the state the
  user named, never quoted.
* A "Notes" section follows every draft: what information such a document
  normally needs, which clauses it normally has, which supporting documents
  may be relevant, and what stamping, notarisation, registration and review
  may be required.

The text is Markdown-subset friendly (``#``/``##`` headings, ``-`` bullets,
``1.`` lists): the web app renders it that way, and it stays readable as the
plain ``.txt`` download.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Mapping
from dataclasses import dataclass

from app.core.india import ALL_STATE_NAMES, normalize_state
from app.models.document_request import AssistantDocumentType

TEMPLATE_LABEL = (
    "TEMPLATE DRAFT - generated without AI from your answers. Review with an advocate before use."
)

# Control characters other than newline/tab would only ever be noise (and a
# NUL byte cannot be stored in PostgreSQL text).
_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_PLAIN_AMOUNT = re.compile(r"\d[\d,]*(?:\.\d+)?")
_WHOLE_NUMBER = re.compile(r"\d+")


@dataclass(frozen=True, slots=True)
class TemplateDraft:
    title: str
    body: str
    notes: str

    @property
    def text(self) -> str:
        """The full draft as stored and shown: label, document, then notes."""
        return f"{TEMPLATE_LABEL}\n\n{self.body}\n\n{self.notes}"


# ---------------------------------------------------------------------------
# Reading the answers
# ---------------------------------------------------------------------------


def _clean_lines(value: str) -> list[str]:
    cleaned = _CONTROL_CHARS.sub("", value.replace("\r\n", "\n").replace("\r", "\n"))
    lines = (" ".join(line.split()) for line in cleaned.split("\n"))
    return [line for line in lines if line]


def _indian_grouping(digits: str) -> str:
    """``2500000`` -> ``25,00,000``."""
    digits = digits.lstrip("0") or "0"
    if len(digits) <= 3:
        return digits
    head, tail = digits[:-3], digits[-3:]
    groups: list[str] = []
    while len(head) > 2:
        groups.insert(0, head[-2:])
        head = head[:-2]
    if head:
        groups.insert(0, head)
    return ",".join([*groups, tail])


class _Answers:
    """The user's answers, cleaned, with helpers that never raise on gaps."""

    def __init__(self, raw: Mapping[str, str]) -> None:
        self._lines = {key: _clean_lines(value or "") for key, value in raw.items()}
        state_text = " ".join(self._lines.get("state_code", []))
        code = normalize_state(state_text) if state_text else None
        self.state_known = code is not None
        self.state_text = state_text
        # Clauses use the recognised state name, else a placeholder; the Notes
        # quote whatever the user actually typed.
        self.state = ALL_STATE_NAMES[code] if code is not None else "[STATE]"

    def has(self, key: str) -> bool:
        return bool(self._lines.get(key))

    def one(self, key: str, placeholder: str) -> str:
        """The answer on one line, or ``[PLACEHOLDER]`` when it is blank."""
        text = " ".join(self._lines.get(key, []))
        return text or f"[{placeholder}]"

    def lines(self, key: str) -> list[str]:
        """Each non-empty line of a multi-line answer."""
        return list(self._lines.get(key, []))

    def money(self, key: str, placeholder: str) -> str:
        """A bare number becomes ``Rs. 25,000`` (Indian digit grouping); any
        other wording ("INR 25k", "Rs. 2 lakh") is kept exactly as written."""
        value = self.one(key, placeholder)
        if _WHOLE_NUMBER.fullmatch(value):
            return f"Rs. {_indian_grouping(value)}"
        return f"Rs. {value}" if _PLAIN_AMOUNT.fullmatch(value) else value

    def months(self, key: str, placeholder: str) -> str:
        value = self.one(key, placeholder)
        if _WHOLE_NUMBER.fullmatch(value):
            return f"{value} month" if int(value) == 1 else f"{value} months"
        return value


# ---------------------------------------------------------------------------
# Assembling the text
# ---------------------------------------------------------------------------


class _Writer:
    """Collects blocks (paragraphs, headings, lists) separated by blank lines."""

    def __init__(self) -> None:
        self._blocks: list[str] = []

    def title(self, text: str) -> None:
        self._blocks.append(f"# {text}")

    def heading(self, text: str) -> None:
        self._blocks.append(f"## {text}")

    def para(self, text: str) -> None:
        self._blocks.append(text)

    def clauses(self, section: int, items: list[str]) -> None:
        """Numbered clauses ``N.1``, ``N.2`` ... each as its own paragraph."""
        for index, item in enumerate(items, start=1):
            self._blocks.append(f"{section}.{index} {item}")

    def bullets(self, items: list[str]) -> None:
        self._blocks.append("\n".join(f"- {item}" for item in items))

    def numbered(self, items: list[str]) -> None:
        self._blocks.append("\n".join(f"{n}. {item}" for n, item in enumerate(items, start=1)))

    def section(self, number: int, heading: str, items: list[str]) -> None:
        self.heading(f"{number}. {heading}")
        self.clauses(number, items)

    def signatures(self, signers: list[tuple[str, str]]) -> None:
        for role, name in signers:
            self.para(
                f"Signed by {name} ({role})\nSignature: ____________________   Date: ________"
            )

    def witnesses(self) -> None:
        self.heading("WITNESSES")
        self.numbered(
            [
                "Name: ____________________  Address: ____________________  "
                "Signature: ____________",
                "Name: ____________________  Address: ____________________  "
                "Signature: ____________",
            ]
        )

    def render(self) -> str:
        return "\n\n".join(self._blocks)


@dataclass(frozen=True, slots=True)
class _Notes:
    needed: str
    clauses: str
    documents: str
    formalities: str


def _state_sentence(a: _Answers) -> str:
    depends = (
        "Whether stamp duty, notarisation or registration is needed, and what it costs, "
        "depends on the state"
    )
    if a.state_known:
        return (
            f"You named {a.state}. {depends}, so confirm the current requirements for "
            f"{a.state} with the local stamp or registration office or an advocate before "
            "signing."
        )
    if a.state_text:
        return (
            f'You named "{a.state_text}", which was not recognised as an Indian state or '
            f"union territory. {depends} where the document is signed or used, so confirm "
            "it locally before signing."
        )
    return (
        f"You did not name a state. {depends} where the document is signed or used, so "
        "confirm it locally before signing."
    )


def _notes(a: _Answers, notes: _Notes) -> str:
    items = [
        f"Information normally needed: {notes.needed}",
        f"Clauses commonly included: {notes.clauses}",
        f"Supporting documents that may be relevant: {notes.documents}",
        f"Execution, stamping and registration: {notes.formalities} {_state_sentence(a)}",
        "Placeholders: every item in [SQUARE BRACKETS] is something you did not tell us or "
        "something that needs a decision. Fill in or delete each one before signing.",
        "Review: this is a template draft built from your answers without AI. It is not a "
        "legally executed document and not legal advice. Requirements differ between states, "
        "document types and circumstances, so have a qualified advocate review it before use.",
    ]
    return "## Notes\n\n" + "\n".join(f"- {item}" for item in items)


# A builder turns the answers into ``(title, body, notes)``.
_Builder = Callable[[_Answers], tuple[str, str, _Notes]]


def _jurisdiction_clause(a: _Answers) -> str:
    return (
        "This document is governed by the laws of India. Subject to any dispute resolution "
        f"clause above, the courts at [CITY], {a.state} shall have jurisdiction "
        "[CONFIRM WITH AN ADVOCATE]."
    )


def _stamping_clause(a: _Answers, noun: str) -> str:
    return (
        f"Stamp duty and, where required, registration of this {noun} shall be dealt with as "
        f"the law of {a.state} requires. [STAMP DUTY, E-STAMP OR STAMP PAPER DETAILS AND "
        "REGISTRATION REQUIREMENTS TO BE CONFIRMED FOR THIS STATE]"
    )


# ---------------------------------------------------------------------------
# Document types
# ---------------------------------------------------------------------------


def _rental_agreement(a: _Answers) -> tuple[str, str, _Notes]:
    landlord = a.one("landlord_name", "LANDLORD'S FULL NAME")
    tenant = a.one("tenant_name", "TENANT'S FULL NAME")
    premises = a.one("property_address", "FULL ADDRESS OF THE PREMISES")
    rent = a.money("monthly_rent", "MONTHLY RENT")
    deposit = a.money("security_deposit", "SECURITY DEPOSIT")
    start = a.one("lease_start_date", "START DATE")
    term = a.months("lease_duration_months", "TERM IN MONTHS")
    special = a.lines("special_terms")

    w = _Writer()
    w.title("RENTAL AGREEMENT")
    w.para(
        'This Rental Agreement (the "Agreement") is made at [PLACE OF EXECUTION] on '
        "[DATE OF EXECUTION] between:"
    )
    w.para(
        f'{landlord}, of [LANDLORD\'S ADDRESS] (the "Landlord", which expression includes the '
        "Landlord's heirs, legal representatives and permitted assigns); and"
    )
    w.para(
        f'{tenant}, of [TENANT\'S PERMANENT ADDRESS] (the "Tenant", which expression includes '
        "the Tenant's heirs and legal representatives)."
    )
    w.para(
        f"The Landlord is the owner of, or is otherwise entitled to let out, the property at "
        f'{premises} (the "Premises"). The Tenant wishes to take the Premises on rent for '
        "[RESIDENTIAL / COMMERCIAL] use. The parties therefore agree as follows."
    )
    w.section(
        1,
        "PREMISES AND TERM",
        [
            f"The Landlord lets and the Tenant takes the Premises for a term of {term} starting "
            f'on {start} (the "Term"), unless this Agreement ends earlier as provided below.',
            "The Term may be extended only by a written agreement signed by both parties "
            "[AGREED RENEWAL TERMS, IF ANY].",
        ],
    )
    w.section(
        2,
        "RENT",
        [
            f"The Tenant shall pay rent of {rent} for each month, in advance, on or before "
            "[DAY OF MONTH] of that month, by [MODE OF PAYMENT, FOR EXAMPLE BANK TRANSFER].",
            "Any increase in rent during the Term shall be as follows: [AGREED RENT INCREASE, "
            "IF ANY].",
            "The Landlord shall give a receipt for each payment, or the bank record of the "
            "transfer shall serve as the receipt.",
        ],
    )
    w.section(
        3,
        "SECURITY DEPOSIT",
        [
            f"The Tenant has paid, or shall pay on signing, a refundable security deposit of "
            f"{deposit}. [CONFIRM WHETHER IT BEARS INTEREST]",
            "The Landlord shall return the deposit within [NUMBER] days after the Tenant hands "
            "back vacant possession, after deducting only unpaid rent, unpaid utility charges "
            "and the cost of damage beyond normal wear and tear, and shall give the Tenant a "
            "written statement of every deduction.",
            "The Tenant shall not treat the deposit as rent for any month unless the Landlord "
            "agrees in writing.",
        ],
    )
    w.section(
        4,
        "USE OF THE PREMISES",
        [
            "The Tenant shall use the Premises only for the purpose stated above and shall not "
            "carry on any unlawful activity or cause nuisance to neighbours.",
            "The Tenant shall not sublet, assign or part with possession of the Premises, in "
            "whole or in part, without the Landlord's prior written consent.",
            "The Tenant shall follow the lawful rules of the housing society or association, "
            "if any.",
        ],
    )
    w.section(
        5,
        "MAINTENANCE AND CHARGES",
        [
            "The Tenant shall pay for electricity, water, gas, internet and similar services "
            "used during the Term.",
            "Society or association maintenance charges and property-related charges shall be "
            "paid by [LANDLORD / TENANT / AS AGREED].",
            "The Tenant shall keep the Premises in good condition and carry out minor repairs. "
            "The Landlord shall be responsible for structural repairs and for repairs not "
            "caused by the Tenant.",
            "The Tenant shall not make structural changes or alterations without the "
            "Landlord's prior written consent.",
        ],
    )
    w.section(
        6,
        "ACCESS AND INSPECTION",
        [
            "The Landlord or the Landlord's representative may enter the Premises at "
            "reasonable times after giving the Tenant at least [NUMBER] hours' notice, to "
            "inspect it or to carry out repairs.",
        ],
    )
    w.section(
        7,
        "ENDING THE TENANCY",
        [
            "Either party may end this Agreement before the Term expires by giving the other "
            "[NOTICE PERIOD] written notice.",
            "The Landlord may end this Agreement earlier for non-payment of rent for "
            "[NUMBER] consecutive months or for a serious breach that the Tenant has not "
            "remedied within [NUMBER] days of written notice, in each case only in the "
            "manner the law allows.",
            "When the tenancy ends, the Tenant shall hand back vacant possession of the "
            "Premises with all keys, fittings and fixtures, in the condition in which it was "
            "received apart from normal wear and tear.",
        ],
    )
    special_items = special or ["[NO SPECIAL TERMS AGREED / ADD ANY ADDITIONAL TERMS HERE]"]
    w.section(8, "SPECIAL TERMS", special_items)
    w.section(
        9,
        "GENERAL",
        [
            "This Agreement is the entire agreement between the parties about the Premises "
            "and may be changed only in writing signed by both parties.",
            "Notices under this Agreement shall be in writing and sent to the addresses "
            "written above, or to any new address a party gives in writing.",
            _jurisdiction_clause(a),
            _stamping_clause(a, "Agreement"),
        ],
    )
    w.para("IN WITNESS WHEREOF the parties have signed this Agreement on the date written above.")
    w.signatures([("Landlord", landlord), ("Tenant", tenant)])
    w.witnesses()
    return (
        "RENTAL AGREEMENT",
        w.render(),
        _Notes(
            needed=(
                "full names, addresses and identity details of the landlord and the tenant; "
                "the full address and description of the property; the monthly rent, security "
                "deposit, start date and term; who pays maintenance and utilities; and the "
                "notice period for ending the tenancy."
            ),
            clauses=(
                "rent and its due date, security deposit and its refund, permitted use, "
                "repairs and maintenance, limits on subletting, inspection, notice and "
                "termination, handing back possession, and governing law."
            ),
            documents=(
                "proof that the landlord owns or may let out the property, identity and "
                "address proof of both parties, passport-size photographs, a recent utility "
                "bill, any society or association permission, an inventory of fittings and "
                "fixtures, and receipts for rent and deposit paid."
            ),
            formalities=(
                "Whether the agreement must be on stamp paper or e-stamped, registered or "
                "notarised depends on the state and often on the length of the tenancy. Local "
                "rent control or tenancy law may also limit what the agreement can say about "
                "rent increases and eviction."
            ),
        ),
    )


def _employment_agreement(a: _Answers) -> tuple[str, str, _Notes]:
    employer = a.one("employer_name", "EMPLOYER / COMPANY NAME")
    employee = a.one("employee_name", "EMPLOYEE'S FULL NAME")
    role = a.one("designation", "JOB TITLE")
    salary = a.money("monthly_salary", "MONTHLY SALARY / CTC")
    start = a.one("employment_start_date", "START DATE")
    key_terms = a.lines("key_terms")
    probation = (
        f"The Employee shall be on probation for {a.months('probation_period_months', '')}. "
        "At the end of probation the Employer shall confirm the appointment in writing, or "
        "extend probation or end the employment in accordance with this Agreement."
        if a.has("probation_period_months")
        else "[PROBATION PERIOD, IF ANY - DELETE THIS CLAUSE IF THERE IS NONE]"
    )

    w = _Writer()
    w.title("EMPLOYMENT AGREEMENT")
    w.para(
        'This Employment Agreement (the "Agreement") is made at [PLACE OF EXECUTION] on '
        "[DATE OF EXECUTION] between:"
    )
    w.para(
        f'{employer}, having its office at [EMPLOYER\'S ADDRESS] (the "Employer"); and '
        f'{employee}, of [EMPLOYEE\'S ADDRESS] (the "Employee").'
    )
    w.section(
        1,
        "APPOINTMENT",
        [
            f"The Employer appoints the Employee as {role}, and the Employee accepts the "
            f"appointment, with effect from {start}.",
            "The Employee shall work at [PLACE OF WORK] and may be asked to work at other "
            "locations where the role reasonably requires it.",
            "The Employee reports to [REPORTING MANAGER / DESIGNATION].",
        ],
    )
    w.section(
        2,
        "DUTIES",
        [
            "The Employee shall carry out the duties of the role and any other lawful duties "
            "reasonably assigned by the Employer, and shall devote working time to the "
            "Employer's business.",
            "[SUMMARY OF KEY RESPONSIBILITIES]",
        ],
    )
    w.section(3, "PROBATION", [probation])
    w.section(
        4,
        "REMUNERATION",
        [
            f"The Employee shall receive a salary of {salary} per month "
            "[GROSS / NET / COST TO COMPANY - SPECIFY], payable on or before "
            "[DAY OF MONTH] of each month.",
            "The Employer shall make the deductions the law requires, such as tax deducted at "
            "source and statutory contributions that apply to the Employee.",
            "[VARIABLE PAY, BONUS OR OTHER BENEFITS, IF ANY]",
        ],
    )
    w.section(
        5,
        "WORKING HOURS AND LEAVE",
        [
            "Working hours, weekly off, holidays and leave shall be as required by the law "
            "that applies to the Employer's establishment and as set out in the Employer's "
            "policies [WORKING HOURS AND LEAVE ENTITLEMENT].",
        ],
    )
    w.section(
        6,
        "CONFIDENTIALITY AND INTELLECTUAL PROPERTY",
        [
            "During and after the employment, the Employee shall keep confidential, and use "
            "only for the Employer's business, all non-public information of the Employer "
            "and its clients that the Employee learns through the employment.",
            "Work product created by the Employee in the course of employment belongs to the "
            "Employer, and the Employee shall sign any document reasonably needed to confirm "
            "this [CONFIRM WITH AN ADVOCATE].",
            "The Employee shall return all documents, devices and other property of the "
            "Employer when the employment ends.",
        ],
    )
    w.section(
        7,
        "CONDUCT AND POLICIES",
        [
            "The Employee shall follow the Employer's written policies as notified from time "
            "to time, including any code of conduct and policies on workplace conduct.",
            "The Employee shall act honestly, disclose any conflict of interest, and not take "
            "other paid work during the employment without the Employer's written consent.",
        ],
    )
    w.section(
        8,
        "ENDING THE EMPLOYMENT",
        [
            "Either party may end the employment by giving the other [NOTICE PERIOD] written "
            "notice, or pay in lieu of notice [CONFIRM WHETHER PAY IN LIEU IS ALLOWED].",
            "The Employer may end the employment without notice for serious misconduct, after "
            "giving the Employee a fair opportunity to explain, in the manner the law "
            "requires [CONFIRM WITH AN ADVOCATE].",
            "On leaving, the Employer shall pay all dues owed to the Employee in a full and "
            "final settlement within [NUMBER] days, subject to lawful deductions, and shall "
            "give a relieving letter once the Employee has returned the Employer's property.",
        ],
    )
    w.section(
        9,
        "ADDITIONAL TERMS",
        key_terms or ["[NO ADDITIONAL TERMS AGREED / ADD ANY ADDITIONAL TERMS HERE]"],
    )
    w.section(
        10,
        "GENERAL",
        [
            "This Agreement is the entire agreement between the parties about the employment "
            "and may be changed only in writing signed by both parties. Statutory rights of "
            "the Employee that cannot be waived are not affected.",
            _jurisdiction_clause(a),
            _stamping_clause(a, "Agreement"),
        ],
    )
    w.para("IN WITNESS WHEREOF the parties have signed this Agreement on the date written above.")
    w.signatures([("Employer", employer), ("Employee", employee)])
    w.witnesses()
    return (
        "EMPLOYMENT AGREEMENT",
        w.render(),
        _Notes(
            needed=(
                "full names and addresses of the employer and the employee, the job title, "
                "place of work, start date, pay structure (fixed and variable), probation, "
                "notice period, leave and working hours."
            ),
            clauses=(
                "appointment and duties, probation, remuneration and deductions, hours and "
                "leave, confidentiality, ownership of work product, conduct, notice and "
                "termination, full and final settlement, and governing law."
            ),
            documents=(
                "the offer or appointment letter, identity and address proof, educational and "
                "experience certificates, the relieving letter from the previous employer, "
                "bank and PAN details, and the employer's policy handbook."
            ),
            formalities=(
                "An employment agreement is not usually registered, but stamping and "
                "notarisation practice differs between states. Labour and "
                "shops-and-establishments rules of the state, and statutory benefits such as "
                "provident fund, ESI and gratuity, apply according to the size and nature of "
                "the establishment and cannot be contracted out of. Indian courts are "
                "generally reluctant to enforce restrictions that operate after employment "
                "ends, so have an advocate check any non-compete or non-solicit wording."
            ),
        ),
    )


def _mutuality(a: _Answers) -> bool | None:
    """True for mutual, False for one-way, None when the answer is silent or unclear."""
    value = " ".join(a.lines("mutual_or_one_way")).lower()
    mutual = bool(re.search(r"\b(?:mutual|both|two[- ]way|bilateral|reciprocal)\b", value))
    one_way = bool(re.search(r"\b(?:one[- ]way|unilateral|one[- ]sided|only)\b", value))
    if mutual == one_way:
        return None
    return mutual


def _nda(a: _Answers) -> tuple[str, str, _Notes]:
    discloser = a.one("disclosing_party", "DISCLOSING PARTY'S NAME")
    recipient = a.one("receiving_party", "RECEIVING PARTY'S NAME")
    purpose = a.one("purpose", "PURPOSE")
    effective = a.one("effective_date", "EFFECTIVE DATE")
    term = a.months("term_months", "CONFIDENTIALITY PERIOD IN MONTHS")
    mutual = _mutuality(a)

    w = _Writer()
    if mutual:
        w.title("MUTUAL NON-DISCLOSURE AGREEMENT")
        w.para(
            'This Mutual Non-Disclosure Agreement (the "Agreement") is made at '
            f"[PLACE OF EXECUTION] with effect from {effective} between:"
        )
        w.para(f'{discloser}, of [ADDRESS] ("Party A"); and {recipient}, of [ADDRESS] ("Party B").')
        w.para(
            'Each party may disclose confidential information to the other (as "Disclosing '
            'Party") and receive it from the other (as "Receiving Party").'
        )
    else:
        w.title("NON-DISCLOSURE AGREEMENT")
        w.para(
            'This Non-Disclosure Agreement (the "Agreement") is made at [PLACE OF EXECUTION] '
            f"with effect from {effective} between:"
        )
        w.para(
            f'{discloser}, of [ADDRESS] (the "Disclosing Party"); and {recipient}, of '
            '[ADDRESS] (the "Receiving Party").'
        )
        if mutual is None:
            w.para(
                "[CONFIRM WHETHER THIS IS A ONE-WAY OR A MUTUAL AGREEMENT. THIS DRAFT IS "
                "WRITTEN AS ONE-WAY, FROM THE DISCLOSING PARTY TO THE RECEIVING PARTY.]"
            )
    w.para(
        f"The parties wish to share confidential information for the following purpose "
        f'(the "Purpose"): {purpose}. They agree as follows.'
    )
    w.section(
        1,
        "CONFIDENTIAL INFORMATION",
        [
            '"Confidential Information" means all non-public information, in any form, that '
            "the Disclosing Party discloses to the Receiving Party for the Purpose, whether "
            "or not marked confidential, including business, technical, financial and "
            "customer information, and anything a reasonable person would understand to be "
            "confidential. [ANY SPECIFIC CATEGORIES TO NAME OR EXCLUDE]",
        ],
    )
    w.section(
        2,
        "OBLIGATIONS OF THE RECEIVING PARTY",
        [
            "The Receiving Party shall keep the Confidential Information confidential, use it "
            "only for the Purpose, and protect it with at least the care it uses for its own "
            "confidential information and never less than reasonable care.",
            "The Receiving Party shall not disclose the Confidential Information to anyone "
            "except its employees, advisers and representatives who need to know it for the "
            "Purpose and who are bound by confidentiality duties at least as strict as "
            "these. The Receiving Party is responsible for any breach by them.",
            "The Receiving Party shall promptly tell the Disclosing Party if it learns of any "
            "unauthorised use or disclosure.",
        ],
    )
    w.section(
        3,
        "EXCEPTIONS",
        [
            "These obligations do not apply to information that the Receiving Party can show "
            "(a) is or becomes public other than through its breach, (b) it already knew "
            "without a duty of confidence, (c) it received lawfully from a third party "
            "without a duty of confidence, or (d) it developed independently without using "
            "the Confidential Information.",
            "The Receiving Party may disclose Confidential Information when a court or "
            "authority lawfully requires it, if it gives the Disclosing Party prompt notice "
            "where the law allows, and discloses only what is required.",
        ],
    )
    w.section(
        4,
        "TERM",
        [
            f"This Agreement applies to Confidential Information disclosed from {effective}. "
            f"The Receiving Party's obligations continue for {term} from {effective}. "
            "[CONFIRM WHETHER TRADE SECRETS SHOULD STAY PROTECTED FOR LONGER]",
        ],
    )
    w.section(
        5,
        "RETURN OR DESTRUCTION",
        [
            "On written request, or when the Purpose ends, the Receiving Party shall return "
            "or destroy the Confidential Information and confirm in writing that it has "
            "done so, except for copies it must keep by law.",
        ],
    )
    w.section(
        6,
        "NO LICENCE AND NO OBLIGATION",
        [
            "Nothing in this Agreement gives the Receiving Party any right in the Confidential "
            "Information except to use it for the Purpose, and nothing obliges either party "
            "to enter into any further agreement.",
        ],
    )
    w.section(
        7,
        "REMEDIES",
        [
            "A breach may cause harm that money alone cannot repair. The Disclosing Party may "
            "seek an injunction or other relief from a court, in addition to any other "
            "remedy available to it in law.",
        ],
    )
    w.section(
        8,
        "GENERAL",
        [
            "This Agreement is the entire agreement between the parties about "
            "confidentiality for the Purpose and may be changed only in writing signed by "
            "both parties.",
            "Neither party may assign this Agreement without the other's written consent.",
            "[DISPUTE RESOLUTION: NEGOTIATION, ARBITRATION OR COURTS - ADD AS AGREED]",
            _jurisdiction_clause(a),
            _stamping_clause(a, "Agreement"),
        ],
    )
    w.para("IN WITNESS WHEREOF the parties have signed this Agreement on the date written above.")
    w.signatures(
        [
            ("Disclosing Party" if not mutual else "Party A", discloser),
            ("Receiving Party" if not mutual else "Party B", recipient),
        ]
    )
    w.witnesses()
    return (
        "NON-DISCLOSURE AGREEMENT",
        w.render(),
        _Notes(
            needed=(
                "full legal names and addresses of both parties, the purpose of sharing "
                "information, what counts as confidential, whether the duty runs one way or "
                "both ways, the effective date, and how long confidentiality must last."
            ),
            clauses=(
                "definition of confidential information, duties of the receiving party, "
                "exceptions (public or independently known information, disclosure required by "
                "law), duration, return or destruction, no licence, remedies, and governing law."
            ),
            documents=(
                "for a company, proof that the signatory is authorised to sign (for example a "
                "board resolution or authorisation letter), registration details of each "
                "party, and a schedule or description of the materials to be protected."
            ),
            formalities=(
                "Non-disclosure agreements are usually signed on stamp paper or e-stamped as "
                "the state requires and are not usually registered. How long an obligation "
                "survives, and what a court will enforce, depends on the facts and the law."
            ),
        ),
    )


def _numbered_statements(lines: list[str], fallback: str) -> list[str]:
    return lines or [fallback]


def _affidavit(a: _Answers) -> tuple[str, str, _Notes]:
    name = a.one("full_name", "DEPONENT'S FULL NAME")
    address = a.one("address", "RESIDENTIAL ADDRESS")
    purpose = a.one("purpose", "PURPOSE OF THE AFFIDAVIT")
    facts = _numbered_statements(a.lines("facts_to_declare"), "[FACTS TO BE DECLARED]")
    documents = a.lines("supporting_documents")

    statements = [
        "I am the deponent of this affidavit and I am competent to swear it.",
        *facts,
        f"I make this affidavit for the purpose of: {purpose}.",
    ]
    if documents:
        statements.append(
            "I am annexing the following documents in support of this affidavit: "
            + "; ".join(documents)
            + "."
        )
    statements.append(
        "I have not concealed any material fact, and what I have stated is true to the best "
        "of my knowledge and belief."
    )

    w = _Writer()
    w.title("AFFIDAVIT")
    w.para(f"Affidavit of {name}, made for the purpose of: {purpose}.")
    w.para(
        f"I, {name}, [SON / DAUGHTER / WIFE OF NAME], aged about [AGE] years, residing at "
        f"{address}, do hereby solemnly affirm and state on oath as follows:"
    )
    w.numbered(statements)
    w.heading("DEPONENT")
    w.para("Signature: ____________________\nName: " + name)
    w.heading("VERIFICATION")
    w.para(
        f"Verified at [PLACE] on [DATE] that the contents of paragraphs 1 to {len(statements)} "
        "of this affidavit are true and correct to my knowledge and belief, that nothing "
        "material has been concealed and that no part of it is false."
    )
    w.para("Signature of the Deponent: ____________________")
    w.heading("ATTESTATION")
    w.para(
        "Sworn or affirmed before me on [DATE] at [PLACE] by the deponent, who has been "
        "identified to my satisfaction.\n[NAME, DESIGNATION AND REGISTRATION NUMBER OF THE "
        "NOTARY / OATH COMMISSIONER / MAGISTRATE, WITH SEAL]"
    )
    return (
        "AFFIDAVIT",
        w.render(),
        _Notes(
            needed=(
                "the deponent's full name, parentage, age and address; the purpose of the "
                "affidavit; and the facts, stated in numbered paragraphs, each within the "
                "deponent's own knowledge."
            ),
            clauses=(
                "a heading, the deponent's details, numbered statements of fact, a "
                "verification clause, the deponent's signature and the attestation by the "
                "authority before whom it is sworn."
            ),
            documents=(
                "the deponent's identity proof, any document the affidavit refers to (attached "
                "as annexures), and the requesting authority's instructions if it prescribes "
                "a format."
            ),
            formalities=(
                "An affidavit is sworn or affirmed before a notary, oath commissioner or "
                "magistrate, and is often required on stamp paper of a value fixed by the "
                "state. If the office asking for it prescribes a format, use that format. "
                "Knowingly making a false statement in an affidavit can have serious legal "
                "consequences."
            ),
        ),
    )


def _declaration(a: _Answers) -> tuple[str, str, _Notes]:
    name = a.one("declarant_name", "DECLARANT'S FULL NAME")
    address = a.one("address", "RESIDENTIAL ADDRESS")
    purpose = a.one("purpose", "PURPOSE OF THE DECLARATION")
    facts = _numbered_statements(a.lines("facts_declared"), "[FACTS BEING DECLARED]")

    statements = [
        *facts,
        "I understand that this declaration is made for the purpose stated above and may be "
        "relied on by the person or office to whom I give it.",
        "I have not concealed any material fact, and what I have stated is true and correct "
        "to the best of my knowledge and belief.",
    ]
    w = _Writer()
    w.title("DECLARATION")
    w.para(f"Declaration of {name}, made for the purpose of: {purpose}.")
    w.para(f"I, {name}, residing at {address}, do hereby declare as follows:")
    w.numbered(statements)
    w.heading("DECLARANT")
    w.para("Place: [PLACE]\nDate: [DATE]\nSignature: ____________________\nName: " + name)
    return (
        "DECLARATION",
        w.render(),
        _Notes(
            needed=(
                "the declarant's full name and address, the purpose of the declaration, and "
                "the facts being declared, each within the declarant's own knowledge."
            ),
            clauses=(
                "a heading, the declarant's details, numbered statements, a statement that "
                "the facts are true and complete, and the place, date and signature."
            ),
            documents=(
                "the declarant's identity proof, any document the declaration refers to, "
                "and the requesting office's instructions if it prescribes a format."
            ),
            formalities=(
                "A declaration is a signed statement of facts. Unlike an affidavit it is not "
                "sworn before an authority unless the recipient asks for that. Some offices "
                "accept a plain declaration and others insist on a notarised affidavit or "
                "stamp paper, so ask the recipient what it accepts."
            ),
        ),
    )


def _business_agreement(a: _Answers) -> tuple[str, str, _Notes]:
    party_a = a.one("party_a_name", "FIRST PARTY'S NAME")
    party_b = a.one("party_b_name", "SECOND PARTY'S NAME")
    purpose = a.one("business_purpose", "PURPOSE OF THE AGREEMENT")
    effective = a.one("effective_date", "EFFECTIVE DATE")
    key_terms = a.lines("key_terms") or ["[KEY COMMERCIAL TERMS TO BE ADDED]"]

    w = _Writer()
    w.title("BUSINESS AGREEMENT")
    w.para(
        'This Business Agreement (the "Agreement") is made at [PLACE OF EXECUTION] with '
        f"effect from {effective} between:"
    )
    w.para(
        f'{party_a}, of [ADDRESS AND LEGAL FORM] ("Party A"); and {party_b}, of '
        '[ADDRESS AND LEGAL FORM] ("Party B").'
    )
    w.para(
        f'The parties wish to work together for the following purpose (the "Purpose"): '
        f"{purpose}. They agree as follows."
    )
    w.section(
        1,
        "PURPOSE AND SCOPE",
        [
            "The parties shall cooperate in good faith to achieve the Purpose, on the terms "
            "of this Agreement.",
            "[SCOPE OF WORK, DELIVERABLES AND TIMELINES]",
        ],
    )
    w.section(2, "KEY TERMS", key_terms)
    w.section(
        3,
        "RESPONSIBILITIES",
        [
            "Party A shall: [RESPONSIBILITIES OF PARTY A].",
            "Party B shall: [RESPONSIBILITIES OF PARTY B].",
            "Each party shall comply with the laws that apply to its part of the work and "
            "obtain the licences and approvals it needs.",
        ],
    )
    w.section(
        4,
        "PAYMENT",
        [
            "[AMOUNTS, DUE DATES AND MODE OF PAYMENT, IF NOT ALREADY IN THE KEY TERMS]",
            "Each party bears its own taxes. Where tax is charged on a payment, it shall be "
            "shown separately and paid as the law requires. [CONFIRM WITH AN ACCOUNTANT]",
        ],
    )
    w.section(
        5,
        "CONFIDENTIALITY AND INTELLECTUAL PROPERTY",
        [
            "Each party shall keep the other's non-public information confidential and use it "
            "only for the Purpose.",
            "Each party keeps the intellectual property it owned before this Agreement. "
            "Ownership of anything created together is [AS AGREED - SPECIFY].",
        ],
    )
    w.section(
        6,
        "LIABILITY",
        [
            "Each party is responsible for loss caused by its own breach of this Agreement. "
            "[ANY AGREED LIMIT ON LIABILITY OR INDEMNITY - ADVOCATE TO CONFIRM]",
            "Neither party is liable for delay or failure caused by events beyond its "
            "reasonable control, if it tells the other promptly and takes reasonable steps "
            "to limit the effect.",
        ],
    )
    w.section(
        7,
        "TERM AND TERMINATION",
        [
            f"This Agreement starts on {effective} and continues for [DURATION] unless ended "
            "earlier under this clause.",
            "Either party may end this Agreement by giving [NOTICE PERIOD] written notice, or "
            "immediately by written notice if the other commits a serious breach and does "
            "not remedy it within [NUMBER] days of being asked to.",
            "Ending this Agreement does not affect rights and duties that arose before it "
            "ended, or clauses that are meant to continue, such as confidentiality.",
        ],
    )
    w.section(
        8,
        "DISPUTES",
        [
            "The parties shall first try to settle any dispute by discussion between "
            "[DESIGNATION OF SENIOR REPRESENTATIVES] within [NUMBER] days of written notice "
            "of the dispute.",
            "[IF NOT SETTLED: ARBITRATION WITH SEAT AT [CITY] / COURTS - SELECT ONE]",
        ],
    )
    w.section(
        9,
        "GENERAL",
        [
            "This Agreement is the entire agreement between the parties about the Purpose "
            "and may be changed only in writing signed by both parties.",
            "Neither party may assign this Agreement without the other's written consent. "
            "If any clause is found unenforceable, the rest continues.",
            "Notices shall be in writing and sent to the addresses written above.",
            _jurisdiction_clause(a),
            _stamping_clause(a, "Agreement"),
        ],
    )
    w.para("IN WITNESS WHEREOF the parties have signed this Agreement on the date written above.")
    w.signatures([("Party A", party_a), ("Party B", party_b)])
    w.witnesses()
    return (
        "BUSINESS AGREEMENT",
        w.render(),
        _Notes(
            needed=(
                "full legal names, legal form and addresses of both parties, the purpose of the "
                "arrangement, the commercial terms (price, deliverables, timelines), the "
                "term, and how either side can end it."
            ),
            clauses=(
                "purpose and scope, responsibilities, payment and taxes, confidentiality, "
                "intellectual property, liability, term and termination, dispute resolution, "
                "and governing law."
            ),
            documents=(
                "registration or incorporation documents of each party, GST registration "
                "where applicable, proof that each signatory is authorised (for example a "
                "board resolution), and any scope of work or price list that is attached."
            ),
            formalities=(
                "Business agreements are usually stamped as the state requires. Registration "
                "is not usually needed unless the agreement deals with immovable property or "
                "another regulated matter. Whether to include arbitration is a choice worth "
                "discussing with an advocate."
            ),
        ),
    )


def _split_names(value: str) -> list[str]:
    parts = re.split(r"\s*(?:[;\n,]|\band\b|&)\s*", value, flags=re.IGNORECASE)
    return [p for p in (part.strip() for part in parts) if p]


def _partnership_document(a: _Answers) -> tuple[str, str, _Notes]:
    firm = a.one("firm_name", "NAME OF THE FIRM")
    partners = _split_names("\n".join(a.lines("partner_names")))
    capital = a.one("capital_contribution", "CAPITAL OF EACH PARTNER")
    ratio = a.one("profit_sharing_ratio", "PROFIT-SHARING RATIO")
    effective = a.one("effective_date", "EFFECTIVE DATE")

    w = _Writer()
    w.title("PARTNERSHIP DEED")
    w.para(
        'This Partnership Deed (the "Deed") is made at [PLACE OF EXECUTION] on '
        f"[DATE OF EXECUTION], with effect from {effective}, between the following persons "
        '(together the "Partners"):'
    )
    if partners:
        w.numbered([f"{p}, of [ADDRESS]" for p in partners])
    else:
        w.para("[NAMES AND ADDRESSES OF ALL PARTNERS]")
    if len(partners) == 1:
        w.para(
            "[A PARTNERSHIP NEEDS AT LEAST TWO PARTNERS - ADD THE OTHER PARTNER(S) OR "
            "CHECK THE NAMES YOU ENTERED]"
        )
    w.para(
        f"The Partners have agreed to carry on business in partnership under the name {firm} "
        '(the "Firm") on the terms of this Deed.'
    )
    w.section(
        1,
        "NAME, BUSINESS AND PLACE",
        [
            f"The Firm is called {firm}.",
            "The Firm shall carry on the business of [NATURE OF BUSINESS] and any other "
            "lawful business the Partners agree in writing.",
            "The principal place of business is [ADDRESS], and the Partners may agree to "
            "open other places of business.",
        ],
    )
    w.section(
        2,
        "START AND DURATION",
        [
            f"The partnership starts on {effective} and continues [AT WILL / FOR A FIXED "
            "PERIOD OF [DURATION]] unless ended as provided in this Deed.",
        ],
    )
    w.section(
        3,
        "CAPITAL",
        [
            f"The capital contributed by the Partners is: {capital}.",
            "Further capital may be contributed only as the Partners agree in writing. "
            "[INTEREST ON CAPITAL, IF ANY]",
        ],
    )
    w.section(
        4,
        "PROFITS AND LOSSES",
        [
            f"The Partners share the profits and losses of the Firm in this ratio: {ratio}.",
            "[SALARY, COMMISSION OR INTEREST PAYABLE TO PARTNERS, IF ANY]",
        ],
    )
    w.section(
        5,
        "MANAGEMENT AND AUTHORITY",
        [
            "Every Partner may take part in the management of the Firm. [DIVISION OF "
            "RESPONSIBILITIES]",
            "A Partner shall not, without the written consent of the other Partners, "
            "[ACTS NEEDING EVERYONE'S CONSENT, FOR EXAMPLE BORROWING ABOVE A LIMIT, "
            "TRANSFERRING FIRM PROPERTY OR ADMITTING A NEW PARTNER].",
            "Each Partner shall act in good faith and in the interests of the Firm.",
        ],
    )
    w.section(
        6,
        "BANK ACCOUNTS AND BOOKS",
        [
            "The Firm's bank accounts shall be opened in the Firm's name and operated by "
            "[AUTHORISED PARTNER(S) AND MODE OF OPERATION].",
            "The Firm shall keep proper books of account at its principal place of business, "
            "open to every Partner, and shall close its accounts on [ACCOUNTING DATE] each "
            "year.",
        ],
    )
    w.section(
        7,
        "CHANGES IN PARTNERS",
        [
            "A Partner may retire by giving the other Partners [NOTICE PERIOD] written "
            "notice. [TERMS OF PAYMENT TO A RETIRING PARTNER]",
            "A new Partner may be admitted only with the written consent of all Partners.",
            "[WHETHER THE PARTNERSHIP CONTINUES OR ENDS ON A PARTNER'S DEATH OR INSOLVENCY]",
        ],
    )
    w.section(
        8,
        "ENDING THE FIRM",
        [
            "On dissolution the Firm's affairs shall be wound up, its debts paid, and any "
            "balance shared among the Partners according to their capital and the profit "
            "ratio above.",
        ],
    )
    w.section(
        9,
        "DISPUTES AND GENERAL",
        [
            "The Partners shall try to settle any dispute among themselves first. "
            "[IF NOT SETTLED: ARBITRATION WITH SEAT AT [CITY] / COURTS - SELECT ONE]",
            "This Deed may be changed only in writing signed by all Partners.",
            _jurisdiction_clause(a),
            _stamping_clause(a, "Deed"),
        ],
    )
    w.para("IN WITNESS WHEREOF the Partners have signed this Deed on the date written above.")
    w.signatures([("Partner", p) for p in partners] or [("Partner", "[NAME OF PARTNER]")])
    w.witnesses()
    return (
        "PARTNERSHIP DEED",
        w.render(),
        _Notes(
            needed=(
                "the firm's name and nature of business, the full names and addresses of all "
                "partners, each partner's capital, the profit-sharing ratio, who manages the "
                "firm and who operates the bank account, and the start date."
            ),
            clauses=(
                "name and business, capital, profit and loss sharing, management and "
                "authority, bank accounts and books, retirement and admission of partners, "
                "dissolution, disputes, and governing law."
            ),
            documents=(
                "identity and address proof of every partner, proof of the business premises "
                "(ownership papers or a rent agreement with the owner's consent), and "
                "passport-size photographs. Tax and GST registrations are separate steps."
            ),
            formalities=(
                "A partnership deed is normally signed on stamp paper whose value is set by "
                "the state. Registering the firm with the Registrar of Firms is a separate "
                "step under the Indian Partnership Act, 1932, with a procedure and fees that "
                "the state sets. Consider it with an advocate or chartered accountant."
            ),
        ),
    )


def _authorization_letter(a: _Answers) -> tuple[str, str, _Notes]:
    authorizer = a.one("authorizer_name", "NAME OF THE PERSON GIVING AUTHORISATION")
    agent = a.one("authorized_person_name", "NAME OF THE AUTHORISED PERSON")
    purpose = a.one("purpose", "WHAT THE PERSON IS AUTHORISED TO DO")
    validity = a.one("validity_period", "VALIDITY PERIOD OR LAST DATE")

    w = _Writer()
    w.title("AUTHORISATION LETTER")
    w.para("Date: [DATE]\nPlace: [PLACE]")
    w.para("To,\n[NAME AND ADDRESS OF THE OFFICE / ORGANISATION / PERSON]")
    w.para("Subject: Authorisation to " + _lower_first(purpose))
    w.para("Dear Sir or Madam,")
    w.para(
        f"I, {authorizer}, of [ADDRESS], holding [IDENTITY DOCUMENT AND NUMBER], hereby "
        f"authorise {agent}, of [ADDRESS], holding [IDENTITY DOCUMENT AND NUMBER], to act "
        f"on my behalf for the following purpose: {purpose}."
    )
    w.para(
        "This authorisation is limited to the purpose stated above. It does not allow "
        f"{agent} to do anything else in my name."
    )
    w.para(
        f"This authorisation is valid for {validity}, unless I withdraw it earlier by "
        "writing to you."
    )
    w.para(
        "Kindly accept the authorised person's signature below as a specimen, and extend "
        "your cooperation to them."
    )
    w.para("Yours faithfully,")
    w.para(f"Signature: ____________________\nName: {authorizer}")
    w.heading("SPECIMEN SIGNATURE OF THE AUTHORISED PERSON")
    w.para(f"Signature: ____________________\nName: {agent}")
    w.heading("ENCLOSURES")
    w.bullets(
        [
            f"Copy of the identity document of {authorizer}",
            f"Copy of the identity document of {agent}",
            "[ANY OTHER DOCUMENT THE RECIPIENT ASKS FOR]",
        ]
    )
    return (
        "AUTHORISATION LETTER",
        w.render(),
        _Notes(
            needed=(
                "the full names and addresses of the person giving the authority and the "
                "person receiving it, the identity details of both, exactly what the "
                "authorised person may do, and how long the authority lasts."
            ),
            clauses=(
                "the statement of authority, the limited purpose, the validity period, how it "
                "can be withdrawn, and a specimen signature of the authorised person."
            ),
            documents=(
                "copies of identity proof of both persons, the original documents or the "
                "recipient's written request that the authorised person will present, and "
                "any form the recipient insists on."
            ),
            formalities=(
                "A simple authorisation letter is often enough for routine tasks such as "
                "collecting a document or a parcel, but banks, government offices and "
                "property transactions may require their own format, a notarised letter or "
                "a formal power of attorney. Ask the recipient what it accepts. A letter "
                "like this is not a power of attorney."
            ),
        ),
    )


def _lower_first(text: str) -> str:
    if len(text) > 1 and text[0].isupper() and not text[1].isupper():
        return text[0].lower() + text[1:]
    return text


def _service_agreement(a: _Answers) -> tuple[str, str, _Notes]:
    provider = a.one("service_provider_name", "SERVICE PROVIDER'S NAME")
    client = a.one("client_name", "CLIENT'S NAME")
    services = a.one("service_description", "DESCRIPTION OF THE SERVICES")
    fee = a.one("fee_amount", "FEE / PAYMENT TERMS")
    effective = a.one("effective_date", "EFFECTIVE DATE")
    duration = a.one("duration", "DURATION OF THE AGREEMENT")

    w = _Writer()
    w.title("SERVICE AGREEMENT")
    w.para(
        'This Service Agreement (the "Agreement") is made at [PLACE OF EXECUTION] with '
        f"effect from {effective} between:"
    )
    w.para(
        f'{provider}, of [ADDRESS] (the "Service Provider"); and {client}, of [ADDRESS] '
        '(the "Client").'
    )
    w.section(
        1,
        "SERVICES",
        [
            f'The Service Provider shall provide the following services (the "Services"): '
            f"{services}.",
            "[DELIVERABLES, MILESTONES AND TIMELINES]",
            "Any change to the Services shall be agreed in writing by both parties, "
            "including any change in the fee.",
        ],
    )
    w.section(
        2,
        "TERM",
        [
            f"This Agreement starts on {effective} and continues for {duration}, unless "
            "ended earlier under this Agreement.",
        ],
    )
    w.section(
        3,
        "FEES AND PAYMENT",
        [
            f"The Client shall pay the Service Provider: {fee}.",
            "The Service Provider shall send invoices [MONTHLY / ON MILESTONES / AS "
            "AGREED], and the Client shall pay each undisputed invoice within [NUMBER] days "
            "of receiving it.",
            "The fee is [EXCLUSIVE / INCLUSIVE] of applicable taxes, which shall be shown "
            "separately on the invoice and paid as the law requires. [CONFIRM WITH AN "
            "ACCOUNTANT, INCLUDING ANY TAX DEDUCTED AT SOURCE]",
        ],
    )
    w.section(
        4,
        "THE CLIENT'S RESPONSIBILITIES",
        [
            "The Client shall give the Service Provider the information, access and "
            "decisions it reasonably needs, on time.",
        ],
    )
    w.section(
        5,
        "STANDARD OF SERVICE",
        [
            "The Service Provider shall perform the Services with reasonable skill and care, "
            "using suitably qualified people, and in line with the law.",
            "The Service Provider is an independent contractor. Nothing in this Agreement "
            "makes either party the employee, partner or agent of the other.",
        ],
    )
    w.section(
        6,
        "CONFIDENTIALITY AND INTELLECTUAL PROPERTY",
        [
            "Each party shall keep the other's non-public information confidential and use "
            "it only for this Agreement.",
            "Ownership of the work produced under this Agreement is [CLIENT / SERVICE "
            "PROVIDER / AS AGREED - SPECIFY], on payment of the fees due. Each party keeps "
            "the intellectual property it owned before this Agreement.",
        ],
    )
    w.section(
        7,
        "LIABILITY",
        [
            "Each party is responsible for loss caused by its own breach of this Agreement. "
            "[ANY AGREED LIMIT ON LIABILITY - ADVOCATE TO CONFIRM]",
        ],
    )
    w.section(
        8,
        "ENDING THE AGREEMENT",
        [
            "Either party may end this Agreement by giving [NOTICE PERIOD] written notice, or "
            "immediately by written notice if the other commits a serious breach and does "
            "not remedy it within [NUMBER] days of being asked to.",
            "On ending, the Client shall pay for Services properly performed up to the end "
            "date, and each party shall return the other's materials.",
        ],
    )
    w.section(
        9,
        "GENERAL",
        [
            "This Agreement is the entire agreement between the parties about the Services "
            "and may be changed only in writing signed by both parties.",
            "[DISPUTE RESOLUTION: NEGOTIATION, ARBITRATION OR COURTS - ADD AS AGREED]",
            _jurisdiction_clause(a),
            _stamping_clause(a, "Agreement"),
        ],
    )
    w.para("IN WITNESS WHEREOF the parties have signed this Agreement on the date written above.")
    w.signatures([("Service Provider", provider), ("Client", client)])
    w.witnesses()
    return (
        "SERVICE AGREEMENT",
        w.render(),
        _Notes(
            needed=(
                "full legal names and addresses of the service provider and the client, a "
                "clear description of the services and deliverables, the fee and payment "
                "schedule, the start date and duration, and how either side can end it."
            ),
            clauses=(
                "scope of services, term, fees and taxes, client responsibilities, standard of "
                "service, confidentiality, intellectual property, liability, termination, "
                "dispute resolution, and governing law."
            ),
            documents=(
                "registration and GST details of the parties where applicable, proof of "
                "authority of the signatories, any scope of work, quotation or specification "
                "that will be attached, and identity and address proof."
            ),
            formalities=(
                "Service agreements are usually stamped as the state requires and are not "
                "usually registered. Tax treatment of the fee, including GST and tax "
                "deducted at source, should be confirmed with an accountant."
            ),
        ),
    )


def _legal_notice(a: _Answers) -> tuple[str, str, _Notes]:
    sender = a.one("sender_name", "SENDER'S NAME")
    recipient = a.one("recipient_name", "RECIPIENT'S NAME")
    subject = a.one("subject_matter", "SUBJECT OF THE NOTICE")
    facts = _numbered_statements(a.lines("facts_and_grievance"), "[FACTS AND GRIEVANCE]")
    relief = a.one("relief_sought", "RELIEF SOUGHT")

    statements = [
        *facts,
        "Your conduct as described above has caused me loss and inconvenience. "
        "[DESCRIBE THE LOSS, WITH AMOUNTS AND DATES]",
        f"I therefore call upon you to do the following within [NUMBER] days of receiving "
        f"this notice: {relief}.",
        "If you do not comply within that time, I shall be forced to take such civil and/or "
        "criminal proceedings against you as are open to me in law [DELETE WHAT DOES NOT "
        "APPLY], at your risk as to costs and consequences, and without further notice to "
        "you.",
        "This notice is sent without prejudice to all my other rights and remedies in law, "
        "all of which are reserved.",
    ]
    w = _Writer()
    w.title("LEGAL NOTICE")
    w.para(
        "[SENDER'S ADDRESS OR ADVOCATE'S LETTERHEAD]\nDate: [DATE]\n"
        "Sent by: [REGISTERED POST AD / SPEED POST / COURIER / EMAIL]"
    )
    w.para(f"To,\n{recipient},\n[RECIPIENT'S ADDRESS]")
    w.para(f"Subject: Legal notice regarding {_lower_first(subject)}")
    w.para("Sir or Madam,")
    w.para(f"I, {sender}, of [SENDER'S ADDRESS], give you this notice and state as follows:")
    w.numbered(statements)
    w.para("Yours faithfully,")
    w.para(f"Signature: ____________________\nName: {sender}")
    w.heading("ENCLOSURES")
    w.bullets(["[LIST OF DOCUMENTS ATTACHED, FOR EXAMPLE AGREEMENT, INVOICES, CORRESPONDENCE]"])
    return (
        "LEGAL NOTICE",
        w.render(),
        _Notes(
            needed=(
                "the full names and addresses of the sender and the recipient, a clear dated "
                "account of what happened, amounts claimed, the documents relied on, exactly "
                "what you want the recipient to do, and a reasonable deadline."
            ),
            clauses=(
                "date and mode of delivery, addressee, subject line, numbered facts, the "
                "demand with a deadline, the consequence of not complying, a reservation of "
                "rights, and the signature."
            ),
            documents=(
                "the contract or agreement, invoices, receipts, correspondence, proof of "
                "payment or loss, and identity proof. Keep a copy of the notice and the proof "
                "of posting and delivery."
            ),
            formalities=(
                "A legal notice does not need stamp paper or registration. It is normally sent "
                "by registered post or speed post with acknowledgement due, with an email "
                "copy. Some laws require a particular kind of notice, or a time limit, "
                "before you may go to court or a tribunal (for example in cheque dishonour "
                "or consumer matters), so check with an advocate before sending. Many "
                "recipients take a notice more seriously when an advocate sends it."
            ),
        ),
    )


def _other_document(a: _Answers) -> tuple[str, str, _Notes]:
    description = a.one("document_description", "DESCRIPTION OF THE DOCUMENT")
    facts = a.lines("key_facts") or ["[KEY FACTS AND DETAILS TO INCLUDE]"]

    w = _Writer()
    w.title("DOCUMENT DRAFT")
    w.para(f"Document requested: {description}")
    w.heading("KEY FACTS AND DETAILS YOU PROVIDED")
    w.bullets(facts)
    w.heading("SUGGESTED STRUCTURE")
    w.para(
        "This template cannot tell what kind of document you need, so it gives a general "
        "structure to adapt. Replace the placeholders, then ask an advocate to turn it "
        "into the final document."
    )
    w.section(
        1,
        "PARTIES AND DATE",
        [
            "This document is made at [PLACE] on [DATE] by [FULL NAMES AND ADDRESSES OF "
            "EVERYONE INVOLVED AND THEIR CAPACITY].",
        ],
    )
    w.section(
        2,
        "BACKGROUND",
        [
            f"[WHY THIS DOCUMENT IS BEING MADE, BASED ON: {description}]",
            "The facts on which this document is based are set out in the key facts above "
            "[RESTATE THEM AS NUMBERED STATEMENTS].",
        ],
    )
    w.section(
        3,
        "OPERATIVE TERMS",
        [
            "[WHAT EACH PERSON AGREES, DECLARES, PROMISES OR AUTHORISES]",
            "[AMOUNTS, DATES AND DELIVERABLES, IF ANY]",
        ],
    )
    w.section(
        4,
        "DURATION AND ENDING",
        [
            "[WHEN IT STARTS, HOW LONG IT LASTS AND HOW IT CAN BE ENDED, IF RELEVANT]",
        ],
    )
    w.section(
        5,
        "GENERAL",
        [
            "[CONFIDENTIALITY, NOTICES AND DISPUTE RESOLUTION, IF RELEVANT]",
            _jurisdiction_clause(a),
            _stamping_clause(a, "document"),
        ],
    )
    w.para("Signed on the date written above.")
    w.signatures([("Party", "[NAME OF EACH SIGNATORY]")])
    w.witnesses()
    return (
        "DOCUMENT DRAFT",
        w.render(),
        _Notes(
            needed=(
                "the full names and addresses of everyone involved, exactly what the document "
                "must achieve, the key facts and dates, any amounts, and who must sign."
            ),
            clauses=(
                "parties and date, background, the operative terms, duration and ending, "
                "notices, dispute resolution, and governing law. The right clauses depend on "
                "the kind of document."
            ),
            documents=(
                "identity and address proof of those involved, any earlier agreement or "
                "correspondence the document refers to, and any form that the office or "
                "person receiving it prescribes."
            ),
            formalities=(
                "Whether this kind of document must be stamped, notarised or registered "
                "depends on its type and on the state."
            ),
        ),
    )


_BUILDERS: dict[AssistantDocumentType, _Builder] = {
    AssistantDocumentType.RENTAL_AGREEMENT: _rental_agreement,
    AssistantDocumentType.EMPLOYMENT_AGREEMENT: _employment_agreement,
    AssistantDocumentType.NDA: _nda,
    AssistantDocumentType.AFFIDAVIT: _affidavit,
    AssistantDocumentType.DECLARATION: _declaration,
    AssistantDocumentType.BUSINESS_AGREEMENT: _business_agreement,
    AssistantDocumentType.PARTNERSHIP_DOCUMENT: _partnership_document,
    AssistantDocumentType.AUTHORIZATION_LETTER: _authorization_letter,
    AssistantDocumentType.SERVICE_AGREEMENT: _service_agreement,
    AssistantDocumentType.LEGAL_NOTICE: _legal_notice,
    AssistantDocumentType.OTHER: _other_document,
}

# A new document type must get a template before it can be offered.
assert set(_BUILDERS) == set(AssistantDocumentType)


def build_template_draft(
    document_type: AssistantDocumentType, answers: Mapping[str, str]
) -> TemplateDraft:
    """The deterministic draft (label, document and Notes) for ``document_type``."""
    a = _Answers(answers)
    title, body, notes = _BUILDERS[document_type](a)
    return TemplateDraft(title=title, body=body, notes=_notes(a, notes))
