/**
 * ReportPreflight — the centralized "is this report safe to ship?" API.
 *
 * Locked decision D4 (2026-04-07): preflight never throws. It returns a
 * `PreflightResult` with a unified `gaps[]` manifest and a `ready: boolean`.
 * Callers branch on `ready` — they do NOT call an `assertReady()` that
 * raises. That matches D1 (structured gaps + partial report) — preflight
 * is the API surface that lets a caller make ONE call to learn what the
 * institution's full report looks like AND which gaps would block a
 * regulator-bound submission.
 *
 * Why this exists: by Phase 2 batch 3 we have ~10 services that each emit
 * their own `gaps[]` (LCR, COSSEC, regulatory stress, board, custom
 * scenario, NCUA filings, peer analytics, CECL, ALCO dashboard, Excel
 * export). Without preflight, every consumer (frontend, action registry,
 * controller, audit pipeline) has to remember to call all of them and
 * merge gaps manually. Preflight makes it one call.
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import { AlmEnterpriseService } from '../alm-enterprise.service';
import { StressTestingService } from '../stress-testing/stress-testing.service';
import { ModelRegistryService } from '../../model-registry/model-registry.service';
import { DataGap, hasCriticalGap, mergeGaps } from './data-gap';
import type {
  ALMSummaryResult,
  COSSECComplianceResult,
} from '../alm-enterprise.service';
import type { RegulatoryStressResult } from '../stress-testing/stress-testing.service';

/**
 * Model lineage record — which model produced which part of the report.
 * Bound to the preflight result so every generated report traces back
 * to the exact model version and approval state.
 */
export interface ModelLineageEntry {
  modelKey: string;
  version: string;
  status: string;
  approvedAt: string | null;
  approvedBy: string | null;
}

export interface PreflightResult {
  institutionId: string;
  /**
   * ISO timestamp when this preflight ran. Future versions will pin every
   * sub-call to this snapshot via a Prisma read transaction; today the
   * value is informational and tells callers when the gaps were last checked.
   */
  snapshotAsOf: string;
  /**
   * `true` when there are zero CRITICAL gaps. WARNING gaps do NOT block
   * `ready` — they're surfaced for review but don't prevent the report
   * from being rendered or shipped. Callers that want extra strictness
   * can check `warningCount === 0` themselves.
   */
  ready: boolean;
  criticalCount: number;
  warningCount: number;
  /**
   * Aggregated gap manifest from every sub-call. Already deduplicated of
   * undefined inputs by `mergeGaps()`. Order matches the sub-call order:
   * ALMSummary first, then COSSEC, then regulatory stress.
   */
  gaps: DataGap[];
  /**
   * FAANG Audit P1: Model lineage — every model used in this preflight
   * with its version and approval state. Auditors can trace any number
   * in the report back to the exact model that produced it.
   */
  modelLineage: ModelLineageEntry[];
  /**
   * The full sub-call results. Callers that want to render a report can
   * use these directly without re-fetching. Each sub-result still carries
   * its own `.gaps` field for narrow consumers, but the top-level `gaps`
   * is the canonical manifest.
   */
  results: {
    summary: ALMSummaryResult;
    cossec: COSSECComplianceResult;
    regulatoryStress: RegulatoryStressResult;
  };
}

/** Model keys that participate in a standard ALM preflight report. */
const PREFLIGHT_MODEL_KEYS = [
  'alm.duration-gap',
  'alm.nii-sensitivity',
  'alm.lcr',
  'alm.nsfr',
  'alm.eve',
  'reg.cossec-compliance',
  'stress.regulatory',
  'stress.monte-carlo',
  'credit.cecl-warm',
  'credit.macro-overlay-pr',
  'report.preflight',
  'report.board',
  'report.excel-export',
];

@Injectable()
export class ReportPreflightService {
  private readonly logger = new Logger(ReportPreflightService.name);

  constructor(
    private readonly almEnterprise: AlmEnterpriseService,
    private readonly stressTesting: StressTestingService,
    @Optional() private readonly modelRegistry?: ModelRegistryService,
  ) {}

