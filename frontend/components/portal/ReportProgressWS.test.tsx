import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import ReportProgressWS from "./ReportProgressWS";

const { ioMock } = vi.hoisted(() => ({
  ioMock: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    ...props
  }: { children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}));

vi.mock("socket.io-client", () => ({
  io: ioMock,
}));

vi.mock("@/lib/i18n", () => ({
  useTranslation: () => ({ locale: "en" }),
}));

vi.mock("@/components/exports/DocumentExportButtons", () => ({
  default: () => <div>Export buttons</div>,
}));

describe("ReportProgressWS", () => {
  beforeEach(() => {
    ioMock.mockReset();
    ioMock.mockReturnValue({
      on: vi.fn(),
      emit: vi.fn(),
      close: vi.fn(),
    });
  });

  it("maps backend processing statuses into the live progress step on first render", () => {
    render(
      <ReportProgressWS
        jobId="job-1"
        institutionName="Cooperativa Test"
        initialStatus="GENERATING_PDF"
      />,
    );

    expect(screen.getByText("80%")).toBeInTheDocument();
    expect(screen.getAllByText(/generating pdf/i).length).toBeGreaterThan(0);
  });
});
