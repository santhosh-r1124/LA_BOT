"""ORM models.

Import every model module here so that ``Base.metadata`` is complete for
Alembic autogenerate (see ``migrations/env.py``).
"""

from __future__ import annotations

from app.db.base import Base
from app.models.audit import AuditEvent
from app.models.chat import ChatMessage, Conversation, MessageRole
from app.models.consultation import (
    Consultation,
    ConsultationMode,
    ConsultationPaymentStatus,
    ConsultationStatus,
)
from app.models.document_request import AssistantDocumentType, DocumentRequest
from app.models.legal_document import DocumentType, IngestionStatus, LegalChunk, LegalDocument
from app.models.legal_source_catalog import CatalogEntryStatus, LegalSourceCatalogEntry
from app.models.notification import Notification, NotificationKind
from app.models.payment import Payment, PaymentStatus
from app.models.user import (
    AdvocateProfile,
    EmailVerificationToken,
    PasswordResetToken,
    RefreshToken,
    User,
    UserRole,
    VerificationStatus,
)

__all__ = [
    "AdvocateProfile",
    "AssistantDocumentType",
    "AuditEvent",
    "Base",
    "CatalogEntryStatus",
    "ChatMessage",
    "Consultation",
    "ConsultationMode",
    "ConsultationPaymentStatus",
    "ConsultationStatus",
    "Conversation",
    "DocumentRequest",
    "DocumentType",
    "EmailVerificationToken",
    "IngestionStatus",
    "LegalChunk",
    "LegalDocument",
    "LegalSourceCatalogEntry",
    "MessageRole",
    "Notification",
    "NotificationKind",
    "PasswordResetToken",
    "Payment",
    "PaymentStatus",
    "RefreshToken",
    "User",
    "UserRole",
    "VerificationStatus",
]
