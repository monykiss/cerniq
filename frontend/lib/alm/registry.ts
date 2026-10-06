/**
 * Canonical ALM Module Registry — single source of truth.
 *
 * Every module under app/alm/<slug>/ MUST have an entry here. The breadcrumb,
 * sidebar, module index page, search, telemetry, and feature flags all derive
 * their data from this file.
 *
 * Adding a new module:
 *   1. Add the slug to `AlmModuleSlug` (alphabetical within its category block)
 *   2. Add an entry to `ALM_MODULES`
 *   3. Add bilingual KPI/parameter labels to `lib/alm/labels.ts` if the module
 *      surfaces field names from the backend response
 *
 * scripts/verify-alm-registry.mjs verifies every app/alm/<slug>/ folder has a
 * matching entry, and is run as part of `pnpm lint`.
 */

import type { LucideIcon } from 'lucide-react';
import {
  Activity, AlertOctagon, ArrowDownUp, ArrowUpDown, BarChart3, Bell, Bot, Brain,
  CloudLightning, Cpu, DollarSign, FileText, Gauge, GitBranch, Globe,
  Landmark, Layers, LineChart, Link2, MessageSquare, ScrollText, Shield, ShieldCheck,
  SlidersHorizontal, Target, Timer, TrendingDown, TrendingUp, Users, Zap,
} from 'lucide-react';

// ─── Categories ───────────────────────────────────────────────────────────────

export type AlmCategoryId =
  | 'core'
  | 'rate'
  | 'liquidity'
  | 'credit'
  | 'quant'
  | 'strategy'
  | 'regulatory'
  | 'intelligence'
  | 'frontier';

export interface AlmCategory {
  readonly id: AlmCategoryId;
  readonly label: { readonly en: string; readonly es: string };
  /** Tailwind color name (e.g. 'cyan' → bg-cyan-500) */
  readonly color: string;
  readonly order: number;
}

export const ALM_CATEGORIES: readonly AlmCategory[] = [
  { id: 'core',         label: { en: 'Core Analytics',          es: 'Analítica Central'        }, color: 'cyan',    order: 0 },
  { id: 'rate',         label: { en: 'Rate Risk',               es: 'Riesgo de Tasa'           }, color: 'sky',     order: 1 },
  { id: 'liquidity',    label: { en: 'Liquidity',               es: 'Liquidez'                 }, color: 'emerald', order: 2 },
  { id: 'credit',       label: { en: 'Credit Risk',             es: 'Riesgo Crediticio'        }, color: 'rose',    order: 3 },
  { id: 'quant',        label: { en: 'Quant Engine',            es: 'Motor Cuantitativo'       }, color: 'red',     order: 4 },
  { id: 'strategy',     label: { en: 'Strategy & Capital',      es: 'Estrategia y Capital'     }, color: 'amber',   order: 5 },
  { id: 'regulatory',   label: { en: 'Regulatory & Exam',       es: 'Regulatorio y Examen'     }, color: 'blue',    order: 6 },
  { id: 'intelligence', label: { en: 'Intelligence & Scenarios', es: 'Inteligencia y Escenarios' }, color: 'violet', order: 7 },
  { id: 'frontier',     label: { en: 'Quant Frontier',          es: 'Frontera Cuantitativa'    }, color: 'indigo',  order: 8 },
] as const;

// ─── Module slugs (literal union — every route folder must be listed) ────────

export type AlmModuleSlug =
  // core
  | 'overview' | 'balance-sheet' | 'balance-sheet-sim' | 'advisor-v2' | 'analyst' | 'alco-dashboard' | 'modules' | 'reseller'
  | 'decisions' | 'agents' | 'copilot' | 'agent-alerts' | 'member-360'
  // rate
  | 'sensitivity' | 'sensitivity-report' | 'yield-curve' | 'svensson' | 'hull-white' | 'pca-yield-curve'
  | 'repricing-gap' | 'rate-shock-v2' | 'key-rate-durations' | 'behavioral-duration' | 'sofr-exposure'
  | 'deposit-beta' | 'duration-matching' | 'ir-gap' | 'basis-risk' | 'rate-lock'
  // liquidity
  | 'liquidity' | 'liquidity-gap' | 'nsfr' | 'stress-pack' | 'ltp' | 'funding-concentration' | 'deposit-runoff'
  // credit
  | 'cecl' | 'concentration' | 'conc-var' | 'credit-risk' | 'credit-loss' | 'credit-spread' | 'asset-quality'
  | 'counterparty-exposure' | 'collateral' | 'vintage-analysis'
  // quant
  | 'monte-carlo' | 'var' | 'oas' | 'optionality' | 'garch' | 'ear'
  // strategy
  | 'ftp' | 'capital-optimizer' | 'capital-adequacy' | 'capital-allocation' | 'nim-attribution' | 'nim-optimizer'
  | 'forward-sim' | 'margin-compression' | 'income-vol' | 'pnl-attribution' | 'daily-pnl' | 'economic-capital'
  | 'risk-appetite' | 'wac-wam' | 'swap-valuation'
  // regulatory
  | 'cossec' | 'nev' | 'exam-prep' | 'irr-policy' | 'alerts' | 'camel-forecast' | 'form-5300' | 'board-report' | 'rbc2' | 'compliance'
  | 'regulatory-deadlines' | 'regulatory-monitor' | 'data-quality'
  // intelligence
  | 'peer-analytics' | 'peer-benchmarking' | 'climate-risk' | 'macro-regime' | 'stress-v2' | 'stress-test'
  | 'stress-scenarios' | 'ews' | 'scenario-builder' | 'scenario-compare' | 'network' | 'usvi' | 'trends'
  // frontier
  | 'black-litterman' | 'cvar-optimizer' | 'hrp' | 'credit-metrics' | 'kmv-merton' | 'frtb-ima' | 'fed-futures'
  | 'copula-credit' | 'wrong-way-risk' | 'cap-floor' | 'macro-factors';

// ─── Module shape ─────────────────────────────────────────────────────────────

export type AlmTier = 'core' | 'advanced' | 'frontier';
export type AlmStatus = 'ga' | 'beta' | 'alpha';

export interface AlmModule {
  readonly slug: AlmModuleSlug;
  readonly href: string;
  readonly category: AlmCategoryId;
  readonly icon: LucideIcon;
  readonly name: { readonly en: string; readonly es: string };
  /** Optional short form for breadcrumbs/sidebar (defaults to `name`) */
  readonly shortName?: { readonly en: string; readonly es: string };
  readonly description: { readonly en: string; readonly es: string };
  readonly tier: AlmTier;
  readonly status: AlmStatus;
  /** Regulatory citations the module satisfies, e.g. 'NCUA 5300', 'Basel III LCR' */
  readonly regulatoryRefs?: readonly string[];
  /** Backend endpoint template; '{id}' will be replaced with institution id */
  readonly endpoint?: string;
}

