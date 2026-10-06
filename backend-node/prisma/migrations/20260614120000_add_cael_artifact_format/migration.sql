-- W1.1 Slice 2 — CAEL filing persistence.
-- Append-only extension of ReportArtifactFormat with the two CAEL filing
-- representations: the structured compliance result (CAEL_JSON, the governed
-- record) and the rendered bilingual filing (CAEL_HTML). Idempotent
-- (IF NOT EXISTS) — safe to re-run; never edit after it is applied.
ALTER TYPE "ReportArtifactFormat" ADD VALUE IF NOT EXISTS 'CAEL_JSON';
ALTER TYPE "ReportArtifactFormat" ADD VALUE IF NOT EXISTS 'CAEL_HTML';
