import type { AgentRunResult } from './contracts';
import type { AgentType } from '../agent-trust/contracts';

/**
 * Port (hexagonal-architecture style) that the eval harness depends on.
 * The peer-owned AgentRunnerService implements this — when peer's code
 * lands, wire it in the GoldenRunner constructor via Nest DI (provide the
 * runner under the AGENT_EXECUTOR token).
 *
 * Keeping the eval harness dependency-free of the peer module lets us land
 * and exercise the scorer today without blocking on their merge.
 */
export interface AgentExecutor {
  execute(invocation: {
    agentType: AgentType;
    institutionId: string;
    params: Record<string, unknown>;
  }): Promise<AgentRunResult>;
}

/** Nest DI token. */
export const AGENT_EXECUTOR = Symbol('AGENT_EXECUTOR');
