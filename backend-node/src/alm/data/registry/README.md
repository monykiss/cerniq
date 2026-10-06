# PR Cooperativas Registry (COSSEC Anejo 9)

Committed source of truth for GTM CRM + product market-map shells.

| File | Role |
|---|---|
| `pr-cooperativas-q2-2025.json` | 91 insured cooperativas (charter, assets, members, FTE, ICP tier) |
| `pr-cooperativas.registry.ts` | Loader + verify helpers |
| `../data-pull/cossec-snapshots/cossec-2025q4.ts` | Demo/sample-report snapshots derived from this registry |

**Seed**

```bash
pnpm seed:pr-registry -- --track=crm
pnpm seed:pr-registry -- --track=product
pnpm seed:pr-registry -- --track=both
```

**Verify**

```bash
pnpm verify:pr-cooperativa-registry
pnpm verify:pr-cooperativa-registry -- --self-test
```

Refresh by re-extracting Anejo 9 from the latest COSSEC Estadísticas PDF when available.
