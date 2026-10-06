/**
 * AgentAuditService — append-only, hash-chained audit trail per run.
 *
 * Exports:
 *   - `canonicalJson(value)` — deterministic JSON (sorted keys).
 *   - `chainHash({prevHash, runId, stepIndex, stepKind, payloadJson})`
 *   - `AgentAuditService` — `append`, `rootHash`, `verifyChain`.
 */
import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma.service';

export type VerifyResult = { ok: true } | { ok: false; brokenAtIndex: number };

export interface AppendInput {
  runId: string;
  stepKind: string;
  toolName?: string | null;
  payload: unknown;
  durationMs?: number | null;
}

export interface AppendResult {
  id: string;
  stepIndex: number;
  hash: string;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(
        `canonicalJson: non-finite number (got ${String(value)})`,
      );
    }
    return value;
  }
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) {
      if (src[k] === undefined) continue;
      out[k] = sortKeys(src[k]);
    }
    return out;
  }
  throw new Error(`canonicalJson: unsupported type ${typeof value}`);
}

export function chainHash(params: {
  prevHash: string | null;
  runId: string;
  stepIndex: number;
  stepKind: string;
  payloadJson: string;
}): string {
  const input = [
    params.prevHash ?? '',
    params.runId,
    String(params.stepIndex),
    params.stepKind,
    params.payloadJson,
  ].join(':');
  return createHash('sha256').update(input).digest('hex');
}

@Injectable()
export class AgentAuditService {
  private readonly logger = new Logger(AgentAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  // 4-arg overload used by the runner
  async append(
    runId: string,
    stepIndex: number,
    prevHash: string | null,
    entry: {
      stepKind: string;
      toolName?: string | null;
      payload: unknown;
      durationMs?: number | null;
    },
  ): Promise<AppendResult>;
  // Single-arg overload (legacy)
  async append(input: AppendInput): Promise<AppendResult>;
  async append(
    inputOrRunId: AppendInput | string,
    stepIndex?: number,
    prevHash?: string | null,
    entry?: {
      stepKind: string;
      toolName?: string | null;
      payload: unknown;
      durationMs?: number | null;
    },
  ): Promise<AppendResult> {
    if (typeof inputOrRunId === 'string') {
      return this._appendDirect(inputOrRunId, stepIndex!, prevHash!, entry!);
    }
    return this._appendAuto(inputOrRunId);
  }

  private async _appendDirect(
    runId: string,
    stepIndex: number,
    prevHash: string | null,
    entry: {
      stepKind: string;
      toolName?: string | null;
      payload: unknown;
      durationMs?: number | null;
    },
  ): Promise<AppendResult> {
    const payloadJson = canonicalJson(entry.payload);
    const hash = chainHash({
      prevHash,
      runId,
      stepIndex,
      stepKind: entry.stepKind,
      payloadJson,
    });
    const row = await this.prisma.agentAuditLog.create({
      data: {
        runId,
        stepIndex,
        stepKind: entry.stepKind as never,
        toolName: entry.toolName ?? null,
        payload: (entry.payload ?? null) as never,
        prevHash,
        hash,
        durationMs: entry.durationMs ?? null,
      },
    });
    return { id: (row as { id: string }).id, stepIndex, hash };
  }

  private async _appendAuto(input: AppendInput): Promise<AppendResult> {
    const last = await this.prisma.agentAuditLog.findFirst({
      where: { runId: input.runId },
      orderBy: { stepIndex: 'desc' },
      select: { stepIndex: true, hash: true },
    });

    const stepIndex = last ? last.stepIndex + 1 : 0;
    const prevHash: string | null = last ? last.hash : null;
    const payloadJson = canonicalJson(input.payload);
    const hash = chainHash({
      prevHash,
      runId: input.runId,
      stepIndex,
      stepKind: input.stepKind,
      payloadJson,
    });

    const row = await this.prisma.agentAuditLog.create({
      data: {
        runId: input.runId,
        stepIndex,
        stepKind: input.stepKind as never,
        toolName: input.toolName ?? null,
        payload: (input.payload ?? null) as never,
        prevHash,
        hash,
        durationMs: input.durationMs ?? null,
      },
    });

    return { id: (row as { id: string }).id, stepIndex, hash };
  }

  async rootHash(runId: string): Promise<string | null> {
    const last = await this.prisma.agentAuditLog.findFirst({
      where: { runId },
      orderBy: { stepIndex: 'desc' },
      select: { hash: true },
    });
    return last?.hash ?? null;
  }

  async listForRun(runId: string): Promise<Array<Record<string, unknown>>> {
    const rows = await this.prisma.agentAuditLog.findMany({
      where: { runId },
      orderBy: { stepIndex: 'asc' },
    });
    return rows as unknown as Array<Record<string, unknown>>;
  }

  async verifyChain(runId: string): Promise<VerifyResult> {
    const rows = await this.prisma.agentAuditLog.findMany({
      where: { runId },
      orderBy: { stepIndex: 'asc' },
    });

    let expectedPrev: string | null = null;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] as {
        runId: string;
        stepIndex: number;
        stepKind: string;
        payload: unknown;
        prevHash: string | null;
        hash: string;
      };

      if (row.stepIndex !== i) return { ok: false, brokenAtIndex: i };
      if (row.prevHash !== expectedPrev) return { ok: false, brokenAtIndex: i };

      const recomputed = chainHash({
        prevHash: row.prevHash,
        runId: row.runId,
        stepIndex: row.stepIndex,
        stepKind: row.stepKind,
        payloadJson: canonicalJson(row.payload),
      });
      if (recomputed !== row.hash) return { ok: false, brokenAtIndex: i };

      expectedPrev = row.hash;
    }

    return { ok: true };
  }
}
