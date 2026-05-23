import { absolutizeUrl, compactText, createStableId } from "../../shared/text";
import { collectCardsBySelectors, collectGenericCards, extractLocation, extractMainPageText, inferCompany, inferTitle } from "./utils";
import type { SiteAdapter } from "./types";

export const bytedanceAdapter: SiteAdapter = {
  platform: "bytedance",
  matches(hostname) {
    return /bytedance|toutiao/i.test(hostname);
  },
  collectJobCards() {
    const pageNumber = getCurrentPageNumber();
    const detailAnchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/position/"][href*="/detail"]'));
    const records = new Map<string, ReturnType<SiteAdapter["collectJobCards"]>[number]>();
    const company = inferCompany();

    for (const anchor of detailAnchors) {
      const url = absolutizeUrl(anchor.getAttribute("href") ?? "", location.href);
      const text = compactText(anchor.innerText || "");
      if (!url || !text) {
        continue;
      }
      const title = inferTitle(anchor, anchor, text);
      const id = createStableId(`${url}|${title}|${text.slice(0, 80)}`);
      records.set(id, {
        id,
        company,
        title,
        location: extractLocation(text),
        url,
        previewText: text,
        pageNumber,
        element: anchor
      });
    }

    if (records.size > 0) {
      return Array.from(records.values()).slice(0, 80);
    }

    const cards = collectCardsBySelectors([
      "[class*='job-list'] [class*='job']",
      "[class*='position-list'] [class*='position']",
      "[class*='portal-position']",
      "a[href*='job']"
    ]);
    return cards.length > 0 ? cards : collectGenericCards();
  },
  extractDetailText() {
    return extractMainPageText();
  }
};

function getCurrentPageNumber(): number {
  const currentFromUrl = Number(new URL(location.href).searchParams.get("current") ?? "");
  if (Number.isFinite(currentFromUrl) && currentFromUrl > 0) {
    return currentFromUrl;
  }

  const pageItems = Array.from(document.querySelectorAll<HTMLElement>("li,button,a,span"));
  const active = pageItems.find((item) => /(^|\s)(active|selected|current)(\s|$)/i.test(item.className.toString()) && /^\d+$/.test(item.innerText.trim()));
  return active ? Number(active.innerText.trim()) : 1;
}
