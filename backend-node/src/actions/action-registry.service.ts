/**
 * ActionRegistryService — the dispatch + audit core of Phase 3.
 *
 * Two responsibilities:
 *   1. Maintain the in-memory registry of `(actionId → handler)` pairs.
 *      Other modules call `register()` from their `onModuleInit` to wire
 *      their actions in. The registry is the single source of truth for
 *      "what can the user do right now?"
 *   2. Dispatch by id, with timing, permission checks, and a uniform
 *      audit log entry on every invocation. The dispatcher catches all
 *      handler errors and converts them into a structured `ActionResult`
 *      with `success: false` — never propagates raw exceptions, never
 *      silently swallows.
 *
 * Locked decision D5 (2026-04-07): the registry is THIN. It does not
 * orchestrate. It does not retry. It does not own the data the actions
 * read or write. Each action is a typed pointer at an existing service
 * method that gets a unified envelope.
 *
 * Locked decision D6 (2026-04-07): audit entries go to the existing
 * `audit_logs` Prisma table. No new schema. The action id maps to
 * `AuditLog.action`, the input/result land in `changes`, timing/gap
 * counts go in `metadata`. The same table is used for login + data upload
 * + payment audit so action dispatches are queryable alongside the rest.
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import {
  ActionHandler,
  ActionInput,
  ActionMeta,
  ActionResult,
  DispatchContext,
  RegisteredAction,
} from './action.types';

@Injectable()
export class ActionRegistryService {
  private readonly logger = new Logger(ActionRegistryService.name);
  private readonly actions = new Map<string, RegisteredAction>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Register an action. Throws on duplicate id — registration is one-shot
   * per process. Modules call this from `onModuleInit` so the order of
   * module construction doesn't matter.
   */
  register(meta: ActionMeta, handler: ActionHandler): void {
    if (this.actions.has(meta.id)) {
      throw new Error(
        `Action "${meta.id}" is already registered. Action ids must be unique.`,
      );
    }
    this.actions.set(meta.id, { meta, handler });
    this.logger.log(`Registered action: ${meta.id} (${meta.module})`);
  }

  /**
   * List registered actions. Optionally filter by module. Returns just the
   * metadata — handlers are not exposed. The frontend command palette uses
   * this to populate.
   */
  list(filter?: { module?: string }): ActionMeta[] {
    const all = Array.from(this.actions.values()).map((a) => a.meta);
    if (filter?.module) {
      return all.filter((m) => m.module === filter.module);
    }
    return all;
  }

  /**
   * Look up an action by id. Returns undefined when not found — callers
   * decide how to handle missing actions (404, error, fallback, etc.).
   */
  get(actionId: string): ActionMeta | undefined {
    return this.actions.get(actionId)?.meta;
  }

  /**
   * Dispatch an action. The contract:
   *   - Look up the action; if not found, return `success: false` + 'NOT_FOUND'.
   *   - Check permissions; if denied, return `success: false` + 'FORBIDDEN'
   *     and write a 'denied' audit entry.
   *   - Run the handler with `Date.now()` timing.
   *   - If the handler resolves with an `ActionResult`, pass it through.
   *     If it resolves with anything else, wrap it as `{success: true, data: <value>, durationMs}`.
   *   - If the handler throws, catch and return
   *     `{success: false, error: err.message, durationMs}`.
   *   - Always write an audit entry on the way out (unless `meta.audit === false`).
   *   - Return the `ActionResult`. The dispatcher itself does NOT throw.
   *
   * @param userRoles  Caller's role names — used for the permission check.
   *                   Pass `[]` for unauthenticated callers; the action's
   *                   `permissions` array (if any) is checked as a subset.
   */
  async dispatch(
    actionId: string,
    input: ActionInput,
    ctx: {
      userId?: string;
      userRoles?: string[];
      ipAddress?: string;
      userAgent?: string;
    } = {},
  ): Promise<ActionResult> {
    const startedAt = new Date();
    const start = startedAt.getTime();

    const registered = this.actions.get(actionId);
    if (!registered) {
      const result: ActionResult = {
        success: false,
        error: 'NOT_FOUND',
        durationMs: Date.now() - start,
      };
      // No audit entry for missing actions — they're 404s, not user attempts.
      return result;
    }

    // Permission check. When `permissions` is unset or empty, anyone can
    // dispatch. When set, the caller must have at least one matching role.
    if (registered.meta.permissions && registered.meta.permissions.length > 0) {
      const userRoles = ctx.userRoles ?? [];
      const allowed = registered.meta.permissions.some((p) =>
        userRoles.includes(p),
      );
      if (!allowed) {
        const result: ActionResult = {
          success: false,
          error: 'FORBIDDEN',
          durationMs: Date.now() - start,
        };
        await this.audit(
          {
            actionId,
            userId: ctx.userId,
            institutionId: input.institutionId,
            workspaceId: input.workspaceId,
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
            startedAt,
          },
          input,
          result,
          'denied',
        );
        return result;
      }
    }

    // Run the handler with structured error handling. The handler can
    // return an ActionResult OR a raw payload — both are normalized here.
    let result: ActionResult;
    try {
      const handlerResult = await registered.handler(input);
      if (
        handlerResult &&
        typeof handlerResult === 'object' &&
        'success' in handlerResult &&
        typeof (handlerResult as ActionResult).success === 'boolean'
      ) {
        // Handler returned a fully-formed ActionResult — trust it but
        // refresh durationMs in case the handler didn't set it.
        result = handlerResult as ActionResult;
        if (result.durationMs === undefined) {
          result = { ...result, durationMs: Date.now() - start };
        }
      } else {
        // Handler returned a raw payload — wrap it.
        result = {
          success: true,
          data: handlerResult,
          durationMs: Date.now() - start,
        };
      }
    } catch (err) {
      this.logger.warn({
        event: 'action_dispatch_threw',
        actionId,
        institutionId: input.institutionId,
        reason: err instanceof Error ? err.message : String(err),
      });
      result = {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      };
    }

    if (registered.meta.audit !== false) {
      await this.audit(
        {
          actionId,
          userId: ctx.userId,
          institutionId: input.institutionId,
          workspaceId: input.workspaceId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          startedAt,
        },
        input,
        result,
        result.success ? 'success' : 'failure',
      );
    }

    return result;
  }

  /**
   * Write an audit log entry for a dispatch. Failures here are logged but
   * never propagated — the audit pipeline must never break a user-facing
   * action. The audit table is the existing `audit_logs` Prisma model
   * (decision D6) so action dispatches live alongside login, data upload,
   * payment, and other audited events.
   */
  private async audit(
    ctx: DispatchContext,
    input: ActionInput,
    result: ActionResult,
    outcome: 'success' | 'failure' | 'denied',
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: ctx.userId ?? null,
          institutionId: ctx.institutionId ?? null,
          action: ctx.actionId,
          resource: 'action_dispatch',
          resourceId: ctx.institutionId ?? ctx.workspaceId ?? null,
          outcome,
          changes: { input } as never,
          metadata: {
            durationMs: result.durationMs,
            criticalGapCount: result.criticalGapCount ?? 0,
            warningGapCount: result.warningGapCount ?? 0,
            error: result.error,
          } as never,
          ipAddress: ctx.ipAddress ?? null,
          userAgent: ctx.userAgent ?? null,
        },
      });
    } catch (err) {
      // Audit must not break the dispatch. Log and continue — the dispatch
      // result is still returned to the caller.
      this.logger.warn({
        event: 'action_audit_write_failed',
        actionId: ctx.actionId,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
