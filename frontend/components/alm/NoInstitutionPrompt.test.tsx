import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const seedDemoInstitution = vi.fn();
const refresh = vi.fn();
const getStoredOrganizationId = vi.fn(() => "ws-1");

vi.mock("@/lib/api", () => ({
  apiClient: {
    get seedDemoInstitution() {
      return seedDemoInstitution;
    },
  },
}));
vi.mock("@/lib/org-context", () => ({
  getStoredOrganizationId: () => getStoredOrganizationId(),
}));
vi.mock("@/components/alm/ALMProvider", () => ({
  useALM: () => ({ refresh }),
}));

import { NoInstitutionPrompt } from "./NoInstitutionPrompt";

describe("NoInstitutionPrompt", () => {
  beforeEach(() => {
    seedDemoInstitution.mockReset().mockResolvedValue({ success: true });
    refresh.mockReset().mockResolvedValue(undefined);
    getStoredOrganizationId.mockReset().mockReturnValue("ws-1");
  });

  it("explains that the workspace has no institution", () => {
    render(<NoInstitutionPrompt locale="en" />);
    expect(
      screen.getByText(/No institution in this workspace/i),
    ).toBeInTheDocument();
  });

  it("renders in Spanish", () => {
    render(<NoInstitutionPrompt locale="es" />);
    expect(screen.getByText(/No hay institución/i)).toBeInTheDocument();
  });

  it("points at BOTH the real path and the demo path", () => {
    // A user with a real balance sheet should not be nudged into demo data as
    // if it were the only option.
    render(<NoInstitutionPrompt locale="en" />);
    expect(
      screen.getByText(/Upload a balance sheet in the portal/i),
    ).toBeInTheDocument();
  });

  it("seeds through the idempotent fixture endpoint on click", async () => {
    render(<NoInstitutionPrompt locale="en" />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() =>
      expect(seedDemoInstitution).toHaveBeenCalledWith("ws-1", "cooperativa"),
    );
  });

  it("refreshes the provider so panels re-run against the new institution", async () => {
    render(<NoInstitutionPrompt locale="en" />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("never seeds automatically — only on an explicit click", () => {
    // Demo data appearing on its own would make a seeded book
    // indistinguishable from a real one.
    render(<NoInstitutionPrompt locale="en" />);
    expect(seedDemoInstitution).not.toHaveBeenCalled();
  });

  it("surfaces a seeding failure instead of silently doing nothing", async () => {
    seedDemoInstitution.mockRejectedValue(new Error("boom: fixture missing"));
    render(<NoInstitutionPrompt locale="en" />);
    fireEvent.click(screen.getByRole("button"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "boom: fixture missing",
    );
  });

  it("does not post when the session has no organization context", async () => {
    getStoredOrganizationId.mockReturnValue("");
    render(<NoInstitutionPrompt locale="en" />);
    fireEvent.click(screen.getByRole("button"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /organization context/i,
    );
    expect(seedDemoInstitution).not.toHaveBeenCalled();
  });

  it("marks the button busy while seeding", async () => {
    let resolveSeed: (v: unknown) => void = () => {};
    seedDemoInstitution.mockReturnValue(
      new Promise((r) => {
        resolveSeed = r;
      }),
    );
    render(<NoInstitutionPrompt locale="en" />);
    const btn = screen.getByRole("button");
    fireEvent.click(btn);
    await waitFor(() => expect(btn).toHaveAttribute("aria-busy", "true"));
    resolveSeed({});
    await waitFor(() => expect(btn).toHaveAttribute("aria-busy", "false"));
  });
});
