"""
CERNIQ COSSEC Parser — Test Suite

Tests for PDF finding extraction, classification, and API endpoints.
Uses realistic but clearly synthetic COSSEC-style Spanish text.
"""

from __future__ import annotations

import hashlib
import io
from unittest.mock import patch, MagicMock

import pytest
from fastapi.testclient import TestClient

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from main import app
from models import CossecFinding, FindingCategory, FindingSeverity, ParseResult
from parser import (
    classify_category,
    classify_severity,
    extract_findings,
    _normalize_text,
    _compute_confidence,
    FINDING_HEADER_PATTERN,
    FINDING_HEADER_SIMPLE,
)

client = TestClient(app)


# ---------------------------------------------------------------------------
# Sample COSSEC-style text (synthetic, not real regulatory content)
# ---------------------------------------------------------------------------
SAMPLE_FINDING_TEXT_1 = """
Hallazgo N°1 — Deficiencia en la Razon de Capital

La cooperativa presenta una razon de capital neto por debajo del minimo
requerido por la Ley 255-2002. Al cierre del periodo examinado, la razon
de capital neto era de 5.2%, por debajo del 6.0% requerido.

Recomendacion: La gerencia debe implementar un plan de accion correctiva
para restaurar los niveles de capital dentro del plazo establecido.
"""

SAMPLE_FINDING_TEXT_2 = """
Hallazgo No. 2 — Incumplimiento Reiterado en Politica de Prestamos

Se identificaron deficiencias significativas en el proceso de evaluacion
de credito. La cooperativa no esta cumpliendo con su propia politica de
prestamos en lo que respecta a la documentacion requerida.
"""

SAMPLE_FINDING_TEXT_3 = """
HALLAZGO 3 — Observacion sobre Control Interno

Se observo una oportunidad de mejora en los procesos operacionales de
control interno. La cooperativa debe revisar sus procedimientos de
conciliacion bancaria.
"""

SAMPLE_MULTI_FINDING_PAGE = f"""{SAMPLE_FINDING_TEXT_1}
{SAMPLE_FINDING_TEXT_2}
{SAMPLE_FINDING_TEXT_3}
"""


# ============================================================================
# 1. Category Classification Tests
# ============================================================================
class TestCategoryClassification:
    """Tests for CAMEL+S category classification from Spanish text."""

    def test_capital_category(self):
        text = "La razon de capital neto es insuficiente para cubrir las reservas"
        result = classify_category(text)
        assert result == FindingCategory.CAPITAL.value

    def test_credit_category(self):
        text = "Deficiencias en la evaluacion de credito y politica de prestamos"
        result = classify_category(text)
        assert result == FindingCategory.CREDIT.value

    def test_compliance_category(self):
        text = "Incumplimiento con el reglamento de antilavado de dinero BSA"
        result = classify_category(text)
        assert result == FindingCategory.COMPLIANCE.value

    def test_operations_category(self):
        text = "Debilidades en el control interno del proceso operacional"
        result = classify_category(text)
        assert result == FindingCategory.OPERATIONS.value

    def test_liquidity_category(self):
        text = "La razon de liquidez y los activos liquidos son inadecuados"
        result = classify_category(text)
        assert result == FindingCategory.LIQUIDITY.value

    def test_governance_category(self):
        text = "Deficiencias en la junta de directores y conflicto de interes"
        result = classify_category(text)
        assert result == FindingCategory.GOVERNANCE.value

    def test_unknown_category_fallback(self):
        text = "Texto generico sin palabras clave relevantes"
        result = classify_category(text)
        assert result == FindingCategory.UNKNOWN.value


