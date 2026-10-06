'use client';

/**
 * Canonical institution-id resolver for client components.
 *
 * Layered semantics (highest priority first):
 *   1. `?institutionId=...` URL query param — explicit deep link, always wins.
 *   2. `useALM().selectedId` — when the page lives inside the ALM shell
 *      (which is provided by `/app/alm/layout.tsx`) and the user has picked
 *      an institution from the selector.
 *   3. `undefined` — the caller MUST handle this (render a banner asking the
 *      user to pick an institution, or redirect to `/alm`).
 *
 * Rationale: a parallel session built `/cockpit/*` with URL-param-only
 * resolution and another built `/alm/*` with ALM-context-only resolution.
 * Folding both patterns lets deep links from email alerts and Slack work
 * (`?institutionId=...`) while in-app navigation still flows through the
 * ALM institution selector.
 *
 * This hook MUST be called from a client component. Wrap in <Suspense>
 * if used above any boundary that might suspend — `useSearchParams()`
 * suspends when the URL is still being parsed on the first render.
 */

import { useSearchParams } from 'next/navigation';
import { useALM } from '@/components/alm/ALMProvider';

export function useInstitutionId(): string | undefined {
  const params = useSearchParams();
  const fromUrl = params.get('institutionId') ?? undefined;
  // ALMProvider exports a default context whose selectedId is '' (empty)
  // when no provider is mounted above. Treat empty as absent so callers
  // render the "pick an institution" banner instead of a silent no-op.
  const { selectedId } = useALM();
  const fromContext = selectedId && selectedId.length > 0 ? selectedId : undefined;

  // URL takes precedence; fall back to ALM shell context if present.
  return fromUrl ?? fromContext;
}
