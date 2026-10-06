/**
 * Committed sample loan tape (W2.0/W2.2 golden fixture).
 *
 * A TS module for the same reason as pr-macro-snapshot: `nest build` copies
 * no assets, and the reviewed diff IS the fixture's audit trail. This is the
 * canonical instrument-level tape the goldens pin — a deliberately imperfect
 * $773K mini-book that exercises every honesty path:
 *
 *   - bilingual headers (numero_prestamo / producto / saldo / municipio…)
 *   - a borrower with THREE loans (S-100: L-001 + L-002 + L-007 — the
 *     largest single-borrower exposure; the aggregation story)
 *   - municipio concentration skewed to Caguas (the geographic-HHI story)
 *   - coverage holes, one per dimension: L-005 has no municipio, L-006 no
 *     borrower key, L-008 no rate, L-009 no maturity — each feeds a
 *     disclosed coverage gap, never an imputed value (D1)
 *   - a delinquency ladder: current / 35 / 65 / 120 DPD across the bands
 *
 * asOfDate is pinned so every derived golden is time-independent.
 */

export const SAMPLE_LOAN_TAPE_AS_OF = '2026-06-30';

export const SAMPLE_LOAN_TAPE_CSV = [
  'numero_prestamo,producto,saldo,tasa,fecha_originacion,fecha_vencimiento,tipo_garantia,valor_garantia,municipio,dias_mora,id_socio',
  'L-001,Hipotecas,180000,6.25,2019-05-01,2049-05-01,residencial,240000,Caguas,0,S-100',
  'L-002,Hipotecas,150000,6.75,2021-08-15,2051-08-15,residencial,195000,Caguas,0,S-100',
  'L-003,Hipotecas,165000,5.95,2020-02-01,2050-02-01,residencial,210000,San Juan,35,S-101',
  'L-004,Hipotecas,140000,6.10,2022-11-01,2052-11-01,residencial,175000,Ponce,0,S-102',
  'L-005,Prestamos Personales,18000,11.50,2024-03-01,2029-03-01,,,,0,S-103',
  'L-006,Prestamos Personales,22000,10.75,2023-07-01,2028-07-01,,,Caguas,65,',
  'L-007,Prestamos Personales,15000,12.00,2025-01-15,2030-01-15,,,Caguas,0,S-100',
  'L-008,Auto,28000,,2023-09-01,2029-09-01,vehiculo,32000,Bayamon,0,S-104',
  'L-009,Auto,24000,7.25,2024-06-01,,vehiculo,27000,San Juan,120,S-105',
  'L-010,Auto,31000,6.95,2022-04-01,2028-04-01,vehiculo,36000,Caguas,0,S-106',
].join('\n');
