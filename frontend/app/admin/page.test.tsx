import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode, SVGProps } from "react";
import AdminPage from "./page";

const { getAdminOpsMock } = vi.hoisted(() => ({
  getAdminOpsMock: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    ...props
  }: { children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}));

vi.mock("@/lib/api", () => ({
  apiClient: {
    getAdminOps: getAdminOpsMock,
  },
}));

vi.mock("lucide-react", () => {
  const Icon = (props: SVGProps<SVGSVGElement>) => <svg {...props} />;
  return { Landmark: Icon };
});

describe("AdminPage", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    getAdminOpsMock.mockReset();
  });

  it("asks for an admin key when none is stored", () => {
    render(<AdminPage />);
    expect(screen.getByPlaceholderText("Enter admin key")).toBeInTheDocument();
  });

  it("shows the section index after a valid key is entered", async () => {
    getAdminOpsMock.mockResolvedValueOnce({});
    render(<AdminPage />);

    fireEvent.change(screen.getByPlaceholderText("Enter admin key"), {
      target: { value: crypto.randomUUID() },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(screen.getByText("Report pipeline")).toBeInTheDocument();
    });
    expect(screen.getByText("Model registry").closest("a")).toHaveAttribute(
      "href",
      "/admin/models",
    );
  });

  it("clears the stored key and shows an error when verification fails", async () => {
    getAdminOpsMock.mockRejectedValueOnce(new Error("401"));
    render(<AdminPage />);

    fireEvent.change(screen.getByPlaceholderText("Enter admin key"), {
      target: { value: crypto.randomUUID() },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(screen.getByText("Invalid admin key")).toBeInTheDocument();
    });
    expect(sessionStorage.getItem("cerniq_admin_key")).toBeNull();
  });
});
