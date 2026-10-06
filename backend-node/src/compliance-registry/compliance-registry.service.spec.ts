import { describe, it, expect, beforeEach } from '@jest/globals';
import { ComplianceRegistryService } from './compliance-registry.service';
import {
  ComplianceCategory,
  ModuleStatus,
  RegulatoryBody,
} from './compliance-registry.types';

describe('ComplianceRegistryService', () => {
  let service: ComplianceRegistryService;

  beforeEach(() => {
    service = new ComplianceRegistryService();
  });

  describe('listAll', () => {
    it('returns all 62 modules', () => {
      const all = service.listAll();
      expect(all).toHaveLength(62);
    });

    it('returns a copy, not the original array', () => {
      const a = service.listAll();
      const b = service.listAll();
      expect(a).not.toBe(b);
      expect(a).toEqual(b);
    });
  });

  describe('getById', () => {
    it('returns M-01 Duration Gap Analysis', () => {
      const mod = service.getById('M-01');
      expect(mod).toBeDefined();
      expect(mod!.name).toBe('Duration Gap Analysis');
      expect(mod!.category).toBe(ComplianceCategory.INTEREST_RATE_RISK);
    });

    it('returns M-62 COSSEC Ratio Summary', () => {
      const mod = service.getById('M-62');
      expect(mod).toBeDefined();
      expect(mod!.name).toBe('COSSEC Ratio Summary (12 Ratios)');
    });

    it('returns undefined for non-existent module', () => {
      expect(service.getById('M-99')).toBeUndefined();
    });
  });

  describe('filterByCategory', () => {
    it('returns 10 interest rate risk modules', () => {
      const irr = service.filterByCategory(
        ComplianceCategory.INTEREST_RATE_RISK,
      );
      expect(irr).toHaveLength(10);
      expect(irr.every((m) => m.moduleId.match(/^M-0[1-9]$|^M-10$/))).toBe(
        true,
      );
    });

    it('returns 10 liquidity modules', () => {
      const liq = service.filterByCategory(ComplianceCategory.LIQUIDITY);
      expect(liq).toHaveLength(10);
    });

    it('returns 8 capital adequacy modules', () => {
      const cap = service.filterByCategory(ComplianceCategory.CAPITAL_ADEQUACY);
      expect(cap).toHaveLength(8);
    });

    it('returns 10 credit risk modules', () => {
      const cr = service.filterByCategory(ComplianceCategory.CREDIT_RISK);
      expect(cr).toHaveLength(10);
    });

    it('returns 6 stress testing modules', () => {
      const st = service.filterByCategory(ComplianceCategory.STRESS_TESTING);
      expect(st).toHaveLength(6);
    });
  });

  describe('filterByRegulator', () => {
    it('COSSEC references span multiple categories', () => {
      const cossec = service.filterByRegulator(RegulatoryBody.COSSEC);
      expect(cossec.length).toBeGreaterThan(20);
    });

    it('FRB references exist for supervisory guidance', () => {
      const frb = service.filterByRegulator(RegulatoryBody.FRB);
      expect(frb.length).toBeGreaterThan(10);
    });

    it('NCUA references cover credit union requirements', () => {
      const ncua = service.filterByRegulator(RegulatoryBody.NCUA);
      expect(ncua.length).toBeGreaterThan(3);
    });

    it('FASB references cover CECL modules', () => {
      const fasb = service.filterByRegulator(RegulatoryBody.FASB);
      expect(fasb.length).toBeGreaterThanOrEqual(3);
      expect(
        fasb.every((m) => m.category === ComplianceCategory.CREDIT_RISK),
      ).toBe(true);
    });
  });

  describe('filterByStatus', () => {
    it('majority of modules are validated', () => {
      const validated = service.filterByStatus(ModuleStatus.VALIDATED);
      expect(validated.length).toBeGreaterThan(55);
    });

    it('some modules are in progress', () => {
      const inProgress = service.filterByStatus(ModuleStatus.IN_PROGRESS);
      expect(inProgress.length).toBeGreaterThanOrEqual(1);
    });

    it('at most a few modules are planned', () => {
      const planned = service.filterByStatus(ModuleStatus.PLANNED);
      expect(planned.length).toBeLessThan(5);
    });
  });

  describe('getCoverageReport', () => {
    it('returns correct total count', () => {
      const report = service.getCoverageReport();
      expect(report.totalModules).toBe(62);
      expect(report.validated + report.inProgress + report.planned).toBe(62);
    });

    it('every category appears in byCategory', () => {
      const report = service.getCoverageReport();
      for (const cat of Object.values(ComplianceCategory)) {
        expect(report.byCategory[cat]).toBeDefined();
        expect(report.byCategory[cat].total).toBeGreaterThanOrEqual(0);
      }
    });

    it('every regulator appears in byRegulator', () => {
      const report = service.getCoverageReport();
      for (const body of Object.values(RegulatoryBody)) {
        expect(report.byRegulator[body]).toBeDefined();
      }
    });

    it('gaps array includes non-validated modules', () => {
      const report = service.getCoverageReport();
      const nonValidated = service
        .listAll()
        .filter((m) => m.status !== ModuleStatus.VALIDATED);
      if (nonValidated.length > 0) {
        expect(report.gaps.length).toBeGreaterThan(0);
      }
    });
  });

  describe('getGaps', () => {
    it('flags COSSEC-required modules that are not validated as CRITICAL', () => {
      const gaps = service.getGaps();
      const criticalGaps = gaps.filter((g) => g.severity === 'CRITICAL');
      const cossecNotValidated = service
        .filterByRegulator(RegulatoryBody.COSSEC)
        .filter((m) => m.status !== ModuleStatus.VALIDATED);
      expect(criticalGaps.length).toBe(cossecNotValidated.length);
    });

    it('flags planned/in-progress modules as WARNING', () => {
      const gaps = service.getGaps();
      const warnings = gaps.filter((g) => g.severity === 'WARNING');
      const nonValidated = service
        .listAll()
        .filter((m) => m.status !== ModuleStatus.VALIDATED);
      expect(warnings.length).toBe(nonValidated.length);
    });
  });

  describe('getDependencyGraph', () => {
    it('returns a graph with 62 entries', () => {
      const graph = service.getDependencyGraph();
      expect(Object.keys(graph)).toHaveLength(62);
    });

    it('M-01 Duration Gap has no dependencies', () => {
      const graph = service.getDependencyGraph();
      expect(graph['M-01']).toEqual([]);
    });

    it('M-02 NII Sensitivity depends on M-01', () => {
      const graph = service.getDependencyGraph();
      expect(graph['M-02']).toContain('M-01');
    });

    it('all dependency references are valid module IDs', () => {
      const graph = service.getDependencyGraph();
      const allIds = new Set(Object.keys(graph));
      for (const [, deps] of Object.entries(graph)) {
        for (const dep of deps) {
          expect(allIds.has(dep)).toBe(true);
        }
      }
    });
  });

  describe('search', () => {
    it('finds modules by name', () => {
      const results = service.search('Duration');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].moduleId).toBe('M-01');
    });

    it('finds modules by Spanish name', () => {
      const results = service.search('Liquidez');
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('finds modules by regulatory citation', () => {
      const results = service.search('Ley 255-2002');
      expect(results.length).toBeGreaterThanOrEqual(3);
    });

    it('finds modules by category keyword', () => {
      const results = service.search('STRESS_TESTING');
      expect(results.length).toBe(6);
    });

    it('returns empty for nonsense query', () => {
      expect(service.search('xyzzyplugh')).toEqual([]);
    });
  });

  describe('getThresholds', () => {
    it('returns thresholds for M-01 Duration Gap', () => {
      const thresholds = service.getThresholds('M-01');
      expect(thresholds).toBeDefined();
      expect(thresholds!.length).toBe(1);
      expect(thresholds![0].metric).toBe('durationGap');
    });

    it('returns empty array for modules without thresholds', () => {
      const thresholds = service.getThresholds('M-08');
      expect(thresholds).toBeDefined();
      expect(thresholds).toEqual([]);
    });

    it('returns undefined for non-existent module', () => {
      expect(service.getThresholds('M-99')).toBeUndefined();
    });
  });

  describe('data integrity', () => {
    it('every module has a unique moduleId', () => {
      const ids = service.listAll().map((m) => m.moduleId);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('every module has bilingual name and description', () => {
      for (const mod of service.listAll()) {
        expect(mod.name.length).toBeGreaterThan(0);
        expect(mod.nameEs.length).toBeGreaterThan(0);
        expect(mod.description.length).toBeGreaterThan(0);
        expect(mod.descriptionEs.length).toBeGreaterThan(0);
      }
    });

    it('every module has a service file and entry function', () => {
      for (const mod of service.listAll()) {
        expect(mod.serviceFile).toMatch(/\.ts$/);
        expect(mod.entryFunction.length).toBeGreaterThan(0);
      }
    });

    it('module IDs are sequential M-01 through M-62', () => {
      const ids = service.listAll().map((m) => m.moduleId);
      for (let i = 1; i <= 62; i++) {
        expect(ids).toContain(`M-${String(i).padStart(2, '0')}`);
      }
    });

    it('every regulatory reference has a body and citation', () => {
      for (const mod of service.listAll()) {
        for (const ref of mod.regulatoryReferences) {
          expect(Object.values(RegulatoryBody)).toContain(ref.body);
          expect(ref.citation.length).toBeGreaterThan(0);
        }
      }
    });
  });
});
