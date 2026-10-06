import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

export interface ResellerProfile {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  primaryColor: string;
  domain: string | null;
  revenueSharePct: number;
  billingModel: string;
  isActive: boolean;
  clientCount: number;
  totalMRR: number;
}

@Injectable()
export class ResellerService {
  private readonly logger = new Logger(ResellerService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createReseller(data: {
    name: string;
    slug: string;
    logoUrl?: string;
    primaryColor?: string;
    domain?: string;
    revenueSharePct: number;
    billingModel?: string;
  }) {
    return this.prisma.reseller.create({
      data: {
        name: data.name,
        slug: data.slug,
        logoUrl: data.logoUrl,
        primaryColor: data.primaryColor ?? '#1B3A6B',
        domain: data.domain,
        revenueSharePct: data.revenueSharePct,
        billingModel: data.billingModel ?? 'PASS_THROUGH',
      },
    });
  }

  async getReseller(id: string): Promise<ResellerProfile> {
    const reseller = await this.prisma.reseller.findUnique({ where: { id } });
    if (!reseller) throw new NotFoundException('Reseller not found');
    return { ...reseller, clientCount: 0, totalMRR: 0 };
  }

  async getResellerBySlug(slug: string): Promise<ResellerProfile> {
    const reseller = await this.prisma.reseller.findUnique({ where: { slug } });
    if (!reseller) throw new NotFoundException('Reseller not found');
    return { ...reseller, clientCount: 0, totalMRR: 0 };
  }

  async listResellers() {
    return this.prisma.reseller.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      take: 100,
    });
  }

  async updateReseller(
    id: string,
    data: Partial<{
      name: string;
      logoUrl: string;
      primaryColor: string;
      domain: string;
      revenueSharePct: number;
    }>,
  ) {
    return this.prisma.reseller.update({ where: { id }, data });
  }
}