  /**
   * Run preflight against an institution. Resolves to a `PreflightResult`
   * even when sub-calls have CRITICAL gaps — `ready: false` is the signal,
   * not an exception. Callers that want to gate a regulator submission
   * should check `result.ready === true` AND `result.criticalCount === 0`
   * (the former is derived from the latter, but the explicit pair makes
   * the intent unambiguous in audit logs).
   *
   * The three sub-calls run in parallel via Promise.all. Any sub-call that
   * itself throws (rather than returning a structured data_unavailable
   * result) is caught and converted into a CRITICAL gap on the preflight
   * result — preflight should never propagate an unstructured failure.
   */
  async check(institutionId: string): Promise<PreflightResult> {
    const snapshotAsOf = new Date().toISOString();
    this.logger.log({
      event: 'preflight_check',
      institutionId,
      snapshotAsOf,
    });

    // Run sub-calls in parallel. Each is wrapped to convert thrown errors
    // into structured gaps so a single sub-failure doesn't sink the whole
    // preflight — the user still needs to see what's working.
    const [summary, cossec, regulatoryStress] = await Promise.all([
      this.almEnterprise
        .getALMSummary(institutionId)
        .catch((err: Error) =>
          this.errorToShell<ALMSummaryResult>(
            'preflight.almSummary',
            err,
            institutionId,
          ),
        ),
      this.almEnterprise
        .getCOSSECCompliance(institutionId)
        .catch((err: Error) =>
          this.errorToShell<COSSECComplianceResult>(
            'preflight.cossec',
            err,
            institutionId,
          ),
        ),
      this.stressTesting
        .runRegulatoryStress(institutionId)
        .catch((err: Error) =>
          this.errorToShell<RegulatoryStressResult>(
            'preflight.regulatoryStress',
            err,
            institutionId,
          ),
        ),
    ]);

    const gaps = mergeGaps(summary.gaps, cossec.gaps, regulatoryStress.gaps);
    const criticalCount = gaps.filter((g) => g.severity === 'CRITICAL').length;
    const warningCount = gaps.length - criticalCount;
    const ready = !hasCriticalGap(gaps);

    // FAANG Audit P1: Collect model lineage for audit traceability.
    // Uses @Optional() injection — if the registry isn't available
    // (e.g. in unit tests without the full module graph), lineage
    // degrades gracefully to an empty array.
    const modelLineage = await this.collectModelLineage();

    this.logger.log({
      event: 'preflight_result',
      institutionId,
      ready,
      criticalCount,
      warningCount,
      modelCount: modelLineage.length,
    });

    return {
      institutionId,
      snapshotAsOf,
      ready,
      criticalCount,
      warningCount,
      gaps,
      modelLineage,
      results: { summary, cossec, regulatoryStress },
    };
  }

  /**
   * Wrap a thrown error into a structured `data_unavailable` shell so the
   * preflight aggregation never has to deal with rejected promises. The
   * shell satisfies the result type (T) by being shaped like a minimal
   * data_unavailable response — every numeric field absent or null, the
   * status field set to `data_unavailable`, and a CRITICAL gap that names
   * the failure point so the caller can debug.
   *
   * This is intentionally `as unknown as T` rather than per-type
   * constructors. The three result types share the same `gaps?` shape and
   * the consumer (this preflight) only reads `.gaps` from the shells —
   * never the numeric fields.
   */
  /**
   * Collect model lineage from the registry for all models that participate
   * in a standard preflight. Degrades to empty array if the registry is
   * unavailable (unit tests, missing module import).
   */
  private async collectModelLineage(): Promise<ModelLineageEntry[]> {
    if (!this.modelRegistry) return [];
    try {
      const entries: ModelLineageEntry[] = [];
      for (const key of PREFLIGHT_MODEL_KEYS) {
        try {
          const model = await this.modelRegistry.getByKey(key);
          entries.push({
            modelKey: model.modelKey,
            version: model.version,
            status: model.status,
            approvedAt: model.approvedAt?.toISOString() ?? null,
            approvedBy: model.approvedBy ?? null,
          });
        } catch {
          // Model not yet registered — skip, don't fail preflight
        }
      }
      return entries;
    } catch {
      this.logger.warn(
        'Model lineage collection failed — returning empty lineage',
      );
      return [];
    }
  }

  private errorToShell<T>(field: string, err: Error, institutionId: string): T {
    this.logger.warn({
      event: 'preflight_subcall_threw',
      field,
      institutionId,
      reason: err.message,
    });
    return {
      gaps: [
        {
          field,
          reason: 'DEPENDENCY_REJECTED' as const,
          severity: 'CRITICAL' as const,
          action: `Sub-call ${field} threw: ${err.message}. This is an unstructured failure — investigate the underlying service before relying on the preflight result.`,
          context: { institutionId, error: err.message },
        },
      ],
    } as unknown as T;
  }
}