// ─── Module catalogue ────────────────────────────────────────────────────────
//
// Ordered by category then by display priority within category. Keep entries
// terse — long-form copy belongs in marketing pages, not here.

export const ALM_MODULES: readonly AlmModule[] = [
  // ─ Core ─────────────────────────────────────────────────────────────────────
  { slug: 'overview',          href: '/alm',                   category: 'core', tier: 'core',     status: 'ga', icon: BarChart3,        name: { en: 'ALM Overview',         es: 'Resumen ALM'             }, description: { en: 'Health score, KPIs, risk alerts, module grid',           es: 'Puntaje salud, KPIs, alertas, módulos'                 }, endpoint: '/api/alm/{id}/summary' },
  { slug: 'balance-sheet',     href: '/alm/balance-sheet',     category: 'core', tier: 'core',     status: 'ga', icon: DollarSign,       name: { en: 'Balance Sheet',        es: 'Hoja de Balance'         }, description: { en: 'Import CSV/NCUA, asset-liability breakdown',             es: 'Importar CSV/NCUA, desglose activos-pasivos'           } },
  { slug: 'balance-sheet-sim', href: '/alm/balance-sheet-sim', category: 'core', tier: 'advanced', status: 'beta', icon: Activity,        name: { en: 'Balance Sheet Sim',    es: 'Simulación Balance'      }, description: { en: 'What-if balance sheet projections under shocks',          es: 'Proyecciones balance bajo escenarios'                  } },
  { slug: 'advisor-v2',        href: '/alm/advisor-v2',        category: 'core', tier: 'core',     status: 'ga', icon: Zap,              name: { en: 'AI Advisor v2',        es: 'Asesor IA v2'            }, description: { en: 'Health Score 0-100, SSE streaming, risk pulse',           es: 'Puntuación 0-100, streaming SSE, pulso de riesgo'      } },
  { slug: 'analyst',           href: '/alm/analyst',           category: 'core', tier: 'core',     status: 'ga', icon: Brain,            name: { en: 'AI Analyst Chat',      es: 'Chat Analista IA'        }, description: { en: 'Claude-powered conversational ALM analysis',              es: 'Análisis ALM conversacional con Claude'                } },
  { slug: 'alco-dashboard',    href: '/alm/alco-dashboard',    category: 'core', tier: 'core',     status: 'ga', icon: Gauge,            name: { en: 'ALCO Dashboard',       es: 'Tablero ALCO'            }, description: { en: 'Asset/Liability Committee meeting cockpit',               es: 'Cabina de mando del Comité ALCO'                       } },
  { slug: 'modules',           href: '/alm/modules',           category: 'core', tier: 'core',     status: 'ga', icon: Layers,           name: { en: 'Module Index',         es: 'Índice de Módulos'       }, description: { en: 'Every analytical capability in one view',                 es: 'Todas las capacidades analíticas en una vista'         } },
  { slug: 'reseller',          href: '/alm/reseller',          category: 'core', tier: 'advanced', status: 'beta', icon: Landmark,         name: { en: 'Reseller Console',     es: 'Consola Reseller'        }, description: { en: 'Partner client portfolio, MRR, and tier management',     es: 'Portafolio clientes socio, MRR, gestión de niveles'    } },
  { slug: 'decisions',         href: '/alm/decisions',         category: 'core', tier: 'core',     status: 'ga',   icon: Target,           name: { en: 'Decision Panel',       es: 'Panel de Decisiones'     }, description: { en: 'ALM agent output: health, risks, decision queue, trace', es: 'Salida agente ALM: salud, riesgos, cola decisiones'    }, endpoint: '/api/v1/agents/{id}/runs' },
  { slug: 'agents',            href: '/alm/agents',            category: 'core', tier: 'core',     status: 'ga',   icon: Bot,              name: { en: 'Agent Activity',       es: 'Actividad Agentes'       }, description: { en: 'Run feed, alert center, cost tracking',                  es: 'Feed ejecuciones, centro alertas, seguimiento costos'  }, endpoint: '/api/v1/agents/{id}/runs' },
  { slug: 'copilot',           href: '/alm/copilot',           category: 'core', tier: 'core',     status: 'ga',   icon: MessageSquare,    name: { en: 'CFO Copilot',          es: 'Copiloto CFO'            }, description: { en: 'Real-time scenario Q&A, bilingual, tool-backed',         es: 'Q&A escenarios en tiempo real, bilingüe, con herramientas' }, endpoint: '/api/v1/agents/{id}/copilot' },
  { slug: 'agent-alerts',      href: '/alm/agents/alerts',     category: 'core', tier: 'core',     status: 'ga',   icon: Bell,             name: { en: 'Agent Alerts',         es: 'Alertas de Agentes'      }, description: { en: 'Live feed from Risk Monitor + ALM Decision agents',      es: 'Feed en vivo de agentes Monitor Riesgo + Decisión ALM' }, endpoint: '/api/v1/agents/{id}/alerts' },
  { slug: 'member-360',        href: '/alm/member-360',        category: 'core', tier: 'core',     status: 'beta', icon: Users,            name: { en: 'Member 360',           es: 'Miembro 360'             }, description: { en: 'Member directory, lifecycle stage, and 360° financial/regulatory profile', es: 'Directorio de socios, etapa del ciclo y perfil 360° financiero/regulatorio' }, endpoint: '/api/alm/{id}/members' },

  // ─ Rate Risk ────────────────────────────────────────────────────────────────
  { slug: 'sensitivity',         href: '/alm/sensitivity',         category: 'rate', tier: 'core',     status: 'ga', icon: TrendingUp,        name: { en: 'Rate Sensitivity',     es: 'Sensibilidad de Tasa'    }, description: { en: 'NII/EVE impact across ±200bp parallel shifts',           es: 'Impacto NII/EVE en cambios ±200bp'                     }, regulatoryRefs: ['Basel IRRBB'], endpoint: '/api/alm/{id}/nii-sensitivity' },
  { slug: 'sensitivity-report',  href: '/alm/sensitivity-report',  category: 'rate', tier: 'advanced', status: 'ga', icon: FileText,          name: { en: 'Sensitivity Report',   es: 'Reporte Sensibilidad'    }, description: { en: 'Detailed IRR sensitivity report for ALCO/exam',          es: 'Reporte detallado IRR para ALCO/examen'                } },
  { slug: 'yield-curve',         href: '/alm/yield-curve',         category: 'rate', tier: 'core',     status: 'ga', icon: TrendingUp,        name: { en: 'Yield Curve',          es: 'Curva de Rendimiento'    }, description: { en: 'Nelson-Siegel interpolation, 6 Basel IRRBB shocks',      es: 'Interpolación Nelson-Siegel, 6 choques Basel'          }, endpoint: '/api/alm/{id}/yield-curve-analysis' },
  { slug: 'svensson',            href: '/alm/svensson',            category: 'rate', tier: 'frontier', status: 'ga', icon: LineChart,         name: { en: 'Svensson Model',       es: 'Modelo Svensson'         }, description: { en: '6-parameter ECB/Bundesbank yield curve fit',             es: 'Ajuste curva 6 parámetros ECB/Bundesbank'              }, endpoint: '/api/alm/{id}/yield-curve/svensson' },
  { slug: 'hull-white',          href: '/alm/hull-white',          category: 'rate', tier: 'frontier', status: 'ga', icon: Activity,          name: { en: 'Hull-White Model',     es: 'Modelo Hull-White'       }, description: { en: 'One-factor short-rate model, calibrated to term structure', es: 'Modelo de tasa corta de un factor calibrado'        }, endpoint: '/api/alm/{id}/hull-white' },
  { slug: 'pca-yield-curve',     href: '/alm/pca-yield-curve',     category: 'rate', tier: 'frontier', status: 'ga', icon: Layers,            name: { en: 'PCA Yield Curve',      es: 'PCA Curva'               }, description: { en: '3-factor decomposition: level, slope, curvature',        es: 'Descomposición 3 factores: nivel, pendiente, curvatura' }, endpoint: '/api/alm/{id}/pca-factors' },
  { slug: 'repricing-gap',       href: '/alm/repricing-gap',       category: 'rate', tier: 'core',     status: 'ga', icon: BarChart3,         name: { en: 'Repricing Gap',        es: 'Brecha de Reprecio'      }, description: { en: 'OCIF CC-2022-03 exact 7-bucket format',                  es: 'Formato exacto OCIF CC-2022-03 7 cubetas'              }, regulatoryRefs: ['OCIF CC-2022-03'], endpoint: '/api/alm/{id}/repricing-gap' },
  { slug: 'rate-shock-v2',       href: '/alm/rate-shock-v2',       category: 'rate', tier: 'advanced', status: 'ga', icon: Zap,               name: { en: 'Rate Shock v2',        es: 'Choque de Tasa v2'       }, description: { en: 'Non-parallel shocks: steepener, flattener, twist',       es: 'Choques no paralelos: empinamiento, aplanamiento'      }, endpoint: '/api/alm/{id}/yield-curve/forward-nii' },
  { slug: 'key-rate-durations',  href: '/alm/key-rate-durations',  category: 'rate', tier: 'advanced', status: 'ga', icon: SlidersHorizontal, name: { en: 'Key Rate Duration',    es: 'Duración Tasa Clave'     }, description: { en: 'KRD01 per tenor bucket, hedging precision',              es: 'KRD01 por tenor, precisión de cobertura'               }, endpoint: '/api/alm/{id}/key-rate-durations' },
  { slug: 'behavioral-duration', href: '/alm/behavioral-duration', category: 'rate', tier: 'advanced', status: 'ga', icon: Timer,             name: { en: 'Behavioral Duration',  es: 'Duración Conductual'     }, description: { en: 'Hutchison-Pennacchi NMD model, EVE correction',          es: 'Modelo H-P NMD, corrección EVE'                        } },
  { slug: 'sofr-exposure',       href: '/alm/sofr-exposure',       category: 'rate', tier: 'core',     status: 'ga', icon: TrendingUp,        name: { en: 'SOFR Transition',      es: 'Transición SOFR'         }, description: { en: 'ISDA LIBOR→SOFR spread monitoring',                      es: 'Monitoreo spread ISDA LIBOR→SOFR'                      } },
  { slug: 'deposit-beta',        href: '/alm/deposit-beta',        category: 'rate', tier: 'advanced', status: 'ga', icon: SlidersHorizontal, name: { en: 'Deposit Beta',         es: 'Beta de Depósitos'       }, description: { en: 'OLS calibration vs 94-institution PR library',           es: 'Calibración OLS vs biblioteca 94 instituciones PR'     }, endpoint: '/api/alm/{id}/deposit-betas' },
  { slug: 'duration-matching',   href: '/alm/duration-matching',   category: 'rate', tier: 'advanced', status: 'ga', icon: Target,            name: { en: 'Duration Matching',    es: 'Emparejamiento Duración' }, description: { en: 'Modified duration immunization strategies',              es: 'Estrategias de inmunización de duración modificada'    } },
  { slug: 'ir-gap',              href: '/alm/ir-gap',              category: 'rate', tier: 'core',     status: 'ga', icon: BarChart3,         name: { en: 'IR Gap Ratio',         es: 'Ratio Brecha IR'         }, description: { en: 'Interest rate gap ratio with policy bands',              es: 'Ratio brecha tasa interés con bandas de política'      } },
  { slug: 'basis-risk',          href: '/alm/basis-risk',          category: 'rate', tier: 'advanced', status: 'beta', icon: ArrowUpDown,      name: { en: 'Basis Risk',           es: 'Riesgo de Base'          }, description: { en: 'Imperfect correlation exposure across rate indices',     es: 'Exposición correlación imperfecta entre índices'       } },
  { slug: 'rate-lock',           href: '/alm/rate-lock',           category: 'rate', tier: 'advanced', status: 'beta', icon: Shield,           name: { en: 'Rate Lock Exposure',   es: 'Exposición Bloqueo Tasa' }, description: { en: 'Pipeline rate-lock exposure for mortgages',              es: 'Exposición pipeline bloqueo tasa hipotecas'            } },

  // ─ Liquidity ────────────────────────────────────────────────────────────────
  { slug: 'liquidity',              href: '/alm/liquidity',              category: 'liquidity', tier: 'core',     status: 'ga', icon: Shield,         name: { en: 'LCR / NSFR',            es: 'LCR / NSFR'              }, description: { en: 'Basel III LCR + 1-year structural NSFR',                  es: 'LCR Basel III + NSFR estructural 1 año'                }, regulatoryRefs: ['Basel III LCR', 'Basel III NSFR'], endpoint: '/api/alm/{id}/liquidity' },
  { slug: 'liquidity-gap',          href: '/alm/liquidity-gap',          category: 'liquidity', tier: 'core',     status: 'ga', icon: BarChart3,      name: { en: 'Liquidity Gap',         es: 'Brecha de Liquidez'      }, description: { en: 'Contractual + behavioral cash-flow gap analysis',         es: 'Análisis brecha flujo contractual + conductual'        } },
  { slug: 'nsfr',                   href: '/alm/nsfr',                   category: 'liquidity', tier: 'core',     status: 'ga', icon: ShieldCheck,    name: { en: 'NSFR',                  es: 'NSFR'                    }, description: { en: 'Net Stable Funding Ratio detail',                         es: 'Ratio Financiamiento Estable Neto en detalle'          }, regulatoryRefs: ['Basel III NSFR'] },
  { slug: 'stress-pack',            href: '/alm/stress-pack',            category: 'liquidity', tier: 'advanced', status: 'ga', icon: Shield,         name: { en: 'COSSEC Stress Pack',    es: 'Pack Estrés COSSEC'      }, description: { en: '5 pre-loaded PR scenarios incl. hurricane',               es: '5 escenarios PR incluyendo huracán'                    } },
  { slug: 'ltp',                    href: '/alm/ltp',                    category: 'liquidity', tier: 'advanced', status: 'ga', icon: DollarSign,     name: { en: 'Liquidity Transfer',    es: 'Transfer. Liquidez'      }, description: { en: 'Internal liquidity transfer pricing framework',           es: 'Marco de precios de transferencia de liquidez'         } },
  { slug: 'funding-concentration',  href: '/alm/funding-concentration',  category: 'liquidity', tier: 'advanced', status: 'ga', icon: AlertOctagon,   name: { en: 'Funding Concentration', es: 'Concentración Fondeo'    }, description: { en: 'Wholesale + top-N depositor concentration tracking',      es: 'Seguimiento concentración mayorista + top-N'           } },
  { slug: 'deposit-runoff',         href: '/alm/deposit-runoff',         category: 'liquidity', tier: 'advanced', status: 'ga', icon: TrendingDown,   name: { en: 'Deposit Runoff',        es: 'Decaimiento Depósitos'   }, description: { en: 'NMD decay model with exam-grade assumptions',             es: 'Modelo decaimiento NMD con supuestos examen'           } },

  // ─ Credit Risk ──────────────────────────────────────────────────────────────
  { slug: 'cecl',                  href: '/alm/cecl',                  category: 'credit', tier: 'core',     status: 'ga', icon: Shield,        name: { en: 'CECL',               es: 'CECL'                    }, description: { en: '3 methods: WARM, Vintage, PD×LGD + macro scenarios',     es: '3 métodos: WARM, Vintage, PD×LGD + escenarios macro'   }, regulatoryRefs: ['CECL ASC 326'], endpoint: '/api/alm/{id}/cecl' },
  { slug: 'concentration',         href: '/alm/concentration',         category: 'credit', tier: 'core',     status: 'ga', icon: AlertOctagon,  name: { en: 'Concentration',      es: 'Concentración'           }, description: { en: 'Sector/single-name exposure, HHI, policy limits',        es: 'Exposición sector/nombre, HHI, límites'                }, endpoint: '/api/alm/{id}/concentration' },
  { slug: 'conc-var',              href: '/alm/conc-var',              category: 'credit', tier: 'frontier', status: 'ga', icon: AlertOctagon,  name: { en: 'Concentration VaR',  es: 'VaR Concentración'       }, description: { en: 'Gordy granularity, sector-level VaR attribution',        es: 'Gordy granularidad, atribución VaR sector'             } },
  { slug: 'credit-risk',           href: '/alm/credit-risk',           category: 'credit', tier: 'core',     status: 'ga', icon: Shield,        name: { en: 'Credit Risk Quant',  es: 'Riesgo Crédito Quant'    }, description: { en: 'PD logistic (6 types), LGD haircuts, Basel II UL',       es: 'PD logística (6 tipos), LGD, UL Basel II'              }, regulatoryRefs: ['Basel II'], endpoint: '/api/alm/{id}/credit-risk' },
  { slug: 'credit-loss',           href: '/alm/credit-loss',           category: 'credit', tier: 'advanced', status: 'ga', icon: TrendingDown,  name: { en: 'Credit Loss',        es: 'Pérdida Crediticia'      }, description: { en: 'Forward-looking credit loss forecaster',                 es: 'Pronóstico pérdida crediticia prospectivo'             } },
  { slug: 'credit-spread',         href: '/alm/credit-spread',         category: 'credit', tier: 'advanced', status: 'ga', icon: TrendingUp,    name: { en: 'Credit Spread',      es: 'Spread Crediticio'       }, description: { en: 'Credit spread risk on bond holdings',                    es: 'Riesgo spread crediticio en tenencias'                 } },
  { slug: 'asset-quality',         href: '/alm/asset-quality',         category: 'credit', tier: 'core',     status: 'ga', icon: Gauge,         name: { en: 'Asset Quality',      es: 'Calidad de Activos'      }, description: { en: 'NPL trend, classification migration, coverage ratio',    es: 'Tendencia NPL, migración clasificación, cobertura'     } },
  { slug: 'counterparty-exposure', href: '/alm/counterparty-exposure', category: 'credit', tier: 'advanced', status: 'ga', icon: Link2,         name: { en: 'Counterparty Exposure', es: 'Exposición Contraparte' }, description: { en: 'Counterparty CCR with limit monitoring',                 es: 'CCR contraparte con monitoreo de límites'              } },
  { slug: 'collateral',            href: '/alm/collateral',            category: 'credit', tier: 'advanced', status: 'ga', icon: ShieldCheck,   name: { en: 'Collateral Haircut', es: 'Haircut de Colateral'    }, description: { en: 'Collateral haircut schedule per asset class',            es: 'Programa haircut por clase de activo'                  } },
  { slug: 'vintage-analysis',      href: '/alm/vintage-analysis',      category: 'credit', tier: 'advanced', status: 'ga', icon: BarChart3,     name: { en: 'Vintage Analysis',   es: 'Análisis Cosecha'        }, description: { en: 'Loan vintage performance curves',                        es: 'Curvas de desempeño por cosecha'                       } },

  // ─ Quant Engine ─────────────────────────────────────────────────────────────
  { slug: 'monte-carlo', href: '/alm/monte-carlo', category: 'quant', tier: 'advanced', status: 'ga', icon: Cpu,              name: { en: 'Monte Carlo',     es: 'Monte Carlo'         }, description: { en: '10K Vasicek paths, antithetic variates, VaR-95/CVaR-99', es: '10K senderos Vasicek, variantes antitéticas'           }, endpoint: '/api/alm/{id}/monte-carlo' },
  { slug: 'var',         href: '/alm/var',         category: 'quant', tier: 'advanced', status: 'ga', icon: AlertOctagon,     name: { en: 'VaR Suite',       es: 'Suite VaR'           }, description: { en: 'Historical + Parametric + Monte Carlo, Kupiec backtest', es: 'Histórico + Paramétrico + MC, backtest Kupiec'         }, regulatoryRefs: ['Basel Traffic Light'], endpoint: '/api/alm/{id}/var' },
  { slug: 'oas',         href: '/alm/oas',         category: 'quant', tier: 'advanced', status: 'ga', icon: Landmark,         name: { en: 'OAS Analysis',    es: 'Análisis OAS'        }, description: { en: 'BDT binomial tree, backward induction pricing',          es: 'Árbol binomial BDT, valoración por inducción'          } },
  { slug: 'optionality', href: '/alm/optionality', category: 'quant', tier: 'frontier', status: 'ga', icon: SlidersHorizontal, name: { en: 'Optionality Suite', es: 'Suite Opcionalidad' }, description: { en: 'Embedded option analytics for MBS/callable bonds',       es: 'Analítica opciones embebidas MBS/bonos callable'       } },
  { slug: 'garch',       href: '/alm/garch',       category: 'quant', tier: 'frontier', status: 'ga', icon: Activity,         name: { en: 'GARCH Volatility', es: 'Volatilidad GARCH'  }, description: { en: 'GARCH(1,1) volatility forecast with diagnostics',        es: 'Pronóstico volatilidad GARCH(1,1) con diagnósticos'    }, endpoint: '/api/alm/{id}/garch' },
  { slug: 'ear',         href: '/alm/ear',         category: 'quant', tier: 'advanced', status: 'ga', icon: Activity,         name: { en: 'Earnings at Risk', es: 'Ganancias en Riesgo'}, description: { en: '12-month earnings at risk under rate scenarios',         es: 'Ganancias 12 meses en riesgo bajo escenarios'          } },

  // ─ Strategy & Capital ───────────────────────────────────────────────────────
  { slug: 'ftp',                href: '/alm/ftp',                category: 'strategy', tier: 'advanced', status: 'ga', icon: DollarSign,  name: { en: 'FTP Analysis',         es: 'Análisis FTP'           }, description: { en: 'Matched-maturity FTP, spread decomposition',             es: 'FTP vencimiento coincidente, descomposición spread'    }, endpoint: '/api/alm/{id}/ftp' },
  { slug: 'capital-optimizer',  href: '/alm/capital-optimizer',  category: 'strategy', tier: 'frontier', status: 'ga', icon: Zap,         name: { en: 'Capital Optimizer',    es: 'Optimizador Capital'    }, description: { en: 'LP optimization under regulatory constraints',           es: 'Optimización LP bajo restricciones regulatorias'       }, endpoint: '/api/alm/{id}/optimize' },
  { slug: 'capital-adequacy',   href: '/alm/capital-adequacy',   category: 'strategy', tier: 'core',     status: 'ga', icon: ShieldCheck, name: { en: 'Capital Adequacy',     es: 'Adecuación Capital'     }, description: { en: 'CAR + tier 1/tier 2 capital adequacy ratio',             es: 'CAR + ratio adecuación capital tier 1/tier 2'          }, regulatoryRefs: ['Basel III'] },
  { slug: 'capital-allocation', href: '/alm/capital-allocation', category: 'strategy', tier: 'advanced', status: 'ga', icon: Target,      name: { en: 'Capital Allocation',   es: 'Asignación Capital'     }, description: { en: 'Risk-based capital allocation per business line',        es: 'Asignación capital basada en riesgo por línea'         } },
  { slug: 'nim-attribution',    href: '/alm/nim-attribution',    category: 'strategy', tier: 'advanced', status: 'ga', icon: DollarSign,  name: { en: 'NIM Attribution',      es: 'Atribución NIM'         }, description: { en: '7-factor waterfall decomposition of NIM changes',        es: 'Descomposición waterfall 7 factores de NIM'            }, endpoint: '/api/alm/{id}/nim-attribution' },
  { slug: 'nim-optimizer',      href: '/alm/nim-optimizer',      category: 'strategy', tier: 'frontier', status: 'ga', icon: DollarSign,  name: { en: 'NIM Optimizer',        es: 'Optimizador NIM'        }, description: { en: 'Portfolio rebalancing to maximize net interest margin',  es: 'Rebalanceo portafolio para maximizar margen'           } },
  { slug: 'forward-sim',        href: '/alm/forward-sim',        category: 'strategy', tier: 'advanced', status: 'ga', icon: TrendingUp,  name: { en: '3-Year Projection',    es: 'Proyección 3 Años'      }, description: { en: '12-quarter NII/EVE/LCR/NSFR under 3 rate paths',         es: '12 trimestres NII/EVE/LCR/NSFR en 3 senderos'          }, endpoint: '/api/alm/{id}/forward-simulation' },
  { slug: 'margin-compression', href: '/alm/margin-compression', category: 'strategy', tier: 'advanced', status: 'ga', icon: TrendingDown, name: { en: 'Margin Compression',  es: 'Compresión Margen'      }, description: { en: 'Margin compression risk under rate scenarios',           es: 'Riesgo compresión margen bajo escenarios'              } },
  { slug: 'income-vol',         href: '/alm/income-vol',         category: 'strategy', tier: 'advanced', status: 'ga', icon: Activity,    name: { en: 'Income Volatility',    es: 'Volatilidad Ingresos'   }, description: { en: 'Net income volatility decomposition',                    es: 'Descomposición volatilidad ingresos netos'             } },
  { slug: 'pnl-attribution',    href: '/alm/pnl-attribution',    category: 'strategy', tier: 'advanced', status: 'ga', icon: BarChart3,   name: { en: 'P&L Attribution',      es: 'Atribución P&L'         }, description: { en: 'Daily P&L attribution by risk factor',                   es: 'Atribución diaria P&L por factor de riesgo'            } },
  { slug: 'daily-pnl',          href: '/alm/daily-pnl',          category: 'strategy', tier: 'core',     status: 'ga', icon: LineChart,   name: { en: 'Daily P&L',            es: 'P&L Diario'             }, description: { en: 'Daily P&L tracker with explanatory variance',            es: 'Tracker P&L diario con variación explicativa'          } },
  { slug: 'economic-capital',   href: '/alm/economic-capital',   category: 'strategy', tier: 'frontier', status: 'ga', icon: ShieldCheck, name: { en: 'Economic Capital',     es: 'Capital Económico'      }, description: { en: 'Internal economic capital model',                        es: 'Modelo interno capital económico'                      } },
  { slug: 'risk-appetite',      href: '/alm/risk-appetite',      category: 'strategy', tier: 'core',     status: 'ga', icon: Target,      name: { en: 'Risk Appetite',        es: 'Apetito de Riesgo'      }, description: { en: 'Risk appetite framework dashboard with limit usage',     es: 'Tablero apetito de riesgo con uso de límites'          } },
  { slug: 'wac-wam',            href: '/alm/wac-wam',            category: 'strategy', tier: 'advanced', status: 'ga', icon: Layers,      name: { en: 'WAC / WAM',            es: 'WAC / WAM'              }, description: { en: 'Weighted-avg coupon and maturity per portfolio',         es: 'Cupón y vencimiento promedio ponderado por portafolio' } },
  { slug: 'swap-valuation',     href: '/alm/swap-valuation',     category: 'strategy', tier: 'advanced', status: 'ga', icon: ArrowDownUp, name: { en: 'Swap Valuation',       es: 'Valoración Swap'        }, description: { en: 'IRS valuation with OIS discounting',                     es: 'Valoración IRS con descuento OIS'                      } },

  // ─ Regulatory & Exam ────────────────────────────────────────────────────────
  { slug: 'cossec',                href: '/alm/cossec',                category: 'regulatory', tier: 'core',     status: 'ga', icon: ShieldCheck,   name: { en: 'COSSEC Report',      es: 'Informe COSSEC'          }, description: { en: '12-ratio compliance semáforo + push-button examiner PDF', es: 'Semáforo de 12 razones + informe PDF para examinador'  }, regulatoryRefs: ['COSSEC'], endpoint: '/api/alm/{id}/cossec-compliance' },
  { slug: 'nev',                   href: '/alm/nev',                   category: 'regulatory', tier: 'core',     status: 'ga', icon: Gauge,         name: { en: 'NEV / EVE Supervisory Test', es: 'Prueba VEN / EVE Supervisora' }, description: { en: 'NEV/EVE ±100/200/300bps revaluation + COSSEC CC-2025-01 / Basel IRRBB bands', es: 'Revaluación VEN/EVE ±100/200/300pb + bandas COSSEC CC-2025-01 / Basel IRRBB' }, regulatoryRefs: ['COSSEC CC-2025-01', 'Basel IRRBB'], endpoint: '/api/alm/{id}/stress-test/nev' },
  { slug: 'exam-prep',             href: '/alm/exam-prep',             category: 'regulatory', tier: 'core',     status: 'ga', icon: Shield,        name: { en: 'Exam Prep',          es: 'Prep Examen'             }, description: { en: 'COSSEC/NCUA exam readiness, CAMEL auto-scorer',          es: 'Preparación examen COSSEC/NCUA, CAMEL auto'            }, regulatoryRefs: ['COSSEC', 'NCUA'] },
  { slug: 'irr-policy',            href: '/alm/irr-policy',            category: 'regulatory', tier: 'core',     status: 'ga', icon: AlertOctagon,  name: { en: 'IRR Policy Monitor', es: 'Monitor Política IRR'    }, description: { en: 'EVE/NII/DurationGap limits, WATCH/WARNING/BREACH',       es: 'Límites EVE/NII/Duración, monitoreo brechas'           } },
  { slug: 'alerts',                href: '/alm/alerts',                category: 'regulatory', tier: 'core',     status: 'ga', icon: Activity,      name: { en: 'Regulatory Alerts',  es: 'Alertas Regulatorias'    }, description: { en: 'Automated regulatory publication scanning',              es: 'Escaneo automático publicaciones regulatorias'         }, endpoint: '/api/alm/{id}/alerts' },
  { slug: 'camel-forecast',        href: '/alm/camel-forecast',        category: 'regulatory', tier: 'advanced', status: 'ga', icon: TrendingUp,    name: { en: 'CAMEL Forecast',     es: 'Pronóstico CAMEL'        }, description: { en: 'AR(2) 4-quarter CAMEL component prediction',             es: 'Predicción AR(2) 4 trimestres componentes CAMEL'       }, endpoint: '/api/alm/{id}/camel-forecast' },
  { slug: 'form-5300',             href: '/alm/form-5300',             category: 'regulatory', tier: 'core',     status: 'ga', icon: FileText,      name: { en: 'NCUA 5300',          es: 'NCUA 5300'               }, description: { en: 'Automated 5300 Call Report field mapping',               es: 'Mapeo automático campos Call Report 5300'              }, regulatoryRefs: ['NCUA 5300'], endpoint: '/api/alm/{id}/form-5300' },
  { slug: 'board-report',          href: '/alm/board-report',          category: 'regulatory', tier: 'core',     status: 'ga', icon: FileText,      name: { en: 'Board Report',       es: 'Informe Junta'           }, description: { en: '20-page bilingual PDF, ALCO-ready',                      es: 'PDF 20 páginas bilingüe, listo para ALCO'              }, endpoint: '/api/alm/{id}/board-report' },
  { slug: 'rbc2',                  href: '/alm/rbc2',                  category: 'regulatory', tier: 'core',     status: 'ga', icon: Shield,        name: { en: 'NCUA RBC2',          es: 'NCUA RBC2'               }, description: { en: '8-component risk-based capital per Letter 15-CU-02',     es: 'Capital basado riesgo 8 componentes'                   }, regulatoryRefs: ['NCUA Letter 15-CU-02'], endpoint: '/api/alm/{id}/rbc2' },
  { slug: 'compliance',            href: '/alm/compliance',            category: 'regulatory', tier: 'core',     status: 'ga', icon: ScrollText,    name: { en: 'Compliance Hub',     es: 'Centro Cumplimiento'     }, description: { en: 'Cross-regulator compliance calendar and status',         es: 'Calendario y estado de cumplimiento multirregulador'   } },
  { slug: 'regulatory-deadlines',  href: '/alm/regulatory-deadlines',  category: 'regulatory', tier: 'core',     status: 'ga', icon: Timer,         name: { en: 'Reg Deadlines',      es: 'Plazos Regulatorios'     }, description: { en: 'Regulatory filing deadline tracker',                     es: 'Tracker de plazos de radicación regulatoria'           } },
  { slug: 'regulatory-monitor',    href: '/alm/regulatory-monitor',    category: 'regulatory', tier: 'advanced', status: 'ga', icon: Activity,      name: { en: 'Reg Change Monitor', es: 'Monitor Cambios Reg'     }, description: { en: 'Monitors new rules and quantifies impact',               es: 'Monitorea reglas nuevas y cuantifica impacto'          } },
  { slug: 'data-quality',          href: '/alm/data-quality',          category: 'regulatory', tier: 'core',     status: 'ga', icon: ShieldCheck,   name: { en: 'Data Quality',       es: 'Calidad de Datos'        }, description: { en: 'Data quality monitor for ingestion pipelines',           es: 'Monitor calidad datos para pipelines de ingesta'       } },

  // ─ Intelligence & Scenarios ─────────────────────────────────────────────────
  { slug: 'peer-analytics',    href: '/alm/peer-analytics',    category: 'intelligence', tier: 'advanced', status: 'ga', icon: Activity,         name: { en: 'Peer Analytics',     es: 'Análisis de Pares'      }, description: { en: '6 metrics, quartile benchmarks, percentile rank',        es: '6 métricas, benchmarks cuartil, rango percentil'       }, endpoint: '/api/alm/{id}/peer-analytics' },
  { slug: 'peer-benchmarking', href: '/alm/peer-benchmarking', category: 'intelligence', tier: 'advanced', status: 'ga', icon: BarChart3,        name: { en: 'Peer Benchmarking',  es: 'Benchmarking Pares'     }, description: { en: 'Multi-dimensional peer ranking with PR cohort',          es: 'Ranking multidimensional vs cohorte PR'                } },
  { slug: 'climate-risk',      href: '/alm/climate-risk',      category: 'intelligence', tier: 'frontier', status: 'ga', icon: CloudLightning,   name: { en: 'Climate Risk',       es: 'Riesgo Climático'       }, description: { en: 'Hurricane AAL (NOAA-calibrated), FEMA flood zones',      es: 'AAL huracanes (NOAA), zonas inundación FEMA'           } },
  { slug: 'macro-regime',      href: '/alm/macro-regime',      category: 'intelligence', tier: 'frontier', status: 'ga', icon: Activity,         name: { en: 'Macro Regime',       es: 'Régimen Macro'          }, description: { en: 'HMM Viterbi 4-state regime detection',                   es: 'Detección régimen 4 estados HMM Viterbi'               } },
  { slug: 'stress-v2',         href: '/alm/stress-v2',         category: 'intelligence', tier: 'advanced', status: 'ga', icon: AlertOctagon,     name: { en: 'DFAST Stress 2.0',   es: 'Estrés DFAST 2.0'       }, description: { en: '9-quarter DFAST projection under 3 scenarios',           es: 'Proyección 9Q DFAST bajo 3 escenarios'                 }, regulatoryRefs: ['DFAST'] },
  { slug: 'stress-test',       href: '/alm/stress-test',       category: 'intelligence', tier: 'core',     status: 'ga', icon: AlertOctagon,     name: { en: 'Stress Test',        es: 'Prueba de Estrés'       }, description: { en: 'Custom stress test scenario runner',                     es: 'Ejecutor escenarios estrés personalizados'             } },
  { slug: 'stress-scenarios',  href: '/alm/stress-scenarios',  category: 'intelligence', tier: 'core',     status: 'ga', icon: SlidersHorizontal, name: { en: 'Stress Scenarios',   es: 'Escenarios Estrés'      }, description: { en: 'Library of pre-defined stress scenarios',                es: 'Biblioteca escenarios estrés predefinidos'             } },
  { slug: 'ews',               href: '/alm/ews',               category: 'intelligence', tier: 'advanced', status: 'ga', icon: AlertOctagon,     name: { en: 'Early Warning',      es: 'Alerta Temprana'        }, description: { en: 'Multi-signal deterioration detection system',            es: 'Sistema detección deterioro multi-señal'               }, endpoint: '/api/alm/{id}/ews' },
  { slug: 'scenario-builder',  href: '/alm/scenario-builder',  category: 'intelligence', tier: 'core',     status: 'ga', icon: SlidersHorizontal, name: { en: 'Scenario Builder',   es: 'Constructor Escenarios' }, description: { en: 'Custom 4-slider scenarios with PR presets',              es: 'Escenarios personalizados 4 controles + PR'            } },
  { slug: 'scenario-compare',  href: '/alm/scenario-compare',  category: 'intelligence', tier: 'core',     status: 'ga', icon: BarChart3,        name: { en: 'Scenario Compare',   es: 'Comparar Escenarios'    }, description: { en: 'Side-by-side NIM/LCR/Capital comparison',                es: 'Comparación lado a lado NIM/LCR/Capital'               } },
  { slug: 'network',           href: '/alm/network',           category: 'intelligence', tier: 'advanced', status: 'beta', icon: GitBranch,       name: { en: 'Network Intel',      es: 'Inteligencia Red'       }, description: { en: 'PR cooperative network intelligence dashboard',          es: 'Tablero inteligencia red cooperativas PR'              } },
  { slug: 'usvi',              href: '/alm/usvi',              category: 'intelligence', tier: 'advanced', status: 'beta', icon: Globe,           name: { en: 'USVI Expansion',     es: 'Expansión USVI'         }, description: { en: 'USVI FSC framework, peer benchmarks, calendar',          es: 'Marco FSC USVI, benchmarks, calendario'                }, endpoint: '/api/alm/usvi/framework' },
  { slug: 'trends',            href: '/alm/trends',            category: 'intelligence', tier: 'core',     status: 'ga', icon: LineChart,        name: { en: 'Trends',             es: 'Tendencias'             }, description: { en: 'Long-term trend analysis across KPIs',                   es: 'Análisis tendencias largo plazo en KPIs'               }, endpoint: '/api/alm/{id}/trend' },

  // ─ Quant Frontier ───────────────────────────────────────────────────────────
  { slug: 'black-litterman', href: '/alm/black-litterman', category: 'frontier', tier: 'frontier', status: 'ga', icon: Brain,        name: { en: 'Black-Litterman', es: 'Black-Litterman'   }, description: { en: 'Bayesian posterior allocation, CAPM equilibrium views',  es: 'Asignación posterior Bayesiana, equilibrio CAPM'       }, endpoint: '/api/alm/{id}/black-litterman' },
  { slug: 'cvar-optimizer',  href: '/alm/cvar-optimizer',  category: 'frontier', tier: 'frontier', status: 'ga', icon: Target,       name: { en: 'CVaR Optimizer',  es: 'Optimizador CVaR'  }, description: { en: 'Rockafellar-Uryasev efficient frontier',                 es: 'Frontera eficiente Rockafellar-Uryasev'                }, endpoint: '/api/alm/{id}/cvar-optimize' },
  { slug: 'hrp',             href: '/alm/hrp',             category: 'frontier', tier: 'frontier', status: 'ga', icon: GitBranch,    name: { en: 'HRP',             es: 'HRP'               }, description: { en: 'López de Prado hierarchical risk parity',                es: 'Paridad riesgo jerárquica López de Prado'              } },
  { slug: 'credit-metrics',  href: '/alm/credit-metrics',  category: 'frontier', tier: 'frontier', status: 'ga', icon: Shield,       name: { en: 'CreditMetrics',   es: 'CreditMetrics'     }, description: { en: 'JP Morgan migration VaR with correlations',              es: 'VaR migración JP Morgan con correlaciones'             } },
  { slug: 'kmv-merton',      href: '/alm/kmv-merton',      category: 'frontier', tier: 'frontier', status: 'ga', icon: Gauge,        name: { en: 'KMV-Merton',      es: 'KMV-Merton'        }, description: { en: 'Structural model: Distance-to-Default per obligor',      es: 'Modelo estructural: Distancia al Incumplimiento'       } },
  { slug: 'frtb-ima',        href: '/alm/frtb-ima',        category: 'frontier', tier: 'frontier', status: 'ga', icon: ShieldCheck,  name: { en: 'FRTB-IMA',        es: 'FRTB-IMA'          }, description: { en: 'Basel III.1 Expected Shortfall with liquidity horizons', es: 'Expected Shortfall Basel III.1 con horizontes liquidez' }, regulatoryRefs: ['Basel III.1', 'FRTB'], endpoint: '/api/alm/{id}/frtb-capital' },
  { slug: 'fed-futures',     href: '/alm/fed-futures',     category: 'frontier', tier: 'frontier', status: 'ga', icon: TrendingDown, name: { en: 'Fed Futures',     es: 'Futuros Fed'       }, description: { en: 'Implied rate path vs FOMC dot plot + NII impact',        es: 'Trayectoria implícita vs dot plot + impacto NII'       } },
  { slug: 'copula-credit',   href: '/alm/copula-credit',   category: 'frontier', tier: 'frontier', status: 'ga', icon: Link2,        name: { en: 'Credit Copula',   es: 'Copula Crediticia' }, description: { en: 'Gaussian vs t-Student tail dependence analysis',         es: 'Análisis dependencia cola Gaussian vs t-Student'       } },
  { slug: 'wrong-way-risk',  href: '/alm/wrong-way-risk',  category: 'frontier', tier: 'frontier', status: 'ga', icon: ArrowDownUp,  name: { en: 'Wrong-Way Risk',  es: 'Riesgo Wrong-Way'  }, description: { en: 'Naive vs adjusted CVA with exposure-PD correlation',     es: 'CVA naive vs ajustado con correlación exposición-PD'   } },
  { slug: 'cap-floor',       href: '/alm/cap-floor',       category: 'frontier', tier: 'frontier', status: 'ga', icon: ArrowUpDown,  name: { en: 'IR Cap/Floor',    es: 'IR Cap/Floor'      }, description: { en: 'Black-76 pricing, collar structure, NII protection',     es: 'Valoración Black-76, collar, protección NII'           } },
  { slug: 'macro-factors',   href: '/alm/macro-factors',   category: 'frontier', tier: 'frontier', status: 'ga', icon: Activity,     name: { en: 'Macro Factors',   es: 'Factores Macro'    }, description: { en: 'Multi-factor regression: GDP, unemployment, rates → NII', es: 'Regresión multi-factor: GDP, desempleo, tasas → NII'  } },
] as const;

