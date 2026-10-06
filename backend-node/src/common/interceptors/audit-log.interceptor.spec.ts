import { randomBytes as testRandomBytes } from 'crypto';
import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of, lastValueFrom, throwError } from 'rxjs';
import { AuditLogInterceptor } from './audit-log.interceptor';
import { PrismaService } from '../../prisma.service';
import {
  AUDIT_ACTION_KEY,
  SKIP_AUDIT_LOG_KEY,
} from '../decorators/audit-action.decorator';

// Per-run test credentials — never fixed, human-like passwords.
const testPassword = (): string => `Aa1!${testRandomBytes(12).toString('hex')}`;
const TEST_PW_1 = testPassword();
const TEST_PW_2 = testPassword();

describe('AuditLogInterceptor', () => {
  let interceptor: AuditLogInterceptor;
  let prisma: { auditLog: { create: jest.Mock } };
  let callHandler: CallHandler;

  function createMockContext(overrides: {
    method?: string;
    url?: string;
    routePath?: string;
    params?: Record<string, string>;
    body?: any;
    user?: any;
    ip?: string;
    headers?: Record<string, string>;
  }): ExecutionContext {
    const request = {
      method: overrides.method || 'GET',
      url: overrides.url || '/',
      route: overrides.routePath ? { path: overrides.routePath } : undefined,
      params: overrides.params || {},
      body: overrides.body || {},
      user: overrides.user,
      ip: overrides.ip || '127.0.0.1',
      headers: overrides.headers || {},
    };

    return {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({}),
        getNext: () => jest.fn(),
      }),
      getClass: () => Object,
      getHandler: () => jest.fn(),
      getArgs: () => [],
      getArgByIndex: () => null,
      switchToRpc: () => ({}) as any,
      switchToWs: () => ({}) as any,
      getType: () => 'http' as any,
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    prisma = {
      auditLog: {
        create: jest.fn().mockResolvedValue({}),
      },
    };

    interceptor = new AuditLogInterceptor(
      prisma as unknown as PrismaService,
      new Reflector(),
    );
    callHandler = { handle: () => of({ success: true }) };
  });

  it('should skip GET requests and not persist audit log', async () => {
    const context = createMockContext({
      method: 'GET',
      routePath: '/api/billing/subscription',
    });

    const obs = interceptor.intercept(context, callHandler);
    await lastValueFrom(obs);

    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('should skip HEAD requests and not persist audit log', async () => {
    const context = createMockContext({
      method: 'HEAD',
      routePath: '/api/health',
    });

    const obs = interceptor.intercept(context, callHandler);
    await lastValueFrom(obs);

    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('should log POST requests with action CREATE', async () => {
    const context = createMockContext({
      method: 'POST',
      routePath: '/api/reports',
      body: { name: 'Test Report' },
      user: { userId: 'user-1', orgId: 'org-1' },
    });

    const obs = interceptor.intercept(context, callHandler);
    await lastValueFrom(obs);

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'CREATE' }),
    });
  });

  it('should log PUT requests with action UPDATE', async () => {
    const context = createMockContext({
      method: 'PUT',
      routePath: '/api/reports/:id',
      params: { id: 'report-99' },
      user: { userId: 'user-2' },
    });

    const obs = interceptor.intercept(context, callHandler);
    await lastValueFrom(obs);

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'UPDATE' }),
    });
  });

  it('should log DELETE requests with action DELETE', async () => {
    const context = createMockContext({
      method: 'DELETE',
      routePath: '/api/reports/:id',
      params: { id: 'report-42' },
      user: { userId: 'user-3' },
    });

    const obs = interceptor.intercept(context, callHandler);
    await lastValueFrom(obs);

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'DELETE' }),
    });
  });

  it('should extract resource name from route path', async () => {
    const context = createMockContext({
      method: 'POST',
      routePath: '/api/billing/checkout',
      user: { userId: 'user-4' },
    });

    const obs = interceptor.intercept(context, callHandler);
    await lastValueFrom(obs);

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ resource: 'billing_checkout' }),
    });
  });

  it('should strip parameter placeholders from resource name', async () => {
    const context = createMockContext({
      method: 'PATCH',
      routePath: '/api/institutions/:institutionId/runs/:runId',
      params: { institutionId: 'inst-1', runId: 'run-1' },
      user: { userId: 'user-5' },
    });

    const obs = interceptor.intercept(context, callHandler);
    await lastValueFrom(obs);

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ resource: 'institutions_runs' }),
    });
  });

  it('should extract resourceId from params.id', async () => {
    const context = createMockContext({
      method: 'DELETE',
      routePath: '/api/reports/:id',
      params: { id: 'report-77' },
      user: { userId: 'user-6' },
    });

    const obs = interceptor.intercept(context, callHandler);
    await lastValueFrom(obs);

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ resourceId: 'report-77' }),
    });
  });

  it('should extract resourceId from params.institutionId when no id param', async () => {
    const context = createMockContext({
      method: 'POST',
      routePath: '/api/institutions/:institutionId',
      params: { institutionId: 'inst-55' },
      user: { userId: 'user-7' },
    });

    const obs = interceptor.intercept(context, callHandler);
    await lastValueFrom(obs);

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ resourceId: 'inst-55' }),
    });
  });

  it('should handle missing user gracefully with userId null', async () => {
    const context = createMockContext({
      method: 'POST',
      routePath: '/api/billing/webhook',
      user: undefined,
    });

    const obs = interceptor.intercept(context, callHandler);
    await lastValueFrom(obs);

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: null }),
    });
  });

  it('should persist audit log with success outcome', async () => {
    const context = createMockContext({
      method: 'POST',
      routePath: '/api/leads',
      body: { email: 'lead@test.com' },
      user: { userId: 'user-8', orgId: 'org-2' },
      ip: '10.0.0.1',
      headers: { 'user-agent': 'Jest/1.0' },
    });

    const obs = interceptor.intercept(context, callHandler);
    await lastValueFrom(obs);

    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-8',
        institutionId: null,
        action: 'CREATE',
        resource: 'leads',
        resourceId: null,
        outcome: 'success',
        changes: expect.objectContaining({
          email: 'lead@test.com',
        }),
        metadata: expect.objectContaining({
          method: 'POST',
          route: '/api/leads',
        }),
        ipAddress: '10.0.0.1',
        userAgent: 'Jest/1.0',
        tenantId: 'org-2',
      },
    });
  });

  it('should set changes to null for DELETE requests', async () => {
    const context = createMockContext({
      method: 'DELETE',
      routePath: '/api/reports/:id',
      params: { id: 'rpt-1' },
      body: { irrelevant: true },
      user: { userId: 'user-9' },
    });

    const obs = interceptor.intercept(context, callHandler);
    await lastValueFrom(obs);

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        outcome: 'success',
        changes: null,
      }),
    });
  });

  it('should log failed operations with error details', async () => {
    const failingHandler: CallHandler = {
      handle: () => throwError(() => ({ message: 'Forbidden', status: 403 })),
    };

    const context = createMockContext({
      method: 'POST',
      routePath: '/api/reports',
      body: { title: 'Test' },
      user: { userId: 'user-10' },
    });

    const obs = interceptor.intercept(context, failingHandler);
    try {
      await lastValueFrom(obs);
    } catch {
      // Expected — the error propagates
    }

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'CREATE',
        resource: 'reports',
        userId: 'user-10',
        outcome: 'failure',
        changes: expect.objectContaining({
          title: 'Test',
        }),
        metadata: expect.objectContaining({
          _audit_error: 'Forbidden',
          _audit_error_status: 403,
        }),
      }),
    });
  });

  it('should honor explicit audit action metadata for GET requests', async () => {
    const handler = jest.fn();
    Reflect.defineMetadata(AUDIT_ACTION_KEY, 'report_download', handler);
    const context = createMockContext({
      method: 'GET',
      routePath: '/api/alm/:institutionId/report',
      params: { institutionId: 'inst-77' },
    }) as any;
    context.getHandler = () => handler;

    const obs = interceptor.intercept(context, callHandler);
    await lastValueFrom(obs);

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'report_download',
        institutionId: 'inst-77',
        resource: 'alm_report',
        resourceId: 'inst-77',
        outcome: 'success',
        changes: null,
        metadata: expect.objectContaining({
          explicitAction: true,
          method: 'GET',
        }),
      }),
    });
  });

  it('should skip audit logging when skip metadata is present', async () => {
    const handler = jest.fn();
    Reflect.defineMetadata(SKIP_AUDIT_LOG_KEY, true, handler);
    const context = createMockContext({
      method: 'POST',
      routePath: '/api/auth/login',
      body: { email: 'a@b.com', password: TEST_PW_1 },
    }) as any;
    context.getHandler = () => handler;

    const obs = interceptor.intercept(context, callHandler);
    await lastValueFrom(obs);

    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('should redact sensitive fields from persisted changes', async () => {
    const context = createMockContext({
      method: 'POST',
      routePath: '/api/auth/register',
      body: {
        email: 'audit@test.com',
        password: TEST_PW_2,
        refreshToken: 'refresh-token',
        nested: { apiKey: 'abc123' },
      },
      user: { userId: 'user-11' },
    });

    const obs = interceptor.intercept(context, callHandler);
    await lastValueFrom(obs);

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        changes: {
          email: 'audit@test.com',
          password: '[REDACTED]',
          refreshToken: '[REDACTED]',
          nested: { apiKey: '[REDACTED]' },
        },
      }),
    });
  });

  // Coverage: line 140 — sanitizePayload with null
  it('should sanitize null values to null', async () => {
    const context = createMockContext({
      method: 'POST',
      routePath: '/api/data',
      body: { field: null, nested: undefined },
      user: { userId: 'user-12' },
    });

    const obs = interceptor.intercept(context, callHandler);
    await lastValueFrom(obs);

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        changes: expect.objectContaining({ field: null }),
      }),
    });
  });

  // Coverage: line 143 — sanitizePayload with Buffer
  it('should sanitize Buffer values to binary marker', async () => {
    const context = createMockContext({
      method: 'POST',
      routePath: '/api/upload',
      body: { file: Buffer.from('binary data'), name: 'test.pdf' },
      user: { userId: 'user-13' },
    });

    const obs = interceptor.intercept(context, callHandler);
    await lastValueFrom(obs);

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        changes: expect.objectContaining({
          file: expect.stringContaining('[binary:'),
          name: 'test.pdf',
        }),
      }),
    });
  });

  // Coverage: line 146 — sanitizePayload with array
  it('should sanitize arrays recursively', async () => {
    const context = createMockContext({
      method: 'POST',
      routePath: '/api/batch',
      body: { items: ['a', 'b'], tags: [{ secret: 'hidden' }] },
      user: { userId: 'user-14' },
    });

    const obs = interceptor.intercept(context, callHandler);
    await lastValueFrom(obs);

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        changes: expect.objectContaining({
          items: ['a', 'b'],
        }),
      }),
    });
  });

  // Coverage: line 149 — sanitizePayload with Date
  it('should sanitize Date values to ISO strings', async () => {
    const testDate = new Date('2026-06-15T10:00:00Z');
    const context = createMockContext({
      method: 'POST',
      routePath: '/api/schedule',
      body: { scheduledAt: testDate },
      user: { userId: 'user-15' },
    });

    const obs = interceptor.intercept(context, callHandler);
    await lastValueFrom(obs);

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        changes: expect.objectContaining({
          scheduledAt: testDate.toISOString(),
        }),
      }),
    });
  });

  // Coverage: line 214 — persist error path
  it('should log error when audit persistence fails', async () => {
    prisma.auditLog.create.mockRejectedValueOnce(new Error('DB write error'));
    const errorSpy = jest
      .spyOn((interceptor as any).logger, 'error')
      .mockImplementation();

    const context = createMockContext({
      method: 'POST',
      routePath: '/api/test',
      user: { userId: 'user-16' },
    });

    const obs = interceptor.intercept(context, callHandler);
    await lastValueFrom(obs);

    // Give the async persist time to complete
    await new Promise((r) => setTimeout(r, 50));
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to persist audit log'),
    );
  });
});
