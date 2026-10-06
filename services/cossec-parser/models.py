"""
CERNIQ COSSEC Parser — Pydantic Models

Structured representations of COSSEC examination report findings.
COSSEC (Corporacion Publica para la Supervision y Seguro de Cooperativas de
Puerto Rico) issues regulatory examination reports in Spanish.

All field names use camelCase to match the NestJS backend contract.
"""

from __future__ import annotations

from enum import Enum
from pydantic import BaseModel, Field


class FindingCategory(str, Enum):
    """
    Standard COSSEC finding categories aligned with CAMEL+S framework.
    CAMEL = Capital, Asset quality, Management, Earnings, Liquidity + Sensitivity.
    """

    CAPITAL = "Capital"
    ASSET_QUALITY = "Calidad de Activos"
    MANAGEMENT = "Gerencia"
    EARNINGS = "Ingresos"
    LIQUIDITY = "Liquidez"
    SENSITIVITY = "Sensibilidad"
    CREDIT = "Credito"
    OPERATIONS = "Operaciones"
    COMPLIANCE = "Cumplimiento"
    GOVERNANCE = "Gobernanza"
    UNKNOWN = "Sin Clasificar"


class FindingSeverity(str, Enum):
    """
    Severity levels derived from COSSEC examination language.
    Mapped from Spanish regulatory phrasing.
    """

    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFO = "info"


class CossecFinding(BaseModel):
    """A single finding extracted from a COSSEC examination report."""

    findingNumber: str = Field(
        ...,
        description="Finding identifier, e.g. 'Hallazgo N°1' or 'H-1'",
    )
    category: str = Field(
        default=FindingCategory.UNKNOWN.value,
        description="CAMEL+S category classification",
    )
    description: str = Field(
        ...,
        description="Full finding description text (Spanish)",
    )
    severity: str = Field(
        default=FindingSeverity.MEDIUM.value,
        description="Assessed severity: critical | high | medium | low | info",
    )
    pageNumber: int = Field(
        ...,
        ge=1,
        description="1-indexed page where the finding was extracted",
    )
    rawText: str = Field(
        ...,
        description="Unprocessed text block from the PDF",
    )
    confidence: float = Field(
        default=0.5,
        ge=0.0,
        le=1.0,
        description="Extraction confidence score (0.0 - 1.0)",
    )


class ParseResult(BaseModel):
    """Complete parse result returned to the NestJS backend."""

    findings: list[CossecFinding] = Field(default_factory=list)
    totalPages: int = Field(..., ge=0, description="Total pages in the PDF")
    parsedAt: str = Field(
        ...,
        description="ISO 8601 timestamp of parse execution",
    )
    sourceHash: str = Field(
        ...,
        description="SHA-256 hash of the uploaded PDF for deduplication",
    )