// ─── Derived lookups (computed once at module load) ──────────────────────────

export const ALM_CATEGORIES_BY_ID: Readonly<Record<AlmCategoryId, AlmCategory>> =
  Object.fromEntries(ALM_CATEGORIES.map((c) => [c.id, c])) as Record<AlmCategoryId, AlmCategory>;

export const MODULES_BY_SLUG: Readonly<Record<string, AlmModule>> =
  Object.fromEntries(ALM_MODULES.map((m) => [m.slug, m]));

export const MODULES_BY_HREF: Readonly<Record<string, AlmModule>> =
  Object.fromEntries(ALM_MODULES.map((m) => [m.href.replace(/\/+$/, '') || '/', m]));

export const MODULES_BY_CATEGORY: Readonly<Record<AlmCategoryId, readonly AlmModule[]>> =
  ALM_CATEGORIES.reduce<Record<AlmCategoryId, AlmModule[]>>((acc, cat) => {
    acc[cat.id] = ALM_MODULES.filter((m) => m.category === cat.id);
    return acc;
  }, { core: [], rate: [], liquidity: [], credit: [], quant: [], strategy: [], regulatory: [], intelligence: [], frontier: [] });

export const ALM_MODULE_COUNT = ALM_MODULES.length;

/**
 * Legacy pages that now receive the shared registry-driven module header
 * from the ALM route layout. These pages keep their existing data flows
 * and content internals, but their page chrome is now unified with the
 * newer shell.
 */