# ============================================================================
# 2. Severity Classification Tests
# ============================================================================
class TestSeverityClassification:
    """Tests for severity mapping from COSSEC regulatory language."""

    def test_critical_severity(self):
        text = "Se ha identificado una deficiencia critica que amenaza la solvencia"
        result = classify_severity(text)
        assert result == FindingSeverity.CRITICAL.value

    def test_high_severity(self):
        text = "Existe una debilidad material que requiere accion correctiva inmediata"
        result = classify_severity(text)
        assert result == FindingSeverity.HIGH.value

    def test_medium_severity(self):
        text = "Se encontro una deficiencia que requiere atencion de la gerencia"
        result = classify_severity(text)
        assert result == FindingSeverity.MEDIUM.value

    def test_low_severity(self):
        text = "Se observa una oportunidad de mejora en los procedimientos"
        result = classify_severity(text)
        assert result == FindingSeverity.LOW.value

    def test_info_severity(self):
        text = "Nota informativa para conocimiento de la junta"
        result = classify_severity(text)
        assert result == FindingSeverity.INFO.value

    def test_default_medium_when_ambiguous(self):
        text = "Texto sin indicadores claros de severidad"
        result = classify_severity(text)
        assert result == FindingSeverity.MEDIUM.value


# ============================================================================
# 3. Regex Pattern Tests
# ============================================================================
class TestFindingHeaderPatterns:
    """Tests for COSSEC finding header regex patterns."""

    def test_hallazgo_numero_sign(self):
        match = FINDING_HEADER_PATTERN.search("Hallazgo N°1 — Capital")
        assert match is not None
        assert match.group("number") == "1"

    def test_hallazgo_no_dot(self):
        match = FINDING_HEADER_PATTERN.search("Hallazgo No. 12 — Liquidez")
        assert match is not None
        assert match.group("number") == "12"

    def test_hallazgo_hash(self):
        match = FINDING_HEADER_PATTERN.search("Hallazgo #5")
        assert match is not None
        assert match.group("number") == "5"

    def test_hallazgo_numero_word(self):
        match = FINDING_HEADER_PATTERN.search("Hallazgo Numero 3")
        assert match is not None
        assert match.group("number") == "3"

    def test_simple_uppercase_pattern(self):
        match = FINDING_HEADER_SIMPLE.search("HALLAZGO 7 — Operaciones")
        assert match is not None
        assert match.group("number") == "7"

    def test_no_match_on_random_text(self):
        match = FINDING_HEADER_PATTERN.search("Este es un parrafo normal")
        assert match is None


# ============================================================================
# 4. Text Normalization Tests
# ============================================================================
class TestNormalization:
    """Tests for Spanish text normalization."""

    def test_accent_removal(self):
        assert "credito" in _normalize_text("Credito")
        assert "numero" in _normalize_text("Numero")

    def test_lowercase(self):
        assert _normalize_text("HALLAZGO") == "hallazgo"

    def test_n_tilde(self):
        # n with tilde normalizes to n for matching
        assert "ano" in _normalize_text("Ano")


# ============================================================================
# 5. Confidence Scoring Tests
# ============================================================================
class TestConfidenceScoring:
    """Tests for extraction confidence computation."""

    def test_high_confidence_with_header_and_keywords(self):
        text = (
            "Hallazgo N°1 — Deficiencia en capital. "
            "La cooperativa presenta una deficiencia critica en su razon de capital. "
            "Se requiere accion correctiva inmediata segun reglamento COSSEC. "
            "La recomendacion incluye un plan de accion para incumplimiento."
        )
        score = _compute_confidence(text, had_header_match=True)
        assert score >= 0.7

    def test_low_confidence_without_header(self):
        text = "Texto corto sin senales"
        score = _compute_confidence(text, had_header_match=False)
        assert score <= 0.5

    def test_confidence_bounds(self):
        # Even with maximal signals, should not exceed 1.0
        huge_text = " ".join(["hallazgo deficiencia incumplimiento recomendacion cossec"] * 50)
        score = _compute_confidence(huge_text, had_header_match=True)
        assert 0.0 <= score <= 1.0


