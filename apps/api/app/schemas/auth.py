"""Authentication request/response schemas."""

from __future__ import annotations

from typing import Literal

from email_validator import EmailNotValidError, validate_email
from pydantic import BaseModel, EmailStr, Field, field_validator

from app.core.config import get_settings

_MIN_PASSWORD_LENGTH = 8


def _login_identifier(value: str) -> str:
    """Lower-cased email. With OPEN_LOGIN any non-empty identifier is
    accepted (a name works too); otherwise it must be a real email address."""
    value = value.strip().lower()
    if not value:
        raise ValueError("Enter an email address.")
    if not get_settings().open_login:
        try:
            validate_email(value, check_deliverability=False)
        except EmailNotValidError as exc:
            raise ValueError("Enter a valid email address.") from exc
    return value


class RegisterRequest(BaseModel):
    email: str = Field(max_length=320)
    password: str = Field(max_length=128)
    display_name: str | None = Field(default=None, max_length=150)
    state_code: str | None = Field(default=None, min_length=2, max_length=2)
    preferred_language: str | None = Field(default=None, max_length=50)

    @field_validator("email")
    @classmethod
    def _email(cls, value: str) -> str:
        return _login_identifier(value)

    @field_validator("password")
    @classmethod
    def _password(cls, value: str) -> str:
        if not get_settings().open_login and len(value) < _MIN_PASSWORD_LENGTH:
            raise ValueError(f"Use at least {_MIN_PASSWORD_LENGTH} characters.")
        return value

    @field_validator("state_code")
    @classmethod
    def _upper_state(cls, value: str | None) -> str | None:
        return value.upper() if value else value


class LoginRequest(BaseModel):
    email: str = Field(max_length=320)
    password: str = Field(max_length=128)

    @field_validator("email")
    @classmethod
    def _email(cls, value: str) -> str:
        return _login_identifier(value)


class RefreshRequest(BaseModel):
    refresh_token: str


class LogoutRequest(BaseModel):
    refresh_token: str


class VerifyEmailRequest(BaseModel):
    token: str


class ResendVerificationRequest(BaseModel):
    email: EmailStr


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str = Field(min_length=8, max_length=128)


class TokenPair(BaseModel):
    """Mirrors ``@legal-platform/auth`` → ``TokenPair`` (field names must match)."""

    access_token: str
    refresh_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int


class MessageResponse(BaseModel):
    message: str
