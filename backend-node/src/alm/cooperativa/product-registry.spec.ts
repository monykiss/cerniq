import {
  COOPERATIVA_PRODUCT_REGISTRY,
  COOPERATIVA_PRODUCT_TYPES,
  PR_PD_MULTIPLIERS,
  PR_SCENARIO_WEIGHTS,
  ceclEligibleProducts,
  matchProductType,
} from './product-registry';

describe('CooperativaProductRegistry', () => {
  it('covers all 8 cooperativa product types', () => {
    expect(COOPERATIVA_PRODUCT_TYPES).toHaveLength(8);
    for (const t of COOPERATIVA_PRODUCT_TYPES) {
      expect(COOPERATIVA_PRODUCT_REGISTRY[t]).toBeDefined();
      expect(COOPERATIVA_PRODUCT_REGISTRY[t].productType).toBe(t);
    }
  });

  it('labels every product Spanish-first with an English secondary', () => {
    for (const t of COOPERATIVA_PRODUCT_TYPES) {
      const p = COOPERATIVA_PRODUCT_REGISTRY[t];
      expect(p.nombre.length).toBeGreaterThan(0);
      expect(p.nameEn.length).toBeGreaterThan(0);
      expect(p.notaCalibracion.length).toBeGreaterThan(0);
    }
  });

  it('marks only asset-side loan products as CECL-eligible', () => {
    const eligible = ceclEligibleProducts();
    expect(eligible.map((p) => p.productType).sort()).toEqual(
      [
        'HIPOTECA',
        'PRESTAMO_AUTO',
        'PRESTAMO_COMERCIAL',
        'PRESTAMO_GARANTIA_ACCIONES',
        'PRESTAMO_PERSONAL',
      ].sort(),
    );
    for (const p of eligible) {
      expect(p.side).toBe('asset');
      expect(p.defaultAnnualPd).not.toBeNull();
      expect(p.defaultLgd).not.toBeNull();
    }
  });

  it('gives liability-side products null PD/LGD (no phantom credit risk)', () => {
    for (const t of [
      'CLUB_NAVIDAD',
      'CUENTA_AHORRO',
      'CERTIFICADO_DEPOSITO',
    ] as const) {
      const p = COOPERATIVA_PRODUCT_REGISTRY[t];
      expect(p.side).toBe('liability');
      expect(p.ceclEligible).toBe(false);
      expect(p.defaultAnnualPd).toBeNull();
      expect(p.defaultLgd).toBeNull();
    }
  });

  it('keeps PD/LGD defaults inside sane bounds', () => {
    for (const p of ceclEligibleProducts()) {
      expect(p.defaultAnnualPd!).toBeGreaterThan(0);
      expect(p.defaultAnnualPd!).toBeLessThan(0.1);
      expect(p.defaultLgd!).toBeGreaterThan(0);
      expect(p.defaultLgd!).toBeLessThanOrEqual(1);
      expect(p.defaultMaturityYears).toBeGreaterThan(0);
    }
  });

  it('orders credit risk sensibly: share-secured < mortgage < auto < MBL < personal', () => {
    const pd = (t: (typeof COOPERATIVA_PRODUCT_TYPES)[number]) =>
      COOPERATIVA_PRODUCT_REGISTRY[t].defaultAnnualPd!;
    expect(pd('PRESTAMO_GARANTIA_ACCIONES')).toBeLessThan(pd('HIPOTECA'));
    expect(pd('HIPOTECA')).toBeLessThan(pd('PRESTAMO_AUTO'));
    expect(pd('PRESTAMO_AUTO')).toBeLessThan(pd('PRESTAMO_COMERCIAL'));
    expect(pd('PRESTAMO_COMERCIAL')).toBeLessThan(pd('PRESTAMO_PERSONAL'));
  });

  describe('PR macro overlay', () => {
    it('scenario weights sum to 1', () => {
      const sum =
        PR_SCENARIO_WEIGHTS.baseline +
        PR_SCENARIO_WEIGHTS.adverse +
        PR_SCENARIO_WEIGHTS.severely_adverse;
      expect(sum).toBeCloseTo(1.0, 10);
    });

    it('PR multipliers are strictly harsher than mainland CCAR defaults', () => {
      expect(PR_PD_MULTIPLIERS.baseline).toBe(1.0);
      expect(PR_PD_MULTIPLIERS.adverse).toBeGreaterThan(1.8);
      expect(PR_PD_MULTIPLIERS.severely_adverse).toBeGreaterThan(3.0);
    });

    it('shifts weight from baseline toward adverse vs FASB community default', () => {
      expect(PR_SCENARIO_WEIGHTS.baseline).toBeLessThan(0.5);
      expect(PR_SCENARIO_WEIGHTS.adverse).toBeGreaterThan(0.3);
    });
  });

  describe('matchProductType', () => {
    it.each([
      ['Préstamos personales', 'PRESTAMO_PERSONAL'],
      ['Consumer Loans', 'PRESTAMO_PERSONAL'],
      ['Préstamos de auto', 'PRESTAMO_AUTO'],
      ['Auto Loans', 'PRESTAMO_AUTO'],
      ['Hipotecas residenciales', 'HIPOTECA'],
      ['Residential Mortgage', 'HIPOTECA'],
      ['Préstamos comerciales', 'PRESTAMO_COMERCIAL'],
      ['Member Business Loans (MBL)', 'PRESTAMO_COMERCIAL'],
      ['Préstamos con garantía de acciones', 'PRESTAMO_GARANTIA_ACCIONES'],
      ['Share-Secured Loans', 'PRESTAMO_GARANTIA_ACCIONES'],
      ['Club de Navidad', 'CLUB_NAVIDAD'],
      ['Christmas Club', 'CLUB_NAVIDAD'],
      ['Cuentas de ahorro', 'CUENTA_AHORRO'],
      ['Share Savings', 'CUENTA_AHORRO'],
      ['Certificados de depósito', 'CERTIFICADO_DEPOSITO'],
      ['Certificate of Deposit', 'CERTIFICADO_DEPOSITO'],
    ])('matches "%s" → %s', (name, expected) => {
      expect(matchProductType(name)).toBe(expected);
    });

    it('returns null for unmatchable names instead of guessing (D1)', () => {
      expect(matchProductType('')).toBeNull();
      expect(matchProductType('Derivados exóticos')).toBeNull();
      expect(matchProductType('Misc')).toBeNull();
    });

    it('prefers share-secured over generic savings match', () => {
      expect(matchProductType('Préstamo garantizado por acciones')).toBe(
        'PRESTAMO_GARANTIA_ACCIONES',
      );
    });

    // Regression: a loan named with a non-canonical preposition ("con"/"de
    // colateral"/"sobre") must NOT fall through to the broad CUENTA_AHORRO
    // "acciones" token and be silently dropped from the CECL allowance (D1).
    it.each([
      'Préstamos garantizados con acciones del socio',
      'Préstamo con colateral de acciones',
      'Préstamo colateralizado con acciones',
      'Préstamos sobre acciones del socio',
      'Préstamo respaldado por acciones',
      'Loan secured by member shares',
    ])(
      'classifies share-secured variant "%s" as the loan, not a deposit',
      (name) => {
        expect(matchProductType(name)).toBe('PRESTAMO_GARANTIA_ACCIONES');
      },
    );

    it('keeps genuine share-savings accounts as CUENTA_AHORRO (no loan token)', () => {
      expect(matchProductType('Cuentas de ahorro de acciones')).toBe(
        'CUENTA_AHORRO',
      );
      expect(matchProductType('Share savings accounts')).toBe('CUENTA_AHORRO');
    });
  });
});
