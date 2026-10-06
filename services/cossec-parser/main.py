"""
CERNIQ COSSEC Parser — FastAPI Entrypoint

Microservice that accepts COSSEC examination report PDFs and returns
structured JSON findings for ingestion by the NestJS backend.

Usage:
    uvicorn main:app --host 0.0.0.0 --port 8001 --reload
"""

from __future__ import annotations

import logging
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from models import ParseResult
from parser import extract_findings

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("cossec-parser")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
MAX_PDF_SIZE_MB = int(os.getenv("COSSEC_MAX_PDF_SIZE_MB", "50"))
MAX_PDF_SIZE_BYTES = MAX_PDF_SIZE_MB * 1024 * 1024

ALLOWED_ORIGINS = os.getenv(
    "COSSEC_ALLOWED_ORIGINS",
    "http://localhost:3000,http://localhost:3001",
).split(",")

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(
    title="CERNIQ COSSEC Parser",
    description=(
        "PDF extraction microservice for COSSEC examination reports. "
        "Part of the CerniQ bilingual ALM platform for Puerto Rico cooperativas."
    ),
    version="0.1.0",
    docs_url="/docs",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.get("/health")
async def health_check() -> dict:
    """Health check for container orchestration and uptime monitoring."""
    return {"status": "ok", "service": "cossec-parser", "version": "0.1.0"}


@app.post("/parse", response_model=ParseResult)
async def parse_cossec_pdf(file: UploadFile = File(...)) -> ParseResult:
    """
    Accept a COSSEC examination report PDF and return structured findings.

    The NestJS backend calls this endpoint via POST /api/cossec/ingest,
    forwarding the uploaded PDF for extraction.

    Returns:
        ParseResult with extracted findings, page count, timestamp, and hash.
    """
    # Validate content type
    if file.content_type not in ("application/pdf", "application/octet-stream"):
        raise HTTPException(
            status_code=400,
            detail={
                "error": "INVALID_CONTENT_TYPE",
                "message": (
                    f"Expected application/pdf, received {file.content_type}. "
                    "Solo se aceptan archivos PDF de informes COSSEC."
                ),
            },
        )

    # Read and validate size
    pdf_bytes = await file.read()

    if len(pdf_bytes) == 0:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "EMPTY_FILE",
                "message": "El archivo PDF esta vacio.",
            },
        )

    if len(pdf_bytes) > MAX_PDF_SIZE_BYTES:
        raise HTTPException(
            status_code=413,
            detail={
                "error": "FILE_TOO_LARGE",
                "message": (
                    f"El archivo excede el limite de {MAX_PDF_SIZE_MB}MB. "
                    f"Tamano recibido: {len(pdf_bytes) / (1024 * 1024):.1f}MB."
                ),
            },
        )

    logger.info(
        "Parsing COSSEC PDF: filename=%s size=%d bytes",
        file.filename or "unknown",
        len(pdf_bytes),
    )

    try:
        result = extract_findings(pdf_bytes)
    except Exception as exc:
        logger.exception("Unexpected error during PDF extraction")
        raise HTTPException(
            status_code=500,
            detail={
                "error": "EXTRACTION_FAILED",
                "message": (
                    "Error interno al procesar el informe COSSEC. "
                    "Intente nuevamente o contacte soporte."
                ),
                "details": str(exc),
            },
        ) from exc

    logger.info(
        "Parse complete: %d findings extracted from %d pages",
        len(result.findings),
        result.totalPages,
    )

    return result
