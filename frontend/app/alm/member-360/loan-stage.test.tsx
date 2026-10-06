import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  AmortizationBar,
  isLoanStage,
  LOAN_STAGE_OPTIONS,
  loanStageLabel,
  LoanStageBadge,
  type LoanStage,
} from "./loan-stage";

const ALL_STAGES: LoanStage[] = [
  "ORIGINATED",
  "CURRENT",
  "EARLY_DELINQUENCY",
  "DELINQUENT_30",
  "DELINQUENT_60",
  "NONACCRUAL",
  "WORKOUT",
  "PAID_OFF",
  "CHARGED_OFF",
];

describe("loanStageLabel", () => {
  it("labels every stage in both languages", () => {
    for (const stage of ALL_STAGES) {
      const en = loanStageLabel(stage, "en");
      const es = loanStageLabel(stage, "es");
      expect(en.length).toBeGreaterThan(0);
      expect(es.length).toBeGreaterThan(0);
      // A label that is still the raw enum name means a missing translation.
      expect(en).not.toBe(stage);
      expect(es).not.toBe(stage);
    }
  });

  it("gives Spanish and English distinct wording where they should differ", () => {
    expect(loanStageLabel("CURRENT", "es")).toBe("Al día");
    expect(loanStageLabel("CURRENT", "en")).toBe("Current");
    expect(loanStageLabel("NONACCRUAL", "es")).toBe("En no acumulación");
  });

  it("falls back to the raw name for an unknown stage rather than rendering blank", () => {
    expect(loanStageLabel("WAT" as LoanStage, "en")).toBe("WAT");
  });

  it("covers every declared option", () => {
    expect(LOAN_STAGE_OPTIONS).toHaveLength(ALL_STAGES.length);
  });
});

describe("isLoanStage", () => {
  it("accepts every real stage", () => {
    for (const stage of ALL_STAGES) expect(isLoanStage(stage)).toBe(true);
  });

  it("rejects member lifecycle stages, which are a different vocabulary", () => {
    // A member is ACTIVE/AT_RISK/CHURNED; a loan is never any of those.
    expect(isLoanStage("ACTIVE")).toBe(false);
    expect(isLoanStage("AT_RISK")).toBe(false);
    expect(isLoanStage("CHURNED")).toBe(false);
  });

  it("rejects non-strings and nullish values", () => {
    expect(isLoanStage(null)).toBe(false);
    expect(isLoanStage(undefined)).toBe(false);
    expect(isLoanStage(42)).toBe(false);
  });
});

describe("LoanStageBadge", () => {
  it("renders the localized stage", () => {
    render(<LoanStageBadge stage="DELINQUENT_60" locale="en" />);
    expect(screen.getByText("60-89 days past due")).toBeInTheDocument();
  });

  it("renders Spanish when asked", () => {
    render(<LoanStageBadge stage="WORKOUT" locale="es" />);
    expect(screen.getByText("Reestructurado")).toBeInTheDocument();
  });

  it("shows an explicit Unclassified badge for a null stage, not a blank cell", () => {
    // D1: a loan whose delinquency was never reported must not read as fine.
    render(<LoanStageBadge stage={null} locale="en" />);
    expect(screen.getByText("Unclassified")).toBeInTheDocument();
  });

  it("explains WHY a null stage is unclassified", () => {
    render(<LoanStageBadge stage={null} locale="en" />);
    expect(
      screen.getByTitle(/Days past due not reported/i),
    ).toBeInTheDocument();
  });

  it("gives deteriorating stages visually distinct tones", () => {
    const { container: current } = render(
      <LoanStageBadge stage="CURRENT" locale="en" />,
    );
    const { container: bad } = render(
      <LoanStageBadge stage="NONACCRUAL" locale="en" />,
    );
    expect(current.firstElementChild?.className).not.toBe(
      bad.firstElementChild?.className,
    );
  });

  it("does not colour PAID_OFF like CURRENT", () => {
    // A closed loan is not a performing one; sharing the green would overstate
    // the performing book at a glance.
    const { container: paid } = render(
      <LoanStageBadge stage="PAID_OFF" locale="en" />,
    );
    const { container: current } = render(
      <LoanStageBadge stage="CURRENT" locale="en" />,
    );
    expect(paid.firstElementChild?.className).not.toBe(
      current.firstElementChild?.className,
    );
  });
});

describe("AmortizationBar", () => {
  it("renders a percentage for a known fraction", () => {
    render(<AmortizationBar fraction={0.4} locale="en" />);
    expect(screen.getByText("40%")).toBeInTheDocument();
  });

  it("renders 100% for a fully repaid loan", () => {
    render(<AmortizationBar fraction={1} locale="en" />);
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("renders an em dash for unknown progress, never a 0% bar", () => {
    // An empty bar claims "0% repaid", which is a different and false claim
    // from "we were not told the original principal".
    render(<AmortizationBar fraction={null} locale="en" />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });

  it("explains why unknown progress is blank", () => {
    render(<AmortizationBar fraction={null} locale="es" />);
    expect(
      screen.getByTitle(/Principal original no provisto/i),
    ).toBeInTheDocument();
  });
});
