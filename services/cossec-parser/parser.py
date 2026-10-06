"""
CERNIQ COSSEC Parser — Core Extraction Logic

Extracts structured findings from COSSEC examination report PDFs.
COSSEC reports are written in Spanish and follow semi-standardized
patterns for presenting regulatory findings (hallazgos).

SCAFFOLD NOTE: Regex patterns are based on common COSSEC report
formatting. Production tuning will be required as real report
samples are integrated.
"""

from __future__ import annotations

import hashlib
import logging
import re
from datetime import datetime, timezone
from typing import Optional

import fitz  # PyMuPDF

from models import (
    CossecFinding,
    FindingCategory,
    FindingSeverity,
    ParseResult,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Spanish regex patterns for COSSEC finding headers
# ---------------------------------------------------------------------------
# Pattern variants observed in COSSEC examination reports:
#   "Hallazgo N°1", "Hallazgo No. 1", "Hallazgo #1", "HALLAZGO 1"
#   "Hallazgo Num. 1", "Hallazgo Número 1"
FINDING_HEADER_PATTERN = re.compile(
    r"(?P<header>"
    r"[Hh][Aa][Ll][Ll][Aa][Zz][Gg][Oo]"  # "Hallazgo" case-insensitive
    r"\s*"
    r"(?:N[°o]\.?|No\.?|#|[Nn][Uu][Mm](?:[eé]ro)?\.?)"  # Number prefix variants
    r"\s*"
    r"(?P<number>\d{1,3})"
    r")",
    re.UNICODE,
)

# Simpler fallback: "HALLAZGO 1" without prefix
FINDING_HEADER_SIMPLE = re.compile(
    r"(?P<header>HALLAZGO\s+(?P<number>\d{1,3}))",
    re.IGNORECASE | re.UNICODE,
)

# ---------------------------------------------------------------------------
# Category classification keywords (Spanish)
# ---------------------------------------------------------------------------
CATEGORY_KEYWORDS: dict[FindingCategory, list[str]] = {
    FindingCategory.CAPITAL: [
        "capital", "patrimonio", "reserva", "solvencia",
        "capital neto", "razon de capital",
    ],
    FindingCategory.ASSET_QUALITY: [
        "activo", "cartera", "morosidad", "provision",
        "calidad de activos", "prestamos morosos",
    ],
    FindingCategory.MANAGEMENT: [
        "gerencia", "administracion", "junta", "directiva",
        "gobierno corporativo", "politica",
    ],
    FindingCategory.EARNINGS: [
        "ingreso", "ganancia", "perdida", "rentabilidad",
        "margen", "resultado operacional",
    ],
    FindingCategory.LIQUIDITY: [
        "liquidez", "flujo de efectivo", "fondos disponibles",
        "razon de liquidez", "activos liquidos",
    ],
    FindingCategory.SENSITIVITY: [
        "sensibilidad", "riesgo de mercado", "tasa de interes",
        "riesgo cambiario",
    ],
    FindingCategory.CREDIT: [
        "credito", "prestamo", "linea de credito",
        "riesgo crediticio", "evaluacion de credito",
    ],
    FindingCategory.OPERATIONS: [
        "operacion", "operacional", "proceso", "control interno",
        "tecnologia", "sistema", "fraude",
    ],
    FindingCategory.COMPLIANCE: [
        "cumplimiento", "regulacion", "ley", "reglamento",
        "normativa", "antilavado", "bsa", "ofac",
    ],
    FindingCategory.GOVERNANCE: [
        "gobernanza", "junta de directores", "comite de auditoria",
        "etica", "conflicto de interes",
    ],
}

# ---------------------------------------------------------------------------
# Severity mapping from COSSEC regulatory language (Spanish)
# ---------------------------------------------------------------------------
SEVERITY_PHRASES: dict[FindingSeverity, list[str]] = {
    FindingSeverity.CRITICAL: [
        "deficiencia critica", "incumplimiento grave",
        "riesgo inminente", "peligro inmediato",
        "orden de cese y desista", "intervencion",
        "amenaza a la solvencia",
    ],
    FindingSeverity.HIGH: [
        "deficiencia significativa", "incumplimiento reiterado",
        "debilidad material", "riesgo alto",
        "accion correctiva inmediata", "requiere atencion urgente",
    ],
    FindingSeverity.MEDIUM: [
        "deficiencia", "incumplimiento", "debilidad",
        "requiere atencion", "riesgo moderado",
        "recomendacion", "debe mejorar",
    ],
    FindingSeverity.LOW: [
        "observacion", "oportunidad de mejora",
        "sugerencia", "area de mejora",
        "mejora recomendada",
    ],
    FindingSeverity.INFO: [
        "nota", "informativo", "comentario",
        "para conocimiento", "referencia",
    ],
}


def _normalize_text(text: str) -> str:
    """Normalize Spanish text for keyword matching (lowercase, strip accents for matching)."""
    text = text.lower()
    # Basic accent normalization for matching purposes
    replacements = {
        "á": "a", "é": "e", "í": "i", "ó": "o", "ú": "u",
        "ñ": "n", "ü": "u",
    }
    for accented, plain in replacements.items():
        text = text.replace(accented, plain)
    return text


def classify_category(text: str) -> str:
    """
    Classify a finding into a CAMEL+S category based on keyword matching.
    Returns the category with the highest keyword match count.
    """
    normalized = _normalize_text(text)
    scores: dict[FindingCategory, int] = {}

    for category, keywords in CATEGORY_KEYWORDS.items():
        score = sum(1 for kw in keywords if kw in normalized)
        if score > 0:
            scores[category] = score

    if not scores:
        return FindingCategory.UNKNOWN.value

    best = max(scores, key=lambda k: scores[k])
    return best.value


def classify_severity(text: str) -> str:
    """
    Classify severity from COSSEC regulatory language.
    Checks phrases from most severe to least severe, returns first match.
    """
    normalized = _normalize_text(text)

    # Check from most to least severe
    severity_order = [
        FindingSeverity.CRITICAL,
        FindingSeverity.HIGH,
        FindingSeverity.MEDIUM,
        FindingSeverity.LOW,
        FindingSeverity.INFO,
    ]

    for severity in severity_order:
        phrases = SEVERITY_PHRASES[severity]
        for phrase in phrases:
            if _normalize_text(phrase) in normalized:
                return severity.value

    return FindingSeverity.MEDIUM.value


def _compute_confidence(text: str, had_header_match: bool) -> float:
    """
    Compute extraction confidence based on signal strength.
    Higher confidence when the finding has a clear header and substantive text.
    """
    score = 0.3  # baseline

    if had_header_match:
        score += 0.3

    word_count = len(text.split())
    if word_count > 20:
        score += 0.1
    if word_count > 50:
        score += 0.1

    # Presence of regulatory keywords boosts confidence
    normalized = _normalize_text(text)
    regulatory_signals = [
        "hallazgo", "deficiencia", "incumplimiento", "recomendacion",
        "accion correctiva", "ley", "reglamento", "cossec",
    ]
    signal_count = sum(1 for s in regulatory_signals if s in normalized)
    score += min(signal_count * 0.05, 0.2)

    return min(round(score, 2), 1.0)


def _extract_page_text(doc: fitz.Document) -> list[tuple[int, str]]:
    """Extract text from each page. Returns list of (1-indexed page number, text)."""
    pages: list[tuple[int, str]] = []
    for page_num in range(len(doc)):
        page = doc[page_num]
        text = page.get_text("text")
        if text and text.strip():
            pages.append((page_num + 1, text))
    return pages


def _split_findings_from_pages(
    pages: list[tuple[int, str]],
) -> list[dict]:
    """
    Split page text into individual finding blocks using header patterns.
    Returns list of dicts with keys: number, page, text, had_header.
    """
    findings_raw: list[dict] = []

    # Concatenate all pages with page markers for later attribution
    full_text_parts: list[tuple[int, str]] = []
    for page_num, text in pages:
        full_text_parts.append((page_num, text))

    # Try primary pattern first, fall back to simple pattern
    for page_num, page_text in full_text_parts:
        for pattern in [FINDING_HEADER_PATTERN, FINDING_HEADER_SIMPLE]:
            for match in pattern.finditer(page_text):
                finding_number = match.group("number")
                start = match.start()

                # Extract text from header to next header or end of page
                next_match = pattern.search(page_text, match.end())
                end = next_match.start() if next_match else len(page_text)
                block_text = page_text[start:end].strip()

                # Avoid duplicates (same finding number already captured)
                existing_numbers = {f["number"] for f in findings_raw}
                if finding_number not in existing_numbers:
                    findings_raw.append({
                        "number": finding_number,
                        "page": page_num,
                        "text": block_text,
                        "had_header": True,
                    })

    return findings_raw


def extract_findings(pdf_bytes: bytes) -> ParseResult:
    """
    Main extraction entry point.
    Accepts raw PDF bytes and returns a structured ParseResult.
    """
    source_hash = hashlib.sha256(pdf_bytes).hexdigest()
    parsed_at = datetime.now(timezone.utc).isoformat()

    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception as exc:
        logger.error("Failed to open PDF: %s", exc)
        return ParseResult(
            findings=[],
            totalPages=0,
            parsedAt=parsed_at,
            sourceHash=source_hash,
        )

    total_pages = len(doc)
    pages = _extract_page_text(doc)
    raw_findings = _split_findings_from_pages(pages)

    findings: list[CossecFinding] = []
    for raw in raw_findings:
        text = raw["text"]
        description = text
        # Trim the header line from description if present
        lines = text.split("\n", 1)
        if len(lines) > 1:
            description = lines[1].strip()

        finding = CossecFinding(
            findingNumber=f"H-{raw['number']}",
            category=classify_category(text),
            description=description,
            severity=classify_severity(text),
            pageNumber=raw["page"],
            rawText=text,
            confidence=_compute_confidence(text, raw["had_header"]),
        )
        findings.append(finding)

    logger.info(
        "Extracted %d findings from %d pages (hash=%s)",
        len(findings),
        total_pages,
        source_hash[:12],
    )

    doc.close()

    return ParseResult(
        findings=findings,
        totalPages=total_pages,
        parsedAt=parsed_at,
        sourceHash=source_hash,
    )
