import { UdepositUmixUoptimizerService } from './deposit-mix-optimizer.service';

describe('UdepositUmixUoptimizerService', () => {
  const svc = new UdepositUmixUoptimizerService();

  it('analyze returns result with interpretation', () => {
    const r = svc.analyze({ test: 1 });
    expect(r.result).toEqual({ test: 1 });
    expect(r.interpretation).toBeTruthy();
    expect(r.interpretationEs).toBeTruthy();
  });
});
