import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

type InstitutionType =
  | 'bank'
  | 'credit_union'
  | 'family_office'
  | 'cooperativa';

interface SeedItem {
  category: 'asset' | 'liability';
  subcategory: string;
  name: string;
  balance: number;
  rate: number;
  duration: number;
  rateType: 'fixed' | 'variable';
}

interface SeedLiquidity {
  hqlaLevel1: number;
  hqlaLevel2: number;
  cashOutflows: number;
  cashInflows: number;
  lcr: number;
  nsfr: number;
}

interface SeedProfile {
  name: string;
  type: string;
  totalAssets: number;
  reportingDate: string;
  items: SeedItem[];
  liquidity: SeedLiquidity;
}

@Injectable()
export class WorkspaceOnboardingService {
  private readonly logger = new Logger(WorkspaceOnboardingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * @deprecated Use `InstitutionSeedService.seedFromFixture()` instead.
   *
   * This path was the original (non-idempotent) onboarding seeder — every
   * call creates a new institution, so re-running produces duplicates. It
   * is kept only to satisfy the deprecated `POST /api/alm/seed-demo`
   * endpoint for out-of-tree callers. All four profile shapes below are
   * mirrored as fixtures under `src/alm/data/fixtures/*.json` and consumed
   * by `InstitutionSeedService`, which upserts by `(workspaceId, seedKey)`.
   * New code must not call this method.
   */
  async seedDemoData(
    workspaceId: string,
    type: InstitutionType,
  ): Promise<{ institutionId: string }> {
    this.logger.log(`Seeding ${type} demo data for workspace ${workspaceId}`);

    const profile = this.getProfile(type);

    // Create institution
    const institution = await this.prisma.institution.create({
      data: {
        workspaceId,
        name: profile.name,
        type: profile.type,
        totalAssets: profile.totalAssets,
        currency: 'USD',
        reportingDate: new Date(profile.reportingDate),
      },
    });

    // Create balance sheet items
    await this.prisma.balanceSheetItem.createMany({
      data: profile.items.map((item) => ({
        institutionId: institution.id,
        ...item,
      })),
    });

    // Create liquidity position
    await this.prisma.liquidityPosition.create({
      data: {
        institutionId: institution.id,
        date: new Date(),
        ...profile.liquidity,
      },
    });

    this.logger.log(
      `Seeded ${profile.name}: ${profile.items.length} balance sheet items, 1 liquidity position`,
    );

    return { institutionId: institution.id };
  }

  private getProfile(type: InstitutionType): SeedProfile {
    switch (type) {
      case 'bank':
        return this.bankProfile();
      case 'credit_union':
        return this.creditUnionProfile();
      case 'family_office':
        return this.familyOfficeProfile();
      case 'cooperativa':
        return this.cooperativaProfile();
    }
  }

  // ─── Bank: Banco Comunidad PR ($1.2B) ────────────────────────

  private bankProfile(): SeedProfile {
    return {
      name: 'Banco Comunidad PR',
      type: 'bank',
      totalAssets: 1200,
      reportingDate: '2026-01-31',
      items: [
        // Assets ($1.2B)
        {
          category: 'asset',
          subcategory: 'residential_mortgages',
          name: 'Fixed Rate Mortgages',
          balance: 480,
          rate: 6.5,
          duration: 4.2,
          rateType: 'fixed',
        },
        {
          category: 'asset',
          subcategory: 'commercial_loans',
          name: 'Variable Rate Commercial Loans',
          balance: 300,
          rate: 8.2,
          duration: 0.5,
          rateType: 'variable',
        },
        {
          category: 'asset',
          subcategory: 'investment_securities',
          name: 'Investment Portfolio',
          balance: 240,
          rate: 4.1,
          duration: 2.8,
          rateType: 'fixed',
        },
        {
          category: 'asset',
          subcategory: 'cash_equivalents',
          name: 'Cash & HQLA',
          balance: 180,
          rate: 5.25,
          duration: 0.1,
          rateType: 'variable',
        },
        // Liabilities ($1.02B — equity ~$180M)
        {
          category: 'liability',
          subcategory: 'demand_deposits',
          name: 'Demand Deposits',
          balance: 357,
          rate: 0.5,
          duration: 0.1,
          rateType: 'variable',
        },
        {
          category: 'liability',
          subcategory: 'time_deposits',
          name: 'Time Deposits (CDs)',
          balance: 306,
          rate: 3.8,
          duration: 1.2,
          rateType: 'fixed',
        },
        {
          category: 'liability',
          subcategory: 'borrowings',
          name: 'FHLB Advances',
          balance: 204,
          rate: 5.5,
          duration: 2.1,
          rateType: 'fixed',
        },
        {
          category: 'liability',
          subcategory: 'other_liabilities',
          name: 'Subordinated Debt',
          balance: 153,
          rate: 6.0,
          duration: 4.5,
          rateType: 'fixed',
        },
      ],
      liquidity: {
        hqlaLevel1: 126, // Cash + govts
        hqlaLevel2: 54, // Agency MBS
        cashOutflows: 152.4,
        cashInflows: 0, // conservative
        lcr: 118.1,
        nsfr: 112.0,
      },
    };
  }

  // ─── Credit Union: CoopAhorro PR ($180M) ─────────────────────

  private creditUnionProfile(): SeedProfile {
    return {
      name: 'CoopAhorro PR',
      type: 'credit_union',
      totalAssets: 180,
      reportingDate: '2026-01-31',
      items: [
        // Assets ($180M)
        {
          category: 'asset',
          subcategory: 'consumer_loans',
          name: 'Auto Loans',
          balance: 54,
          rate: 7.8,
          duration: 2.5,
          rateType: 'fixed',
        },
        {
          category: 'asset',
          subcategory: 'residential_mortgages',
          name: 'Home Mortgages',
          balance: 63,
          rate: 5.9,
          duration: 5.0,
          rateType: 'fixed',
        },
        {
          category: 'asset',
          subcategory: 'investment_securities',
          name: 'Bond Portfolio',
          balance: 36,
          rate: 3.8,
          duration: 3.2,
          rateType: 'fixed',
        },
        {
          category: 'asset',
          subcategory: 'cash_equivalents',
          name: 'Cash & Reserves',
          balance: 27,
          rate: 5.0,
          duration: 0.1,
          rateType: 'variable',
        },
        // Liabilities ($162M — equity ~$18M)
        {
          category: 'liability',
          subcategory: 'savings_deposits',
          name: 'Member Savings',
          balance: 81,
          rate: 1.5,
          duration: 0.3,
          rateType: 'variable',
        },
        {
          category: 'liability',
          subcategory: 'demand_deposits',
          name: 'Checking Accounts',
          balance: 36,
          rate: 0.25,
          duration: 0.1,
          rateType: 'variable',
        },
        {
          category: 'liability',
          subcategory: 'time_deposits',
          name: 'Share Certificates',
          balance: 45,
          rate: 4.2,
          duration: 1.0,
          rateType: 'fixed',
        },
      ],
      liquidity: {
        hqlaLevel1: 21.6,
        hqlaLevel2: 5.4,
        cashOutflows: 23.4,
        cashInflows: 0,
        lcr: 115.4,
        nsfr: 108.0,
      },
    };
  }

  // ─── Family Office: Family Office Capital ($45M) ─────────────

  private familyOfficeProfile(): SeedProfile {
    return {
      name: 'Caribbean Family Capital',
      type: 'family_office',
      totalAssets: 45,
      reportingDate: '2026-01-31',
      items: [
        // Assets ($45M — equity-heavy)
        {
          category: 'asset',
          subcategory: 'investment_securities',
          name: 'Equity Portfolio',
          balance: 18,
          rate: 2.1,
          duration: 0.0,
          rateType: 'variable',
        },
        {
          category: 'asset',
          subcategory: 'investment_securities',
          name: 'Fixed Income',
          balance: 13.5,
          rate: 4.5,
          duration: 4.0,
          rateType: 'fixed',
        },
        {
          category: 'asset',
          subcategory: 'other_assets',
          name: 'Real Estate Holdings',
          balance: 9,
          rate: 3.5,
          duration: 8.0,
          rateType: 'fixed',
        },
        {
          category: 'asset',
          subcategory: 'cash_equivalents',
          name: 'Cash & T-Bills',
          balance: 4.5,
          rate: 5.1,
          duration: 0.1,
          rateType: 'variable',
        },
        // Liabilities ($9M — leverage ratio ~20%)
        {
          category: 'liability',
          subcategory: 'borrowings',
          name: 'Margin Facility',
          balance: 4.5,
          rate: 6.5,
          duration: 0.25,
          rateType: 'variable',
        },
        {
          category: 'liability',
          subcategory: 'borrowings',
          name: 'Real Estate Mortgage',
          balance: 4.5,
          rate: 5.8,
          duration: 15.0,
          rateType: 'fixed',
        },
      ],
      liquidity: {
        hqlaLevel1: 4.5,
        hqlaLevel2: 0,
        cashOutflows: 2.25,
        cashInflows: 0,
        lcr: 200.0,
        nsfr: 150.0,
      },
    };
  }

  // ─── Cooperativa: Cooperativa de Ahorro y Crédito ($250M) ───
  // Realistic PR cooperativa: ~35,000 members, COSSEC-regulated
  // Balance sheet based on industry averages from COSSEC annual reports

  private cooperativaProfile(): SeedProfile {
    return {
      name: 'CoopAhorro San Juan',
      type: 'cooperativa',
      totalAssets: 250,
      reportingDate: '2026-01-31',
      items: [
        // Assets ($250M)
        {
          category: 'asset',
          subcategory: 'consumer_loans',
          name: 'Préstamos Auto y Personal',
          balance: 75,
          rate: 8.5,
          duration: 3.0,
          rateType: 'fixed',
        },
        {
          category: 'asset',
          subcategory: 'residential_mortgages',
          name: 'Préstamos Hipotecarios',
          balance: 90,
          rate: 6.25,
          duration: 12.0,
          rateType: 'fixed',
        },
        {
          category: 'asset',
          subcategory: 'commercial_loans',
          name: 'Préstamos Comerciales',
          balance: 25,
          rate: 9.0,
          duration: 2.0,
          rateType: 'variable',
        },
        {
          category: 'asset',
          subcategory: 'investment_securities',
          name: 'Bonos e Inversiones',
          balance: 40,
          rate: 4.5,
          duration: 3.5,
          rateType: 'fixed',
        },
        {
          category: 'asset',
          subcategory: 'cash_equivalents',
          name: 'Efectivo y Equivalentes',
          balance: 20,
          rate: 5.25,
          duration: 0.1,
          rateType: 'variable',
        },
        // Liabilities ($225M — equity ~$25M, 10% capital ratio)
        {
          category: 'liability',
          subcategory: 'savings_deposits',
          name: 'Ahorros de Socios',
          balance: 85,
          rate: 1.75,
          duration: 0.3,
          rateType: 'variable',
        },
        {
          category: 'liability',
          subcategory: 'time_deposits',
          name: 'Certificados de Acción',
          balance: 55,
          rate: 4.5,
          duration: 1.2,
          rateType: 'fixed',
        },
        {
          category: 'liability',
          subcategory: 'demand_deposits',
          name: 'Cuentas Corrientes',
          balance: 35,
          rate: 0.25,
          duration: 0.1,
          rateType: 'variable',
        },
        {
          category: 'liability',
          subcategory: 'borrowings',
          name: 'Préstamos FHLB',
          balance: 30,
          rate: 5.5,
          duration: 2.0,
          rateType: 'fixed',
        },
        {
          category: 'liability',
          subcategory: 'time_deposits',
          name: 'Depósitos a Plazo',
          balance: 20,
          rate: 3.8,
          duration: 0.8,
          rateType: 'fixed',
        },
      ],
      liquidity: {
        hqlaLevel1: 18, // Cash + govt securities
        hqlaLevel2: 5, // Agency MBS
        cashOutflows: 19.5,
        cashInflows: 0,
        lcr: 117.9,
        nsfr: 109.0,
      },
    };
  }
}
