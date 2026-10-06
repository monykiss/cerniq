"use client";

import Link from 'next/link';
import { PUBLIC_PATHS } from '@/lib/public-links';

const API_BASE_URL =
  process.env.NEXT_PUBLIC_NODE_API_URL ||
  "https://api.example.com";

const CLEAN_API_BASE = API_BASE_URL.replace(/\/+$/, "");

function CodeBlock({ language, code }: { language: string; code: string }) {
  return (
    <div className="relative group">
      <div className="absolute top-2 right-2 text-[10px] uppercase tracking-widest text-cyan-400/60 font-mono">
        {language}
      </div>
      <pre className="bg-[#0D1117] border border-white/10 rounded-lg p-4 overflow-x-auto text-sm text-gray-300 font-mono leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function EndpointCard({
  method,
  path,
  title,
  description,
  auth,
}: {
  method: "GET" | "POST";
  path: string;
  title: string;
  description: string;
  auth: boolean;
}) {
  const methodColor =
    method === "POST"
      ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
      : "bg-cyan-500/20 text-cyan-400 border-cyan-500/30";

  return (
    <div className="border border-white/10 rounded-lg p-4 hover:border-cyan-500/30 transition-colors">
      <div className="flex items-center gap-3 mb-2">
        <span
          className={`text-xs font-mono font-bold px-2 py-0.5 rounded border ${methodColor}`}
        >
          {method}
        </span>
        <code className="text-sm text-white font-mono">{path}</code>
        {auth && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 ml-auto">
            API Key
          </span>
        )}
      </div>
      <h4 className="text-white font-medium text-sm mb-1">{title}</h4>
      <p className="text-gray-400 text-xs leading-relaxed">{description}</p>
    </div>
  );
}

