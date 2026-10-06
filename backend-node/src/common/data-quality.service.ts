import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

/**
 * Data Validation Middleware
 * Validates incoming market data and ensures data quality
 */
@Injectable()
export class DataValidationMiddleware implements NestMiddleware {
  private readonly logger = new Logger(DataValidationMiddleware.name);

  use(req: Request, res: Response, next: NextFunction) {
    // Validate ticker symbols
    if (req.params.ticker) {
      const ticker = req.params.ticker;

      // Ticker validation rules
      if (!/^[A-Z]{1,5}$/.test(ticker as string)) {
        this.logger.warn(`Invalid ticker format: ${ticker}`);
        return res.status(400).json({
          error: 'Invalid ticker symbol',
          message: 'Ticker must be 1-5 uppercase letters',
        });
      }
    }

    // Validate date ranges
    if (req.query.startDate || req.query.endDate) {
      const startDate = req.query.startDate as string;
      const endDate = req.query.endDate as string;

      if (startDate && isNaN(Date.parse(startDate))) {
        return res.status(400).json({
          error: 'Invalid start date',
          message: 'Start date must be a valid ISO 8601 date',
        });
      }

      if (endDate && isNaN(Date.parse(endDate))) {
        return res.status(400).json({
          error: 'Invalid end date',
          message: 'End date must be a valid ISO 8601 date',
        });
      }

      // Ensure start date is before end date
      if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
        return res.status(400).json({
          error: 'Invalid date range',
          message: 'Start date must be before end date',
        });
      }
    }

    // Validate numerical parameters
    if (req.query.confidenceLevel) {
      const confidence = parseFloat(req.query.confidenceLevel as string);
      if (isNaN(confidence) || confidence <= 0 || confidence >= 1) {
        return res.status(400).json({
          error: 'Invalid confidence level',
          message: 'Confidence level must be between 0 and 1',
        });
      }
    }

    if (req.query.horizon) {
      const horizon = parseInt(req.query.horizon as string);
      if (isNaN(horizon) || horizon <= 0 || horizon > 365) {
        return res.status(400).json({
          error: 'Invalid horizon',
          message: 'Horizon must be between 1 and 365 days',
        });
      }
    }

    // Validate portfolio positions in request body
    if (req.body && req.body.positions) {
      const positions = req.body.positions;

      if (!Array.isArray(positions)) {
        return res.status(400).json({
          error: 'Invalid positions',
          message: 'Positions must be an array',
        });
      }

      for (const pos of positions) {
        if (!pos.ticker || typeof pos.ticker !== 'string') {
          return res.status(400).json({
            error: 'Invalid position',
            message: 'Each position must have a valid ticker',
          });
        }

        if (typeof pos.quantity !== 'number' || pos.quantity <= 0) {
          return res.status(400).json({
            error: 'Invalid position',
            message: 'Quantity must be a positive number',
          });
        }

        if (typeof pos.price !== 'number' || pos.price <= 0) {
          return res.status(400).json({
            error: 'Invalid position',
            message: 'Price must be a positive number',
          });
        }
      }
    }

    next();
  }
}

/**
 * Data Quality Service
 * Monitors and reports on data quality metrics
 */
@Injectable()
export class DataQualityService {
  private readonly logger = new Logger(DataQualityService.name);
  private qualityMetrics: Map<string, QualityMetric> = new Map();

  /**
   * Record data quality metric
   */
  recordMetric(source: string, metric: Partial<QualityMetric>) {
    const existing = this.qualityMetrics.get(source) || {
      source,
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      avgLatencyMs: 0,
      lastUpdated: new Date(),
    };

    const updated: QualityMetric = {
      ...existing,
      ...metric,
      totalRequests: existing.totalRequests + 1,
      lastUpdated: new Date(),
    };

    this.qualityMetrics.set(source, updated);
  }

  /**
   * Validate price data quality
   */
  validatePriceData(data: any[]): DataQualityReport {
    const issues: string[] = [];
    let validCount = 0;
    let invalidCount = 0;

    for (const point of data) {
      // Check for missing values
      if (point.close === null || point.close === undefined) {
        issues.push(`Missing close price at ${point.date}`);
        invalidCount++;
        continue;
      }

      // Check for negative prices
      if (point.close < 0) {
        issues.push(`Negative price detected: ${point.close} at ${point.date}`);
        invalidCount++;
        continue;
      }

      // Check for extreme price movements (>50% in one period - likely data error)
      if (data.indexOf(point) > 0) {
        const prevPoint = data[data.indexOf(point) - 1];
        const changePercent = Math.abs(
          (point.close - prevPoint.close) / prevPoint.close,
        );

        if (changePercent > 0.5) {
          issues.push(
            `Extreme price movement detected: ${(changePercent * 100).toFixed(
              2,
            )}% at ${point.date}`,
          );
          // Don't mark as invalid, just warn
        }
      }

      validCount++;
    }

    const qualitScore = data.length > 0 ? (validCount / data.length) * 100 : 0;

    return {
      totalPoints: data.length,
      validPoints: validCount,
      invalidPoints: invalidCount,
      qualityScore: Number(qualitScore.toFixed(2)),
      issues: issues.slice(0, 10), // Limit to first 10 issues
      timestamp: new Date(),
    };
  }

  /**
   * Get quality metrics for a source
   */
  getMetrics(
    source?: string,
  ): QualityMetric | Map<string, QualityMetric> | undefined {
    if (source) {
      return this.qualityMetrics.get(source);
    }
    return this.qualityMetrics;
  }

  /**
   * Get overall health status
   */
  getHealthStatus(): HealthStatus {
    const metrics = Array.from(this.qualityMetrics.values());

    if (metrics.length === 0) {
      return {
        status: 'healthy',
        message: 'No metrics available yet',
        details: {},
      };
    }

    const totalSuccess = metrics.reduce(
      (sum, m) => sum + m.successfulRequests,
      0,
    );
    const totalRequests = metrics.reduce((sum, m) => sum + m.totalRequests, 0);
    const successRate =
      totalRequests > 0 ? (totalSuccess / totalRequests) * 100 : 100;

    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (successRate < 99) status = 'degraded';
    if (successRate < 95) status = 'unhealthy';

    return {
      status,
      message: `${successRate.toFixed(2)}% success rate`,
      details: {
        totalSources: metrics.length,
        totalRequests,
        successRate: Number(successRate.toFixed(2)),
        avgLatency: Number(
          (
            metrics.reduce((sum, m) => sum + m.avgLatencyMs, 0) / metrics.length
          ).toFixed(2),
        ),
      },
    };
  }
}

interface QualityMetric {
  source: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  avgLatencyMs: number;
  lastUpdated: Date;
}

interface DataQualityReport {
  totalPoints: number;
  validPoints: number;
  invalidPoints: number;
  qualityScore: number;
  issues: string[];
  timestamp: Date;
}

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  message: string;
  details: Record<string, any>;
}
