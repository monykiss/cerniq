import { AgentId } from '@prisma/client';
import { RiskMonitorOutputSchema } from '../contracts/risk-monitor.contracts';
import {
  RISK_MONITOR_SYSTEM_PROMPT,
  RISK_MONITOR_PROMPT_VERSION,
} from '../prompts/risk-monitor.prompt';
import type { AgentDefinition } from './agent.definition';

export const RiskMonitorAgent: AgentDefinition<typeof RiskMonitorOutputSchema> =
  {
    agentId: AgentId.RISK_MONITOR,
    agentVersion: '1.0.0',
    promptVersion: RISK_MONITOR_PROMPT_VERSION,
    systemPrompt: RISK_MONITOR_SYSTEM_PROMPT,
    allowedTools: new Set([
      'getLCR',
      'getCECL',
      'getConcentration',
      'getIRRPolicy',
      'getEWS',
      'getCAMEL',
      'getRepricingGap',
      'getPeerBenchmark',
      'getHealthScore',
    ]),
    outputSchema: RiskMonitorOutputSchema,
    runTimeoutMs: 90_000,
    maxTurns: 10,
    buildUserMessage(input: unknown) {
      const meta = (input ?? {}) as Record<string, unknown>;
      const scan = meta.scanKind ?? 'daily';
      const institutionId = meta.institutionId ?? 'unknown';
      return [
        `Run a ${scan} surveillance scan for institution ${institutionId}.`,
        'Emit a RiskMonitorOutput. Empty alerts[] is a valid, successful result.',
      ].join('\n');
    },
  };
