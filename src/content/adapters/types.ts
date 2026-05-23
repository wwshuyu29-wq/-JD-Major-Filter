import type { JobCardSnapshot } from "../../shared/types";

export interface JobCardRecord extends JobCardSnapshot {
  element: HTMLElement;
}

export interface SiteAdapter {
  platform: string;
  matches(hostname: string): boolean;
  collectJobCards(): JobCardRecord[];
  extractDetailText(): string;
}
