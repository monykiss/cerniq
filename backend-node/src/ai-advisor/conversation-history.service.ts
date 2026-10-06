import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

// ─── Types ──────────────────────────────────────────────────

export interface ConversationMessage {
  id: string;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM';
  content: string;
  contentEs?: string | null;
  tokenCount?: number | null;
  modelId?: string | null;
  almModulesReferenced: string[];
  createdAt: Date;
}

export interface AddMessageParams {
  institutionId: string;
  userId: string;
  sessionId: string;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM';
  content: string;
  contentEs?: string;
  tokenCount?: number;
  modelId?: string;
  latencyMs?: number;
  almModulesReferenced?: string[];
  metadata?: Record<string, unknown>;
}

export interface SessionSummary {
  sessionId: string;
  messageCount: number;
  firstMessageAt: Date;
  lastMessageAt: Date;
  /** Preview of the first user question in the session. */
  preview: string;
}

// ─── Service ────────────────────────────────────────────────

@Injectable()
export class ConversationHistoryService {
  private readonly logger = new Logger(ConversationHistoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retrieve the most recent messages for a given session, ordered oldest-first
   * so the LLM sees the conversation in chronological order.
   *
   * `userId` is optional but should be provided whenever the caller is acting
   * on behalf of a specific user — passing it filters the result to only that
   * user's own messages within the session, which closes an intra-institution
   * privacy leak: prior to this filter, two users in the same institution
   * sharing a sessionId (intentional or guessed) could see each other's
   * conversation history. The LLM context-loading paths in `AiAdvisorService.
   * ask()`/`streamAsk()` always pass `userId` so the model never sees another
   * user's prior messages as context. The HTTP `GET /sessions/:institutionId/
   * :sessionId` and the WS `history` event also pass it. When `userId` is
   * omitted, the legacy unfiltered behavior is preserved (no current callers
   * rely on this; the parameter is left optional for forward-compat with
   * future cross-user audit views).
   */
  async getSessionHistory(
    institutionId: string,
    sessionId: string,
    limit = 10,
    userId?: string,
  ): Promise<ConversationMessage[]> {
    const rows = await this.prisma.conversationHistory.findMany({
      where: {
        institutionId,
        sessionId,
        ...(userId ? { userId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        role: true,
        content: true,
        contentEs: true,
        tokenCount: true,
        modelId: true,
        almModulesReferenced: true,
        createdAt: true,
      },
    });

    // Reverse so the oldest message comes first (chronological order).
    return rows.reverse();
  }

  /**
   * Persist a single message (user question or assistant reply) to the
   * conversation history table.
   */
  async addMessage(params: AddMessageParams): Promise<void> {
    await this.prisma.conversationHistory.create({
      data: {
        institutionId: params.institutionId,
        userId: params.userId,
        sessionId: params.sessionId,
        role: params.role,
        content: params.content,
        contentEs: params.contentEs ?? null,
        tokenCount: params.tokenCount ?? null,
        modelId: params.modelId ?? null,
        latencyMs: params.latencyMs ?? null,
        almModulesReferenced: params.almModulesReferenced ?? [],
        metadata: params.metadata ?? undefined,
      },
    });

    this.logger.debug(
      `Persisted ${params.role} message for session ${params.sessionId}`,
    );
  }

  /**
   * List all chat sessions for a given institution + user, returning a summary
   * with preview text and message counts.
   */
  async listSessions(
    institutionId: string,
    userId: string,
  ): Promise<SessionSummary[]> {
    // Use groupBy to get unique sessions, then fetch the first user message
    // for each session as a preview.
    const groups = await this.prisma.conversationHistory.groupBy({
      by: ['sessionId'],
      where: { institutionId, userId },
      _count: { id: true },
      _min: { createdAt: true },
      _max: { createdAt: true },
      orderBy: { _max: { createdAt: 'desc' } },
    });

    const summaries: SessionSummary[] = [];

    for (const group of groups) {
      // Fetch the first USER message for a preview.
      const firstUserMsg = await this.prisma.conversationHistory.findFirst({
        where: {
          sessionId: group.sessionId,
          role: 'USER',
        },
        orderBy: { createdAt: 'asc' },
        select: { content: true },
      });

      summaries.push({
        sessionId: group.sessionId,
        messageCount: group._count.id,
        firstMessageAt: group._min.createdAt!,
        lastMessageAt: group._max.createdAt!,
        preview: firstUserMsg
          ? firstUserMsg.content.slice(0, 120)
          : '(empty session)',
      });
    }

    return summaries;
  }

  /**
   * Delete all messages belonging to a session — scoped to the requesting
   * user.
   *
   * The previous unscoped `deleteMany({ where: { sessionId } })` allowed a
   * caller to delete any session by id (the `:sessionId` URL param is
   * attacker-controlled and `InstitutionScopeGuard` doesn't apply: there's
   * no `:institutionId` on the route). Filtering on `userId` collapses
   * "session not yours" and "session doesn't exist" onto the same 404
   * (anti-enumeration), preventing existence probing.
   *
   * Closes the second of the two IDORs flagged in
   * `docs/security/IDOR_RESIDUAL_AUDIT.md` for ai-advisor.
   */
  async deleteSession(sessionId: string, userId: string): Promise<void> {
    if (!sessionId || !userId) {
      throw new NotFoundException(`Session ${sessionId} not found`);
    }
    const { count } = await this.prisma.conversationHistory.deleteMany({
      where: { sessionId, userId },
    });
    if (count === 0) {
      // Either no such session or this user doesn't own it — same 404.
      this.logger.warn({
        event: 'conversation_history.delete_session.not_found',
        sessionId,
        userId,
      });
      throw new NotFoundException(`Session ${sessionId} not found`);
    }
    this.logger.log(`Deleted session ${sessionId} (${count} messages removed)`);
  }
}
