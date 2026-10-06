import {
  isLendingProduct,
  mapProductLabel,
  normalizeProductLabel,
} from './product-mapping';
import {
  COOPERATIVA_PRODUCT_REGISTRY,
  COOPERATIVA_PRODUCT_TYPES,
} from './product-registry';

describe('normalizeProductLabel', () => {
  it('strips accents so a Latin-1 round trip still maps', () => {
    expect(normalizeProductLabel('Préstamo')).toBe('prestamo');
    expect(normalizeProductLabel('PRÉSTAMO')).toBe('prestamo');
    expect(normalizeProductLabel('prestamo')).toBe('prestamo');
  });

  it('collapses punctuation and whitespace to single spaces', () => {
    expect(normalizeProductLabel('  Préstamo   de/auto  ')).toBe(
      'prestamo de auto',
    );
    expect(normalizeProductLabel('C&I')).toBe('c i');
  });
});

describe('mapProductLabel — the four products the founder named', () => {
  it.each([
    ['préstamo de auto', 'PRESTAMO_AUTO'],
    ['Auto Loan', 'PRESTAMO_AUTO'],
    ['AUTO', 'PRESTAMO_AUTO'],
    ['préstamo personal', 'PRESTAMO_PERSONAL'],
    ['Personal Loans', 'PRESTAMO_PERSONAL'],
    ['hipoteca', 'HIPOTECA'],
    ['hipotecario', 'HIPOTECA'],
    ['Residential Mortgages', 'HIPOTECA'],
    ['préstamo comercial', 'PRESTAMO_COMERCIAL'],
    ['MBL', 'PRESTAMO_COMERCIAL'],
    ['Member Business Loan', 'PRESTAMO_COMERCIAL'],
    ['Commercial and Industrial', 'PRESTAMO_COMERCIAL'],
    ['C&I', 'PRESTAMO_COMERCIAL'],
  ])('maps %s -> %s', (raw, expected) => {
    expect(mapProductLabel(raw)?.productType).toBe(expected);
  });
});

describe('mapProductLabel — idempotence', () => {
  it('passes an already-canonical code straight through', () => {
    for (const code of COOPERATIVA_PRODUCT_TYPES) {
      const match = mapProductLabel(code);
      expect(match).not.toBeNull();
      expect(match?.productType).toBe(code);
      expect(match?.method).toBe('canonical');
    }
  });

  it('re-mapping a mapped result is stable', () => {
    const once = mapProductLabel('préstamo de auto');
    const twice = mapProductLabel(once!.productType);
    expect(twice?.productType).toBe(once?.productType);
  });
});

describe('mapProductLabel — the share-secured / shares collision', () => {
  // This is the reason matching is ordered rather than substring-based. A
  // share-SECURED loan is an ASSET with a PD; share savings is a LIABILITY
  // with none. Getting this backwards moves the balance to the wrong side of
  // the balance sheet and silently drops it out of CECL.
  it('maps share-secured loans to the LOAN product, not to shares', () => {
    for (const raw of [
      'garantía de acciones',
      'préstamo con garantía de acciones',
      'Share Secured Loan',
      'prestamo con garantia de acciones',
    ]) {
      expect(mapProductLabel(raw)?.productType).toBe(
        'PRESTAMO_GARANTIA_ACCIONES',
      );
    }
  });

  it('still maps bare acciones/ahorros to the savings product', () => {
    expect(mapProductLabel('acciones')?.productType).toBe('CUENTA_AHORRO');
    expect(mapProductLabel('cuenta de ahorros')?.productType).toBe(
      'CUENTA_AHORRO',
    );
  });

  it('keeps the two on opposite sides of the balance sheet', () => {
    const loan = mapProductLabel('garantía de acciones')!.productType;
    const savings = mapProductLabel('acciones')!.productType;
    expect(COOPERATIVA_PRODUCT_REGISTRY[loan].side).toBe('asset');
    expect(COOPERATIVA_PRODUCT_REGISTRY[savings].side).toBe('liability');
  });
});

describe('mapProductLabel — D1: never guess', () => {
  it.each([
    ['', 'empty'],
    ['   ', 'whitespace only'],
    ['xyzzy', 'nonsense'],
    ['crypto margin loan', 'a real product this coop does not offer'],
    ['12345', 'a bare number'],
    ['!!!', 'punctuation only'],
  ])('returns null for %s (%s)', (raw) => {
    expect(mapProductLabel(raw)).toBeNull();
  });

  it('returns null for null/undefined rather than throwing', () => {
    expect(mapProductLabel(null)).toBeNull();
    expect(mapProductLabel(undefined)).toBeNull();
  });

  it('never falls back to a default product bucket', () => {
    // If an unknown label silently became PRESTAMO_PERSONAL it would inherit a
    // 2.5% PD and 65% LGD it was never measured to have.
    const unknowns = ['unknown product', 'misc', 'other', 'n/a'];
    for (const u of unknowns) {
      expect(mapProductLabel(u)).toBeNull();
    }
  });
});

describe('mapProductLabel — prefix matching is opt-in, not blanket', () => {
  it('does not let "auto" fire on unrelated words that merely start with it', () => {
    // "automatico" is a real word in core-system product descriptions. Blanket
    // prefix matching would misfile it as an auto loan.
    expect(mapProductLabel('automatico')).toBeNull();
    expect(mapProductLabel('pago automatico')).toBeNull();
  });

  it('does apply the declared hipotec* stem', () => {
    expect(mapProductLabel('hipotecaria')?.productType).toBe('HIPOTECA');
  });
});

describe('isLendingProduct', () => {
  it('is true for exactly the asset-side products', () => {
    for (const code of COOPERATIVA_PRODUCT_TYPES) {
      const expected = COOPERATIVA_PRODUCT_REGISTRY[code].side === 'asset';
      expect(isLendingProduct(code)).toBe(expected);
    }
  });

  it('covers the four founder-named products', () => {
    expect(isLendingProduct('PRESTAMO_AUTO')).toBe(true);
    expect(isLendingProduct('PRESTAMO_PERSONAL')).toBe(true);
    expect(isLendingProduct('HIPOTECA')).toBe(true);
    expect(isLendingProduct('PRESTAMO_COMERCIAL')).toBe(true);
  });

  it('is false for deposit-side products', () => {
    expect(isLendingProduct('CUENTA_AHORRO')).toBe(false);
    expect(isLendingProduct('CERTIFICADO_DEPOSITO')).toBe(false);
    expect(isLendingProduct('CLUB_NAVIDAD')).toBe(false);
  });
});

describe('mapProductLabel — every registry product is reachable from free text', () => {
  // Guards against adding a product to the registry with no way to map a tape
  // label onto it, which would make it permanently unmappable in ingestion.
  it.each(COOPERATIVA_PRODUCT_TYPES.map((c) => [c]))(
    '%s is reachable from its Spanish registry name',
    (code) => {
      const nombre = COOPERATIVA_PRODUCT_REGISTRY[code].nombre;
      expect(mapProductLabel(nombre)?.productType).toBe(code);
    },
  );

  it.each(COOPERATIVA_PRODUCT_TYPES.map((c) => [c]))(
    '%s is reachable from its English registry name',
    (code) => {
      const nameEn = COOPERATIVA_PRODUCT_REGISTRY[code].nameEn;
      expect(mapProductLabel(nameEn)?.productType).toBe(code);
    },
  );
});
