export enum ComplianceCategory {
  INTEREST_RATE_RISK = 'INTEREST_RATE_RISK',
  LIQUIDITY = 'LIQUIDITY',
  CAPITAL_ADEQUACY = 'CAPITAL_ADEQUACY',
  CREDIT_RISK = 'CREDIT_RISK',
  MARKET_RISK = 'MARKET_RISK',
  OPERATIONAL = 'OPERATIONAL',
  REGULATORY_REPORTING = 'REGULATORY_REPORTING',
  STRESS_TESTING = 'STRESS_TESTING',
  GOVERNANCE = 'GOVERNANCE',
  PEER_ANALYTICS = 'PEER_ANALYTICS',
  PORTFOLIO = 'PORTFOLIO',
  PRICING = 'PRICING',
}

export enum RegulatoryBody {
  COSSEC = 'COSSEC',
  NCUA = 'NCUA',
  FDIC = 'FDIC',
  FRB = 'FRB',
  OCC = 'OCC',
  FASB = 'FASB',
}

export enum ModuleStatus {
  VALIDATED = 'VALIDATED',
  IN_PROGRESS = 'IN_PROGRESS',
  PLANNED = 'PLANNED',
}

export interface ComplianceThreshold {
  metric: string;
  pass: string;
  warn: string;
  fail: string;
  unit: string;
}

export interface RegulatoryReference {
  body: RegulatoryBody;
  citation: string;
  section?: string;
}

export interface ComplianceModuleEntry {
  moduleId: string;
  name: string;
  nameEs: string;
  category: ComplianceCategory;
  description: string;
  descriptionEs: string;
  serviceFile: string;
  entryFunction: string;
  requiredInputs: string[];
  outputFields: string[];
  regulatoryReferences: RegulatoryReference[];
  thresholds: ComplianceThreshold[];
  status: ModuleStatus;
  modelRegistryKey?: string;
  dependsOn: string[];
}

export interface ComplianceCoverageReport {
  totalModules: number;
  validated: number;
  inProgress: number;
  planned: number;
  byCategory: Record<ComplianceCategory, { total: number; validated: number }>;
  byRegulator: Record<string, { total: number; validated: number }>;
  gaps: ComplianceGap[];
}

export interface ComplianceGap {
  moduleId: string;
  moduleName: string;
  category: ComplianceCategory;
  reason: string;
  severity: 'CRITICAL' | 'WARNING';
}
