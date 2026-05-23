import { bytedanceAdapter } from "./bytedanceAdapter";
import { genericAdapter } from "./genericAdapter";
import { tencentAdapter } from "./tencentAdapter";
import { xiaohongshuAdapter } from "./xiaohongshuAdapter";
import type { SiteAdapter } from "./types";

const adapters: SiteAdapter[] = [bytedanceAdapter, tencentAdapter, xiaohongshuAdapter, genericAdapter];

export function getAdapter(): SiteAdapter {
  return adapters.find((adapter) => adapter.matches(location.hostname)) ?? genericAdapter;
}
