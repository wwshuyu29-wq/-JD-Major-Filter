import { collectCardsBySelectors, collectGenericCards, extractMainPageText } from "./utils";
import type { SiteAdapter } from "./types";

export const tencentAdapter: SiteAdapter = {
  platform: "tencent",
  matches(hostname) {
    return /tencent|qq/i.test(hostname);
  },
  collectJobCards() {
    const cards = collectCardsBySelectors([
      "[class*='recruit-list'] [class*='recruit']",
      "[class*='job-list'] [class*='job']",
      "[class*='position-list'] [class*='position']",
      "a[href*='position']",
      "a[href*='job']"
    ]);
    return cards.length > 0 ? cards : collectGenericCards();
  },
  extractDetailText() {
    return extractMainPageText();
  }
};
