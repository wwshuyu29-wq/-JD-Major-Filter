import type { FilterMode, JobScanResult, RiskLevel } from "../shared/types";

const BADGE_CLASS = "jdmf-badge";
const WRAP_CLASS = "jdmf-badge-wrap";

const RISK_CLASS: Record<RiskLevel, string> = {
  safe: "jdmf-safe",
  caution: "jdmf-caution",
  high_risk: "jdmf-high-risk",
  excluded: "jdmf-excluded",
  review: "jdmf-review"
};

export function injectBadgeStyles(): void {
  if (document.getElementById("jdmf-style")) {
    return;
  }

  const style = document.createElement("style");
  style.id = "jdmf-style";
  style.textContent = `
    .${WRAP_CLASS} {
      position: static;
      z-index: 2147483646;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      max-width: min(340px, calc(100% - 20px));
      margin: 0 0 8px 0;
      pointer-events: auto;
    }
    .${BADGE_CLASS} {
      border: 1px solid rgba(23, 32, 42, 0.08);
      border-radius: 999px;
      padding: 5px 9px;
      font: 600 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      box-shadow: 0 8px 20px rgba(16, 24, 40, 0.12);
      cursor: help;
      white-space: nowrap;
      color: #17202A;
      background: #F4F6F8;
    }
    .jdmf-safe { background: #DFF7E8; color: #11643A; }
    .jdmf-caution { background: #FFF3C4; color: #7A4D00; }
    .jdmf-high-risk { background: #FFE4C2; color: #93450A; }
    .jdmf-excluded { background: #FFE0E0; color: #9F1D1D; }
    .jdmf-review { background: #E9EEF5; color: #42526B; }
    .jdmf-hidden-by-filter { display: none !important; }
  `;
  document.documentElement.append(style);
}

export function renderScanningBadge(card: HTMLElement): void {
  renderBadge(card, {
    id: "",
    company: "",
    title: "",
    location: "",
    url: "",
    previewText: "",
    jdText: "",
    status: "scanning",
    scannedAt: new Date().toISOString(),
    result: "⏳ 扫描中",
    riskLevel: "review",
    matchedKeywords: [],
    matchedSentence: "",
    reason: "正在请求详情页并分析 JD。",
    shouldHideByDefault: false
  });
}

export function renderBadge(card: HTMLElement, result: JobScanResult): void {
  injectBadgeStyles();

  let wrap = card.querySelector<HTMLElement>(`:scope > .${WRAP_CLASS}`);
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.className = WRAP_CLASS;
    card.prepend(wrap);
  }

  wrap.replaceChildren();
  const badge = document.createElement("span");
  badge.className = `${BADGE_CLASS} ${RISK_CLASS[result.riskLevel]}`;
  badge.textContent = result.result;
  badge.title = [
    `判断结果：${result.result}`,
    `原因：${result.reason}`,
    `命中关键词：${result.matchedKeywords.join("、") || "无"}`,
    `命中原文：${result.matchedSentence || "无"}`,
    `建议隐藏：${result.shouldHideByDefault ? "是" : "否"}`
  ].join("\n");
  wrap.append(badge);
}

export function shouldHideByFilter(result: JobScanResult, mode: FilterMode): boolean {
  if (mode === "all") {
    return false;
  }
  if (mode === "safe_only") {
    return result.riskLevel !== "safe";
  }
  if (mode === "safe_and_caution") {
    return !["safe", "caution"].includes(result.riskLevel);
  }
  if (mode === "hide_high_risk") {
    return result.riskLevel === "high_risk";
  }
  if (mode === "hide_high_risk_and_excluded") {
    return ["high_risk", "excluded"].includes(result.riskLevel);
  }
  return false;
}

export function applyCardVisibility(card: HTMLElement, hidden: boolean): void {
  card.classList.toggle("jdmf-hidden-by-filter", hidden);
}
