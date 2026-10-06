import { Injectable } from '@nestjs/common';
import {
  ReportArtifactService,
  type ArtifactRecord,
} from './reports/report-artifact.service';
import type { ModelLineageEntry } from './reports/report-preflight.service';
import type { DataGap } from './reports/data-gap';
import type { CaelComplianceResult } from './cael-compliance.service';

/**
 * CAEL Artifact persistence (Wave 1, W1.1 Slice 2 — persistence).
 *
 * Records a computed CAEL filing as an IMMUTABLE, checksummed `ReportArtifact`
 * (the same append-only lineage pipeline the COSSEC/PDF reports use). The
 * canonical governed record is the structured `CaelComplianceResult[]` serialized
 * as `CAEL_JSON` — the rendered `CAEL_HTML` document is a deterministic view of
 * it, so the JSON is the source of truth an auditor checksums + traces back.
 *
 * The model lineage names the CAEL compute models (`reg.cael-pr`,
 * `credit.incurred-loss`) so the artifact carries provenance; the filing's D1
 * data-gaps ride along as `preflightGaps`, never dropped.
 */

/** The CAEL compute models whose output this artifact records. */
const CAEL_MODEL_LINEAGE: ModelLineageEntry[] = [
  {
    modelKey: 'reg.cael-pr',
    version: '0.1.0',
    status: 'DRAFT',
    approvedAt: null,
    approvedBy: null,
  },
  {
    modelKey: 'credit.incurred-loss',
    version: '0.1.0',
    status: 'DRAFT',
    approvedAt: null,
    approvedBy: null,
  },
];

@Injectable()
export class CaelArtifactService {
  constructor(private readonly reportArtifact: ReportArtifactService) {}

  /**
   * Persist a computed CAEL filing as a governed `CAEL_JSON` artifact —
   * SHA-256 checksummed, model-lineage stamped, with the filing's data-gaps.
   */
  async persistFiling(input: {
    institutionId: string;
    results: CaelComplianceResult[];
    generatedBy?: string;
  }): Promise<ArtifactRecord> {
    const content = Buffer.from(JSON.stringify(input.results), 'utf-8');
    return this.reportArtifact.record({
      institutionId: input.institutionId,
      format: 'CAEL_JSON',
      language: 'es',
      content,
      storageLocator: `inline:cael:${input.institutionId}`,
      modelLineage: CAEL_MODEL_LINEAGE,
      preflightGaps: this.collectGaps(input.results),
      generatedBy: input.generatedBy,
    });
  }

  /** Union the per-variant data-gaps (de-duplicated by field + reason). */
  private collectGaps(results: CaelComplianceResult[]): DataGap[] {
    const seen = new Set<string>();
    const out: DataGap[] = [];
    for (const r of results) {
      for (const g of r.gaps) {
        const key = `${g.field}|${g.reason}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(g);
      }
    }
    return out;
  }
}
