/**
 * Universal CSV export utility for ALM analysis results.
 * Used across all 62 ALM pages for data download.
 */
export function exportToCSV(data: Record<string, unknown>[] | Record<string, unknown>, filename: string) {
  let rows: Record<string, unknown>[];

  if (Array.isArray(data)) {
    rows = data;
  } else {
    // Flatten single object into rows
    rows = Object.entries(data).map(([key, value]) => ({
      metric: key,
      value: typeof value === 'object' ? JSON.stringify(value) : String(value),
    }));
  }

  if (rows.length === 0) return;

  const headers = Object.keys(rows[0]);
  const csvLines = [
    headers.join(','),
    ...rows.map(row =>
      headers.map(h => {
        const val = row[h];
        const str = val === null || val === undefined ? '' : String(val);
        // Escape commas and quotes
        return str.includes(',') || str.includes('"') || str.includes('\n')
          ? `"${str.replace(/"/g, '""')}"`
          : str;
      }).join(',')
    ),
  ];

  const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Export KPI data from any ALM page.
 * Pass the page name and an object of key-value KPIs.
 */
export function exportKPIs(pageName: string, kpis: Record<string, string | number>) {
  const rows = Object.entries(kpis).map(([metric, value]) => ({ metric, value: String(value) }));
  exportToCSV(rows, `cerniq_${pageName}`);
}
