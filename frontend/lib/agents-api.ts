import axios, { AxiosError } from 'axios';
import { getAccessToken, isPlatformAccessError } from './api';
import { getPublicApiBase } from './api-base';
import type {
  AgentAlertRecord,
  AgentAuditStep,
  AgentRun,
  AgentTriggerDto,
  AlertAckDto,
  CFOCopilotOutput,
  PaginatedRuns,
} from '@/types/agents';

// ─── Error types ────────────────────────────────────────────────────────────

export class AgentApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string | null,
    public readonly issues: Array<{ path: string; message: string }> | null,
  ) {
    super(message);
    this.name = 'AgentApiError';
  }
}

function toAgentApiError(err: unknown): AgentApiError {
  if (err instanceof AgentApiError) return err;
  if (err instanceof AxiosError) {
    const status = err.response?.status ?? 0;
    const body = err.response?.data as Record<string, unknown> | undefined;
    const code = (body?.code as string) ?? err.code ?? null;
    const issues = (body?.issues as AgentApiError['issues']) ?? null;
    const msg =
      (body?.message as string) ??
      err.message ??
      `Agent API request failed (${status})`;
    return new AgentApiError(msg, status, code, issues);
  }
  return new AgentApiError(
    err instanceof Error ? err.message : 'Unknown error',
    0,
    null,
    null,
  );
}

// ─── HTTP client ────────────────────────────────────────────────────────────

const agentHttp = axios.create({
  baseURL: getPublicApiBase(),
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
  timeout: 60_000,
});

agentHttp.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = getAccessToken();
    if (token) {
      config.headers = config.headers || {};
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

agentHttp.interceptors.response.use(
  (res) => res,
  (err: AxiosError) => {
    const status = err.response?.status;
    if (status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('cerniq:navigate', {
          detail: { href: '/auth/login', replace: true },
        }),
      );
    }
    if (status === 403 && isPlatformAccessError(err)) {
      window.dispatchEvent(
        new CustomEvent('cerniq:navigate', {
          detail: { href: '/access-required', replace: true },
        }),
      );
    }
    return Promise.reject(toAgentApiError(err));
  },
);

// ─── Input validation ───────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;

function requireInstitutionId(id: string): string {
  if (!id || (!UUID_RE.test(id) && !SAFE_ID_RE.test(id))) {
    throw new AgentApiError(
      'Invalid institution ID',
      400,
      'INVALID_INSTITUTION_ID',
      null,
    );
  }
  return id;
}

// ─── API functions ──────────────────────────────────────────────────────────

const base = (institutionId: string) =>
  `/api/v1/agents/${encodeURIComponent(requireInstitutionId(institutionId))}`;

export async function triggerAgentRun(
  institutionId: string,
  dto: AgentTriggerDto,
): Promise<{ runId: string; status: AgentRun['status']; existing: boolean }> {
  const { data } = await agentHttp.post(`${base(institutionId)}/run`, dto);
  return data;
}

export interface ListRunsQuery {
  agentId?: string;
  status?: string;
  limit?: number;
  cursor?: string;
}

export async function listRuns(
  institutionId: string,
  query: ListRunsQuery = {},
): Promise<PaginatedRuns> {
  const { data } = await agentHttp.get(`${base(institutionId)}/runs`, {
    params: query,
  });
  return data;
}

export async function getRun(
  institutionId: string,
  runId: string,
): Promise<AgentRun> {
  const { data } = await agentHttp.get(`${base(institutionId)}/runs/${runId}`);
  return data;
}

export async function getRunTrace(
  institutionId: string,
  runId: string,
): Promise<AgentAuditStep[]> {
  const { data } = await agentHttp.get(
    `${base(institutionId)}/runs/${runId}/trace`,
  );
  return data;
}

export function getRunTraceExportUrl(
  institutionId: string,
  runId: string,
  format: 'pdf' | 'json' = 'pdf',
): string {
  return `${base(institutionId)}/runs/${runId}/trace/export?format=${format}`;
}

export interface ListAlertsQuery {
  severity?: string;
  ack?: boolean;
  limit?: number;
}

export async function listAlerts(
  institutionId: string,
  query: ListAlertsQuery = {},
): Promise<AgentAlertRecord[]> {
  const { data } = await agentHttp.get(`${base(institutionId)}/alerts`, {
    params: query,
  });
  return data;
}

export async function ackAlert(
  institutionId: string,
  alertId: string,
  dto: AlertAckDto = {},
): Promise<AgentAlertRecord> {
  const { data } = await agentHttp.patch(
    `${base(institutionId)}/alerts/${alertId}`,
    dto,
  );
  return data;
}

const COPILOT_QUERY_MAX_LENGTH = 4000;

export async function copilotQuery(
  institutionId: string,
  payload: { query: string; sessionId?: string; language?: 'en' | 'es' },
): Promise<CFOCopilotOutput> {
  if (!payload.query || payload.query.length > COPILOT_QUERY_MAX_LENGTH) {
    throw new AgentApiError(
      `Query must be 1–${COPILOT_QUERY_MAX_LENGTH} characters`,
      400,
      'INVALID_QUERY_LENGTH',
      null,
    );
  }
  const { data } = await agentHttp.post(
    `${base(institutionId)}/copilot`,
    payload,
  );
  return data;
}

export function agentStreamUrl(institutionId: string): string {
  return `${base(requireInstitutionId(institutionId))}/stream`;
}
