import { Injectable } from '@nestjs/common';
import { COMPLIANCE_MODULES } from './compliance-registry.data';
import {
  ComplianceCategory,
  ComplianceCoverageReport,
  ComplianceGap,
  ComplianceModuleEntry,
  ModuleStatus,
  RegulatoryBody,
} from './compliance-registry.types';

@Injectable()
export class ComplianceRegistryService {
  private readonly modules: ReadonlyArray<ComplianceModuleEntry> =
    COMPLIANCE_MODULES;

  listAll(): ComplianceModuleEntry[] {
    return [...this.modules];
  }

  getById(moduleId: string): ComplianceModuleEntry | undefined {
    return this.modules.find((m) => m.moduleId === moduleId);
  }

  filterByCategory(category: ComplianceCategory): ComplianceModuleEntry[] {
    return this.modules.filter((m) => m.category === category);
  }

  filterByRegulator(body: RegulatoryBody): ComplianceModuleEntry[] {
    return this.modules.filter((m) =>
      m.regulatoryReferences.some((r) => r.body === body),
    );
  }

  filterByStatus(status: ModuleStatus): ComplianceModuleEntry[] {
    return this.modules.filter((m) => m.status === status);
  }

  getValidated(): ComplianceModuleEntry[] {
    return this.filterByStatus(ModuleStatus.VALIDATED);
  }

  getGaps(): ComplianceGap[] {
    const gaps: ComplianceGap[] = [];

    for (const mod of this.modules) {
      if (mod.status === ModuleStatus.PLANNED) {
        gaps.push({
          moduleId: mod.moduleId,
          moduleName: mod.name,
          category: mod.category,
          reason: `Module planned but not yet implemented`,
          severity: 'WARNING',
        });
      }
      if (mod.status === ModuleStatus.IN_PROGRESS) {
        gaps.push({
          moduleId: mod.moduleId,
          moduleName: mod.name,
          category: mod.category,
          reason: `Module in progress — not yet validated for production`,
          severity: 'WARNING',
        });
      }
    }

    const cossecRequired = this.filterByRegulator(RegulatoryBody.COSSEC);
    const cossecNotValidated = cossecRequired.filter(
      (m) => m.status !== ModuleStatus.VALIDATED,
    );
    for (const mod of cossecNotValidated) {
      gaps.push({
        moduleId: mod.moduleId,
        moduleName: mod.name,
        category: mod.category,
        reason: `COSSEC-required module not yet validated`,
        severity: 'CRITICAL',
      });
    }

    return gaps;
  }

  getCoverageReport(): ComplianceCoverageReport {
    const byCategory = {} as ComplianceCoverageReport['byCategory'];
    const byRegulator = {} as ComplianceCoverageReport['byRegulator'];

    for (const cat of Object.values(ComplianceCategory)) {
      const inCat = this.modules.filter((m) => m.category === cat);
      byCategory[cat] = {
        total: inCat.length,
        validated: inCat.filter((m) => m.status === ModuleStatus.VALIDATED)
          .length,
      };
    }

    for (const body of Object.values(RegulatoryBody)) {
      const refd = this.modules.filter((m) =>
        m.regulatoryReferences.some((r) => r.body === body),
      );
      byRegulator[body] = {
        total: refd.length,
        validated: refd.filter((m) => m.status === ModuleStatus.VALIDATED)
          .length,
      };
    }

    return {
      totalModules: this.modules.length,
      validated: this.modules.filter((m) => m.status === ModuleStatus.VALIDATED)
        .length,
      inProgress: this.modules.filter(
        (m) => m.status === ModuleStatus.IN_PROGRESS,
      ).length,
      planned: this.modules.filter((m) => m.status === ModuleStatus.PLANNED)
        .length,
      byCategory,
      byRegulator,
      gaps: this.getGaps(),
    };
  }

  getDependencyGraph(): Record<string, string[]> {
    const graph: Record<string, string[]> = {};
    for (const mod of this.modules) {
      graph[mod.moduleId] = mod.dependsOn;
    }
    return graph;
  }

  getThresholds(
    moduleId: string,
  ): ComplianceModuleEntry['thresholds'] | undefined {
    return this.getById(moduleId)?.thresholds;
  }

  search(query: string): ComplianceModuleEntry[] {
    const q = query.toLowerCase();
    return this.modules.filter(
      (m) =>
        m.moduleId.toLowerCase().includes(q) ||
        m.name.toLowerCase().includes(q) ||
        m.nameEs.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q) ||
        m.category.toLowerCase().includes(q) ||
        m.regulatoryReferences.some(
          (r) =>
            r.citation.toLowerCase().includes(q) ||
            r.body.toLowerCase().includes(q),
        ),
    );
  }
}
