/**
 * Deterministic mock of LlmBridgeService for agent evaluation.
 *
 * Instead of calling Anthropic, replays a scripted sequence of LLM responses.
 * Each script step specifies whether the LLM does tool_use or end_turn, and
 * what toolCalls/text it produces. The eval runner feeds these into the real
 * AgentRunnerService so we test the full orchestration loop (tool routing,
 * audit logging, contract validation) without network or cost.
 *
 * Script format mirrors LlmBridgeService.turn() output shape exactly
 * (see src/agents/runner/llm-bridge.service.ts).
 */

export interface ScriptedToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ScriptedTurn {
  stopReason: 'end_turn' | 'tool_use';
  text: string;
  toolCalls: ScriptedToolCall[];
  inputTokens: number;
  outputTokens: number;
}

export interface LLMScript {
  caseId: string;
  description: string;
  turns: ScriptedTurn[];
}

export interface LLMTurnRequest {
  system: string;
  messages: unknown[];
  tools: unknown[];
  maxTokens?: number;
  temperature?: number;
}

export interface LLMTurnResponse {
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
  text: string;
  toolCalls: ScriptedToolCall[];
  inputTokens: number;
  outputTokens: number;
}

/**
 * Drop-in replacement for LlmBridgeService. Inject this in the NestJS
 * test module:
 *
 *   providers: [
 *     { provide: LlmBridgeService, useValue: new MockLlmBridge(script) },
 *   ]
 */
export class MockLlmBridge {
  private turnIndex = 0;
  readonly callLog: Array<{
    turnIndex: number;
    messagesLength: number;
    toolsCount: number;
  }> = [];

  constructor(private readonly script: LLMScript) {}

  isConfigured(): boolean {
    return true;
  }

  async turn(req: LLMTurnRequest): Promise<LLMTurnResponse> {
    if (this.turnIndex >= this.script.turns.length) {
      throw new Error(
        `MockLlmBridge: script exhausted after ${this.script.turns.length} turns ` +
          `(case: ${this.script.caseId}). The agent requested more LLM turns than ` +
          `the fixture anticipated. Add more turns to the script or check agent logic.`,
      );
    }

    const turn = this.script.turns[this.turnIndex];
    this.callLog.push({
      turnIndex: this.turnIndex,
      messagesLength: Array.isArray(req.messages) ? req.messages.length : 0,
      toolsCount: Array.isArray(req.tools) ? req.tools.length : 0,
    });
    this.turnIndex++;

    return {
      stopReason: turn.stopReason,
      text: turn.text,
      toolCalls: turn.toolCalls,
      inputTokens: turn.inputTokens,
      outputTokens: turn.outputTokens,
    };
  }

  get turnsConsumed(): number {
    return this.turnIndex;
  }

  get turnsRemaining(): number {
    return this.script.turns.length - this.turnIndex;
  }

  reset(): void {
    this.turnIndex = 0;
    this.callLog.length = 0;
  }
}

// ─── Script builder (fluent API for test authors) ───────────────────────────

export class ScriptBuilder {
  private caseId = 'unnamed';
  private description = '';
  private turns: ScriptedTurn[] = [];

  forCase(id: string, desc?: string): this {
    this.caseId = id;
    this.description = desc ?? '';
    return this;
  }

  addToolUseTurn(
    toolCalls: ScriptedToolCall[],
    opts?: { text?: string; inputTokens?: number; outputTokens?: number },
  ): this {
    this.turns.push({
      stopReason: 'tool_use',
      text: opts?.text ?? '',
      toolCalls,
      inputTokens: opts?.inputTokens ?? 500,
      outputTokens: opts?.outputTokens ?? 200,
    });
    return this;
  }

  addEndTurn(
    text: string,
    opts?: { inputTokens?: number; outputTokens?: number },
  ): this {
    this.turns.push({
      stopReason: 'end_turn',
      text,
      toolCalls: [],
      inputTokens: opts?.inputTokens ?? 500,
      outputTokens: opts?.outputTokens ?? 800,
    });
    return this;
  }

  build(): LLMScript {
    if (this.turns.length === 0) {
      throw new Error('ScriptBuilder: at least one turn is required');
    }
    const last = this.turns[this.turns.length - 1];
    if (last.stopReason !== 'end_turn') {
      throw new Error(
        'ScriptBuilder: last turn must be end_turn (agent expects a final text response)',
      );
    }
    return {
      caseId: this.caseId,
      description: this.description,
      turns: [...this.turns],
    };
  }
}

export function script(): ScriptBuilder {
  return new ScriptBuilder();
}
