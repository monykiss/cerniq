export { golden011DailySurveillance } from './golden-011-daily-surveillance';
export { golden012EarlyWarningTrigger } from './golden-012-early-warning-trigger';

import { golden011DailySurveillance } from './golden-011-daily-surveillance';
import { golden012EarlyWarningTrigger } from './golden-012-early-warning-trigger';

import type { GoldenCase } from '../../../src/agent-eval/contracts';

export const RISK_MONITOR_GOLDENS: readonly GoldenCase[] = [
  golden011DailySurveillance,
  golden012EarlyWarningTrigger,
];
