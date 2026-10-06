import { Controller, Get, Query } from '@nestjs/common';

interface ChangelogEntry {
  version: string;
  date: string;
  changes: string[];
}

const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.4.0',
    date: '2026-03-28',
    changes: [
      'Added FRTB-IMA Expected Shortfall module',
      'Improved bilingual PDF report generation',
      'New CAMEL composite scoring with peer benchmarks',
    ],
  },
  {
    version: '1.3.0',
    date: '2026-02-15',
    changes: [
      'Credit Copula model (Gaussian & Student-t)',
      'Wrong-Way Risk CVA adjustments',
      'COSSEC quarterly report automation',
    ],
  },
  {
    version: '1.2.0',
    date: '2026-01-10',
    changes: [
      'Black-Litterman portfolio optimizer',
      'HRP dendrogram clustering',
      'Enhanced Monte Carlo with Vasicek 10K paths',
    ],
  },
];

/**
 * Public endpoint exposing the API changelog.
 * Useful for integrators tracking breaking changes.
 */
// verify:auth-skip-controller — public product changelog for integrators tracking breaking changes
@Controller('api/v1/changelog')
export class ChangelogController {
  @Get()
  getChangelog(@Query('limit') limit?: string): ChangelogEntry[] {
    const n = Math.min(Math.max(parseInt(limit ?? '10', 10) || 10, 1), 50);
    return CHANGELOG.slice(0, n);
  }
}
