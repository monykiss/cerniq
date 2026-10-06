/**
 * Action HTTP surface. Two endpoints:
 *
 *   GET  /api/actions             — list registered actions (frontend palette)
 *   POST /api/actions/:id/dispatch — invoke an action by id
 *
 * The controller is intentionally thin: it parses the request, hands off
 * to the registry, and serializes the result. Permissions, audit, error
 * handling, and timing all live in the registry — the controller does
 * none of that.
 */
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { ActionRegistryService } from './action-registry.service';
import type { ActionInput } from './action.types';

@ApiTags('Actions')
@Controller('api/actions')
export class ActionController {
  constructor(private readonly registry: ActionRegistryService) {}

  /**
   * List actions registered in this process. Frontends use this to populate
   * the command palette. Filter by `?module=alm` to narrow scope.
   */
  @Get()
  @UseGuards(AuthGuard)
  list(@Query('module') module?: string) {
    return { actions: this.registry.list({ module: module ?? undefined }) };
  }

  /**
   * Dispatch an action. The body is the `ActionInput` — the registry
   * unpacks it and passes it to the registered handler. The result is
   * always an `ActionResult` (uniform shape, even on failure).
   *
   * The dispatcher catches all handler errors so this endpoint never
   * returns a 500 from a handler exception — it returns a 200 with
   * `{success: false, error}`. Genuine 4xx (action not found) come back
   * as 200 with `success: false, error: 'NOT_FOUND'` for the same reason:
   * the audit pipeline prefers a uniform shape over HTTP semantics.
   */
  @Post(':id/dispatch')
  @UseGuards(AuthGuard)
  async dispatch(
    @Param('id') id: string,
    @Body() input: ActionInput,
    @Req() req: Request & { user?: { id?: string; roles?: string[] } },
  ) {
    return this.registry.dispatch(id, input ?? {}, {
      userId: req.user?.id,
      userRoles: req.user?.roles,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
