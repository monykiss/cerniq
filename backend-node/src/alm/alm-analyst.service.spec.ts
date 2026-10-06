import { Test, TestingModule } from '@nestjs/testing';
import { AlmAnalystService, AnalystSSEEvent } from './alm-analyst.service';
import { PrismaService } from '../prisma.service';
import { AlmEnterpriseService } from './alm-enterprise.service';
import { PeerAnalyticsService } from './peer-analytics.service';

async function collectEvents(
  gen: AsyncGenerator<AnalystSSEEvent>,
): Promise<AnalystSSEEvent[]> {
  const events: AnalystSSEEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

const mockCOSSECResult = {
  overallStatus: 'compliant',
  ratios: [
    { name: 'Net Worth Ratio (NWR)', value: 9.8, status: 'pass' },
    { name: 'LCR', value: 135, status: 'pass' },
    { name: 'NIM', value: 3.92, status: 'pass' },
    { name: 'Non-Current Ratio', value: 2.3, status: 'pass' },
    { name: 'Coverage Ratio', value: 145, status: 'pass' },
    { name: 'ROA', value: 0.85, status: 'pass' },
    { name: 'ROE', value: 9.1, status: 'pass' },
    { name: 'Efficiency Ratio', value: 68, status: 'pass' },
    { name: 'Concentration Ratio', value: 22, status: 'pass' },
    { name: 'Duration Gap', value: 1.5, status: 'pass' },
    { name: 'NII Sensitivity', value: 4.8, status: 'pass' },
    { name: 'CAMEL Composite', value: 2, status: 'pass' },
  ],
};

const mockALMSummary = {
  niiSensitivity: {
    baseNII: 12.5,
    riskRating: 'moderate',
    scenarios: [
      {
        name: '-200bps',
        shiftBps: -200,
        niImpact: -1.8,
        niImpactPct: -14.4,
        mveImpact: 2.1,
        mveImpactPct: 1.7,
      },
      {
        name: '-100bps',
        shiftBps: -100,
        niImpact: -0.9,
        niImpactPct: -7.2,
        mveImpact: 1.0,
        mveImpactPct: 0.8,
      },
      {
        name: '+100bps',
        shiftBps: 100,
        niImpact: 0.75,
        niImpactPct: 6.0,
        mveImpact: -0.9,
        mveImpactPct: -0.7,
      },
      {
        name: '+200bps',
        shiftBps: 200,
        niImpact: 1.4,
        niImpactPct: 11.2,
        mveImpact: -1.7,
        mveImpactPct: -1.4,
      },
      {
        name: '+300bps',
        shiftBps: 300,
        niImpact: 1.95,
        niImpactPct: 15.6,
        mveImpact: -2.5,
        mveImpactPct: -2.0,
      },
    ],
  },
};

const mockInstitution = {
  id: 'inst-001',
  name: 'Cooperativa de Ahorro Test',
  type: 'cooperativa',
  totalAssets: 250,
};

describe('AlmAnalystService', () => {
  let service: AlmAnalystService;
  let almEnterprise: jest.Mocked<AlmEnterpriseService>;
  let prisma: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AlmAnalystService,
        {
          provide: PrismaService,
          useValue: {
            institution: {
              findUnique: jest.fn().mockResolvedValue(mockInstitution),
            },
            auditLog: {
              create: jest.fn().mockResolvedValue({ id: 'log-001' }),
            },
          },
        },
        {
          provide: AlmEnterpriseService,
          useValue: {
            getCOSSECCompliance: jest.fn().mockResolvedValue(mockCOSSECResult),
            getALMSummary: jest.fn().mockResolvedValue(mockALMSummary),
          },
        },
        { provide: PeerAnalyticsService, useValue: {} },
      ],
    }).compile();

    service = module.get(AlmAnalystService);
    almEnterprise = module.get(AlmEnterpriseService);
    prisma = module.get(PrismaService);
    delete process.env.ANTHROPIC_API_KEY;
  });

  describe('rate limiting', () => {
    it('returns correct initial status', () => {
      const status = service.getRateLimitStatus('fresh-inst');
      expect(status).toEqual({ used: 0, max: 20, remaining: 20 });
    });

    it('blocks the 21st query with rate_limited event', async () => {
      const instId = 'exhaust-' + Date.now();
      for (let i = 0; i < 20; i++) {
        await collectEvents(service.processMessage(instId, 'q' + i));
      }

      const events = await collectEvents(
        service.processMessage(instId, 'one more'),
      );
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('rate_limited');
      expect(events[0].queriesUsed).toBe(20);
      expect(events[0].queriesMax).toBe(20);
      expect(events[0].message).toContain('20 consultas');
    });

    it('isolates rate limits between institutions', async () => {
      const instA = 'iso-A-' + Date.now();
      const instB = 'iso-B-' + Date.now();

      for (let i = 0; i < 5; i++) {
        await collectEvents(service.processMessage(instA, 'q' + i));
      }

      expect(service.getRateLimitStatus(instA).used).toBe(5);
      expect(service.getRateLimitStatus(instB).used).toBe(0);
    });
  });

  describe('local fallback', () => {
    it('responds to rate shock question with real NII data', async () => {
      const events = await collectEvents(
        service.processMessage(
          'inst-001',
          'Si las tasas suben 200 puntos base, cual seria el impacto?',
        ),
      );

      const fullText = events
        .filter((e) => e.type === 'token')
        .map((e) => e.text)
        .join('');

      expect(fullText).toContain('1.4');
      expect(fullText).toContain('200');
    });

    it('handles data_unavailable COSSEC without crash', async () => {
      almEnterprise.getCOSSECCompliance.mockResolvedValueOnce({
        overallStatus: 'data_unavailable',
        ratios: [],
      } as any);

      const events = await collectEvents(
        service.processMessage('inst-empty', 'Como estamos?'),
      );
      expect(events.filter((e) => e.type === 'token').length).toBeGreaterThan(
        0,
      );
    });

    it('every stream ends with done event', async () => {
      const events = await collectEvents(
        service.processMessage('inst-001', 'hola'),
      );

      const lastEvent = events[events.length - 1];
      expect(lastEvent.type).toBe('done');
      expect(lastEvent.queriesUsed).toBeGreaterThan(0);
      expect(lastEvent.queriesMax).toBe(20);
    });
  });

  describe('saveInsight', () => {
    it('creates an audit log record', async () => {
      const result = await service.saveInsight(
        'inst-001',
        'El NWR esta en 9.8%',
        'user-001',
        ['nwr'],
      );

      expect(result.id).toBe('log-001');
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          institutionId: 'inst-001',
          action: 'analyst_insight_saved',
          resource: 'analyst_insight',
          outcome: 'success',
          changes: { message: 'El NWR esta en 9.8%', tags: ['nwr'] },
        }),
      });
    });

    it('persists Rule-9 provenance (promptVersion + usage + costCents + pricingVersion) into metadata', async () => {
      await service.saveInsight(
        'inst-001',
        'Insight',
        'user-001',
        [],
        'abc123def456',
        {
          inputTokens: 100,
          outputTokens: 200,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 50,
        },
        '0.7350',
        '2026-05-15',
      );

      const call = (prisma.auditLog.create as jest.Mock).mock.calls[0][0];
      expect(call.data.metadata).toMatchObject({
        source: 'cerniq_analyst',
        promptVersion: 'abc123def456',
        usage: {
          inputTokens: 100,
          outputTokens: 200,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 50,
        },
        costCents: '0.7350',
        pricingVersion: '2026-05-15',
      });
    });

    it('omits provenance fields from metadata when not provided (no silent placeholders)', async () => {
      await service.saveInsight('inst-001', 'Insight', 'user-001');

      const call = (prisma.auditLog.create as jest.Mock).mock.calls[0][0];
      expect(call.data.metadata).not.toHaveProperty('promptVersion');
      expect(call.data.metadata).not.toHaveProperty('usage');
      expect(call.data.metadata).not.toHaveProperty('costCents');
      expect(call.data.metadata).not.toHaveProperty('pricingVersion');
    });

    it('persists costCents: null when caller passes null (Rule 1: never silent-zero an unknown cost)', async () => {
      await service.saveInsight(
        'inst-001',
        'Insight',
        'user-001',
        [],
        'abc123def456',
        null,
        null,
      );

      const call = (prisma.auditLog.create as jest.Mock).mock.calls[0][0];
      expect(call.data.metadata.costCents).toBeNull();
      expect(call.data.metadata.usage).toBeNull();
    });
  });

  describe('SSE event contracts', () => {
    it('done event includes rate limit metadata', async () => {
      const events = await collectEvents(
        service.processMessage('meta-' + Date.now(), 'test'),
      );

      const doneEvent = events.find((e) => e.type === 'done');
      expect(doneEvent).toMatchObject({
        type: 'done',
        queriesUsed: expect.any(Number),
        queriesMax: 20,
      });
    });

    it('token events contain non-empty text', async () => {
      const events = await collectEvents(
        service.processMessage('inst-001', 'indicadores'),
      );

      const tokenEvents = events.filter((e) => e.type === 'token');
      expect(tokenEvents.length).toBeGreaterThan(0);
      for (const te of tokenEvents) {
        expect(te.text!.length).toBeGreaterThan(0);
      }
    });
  });
});
