import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

// ─── Data Inventory ─────────────────────────────────────────

const DATA_INVENTORY = [
  {
    field: 'User.email',
    category: 'PII',
    legalBasis: 'Contract performance',
    retentionDays: 1095,
    description: 'User login email',
  },
  {
    field: 'User.name',
    category: 'PII',
    legalBasis: 'Contract performance',
    retentionDays: 1095,
    description: 'User display name',
  },
  {
    field: 'Institution.contactEmail',
    category: 'PII',
    legalBasis: 'Legitimate interest',
    retentionDays: 1095,
    description: 'Institution contact',
  },
  {
    field: 'Institution.contactName',
    category: 'PII',
    legalBasis: 'Legitimate interest',
    retentionDays: 1095,
    description: 'Institution contact name',
  },
  {
    field: 'Institution.contactPhone',
    category: 'PII',
    legalBasis: 'Legitimate interest',
    retentionDays: 1095,
    description: 'Institution contact phone',
  },
  {
    field: 'Lead.email',
    category: 'PII',
    legalBasis: 'Legitimate interest',
    retentionDays: 730,
    description: 'Prospect email',
  },
  {
    field: 'Lead.name',
    category: 'PII',
    legalBasis: 'Legitimate interest',
    retentionDays: 730,
    description: 'Prospect name',
  },
  {
    field: 'Lead.phone',
    category: 'PII',
    legalBasis: 'Legitimate interest',
    retentionDays: 730,
    description: 'Prospect phone',
  },
  {
    field: 'AuditLog.ipAddress',
    category: 'PII',
    legalBasis: 'Security',
    retentionDays: 365,
    description: 'Login IP for security audit',
  },
  {
    field: 'BalanceSheetItem.*',
    category: 'Financial',
    legalBasis: 'Contract performance',
    retentionDays: 2555,
    description: 'Institutional financial data (not PII)',
  },
];

// ─── Types ───────────────────────────────────────────────────

export interface DataInventoryItem {
  field: string;
  category: string;
  legalBasis: string;
  retentionDays: number;
  description: string;
}

export interface DeletionRequestResult {
  requestId: string;
  status: string;
  affectedRecords: number;
  regulation: string;
}

export interface SARExport {
  userId: string;
  exportedAt: string;
  data: Record<string, any>;
}

@Injectable()
export class DataPrivacyService {
  private readonly logger = new Logger(DataPrivacyService.name);

  constructor(private readonly prisma: PrismaService) {}

  getDataInventory(): DataInventoryItem[] {
    return DATA_INVENTORY;
  }

  async requestDeletion(
    institutionId: string,
    requestedBy: string,
    regulation: 'GDPR' | 'CCPA' | 'PR_ACT_81',
    scope: 'full' | 'member_pii_only' = 'member_pii_only',
  ): Promise<DeletionRequestResult> {
    const request = await this.prisma.dataDeletionRequest.create({
      data: {
        institutionId,
        requestedBy,
        regulation,
        dataScope: scope,
        status: 'pending',
      },
    });

    // In production, this would trigger an async job. For now, process immediately.
    let affectedRecords = 0;

    if (scope === 'member_pii_only') {
      // Anonymize PII fields only
      await this.prisma.institution.update({
        where: { id: institutionId },
        data: {
          contactName: 'REDACTED',
          contactEmail: 'redacted@deleted.invalid',
          contactPhone: null,
        },
      });
      affectedRecords = 1;
    }

    await this.prisma.dataDeletionRequest.update({
      where: { id: request.id },
      data: { status: 'completed', completedAt: new Date() },
    });

    return {
      requestId: request.id,
      status: 'completed',
      affectedRecords,
      regulation,
    };
  }

  async generateSAR(userId: string): Promise<SARExport> {
    const [user, auditLogs, institutions, subscriptions, expenses] =
      await Promise.all([
        this.prisma.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            provider: true,
            createdAt: true,
            lastLoginAt: true,
          },
        }),
        this.prisma.auditLog.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          select: {
            action: true,
            resource: true,
            resourceId: true,
            ipAddress: true,
            createdAt: true,
          },
          take: 100,
        }),
        this.prisma.institution.findMany({
          where: { members: { some: { userId } } },
          select: {
            id: true,
            name: true,
            type: true,
            totalAssets: true,
            createdAt: true,
          },
          take: 100,
        }),
        this.prisma.subscription.findMany({
          where: { userId },
          select: {
            id: true,
            tier: true,
            status: true,
            currentPeriodEnd: true,
            createdAt: true,
          },
          take: 100,
        }),
        this.prisma.expense
          .findMany({
            where: { userId },
            select: {
              id: true,
              vendor: true,
              amount: true,
              currency: true,
              createdAt: true,
            },
            take: 500,
          })
          .catch(() => []),
      ]);

    return {
      userId,
      exportedAt: new Date().toISOString(),
      data: {
        personalData: user,
        institutions,
        subscriptions,
        expenses,
        activityLog: auditLogs,
        dataInventory: DATA_INVENTORY.filter((d) => d.category === 'PII'),
      },
    };
  }

  async getDeletionHistory(institutionId: string) {
    return this.prisma.dataDeletionRequest.findMany({
      where: { institutionId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
}
