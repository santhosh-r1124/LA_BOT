"""Deterministic keyword classifier for offline mode.

When no AI provider is configured (or the provider is down),
:func:`app.services.legal_classifier.classify_query` falls back to this module
so chat keeps working: every message still gets a legal ``category``, a
``jurisdiction_scope``, a ``risk_level`` and an ``is_out_of_scope`` flag, and
HIGH/CRITICAL questions still trigger the advocate recommendation.

It is plain vocabulary matching, no model and no randomness: the same text
always gives the same answer. Matching is case-insensitive and whole-word;
only the common, correctly spelled English and Hinglish (Hindi written in
Latin script) terms are covered, and typos are not corrected.

How a message is judged
-----------------------
* **Category** - each category owns a lexicon of terms weighted strong (4),
  medium (2) or weak (1). The highest total wins (at least 2 points); ties go
  to the more specific category (see ``_PRIORITY``). Drafting words ("draft",
  "template", "format of") move a non-urgent message to DOCUMENT_GUIDANCE.
* **Risk** - CRITICAL for arrest, an FIR or police case against the user,
  summons, raids, jail or a court order against them; HIGH for a dispute that
  is already unfolding (not paid, refused, cheated, evicted, terminated, a
  legal notice received, threats); MEDIUM for drafting or "about to do"
  guidance; LOW for general what-is / how-does questions that do not describe
  the user's own situation.
* **Jurisdiction** - stamp duty, registration and state cues first, then court
  cues, then a per-category default.
* **Out of scope** - only when the text is clearly about something else (code,
  recipes, weather, sports scores, films, maths homework...) *and* shows no
  legal vocabulary at all. A greeting, or a question about what the assistant
  can do, is never out of scope.
* **Fail toward an advocate** - legal vocabulary with no recognisable topic is
  ADVOCATE_REQUIRED at HIGH risk, not a shrug.

The message is only ever read here; nothing in this module logs it.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

from app.core.india import ALL_STATE_NAMES
from app.services.legal_classifier import (
    JURISDICTION_SCOPES,
    LEGAL_CATEGORIES,
    RISK_LEVELS,
    Classification,
)

_STRONG, _MEDIUM, _WEAK = 4, 2, 1
# A category needs at least this many points to be believed.
_MIN_CATEGORY_SCORE = 2
# Ceiling for the generic ADVOCATE_REQUIRED vocabulary (below one strong term).
_GENERIC_SCORE_CAP = 3
_FALLBACK_CATEGORY = "ADVOCATE_REQUIRED"
_NEUTRAL_CATEGORY = "DOCUMENT_GUIDANCE"

# Most specific first: on a tie the earlier category wins.
_PRIORITY: tuple[str, ...] = (
    "CYBER_LAW",
    "DATA_PROTECTION",
    "IT_LAW",
    "IP_LAW",
    "TAX_LAW",
    "EMPLOYMENT_LAW",
    "CONSUMER_LAW",
    "FAMILY_LAW",
    "PROPERTY_LAW",
    "CRIMINAL_LAW",
    "CORPORATE_LAW",
    "CONTRACT_LAW",
    "DOCUMENT_GUIDANCE",
    "ADVOCATE_REQUIRED",
)

# ---------------------------------------------------------------------------
# Pattern compilation
# ---------------------------------------------------------------------------


def _compile(term: str) -> re.Pattern[str]:
    """Turn a lexicon entry into a whole-word pattern.

    * ``"re:..."`` is used as a raw regular expression (still whole-word).
    * Otherwise spaces and hyphens in the term are interchangeable and may be
      missing ("e-commerce" matches "e commerce" and "ecommerce").
    * A trailing ``*`` accepts any word ending ("arrest*" -> arrested).
    * Without ``*``, a plain trailing "s" or "es" is accepted ("tenant" ->
      tenants).
    """
    if term.startswith("re:"):
        body = term[3:]
    else:
        open_ended = term.endswith("*")
        stem = term[:-1] if open_ended else term
        pieces = [re.escape(p) for p in re.split(r"[ \-]+", stem) if p]
        body = r"[\s\-]*".join(pieces)
        if open_ended:
            body += r"[a-z]*"
        elif stem[-1:].isalpha():
            body += r"(?:s|es)?"
    return re.compile(rf"(?<![a-z0-9])(?:{body})(?![a-z0-9])")


def _w(*chunks: str) -> tuple[str, ...]:
    """Split a ``;``-separated vocabulary (written as wrapped string chunks)."""
    return tuple(term.strip() for term in "".join(chunks).split(";") if term.strip())


def _compile_all(terms: tuple[str, ...]) -> tuple[re.Pattern[str], ...]:
    return tuple(_compile(t) for t in terms)


@dataclass(frozen=True, slots=True)
class _Lexicon:
    strong: tuple[str, ...] = ()
    medium: tuple[str, ...] = ()
    weak: tuple[str, ...] = ()

    def compiled(self) -> tuple[tuple[re.Pattern[str], int], ...]:
        """Weighted patterns. Spellings that read the same once spaces and
        hyphens are ignored ("start-up" / "startup") count once, at their
        strongest tier, so listing both never double-scores a message."""
        unique: dict[str, tuple[re.Pattern[str], int]] = {}
        for terms, weight in ((self.strong, _STRONG), (self.medium, _MEDIUM), (self.weak, _WEAK)):
            for term in terms:
                key = term if term.startswith("re:") else re.sub(r"[ \-]+", "", term)
                unique.setdefault(key, (_compile(term), weight))
        return tuple(unique.values())


# ---------------------------------------------------------------------------
# Category lexicons
# ---------------------------------------------------------------------------

_LEXICONS: dict[str, _Lexicon] = {
    "EMPLOYMENT_LAW": _Lexicon(
        strong=_w(
            "employer; employee; employment; salary; salaries; wage; wages; payslip; pay slip; "
            "provident fund; pf; epf; epfo; gratuity; notice period; full and final; f&f; "
            "appointment letter; offer letter; relieving letter; experience letter; "
            "maternity leave; maternity benefit; labour court; labor court; labour law; "
            "labor law; labour code; retrenchment; lay off; laid off; layoff; "
            "wrongful termination; unfair dismissal; esic; esi; posh; "
            "internal complaints committee; workplace; minimum wage; industrial dispute; "
            "trade union; gig worker; overtime; leave encashment; tankhwah; tankha; vetan; "
            "naukri;"
        ),
        medium=_w(
            "terminated; fired; dismissed; sacked; resign*; bonus; increment; appraisal; "
            "labour; labor; shops and establishments; "
            "probation; boss; hr; colleague; ctc; joining date; bond; non-compete; "
            "non compete;"
        ),
        weak=_w("job; manager; office; leave; work; paid;"),
    ),
    "PROPERTY_LAW": _Lexicon(
        strong=_w(
            "tenant; tenancy; landlord; landlady; rent*; lease; lessor; lessee; "
            "leave and licence; leave and license; licensor; licensee; security deposit; "
            "eviction; evict*; notice to vacate; vacate; lock-in period; sale deed; gift deed; "
            "title deed; sale agreement; agreement to sell; builder buyer agreement; "
            "home buyer; encroach*; builder; rera; possession certificate; "
            "occupancy certificate; mutation; khata; patta; jamabandi; land record; "
            "revenue record; survey number; easement; conveyance; rent control; "
            "maintenance charges; kiraya; kiraydar; makan malik; makaan malik; zameen; jaidad;"
        ),
        medium=_w(
            "property; flat; plot; apartment; house; land; deposit; possession; registry; "
            "sub-registrar; stamp duty; boundary; trespass*; society; "
            "tenure;"
        ),
        weak=("registration", "owner", "ownership", "title", "deed", "neighbour", "neighbor"),
    ),
    "CONSUMER_LAW": _Lexicon(
        strong=_w(
            "consumer; defective; defect; faulty; warranty; e-commerce; deficiency in service; "
            "unfair trade practice; misleading advertisement; mrp; overcharg*; return policy; "
            "insurance claim; medical negligence; counterfeit product; customer care; "
            "online shopping;"
        ),
        medium=_w(
            "refund; guarantee; replacement; amazon; flipkart; myntra; swiggy; zomato; seller; "
            "product; insurance; airline; subscription; damaged; service charge; negligence; "
            "warranty card; cashback;"
        ),
        weak=_w(
            "delivery; deliver*; ordered; order; invoice; bill; cancel*; complaint; shop; flight;"
        ),
    ),
    "CYBER_LAW": _Lexicon(
        strong=_w(
            "hack*; phishing; phished; vishing; smishing; online fraud; online scam; "
            "cyber fraud; upi fraud; cyber crime; cybercrime; cyber police; cyber cell; "
            "cyberbullying; cyber bullying; cyberstalking; cyber stalking; online harassment; "
            "sextortion; identity theft; morphed; deepfake; ransomware; malware; fake profile; "
            "revenge porn; sim swap; digital arrest; investment scam; loan app; "
            "unauthorised transaction; unauthorized transaction; fraudulent transaction; "
            "money debited; debited without; otp; fake call; qr code scam; screen sharing;"
        ),
        medium=_w(
            "cyber; upi; net banking; internet banking; credit card fraud; debit card fraud; "
            "cloned card; obscene; troll*; scam*; blackmail*;"
        ),
        weak=_w("online; internet; whatsapp; instagram; facebook; social media; website; email;"),
    ),
    "DATA_PROTECTION": _Lexicon(
        strong=_w(
            "personal data; privacy; dpdp; data protection; data fiduciary; data principal; "
            "data breach; data leak; right to be forgotten; gdpr; privacy policy; "
            "data processing; data processor; sensitive personal data; data protection board; "
            "consent manager; data localisation; data localization;"
        ),
        medium=("aadhaar", "surveillance", "my data", "personal information", "data sharing"),
        weak=("data", "consent", "cookie", "tracking", "cctv"),
    ),
    "IP_LAW": _Lexicon(
        strong=_w(
            "trademark; trade mark; copyright; patent; intellectual property; trade secret; "
            "passing off; geographical indication; piracy; plagiari*; industrial design; ipr; "
            "royalty; royalties; creative commons; moral rights; fair use; fair dealing; wipo; "
            "dmca; "
            r"re:protect (?:my |our |the )?(?:\w+ ){0,2}"
            r"(?:idea|invention|brand|logo|design|content);"
        ),
        medium=_w("brand name; brand; logo; infring*; domain name; design registration; torrent;"),
        weak=("licensing", "licence", "license", "copied"),
    ),
    "TAX_LAW": _Lexicon(
        strong=_w(
            "gst; gstin; income tax; itr; tds; tcs; tax return; tax; taxes; taxation; taxable; "
            "taxpayer; advance tax; capital gain; input tax credit; e-way bill; form 16; "
            "form 26as; assessment order; tax notice; tax evasion; tax audit; customs duty; "
            "excise; professional tax; property tax; cbdt; cbic; vat; indirect tax; "
            "direct tax; tax slab; tax regime; reassessment; faceless assessment; tax demand;"
        ),
        medium=_w("itc; huf; pan card; assessment; tax saving; tax deduction; hra;"),
        weak=("filing returns", "returns", "refund"),
    ),
    "FAMILY_LAW": _Lexicon(
        strong=_w(
            "divorce; alimony; dowry; marriage; married; marital; wife; husband; spouse; "
            "domestic violence; 498a; adoption; adopt*; guardianship; child custody; "
            "child support; mutual consent; judicial separation; in-laws; mother-in-law; "
            "father-in-law; inheritance; succession; ancestral property; hindu marriage act; "
            "special marriage act; hindu succession; streedhan; stridhan; conjugal rights; "
            "talaq; nikah; mehr; paternity; legal heir; family court; coparcener; "
            "live-in relationship; live in relationship; probate; testament; intestate; "
            "succession certificate; make a will; write a will; my will; last will; "
            "registered will; shaadi; dahej; patni; without a will; passed away; deceased; "
            "late father; late mother; late husband; handwritten will; valid will; will deed;"
        ),
        medium=_w(
            "custody; maintenance; separation; guardian; widow; nominee; family dispute; "
            "partition; pati;"
        ),
        weak=_w("child; children; daughter; son; mother; father; parents;"),
    ),
    "CRIMINAL_LAW": _Lexicon(
        strong=_w(
            "fir; arrest*; bail; anticipatory bail; police; police station; cheque bounce; "
            "cheque bounced; bounced cheque; cheque dishonour; cheque dishonor; "
            "dishonoured cheque; negotiable instruments act; ni act; crime; criminal; "
            "chargesheet; charge sheet; quash*; bns; bnss; ipc; crpc; indian penal code; "
            "bharatiya nyaya sanhita; bharatiya nagarik suraksha sanhita; cheating; theft; "
            "robbery; assault; murder; extortion; kidnap*; molest*; rape; stalking; "
            "sexual assault; sexual harassment; forgery; forged; defamation; cognizable; "
            "non-bailable; sessions court; criminal breach of trust; dowry death; thana; "
            "giraftar; dhokha; defamatory; sedition; uapa; pocso; ndps; drunk driving; "
            "drink and drive; arms act;"
        ),
        medium=_w(
            "cheque; weapon*; firearm*; knife; challan; threat*; blackmail; harassment; violence; "
            "warrant; summons; magistrate; "
            "jail; prison; imprisonment; convict*; acquit*; accused; complainant; stolen; "
            "fraud; false case; false complaint; trespass;"
        ),
        weak=("complaint", "abuse", "abused", "cheated"),
    ),
    "CORPORATE_LAW": _Lexicon(
        strong=_w(
            "director; roc; registrar of companies; shareholder; stockholder; startup; "
            "start-up; incorporation; incorporate; private limited; pvt ltd; pvt. ltd; "
            "public limited; llp; limited liability partnership; board meeting; "
            "board resolution; companies act; mca; esop; co-founder; cofounder; term sheet; "
            "winding up; insolvency; ibc; nclt; nclat; liquidation; annual return; agm; "
            "share capital; shareholders agreement; shareholders' agreement; share transfer; "
            "memorandum of association; articles of association; moa; aoa; one person company; "
            "opc; sebi; merger; acquisition; fdi; fema; due diligence; company secretary; "
            "partnership firm; sole proprietor*; proprietorship; venture capital; "
            "angel investor;"
        ),
        medium=_w(
            "company; founder; equity; dividend; corporate; auditor; dissolution; ltd; "
            "partnership; partner; investor;"
        ),
        weak=("compliance", "business", "board", "stake", "shares"),
    ),
    "CONTRACT_LAW": _Lexicon(
        strong=_w(
            "contract; breach; indemnity; indemnif*; specific performance; liquidated damages; "
            "force majeure; arbitration; arbitrator; mou; memorandum of understanding; "
            "terms and conditions; contract act; voidable; limitation of liability; novation; "
            "guarantor; surety; loan agreement; promissory note; service agreement; "
            "vendor agreement; non-disclosure; nda; confidentiality agreement; loan recovery; "
            "recovery agent*;"
        ),
        medium=_w(
            "agreement; clause; damages; default*; liability; undertaking; confidentiality; "
            "advance payment; void; terminate; termination; loan; emi; credit card; buyer; "
            "ownership transfer; transfer of ownership;"
        ),
        weak=_w("vendor; supplier; client; consideration; party; parties;"),
    ),
    "IT_LAW": _Lexicon(
        strong=_w(
            "it act; information technology act; intermediary; intermediaries; safe harbour; "
            "safe harbor; takedown; software licence; software license; open source; "
            "digital signature; electronic signature; e-sign; esign; electronic record; saas; "
            "source code; eula; end user licence; end user license; it rules; "
            "intermediary guidelines; grievance officer; cert-in; certifying authority; "
            "blocking order; social media intermediary; software development agreement; "
            "terms of service; terms of use; platform liability;"
        ),
        medium=("software", "app store", "hosting", "artificial intelligence", "digital platform"),
        weak=("cloud", "algorithm", "digital", "app", "platform"),
    ),
    "DOCUMENT_GUIDANCE": _Lexicon(
        strong=_w(
            "draft*; template; proforma; pro forma; specimen; re:format (?:of|for); "
            "how to write; affidavit; notar*; power of attorney; authorisation letter; "
            "authorization letter; no objection certificate; indemnity bond; stamp paper; "
            "e-stamp; apostille; deponent; documents required; required documents;"
        ),
        medium=_w(
            "declaration; sample; noc; undertaking; attest*; deed; checklist; document; "
            "stamp duty; "
            "change my name; name change; change of name; gazette;"
        ),
        weak=("letter", "format"),
    ),
    # Generic legal vocabulary: enough to know "this is a legal matter" but not
    # which kind. Domain terms outscore it whenever they are present.
    "ADVOCATE_REQUIRED": _Lexicon(
        medium=_w(
            "lawyer; advocate; attorney; vakil; legal counsel; legal advice; legal help; "
            "legal action; legal notice; legal options; legal remedy; legal remedies; "
            "legal rights; legal dispute; legal proceedings; legal trouble; legal case; "
            "court case; lawsuit; litigation; sue; suing; sued; file a case; rti; "
            "right to information; legal; legally; law; laws; illegal; unlawful; "
            "limitation period; "
            "civil suit; recovery suit; legal aid; free lawyer; nalsa;"
        ),
        weak=_w(
            "court; case; judge; judgment; judgement; rights; petition; claim; compensation; "
            "remedy; tribunal; notice; hearing; accident; dispute;"
        ),
    ),
}

# Every in-scope category must have a lexicon and a priority slot.
assert set(_LEXICONS) == set(_PRIORITY) == set(LEGAL_CATEGORIES) - {"OUT_OF_SCOPE"}

_CATEGORY_PATTERNS: dict[str, tuple[tuple[re.Pattern[str], int], ...]] = {
    category: lexicon.compiled() for category, lexicon in _LEXICONS.items()
}

# ---------------------------------------------------------------------------
# Risk cues
# ---------------------------------------------------------------------------

# The user (or someone they speak for) is facing arrest, prosecution or an
# enforcement action. Complainant-side phrasing ("file an FIR") is HIGH, not
# CRITICAL, so the bare word "FIR" is deliberately not listed.
_CRITICAL_CUES = _compile_all(
    _w(
        "arrest*; warrant; non-bailable; non bailable; summons; summoned; raid; raided; jail; "
        "jailed; prison; lockup; lock-up; detained; police custody; judicial custody; "
        "in custody; chargesheet; charge sheet; bail; anticipatory bail; quash*; giraftar; "
        "re:fir (?:has been|have been|was|is being|got|against|filed against|"
        "registered against|lodged against|under); "
        "re:(?:false|fake|bogus|another|second) fir; police case; re:police complaint against; "
        "re:police (?:have|has|are|is|came|called|summoned|picked|raided|detained|issued|visited); "
        "re:(?:case|complaint|fir|petition|suit|lawsuit|claim) (?:has been |was |is )?"
        "(?:filed |registered |lodged )?against (?:me|us|my|our); "
        "re:(?:sued|suing) (?:me|us); re:sue (?:me|us); re:accused of; re:charged with; "
        "re:charges against; court order against; "
        "re:court (?:has )?(?:ordered|directed) (?:me|us|my|our); court notice; contempt; "
        "ex parte; re:decree against; "
        r"re:(?:property|account|accounts|bank account)\s+"
        r"(?:has been |have been |was |is )?(?:attached|frozen|seized); "
        "re:(?:attached|froze|frozen|freeze|seized) my; enforcement directorate; ed notice; "
        "cbi; look out circular; search and seizure; search warrant; sentenced; convicted; "
        "conviction; re:(?:case|matter|suit|petition|appeal) (?:is |was )?pending; "
        r"pending case; re:pending (?:in|before) (?:the )?(?:\w+ )?(?:court|tribunal); "
        "next hearing; hearing date; thane bulaya; thana bulaya; police bulaya;"
    )
)

# A concrete dispute or harm that is already happening.
_HIGH_CUES = _compile_all(
    _w(
        r"re:(?:not|never|\w+n't)\s+(?:yet\s+|been\s+|even\s+|willing to\s+|ready to\s+|"
        r"going to\s+|able to\s+)*(?:paid|pay|paying|returned|return|returning|refunded|refund|"
        r"refunding|given|give|giving|released|release|releasing|delivered|delivering|deliver|"
        r"responding|responded|respond|answering|settled|clear|cleared|credited|honou?red|"
        r"issued|issuing|received|handed|handing|vacate|vacating|vacated|replying|replied|"
        r"transferred|transfer|transferring|registered|register|signed|sign|accepted|accept|"
        r"complied|comply|performed|perform|fulfilled|fulfil|repaired|repair|replaced|replace); "
        "nahi diya; nahin diya; nahi de raha; nahi mila; nahi dete; unpaid; non-payment; "
        "nonpayment; withheld; withholding; overdue; outstanding dues; dues; owed; owe; owes; "
        "defaulted; pending salary; pending payment; pending dues; refus*; denied; denying; "
        "rejected; rejection; cheat*; fraud*; defraud*; scam*; conned; duped; swindle*; "
        "misappropriat*; embezzl*; forged; forgery; fake; dhokha; dhokhadhadi; evict*; vacate; "
        "kick out; kicked out; thrown out; locked me out; dispossess*; encroach*; grabbed; "
        "illegally occupied; trespass*; "
        r"re:(?:built|constructed|dug|occupied|occupying|encroaching) (?:\w+ ){0,3}"
        r"(?:on|in|over|into) my (?:land|plot|property|house|flat); "
        " terminated; fired; dismissed; sacked; laid off; "
        "retrenched; re:terminat(?:e|ing) (?:me|my|us|our); "
        "re:(?:asked|forced|pressured|told) (?:me )?to resign; wrongful termination; "
        r"re:(?:received|got|receive|served with|served|sent me|sent us|issued me)\s+"
        r"(?:a\s+|an\s+|the\s+|this\s+)?(?:\w+\s+){0,2}notice; "
        r"re:(?:legal|demand|show cause|show-cause)\s+notice\s+"
        r"(?:from|against|to me|has been|was|received); "
        "show cause notice; show-cause notice; re:notice (?:from|against|served); threat*; "
        "blackmail*; extort*; harass*; stalk*; abus*; assault*; beaten; beat me; violence; "
        "violent; molest*; intimidat*; bully*; dhamki; hack*; phished; phishing; leaked; "
        "morphed; hijack*; stolen; theft; robbed; "
        "re:money (?:was |has been )?(?:debited|deducted|lost|stolen|withdrawn); "
        "re:unauthori[sz]ed (?:transaction|debit|access|withdrawal); debited without; "
        "defective; faulty; damaged; re:(?:not|stopped) working; poor service; deficiency; "
        "overcharg*; re:(?:above|over|more than|higher than|beyond) (?:the )?mrp; "
        "misled; misrepresent*; counterfeit; delayed; re:delay in; dispute; "
        "takedown; blocking order; account suspended; account blocked; account banned; "
        "disputed; illegal; illegally; unlawful; unlawfully; unfair; wrongful; wrongfully; "
        "violat*; breached; breaches; breaching; breach; infring*; plagiari*; pirated; "
        "re:(?:copied|stole|stolen) my; bounce; bounced; dishonou?red; false case; "
        "false complaint; false allegation; defam*; slander; libel; divorce notice; "
        "dowry demand; dowry harassment; domestic violence; deserted; abandoned; no response; "
        "not responding; ignoring; ignored; absconded; absconding; bribe; bribery; corruption; "
        "deducted; deduct;"
    )
)

# Guidance on something the user is about to do, or on drafting.
_DRAFTING_CUES = _compile_all(
    _w(
        "draft*; template; proforma; pro forma; specimen; sample; re:format (?:of|for); "
        "re:(?:legal|notice|affidavit|agreement|letter|document|contract|deed) format; "
        "how to write; re:how (?:do|can|should) (?:i|we) write; "
        r"re:should (?:\w+ ){0,5}include; "
        "must include; what to include; "
        r"re:(?:write|prepare|create|make|generate|need|want)\s+(?:a|an|my|the)\s+"
        r"(?:\w+\s+){0,2}(?:letter|notice|agreement|affidavit|declaration|contract|deed|nda|"
        r"mou|authori[sz]ation|will);"
    )
)

_MEDIUM_CUES = _compile_all(
    _w(
        "re:how (?:to|do i|can i|should i|do we|can we|should we); procedure; "
        "re:process (?:for|of|to); steps; checklist; re:what should; re:should (?:i )?include; "
        "must include; documents required; required documents; documents needed; eligib*; "
        "re:(?:i|we) (?:want|need|plan|intend|wish) to; planning; re:plan to; re:going to; "
        "about to; before signing; before i sign; before buying; before renting; "
        "re:thinking (?:of|about); apply for; "
        "re:(?:file|filing|lodge|lodging|register|registering) (?:a|an|my|the); "
        "re:can (?:i|we); am i allowed;"
    )
)

# "What is ...?" style framing. Only counts as a *general* question when the
# message never talks about the user's own situation (see _PERSONAL).
_GENERAL_FRAMING = re.compile(
    r"^(?:(?:please|pls|kindly|hi|hello|hey)[\s,]+)*"
    r"(?:(?:can|could|will|would)\s+you\s+(?:please\s+)?(?:tell\s+me\s+)?)?"
    r"(?:what(?:'s|\s+(?:is|are|was|were|does|do|did))|who\s+(?:is|are|was)|"
    r"which\s+(?:is|are)|define|explain|meaning of|tell me about|describe|overview of|"
    r"difference between|full form of|how\s+(?:does|do|is|are)|why\s+(?:is|are|does|do)|"
    r"is\s+(?:it|this|that)\s+(?:legal|illegal|allowed|mandatory|compulsory|valid|"
    r"necessary|required))\b"
)

# "tell me about X" / "show me" address the assistant; they say nothing about
# the user's own situation.
_ADDRESSEE = re.compile(r"(?<![a-z0-9])(?:tell|show|give|teach|help|let|get|send)\s+me(?![a-z0-9])")

_PERSONAL = re.compile(
    r"(?<![a-z0-9])(?:i|i'm|im|i've|ive|i'd|i'll|me|my|mine|myself|we|we're|we've|our|ours|"
    r"mera|meri|mere|mujhe|hamara|hamare|humara|humare)(?![a-z0-9'])"
)

# ---------------------------------------------------------------------------
# Greetings and out-of-scope detection
# ---------------------------------------------------------------------------

_GREETING = re.compile(
    r"^\s*(?:(?:hi+|hello+|hey+|hola|namaste|namaskar|good\s+(?:morning|afternoon|evening)|"
    r"greetings|thanks|thank\s+you|ok(?:ay)?|test(?:ing)?|bye|goodbye)\b[\s,.!?\-]*)*"
    r"(?:(?:so\s+)?(?:what|how)\s+(?:can|do)\s+you\s+(?:do|help)(?:\s+me)?(?:\s+with)?|"
    r"who\s+are\s+you|what\s+are\s+you|what\s+do\s+you\s+do|can\s+you\s+help(?:\s+me)?|"
    r"help(?:\s+me)?|what\s+can\s+i\s+ask(?:\s+you)?|how\s+does\s+this\s+work|"
    r"what\s+is\s+this|tell\s+me\s+about\s+yourself|introduce\s+yourself)?"
    r"[\s,.!?]*$"
)
# A question about the assistant itself, possibly wrapped in more words.
_CAPABILITY = re.compile(
    r"(?:what|how)\s+(?:can|do)\s+you\s+(?:do|help)|who\s+are\s+you|what\s+do\s+you\s+do|"
    r"what\s+can\s+i\s+ask"
)

_OFF_TOPIC = _compile_all(
    _w(
        "python; javascript; typescript; java; c++; html; css; sql query; "
        r"re:write (?:me )?(?:a |an |some )?(?:\w+ )?(?:function|script|program|code|class|query); "
        "code snippet; debug*; algorithm; leetcode; react component; bug in my code; regex; "
        "compile error; stack trace; recipe; ingredients; how to cook; biryani; bake; baking; "
        "cake; weather; forecast; temperature; will it rain; cricket score; ipl; match score; "
        "live score; who won the; football; fifa; premier league; world cup; movie; movies; "
        "web series; bollywood; song lyrics; lyrics; netflix; box office; joke; poem; riddle; "
        "math*; maths homework; homework; equation; integral; derivative; algebra; calculus; "
        "square root; quadratic; solve for; stock price; share price; bitcoin price; "
        "which stock; diet plan; workout; symptoms; horoscope; astrology; travel itinerary; "
        "hotel recommendation; stock market; mutual fund; buy shares; which shares; "
        "investment tips; job interview; interview tips; resume tips; places to visit; "
        r"tourist places; travel tips; re:convert \d; translate;"
    )
)

# ---------------------------------------------------------------------------
# Jurisdiction cues
# ---------------------------------------------------------------------------

_STAMP_DUTY_CUES = _compile_all(
    _w("stamp duty; stamp paper; e-stamp; estamp; stamping; stamp act;")
)
_REGISTRATION_CUES = _compile_all(
    _w(
        "sub-registrar; registrar office; registrar's office; registration charges; "
        "registration fee; "
        r"re:regist(?:er|ered|ering|ration)\s+(?:of\s+)?(?:the\s+|my\s+|a\s+|an\s+)?"
        r"(?:\w+\s+){0,2}(?:property|sale deed|rent agreement|rental agreement|lease|gift deed|"
        r"agreement|deed|will|flat|plot|house|land); "
        r"re:(?:property|sale deed|document|deed|agreement|lease|land|flat)\s+registration;"
    )
)
_COURT_CUES = _compile_all(
    _w(
        "court; tribunal; forum; jurisdiction; magistrate; judge; hearing; summons; writ; "
        "petition; appeal*; lok adalat; nclt; nclat; itat; lawsuit; litigation; injunction; "
        "decree;"
    )
)
_STATE_CUES = _compile_all(
    (
        *_w(
            "rent control; rent act; state government; state law; state-specific; panchayat; "
            "municipal*; gram sabha; revenue department; "
        ),
        *(name.lower() for name in ALL_STATE_NAMES.values()),
        *_w("orissa; pondicherry; uttaranchal; new delhi; jammu and kashmir;"),
        # Large cities: the answer then depends on that city's state.
        *_w(
            "mumbai; pune; nagpur; bengaluru; bangalore; mysuru; chennai; coimbatore; "
            "madurai; hyderabad; secunderabad; visakhapatnam; vizag; vijayawada; kolkata; "
            "howrah; ahmedabad; surat; vadodara; rajkot; jaipur; jodhpur; udaipur; "
            "lucknow; kanpur; noida; ghaziabad; agra; varanasi; gurgaon; gurugram; "
            "faridabad; bhopal; indore; patna; ranchi; kochi; cochin; thiruvananthapuram; "
            "trivandrum; kozhikode; bhubaneswar; guwahati; dehradun; shimla; srinagar; "
            "panaji; raipur; ludhiana; amritsar;"
        ),
    )
)

# Largely central-law subjects default to CENTRAL; land and tenancy are state
# subjects; the rest depend on what the user turns out to be asking.
_DEFAULT_SCOPE: dict[str, str] = {
    "EMPLOYMENT_LAW": "CENTRAL",
    "CONSUMER_LAW": "CENTRAL",
    "CYBER_LAW": "CENTRAL",
    "DATA_PROTECTION": "CENTRAL",
    "IP_LAW": "CENTRAL",
    "TAX_LAW": "CENTRAL",
    "FAMILY_LAW": "CENTRAL",
    "CRIMINAL_LAW": "CENTRAL",
    "CORPORATE_LAW": "CENTRAL",
    "CONTRACT_LAW": "CENTRAL",
    "IT_LAW": "CENTRAL",
    "PROPERTY_LAW": "STATE",
    "DOCUMENT_GUIDANCE": "UNKNOWN",
    "ADVOCATE_REQUIRED": "UNKNOWN",
}

_REGISTRATION_CATEGORIES = frozenset({"PROPERTY_LAW", "CONTRACT_LAW", "DOCUMENT_GUIDANCE"})

# ---------------------------------------------------------------------------
# Classification
# ---------------------------------------------------------------------------

_QUOTES = str.maketrans({0x2018: "'", 0x2019: "'", 0x201B: "'", 0x2032: "'", 0x60: "'"})


def _normalise(message: str) -> str:
    text = unicodedata.normalize("NFKC", message).translate(_QUOTES).casefold()
    return re.sub(r"\s+", " ", text).strip()


def _any(patterns: tuple[re.Pattern[str], ...], text: str) -> bool:
    return any(p.search(text) for p in patterns)


def _score_categories(text: str) -> dict[str, int]:
    scores = {
        category: sum(weight for pattern, weight in patterns if pattern.search(text))
        for category, patterns in _CATEGORY_PATTERNS.items()
    }
    # Generic legal vocabulary says "this is legal" but never outranks a
    # message that names an actual subject.
    scores[_FALLBACK_CATEGORY] = min(scores[_FALLBACK_CATEGORY], _GENERIC_SCORE_CAP)
    return scores


def _best_category(scores: dict[str, int]) -> tuple[str, int]:
    best = max(_PRIORITY, key=lambda c: (scores[c], -_PRIORITY.index(c)))
    return best, scores[best]


def _jurisdiction(text: str, category: str) -> str:
    if _any(_STAMP_DUTY_CUES, text):
        return "STAMP_DUTY"
    if category in _REGISTRATION_CATEGORIES and _any(_REGISTRATION_CUES, text):
        return "REGISTRATION_AUTHORITY"
    if _any(_COURT_CUES, text):
        return "COURT"
    if _any(_STATE_CUES, text):
        return "STATE"
    return _DEFAULT_SCOPE.get(category, "UNKNOWN")


def _risk(text: str, *, personal: bool, general_only: bool, drafting: bool) -> str:
    """Highest level whose cues appear, unless the message is a general
    question that never mentions the user's own situation."""
    if general_only:
        return "LOW"
    if _any(_CRITICAL_CUES, text):
        return "CRITICAL"
    if _any(_HIGH_CUES, text):
        return "HIGH"
    if drafting or _any(_MEDIUM_CUES, text):
        return "MEDIUM"
    return "MEDIUM" if personal else "LOW"


