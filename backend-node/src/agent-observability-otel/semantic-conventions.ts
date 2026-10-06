/**
 * CerniQ-specific OpenTelemetry attribute keys.
 *
 * Namespaced under `cerniq.*` so collector pipelines can route agent spans
 * without parsing span names. Follows OTel semantic convention 1.40 naming
 * (snake_case, dotted namespace, no hyphens).
 *
 * Adding an attribute? Add it here FIRST so dashboards and alerting queries
 * have a single source of truth. Never inline string keys in producer code.
 */

// --- Namespaces ---
const AGENT = 'cerniq.agent';
const TOOL = 'cerniq.agent.tool';
const SWARM = 'cerniq.agent.swarm';
const TRUST = 'cerniq.agent.trust';
const EVAL = 'cerniq.agent.eval';
const INSTITUTION = 'cerniq.institution';

// --- Agent run ---
export const AGENT_TYPE = `${AGENT}.type`;
export const AGENT_RUN_ID = `${AGENT}.run_id`;
export const AGENT_STATUS = `${AGENT}.status`;
export const AGENT_TRIGGER = `${AGENT}.trigger`;
export const AGENT_MODEL = `${AGENT}.model`;
export const AGENT_TOKENS_IN = `${AGENT}.tokens_in`;
export const AGENT_TOKENS_OUT = `${AGENT}.tokens_out`;

// --- Institution (multi-tenant context, populated from JWT) ---
export const INSTITUTION_ID = `${INSTITUTION}.id`;

// --- Tool call ---
export const TOOL_NAME = `${TOOL}.name`;
export const TOOL_LATENCY_MS = `${TOOL}.latency_ms`;
export const TOOL_STATUS = `${TOOL}.status`;
export const TOOL_FAILURE_REASON = `${TOOL}.failure_reason`;

// --- Swarm ---
export const SWARM_MODELS_TOTAL = `${SWARM}.models_total`;
export const SWARM_MODELS_FAILED = `${SWARM}.models_failed`;
export const SWARM_COMPUTE_MS = `${SWARM}.compute_ms`;

// --- Trust layer ---
export const TRUST_PASS = `${TRUST}.pass`;
export const TRUST_BLOCK_COUNT = `${TRUST}.block_count`;
export const TRUST_WARN_COUNT = `${TRUST}.warn_count`;
export const TRUST_EVAL_MS = `${TRUST}.eval_ms`;
export const TRUST_VIOLATIONS = `${TRUST}.violations`; // array of rule codes

// --- Eval harness ---
export const EVAL_CASE_ID = `${EVAL}.case_id`;
export const EVAL_SCORE_TOTAL = `${EVAL}.score_total`;
export const EVAL_DEPLOY_GATE = `${EVAL}.deploy_gate_passed`;

// --- Span names (kept short + stable) ---
export const SPAN_NAMES = {
  AGENT_RUN: 'agent.run',
  AGENT_STEP: 'agent.step',
  TOOL_CALL: 'agent.tool_call',
  SWARM_RUN: 'agent.swarm_run',
  LLM_REASONING: 'agent.llm_reasoning',
  TRUST_EVALUATE: 'agent.trust.evaluate',
  EVAL_CASE: 'agent.eval.case',
  REPLAY: 'agent.replay',
} as const;

export type SpanName = (typeof SPAN_NAMES)[keyof typeof SPAN_NAMES];
