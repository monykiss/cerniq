export { golden016CamelSelfAssessment } from './golden-016-camel-self-assessment';
export { golden021FirstExamUnprepared } from './golden-021-first-exam-unprepared';
export { golden022RepeatFindings } from './golden-022-repeat-findings';
export { golden023WellPrepared } from './golden-023-well-prepared';
export { golden024CapitalAdequacyFocus } from './golden-024-capital-adequacy-focus';
export { golden025LiquidityWeakness } from './golden-025-liquidity-weakness';
export { golden026IrrPolicyGap } from './golden-026-irr-policy-gap';
export { golden027AssetQualityConcern } from './golden-027-asset-quality-concern';

import { golden016CamelSelfAssessment } from './golden-016-camel-self-assessment';
import { golden021FirstExamUnprepared } from './golden-021-first-exam-unprepared';
import { golden022RepeatFindings } from './golden-022-repeat-findings';
import { golden023WellPrepared } from './golden-023-well-prepared';
import { golden024CapitalAdequacyFocus } from './golden-024-capital-adequacy-focus';
import { golden025LiquidityWeakness } from './golden-025-liquidity-weakness';
import { golden026IrrPolicyGap } from './golden-026-irr-policy-gap';
import { golden027AssetQualityConcern } from './golden-027-asset-quality-concern';

import type { GoldenCase } from '../../../src/agent-eval/contracts';

export const EXAM_PREP_GOLDENS: readonly GoldenCase[] = [
  golden016CamelSelfAssessment,
  golden021FirstExamUnprepared,
  golden022RepeatFindings,
  golden023WellPrepared,
  golden024CapitalAdequacyFocus,
  golden025LiquidityWeakness,
  golden026IrrPolicyGap,
  golden027AssetQualityConcern,
];
