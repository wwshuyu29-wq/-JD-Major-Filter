import type { JobScanResult, ScanSummary } from "./types";

export function summarize(results: JobScanResult[]): ScanSummary {
  return {
    total: results.length,
    safe: results.filter((item) => item.riskLevel === "safe").length,
    caution: results.filter((item) => item.riskLevel === "caution").length,
    highRisk: results.filter((item) => item.riskLevel === "high_risk").length,
    excluded: results.filter((item) => item.riskLevel === "excluded").length,
    review: results.filter((item) => item.riskLevel === "review").length
  };
}
