export type OperatorActionKey =
  | "refresh_intelligence"
  | "open_portal_cycle"
  | "sweep_demo_seats"
  | "run_pipeline"
  | "retry_pipeline_job"
  | "refresh_session_snapshot";

export interface SessionContinuitySnapshot {
  workspaceRoot: string;
  activeBranch: string | null;
  latestStatusSummary: string[];
  latestStatusBlockers: string[];
  lastAgentOutputTitle: string | null;
  handoffUpdatedAt: string | null;
  latestStatusUpdatedAt: string | null;
  activeModes: string[];
  stateFiles: string[];
  metrics: {
    turnCount: number | null;
    lastTurnAt: string | null;
  } | null;
  recommendedCommands: string[];
}

export interface ControlTowerSummary {
  generatedAt: string;
  stats: {
    demoRequests: number;
    institutions: number;
    users: number;
    prospects: number;
    recentUsers: number;
  };
  revenue: {
    activeSubscriptions: number;
    totalSubscriptions: number;
    mrr: number;
    arr: number;
  };
  pipeline: {
    counts: {
      awaitingData: number;
      processing: number;
      complete: number;
      failed: number;
    };
    recentJobs: Array<{
      id: string;
      institutionName: string;
      status: string;
      createdAt: string;
      errorMessage?: string | null;
      user?: { email: string };
    }>;
  };
  portal: {
    counts: {
      awaitingData: number;
      validationFailed: number;
      processing: number;
      failed: number;
    };
    stalledJobs: Array<{
      id: string;
      userId: string;
      institutionName: string;
      status: string;
      errorMessage?: string | null;
      createdAt: string;
    }>;
  };
  exports: {
    completedJobs: number;
    onDemandFallbackJobs: number;
    readyManifestCount: number;
    degradedCount: number;
  };
  demoSeats: {
    active: number;
    expired: number;
    expiringSoon: number;
    recent: Array<Record<string, unknown>>;
  };
  intelligence: {
    workspace: { id: string; name: string };
    stats: {
      totalAccounts: number;
      buyers: number;
      competitors: number;
      staleAccounts: number;
      overdueActions: number;
    };
    handoff: { summary: string };
  };
  sessionContinuity: SessionContinuitySnapshot;
  featureBridge: Array<{
    id: string;
    label: string;
    status: "healthy" | "warning" | "active";
    detail: string;
    href: string;
  }>;
  nextActions: Array<{
    id: string;
    title: string;
    domain: string;
    severity: string;
    href?: string;
    action?: OperatorActionKey;
  }>;
  safeActions: Array<{
    action: OperatorActionKey;
    label: string;
    description: string;
  }>;
}

export interface OperatorActionResult {
  action: OperatorActionKey;
  status: "success" | "error";
  summary: string;
  data?: unknown;
}

export function formatUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 10_000) return `$${(value / 1_000).toFixed(0)}K`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

export function formatStatusTone(status: string) {
  if (status === "healthy" || status === "active") return "emerald" as const;
  if (status === "warning" || status === "attention") return "amber" as const;
  return "slate" as const;
}