export const AUTO_SHELL_SLUGS: ReadonlySet<AlmModuleSlug> = new Set<AlmModuleSlug>([
  'balance-sheet', 'advisor-v2', 'analyst', 'modules', 'reseller', 'decisions',
  'agents', 'copilot', 'sensitivity', 'behavioral-duration', 'sofr-exposure',
  'ltp', 'conc-var', 'oas', 'optionality', 'compliance', 'peer-benchmarking',
  'macro-regime', 'stress-test', 'scenario-builder', 'scenario-compare',
  'network', 'credit-metrics', 'fed-futures', 'wrong-way-risk', 'cap-floor',
  'macro-factors', 'agent-alerts',
]);

/**
 * Set of module slugs that have been migrated to the shared ALM page shell.
 *
 * This includes:
 *   - self-shelled pages built on `AlmPage`
 *   - legacy pages whose chrome is now standardized by the ALM route layout
 *
 * Update this set whenever you migrate a module — it's the source of truth
 * for the dashboard's migrated counter, the ModuleStatusGrid status badge,
 * and any future build-time coverage check.
 *
 * Invariant: every slug here MUST exist in ALM_MODULES.
 */
export const MIGRATED_SLUGS: ReadonlySet<AlmModuleSlug> = new Set<AlmModuleSlug>([
  // Wave 3: keystone migrations
  'var', 'cecl', 'liquidity', 'stress-v2', 'nim-attribution',
  'black-litterman', 'garch', 'hull-white',
  // Wave 4: density + regulatory block + quant frontier
  'irr-policy', 'exam-prep', 'monte-carlo', 'kmv-merton', 'copula-credit', 'cvar-optimizer',
  // Wave 5: regulatory + rate risk + quant frontier tail
  'svensson', 'board-report', 'usvi', 'rbc2', 'yield-curve', 'hrp', 'frtb-ima',
  // Wave 6: liquidity + rate shock + strategy
  'nsfr', 'stress-pack', 'rate-shock-v2', 'repricing-gap', 'key-rate-durations',
  'deposit-beta', 'ftp', 'capital-optimizer', 'forward-sim', 'nim-optimizer',
  // Wave 7: alerts + climate + regulatory + credit + intelligence
  'alerts', 'climate-risk', 'pca-yield-curve', 'camel-forecast', 'form-5300',
  'credit-risk', 'peer-analytics', 'ews', 'concentration', 'trends',
  // Member 360 (Wave 3 / Layer 3, fixture-first)
  'member-360',
  // Shared layout-shell migration for the remaining page-backed modules
  ...AUTO_SHELL_SLUGS,
  // Route-backed pages that already render inside the shared ALM shell
  'overview',
]);

/** True if a module has been migrated to the shared ALM module shell. */
export function isMigrated(slug: string): boolean {
  return MIGRATED_SLUGS.has(slug as AlmModuleSlug);
}

export const MIGRATED_COUNT = MIGRATED_SLUGS.size;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Locale-aware module name lookup, with optional short-form fallback. */
export function getModuleName(
  slug: string,
  locale: 'en' | 'es',
  options: { short?: boolean } = {},
): string | null {
  const mod = MODULES_BY_SLUG[slug];
  if (!mod) return null;
  if (options.short && mod.shortName) return mod.shortName[locale];
  return mod.name[locale];
}

/** Resolve a module by its slug, returning undefined if not registered. */
export function getAlmModule(slug: string): AlmModule | undefined {
  return MODULES_BY_SLUG[slug];
}

/** Resolve module from a pathname like '/alm/var/details' → 'var'. */
export function getAlmModuleFromPathname(pathname: string): AlmModule | undefined {
  if (!pathname.startsWith('/alm/')) return undefined;
  const normalizedPath = pathname.replace(/\/+$/, '') || '/';
  return MODULES_BY_HREF[normalizedPath] ?? MODULES_BY_SLUG[pathname.replace('/alm/', '').split('/')[0]];
}
