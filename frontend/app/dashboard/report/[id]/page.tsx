"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

export default function LegacyDashboardReportRedirect() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const targetHref = `/portal/reports/${params.id}`;

  useEffect(() => {
    router.replace(targetHref);
  }, [router, targetHref]);

  return (
    <div className="flex min-h-[320px] items-center justify-center bg-transparent px-6 text-[var(--dashboard-text-primary)]">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold">
          Redirecting to the secure report viewer
        </h1>
        <p className="mt-3 text-sm text-[var(--dashboard-text-secondary)]">
          CERNIQ now serves report delivery from the manifest-backed secure workspace
          workflow.
        </p>
        <Link
          href={targetHref}
          className="mt-6 inline-flex rounded-lg bg-amber-500 px-5 py-3 text-sm font-semibold text-white hover:bg-amber-600"
        >
          Open secure report
        </Link>
      </div>
    </div>
  );
}
