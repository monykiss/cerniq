import { EmailSequenceProcessor } from './email-sequence.processor';

describe('EmailSequenceProcessor', () => {
  let processor: EmailSequenceProcessor;
  let prisma: any;
  let email: any;

  beforeEach(() => {
    prisma = {
      emailSequence: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      lead: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };

    email = {
      sendDataSubmissionReminder: jest.fn().mockResolvedValue(undefined),
      sendOnboardingCheckIn: jest.fn().mockResolvedValue(undefined),
      sendReportFollowUp: jest.fn().mockResolvedValue(undefined),
      sendWinBackEmail: jest.fn().mockResolvedValue(undefined),
      sendLeadNurtureTeaser: jest.fn().mockResolvedValue(undefined),
      sendLeadNurturePricing: jest.fn().mockResolvedValue(undefined),
    };

    processor = new EmailSequenceProcessor(prisma, email);
  });

  describe('processDueSequences', () => {
    it('should do nothing when no due sequences exist', async () => {
      await processor.processDueSequences();
      expect(prisma.emailSequence.update).not.toHaveBeenCalled();
    });

    it('should process B2 sequence and mark as sent', async () => {
      prisma.emailSequence.findMany.mockResolvedValue([
        {
          id: 'seq_1',
          sequenceKey: 'B2',
          userId: 'user_1',
          leadId: null,
          metadata: {},
          scheduledAt: new Date(),
        },
      ]);
      prisma.user.findUnique.mockResolvedValue({
        email: 'user@example.coop',
        name: 'Maria',
      });

      await processor.processDueSequences();

      expect(email.sendDataSubmissionReminder).toHaveBeenCalledWith({
        email: 'user@example.coop',
        name: 'Maria',
      });
      expect(prisma.emailSequence.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'seq_1' },
          data: { sentAt: expect.any(Date) },
        }),
      );
    });

    it('should process B3 sequence for a user', async () => {
      prisma.emailSequence.findMany.mockResolvedValue([
        {
          id: 'seq_2',
          sequenceKey: 'B3',
          userId: 'user_2',
          leadId: null,
          metadata: {},
          scheduledAt: new Date(),
        },
      ]);
      prisma.user.findUnique.mockResolvedValue({
        email: 'user2@example.coop',
        name: 'Carlos',
      });

      await processor.processDueSequences();
      expect(email.sendOnboardingCheckIn).toHaveBeenCalledWith({
        email: 'user2@example.coop',
        name: 'Carlos',
      });
    });

    it('should process C2 sequence using lead data', async () => {
      prisma.emailSequence.findMany.mockResolvedValue([
        {
          id: 'seq_3',
          sequenceKey: 'C2',
          userId: null,
          leadId: 'lead_1',
          metadata: {},
          scheduledAt: new Date(),
        },
      ]);
      prisma.lead.findUnique.mockResolvedValue({
        email: 'lead@test.com',
        name: 'Ana',
        institutionName: 'Coop Del Sur',
      });

      await processor.processDueSequences();
      expect(email.sendReportFollowUp).toHaveBeenCalledWith({
        email: 'lead@test.com',
        name: 'Ana',
        institutionName: 'Coop Del Sur',
      });
    });

    it('should process D5 win-back sequence', async () => {
      prisma.emailSequence.findMany.mockResolvedValue([
        {
          id: 'seq_4',
          sequenceKey: 'D5',
          userId: 'user_3',
          leadId: null,
          metadata: {},
          scheduledAt: new Date(),
        },
      ]);
      prisma.user.findUnique.mockResolvedValue({
        email: 'winback@test.com',
        name: 'Pedro',
      });

      await processor.processDueSequences();
      expect(email.sendWinBackEmail).toHaveBeenCalledWith({
        email: 'winback@test.com',
        name: 'Pedro',
      });
    });

    it('should process A1 lead nurture teaser', async () => {
      prisma.emailSequence.findMany.mockResolvedValue([
        {
          id: 'seq_5',
          sequenceKey: 'A1',
          userId: null,
          leadId: 'lead_2',
          metadata: {},
          scheduledAt: new Date(),
        },
      ]);
      prisma.lead.findUnique.mockResolvedValue({
        email: 'prospect@example.coop',
        name: 'Luis',
        institutionName: 'Coop Norte',
      });

      await processor.processDueSequences();
      expect(email.sendLeadNurtureTeaser).toHaveBeenCalledWith({
        email: 'prospect@example.coop',
        name: 'Luis',
        institutionName: 'Coop Norte',
      });
    });

    it('should process A2 lead nurture pricing', async () => {
      prisma.emailSequence.findMany.mockResolvedValue([
        {
          id: 'seq_6',
          sequenceKey: 'A2',
          userId: 'user_4',
          leadId: null,
          metadata: {},
          scheduledAt: new Date(),
        },
      ]);
      prisma.user.findUnique.mockResolvedValue({
        email: 'pricing@test.com',
        name: 'Rosa',
      });

      await processor.processDueSequences();
      expect(email.sendLeadNurturePricing).toHaveBeenCalledWith({
        email: 'pricing@test.com',
        name: 'Rosa',
      });
    });

    it('should skip NPS sequences gracefully', async () => {
      prisma.emailSequence.findMany.mockResolvedValue([
        {
          id: 'seq_7',
          sequenceKey: 'NPS',
          userId: 'user_5',
          leadId: null,
          metadata: {},
          scheduledAt: new Date(),
        },
      ]);
      prisma.user.findUnique.mockResolvedValue({
        email: 'nps@test.com',
        name: 'Jorge',
      });

      await processor.processDueSequences();
      // NPS should be skipped but still marked as sent
      expect(prisma.emailSequence.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'seq_7' } }),
      );
    });

    it('should skip when no recipient email is available', async () => {
      prisma.emailSequence.findMany.mockResolvedValue([
        {
          id: 'seq_8',
          sequenceKey: 'B2',
          userId: null,
          leadId: null,
          metadata: {},
          scheduledAt: new Date(),
        },
      ]);

      await processor.processDueSequences();
      // No email method should be called
      expect(email.sendDataSubmissionReminder).not.toHaveBeenCalled();
      // But update should still be called because it does not throw — the
      // fireSequence returns early but the outer loop still marks it sent.
      // Actually: looking at the code, fireSequence returns early without
      // marking — the outer loop still calls update. Let's verify.
      expect(prisma.emailSequence.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'seq_8' } }),
      );
    });

    it('should not throw when email send fails, and continue to next', async () => {
      prisma.emailSequence.findMany.mockResolvedValue([
        {
          id: 'seq_fail',
          sequenceKey: 'B2',
          userId: 'user_err',
          leadId: null,
          metadata: {},
          scheduledAt: new Date(),
        },
        {
          id: 'seq_ok',
          sequenceKey: 'B3',
          userId: 'user_ok',
          leadId: null,
          metadata: {},
          scheduledAt: new Date(),
        },
      ]);
      prisma.user.findUnique
        .mockResolvedValueOnce({ email: 'fail@test.com', name: 'Fail' })
        .mockResolvedValueOnce({ email: 'ok@test.com', name: 'OK' });
      email.sendDataSubmissionReminder.mockRejectedValue(
        new Error('SMTP down'),
      );

      await processor.processDueSequences();

      // The first one fails but the second should still process
      expect(email.sendOnboardingCheckIn).toHaveBeenCalledWith({
        email: 'ok@test.com',
        name: 'OK',
      });
    });

    it('handles unknown sequence key gracefully', async () => {
      prisma.emailSequence.findMany.mockResolvedValue([
        {
          id: 'seq-unknown',
          userId: 'u1',
          sequenceKey: 'UNKNOWN_KEY',
          step: 1,
          scheduledAt: new Date(Date.now() - 1000),
          status: 'pending',
        },
      ]);
      prisma.user.findUnique.mockResolvedValue({
        email: 'a@b.com',
        name: 'Test',
      });

      await processor.processDueSequences();

      expect(prisma.emailSequence.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'seq-unknown' },
        }),
      );
    });
  });
});