export default function DevelopersPage() {
  return (
    <div className="min-h-screen bg-[#070B12] text-gray-200">
      {/* Nav */}
      <nav className="border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <Link href="/" className="text-xl font-bold tracking-tight text-white">
          CERNIQ
        </Link>
        <div className="flex items-center gap-4">
          <a
            href={`${CLEAN_API_BASE}/api/v1/docs`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-cyan-400 hover:text-cyan-300 transition-colors"
          >
            Swagger UI
          </a>
          <Link
            href="/pricing"
            className="text-sm text-gray-400 hover:text-white transition-colors"
          >
            Pricing
          </Link>
          <Link
            href="/login"
            className="text-sm px-4 py-1.5 rounded-md bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/20 transition-colors"
          >
            Sign In
          </Link>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="mb-12">
          <h1 className="text-3xl font-bold text-white mb-3">
            CERNIQ API Documentation
          </h1>
          <p className="text-gray-400 text-lg leading-relaxed max-w-2xl">
            Integrate institutional ALM intelligence into your CPA workflow,
            fintech application, or regulatory reporting pipeline. Run balance
            sheet analyses, retrieve COSSEC compliance ratios, and benchmark
            against the PR cooperativa sector.
          </p>
        </div>

        {/* Quickstart */}
        <section className="mb-12">
          <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-400 text-xs flex items-center justify-center font-bold border border-cyan-500/30">
              1
            </span>
            Quickstart
          </h2>

          <div className="space-y-4">
            <div className="bg-[#111827] border border-white/10 rounded-lg p-4">
              <h3 className="text-sm font-medium text-white mb-2">
                Get your API key
              </h3>
              <p className="text-gray-400 text-sm mb-3">
                Sign in to the{" "}
                <a href="/dashboard" className="text-cyan-400 hover:underline">
                  CERNIQ Dashboard
                </a>{" "}
                and navigate to{" "}
                <a
                  href="/settings"
                  className="text-cyan-400 hover:underline"
                >
                  Settings &rarr; API Keys
                </a>{" "}
                to generate your key. Keys start with{" "}
                <code className="text-cyan-300">ck_live_</code>.
              </p>
            </div>

            <div>
              <h3 className="text-sm font-medium text-white mb-2">
                Run your first analysis
              </h3>
              <CodeBlock
                language="curl"
                code={`curl -X POST ${CLEAN_API_BASE}/api/v1/analyze \\
  -H "Authorization: Bearer <api-key>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "institutionName": "Cooperativa Ejemplo Este",
    "institutionType": "cooperativa",
    "framework": "cossec",
    "period": "Q1-2026",
    "rows": [
      {
        "category": "asset",
        "subcategory": "commercial_loans",
        "name": "CRE - Retail Center",
        "balance": 10.0,
        "rate": 6.50,
        "duration": 5.0,
        "rateType": "fixed"
      },
      {
        "category": "asset",
        "subcategory": "investment_securities",
        "name": "US Treasury Notes",
        "balance": 16.0,
        "rate": 4.25,
        "duration": 2.0,
        "rateType": "fixed"
      },
      {
        "category": "liability",
        "subcategory": "savings_deposits",
        "name": "Regular Savings",
        "balance": 12.0,
        "rate": 1.50,
        "duration": 0.25,
        "rateType": "variable"
      },
      {
        "category": "liability",
        "subcategory": "time_deposits",
        "name": "12-Month CDs",
        "balance": 8.0,
        "rate": 3.00,
        "duration": 1.0,
        "rateType": "fixed"
      }
    ]
  }'`}
              />
            </div>
          </div>
        </section>

        {/* Endpoints */}
        <section className="mb-12">
          <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-400 text-xs flex items-center justify-center font-bold border border-cyan-500/30">
              2
            </span>
            Endpoints
          </h2>

          <div className="space-y-3">
            <EndpointCard
              method="POST"
              path="/api/v1/analyze"
              title="Run ALM Analysis (JSON)"
              description="Submit balance sheet rows as JSON. Returns 12 COSSEC ratios, duration gap, NII sensitivity, LCR, exam readiness score, and sector benchmarks."
              auth={true}
            />
            <EndpointCard
              method="POST"
              path="/api/v1/analyze/csv"
              title="Run ALM Analysis (CSV Upload)"
              description="Upload a CSV file with balance sheet data. Supports bilingual column names (English/Spanish). Same analysis output as the JSON endpoint."
              auth={true}
            />
            <EndpointCard
              method="GET"
              path="/api/v1/analyses/:analysisId"
              title="Retrieve Stored Analysis"
              description="Fetch a previously computed analysis by its ID. Only returns analyses created by the API key owner."
              auth={true}
            />
            <EndpointCard
              method="GET"
              path="/api/v1/benchmarks"
              title="Get Sector Benchmarks"
              description="Returns PR cooperativa sector benchmarks (COSSEC Q3 2025). Includes median, 25th, and 75th percentile for 10 financial ratios."
              auth={false}
            />
            <EndpointCard
              method="GET"
              path="/api/v1/frameworks"
              title="List Supported Frameworks"
              description="Returns the list of regulatory frameworks (COSSEC, NCUA) supported by the analysis engine."
              auth={false}
            />
            <EndpointCard
              method="GET"
              path="/api/v1/health"
              title="API Health Check"
              description="Returns API status, version, and timestamp. No authentication required."
              auth={false}
            />
          </div>
        </section>

        {/* Code Examples */}
        <section className="mb-12">
          <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-400 text-xs flex items-center justify-center font-bold border border-cyan-500/30">
              3
            </span>
            Code Examples
          </h2>

          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-medium text-white mb-2">Python</h3>
              <CodeBlock
                language="python"
                code={`import requests

API_KEY = "<api-key>"
BASE_URL = "${CLEAN_API_BASE}/api/v1"

# Run analysis
response = requests.post(
    f"{BASE_URL}/analyze",
    headers={"Authorization": f"Bearer {API_KEY}"},
    json={
        "institutionName": "Cooperativa Ejemplo Este",
        "institutionType": "cooperativa",
        "framework": "cossec",
        "period": "Q1-2026",
        "rows": [
            {
                "category": "asset",
                "subcategory": "commercial_loans",
                "name": "CRE Portfolio",
                "balance": 45.0,
                "rate": 6.50,
                "duration": 4.5,
                "rateType": "fixed"
            },
            # ... more rows
        ]
    }
)

result = response.json()
analysis = result["data"]

print(f"Exam Readiness: {analysis['examReadinessScore']}/100")
print(f"Overall Status: {analysis['overallStatus']}")

for ratio in analysis["ratios"]:
    print(f"  {ratio['name']}: {ratio['value']}{ratio['unit']} [{ratio['status']}]")

# Retrieve later
analysis_id = analysis["analysisId"]
stored = requests.get(
    f"{BASE_URL}/analyses/{analysis_id}",
    headers={"Authorization": f"Bearer {API_KEY}"}
).json()`}
              />
            </div>

            <div>
              <h3 className="text-sm font-medium text-white mb-2">
                JavaScript / TypeScript
              </h3>
              <CodeBlock
                language="typescript"
                code={`const API_KEY = "<api-key>";
const BASE_URL = "${CLEAN_API_BASE}/api/v1";

// Run analysis
const response = await fetch(\`\${BASE_URL}/analyze\`, {
  method: "POST",
  headers: {
    "Authorization": \`Bearer \${API_KEY}\`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    institutionName: "Cooperativa Ejemplo Este",
    institutionType: "cooperativa",
    framework: "cossec",
    period: "Q1-2026",
    rows: [
      {
        category: "asset",
        subcategory: "commercial_loans",
        name: "CRE Portfolio",
        balance: 45.0,
        rate: 6.50,
        duration: 4.5,
        rateType: "fixed",
      },
      // ... more rows
    ],
  }),
});

const { data } = await response.json();

console.log(\`Exam Readiness: \${data.examReadinessScore}/100\`);
console.log(\`Duration Gap: \${data.durationGap.durationGap} years\`);
console.log(\`LCR: \${data.lcr.lcr}% (\${data.lcr.status})\`);

// CSV upload
const formData = new FormData();
formData.append("file", csvFile);
formData.append("institutionName", "Cooperativa Ejemplo Este");
formData.append("institutionType", "cooperativa");
formData.append("framework", "cossec");
formData.append("period", "Q1-2026");

const csvResponse = await fetch(\`\${BASE_URL}/analyze/csv\`, {
  method: "POST",
  headers: { "Authorization": \`Bearer \${API_KEY}\` },
  body: formData,
});`}
              />
            </div>
          </div>
        </section>

        {/* Rate Limits & Response Format */}
        <section className="mb-12">
          <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-400 text-xs flex items-center justify-center font-bold border border-cyan-500/30">
              4
            </span>
            Rate Limits &amp; Response Format
          </h2>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-[#111827] border border-white/10 rounded-lg p-4">
              <h3 className="text-sm font-medium text-white mb-3">
                Rate Limits
              </h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-500 text-xs">
                    <th className="text-left pb-2">Tier</th>
                    <th className="text-left pb-2">Limit</th>
                  </tr>
                </thead>
                <tbody className="text-gray-300">
                  <tr className="border-t border-white/5">
                    <td className="py-2">Standard</td>
                    <td className="py-2">100 requests/hour</td>
                  </tr>
                  <tr className="border-t border-white/5">
                    <td className="py-2">Partner</td>
                    <td className="py-2">1,000 requests/hour</td>
                  </tr>
                </tbody>
              </table>
              <p className="text-gray-500 text-xs mt-3">
                Rate limit headers are included in every response:
                <code className="text-gray-400 ml-1">X-RateLimit-Limit</code>,
                <code className="text-gray-400 ml-1">X-RateLimit-Remaining</code>,
                <code className="text-gray-400 ml-1">X-RateLimit-Reset</code>
              </p>
            </div>

            <div className="bg-[#111827] border border-white/10 rounded-lg p-4">
              <h3 className="text-sm font-medium text-white mb-3">
                Response Envelope
              </h3>
              <CodeBlock
                language="json"
                code={`{
  "success": true,
  "data": {
    "analysisId": "clxyz...",
    "examReadinessScore": 75,
    "overallStatus": "conditional",
    "ratios": [...],
    "durationGap": {...},
    "recommendations": [...]
  }
}`}
              />
            </div>
          </div>
        </section>

        {/* Interactive Swagger link */}
        <section className="mb-12">
          <div className="bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border border-cyan-500/20 rounded-xl p-6 text-center">
            <h3 className="text-lg font-semibold text-white mb-2">
              Interactive API Explorer
            </h3>
            <p className="text-gray-400 text-sm mb-4">
              Try every endpoint interactively with the full Swagger UI.
            </p>
            <a
              href={`${CLEAN_API_BASE}/api/v1/docs`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg bg-cyan-500 text-black font-semibold text-sm hover:bg-cyan-400 transition-colors"
            >
              Open Swagger UI
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                />
              </svg>
            </a>
          </div>
        </section>

        {/* CSV Format */}
        <section className="mb-12">
          <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-400 text-xs flex items-center justify-center font-bold border border-cyan-500/30">
              5
            </span>
            CSV Format Reference
          </h2>

          <div className="bg-[#111827] border border-white/10 rounded-lg p-4">
            <p className="text-gray-400 text-sm mb-3">
              When using the <code className="text-cyan-300">/api/v1/analyze/csv</code> endpoint,
              your CSV must include these columns:
            </p>
            <CodeBlock
              language="csv"
              code={`category,subcategory,name,balance,rate,duration,rateType,repriceDate,maturityDate
asset,commercial_loans,CRE - Retail Center,10.0,6.50,5.0,fixed,,2031-03-01
asset,investment_securities,US Treasury Notes,16.0,4.25,2.0,fixed,,2028-03-01
liability,savings_deposits,Regular Savings,24.0,1.50,0.25,variable,2026-06-01,
liability,time_deposits,12-Month CDs,15.0,3.00,1.0,fixed,,2027-03-01`}
            />
            <div className="mt-3 space-y-1 text-xs text-gray-500">
              <p>
                <strong className="text-gray-400">balance:</strong> In millions USD
              </p>
              <p>
                <strong className="text-gray-400">rate:</strong> As percentage (5.25 = 5.25%)
              </p>
              <p>
                <strong className="text-gray-400">duration:</strong> Macaulay duration in years
              </p>
              <p>
                <strong className="text-gray-400">Spanish columns accepted:</strong>{" "}
                categoria, subcategoria, nombre, saldo, tasa, duracion, tipoTasa
              </p>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-white/10 pt-8 pb-12 text-center text-gray-500 text-sm">
          <p>&copy; {new Date().getFullYear()} KLYTICS LLC. All rights reserved.</p>
          <p className="mt-2 flex items-center justify-center gap-4 text-xs">
            <a href={PUBLIC_PATHS.terms} className="text-gray-500 hover:text-cyan-400">Terms</a>
            <a href={PUBLIC_PATHS.privacy} className="text-gray-500 hover:text-cyan-400">Privacy</a>
            <a href={PUBLIC_PATHS.security} className="text-gray-500 hover:text-cyan-400">Security</a>
            <a href="mailto:api@cerniq.io" className="text-cyan-400 hover:underline">api@cerniq.io</a>
          </p>
        </footer>
      </main>
    </div>
  );
}
