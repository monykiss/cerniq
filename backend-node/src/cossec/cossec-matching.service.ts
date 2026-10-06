import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import type { MatchResult } from './cossec.dto';

/**
 * Fuzzy-matches COSSEC institution names to ProspectInstitution records.
 *
 * The Python microservice extracts institution names verbatim from PDF exam
 * reports. These rarely match our database entries exactly because of accent
 * variations, abbreviations, and inconsistent casing. This service normalizes
 * both sides and uses a multi-pass matching strategy:
 *
 *   1. Exact normalized match
 *   2. Substring containment
 *   3. Levenshtein distance (similarity ratio)
 *
 * A confidence threshold of 0.8 is required for auto-match. Below that the
 * finding is flagged as unmatched for manual review via the admin endpoint.
 */

const AUTO_MATCH_THRESHOLD = 0.8;

/** Common prefixes that COSSEC exam reports include but our DB often omits. */
const STRIP_PREFIXES = [
  'cooperativa de ahorro y credito',
  'cooperativa de ahorro y crédito',
  'cooperativa de ahorros y credito',
  'cooperativa de ahorros y crédito',
  'cooperativa',
  'coop.',
  'coop',
];

@Injectable()
export class CossecMatchingService {
  private readonly logger = new Logger(CossecMatchingService.name);

  /** name (normalized) → prospectInstitutionId */
  private matchCache = new Map<string, string>();
  /** Manual overrides: raw institution name → prospectInstitutionId */
  private manualOverrides = new Map<string, string>();
  /** All prospect names loaded once, then refreshed on cache miss. */
  private prospectMap = new Map<string, { id: string; rawName: string }>();
  private lastLoaded = 0;

  constructor(private readonly prisma: PrismaService) {}

  // ── Public API ───────────────────────────────────────────────────────────

  async matchInstitution(name: string): Promise<MatchResult> {
    // 1. Check manual overrides first
    const overrideId = this.manualOverrides.get(name);
    if (overrideId) {
      return {
        matched: true,
        prospectInstitutionId: overrideId,
        confidence: 1.0,
        matchedName: name,
      };
    }

    const normalized = normalize(name);

    // 2. Check cache
    const cached = this.matchCache.get(normalized);
    if (cached) {
      return {
        matched: true,
        prospectInstitutionId: cached,
        confidence: 1.0,
        matchedName: name,
      };
    }

    // 3. Load prospects if stale (>5 min)
    await this.ensureProspectsLoaded();

    // 4. Exact normalized match
    const exactMatch = this.prospectMap.get(normalized);
    if (exactMatch) {
      this.matchCache.set(normalized, exactMatch.id);
      return {
        matched: true,
        prospectInstitutionId: exactMatch.id,
        confidence: 1.0,
        matchedName: exactMatch.rawName,
      };
    }

    // 5. Substring + fuzzy match against all prospects
    let bestMatch: { id: string; rawName: string; confidence: number } | null =
      null;

    for (const [prospectNorm, prospect] of this.prospectMap.entries()) {
      // Substring containment: if one fully contains the other
      let confidence = 0;
      if (
        prospectNorm.includes(normalized) ||
        normalized.includes(prospectNorm)
      ) {
        const longer = Math.max(prospectNorm.length, normalized.length);
        const shorter = Math.min(prospectNorm.length, normalized.length);
        confidence = shorter / longer;
      }

      // Levenshtein similarity
      const levenshteinSim = levenshteinSimilarity(normalized, prospectNorm);
      confidence = Math.max(confidence, levenshteinSim);

      if (confidence > (bestMatch?.confidence ?? 0)) {
        bestMatch = {
          id: prospect.id,
          rawName: prospect.rawName,
          confidence,
        };
      }
    }

    if (bestMatch && bestMatch.confidence >= AUTO_MATCH_THRESHOLD) {
      this.matchCache.set(normalized, bestMatch.id);
      return {
        matched: true,
        prospectInstitutionId: bestMatch.id,
        confidence: bestMatch.confidence,
        matchedName: bestMatch.rawName,
      };
    }

    return {
      matched: false,
      confidence: bestMatch?.confidence ?? 0,
      matchedName: bestMatch?.rawName,
    };
  }

  getMatchCache(): Map<string, string> {
    return new Map(this.matchCache);
  }

  async addManualMatch(
    institutionName: string,
    prospectInstitutionId: string,
  ): Promise<void> {
    // Verify the prospect exists
    await this.prisma.prospectInstitution.findUniqueOrThrow({
      where: { id: prospectInstitutionId },
    });

    this.manualOverrides.set(institutionName, prospectInstitutionId);
    this.matchCache.set(normalize(institutionName), prospectInstitutionId);

    this.logger.log(
      `Manual match added: "${institutionName}" → ${prospectInstitutionId}`,
    );
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private async ensureProspectsLoaded(): Promise<void> {
    const STALE_MS = 5 * 60 * 1000; // 5 minutes
    if (Date.now() - this.lastLoaded < STALE_MS && this.prospectMap.size > 0) {
      return;
    }

    const prospects = await this.prisma.prospectInstitution.findMany({
      select: { id: true, name: true },
    });

    this.prospectMap.clear();
    for (const p of prospects) {
      this.prospectMap.set(normalize(p.name), { id: p.id, rawName: p.name });
    }
    this.lastLoaded = Date.now();
    this.logger.log(
      `Loaded ${prospects.length} prospect institutions for matching`,
    );
  }
}

// ── String utilities ─────────────────────────────────────────────────────────

/**
 * Normalize an institution name for comparison:
 * - Lowercase
 * - Remove accents (NFD + strip combining marks)
 * - Strip common prefixes
 * - Collapse whitespace
 * - Trim
 */
export function normalize(name: string): string {
  let s = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritical marks
    .trim();

  // Strip known prefixes
  for (const prefix of STRIP_PREFIXES) {
    const normalizedPrefix = prefix
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    if (s.startsWith(normalizedPrefix)) {
      s = s.slice(normalizedPrefix.length).trim();
      break; // only strip one prefix
    }
  }

  // Collapse whitespace
  s = s.replace(/\s+/g, ' ').trim();

  return s;
}

/**
 * Compute Levenshtein distance between two strings.
 */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  // Optimisation: use a single array instead of a full matrix
  const prev = new Array<number>(n + 1);
  const curr = new Array<number>(n + 1);

  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1, // insertion
        prev[j] + 1, // deletion
        prev[j - 1] + cost, // substitution
      );
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }

  return prev[n];
}

/**
 * Returns a similarity ratio between 0 and 1 based on Levenshtein distance.
 */
export function levenshteinSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1.0;
  return 1.0 - levenshteinDistance(a, b) / maxLen;
}
