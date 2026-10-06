/**
 * Action registry — type contract.
 *
 * Locked decision D5 (2026-04-07): the registry is a THIN layer. The
 * decorator collects metadata, the registry dispatches by id, and the
 * services own the actual logic. There is no middleware pipeline, no
 * orchestration layer, no workflow engine. Each action is a typed wrapper
 * around an existing service method that gets a unified audit, permission,
 * and idempotency story.
 *
 * Why this exists: the audit (SESSION_HANDOFF.md §6) found ~10 services
 * that each do meaningful operations (seed an institution, run a stress
 * test, generate a board report, dispatch an NCUA filing) but have no
 * shared contract for permissions, audit, or "is the user allowed to do
 * this right now?" The action registry is the answer — every operation
 * goes through `dispatch(actionId, input, userId)`, every dispatch hits
 * the audit log, every result is uniform.
 */

/**
 * Static metadata about an action. Lives next to the handler at registration
 * time. The frontend command palette reads `list()` to render available
 * actions; the dispatcher uses `permissions` and `requiresConfirm` to gate
 * execution.
 */
export interface ActionMeta {
  /**
   * Stable identifier. Convention: `<module>.<verb-noun>`. Examples:
   * `alm.run-stress-test`, `institution.seed`, `report.generate-board-pdf`.
   * Once published, the id MUST NOT change — frontend buttons and audit
   * log entries reference it. Add a new action and deprecate the old one
   * if you need to rename.
   */
  id: string;
  /** Human-readable label for the command palette. Bilingual. */
  label: { en: string; es: string };
  /** Module the action belongs to. Used by `list({module})` for filtering. */
  module: string;
  /** Optional longer description shown on hover or in confirmation dialogs. */
  description?: { en: string; es: string };
  /**
   * Required role names. When set, `dispatch()` checks the caller's roles
   * before invoking the handler. An empty array (or omitted) means anyone
   * authenticated can dispatch the action.
   */
  permissions?: string[];
  /**
   * When true, the frontend MUST show a confirmation dialog before calling
   * dispatch. This is metadata only — the dispatcher does NOT enforce it
   * server-side. The flag exists so the command palette can render
   * destructive actions with a different affordance.
   */
  requiresConfirm?: boolean;
  /**
   * Optional idempotency key template. When set, the dispatcher
   * deduplicates concurrent dispatches with the same key. Resolved at
   * runtime against the input — e.g. `institution-seed:{workspaceId}:{fixture}`.
   * NOT YET IMPLEMENTED in the v1 dispatcher (it's a future feature).
   */
  idempotencyKey?: string;
  /**
   * Whether to write an audit log entry on dispatch. Defaults to `true`.
   * Only set to `false` for read-only or polling actions where audit
   * entries would create noise.
   */
  audit?: boolean;
  /** UI hint for showing a "this may take ~30s" notice. Optional. */
  estimatedDurationMs?: number;
}

/**
 * Generic action input. Implementations narrow this with their own typed
 * fields, but the dispatcher only knows the generic shape so it can audit
 * arbitrary inputs without per-action plumbing.
 */
export interface ActionInput {
  institutionId?: string;
  workspaceId?: string;
  [key: string]: unknown;
}

/**
 * Standardized action result. Handlers return this so the dispatcher can
 * audit success/failure uniformly. The `data` field is the action-specific
 * payload — handlers can put anything there. `error` is set when `success`
 * is false; the dispatcher logs both to the audit table.
 */
export interface ActionResult<TData = unknown> {
  success: boolean;
  data?: TData;
  error?: string;
  durationMs: number;
  /**
   * Number of CRITICAL gaps surfaced by any preflight the action ran.
   * When non-zero, the action either refused to run (and `success: false`)
   * or ran with explicit data_unavailable markers in `data`. The audit
   * log uses this for the "how often do users hit gaps?" dashboard.
   */
  criticalGapCount?: number;
  /** Same idea, for warning-severity gaps. */
  warningGapCount?: number;
}

/**
 * The handler signature. Async, takes a generic input, returns either an
 * `ActionResult` (preferred) OR a raw payload that the dispatcher will
 * wrap into a successful `ActionResult`. The wrapping convenience exists
 * so existing service methods can be registered as actions without
 * rewriting their return types.
 */
export type ActionHandler<
  TInput extends ActionInput = ActionInput,
  TData = unknown,
> = (input: TInput) => Promise<ActionResult<TData> | TData>;

/**
 * A registered action — metadata + handler. Internal to the registry;
 * external code interacts via `register()` and `dispatch()`.
 */
export interface RegisteredAction {
  meta: ActionMeta;
  handler: ActionHandler;
}

/**
 * Context the dispatcher passes to the audit logger. Captured at dispatch
 * time and written to `audit_logs` after the handler resolves (or rejects).
 */
export interface DispatchContext {
  actionId: string;
  userId?: string;
  institutionId?: string;
  workspaceId?: string;
  ipAddress?: string;
  userAgent?: string;
  startedAt: Date;
}