def _result(category: str, scope: str, risk: str, *, out_of_scope: bool = False) -> Classification:
    # Defensive: the vocabularies above are the single source of truth, but a
    # typo must never leak an invalid value to callers.
    assert category in LEGAL_CATEGORIES and scope in JURISDICTION_SCOPES and risk in RISK_LEVELS
    return Classification(
        category=category, jurisdiction_scope=scope, risk_level=risk, is_out_of_scope=out_of_scope
    )


_NEUTRAL_RESULT = _result(_NEUTRAL_CATEGORY, "UNKNOWN", "LOW")


def _is_personal(text: str) -> bool:
    """Does the message talk about the user's own situation? Requests such as
    "tell me about..." address the assistant and do not count."""
    return bool(_PERSONAL.search(_ADDRESSEE.sub(" ", text)))


def is_smalltalk(message: str) -> bool:
    """A greeting, a thank-you, or a question about what the assistant can do
    (as opposed to a legal question). Offline chat answers these with a
    welcome instead of searching the library for the word "hello"."""
    text = _normalise(message)
    if not text or _GREETING.match(text):
        return True
    if not _CAPABILITY.search(text):
        return False
    _, best_score = _best_category(_score_categories(text))
    return not (_any(_CRITICAL_CUES, text) or _any(_HIGH_CUES, text)) and best_score < _STRONG


