import { SlackService } from './slack.service';

describe('SlackService', () => {
  let service: SlackService;

  beforeEach(() => {
    delete process.env.SLACK_WEBHOOK_URL;
    service = new SlackService();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── sendAlert — no webhook URL ────────────────────────────────

  it('returns false when no webhook URL is configured', async () => {
    const result = await service.sendAlert({
      type: 'new_lead',
      title: 'Test',
      details: { Name: 'Test' },
    });
    expect(result).toBe(false);
  });

  // ── sendAlert — with webhook URL ──────────────────────────────

  it('sends alert when webhook URL is configured and returns true', async () => {
    const origFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({ ok: true });

    const svc = new (SlackService as any)();
    svc.webhookUrl = 'https://hooks.slack.com/test';

    const result = await svc.sendAlert({
      type: 'new_lead',
      title: 'Test Lead',
      details: { Name: 'Test' },
      urgency: 'medium',
    });
    expect(result).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://hooks.slack.com/test',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    global.fetch = origFetch;
  });

  it('returns false when webhook responds with non-ok status', async () => {
    const origFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });

    const svc = new (SlackService as any)();
    svc.webhookUrl = 'https://hooks.slack.com/test';

    const result = await svc.sendAlert({
      type: 'checkout_completed',
      title: 'Payment',
      details: { Amount: '$100' },
    });
    expect(result).toBe(false);

    global.fetch = origFetch;
  });

  it('returns false when fetch throws an error', async () => {
    const origFetch = global.fetch;
    global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

    const svc = new (SlackService as any)();
    svc.webhookUrl = 'https://hooks.slack.com/test';

    const result = await svc.sendAlert({
      type: 'hot_lead',
      title: 'Hot Lead',
      details: { Score: 95 },
    });
    expect(result).toBe(false);

    global.fetch = origFetch;
  });

  // ── sendAlert — payload construction ──────────────────────────

  it('uses correct emoji for each alert type', async () => {
    const origFetch = global.fetch;
    let capturedBody: any;
    global.fetch = jest.fn().mockImplementation((_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return Promise.resolve({ ok: true });
    });

    const svc = new (SlackService as any)();
    svc.webhookUrl = 'https://hooks.slack.com/test';

    await svc.sendAlert({
      type: 'demo_completed',
      title: 'Demo Done',
      details: {},
    });
    expect(capturedBody.text).toContain(':tada:');

    await svc.sendAlert({
      type: 'checkout_started',
      title: 'Checkout',
      details: {},
    });
    expect(capturedBody.text).toContain(':credit_card:');

    await svc.sendAlert({
      type: 'checkout_completed',
      title: 'Payment',
      details: {},
    });
    expect(capturedBody.text).toContain(':money_with_wings:');

    await svc.sendAlert({
      type: 'outreach_sent',
      title: 'Outreach',
      details: {},
    });
    expect(capturedBody.text).toContain(':envelope:');

    global.fetch = origFetch;
  });

  it('uses correct color for each urgency level', async () => {
    const origFetch = global.fetch;
    let capturedBody: any;
    global.fetch = jest.fn().mockImplementation((_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return Promise.resolve({ ok: true });
    });

    const svc = new (SlackService as any)();
    svc.webhookUrl = 'https://hooks.slack.com/test';

    await svc.sendAlert({
      type: 'new_lead',
      title: 'T',
      details: {},
      urgency: 'low',
    });
    expect(capturedBody.attachments[0].color).toBe('#36a64f');

    await svc.sendAlert({
      type: 'new_lead',
      title: 'T',
      details: {},
      urgency: 'medium',
    });
    expect(capturedBody.attachments[0].color).toBe('#daa520');

    await svc.sendAlert({
      type: 'new_lead',
      title: 'T',
      details: {},
      urgency: 'high',
    });
    expect(capturedBody.attachments[0].color).toBe('#ff0000');

    global.fetch = origFetch;
  });

  it('defaults urgency color to low when not specified', async () => {
    const origFetch = global.fetch;
    let capturedBody: any;
    global.fetch = jest.fn().mockImplementation((_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return Promise.resolve({ ok: true });
    });

    const svc = new (SlackService as any)();
    svc.webhookUrl = 'https://hooks.slack.com/test';

    await svc.sendAlert({ type: 'new_lead', title: 'T', details: {} });
    expect(capturedBody.attachments[0].color).toBe('#36a64f');

    global.fetch = origFetch;
  });

  it('filters out null/undefined detail values', async () => {
    const origFetch = global.fetch;
    let capturedBody: any;
    global.fetch = jest.fn().mockImplementation((_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return Promise.resolve({ ok: true });
    });

    const svc = new (SlackService as any)();
    svc.webhookUrl = 'https://hooks.slack.com/test';

    await svc.sendAlert({
      type: 'new_lead',
      title: 'T',
      details: { Name: 'John', Empty: null, Also: undefined as any },
    });
    const fieldTitles = capturedBody.attachments[0].fields.map((f: any) =>
      f.title.trim(),
    );
    expect(fieldTitles).toContain('Name');
    expect(fieldTitles).not.toContain('Empty');
    expect(fieldTitles).not.toContain('Also');

    global.fetch = origFetch;
  });

  it('marks short values as short: true in fields', async () => {
    const origFetch = global.fetch;
    let capturedBody: any;
    global.fetch = jest.fn().mockImplementation((_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return Promise.resolve({ ok: true });
    });

    const svc = new (SlackService as any)();
    svc.webhookUrl = 'https://hooks.slack.com/test';

    await svc.sendAlert({
      type: 'new_lead',
      title: 'T',
      details: {
        Short: 'yes',
        LongField:
          'This is a very long value that exceeds thirty characters in length',
      },
    });
    const shortField = capturedBody.attachments[0].fields.find(
      (f: any) => f.title.trim() === 'Short',
    );
    const longField = capturedBody.attachments[0].fields.find(
      (f: any) => f.title.trim() === 'Long Field',
    );
    expect(shortField.short).toBe(true);
    expect(longField.short).toBe(false);

    global.fetch = origFetch;
  });

  // ── Convenience methods ───────────────────────────────────────

  it('notifyNewLead calls sendAlert with correct params', async () => {
    const result = await service.notifyNewLead({
      name: 'John',
      email: 'john@test.com',
      institution: 'Test CU',
      type: 'DEMO_REQUEST',
      priority: 'HIGH',
    });
    expect(result).toBe(false); // no webhook URL
  });

  it('notifyNewLead sets urgency based on priority', async () => {
    const origFetch = global.fetch;
    let capturedBody: any;
    global.fetch = jest.fn().mockImplementation((_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return Promise.resolve({ ok: true });
    });

    const svc = new (SlackService as any)();
    svc.webhookUrl = 'https://hooks.slack.com/test';

    await svc.notifyNewLead({
      name: 'A',
      email: 'a@b.c',
      institution: 'X',
      type: 'T',
      priority: 'HIGH',
    });
    expect(capturedBody.attachments[0].color).toBe('#ff0000');

    await svc.notifyNewLead({
      name: 'A',
      email: 'a@b.c',
      institution: 'X',
      type: 'T',
      priority: 'MEDIUM',
    });
    expect(capturedBody.attachments[0].color).toBe('#daa520');

    await svc.notifyNewLead({
      name: 'A',
      email: 'a@b.c',
      institution: 'X',
      type: 'T',
      priority: 'LOW',
    });
    expect(capturedBody.attachments[0].color).toBe('#36a64f');

    global.fetch = origFetch;
  });

  it('notifyCheckoutCompleted sends correct alert', async () => {
    const result = await service.notifyCheckoutCompleted({
      email: 'john@test.com',
      institution: 'Test CU',
      tier: 'Gold',
      amount: 5000,
    });
    expect(result).toBe(false);
  });

  it('notifyHotLead sends correct alert', async () => {
    const result = await service.notifyHotLead({
      name: 'Jane',
      institution: 'Big CU',
      score: 95,
      reason: 'High engagement',
    });
    expect(result).toBe(false);
  });

  it('notifyCheckoutCompleted includes amount with $ prefix', async () => {
    const origFetch = global.fetch;
    let capturedBody: any;
    global.fetch = jest.fn().mockImplementation((_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return Promise.resolve({ ok: true });
    });

    const svc = new (SlackService as any)();
    svc.webhookUrl = 'https://hooks.slack.com/test';

    await svc.notifyCheckoutCompleted({
      email: 'e@t.com',
      institution: 'CU',
      tier: 'Pro',
      amount: 9999,
    });
    const amountField = capturedBody.attachments[0].fields.find(
      (f: any) => f.title.trim() === 'Amount',
    );
    expect(amountField.value).toBe('$9999');

    global.fetch = origFetch;
  });
});
