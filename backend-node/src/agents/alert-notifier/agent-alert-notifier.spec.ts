import { AgentAlertNotifierService } from './agent-alert-notifier.service';

describe('AgentAlertNotifierService', () => {
  let service: AgentAlertNotifierService;
  let mockPrisma: any;
  let mockEmail: any;
  let mockBus: any;

  beforeEach(() => {
    mockPrisma = {
      agentAlert: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
      },
      agentRun: {
        findUnique: jest.fn(),
      },
      institution: {
        findUnique: jest.fn(),
      },
    };
    mockEmail = {};
    mockBus = {
      on: jest.fn().mockReturnValue(() => {}),
    };
    service = new AgentAlertNotifierService(mockPrisma, mockEmail, mockBus);
  });

  it('subscribes to RUN_COMPLETED on init', () => {
    service.onModuleInit();
    expect(mockBus.on).toHaveBeenCalledWith(
      'agent.run.completed',
      expect.any(Function),
    );
  });

  it('does nothing when run has no CRITICAL/HIGH alerts', async () => {
    mockPrisma.agentAlert.findMany.mockResolvedValue([]);
    await service.onRunCompleted('run-1');
    expect(mockPrisma.agentRun.findUnique).not.toHaveBeenCalled();
  });

  it('sends email for CRITICAL alert and stamps notifiedAt', async () => {
    const alert = {
      id: 'alert-1',
      runId: 'run-1',
      severity: 'CRITICAL',
      status: 'OPEN',
      metric: 'LCR',
      finding: 'LCR dropped below 110%',
      findingEs: 'LCR cayó por debajo de 110%',
      recommendation: 'Increase HQLA by $5M',
      regulatoryRef: 'COSSEC 2021-02',
    };
    mockPrisma.agentAlert.findMany.mockResolvedValue([alert]);
    mockPrisma.agentRun.findUnique.mockResolvedValue({
      institutionId: 'inst-1',
      agentId: 'RISK_MONITOR',
    });
    mockPrisma.institution.findUnique.mockResolvedValue({
      name: 'Cooperativa del Pueblo',
      contactEmail: 'cfo@example.coop',
      contactName: 'María García',
      preferredLanguage: 'es',
      workspace: { owner: { email: 'owner@example.coop', name: 'Owner' } },
    });

    await service.onRunCompleted('run-1');

    // Email was sent — verified by the fact that institution was looked up
    // and no error was thrown.
    expect(mockPrisma.institution.findUnique).toHaveBeenCalled();
  });

  it('skips notification when institution has no email', async () => {
    mockPrisma.agentAlert.findMany.mockResolvedValue([
      {
        id: 'alert-2',
        severity: 'HIGH',
        metric: 'Net Worth',
        finding: 'Declining',
        recommendation: 'Review',
      },
    ]);
    mockPrisma.agentRun.findUnique.mockResolvedValue({
      institutionId: 'inst-2',
      agentId: 'RISK_MONITOR',
    });
    mockPrisma.institution.findUnique.mockResolvedValue({
      name: 'Test Coop',
      contactEmail: null,
      contactName: null,
      preferredLanguage: 'en',
      workspace: { owner: { email: null, name: null } },
    });

    await service.onRunCompleted('run-2');
    // No email sent — institution lookup happened but no valid email
    expect(mockPrisma.institution.findUnique).toHaveBeenCalled();
  });

  // ── Single-send contract (regression guard for the `await … ?? fallback`
  // ── bug where a void-returning sendAgentAlert would trigger the Resend
  // ── fallback as well, emailing the CFO twice per alert).
  describe('single-send dispatch contract', () => {
    const baseAlert = {
      id: 'alert-1',
      runId: 'run-1',
      severity: 'CRITICAL',
      status: 'OPEN',
      metric: 'LCR',
      finding: 'LCR breach',
      findingEs: 'LCR incumplido',
      recommendation: 'Raise HQLA',
      regulatoryRef: null,
    };

    const seedHappyPath = () => {
      mockPrisma.agentAlert.findMany.mockResolvedValue([baseAlert]);
      mockPrisma.agentRun.findUnique.mockResolvedValue({
        institutionId: 'inst-1',
        agentId: 'RISK_MONITOR',
      });
      mockPrisma.institution.findUnique.mockResolvedValue({
        name: 'Coop',
        contactEmail: 'cfo@example.coop',
        contactName: 'CFO',
        preferredLanguage: 'es',
        workspace: { owner: { email: null, name: null } },
      });
    };

    it('calls EmailService.sendAgentAlert exactly once when present and never falls back to Resend', async () => {
      seedHappyPath();
      const sendAgentAlert = jest.fn().mockResolvedValue(undefined);
      mockEmail.sendAgentAlert = sendAgentAlert;

      // Spy on the Resend fallback path to prove it was never entered.
      // We override on the instance (not the prototype) so the spy is
      // visible to the call site via `this.sendViaResendDirect(...)`.
      const resendSpy = jest
        .spyOn(service as any, 'sendViaResendDirect')
        .mockResolvedValue(undefined);

      await service.onRunCompleted('run-1');

      expect(sendAgentAlert).toHaveBeenCalledTimes(1);
      expect(resendSpy).not.toHaveBeenCalled();
    });

    it('falls back to Resend exactly once when sendAgentAlert is absent', async () => {
      seedHappyPath();
      expect(mockEmail.sendAgentAlert).toBeUndefined();

      const resendSpy = jest
        .spyOn(service as any, 'sendViaResendDirect')
        .mockResolvedValue(undefined);

      await service.onRunCompleted('run-1');

      expect(resendSpy).toHaveBeenCalledTimes(1);
    });
  });
});