def classify(message: str) -> Classification:
    """Classify ``message`` by vocabulary alone. Pure and deterministic."""
    text = _normalise(message)
    if not text or _GREETING.match(text):
        return _NEUTRAL_RESULT

    scores = _score_categories(text)
    best, best_score = _best_category(scores)
    personal = _is_personal(text)
    # A general question that never mentions the user's own situation.
    general_only = bool(_GENERAL_FRAMING.match(text)) and not personal
    drafting = _any(_DRAFTING_CUES, text)
    critical = _any(_CRITICAL_CUES, text)
    high = _any(_HIGH_CUES, text)

    # "What can you do for legal matters?" is a question about the assistant.
    if _CAPABILITY.search(text) and not (critical or high) and best_score < _STRONG:
        return _NEUTRAL_RESULT

    category = best if best_score >= _MIN_CATEGORY_SCORE else None

    if category is None and not critical:
        # No topic and no enforcement cue. Plainly non-legal text is out of
        # scope even if it trips a dispute word ("my script ignored the file").
        if _any(_OFF_TOPIC, text):
            return _result("OUT_OF_SCOPE", "UNKNOWN", "LOW", out_of_scope=True)
        if not high and scores[_FALLBACK_CATEGORY] == 0:
            # Nothing legal and nothing clearly off-topic: let retrieval try.
            return _NEUTRAL_RESULT

    risk = _risk(text, personal=personal, general_only=general_only, drafting=drafting)

    if drafting and risk in ("LOW", "MEDIUM"):
        # Asking for a draft, template or format: document guidance.
        category = _NEUTRAL_CATEGORY
    elif category is None or category == _FALLBACK_CATEGORY:
        # Legal words but no recognisable topic.
        if general_only:
            category = _NEUTRAL_CATEGORY
        else:
            # Fail toward recommending an advocate rather than away from one.
            category = _FALLBACK_CATEGORY
            risk = "CRITICAL" if risk == "CRITICAL" else "HIGH"

    return _result(category, _jurisdiction(text, category), risk)
