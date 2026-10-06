import { BadRequestException } from '@nestjs/common';
import { WebhookService } from './webhook.service';

describe('WebhookService', () => {
  let service: WebhookService;
  const mockPrisma = {
    webhookSubscription: {
      create: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
  } as any;

  beforeEach(() => {
    service = new WebhookService(mockPrisma);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should create subscription with valid HTTPS URL', async () => {
    mockPrisma.webhookSubscription.create.mockResolvedValue({ id: 'wh-1' });
    const result = await service.createSubscription('inst-1', {
      url: 'https://hooks.example.com/webhook',
      events: ['policy.breach'],
    });
    expect(result.id).toBe('wh-1');
  });

  it('should reject localhost URLs', async () => {
    await expect(
      service.createSubscription('inst-1', {
        url: 'https://localhost:3000/hook',
        events: ['rate.move'],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should reject cloud metadata URLs', async () => {
    await expect(
      service.createSubscription('inst-1', {
        url: 'http://169.254.169.254/latest/meta-data',
        events: ['rate.move'],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should list active subscriptions', async () => {
    mockPrisma.webhookSubscription.findMany.mockResolvedValue([{ id: 'wh-1' }]);
    const result = await service.listSubscriptions('inst-1');
    expect(result.length).toBe(1);
  });

  it('should soft-delete subscription by marking inactive', async () => {
    mockPrisma.webhookSubscription.update.mockResolvedValue({
      isActive: false,
    });
    const result = await service.deleteSubscription('wh-1');
    expect(result.deleted).toBe(true);
    expect(mockPrisma.webhookSubscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { isActive: false },
      }),
    );
  });

  // ── SSRF validation: private IPs blocked ───────────────────
  describe('SSRF validation', () => {
    it('should reject 10.x.x.x private IP URLs', async () => {
      await expect(
        service.createSubscription('inst-1', {
          url: 'https://10.0.0.1/webhook',
          events: ['policy.breach'],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject 172.16.x.x private IP URLs', async () => {
      await expect(
        service.createSubscription('inst-1', {
          url: 'https://172.16.0.1/webhook',
          events: ['rate.move'],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject 192.168.x.x private IP URLs', async () => {
      await expect(
        service.createSubscription('inst-1', {
          url: 'https://192.168.1.1/hook',
          events: ['ews.alert'],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject 127.0.0.1 loopback', async () => {
      await expect(
        service.createSubscription('inst-1', {
          url: 'https://127.0.0.1:8080/hook',
          events: ['report.ready'],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject 0.0.0.0 URL', async () => {
      await expect(
        service.createSubscription('inst-1', {
          url: 'http://0.0.0.0/hook',
          events: ['analysis.complete'],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject metadata.google.internal', async () => {
      await expect(
        service.createSubscription('inst-1', {
          url: 'http://metadata.google.internal/computeMetadata/v1/',
          events: ['camel.downgrade'],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should accept valid public HTTPS URLs', async () => {
      mockPrisma.webhookSubscription.create.mockResolvedValue({ id: 'wh-2' });
      const result = await service.createSubscription('inst-1', {
        url: 'https://api.example.com/webhooks/cerniq',
        events: ['policy.breach', 'rate.move'],
      });
      expect(result.id).toBe('wh-2');
    });

    it('should reject invalid URL format', async () => {
      await expect(
        service.createSubscription('inst-1', {
          url: 'not-a-url',
          events: ['policy.breach'],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── Coverage boost: dispatchEvent, deliverWebhook, retry ───
  describe('dispatchEvent', () => {
    it('dispatches to matching subscriptions and updates success status', async () => {
      const sub = {
        id: 'wh-1',
        url: 'https://hooks.example.com/webhook',
        secretKey: 'abc123',
        institutionId: 'inst-1',
        failureCount: 0,
        events: ['policy.breach'],
        isActive: true,
      };
      mockPrisma.webhookSubscription.findMany.mockResolvedValue([sub]);
      mockPrisma.webhookSubscription.update.mockResolvedValue({});

      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({ status: 200 }) as any;

      const results = await service.dispatchEvent('inst-1', 'policy.breach', {
        detail: 'test',
      });

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
      expect(results[0].statusCode).toBe(200);
      expect(mockPrisma.webhookSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ failureCount: 0 }),
        }),
      );

      global.fetch = originalFetch;
    });

    it('returns empty results when no subscriptions match', async () => {
      mockPrisma.webhookSubscription.findMany.mockResolvedValue([]);
      const results = await service.dispatchEvent('inst-1', 'rate.move', {});
      expect(results).toEqual([]);
    });

    it('does not retry on 4xx client errors', async () => {
      const sub = {
        id: 'wh-4xx',
        url: 'https://hooks.example.com/webhook',
        secretKey: 'secret',
        institutionId: 'inst-1',
        failureCount: 0,
        events: ['ews.alert'],
        isActive: true,
      };
      mockPrisma.webhookSubscription.findMany.mockResolvedValue([sub]);
      mockPrisma.webhookSubscription.update.mockResolvedValue({});

      const originalFetch = global.fetch;
      const fetchMock = jest.fn().mockResolvedValue({ status: 404 });
      global.fetch = fetchMock as any;

      const results = await service.dispatchEvent('inst-1', 'ews.alert', {});

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
      expect(results[0].statusCode).toBe(404);
      // Should only call fetch once (no retries for 4xx)
      expect(fetchMock).toHaveBeenCalledTimes(1);

      global.fetch = originalFetch;
    });

    it('createSubscription generates a 64-char hex secretKey', async () => {
      mockPrisma.webhookSubscription.create.mockImplementation(
        ({ data }: any) => Promise.resolve({ id: 'wh-new', ...data }),
      );

      await service.createSubscription('inst-1', {
        url: 'https://api.valid.com/hook',
        events: ['policy.breach', 'rate.move'],
      });

      const callData =
        mockPrisma.webhookSubscription.create.mock.calls[0][0].data;
      expect(callData.secretKey).toHaveLength(64);
      expect(callData.institutionId).toBe('inst-1');
      expect(callData.events).toEqual(['policy.breach', 'rate.move']);
    });

    it('increments failure count on delivery failure and disables after 10', async () => {
      const sub = {
        id: 'wh-fail',
        url: 'https://hooks.example.com/webhook',
        secretKey: 'secret',
        institutionId: 'inst-1',
        failureCount: 9,
        events: ['report.ready'],
        isActive: true,
      };
      mockPrisma.webhookSubscription.findMany.mockResolvedValue([sub]);
      mockPrisma.webhookSubscription.update.mockResolvedValue({});

      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockRejectedValue(new Error('timeout')) as any;

      const results = await service.dispatchEvent('inst-1', 'report.ready', {});

      expect(results[0].success).toBe(false);
      // Failure count should be 10 which disables the subscription
      expect(mockPrisma.webhookSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            failureCount: 10,
            isActive: false,
          }),
        }),
      );

      global.fetch = originalFetch;
    }, 30000);

    it('includes X-CERNIQ-Signature and X-CERNIQ-Event headers', async () => {
      let capturedHeaders: any = {};
      const sub = {
        id: 'wh-sig',
        url: 'https://hooks.example.com/webhook',
        secretKey: 'test-secret',
        institutionId: 'inst-1',
        failureCount: 0,
        events: ['policy.breach'],
        isActive: true,
      };
      mockPrisma.webhookSubscription.findMany.mockResolvedValue([sub]);
      mockPrisma.webhookSubscription.update.mockResolvedValue({});

      const originalFetch = global.fetch;
      global.fetch = jest
        .fn()
        .mockImplementation(async (_url: any, init: any) => {
          capturedHeaders = init?.headers || {};
          return { status: 200 };
        }) as any;

      await service.dispatchEvent('inst-1', 'policy.breach', {
        detail: 'test',
      });

      expect(capturedHeaders['X-CERNIQ-Signature']).toMatch(/^sha256=/);
      expect(capturedHeaders['X-CERNIQ-Event']).toBe('policy.breach');

      global.fetch = originalFetch;
    });

    it('should reject non-HTTPS in production', async () => {
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      await expect(
        service.createSubscription('inst-1', {
          url: 'http://hooks.example.com/webhook',
          events: ['report.ready'],
        }),
      ).rejects.toThrow(BadRequestException);
      process.env.NODE_ENV = origEnv;
    });

    it('should reject ftp:// protocol', async () => {
      await expect(
        service.createSubscription('inst-1', {
          url: 'ftp://files.example.com/hook',
          events: ['report.ready'],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
