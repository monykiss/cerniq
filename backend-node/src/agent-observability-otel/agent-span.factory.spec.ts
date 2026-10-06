import { AgentSpanFactory } from './agent-span.factory';
import type { TrustVerdict } from '../agent-trust/contracts';

describe('AgentSpanFactory', () => {
  let factory: AgentSpanFactory;

  beforeEach(() => {
    factory = new AgentSpanFactory();
  });

  describe('startAgentRun', () => {
    it('returns a span that can be ended without error', () => {
      const span = factory.startAgentRun({
        runId: 'r-1',
        institutionId: 'i-1',
        agentType: 'ALM_DECISION',
      });
      expect(span).toBeDefined();
      expect(() => span.end()).not.toThrow();
    });

    it('includes custom attributes', () => {
      const span = factory.startAgentRun({
        runId: 'r-1',
        institutionId: 'i-1',
        agentType: 'RISK_MONITOR',
        attributes: { 'custom.key': 'value' },
      });
      expect(span).toBeDefined();
      span.end();
    });
  });

  describe('withToolCall', () => {
    it('returns the callback result and records the span', async () => {
      const result = await factory.withToolCall('getLCR', async () => ({
        lcr: 118.5,
      }));
      expect(result).toEqual({ lcr: 118.5 });
    });

    it('propagates errors and records them on the span', async () => {
      await expect(
        factory.withToolCall('failingTool', async () => {
          throw new Error('tool timeout');
        }),
      ).rejects.toThrow('tool timeout');
    });

    it('handles sync-like async functions', async () => {
      const result = await factory.withToolCall('fastTool', async () => 42);
      expect(result).toBe(42);
    });
  });

  describe('recordTrustVerdict', () => {
    it('records a passing verdict without error', () => {
      const verdict: TrustVerdict = {
        pass: true,
        violations: [],
        summary: { block: 0, warn: 0, info: 0 },
        evaluatedInMs: 5,
      };
      expect(() => factory.recordTrustVerdict(null, verdict)).not.toThrow();
    });

    it('records a failing verdict without error', () => {
      const verdict: TrustVerdict = {
        pass: false,
        violations: [
          { rule: 'NUMBER_NOT_CITED', severity: 'BLOCK', message: 'test' },
        ],
        summary: { block: 1, warn: 0, info: 0 },
        evaluatedInMs: 10,
      };
      expect(() => factory.recordTrustVerdict(null, verdict)).not.toThrow();
    });

    it('accepts a parent span for context linkage', () => {
      const parent = factory.startAgentRun({
        runId: 'r-1',
        institutionId: 'i-1',
        agentType: 'ALM_DECISION',
      });
      const verdict: TrustVerdict = {
        pass: true,
        violations: [],
        summary: { block: 0, warn: 0, info: 0 },
        evaluatedInMs: 3,
      };
      expect(() => factory.recordTrustVerdict(parent, verdict)).not.toThrow();
      parent.end();
    });
  });
});
