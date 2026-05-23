export type RiskLevel = "safe" | "caution" | "high_risk" | "excluded" | "review";

export type ScanStatus = "idle" | "scanning" | "done" | "failed";

export type FilterMode = "all" | "safe_only" | "safe_and_caution" | "hide_high_risk" | "hide_high_risk_and_excluded";

export interface JobCardSnapshot {
  id: string;
  company: string;
  title: string;
  location: string;
  url: string;
  previewText: string;
  pageNumber?: number;
}

export interface ClassificationResult {
  result: string;
  riskLevel: RiskLevel;
  matchedKeywords: string[];
  matchedSentence: string;
  reason: string;
  shouldHideByDefault: boolean;
  needsManualReview?: boolean;
}

export interface JobScanResult extends JobCardSnapshot, ClassificationResult {
  jdText: string;
  status: ScanStatus;
  scannedAt: string;
}

export interface ScanSummary {
  total: number;
  safe: number;
  caution: number;
  highRisk: number;
  excluded: number;
  review: number;
}

export interface ScanState {
  pageUrl: string;
  platform: string;
  status: ScanStatus;
  filterMode: FilterMode;
  summary: ScanSummary;
  results: JobScanResult[];
  error?: string;
  updatedAt: string;
}

export interface DetailFetchRequest {
  id: string;
  url: string;
  platform: string;
  previewText: string;
}

export interface DetailFetchResponse {
  id: string;
  ok: boolean;
  url: string;
  html?: string;
  finalUrl?: string;
  contentType?: string;
  error?: string;
}

export interface RuntimeMessage<T = unknown> {
  type: string;
  payload?: T;
}
