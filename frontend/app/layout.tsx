import type { Metadata } from "next";
import Script from "next/script";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";
import Providers from '@/components/Providers';
import CookieConsent from '@/components/CookieConsent';
import SessionTimeoutWarning from '@/components/SessionTimeoutWarning';
import { ToastProvider } from '@/components/Toast';
import { WebVitals } from '@/components/WebVitals';
import { PRICING } from '@/lib/pricing';

export const metadata: Metadata = {
  title: "CERNIQ — Institutional Treasury, Risk, and Portfolio Intelligence",
  description:
    "CERNIQ is the institutional operating system for treasury, ALM, liquidity and rate risk, and board-ready COSSEC/NCUA reporting. Bilingual output, regulatory posture, and CFO-first workflows in one command surface.",
  keywords:
    "institutional finance software, treasury intelligence, ALM software, asset liability management, portfolio visibility, execution quality, risk operating system, board reporting, credit union ALM, community bank risk platform, COSSEC compliance, NCUA ratios, Basel IRRBB, bilingual board reports, institutional risk intelligence, CERNIQ",
  metadataBase: new URL("https://cerniq.io"),
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "CERNIQ — Treasury and Risk Operating System",
    description:
      "Institutional treasury, risk, and portfolio intelligence with board-ready bilingual reporting and live operating workflows.",
    url: "https://cerniq.io",
    siteName: "CERNIQ",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "CERNIQ — Treasury and Risk Operating System",
    description:
      "Institutional treasury, risk, and portfolio intelligence with CFO-first workflows and board-ready outputs.",
  },
  robots: {
    index: true,
    follow: true,
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

const SEGMENT_WRITE_KEY = process.env.NEXT_PUBLIC_SEGMENT_WRITE_KEY;
const SHOULD_LOAD_VERCEL_INSIGHTS =
  (process.env.VERCEL === '1' || Boolean(process.env.VERCEL_ENV)) &&
  process.env.NODE_ENV === 'production';
const CANONICAL_RECURRING_PRICE = String(PRICING.PILOT.amount);

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'SoftwareApplication',
              name: 'CERNIQ',
              applicationCategory: 'FinanceApplication',
              operatingSystem: 'Web',
              description:
                'Institutional treasury, risk, and portfolio intelligence with bilingual board-ready reporting, ALM workflows, and portfolio visibility.',
              url: 'https://cerniq.io',
              offers: {
                '@type': 'Offer',
                price: CANONICAL_RECURRING_PRICE,
                priceCurrency: 'USD',
                priceValidUntil: '2027-01-01',
                description:
                  'Recurring treasury, risk, and portfolio command-center access starting with the pilot operating lane.',
              },
              publisher: {
                '@type': 'Organization',
                name: 'KLYTICS LLC',
                url: 'https://cerniq.io',
                address: { '@type': 'PostalAddress', addressLocality: 'San Juan', addressRegion: 'PR', addressCountry: 'US' },
              },
              featureList:
                'Treasury intelligence, ALM analysis, liquidity risk, board-ready reporting, COSSEC, NCUA, duration gap, NII sensitivity, EVE, Monte Carlo, CECL, Basel IRRBB, bilingual EN/ES outputs',
            }),
          }}
        />
      </head>
      <body>
        <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[9999] focus:rounded-lg focus:bg-cyan-700 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white">
          Skip to content
        </a>
        <Providers>
        <WebVitals />
        <ToastProvider>
        <div id="main-content">
        {children}
        </div>
        <CookieConsent />
        <SessionTimeoutWarning timeoutMinutes={30} />
        </ToastProvider>
        </Providers>
        {SHOULD_LOAD_VERCEL_INSIGHTS && <Analytics />}
        {SHOULD_LOAD_VERCEL_INSIGHTS && <SpeedInsights />}
        {SEGMENT_WRITE_KEY && (
          <Script id="segment-analytics" strategy="afterInteractive">
            {`
              !function(){var i="analytics",analytics=window[i]=window[i]||[];if(!analytics.initialize)if(analytics.invoked)window.console&&console.error&&console.error("Segment snippet included twice.");else{analytics.invoked=!0;analytics.methods=["trackSubmit","trackClick","trackLink","trackForm","pageview","identify","reset","group","track","ready","alias","debug","page","screen","once","off","on","addSourceMiddleware","addIntegrationMiddleware","setAnonymousId","addDestinationMiddleware","register"];analytics.factory=function(e){return function(){var t=Array.prototype.slice.call(arguments);t.unshift(e);analytics.push(t);return analytics}};for(var e=0;e<analytics.methods.length;e++){var key=analytics.methods[e];analytics[key]=analytics.factory(key)}analytics.load=function(key,e){var t=document.createElement("script");t.type="text/javascript";t.async=!0;t.setAttribute("data-global-segment-analytics-key",i);t.src="https://cdn.segment.com/analytics.js/v1/" + key + "/analytics.min.js";var n=document.getElementsByTagName("script")[0];n.parentNode.insertBefore(t,n);analytics._loadOptions=e};analytics._writeKey="${SEGMENT_WRITE_KEY}";analytics.SNIPPET_VERSION="5.2.1";analytics.load("${SEGMENT_WRITE_KEY}");analytics.page()}}();
            `}
          </Script>
        )}
      </body>
    </html>
  );
}
