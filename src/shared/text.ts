export function normalizeText(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function compactText(value: string): string {
  return normalizeText(value).replace(/\s+/g, " ");
}

export function splitSentences(text: string): string[] {
  return normalizeText(text)
    .split(/(?<=[。！？；;!?])|\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function includesAny(text: string, keywords: string[]): string[] {
  const lowerText = text.toLowerCase();
  return keywords.filter((keyword) => lowerText.includes(keyword.toLowerCase()));
}

export function findBestSentence(text: string, keywords: string[]): string {
  const sentences = splitSentences(text);
  const keyword = keywords.find(Boolean);
  if (!keyword) {
    return sentences[0] ?? "";
  }

  return sentences.find((sentence) => sentence.toLowerCase().includes(keyword.toLowerCase())) ?? sentences[0] ?? "";
}

export function nearbyText(text: string, keyword: string, radius = 50): string {
  const lowerText = text.toLowerCase();
  const index = lowerText.indexOf(keyword.toLowerCase());
  if (index < 0) {
    return "";
  }

  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + keyword.length + radius);
  return text.slice(start, end);
}

export function createStableId(input: string): string {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index);
    hash |= 0;
  }
  return `jdmf_${Math.abs(hash).toString(36)}`;
}

export function absolutizeUrl(url: string, baseUrl: string): string {
  try {
    return new URL(url, baseUrl).toString();
  } catch {
    return "";
  }
}
