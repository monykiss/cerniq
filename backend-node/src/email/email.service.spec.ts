import { Test, TestingModule } from '@nestjs/testing';
import { EmailService } from './email.service';

// Mock Resend so no real emails are sent
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: {
      send: jest.fn().mockResolvedValue({ id: 'msg-123' }),
    },
  })),
}));

describe('EmailService', () => {
  let service: EmailService;
  let mockSend: jest.Mock;

  beforeEach(async () => {
    process.env.RESEND_API_KEY = 'test-resend-key';
    process.env.FRONTEND_URL = 'https://test.example.com';
    process.env.OPS_NOTIFY_EMAIL = 'ops@example.com';

    const module: TestingModule = await Test.createTestingModule({
      providers: [EmailService],
    }).compile();

    service = module.get<EmailService>(EmailService);

    // Replace the internal Resend instance with a controllable mock
    mockSend = jest.fn().mockResolvedValue({ id: 'msg-ok' });
    (service as any).resend = { emails: { send: mockSend } };
  });

  afterEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.FRONTEND_URL;
    delete process.env.OPS_NOTIFY_EMAIL;
  });

  // ─── Private helpers ────────────────────────────────────

  describe('frontendUrl', () => {
    it('strips trailing slashes', () => {
      process.env.FRONTEND_URL = 'https://cerniq.io///';
      expect((service as any).frontendUrl()).toBe('https://cerniq.io');
    });

    it('returns default when FRONTEND_URL is not set', () => {
      delete process.env.FRONTEND_URL;
      expect((service as any).frontendUrl()).toBe('https://cerniq.io');
    });
  });

  describe('adminEmail', () => {
    it('returns OPS_NOTIFY_EMAIL when set', () => {
      process.env.OPS_NOTIFY_EMAIL = 'custom@example.com';
      expect((service as any).adminEmail()).toBe('custom@example.com');
    });

    it('returns undefined when OPS_NOTIFY_EMAIL is not set (no built-in address)', () => {
      delete process.env.OPS_NOTIFY_EMAIL;
      expect((service as any).adminEmail()).toBeUndefined();
    });

    it('does not send internal alerts when OPS_NOTIFY_EMAIL is not set', async () => {
      delete process.env.OPS_NOTIFY_EMAIL;
      await service.sendJobFailedAlert({
        jobId: 'job-1',
        institutionName: 'Example Coop',
        error: 'boom',
        clientEmail: 'client@example.com',
      });
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe('wrap', () => {
    it('returns HTML with CERNIQ branding', () => {
      const html = (service as any).wrap('<p>Hello</p>');
      expect(html).toContain('CERNIQ');
      expect(html).toContain('<p>Hello</p>');
      expect(html).toContain('<!DOCTYPE html>');
    });

    it('includes CTA button when ctaUrl and ctaText are provided', () => {
      const html = (service as any).wrap(
        '<p>Body</p>',
        'https://example.com/action',
        'Click Me',
      );
      expect(html).toContain('https://example.com/action');
      expect(html).toContain('Click Me');
    });

    it('omits CTA when ctaUrl is not provided', () => {
      const html = (service as any).wrap('<p>No CTA</p>');
      expect(html).not.toContain('padding: 16px 36px');
    });
  });

  // ─── DRY RUN behavior ──────────────────────────────────

  describe('dry-run (resend = null)', () => {
    beforeEach(() => {
      (service as any).resend = null;
    });

    const dryRunMethods = [
      [
        'sendClientWelcome',
        {
          email: 'a@b.c',
          name: 'X',
          tier: 'G',
          magicUrl: 'u',
          institutionName: 'I',
        },
      ],
      [
        'sendDataSubmissionAck',
        { email: 'a@b.c', name: 'X', institutionName: 'I' },
      ],
      [
        'sendReportReady',
        { email: 'a@b.c', name: 'X', institutionName: 'I', portalUrl: 'u' },
      ],
      ['sendMagicLinkEmail', { email: 'a@b.c', magicUrl: 'u', name: 'X' }],
      [
        'sendJobFailedAlert',
        { jobId: 'j', institutionName: 'I', error: 'e', clientEmail: 'c' },
      ],
      ['sendDemoRequestNotification', { email: 'a@b.c' }],
      [
        'sendLeadNotification',
        {
          leadId: 'l',
          name: 'N',
          email: 'e',
          role: 'R',
          institutionName: 'I',
          institutionType: 'T',
          priority: 'P',
          nextFollowUp: new Date(),
        },
      ],
      [
        'sendLeadConfirmation',
        { name: 'N', email: 'e', institutionName: 'I', bilingual: true },
      ],
      [
        'sendRevenueAlert',
        { amount: 100, tier: 't', customerEmail: 'c', institutionName: 'I' },
      ],
      ['sendPaymentFailed', { email: 'a@b.c', name: 'X' }],
      ['sendCancellationEmail', { email: 'a@b.c', name: 'X' }],
      ['sendMonthlyReportCycle', { email: 'a@b.c', name: 'X' }],
      ['sendDisputeAlert', { chargeId: 'ch', amount: 100, reason: 'r' }],
      [
        'sendDailyOperationsReport',
        { pendingJobs: 1, failedJobs: 0, newLeads: 2, pendingFollowUps: 0 },
      ],
      ['sendDataSubmissionReminder', { email: 'a@b.c', name: 'X' }],
      ['sendOnboardingCheckIn', { email: 'a@b.c', name: 'X' }],
      [
        'sendReportFollowUp',
        { email: 'a@b.c', name: 'X', institutionName: 'I' },
      ],
      ['sendWinBackEmail', { email: 'a@b.c', name: 'X' }],
      [
        'sendLeadNurtureTeaser',
        { email: 'a@b.c', name: 'X', institutionName: 'I' },
      ],
      ['sendLeadNurturePricing', { email: 'a@b.c', name: 'X' }],
      [
        'sendRenewalReminder',
        {
          email: 'a@b.c',
          name: 'X',
          daysLeft: 5,
          tier: 'G',
          currentPeriodEnd: '2026-04-01',
        },
      ],
      [
        'sendChurnRiskAlert',
        {
          userName: 'U',
          userEmail: 'e',
          tier: 't',
          daysSinceLogin: 30,
          currentPeriodEnd: '2026-05-01',
        },
      ],
      [
        'sendWeeklyRevenueReport',
        {
          activeBytier: {},
          totalActive: 0,
          newThisWeek: 0,
          cancelledThisWeek: 0,
          upcomingRenewals: [],
        },
      ],
      [
        'sendNPSSurvey',
        {
          email: 'a@b.c',
          name: 'N',
          institutionName: 'I',
          jobId: 'j',
          institutionId: 'i',
        },
      ],
      [
        'sendTeamInviteEmail',
        {
          email: 'a@b.c',
          name: 'N',
          inviterName: 'E',
          role: 'VIEWER',
          magicUrl: 'u',
        },
      ],
    ] as const;

    for (const [method, data] of dryRunMethods) {
      it(`${method} does not throw in dry-run`, async () => {
        await expect((service as any)[method](data)).resolves.not.toThrow();
      });
    }
  });

  // ─── Success path — verify email content/args ───────────

  describe('sendClientWelcome', () => {
    it('sends email with correct subject and CTA', async () => {
      await service.sendClientWelcome({
        email: 'test@example.net',
        name: 'Maria',
        tier: 'Gold',
        magicUrl: 'https://cerniq.io/magic/abc',
        institutionName: 'Coop Test',
      });
      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.to).toBe('test@example.net');
      expect(call.subject).toContain('Bienvenido');
      expect(call.subject).toContain('Coop Test');
      expect(call.html).toContain('https://cerniq.io/magic/abc');
      expect(call.html).toContain('Gold');
    });
  });

  describe('sendDataSubmissionAck', () => {
    it('sends acknowledgment with institution name', async () => {
      await service.sendDataSubmissionAck({
        email: 'u@example.org',
        name: 'Carlos',
        institutionName: 'Coop A',
      });
      const call = mockSend.mock.calls[0][0];
      expect(call.subject).toContain('Coop A');
      expect(call.html).toContain('Coop A');
    });
  });

  describe('sendReportReady', () => {
    it('includes portal URL in CTA', async () => {
      await service.sendReportReady({
        email: 'u@example.org',
        name: 'Ana',
        institutionName: 'Coop R',
        portalUrl: 'https://cerniq.io/portal/42',
      });
      const call = mockSend.mock.calls[0][0];
      expect(call.html).toContain('https://cerniq.io/portal/42');
      expect(call.subject).toContain('Coop R');
    });
  });

  describe('sendMagicLinkEmail', () => {
    it('sends with magic URL in CTA', async () => {
      await service.sendMagicLinkEmail({
        email: 'u@example.org',
        magicUrl: 'https://cerniq.io/magic/x',
        name: 'Luis',
      });
      const call = mockSend.mock.calls[0][0];
      expect(call.html).toContain('https://cerniq.io/magic/x');
    });
  });

  describe('sendJobFailedAlert', () => {
    it('includes job ID and error in notification', async () => {
      await service.sendJobFailedAlert({
        jobId: 'job_1',
        institutionName: 'Coop F',
        error: 'PDF timeout',
        clientEmail: 'cl@example.org',
      });
      const call = mockSend.mock.calls[0][0];
      expect(call.subject).toContain('FAILED');
      expect(call.subject).toContain('Coop F');
      expect(call.text).toContain('PDF timeout');
      expect(call.text).toContain('cl@example.org');
    });
  });

  describe('sendDemoRequestNotification', () => {
    it('includes all optional fields', async () => {
      await service.sendDemoRequestNotification({
        email: 'p@example.org',
        name: 'P',
        institutionName: 'Coop D',
        institutionType: 'cooperativa',
        totalAssets: '$100-500M',
      });
      const call = mockSend.mock.calls[0][0];
      expect(call.subject).toContain('Coop D');
      expect(call.text).toContain('$100-500M');
    });

    it('handles missing optional fields', async () => {
      await service.sendDemoRequestNotification({ email: 'p@example.org' });
      const call = mockSend.mock.calls[0][0];
      expect(call.text).toContain('\u2014'); // em dash for missing fields
    });
  });

  describe('sendLeadNotification', () => {
    it('includes phone and message when provided', async () => {
      await service.sendLeadNotification({
        leadId: 'l1',
        name: 'Juan',
        email: 'j@example.org',
        phone: '787-555-0123',
        role: 'CEO',
        institutionName: 'Coop U',
        institutionType: 'cooperativa',
        message: 'Quarterly reports',
        priority: 'HIGH',
        nextFollowUp: new Date('2026-04-10'),
      });
      const call = mockSend.mock.calls[0][0];
      expect(call.text).toContain('787-555-0123');
      expect(call.text).toContain('Quarterly reports');
      expect(call.subject).toContain('HIGH');
    });

    it('omits phone and message when not provided', async () => {
      await service.sendLeadNotification({
        leadId: 'l2',
        name: 'Ana',
        email: 'a@example.org',
        role: 'CFO',
        institutionName: 'Coop V',
        institutionType: 'bank',
        priority: 'LOW',
        nextFollowUp: new Date('2026-04-15'),
      });
      const call = mockSend.mock.calls[0][0];
      expect(call.text).not.toContain('Phone:');
      expect(call.text).not.toContain('Message:');
    });
  });

  describe('sendLeadConfirmation', () => {
    it('sends bilingual confirmation', async () => {
      await service.sendLeadConfirmation({
        name: 'P',
        email: 'p@example.org',
        institutionName: 'Coop P',
        bilingual: true,
      });
      const call = mockSend.mock.calls[0][0];
      expect(call.html).toContain('Thank you');
      expect(call.html).toContain('Gracias');
    });

    it('sends Spanish-only when bilingual is false', async () => {
      await service.sendLeadConfirmation({
        name: 'P',
        email: 'p@example.org',
        institutionName: 'Coop P',
        bilingual: false,
      });
      const call = mockSend.mock.calls[0][0];
      expect(call.html).toContain('Gracias');
      expect(call.html).not.toContain('Thank you');
    });
  });

  describe('sendRevenueAlert', () => {
    it('includes amount and tier in subject', async () => {
      await service.sendRevenueAlert({
        amount: 499,
        tier: 'monthly',
        customerEmail: 'c@example.org',
        institutionName: 'Coop Rev',
      });
      const call = mockSend.mock.calls[0][0];
      expect(call.subject).toContain('$499');
      expect(call.subject).toContain('monthly');
    });
  });

  describe('sendPaymentFailed', () => {
    it('sends bilingual payment failed email', async () => {
      await service.sendPaymentFailed({ email: 'u@example.org', name: 'Test' });
      const call = mockSend.mock.calls[0][0];
      expect(call.subject).toContain('pago');
      expect(call.html).toContain('payment');
    });
  });

  describe('sendCancellationEmail', () => {
    it('sends bilingual cancellation email', async () => {
      await service.sendCancellationEmail({
        email: 'u@example.org',
        name: 'Test',
      });
      const call = mockSend.mock.calls[0][0];
      expect(call.subject).toContain('personal note');
      expect(call.html).toContain('cancelled');
    });
  });

  describe('sendMonthlyReportCycle', () => {
    it('sends bilingual monthly cycle email', async () => {
      await service.sendMonthlyReportCycle({
        email: 'u@example.org',
        name: 'Test',
      });
      const call = mockSend.mock.calls[0][0];
      expect(call.subject).toContain('ciclo');
      expect(call.html).toContain('new reporting cycle');
    });
  });

  describe('sendDisputeAlert', () => {
    it('sends dispute alert with charge details', async () => {
      await service.sendDisputeAlert({
        chargeId: 'ch_abc',
        amount: 299,
        reason: 'fraudulent',
      });
      const call = mockSend.mock.calls[0][0];
      expect(call.subject).toContain('$299');
      expect(call.subject).toContain('fraudulent');
      expect(call.text).toContain('ch_abc');
    });
  });

  describe('sendDailyOperationsReport', () => {
    it('sends ops report with correct metrics', async () => {
      await service.sendDailyOperationsReport({
        pendingJobs: 3,
        failedJobs: 1,
        newLeads: 5,
        pendingFollowUps: 2,
      });
      const call = mockSend.mock.calls[0][0];
      expect(call.subject).toContain('5 leads');
      expect(call.subject).toContain('3 pending');
      expect(call.text).toContain('Overdue Follow-ups: 2');
    });
  });

  describe('sendDataSubmissionReminder (B2)', () => {
    it('sends B2 reminder with portal link', async () => {
      await service.sendDataSubmissionReminder({
        email: 'u@example.org',
        name: 'Test',
      });
      const call = mockSend.mock.calls[0][0];
      expect(call.html).toContain('/portal/submit?createCycle=1');
    });
  });

  describe('sendMonthlyReportCycle', () => {
    it('sends monthly cycle email with portal workspace link', async () => {
      await service.sendMonthlyReportCycle({
        email: 'u@example.org',
        name: 'Test',
      });
      const call = mockSend.mock.calls[0][0];
      expect(call.html).toContain('/portal/submit?createCycle=1');
    });
  });

  describe('sendOnboardingCheckIn (B3)', () => {
    it('sends B3 check-in email', async () => {
      await service.sendOnboardingCheckIn({
        email: 'u@example.org',
        name: 'Test',
      });
      const call = mockSend.mock.calls[0][0];
      expect(call.subject).toContain('ayuda');
    });
  });

  describe('sendReportFollowUp (C2)', () => {
    it('sends C2 follow-up with institution name', async () => {
      await service.sendReportFollowUp({
        email: 'u@example.org',
        name: 'Test',
        institutionName: 'Coop C2',
      });
      const call = mockSend.mock.calls[0][0];
      expect(call.subject).toContain('Coop C2');
      expect(call.html).toContain('Coop C2');
    });
  });

  describe('sendWinBackEmail (D5)', () => {
    it('sends D5 win-back email', async () => {
      await service.sendWinBackEmail({ email: 'u@example.org', name: 'Test' });
      const call = mockSend.mock.calls[0][0];
      expect(call.subject).toContain('miss you');
      expect(call.html).toContain('improvements');
    });
  });

  describe('sendLeadNurtureTeaser (A1)', () => {
    it('sends A1 teaser with institution name', async () => {
      await service.sendLeadNurtureTeaser({
        email: 'u@example.org',
        name: 'Test',
        institutionName: 'Coop A1',
      });
      const call = mockSend.mock.calls[0][0];
      expect(call.subject).toContain('Coop A1');
      expect(call.html).toContain('demo');
    });
  });

  describe('sendLeadNurturePricing (A2)', () => {
    it('sends A2 pricing email with table', async () => {
      await service.sendLeadNurturePricing({
        email: 'u@example.org',
        name: 'Test',
      });
      const call = mockSend.mock.calls[0][0];
      expect(call.subject).toContain('precios');
      expect(call.html).toContain('$750');
    });
  });

  describe('sendRenewalReminder', () => {
    it('sends urgent subject when daysLeft <= 7', async () => {
      await service.sendRenewalReminder({
        email: 'u@example.org',
        name: 'M',
        daysLeft: 3,
        tier: 'Gold',
        currentPeriodEnd: '2026-04-01',
      });
      const call = mockSend.mock.calls[0][0];
      expect(call.subject).toContain('Accion requerida');
      expect(call.subject).toContain('3 dias');
    });

    it('sends non-urgent subject when daysLeft > 7', async () => {
      await service.sendRenewalReminder({
        email: 'u@example.org',
        name: 'M',
        daysLeft: 20,
        tier: 'Silver',
        currentPeriodEnd: '2026-04-20',
      });
      const call = mockSend.mock.calls[0][0];
      expect(call.subject).toContain('se renueva');
    });

    it('includes extra messaging when daysLeft <= 14', async () => {
      await service.sendRenewalReminder({
        email: 'u@example.org',
        name: 'M',
        daysLeft: 10,
        tier: 'Gold',
        currentPeriodEnd: '2026-04-10',
      });
      const call = mockSend.mock.calls[0][0];
      expect(call.html).toContain('metodo de pago');
    });

    it('omits extra messaging when daysLeft > 14', async () => {
      await service.sendRenewalReminder({
        email: 'u@example.org',
        name: 'M',
        daysLeft: 25,
        tier: 'Gold',
        currentPeriodEnd: '2026-04-25',
      });
      const call = mockSend.mock.calls[0][0];
      expect(call.html).not.toContain('metodo de pago');
    });
  });

  describe('sendChurnRiskAlert', () => {
    it('sends churn risk alert with correct data', async () => {
      await service.sendChurnRiskAlert({
        userName: 'C',
        userEmail: 'c@example.org',
        tier: 'monthly',
        daysSinceLogin: 45,
        currentPeriodEnd: '2026-05-01',
      });
      const call = mockSend.mock.calls[0][0];
      expect(call.subject).toContain('CHURN RISK');
      expect(call.subject).toContain('45d inactive');
    });
  });

  describe('sendWeeklyRevenueReport', () => {
    it('sends report with tier breakdown', async () => {
      await service.sendWeeklyRevenueReport({
        activeBytier: { Gold: 5, Silver: 10 },
        totalActive: 15,
        newThisWeek: 3,
        cancelledThisWeek: 1,
        upcomingRenewals: [
          { email: 'a@example.org', tier: 'Gold', renewsAt: '2026-04-10' },
        ],
      });
      const call = mockSend.mock.calls[0][0];
      expect(call.subject).toContain('15 active');
      expect(call.text).toContain('Gold: 5');
      expect(call.text).toContain('a@example.org');
    });

    it('shows None when no upcoming renewals', async () => {
      await service.sendWeeklyRevenueReport({
        activeBytier: {},
        totalActive: 0,
        newThisWeek: 0,
        cancelledThisWeek: 0,
        upcomingRenewals: [],
      });
      const call = mockSend.mock.calls[0][0];
      expect(call.text).toContain('None');
    });
  });

  describe('sendNPSSurvey', () => {
    it('sends NPS survey with score links 0-10', async () => {
      await service.sendNPSSurvey({
        email: 'u@example.org',
        name: 'A',
        institutionName: 'Coop',
        jobId: 'j1',
        institutionId: 'i1',
      });
      const call = mockSend.mock.calls[0][0];
      expect(call.subject).toContain('experiencia');
      expect(call.html).toContain('score=0');
      expect(call.html).toContain('score=10');
    });
  });

  describe('sendTeamInviteEmail', () => {
    it('sends team invite with correct role label', async () => {
      await service.sendTeamInviteEmail({
        email: 'n@example.org',
        name: 'Pedro',
        inviterName: 'Alex',
        role: 'ANALYST',
        magicUrl: 'u',
      });
      const call = mockSend.mock.calls[0][0];
      expect(call.subject).toContain('Alex');
      expect(call.html).toContain('Analista / Analyst');
    });

    it('handles OWNER role label', async () => {
      await service.sendTeamInviteEmail({
        email: 'n@example.org',
        name: 'P',
        inviterName: 'E',
        role: 'OWNER',
        magicUrl: 'u',
      });
      const call = mockSend.mock.calls[0][0];
      expect(call.html).toContain('Propietario / Owner');
    });

    it('falls back to raw role when label is unknown', async () => {
      await service.sendTeamInviteEmail({
        email: 'n@example.org',
        name: 'P',
        inviterName: 'E',
        role: 'CUSTOM_ROLE',
        magicUrl: 'u',
      });
      const call = mockSend.mock.calls[0][0];
      expect(call.html).toContain('CUSTOM_ROLE');
    });
  });

  // ─── Error handling — Resend rejects ────────────────────

  describe('error handling when resend.emails.send rejects', () => {
    beforeEach(() => {
      mockSend.mockRejectedValue(new Error('Network error'));
    });

    const errorMethods = [
      [
        'sendClientWelcome',
        {
          email: 'a@b.c',
          name: 'X',
          tier: 'G',
          magicUrl: 'u',
          institutionName: 'I',
        },
      ],
      [
        'sendDataSubmissionAck',
        { email: 'a@b.c', name: 'X', institutionName: 'I' },
      ],
      [
        'sendReportReady',
        { email: 'a@b.c', name: 'X', institutionName: 'I', portalUrl: 'u' },
      ],
      ['sendMagicLinkEmail', { email: 'a@b.c', magicUrl: 'u', name: 'X' }],
      [
        'sendJobFailedAlert',
        { jobId: 'j', institutionName: 'I', error: 'e', clientEmail: 'c' },
      ],
      ['sendPaymentFailed', { email: 'a@b.c', name: 'X' }],
      ['sendCancellationEmail', { email: 'a@b.c', name: 'X' }],
      ['sendMonthlyReportCycle', { email: 'a@b.c', name: 'X' }],
      ['sendDisputeAlert', { chargeId: 'ch', amount: 100, reason: 'r' }],
      [
        'sendDailyOperationsReport',
        { pendingJobs: 0, failedJobs: 0, newLeads: 0, pendingFollowUps: 0 },
      ],
      ['sendDataSubmissionReminder', { email: 'a@b.c', name: 'X' }],
      ['sendOnboardingCheckIn', { email: 'a@b.c', name: 'X' }],
      [
        'sendReportFollowUp',
        { email: 'a@b.c', name: 'X', institutionName: 'I' },
      ],
      ['sendWinBackEmail', { email: 'a@b.c', name: 'X' }],
      [
        'sendLeadNurtureTeaser',
        { email: 'a@b.c', name: 'X', institutionName: 'I' },
      ],
      ['sendLeadNurturePricing', { email: 'a@b.c', name: 'X' }],
      [
        'sendRenewalReminder',
        {
          email: 'a@b.c',
          name: 'X',
          daysLeft: 5,
          tier: 'G',
          currentPeriodEnd: '2026-04-01',
        },
      ],
      [
        'sendChurnRiskAlert',
        {
          userName: 'U',
          userEmail: 'e',
          tier: 't',
          daysSinceLogin: 30,
          currentPeriodEnd: '2026-05-01',
        },
      ],
      [
        'sendWeeklyRevenueReport',
        {
          activeBytier: {},
          totalActive: 0,
          newThisWeek: 0,
          cancelledThisWeek: 0,
          upcomingRenewals: [],
        },
      ],
      [
        'sendNPSSurvey',
        {
          email: 'a@b.c',
          name: 'N',
          institutionName: 'I',
          jobId: 'j',
          institutionId: 'i',
        },
      ],
      [
        'sendTeamInviteEmail',
        {
          email: 'a@b.c',
          name: 'N',
          inviterName: 'E',
          role: 'VIEWER',
          magicUrl: 'u',
        },
      ],
      ['sendDemoRequestNotification', { email: 'a@b.c' }],
      [
        'sendLeadNotification',
        {
          leadId: 'l',
          name: 'N',
          email: 'e',
          role: 'R',
          institutionName: 'I',
          institutionType: 'T',
          priority: 'P',
          nextFollowUp: new Date(),
        },
      ],
      [
        'sendLeadConfirmation',
        { name: 'N', email: 'e', institutionName: 'I', bilingual: true },
      ],
      [
        'sendRevenueAlert',
        { amount: 100, tier: 't', customerEmail: 'c', institutionName: 'I' },
      ],
    ] as const;

    for (const [method, data] of errorMethods) {
      it(`${method} catches error and does not throw`, async () => {
        await expect((service as any)[method](data)).resolves.not.toThrow();
      });
    }
  });

  // ─── Additional methods coverage ────────────────────────

  describe('sendRawEmail', () => {
    it('sends raw email with wrapped html', async () => {
      await service.sendRawEmail({
        to: 'p@e.com',
        subject: 'Custom',
        html: '<p>Hi</p>',
      });
      const call = mockSend.mock.calls[0][0];
      expect(call.to).toBe('p@e.com');
      expect(call.html).toContain('CERNIQ');
    });

    it('throws when resend fails', async () => {
      mockSend.mockRejectedValueOnce(new Error('Send failed'));
      await expect(
        service.sendRawEmail({ to: 'f@e.com', subject: 'T', html: '<p>T</p>' }),
      ).rejects.toThrow('Send failed');
    });
  });

  describe('sendDemoConfirmation', () => {
    it('sends demo confirmation email', async () => {
      await service.sendDemoConfirmation({ name: 'C', email: 'c@b.com' });
      const call = mockSend.mock.calls[0][0];
      expect(call.subject).toContain('demo');
    });

    it('returns early when resend is null', async () => {
      (service as any).resend = null;
      await expect(
        service.sendDemoConfirmation({ email: 't@t.com' }),
      ).resolves.not.toThrow();
    });
  });
});
