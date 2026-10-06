import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

const TOKEN_BUDGETS: Record<string, number> = {
  free: 10000,
  bronze: 50000,
  silver: 250000,
  gold: Infinity,
};

const MODEL_CHAIN = [
  { model: 'claude-sonnet-4-20250514', costPer1K: 0.05, tier: 'primary' },
  { model: 'claude-haiku-4-5-20251001', costPer1K: 0.012, tier: 'fallback1' },
  { model: 'gpt-4o-mini', costPer1K: 0.006, tier: 'fallback2' },
] as const;

export interface ModelSelection {
  model: string;
  tier: string;
  reason: string;
  budgetUsedPct: number;
  tokensRemaining: number;
}

@Injectable()
export class AICostControllerService {
  private readonly logger = new Logger(AICostControllerService.name);

  constructor(private readonly prisma: PrismaService) {}

  async selectModel(institutionId: string): Promise<ModelSelection> {
    const institution = await this.prisma.institution.findUnique({
      where: { id: institutionId },
      include: {
        workspace: { include: { owner: { include: { subscription: true } } } },
      },
    });

    const tier = (institution?.workspace?.owner?.subscription?.tier ??
      'silver') as string;
    const budget = TOKEN_BUDGETS[tier] ?? TOKEN_BUDGETS.silver;

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const used = await this.prisma.usageMeterEvent.aggregate({
      where: {
        institutionId,
        eventType: 'ai_token_1k',
        createdAt: { gte: startOfMonth },
      },
      _sum: { quantity: true },
    });
    const tokensUsed = (used._sum.quantity ?? 0) * 1000;
    const usedPct = budget === Infinity ? 0 : tokensUsed / budget;
    const remaining = budget === Infinity ? Infinity : budget - tokensUsed;

    if (usedPct < 0.8) {
      return {
        model: MODEL_CHAIN[0].model,
        tier: 'primary',
        reason: `${(usedPct * 100).toFixed(0)}% of budget used`,
        budgetUsedPct: usedPct,
        tokensRemaining: remaining,
      };
    }
    if (usedPct < 0.95) {
      return {
        model: MODEL_CHAIN[1].model,
        tier: 'fallback1',
        reason: `${(usedPct * 100).toFixed(0)}% — switched to Haiku to preserve budget`,
        budgetUsedPct: usedPct,
        tokensRemaining: remaining,
      };
    }
    if (tier === 'gold') {
      return {
        model: MODEL_CHAIN[0].model,
        tier: 'primary',
        reason: 'Gold tier — unlimited',
        budgetUsedPct: 0,
        tokensRemaining: Infinity,
      };
    }
    return {
      model: MODEL_CHAIN[2].model,
      tier: 'fallback2',
      reason: `${(usedPct * 100).toFixed(0)}% — budget near limit, using GPT-4o-mini`,
      budgetUsedPct: usedPct,
      tokensRemaining: remaining,
    };
  }

  async recordUsage(
    institutionId: string,
    inputTokens: number,
    outputTokens: number,
  ): Promise<void> {
    const totalK = Math.ceil((inputTokens + outputTokens) / 1000);
    await this.prisma.usageMeterEvent.create({
      data: { institutionId, eventType: 'ai_token_1k', quantity: totalK },
    });
  }

  async getUsageSummary(institutionId: string): Promise<{
    tokensUsed: number;
    budget: number;
    pct: number;
    model: string;
  }> {
    const selection = await this.selectModel(institutionId);
    return {
      tokensUsed: Math.round(
        (1 - selection.tokensRemaining / (TOKEN_BUDGETS.silver || 250000)) *
          (TOKEN_BUDGETS.silver || 250000),
      ),
      budget: TOKEN_BUDGETS.silver,
      pct: selection.budgetUsedPct,
      model: selection.model,
    };
  }
}
