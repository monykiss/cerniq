# ADR — Loan-level lifecycle and the loan-tape bridge into Member 360

**Status:** Accepted · 2026-08-14
**Supersedes nothing.** Extends [ADR-member-360-layer3.md](ADR-member-360-layer3.md), whose closing
note reserved real ingestion as "a new decision, not an amendment to this one." This is that
decision.

---

## 1. Context

Member 360 shipped 2026-08-12 as a fixture-first Layer 3 surface and went live in production
2026-08-13. The next requirement was explicit: make it *"able to get real customer data"* and
*"emulate a full loan lifecycle of auto, personal loan, mortgage and other commercial and
industrial loans."*

Investigating what already existed produced three findings that shaped this design:

1. **The product taxonomy already covered every product named.** `product-registry.ts` has carried
   `PRESTAMO_AUTO`, `PRESTAMO_PERSONAL`, `HIPOTECA` and `PRESTAMO_COMERCIAL` (MBL — the PR
   cooperativa booking for what mainland institutions call C&I) since Layer 1, each with PD, LGD,
   CECL eligibility and a balance-sheet subcategory.
2. **Nothing could reach it.** Both `MemberAccount.productType` and `LoanRecord.segmentName` are
   free text, with no mapping to the registry. `MemberAccount.productType`'s own doc comment
   predicted this ("meant to roll up into it in the aggregation service, NOT to duplicate it as a
   second enum that can drift out of sync") — and the fixture generator had drifted exactly that
   way, inventing a parallel Spanish label vocabulary.
3. **Real loan data already flows in.** `LoanRecord` + `src/alm/loan-tape/` (W2.0) ingest
   loan-level tapes today. They were simply disconnected from Member 360 — two islands.

So the work was never "build ingestion." It was: build the join key, model the loan's own
lifecycle, and connect the two islands.

---

## 2. Decision

### 2.1 One mapper, never a guess

`cooperativa/product-mapping.ts` resolves free text → `CooperativaProductType` for both surfaces.
Two phases: exact match on a normalized synonym table, then an **ordered** token-rule list.

An unrecognized label returns `null`, never a nearest match and never a default bucket. Bucketing an
unknown label into `PRESTAMO_PERSONAL` would silently hand that loan a 2.5% PD and 65% LGD it was
never measured to have, and the resulting CECL figure would look authoritative. `null` forces the
caller to disclose `PRODUCT_TYPE_UNMAPPED` instead (D1).

**Ordering is load-bearing.** The taxonomy contains a real collision: *"préstamo con garantía de
acciones"* is a share-**secured loan** (asset, PD 0.3%), while bare *"acciones"* is share savings
(liability, no PD). A naive `includes('acciones')` files a loan as a deposit and moves the balance
to the wrong side of the balance sheet. Prefix matching is likewise opt-in per rule — a blanket
prefix would let `auto` fire on `automatico`.

### 2.2 The loan lifecycle is a different enum from the member lifecycle

`LoanLifecycleStage` is deliberately **not** `MemberLifecycleStage`:

| Fact | Member-level | Loan-level |
|---|---|---|
| ≥90 DPD | `WORKOUT` — the posture toward the socio | `NONACCRUAL` — the accounting state |
| Restructured | (not modelled) | `WORKOUT` — an actual TDR |

Collapsing them would force one to lie. A member in `WORKOUT` holding a perfectly `CURRENT` auto
loan and a `NONACCRUAL` mortgage is the normal case, not an edge case.

Stages: `ORIGINATED · CURRENT · EARLY_DELINQUENCY · DELINQUENT_30 · DELINQUENT_60 · NONACCRUAL ·
WORKOUT · PAID_OFF · CHARGED_OFF`. DPD boundaries follow the NCUA 5300 / COSSEC buckets (30-59,
60-89, 90+) so Member 360 stage counts reconcile against the institution's own regulatory filings
rather than against numbers we invented.

`WORKOUT` and `CHARGED_OFF` are **explicit inputs, never inferred**. A 400-DPD loan is `NONACCRUAL`,
not charged off — writing a loan off is an accounting decision with consequences, not a conclusion
you reach from a delinquency counter. This is the same discipline
`MemberLifecycleStage.CHARGED_OFF` already documented.

### 2.3 One COSSEC-mapping authority

The fixture generator carried its own `classifyCossec()` that mapped 1-29 DPD to `special_mention`,
while the lifecycle service maps that bucket to `pass`. That table was **deleted**, not reconciled:
COSSEC/NCUA special mention begins at 30 days, and a demo book that disagrees with the classifier
the product ships is a liability. Classification now comes from `LoanLifecycleService` and nowhere
else.

### 2.4 The tape bridge is honest about what a loan tape is not

`MemberBookFromTapeService` projects `LoanRecord` rows into `Member`/`MemberAccount` with
`source: "ingested"`, keyed `borrowerId → memberNumber` and `externalLoanId → MemberAccount`.

A loan tape is an asset-side extract, so three limits are disclosed rather than papered over:

- **No deposits or shares.** Loan-to-deposit is not computable, and a zero total balance must not be
  read as a churned member. A book-level gap says so.
- **No borrower names.** Tapes carry a key, not PII. The key is displayed as-is; no name is
  invented.
- **Not every row is attributable.** Rows without `borrowerId` are excluded (inventing one member
  per orphan row would understate single-borrower concentration — the hazard
  `LoanRecord.borrowerId` already documents). Rows without `originationDate` are also excluded:
  stamping the tape date would make every such loan classify `ORIGINATED`, a systematic misread.
  Both are counted and disclosed, following the `NO_BORROWER_DATA` precedent already emitted by
  `ConcentrationService`.

An unmappable product is **ingested anyway** with a null code — the balance stays visible; only the
pricing is withheld.

---

## 3. Consequences

**Enabled.** Per-product rollup (a member's auto loan now reaches its own PD/LGD), per-product and
per-stage concentration, expected loss at loan level, and a real path from an uploaded tape to a
populated Member 360 with zero changes to any consuming surface.

**Cost.** Two new enum types and six columns on `member_accounts`; a mapper whose synonym table
needs extending as new tape dialects appear (an unmapped label is disclosed, not silently wrong, so
the failure mode is visible).

**Verified.** 42/42 live audit against a real Postgres (up from 24) — all four named
products present, all nine loan stages populated, every zero-balance loan explicitly `PAID_OFF`, no
phantom zeros. Backend jest 395 suites / 5580 tests.

---

## 4. What is deliberately NOT done

1. **PD/LGD remain registry cold-start priors.** Every expected-loss figure carries a
   `PD_LGD_REGISTRY_DEFAULT` gap naming that provenance. The registry itself flags this
   OPERATOR-INPUT-NEEDED until an institution's own loss history is available.
2. **No `ModelRegistryEntry`** for the loan classifier — the same outstanding item ADR-member-360
   §4 records for the member classifier.
3. **No HTTP route yet exposes the tape bridge.** The service is wired into `AlmModule` and tested,
   but building a member book from a tape is a deliberate operator action, not something to trigger
   implicitly on upload; the endpoint and its authorization are a separate decision.
4. **`originalPrincipal` is null for ingested loans** — `LoanRecord` does not carry it, so
   amortization progress reads null for tape-sourced loans rather than being inferred.
5. **Thresholds are uncalibrated** against a real PR cooperativa book, as with the member
   classifier.

---

*Written 2026-08-14 alongside the loan-lifecycle landing. Update the status when a real design
partner's tape is ingested — calibration against it is a new decision, not an amendment to this
one.*
