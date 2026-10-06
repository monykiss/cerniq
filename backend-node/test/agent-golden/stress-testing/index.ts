export { golden013CossecScenarioBattery } from './golden-013-cossec-scenario-battery';
export { golden030ParallelRateShock } from './golden-030-parallel-rate-shock';
export { golden031HurricaneLiquidityDrain } from './golden-031-hurricane-liquidity-drain';
export { golden032CapitalErosionSevere } from './golden-032-capital-erosion-severe';
export { golden033RapidRateRise } from './golden-033-rapid-rate-rise';
export { golden034YieldCurveInversion } from './golden-034-yield-curve-inversion';
export { golden035CombinedMultiFactor } from './golden-035-combined-multi-factor';
export { golden036HealthyResilient } from './golden-036-healthy-resilient';

import { golden013CossecScenarioBattery } from './golden-013-cossec-scenario-battery';
import { golden030ParallelRateShock } from './golden-030-parallel-rate-shock';
import { golden031HurricaneLiquidityDrain } from './golden-031-hurricane-liquidity-drain';
import { golden032CapitalErosionSevere } from './golden-032-capital-erosion-severe';
import { golden033RapidRateRise } from './golden-033-rapid-rate-rise';
import { golden034YieldCurveInversion } from './golden-034-yield-curve-inversion';
import { golden035CombinedMultiFactor } from './golden-035-combined-multi-factor';
import { golden036HealthyResilient } from './golden-036-healthy-resilient';

import type { GoldenCase } from '../../../src/agent-eval/contracts';

export const STRESS_TESTING_GOLDENS: readonly GoldenCase[] = [
  golden013CossecScenarioBattery,
  golden030ParallelRateShock,
  golden031HurricaneLiquidityDrain,
  golden032CapitalErosionSevere,
  golden033RapidRateRise,
  golden034YieldCurveInversion,
  golden035CombinedMultiFactor,
  golden036HealthyResilient,
];
