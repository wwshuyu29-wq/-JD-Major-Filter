import { productTitleKeywords } from "../../shared/rules";
import { absolutizeUrl, compactText, createStableId, normalizeText } from "../../shared/text";
import type { JobCardRecord } from "./types";

const COMPANY_BY_HOST: Array<[RegExp, string]> = [
  [/bytedance|toutiao/i, "字节跳动"],
  [/tencent|qq/i, "腾讯"],
  [/xiaohongshu|xhs/i, "小红书"]
];

export function inferCompany(): string {
  const host = location.hostname;
  return COMPANY_BY_HOST.find(([pattern]) => pattern.test(host))?.[1] ?? document.title.split(/[-_|]/)[0]?.trim() ?? "";
}

export function extractLocation(text: string): string {
  const normalized = compactText(text);
  const knownCities = [
    "北京",
    "上海",
    "广州",
    "深圳",
    "杭州",
    "成都",
    "武汉",
    "南京",
    "西安",
    "苏州",
    "长沙",
    "重庆",
    "厦门",
    "Remote",
    "远程"
  ];
  return knownCities.filter((city) => normalized.includes(city)).slice(0, 3).join(" / ");
}

export function looksLikeProductRole(text: string): boolean {
  const normalized = compactText(text);
  return productTitleKeywords.some((keyword) => normalized.toLowerCase().includes(keyword.toLowerCase()));
}

export function nearestCardFromAnchor(anchor: HTMLAnchorElement): HTMLElement {
  const selectors = [
    "[data-jdmf-card]",
    "[class*='job']",
    "[class*='position']",
    "[class*='recruit']",
    "[class*='card']",
    "li",
    "article",
    "section"
  ];

  return (anchor.closest(selectors.join(",")) as HTMLElement | null) ?? anchor;
}

export function collectCardsBySelectors(selectors: string[]): JobCardRecord[] {
  const records = new Map<string, JobCardRecord>();
  const company = inferCompany();
  const candidates = selectors.flatMap((selector) => Array.from(document.querySelectorAll<HTMLElement>(selector)));

  for (const element of candidates) {
    const anchor = element.matches("a") ? (element as HTMLAnchorElement) : element.querySelector<HTMLAnchorElement>("a[href]");
    const href = anchor?.getAttribute("href") ?? "";
    const url = href ? absolutizeUrl(href, location.href) : location.href;
    const text = compactText(element.innerText || anchor?.innerText || "");

    if (!url || text.length < 4) {
      continue;
    }

    const title = inferTitle(element, anchor, text);
    if (!looksLikeProductRole(`${title} ${text}`) && selectors.length < 4) {
      continue;
    }

    const id = createStableId(`${url}|${title}|${text.slice(0, 80)}`);
    records.set(id, {
      id,
      company,
      title,
      location: extractLocation(text),
      url,
      previewText: text,
      element
    });
  }

  return Array.from(records.values()).slice(0, 80);
}

export function collectGenericCards(): JobCardRecord[] {
  const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"));
  const records = new Map<string, JobCardRecord>();
  const company = inferCompany();

  for (const anchor of anchors) {
    const card = nearestCardFromAnchor(anchor);
    const text = compactText(card.innerText || anchor.innerText || "");
    const title = inferTitle(card, anchor, text);

    if (!looksLikeProductRole(`${title} ${text}`)) {
      continue;
    }

    const url = absolutizeUrl(anchor.getAttribute("href") ?? "", location.href);
    if (!url || records.has(url)) {
      continue;
    }

    const id = createStableId(`${url}|${title}|${text.slice(0, 80)}`);
    records.set(url, {
      id,
      company,
      title,
      location: extractLocation(text),
      url,
      previewText: text,
      element: card
    });
  }

  return Array.from(records.values()).slice(0, 80);
}

export function inferTitle(element: HTMLElement, anchor: HTMLAnchorElement | null | undefined, fallbackText: string): string {
  const titleSelectors = [
    "[class*='title']",
    "[class*='name']",
    "[class*='position']",
    "h1",
    "h2",
    "h3",
    "strong"
  ];

  for (const selector of titleSelectors) {
    const node = element.querySelector<HTMLElement>(selector);
    const text = compactText(node?.innerText ?? "");
    if (text && text.length <= 80) {
      return text;
    }
  }

  const anchorText = compactText(anchor?.innerText ?? "");
  if (anchorText && anchorText.length <= 80) {
    return anchorText;
  }

  return fallbackText.split(/[|｜\n]/)[0]?.slice(0, 80).trim() || "未命名岗位";
}

export function extractMainPageText(): string {
  const selectors = [
    "main",
    "[class*='detail']",
    "[class*='job']",
    "[class*='position']",
    "[class*='require']",
    "article",
    "body"
  ];

  const chunks = selectors
    .map((selector) => document.querySelector<HTMLElement>(selector))
    .filter(Boolean)
    .map((node) => normalizeText(node?.innerText ?? ""))
    .filter((text) => text.length > 20);

  return chunks.sort((a, b) => b.length - a.length)[0] ?? normalizeText(document.body.innerText);
}
