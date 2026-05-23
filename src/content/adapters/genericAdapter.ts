import { collectGenericCards, extractMainPageText } from "./utils";
import type { SiteAdapter } from "./types";

export const genericAdapter: SiteAdapter = {
  platform: "generic",
  matches() {
    return true;
  },
  collectJobCards() {
    return collectGenericCards();
  },
  extractDetailText() {
    return extractMainPageText();
  }
};
