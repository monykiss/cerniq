import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AgentRunnerService } from '../runner/agent-runner.service';

export interface BalanceSheetUploadedEvent {
  balanceSheetId: string;
  institutionId: string;
  organizationId?: string | null;
  triggeredByUserId?: string | null;
}

@Injectable()
export class AgentTriggerService {
  private readonly logger = new Logger(AgentTriggerService.name);
  constructor(private readonly runner: AgentRunnerService) {}

  onBalanceSheetUploaded(ev: BalanceSheetUploadedEvent): void {
    this.runner
      .run({
        agentId: 'ALM_DECISION',
        institutionId: ev.institutionId,
        organizationId: ev.organizationId ?? null,
        triggeredByUserId: ev.triggeredByUserId ?? null,
        triggerKind: 'UPLOAD',
        triggerRef: ev.balanceSheetId,
        idempotencyKey: deriveKey('ALM_DECISION', 'upload', ev.balanceSheetId),
        input: {
          institutionId: ev.institutionId,
          region: 'PR',
          language: 'bilingual',
        },
      })
      .catch((err: Error) =>
        this.logger.error(`ALM_DECISION failed for ${ev.balanceSheetId}`, err),
      );
  }

  async runScheduledMonitor(
    institutionId: string,
    scanKind: 'daily' | 'weekly' | 'monthly',
    organizationId?: string | null,
  ) {
    const today = new Date().toISOString().slice(0, 10);
    return this.runner.run({
      agentId: 'RISK_MONITOR',
      institutionId,
      organizationId: organizationId ?? null,
      triggerKind: 'SCHEDULE',
      triggerRef: `${scanKind}:${today}`,
      idempotencyKey: deriveKey(
        'RISK_MONITOR',
        `${scanKind}:${institutionId}`,
        today,
      ),
      input: { institutionId, scanKind },
    });
  }
}

function deriveKey(a: string, b: string, c: string): string {
  return createHash('sha256')
    .update(`${a}|${b}|${c}`)
    .digest('hex')
    .slice(0, 32);
}
