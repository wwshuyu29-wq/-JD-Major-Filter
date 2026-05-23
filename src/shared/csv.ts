import type { JobScanResult, RiskLevel } from "./types";

const CSV_HEADERS = [
  "company",
  "title",
  "location",
  "url",
  "result",
  "risk_level",
  "matched_keywords",
  "matched_sentence",
  "reason",
  "should_hide_by_default",
  "page_number",
  "scanned_at"
];

function escapeCsv(value: unknown): string {
  const text = Array.isArray(value) ? value.join(" | ") : String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(results: JobScanResult[], riskLevels?: RiskLevel[]): string {
  const rows = riskLevels ? results.filter((item) => riskLevels.includes(item.riskLevel)) : results;

  const body = rows.map((item) =>
    [
      item.company,
      item.title,
      item.location,
      item.url,
      item.result,
      item.riskLevel,
      item.matchedKeywords,
      item.matchedSentence,
      item.reason,
      item.shouldHideByDefault,
      item.pageNumber ?? "",
      item.scannedAt
    ]
      .map(escapeCsv)
      .join(",")
  );

  return [CSV_HEADERS.join(","), ...body].join("\n");
}
