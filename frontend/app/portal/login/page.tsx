import { redirect } from 'next/navigation';
import { buildLoginUrlForReturnUrl } from '@/lib/auth-redirect';

export default async function PortalLoginPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = (await searchParams) || {};
  const billing =
    typeof resolvedSearchParams.billing === 'string'
      ? resolvedSearchParams.billing
      : undefined;
  const returnUrl = billing === 'success' ? '/portal?welcome=1' : '/portal';

  redirect(
    buildLoginUrlForReturnUrl(returnUrl, {
      billingSuccess: billing === 'success',
      forceMagicLink: true,
    }),
  );
}
