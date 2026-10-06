// ─── HJM Quant Module ───────────────────────────────────────────
//
// NestJS module exporting the HJM two-factor forward-curve engine.
//
// Services:
//   - HJMCalibrationService: PCA-based calibration from historical rates
//   - HJMMonteCarloService:  Full forward-curve Monte Carlo simulation
//   - HJMService:            Orchestrator (pulls balance sheet from Prisma)
//
// Pure utilities (not Injectable, imported directly):
//   - ForwardCurve:          Spot/forward bootstrapping, shocks, interpolation
//   - calibrateHJM():        Pure-function calibration engine
//   - runHJMMonteCarlo():    Pure-function Monte Carlo engine

import { Module } from '@nestjs/common';
import { HJMCalibrationService } from './hjm-calibration.service';
import { HJMMonteCarloService } from './hjm-monte-carlo.service';
import { HJMService } from './hjm/hjm.service';

@Module({
  providers: [HJMCalibrationService, HJMMonteCarloService, HJMService],
  exports: [HJMCalibrationService, HJMMonteCarloService, HJMService],
})
export class HJMModule {}
