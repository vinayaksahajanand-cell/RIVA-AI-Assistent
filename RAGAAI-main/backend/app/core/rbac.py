"""Role-based access control: roles, permissions and document clearance levels.

Roles (per workspace):
  admin    — full control: users, security settings, all documents (up to *restricted*), audit log
  manager  — manages documents (up to *confidential*), analytics and evaluation
  user     — chat portal only; sees answers grounded in documents within their clearance (default *internal*)

Every document has a classification. Retrieval filters chunks by the caller's clearance inside the
SQL query, so content above a user's clearance never reaches the LLM, the prompt or the response.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Literal

Role = Literal["admin", "manager", "user"]
Classification = Literal["public", "internal", "confidential", "restricted"]

ROLES: tuple[str, ...] = ("admin", "manager", "user")
CLASSIFICATIONS: tuple[str, ...] = ("public", "internal", "confidential", "restricted")  # ascending sensitivity


class Permission(StrEnum):
    CHAT = "chat"
    DOCUMENTS_VIEW = "documents.view"  # list accessible documents (metadata only)
    DOCUMENTS_READ_CONTENT = "documents.read_content"  # chunk previews
    DOCUMENTS_DOWNLOAD = "documents.download"  # original files
    DOCUMENTS_MANAGE = "documents.manage"  # upload, re-index, delete, classify, collections
    USERS_MANAGE = "users.manage"
    SETTINGS_MANAGE = "settings.manage"
    ANALYTICS_VIEW = "analytics.view"
    EVALUATION_VIEW = "evaluation.view"
    EVALUATION_RUN = "evaluation.run"
    DIAGNOSTICS_VIEW = "diagnostics.view"  # retrieved sources + RAGAS panels under answers
    AUDIT_VIEW = "audit.view"
    PII_VIEW = "pii.view"  # see un-redacted personal data / secrets in answers
    ADMIN_PORTAL = "admin_portal"


ROLE_PERMISSIONS: dict[str, frozenset[Permission]] = {
    "admin": frozenset(Permission),
    "manager": frozenset({
        Permission.CHAT, Permission.DOCUMENTS_VIEW, Permission.DOCUMENTS_READ_CONTENT, Permission.DOCUMENTS_DOWNLOAD,
        Permission.DOCUMENTS_MANAGE, Permission.ANALYTICS_VIEW, Permission.EVALUATION_VIEW, Permission.EVALUATION_RUN,
        Permission.DIAGNOSTICS_VIEW, Permission.ADMIN_PORTAL,
    }),
    "user": frozenset({Permission.CHAT, Permission.DOCUMENTS_VIEW}),
}

DEFAULT_CLEARANCE: dict[str, str] = {"admin": "restricted", "manager": "confidential", "user": "internal"}

_LEGACY_ROLES = {"owner": "admin", "editor": "manager", "viewer": "user", "member": "user"}


def normalize_role(role: str | None) -> str:
    role = (role or "user").lower()
    role = _LEGACY_ROLES.get(role, role)
    return role if role in ROLES else "user"


def permissions_for(role: str) -> frozenset[Permission]:
    return ROLE_PERMISSIONS[normalize_role(role)]


def classification_rank(classification: str) -> int:
    return CLASSIFICATIONS.index(classification) if classification in CLASSIFICATIONS else len(CLASSIFICATIONS)


def clearance_for(role: str, overrides: dict[str, str] | None = None) -> str:
    role = normalize_role(role)
    if role == "admin":
        return "restricted"  # admins can always see everything in their workspace
    level = (overrides or {}).get(role) or DEFAULT_CLEARANCE[role]
    return level if level in CLASSIFICATIONS else DEFAULT_CLEARANCE[role]


def allowed_classifications(clearance: str) -> list[str]:
    """All classifications at or below a clearance level."""
    return list(CLASSIFICATIONS[: classification_rank(clearance) + 1])


def can_access(clearance: str, classification: str) -> bool:
    return classification_rank(classification) <= classification_rank(clearance)
