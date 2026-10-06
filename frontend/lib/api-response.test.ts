import { describe, expect, it } from 'vitest';
import { asRecord, unwrapApiData } from './api-response';

describe('api response helpers', () => {
  it('unwraps the standard success envelope', () => {
    expect(
      unwrapApiData<{ tier: string }>({
        success: true,
        data: { tier: 'monthly' },
      }),
    ).toEqual({ tier: 'monthly' });
  });

  it('passes through plain payloads unchanged', () => {
    expect(unwrapApiData([{ id: 'job-1' }])).toEqual([{ id: 'job-1' }]);
  });

  it('only treats objects as records', () => {
    expect(asRecord(null)).toBeNull();
    expect(asRecord('text')).toBeNull();
    expect(asRecord({ ok: true })).toEqual({ ok: true });
  });
});