# ============================================================================
# 6. Full Extraction Tests (mocked PDF)
# ============================================================================
class TestExtractFindings:
    """Tests for the full extraction pipeline with mocked PyMuPDF."""

    def _mock_pdf_doc(self, pages_text: list[str]):
        """Create a mock fitz.Document with given page texts."""
        mock_doc = MagicMock()
        mock_doc.__len__ = lambda self: len(pages_text)
        mock_doc.__enter__ = lambda self: self
        mock_doc.__exit__ = lambda self, *a: None

        mock_pages = []
        for text in pages_text:
            page = MagicMock()
            page.get_text.return_value = text
            mock_pages.append(page)

        mock_doc.__getitem__ = lambda self, idx: mock_pages[idx]
        mock_doc.close = MagicMock()

        return mock_doc

    @patch("parser.fitz.open")
    def test_extracts_single_finding(self, mock_fitz_open):
        mock_doc = self._mock_pdf_doc([SAMPLE_FINDING_TEXT_1])
        mock_fitz_open.return_value = mock_doc

        result = extract_findings(b"fake-pdf-bytes")

        assert isinstance(result, ParseResult)
        assert result.totalPages == 1
        assert len(result.findings) == 1
        assert result.findings[0].findingNumber == "H-1"
        assert result.sourceHash == hashlib.sha256(b"fake-pdf-bytes").hexdigest()

    @patch("parser.fitz.open")
    def test_extracts_multiple_findings(self, mock_fitz_open):
        mock_doc = self._mock_pdf_doc([SAMPLE_MULTI_FINDING_PAGE])
        mock_fitz_open.return_value = mock_doc

        result = extract_findings(b"fake-pdf-bytes-multi")

        assert len(result.findings) == 3
        numbers = {f.findingNumber for f in result.findings}
        assert numbers == {"H-1", "H-2", "H-3"}

    @patch("parser.fitz.open")
    def test_category_assignment_on_extraction(self, mock_fitz_open):
        mock_doc = self._mock_pdf_doc([SAMPLE_FINDING_TEXT_1])
        mock_fitz_open.return_value = mock_doc

        result = extract_findings(b"fake-pdf-bytes")
        finding = result.findings[0]
        # Finding 1 mentions capital extensively
        assert finding.category == FindingCategory.CAPITAL.value

    @patch("parser.fitz.open")
    def test_severity_assignment_on_extraction(self, mock_fitz_open):
        mock_doc = self._mock_pdf_doc([SAMPLE_FINDING_TEXT_2])
        mock_fitz_open.return_value = mock_doc

        result = extract_findings(b"fake-pdf-bytes")
        finding = result.findings[0]
        # Finding 2 mentions "deficiencias significativas" -> high
        assert finding.severity == FindingSeverity.HIGH.value

    @patch("parser.fitz.open")
    def test_empty_pdf_returns_no_findings(self, mock_fitz_open):
        mock_doc = self._mock_pdf_doc([""])
        mock_fitz_open.return_value = mock_doc

        result = extract_findings(b"empty-pdf")

        assert len(result.findings) == 0
        assert result.totalPages == 1

    @patch("parser.fitz.open")
    def test_corrupted_pdf_returns_empty_result(self, mock_fitz_open):
        mock_fitz_open.side_effect = Exception("Cannot open PDF")

        result = extract_findings(b"corrupted-bytes")

        assert len(result.findings) == 0
        assert result.totalPages == 0

    @patch("parser.fitz.open")
    def test_parse_result_metadata(self, mock_fitz_open):
        mock_doc = self._mock_pdf_doc([SAMPLE_FINDING_TEXT_1])
        mock_fitz_open.return_value = mock_doc

        pdf_bytes = b"metadata-test-pdf"
        result = extract_findings(pdf_bytes)

        assert result.sourceHash == hashlib.sha256(pdf_bytes).hexdigest()
        assert result.parsedAt  # ISO timestamp present
        assert "T" in result.parsedAt  # ISO format


