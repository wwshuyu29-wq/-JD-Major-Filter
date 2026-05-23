import type { ClassificationResult } from "./types";
import { hardRequirementCues, majorRiskKeywords, preferenceCues, preservePhrases, softRiskKeywords } from "./rules";
import { compactText, findBestSentence, includesAny, nearbyText } from "./text";

const DEFAULT_REVIEW_RESULT: ClassificationResult = {
  result: "⚪ 需点开复核",
  riskLevel: "review",
  matchedKeywords: [],
  matchedSentence: "",
  reason: "未能提取到足够完整的 JD 文本，需要人工打开详情页复核。",
  shouldHideByDefault: false,
  needsManualReview: true
};

export function classifyJD(rawText: string): ClassificationResult {
  const text = compactText(rawText);

  if (text.length < 20) {
    return DEFAULT_REVIEW_RESULT;
  }

  const preserveMatches = includesAny(text, preservePhrases);
  if (preserveMatches.length > 0) {
    return {
      result: "✅ 可优先投递",
      riskLevel: "safe",
      matchedKeywords: preserveMatches,
      matchedSentence: findBestSentence(text, preserveMatches),
      reason: "JD 明确出现专业不限或欢迎跨专业表达，优先按可投递处理。",
      shouldHideByDefault: false
    };
  }

  const majorMatches = includesAny(text, majorRiskKeywords);
  if (majorMatches.length > 0) {
    const preferenceMatch = majorMatches.find((keyword) => includesAny(nearbyText(text, keyword), preferenceCues).length > 0);
    if (preferenceMatch) {
      const localCues = includesAny(nearbyText(text, preferenceMatch), preferenceCues);
      return {
        result: "🟠 高风险，默认隐藏",
        riskLevel: "high_risk",
        matchedKeywords: [...new Set([preferenceMatch, ...localCues])],
        matchedSentence: findBestSentence(text, [preferenceMatch]),
        reason: "JD 使用“优先/加分”等软性语气，但出现了理工科、计算机或相关专业词，按第一版业务规则视为高风险。",
        shouldHideByDefault: true
      };
    }

    const hardMatch = majorMatches.find((keyword) => includesAny(nearbyText(text, keyword), hardRequirementCues).length > 0);
    if (hardMatch) {
      const localCues = includesAny(nearbyText(text, hardMatch), hardRequirementCues);
      return {
        result: "❌ 明确排除",
        riskLevel: "excluded",
        matchedKeywords: [...new Set([hardMatch, ...localCues])],
        matchedSentence: findBestSentence(text, [hardMatch]),
        reason: "专业风险关键词附近出现硬性要求语气，说明该岗位大概率有明确专业门槛。",
        shouldHideByDefault: true
      };
    }

    return {
      result: "🟠 高风险，默认隐藏",
      riskLevel: "high_risk",
      matchedKeywords: majorMatches,
      matchedSentence: findBestSentence(text, majorMatches),
      reason: "JD 出现专业风险关键词，但未能稳定识别硬性或优先语气，按高风险处理以减少误投。",
      shouldHideByDefault: true
    };
  }

  const softMatches = includesAny(text, softRiskKeywords);
  if (softMatches.length > 0) {
    return {
      result: "🟡 可尝试，但有风险",
      riskLevel: "caution",
      matchedKeywords: softMatches,
      matchedSentence: findBestSentence(text, softMatches),
      reason: "JD 出现技术理解、AI 产品、AIGC 或数据分析相关要求，但没有发现明确专业限制。",
      shouldHideByDefault: false
    };
  }

  return {
    result: "✅ 可优先投递",
    riskLevel: "safe",
    matchedKeywords: [],
    matchedSentence: "",
    reason: "未发现理工科、计算机、软件工程等专业门槛关键词。",
    shouldHideByDefault: false
  };
}
