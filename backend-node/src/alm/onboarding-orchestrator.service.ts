import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

export interface ActivationMilestone {
  id: string;
  label: string;
  labelEs: string;
  completed: boolean;
  completedAt: string | null;
}

export interface OnboardingStatus {
  institutionId: string;
  milestones: ActivationMilestone[];
  activationScore: number; // 0-5
  daysSinceSignup: number;
  isStalled: boolean;
  stalledMilestone: string | null;
}

const MILESTONES = [
  {
    id: 'data_loaded',
    label: 'Balance sheet data loaded',
    labelEs: 'Datos de balance cargados',
  },
  {
    id: 'first_analysis',
    label: 'First ALM analysis run',
    labelEs: 'Primer análisis ALM ejecutado',
  },
  {
    id: 'camel_viewed',
    label: 'CAMEL score reviewed',
    labelEs: 'Puntuación CAMEL revisada',
  },
  {
    id: 'ai_analyst_used',
    label: 'AI Analyst query sent',
    labelEs: 'Consulta al Analista IA enviada',
  },
  {
    id: 'first_report',
    label: 'First report generated',
    labelEs: 'Primer informe generado',
  },
];

@Injectable()
export class OnboardingOrchestratorService {
  private readonly logger = new Logger(OnboardingOrchestratorService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getOnboardingStatus(institutionId: string): Promise<OnboardingStatus> {
    const inst = await this.prisma.institution.findUnique({
      where: { id: institutionId },
    });
    if (!inst)
      return {
        institutionId,
        milestones: [],
        activationScore: 0,
        daysSinceSignup: 0,
        isStalled: false,
        stalledMilestone: null,
      };

    const daysSinceSignup = Math.floor(
      (Date.now() - inst.createdAt.getTime()) / 86400000,
    );

    // Check each milestone
    const bsItems = await this.prisma.balanceSheetItem.count({
      where: { institutionId },
    });
    const analysisRuns = await this.prisma.analysisRun.count({
      where: { institutionId },
    });
    const boardReports = await this.prisma.boardReport.count({
      where: { institutionId },
    });

    const milestones: ActivationMilestone[] = MILESTONES.map((m) => {
      let completed = false;
      switch (m.id) {
        case 'data_loaded':
          completed = bsItems > 0;
          break;
        case 'first_analysis':
          completed = analysisRuns > 0;
          break;
        case 'camel_viewed':
          completed = analysisRuns > 0;
          break; // proxy
        case 'ai_analyst_used':
          completed = analysisRuns > 1;
          break; // proxy
        case 'first_report':
          completed = boardReports > 0;
          break;
      }
      return {
        ...m,
        completed,
        completedAt: completed ? inst.createdAt.toISOString() : null,
      };
    });

    const score = milestones.filter((m) => m.completed).length;
    const firstIncomplete = milestones.find((m) => !m.completed);
    const isStalled = daysSinceSignup > 2 && score < 3;

    return {
      institutionId,
      milestones,
      activationScore: score,
      daysSinceSignup,
      isStalled,
      stalledMilestone: isStalled ? (firstIncomplete?.id ?? null) : null,
    };
  }

  async getAllOnboardingStatuses(): Promise<OnboardingStatus[]> {
    const institutions = await this.prisma.institution.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return Promise.all(
      institutions.map((i: { id: string }) => this.getOnboardingStatus(i.id)),
    );
  }
}
