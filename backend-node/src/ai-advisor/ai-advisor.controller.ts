import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Req,
  Logger,
  UseGuards,
  HttpCode,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { InstitutionScopeGuard } from '../agent-api/guards/institution-scope.guard';
import { AiAdvisorService } from './ai-advisor.service';
import { ConversationHistoryService } from './conversation-history.service';
import {
  AskQuestionSchema,
  SessionParamsSchema,
  SessionHistoryParamsSchema,
  DeleteSessionParamsSchema,
} from './ai-advisor.dto';
import * as crypto from 'crypto';

@ApiTags('AI Advisor')
@ApiBearerAuth()
@Controller('api/ai-advisor')
@UseGuards(AuthGuard, InstitutionScopeGuard)
export class AiAdvisorController {
  private readonly logger = new Logger(AiAdvisorController.name);

  constructor(
    private readonly aiAdvisor: AiAdvisorService,
    private readonly conversationHistory: ConversationHistoryService,
    private readonly institutionScope: InstitutionScopeGuard,
  ) {}

  /**
   * POST /api/ai-advisor/ask
   * Ask a question and receive a full (non-streaming) response.
   *
   * Body-supplied institutionId — the class-level InstitutionScopeGuard
   * passes through here because the route has no :institutionId URL
   * param. Re-running its ownership primitive against the body keeps the
   * single source-of-truth ownership contract: same lookup, same 403/404
   * semantics, same WARN denial logs as URL-scoped routes. Closes the
   * first of the two ai-advisor IDORs flagged in
   * docs/security/IDOR_RESIDUAL_AUDIT.md.
   */
  @Post('ask')
  @HttpCode(200)
  async ask(@Body() body: unknown, @Req() req: any) {
    const parsed = AskQuestionSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues);
    }

    const { institutionId, question, language } = parsed.data;
    const sessionId = parsed.data.sessionId || crypto.randomUUID();
    const userId: string =
      req.user?.userId ?? req.user?.id ?? req.user?.sub ?? 'anonymous';

    await this.institutionScope.verifyOwnership(
      institutionId,
      userId,
      !!req.user?.access?.isPlatformAdmin,
    );

    this.logger.log(
      `AI Advisor ask: institution=${institutionId} session=${sessionId} q="${question.slice(0, 80)}..."`,
    );

    const response = await this.aiAdvisor.ask({
      institutionId,
      userId,
      question,
      sessionId,
      language,
    });

    return response;
  }

  /**
   * GET /api/ai-advisor/sessions/:institutionId
   * List all chat sessions for the current user at an institution.
   */
  @Get('sessions/:institutionId')
  async listSessions(@Param() params: unknown, @Req() req: any) {
    const parsed = SessionParamsSchema.safeParse(params);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues);
    }

    const userId: string = req.user?.id ?? req.user?.sub ?? 'anonymous';

    return this.conversationHistory.listSessions(
      parsed.data.institutionId,
      userId,
    );
  }

  /**
   * GET /api/ai-advisor/sessions/:institutionId/:sessionId
   * Get the full history for a specific chat session, scoped to the
   * requesting user's own messages. Closes the intra-institution privacy
   * leak documented in `IDOR_RESIDUAL_AUDIT.md` — pre-fix, two users in
   * the same institution sharing a sessionId could read each other's
   * conversation history.
   */
  @Get('sessions/:institutionId/:sessionId')
  async getSessionHistory(@Param() params: unknown, @Req() req: any) {
    const parsed = SessionHistoryParamsSchema.safeParse(params);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues);
    }
    const userId: string =
      req.user?.userId ?? req.user?.id ?? req.user?.sub ?? '';

    return this.conversationHistory.getSessionHistory(
      parsed.data.institutionId,
      parsed.data.sessionId,
      50, // Return up to 50 messages for full session view
      userId,
    );
  }

  /**
   * DELETE /api/ai-advisor/sessions/:sessionId
   * Delete a chat session and all its messages.
   *
   * `InstitutionScopeGuard` doesn't gate this route (no `:institutionId`
   * in the path). Session ownership is enforced at the service layer by
   * scoping the delete to the requesting `userId`. Closes the second
   * ai-advisor IDOR flagged in `docs/security/IDOR_RESIDUAL_AUDIT.md`.
   */
  @Delete('sessions/:sessionId')
  @HttpCode(204)
  async deleteSession(@Param() params: unknown, @Req() req: any) {
    const parsed = DeleteSessionParamsSchema.safeParse(params);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues);
    }

    // userId chain widened to userId-first: AuthGuard:271 sets
    // `req.user.userId` as the canonical post-auth field. The previous
    // `id ?? sub` chain skipped it and would have hit `''` for callers
    // whose JWT didn't carry `id` or `sub` claims, silently breaking the
    // delete (no rows match userId='') and surfacing as 404 even for
    // legitimate owners. Matches ask() (e88ae20c) + getSessionHistory()
    // (9dbf57df).
    const userId: string =
      req.user?.userId ?? req.user?.id ?? req.user?.sub ?? '';
    await this.conversationHistory.deleteSession(parsed.data.sessionId, userId);
  }
}
