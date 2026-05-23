import { collectCardsBySelectors, collectGenericCards, extractMainPageText } from "./utils";
import type { SiteAdapter } from "./types";

export const xiaohongshuAdapter: SiteAdapter = {
  platform: "xiaohongshu",
  matches(hostname) {
    return /xiaohongshu|xhs/i.test(hostname);
  },
  collectJobCards() {
    const cards = collectCardsBySelectors([
      "[class*='job-list'] [class*='job']",
      "[class*='position-list'] [class*='position']",
      "[class*='campus'] [class*='position']",
      "a[href*='job']",
      "a[href*='position']"
    ]);
    return cards.length > 0 ? cards : collectGenericCards();
  },
  extractDetailText() {
    return extractMainPageText();
  }
};