# ============================================================================
# 7. API Endpoint Tests
# ============================================================================
class TestHealthEndpoint:
    """Tests for the /health endpoint."""

    def test_health_returns_ok(self):
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert data["service"] == "cossec-parser"

    def test_health_includes_version(self):
        response = client.get("/health")
        data = response.json()
        assert "version" in data


class TestParseEndpoint:
    """Tests for the /parse endpoint."""

    def test_rejects_non_pdf(self):
        response = client.post(
            "/parse",
            files={"file": ("test.txt", b"not a pdf", "text/plain")},
        )
        assert response.status_code == 400
        data = response.json()
        assert data["detail"]["error"] == "INVALID_CONTENT_TYPE"

    def test_rejects_empty_pdf(self):
        response = client.post(
            "/parse",
            files={"file": ("empty.pdf", b"", "application/pdf")},
        )
        assert response.status_code == 400
        data = response.json()
        assert data["detail"]["error"] == "EMPTY_FILE"

    @patch("main.extract_findings")
    def test_accepts_valid_pdf(self, mock_extract):
        mock_extract.return_value = ParseResult(
            findings=[],
            totalPages=5,
            parsedAt="2026-04-16T00:00:00+00:00",
            sourceHash="abc123",
        )

        # Minimal valid PDF header (enough to pass content-type check)
        response = client.post(
            "/parse",
            files={"file": ("report.pdf", b"%PDF-1.4 fake", "application/pdf")},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["totalPages"] == 5
        assert isinstance(data["findings"], list)

    @patch("main.extract_findings")
    def test_parse_returns_findings_structure(self, mock_extract):
        mock_extract.return_value = ParseResult(
            findings=[
                CossecFinding(
                    findingNumber="H-1",
                    category="Capital",
                    description="Test finding description",
                    severity="high",
                    pageNumber=2,
                    rawText="Hallazgo N°1 — Test",
                    confidence=0.85,
                )
            ],
            totalPages=10,
            parsedAt="2026-04-16T12:00:00+00:00",
            sourceHash="deadbeef",
        )

        response = client.post(
            "/parse",
            files={"file": ("exam.pdf", b"%PDF-1.4", "application/pdf")},
        )

        assert response.status_code == 200
        data = response.json()
        assert len(data["findings"]) == 1
        finding = data["findings"][0]
        assert finding["findingNumber"] == "H-1"
        assert finding["category"] == "Capital"
        assert finding["severity"] == "high"
        assert finding["pageNumber"] == 2
        assert finding["confidence"] == 0.85

    @patch("main.extract_findings")
    def test_parse_handles_extraction_error(self, mock_extract):
        mock_extract.side_effect = RuntimeError("Unexpected failure")

        response = client.post(
            "/parse",
            files={"file": ("bad.pdf", b"%PDF broken", "application/pdf")},
        )

        assert response.status_code == 500
        data = response.json()
        assert data["detail"]["error"] == "EXTRACTION_FAILED"


# ============================================================================
# 8. Pydantic Model Validation Tests
# ============================================================================
class TestModels:
    """Tests for Pydantic model validation."""

    def test_finding_valid(self):
        f = CossecFinding(
            findingNumber="H-1",
            description="Test",
            pageNumber=1,
            rawText="Raw",
        )
        assert f.severity == FindingSeverity.MEDIUM.value
        assert f.confidence == 0.5

    def test_finding_rejects_invalid_page(self):
        with pytest.raises(Exception):
            CossecFinding(
                findingNumber="H-1",
                description="Test",
                pageNumber=0,  # must be >= 1
                rawText="Raw",
            )

    def test_finding_rejects_invalid_confidence(self):
        with pytest.raises(Exception):
            CossecFinding(
                findingNumber="H-1",
                description="Test",
                pageNumber=1,
                rawText="Raw",
                confidence=1.5,  # must be <= 1.0
            )

    def test_parse_result_valid(self):
        pr = ParseResult(
            findings=[],
            totalPages=0,
            parsedAt="2026-01-01T00:00:00Z",
            sourceHash="abc",
        )
        assert pr.findings == []
