import { RateAlertService } from './rate-alert.service';

// ─── Helpers ─────────────────────────────────────────────────

function buildMockPrisma() {
  return {
    rateAlertThreshold: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({}),
    },
  } as any;
}

function buildService(prisma = buildMockPrisma()) {
  return new RateAlertService(prisma);
}

// ─── Tests ───────────────────────────────────────────────────

describe('RateAlertService', () => {
  // ── ABOVE direction ───────────────────────────────────────

  describe('threshold ABOVE direction', () => {
    it('should trigger when value exceeds the WARN level', async () => {
      const service = buildService();

      await service.setThreshold('inst-1', {
        metric: 'niiSensitivity',
        warnLevel: 5.0,
        breachLevel: 8.0,
        direction: 'ABOVE',
        notifyEmail: false,
        notifyWebhook: false,
      });

      const alerts = await service.checkThresholds('inst-1', {
        niiSensitivity: 6.0, // above WARN (5.0) but below BREACH (8.0)
      });

      expect(alerts).toHaveLength(1);
      expect(alerts[0].level).toBe('WARN');
      expect(alerts[0].currentValue).toBe(6.0);
      expect(alerts[0].threshold).toBe(5.0);
      expect(alerts[0].direction).toBe('ABOVE');
    });

    it('should trigger BREACH when value exceeds the BREACH level', async () => {
      const service = buildService();

      await service.setThreshold('inst-1', {
        metric: 'durationGap',
        warnLevel: 2.0,
        breachLevel: 3.5,
        direction: 'ABOVE',
        notifyEmail: false,
        notifyWebhook: false,
      });

      const alerts = await service.checkThresholds('inst-1', {
        durationGap: 4.0, // above BREACH (3.5)
      });

      expect(alerts).toHaveLength(1);
      expect(alerts[0].level).toBe('BREACH');
      expect(alerts[0].currentValue).toBe(4.0);
      expect(alerts[0].threshold).toBe(3.5);
    });
  });

  // ── BELOW direction ───────────────────────────────────────

  describe('threshold BELOW direction', () => {
    it('should trigger when value drops below the WARN level', async () => {
      const service = buildService();

      await service.setThreshold('inst-2', {
        metric: 'lcr',
        warnLevel: 120,
        breachLevel: 100,
        direction: 'BELOW',
        notifyEmail: false,
        notifyWebhook: false,
      });

      const alerts = await service.checkThresholds('inst-2', {
        lcr: 110, // below WARN (120) but above BREACH (100)
      });

      expect(alerts).toHaveLength(1);
      expect(alerts[0].level).toBe('WARN');
      expect(alerts[0].currentValue).toBe(110);
      expect(alerts[0].threshold).toBe(120);
      expect(alerts[0].direction).toBe('BELOW');
    });

    it('should trigger BREACH when value drops below the BREACH level', async () => {
      const service = buildService();

      await service.setThreshold('inst-2', {
        metric: 'lcr',
        warnLevel: 120,
        breachLevel: 100,
        direction: 'BELOW',
        notifyEmail: false,
        notifyWebhook: false,
      });

      const alerts = await service.checkThresholds('inst-2', {
        lcr: 95, // below BREACH (100)
      });

      expect(alerts).toHaveLength(1);
      expect(alerts[0].level).toBe('BREACH');
      expect(alerts[0].currentValue).toBe(95);
      expect(alerts[0].threshold).toBe(100);
    });
  });

  // ── WARN vs BREACH ────────────────────────────────────────

  describe('WARN vs BREACH levels', () => {
    it('WARN fires at warnLevel, BREACH fires at breachLevel', async () => {
      const service = buildService();

      await service.setThreshold('inst-3', {
        metric: 'eveChange',
        warnLevel: -5.0,
        breachLevel: -10.0,
        direction: 'BELOW',
        notifyEmail: false,
        notifyWebhook: false,
      });

      // Test WARN
      const warnAlerts = await service.checkThresholds('inst-3', {
        eveChange: -6.0, // below -5.0 WARN, above -10.0 BREACH
      });
      expect(warnAlerts).toHaveLength(1);
      expect(warnAlerts[0].level).toBe('WARN');

      // Test BREACH
      const breachAlerts = await service.checkThresholds('inst-3', {
        eveChange: -11.0, // below -10.0 BREACH
      });
      expect(breachAlerts).toHaveLength(1);
      expect(breachAlerts[0].level).toBe('BREACH');
    });
  });

  // ── No alert ──────────────────────────────────────────────

  describe('no alert when within thresholds', () => {
    it('should return empty array when value is safe', async () => {
      const service = buildService();

      await service.setThreshold('inst-4', {
        metric: 'niiSensitivity',
        warnLevel: 5.0,
        breachLevel: 8.0,
        direction: 'ABOVE',
        notifyEmail: false,
        notifyWebhook: false,
      });

      const alerts = await service.checkThresholds('inst-4', {
        niiSensitivity: 3.0, // safely below WARN
      });

      expect(alerts).toHaveLength(0);
    });

    it('should return empty when metric is not tracked', async () => {
      const service = buildService();

      // No threshold set for 'unknown'
      const alerts = await service.checkThresholds('inst-5', {
        unknown: 999,
      });

      expect(alerts).toHaveLength(0);
    });
  });

  // ── Bilingual messages ────────────────────────────────────

  describe('bilingual alert messages', () => {
    it('should include both English and Spanish messages', async () => {
      const service = buildService();

      await service.setThreshold('inst-6', {
        metric: 'durationGap',
        warnLevel: 2.0,
        breachLevel: 3.5,
        direction: 'ABOVE',
        notifyEmail: false,
        notifyWebhook: false,
      });

      const alerts = await service.checkThresholds('inst-6', {
        durationGap: 2.5,
      });

      expect(alerts).toHaveLength(1);
      expect(alerts[0].message).toBeDefined();
      expect(alerts[0].messageEs).toBeDefined();
      expect(alerts[0].message).toContain('WARNING');
      expect(alerts[0].message).toContain('exceeded');
      expect(alerts[0].messageEs).toContain('ADVERTENCIA');
      expect(alerts[0].messageEs).toContain('excedio');
    });

    it('BREACH alert messages contain BREACH / ALERTA CRITICA', async () => {
      const service = buildService();

      await service.setThreshold('inst-7', {
        metric: 'lcr',
        warnLevel: 120,
        breachLevel: 100,
        direction: 'BELOW',
        notifyEmail: false,
        notifyWebhook: false,
      });

      const alerts = await service.checkThresholds('inst-7', {
        lcr: 90,
      });

      expect(alerts).toHaveLength(1);
      expect(alerts[0].message).toContain('BREACH');
      expect(alerts[0].messageEs).toContain('ALERTA CRITICA');
      expect(alerts[0].message).toContain('dropped below');
      expect(alerts[0].messageEs).toContain('cayo por debajo de');
    });
  });

  // ── Active alerts lifecycle ───────────────────────────────

  describe('active alerts', () => {
    it('should track active alerts and clear when back within thresholds', async () => {
      const service = buildService();

      await service.setThreshold('inst-8', {
        metric: 'niiSensitivity',
        warnLevel: 5.0,
        breachLevel: 8.0,
        direction: 'ABOVE',
        notifyEmail: false,
        notifyWebhook: false,
      });

      // Trigger alert
      await service.checkThresholds('inst-8', { niiSensitivity: 6.0 });
      let active = await service.getActiveAlerts('inst-8');
      expect(active).toHaveLength(1);

      // Value returns to safe zone
      await service.checkThresholds('inst-8', { niiSensitivity: 3.0 });
      active = await service.getActiveAlerts('inst-8');
      expect(active).toHaveLength(0);
    });
  });

  // ── Threshold CRUD ────────────────────────────────────────

  describe('threshold management', () => {
    it('should set and retrieve thresholds', async () => {
      const service = buildService();

      const created = await service.setThreshold('inst-9', {
        metric: 'sofr',
        warnLevel: 0.05,
        breachLevel: 0.06,
        direction: 'ABOVE',
        notifyEmail: false,
        notifyWebhook: false,
      });

      expect(created.institutionId).toBe('inst-9');
      expect(created.metric).toBe('sofr');
      expect(created.warnLevel).toBe(0.05);

      const all = await service.getThresholds('inst-9');
      expect(all).toHaveLength(1);
    });

    it('should remove thresholds', async () => {
      const service = buildService();

      await service.setThreshold('inst-10', {
        metric: 'durationGap',
        warnLevel: 2.0,
        breachLevel: 3.5,
        direction: 'ABOVE',
        notifyEmail: false,
        notifyWebhook: false,
      });

      await service.removeThreshold('inst-10', 'durationGap');
      const all = await service.getThresholds('inst-10');
      expect(all).toHaveLength(0);
    });
  });
});
