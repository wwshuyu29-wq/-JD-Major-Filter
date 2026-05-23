import { classifyJD } from "../shared/classifier";
import { summarize } from "../shared/summary";
import type { DetailFetchRequest, FilterMode, JobScanResult, RuntimeMessage, ScanState } from "../shared/types";
import { applyCardVisibility, injectBadgeStyles, renderBadge, renderScanningBadge, shouldHideByFilter } from "./badges";
import { getAdapter } from "./adapters";
import type { JobCardRecord } from "./adapters/types";
import { extractRenderedByteDanceListCards, extractRenderedDetailText } from "./renderedDetail";
import type { JobCardSnapshot } from "../shared/types";

const STORAGE_KEY = "JDMF_LAST_STATE";
const LISTENER_READY_FLAG = "__JDMF_CONTENT_LISTENER_READY__";
const HYDRATE_RETRY_MS = 700;
const HYDRATE_WINDOW_MS = 10_000;

const cardRegistry = new Map<string, HTMLElement>();
const resultCacheByUrl = new Map<string, JobScanResult>();
let hydrateTimer: number | undefined;
let hydrateUntil = 0;
let mutationObserver: MutationObserver | undefined;
let state: ScanState = createInitialState();

injectBadgeStyles();
void chrome.storage.local.get(STORAGE_KEY).then((stored) => {
  const lastState = stored[STORAGE_KEY] as ScanState | undefined;
  if (!lastState?.results?.length) {
    return;
  }
  if (lastState.scanScope && lastState.scanScope !== buildScanScope(location.href)) {
    return;
  }
  state = lastState;
  cacheResults(lastState.results);
  scheduleHydrateFromCache();
});

function createInitialState(): ScanState {
  return {
    pageUrl: location.href,
    scanScope: buildScanScope(location.href),
    scanId: createScanId(),
    platform: getAdapter().platform,
    status: "idle",
    filterMode: "hide_high_risk_and_excluded",
    summary: summarize([]),
    results: [],
    updatedAt: new Date().toISOString()
  };
}

function createScanId(): string {
  return `scan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function buildScanScope(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.hash = "";
    url.searchParams.delete("current");
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function snapshot(record: JobCardRecord) {
  const { element: _element, ...rest } = record;
  return rest;
}

function recordFromSnapshot(snapshotItem: JobCardSnapshot, element: HTMLElement): JobCardRecord {
  return {
    ...snapshotItem,
    element
  };
}

async function persistState(): Promise<void> {
  state.updatedAt = new Date().toISOString();
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

function setState(next: Partial<ScanState>): void {
  state = {
    ...state,
    ...next,
    summary: next.results ? summarize(next.results) : state.summary,
    updatedAt: new Date().toISOString()
  };
  void persistState();
}

function setProgress(current: number, total: number, stage: string, detail?: string): void {
  setState({
    progress: {
      current: Math.min(current, total),
      total,
      stage,
      detail
    }
  });
}

function cacheResults(results: JobScanResult[]): void {
  for (const result of results) {
    resultCacheByUrl.set(result.url, result);
  }
}

function mergeResults(cards: JobCardRecord[], backgroundResults: JobScanResult[]): JobScanResult[] {
  const byId = new Map(backgroundResults.map((item) => [item.id, item]));

  return cards.map((card) => {
    const result = byId.get(card.id);
    if (!result) {
      return buildReviewResult(card, "详情页请求没有返回结果，需要人工打开复核。");
    }

    return {
      ...snapshot(card),
      jdText: result.jdText,
      status: result.status,
      scannedAt: result.scannedAt,
      result: result.result,
      riskLevel: result.riskLevel,
      matchedKeywords: result.matchedKeywords,
      matchedSentence: result.matchedSentence,
      reason: result.reason,
      shouldHideByDefault: result.shouldHideByDefault,
      needsManualReview: result.needsManualReview
    };
  });
}

function buildReviewResult(card: JobCardRecord, reason: string): JobScanResult {
  return {
    ...snapshot(card),
    jdText: "",
    status: "failed",
    scannedAt: new Date().toISOString(),
    result: "⚪ 需点开复核",
    riskLevel: "review",
    matchedKeywords: [],
    matchedSentence: "",
    reason,
    shouldHideByDefault: false,
    needsManualReview: true
  };
}

function renderResults(results: JobScanResult[]): void {
  for (const result of results) {
    const card = cardRegistry.get(result.id);
    if (!card) {
      continue;
    }
    renderBadge(card, result);
    applyCardVisibility(card, shouldHideByFilter(result, state.filterMode));
  }
}

function hydrateVisibleCardsFromCache(): number {
  const adapter = getAdapter();
  if (adapter.platform !== "bytedance") {
    return 0;
  }

  const cards = adapter.collectJobCards();
  let hydratedCount = 0;

  for (const card of cards) {
    cardRegistry.set(card.id, card.element);
    const cached = resultCacheByUrl.get(card.url);
    if (cached) {
      const result = {
        ...cached,
        ...snapshot(card),
        jdText: cached.jdText,
        status: cached.status,
        scannedAt: cached.scannedAt,
        result: cached.result,
        riskLevel: cached.riskLevel,
        matchedKeywords: cached.matchedKeywords,
        matchedSentence: cached.matchedSentence,
        reason: cached.reason,
        shouldHideByDefault: cached.shouldHideByDefault,
        needsManualReview: cached.needsManualReview
      };
      hydratedCount += 1;
      renderBadge(card.element, result);
      applyCardVisibility(card.element, shouldHideByFilter(result, state.filterMode));
    }
  }

  return hydratedCount;
}

function buildPreviewResult(card: JobCardRecord): JobScanResult {
  return {
    ...snapshot(card),
    jdText: card.previewText,
    status: "done",
    scannedAt: new Date().toISOString(),
    ...classifyJD(card.previewText)
  };
}

function shouldDeepScanPreview(result: JobScanResult): boolean {
  if (result.riskLevel === "high_risk" || result.riskLevel === "excluded") {
    return false;
  }

  if (result.riskLevel === "safe" && result.matchedKeywords.length > 0) {
    return false;
  }

  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function runQueue<T, R>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function next(): Promise<void> {
    const currentIndex = cursor;
    cursor += 1;
    if (currentIndex >= items.length) {
      return;
    }

    results[currentIndex] = await worker(items[currentIndex], currentIndex);
    await sleep(700);
    await next();
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, next));
  return results;
}

async function scanByteDanceWithRenderedDetails(cards: JobCardRecord[]): Promise<JobScanResult[]> {
  const previewResults = cards.map(buildPreviewResult);
  cacheResults(previewResults);
  setState({ status: "scanning", error: undefined, results: previewResults });
  renderResults(previewResults);

  const cardsById = new Map(cards.map((card) => [card.id, card]));
  const currentResults = new Map(previewResults.map((result) => [result.id, result]));
  const deepScanCards = previewResults
    .filter(shouldDeepScanPreview)
    .map((result) => cardsById.get(result.id))
    .filter((card): card is JobCardRecord => Boolean(card));

  if (deepScanCards.length === 0) {
    setProgress(cards.length, cards.length, "列表文本已足够判断", "未发现需要打开详情页深扫的岗位。");
    return previewResults;
  }

  let completedDetails = 0;
  setProgress(0, deepScanCards.length, "读取岗位详情", `准备深扫 ${deepScanCards.length} 个不确定岗位。`);
  await runQueue(deepScanCards, 3, async (card) => {
    let nextResult: JobScanResult;
    try {
      const jdText = await extractRenderedDetailText(card.url);
      nextResult = {
        ...snapshot(card),
        jdText,
        status: "done",
        scannedAt: new Date().toISOString(),
        ...classifyJD(jdText)
      };
    } catch (error) {
      nextResult = buildReviewResult(card, error instanceof Error ? error.message : "字节详情页渲染读取失败，需要人工点开复核。");
    }

    currentResults.set(card.id, nextResult);
    const updatedResults = cards.map((item) => currentResults.get(item.id) ?? buildPreviewResult(item));
    cacheResults([nextResult]);
    completedDetails += 1;
    setProgress(completedDetails, deepScanCards.length, "读取岗位详情", card.title);
    setState({ status: "scanning", error: undefined, results: updatedResults });
    renderResults([nextResult]);
    return nextResult;
  });

  return cards.map((card) => currentResults.get(card.id) ?? buildPreviewResult(card));
}

async function scanListPage(): Promise<ScanState> {
  const adapter = getAdapter();
  const cards = adapter.collectJobCards();
  cardRegistry.clear();
  resultCacheByUrl.clear();

  for (const card of cards) {
    cardRegistry.set(card.id, card.element);
    renderScanningBadge(card.element);
  }

  setState({
    pageUrl: location.href,
    scanScope: buildScanScope(location.href),
    scanId: createScanId(),
    platform: adapter.platform,
    status: "scanning",
    progress: { current: 0, total: cards.length, stage: "识别当前页岗位", detail: `已识别 ${cards.length} 个岗位卡片。` },
    warnings: [],
    results: cards.map((card) => buildReviewResult(card, "等待详情页扫描结果。"))
  });

  if (cards.length === 0) {
    setState({
      status: "failed",
      error: "当前页面没有识别到产品类岗位卡片。可以打开岗位详情页后使用手动扫描。",
      results: []
    });
    return state;
  }

  if (adapter.platform === "bytedance") {
    const results = await scanByteDanceWithRenderedDetails(cards);
    setState({ status: "done", error: undefined, progress: { current: results.length, total: results.length, stage: "扫描完成" }, results });
    renderResults(results);
    return state;
  }

  const jobs: DetailFetchRequest[] = cards.map((card) => ({
    id: card.id,
    url: card.url,
    platform: adapter.platform,
    previewText: card.previewText
  }));
  const response = await chrome.runtime.sendMessage<RuntimeMessage<{ jobs: DetailFetchRequest[] }>, JobScanResult[] | { error: string }>({
    type: "JDMF_FETCH_DETAILS_BATCH",
    payload: { jobs }
  });

  if (!Array.isArray(response)) {
    setState({
      status: "failed",
      error: response?.error ?? "后台批量扫描失败。",
      results: cards.map((card) => buildReviewResult(card, response?.error ?? "后台批量扫描失败。"))
    });
    renderResults(state.results);
    return state;
  }

  const results = mergeResults(cards, response);
  setState({ status: "done", error: undefined, progress: { current: results.length, total: results.length, stage: "扫描完成" }, results });
  renderResults(results);
  return state;
}

async function scanCurrentAndNextTwoPages(): Promise<ScanState> {
  const adapter = getAdapter();
  if (adapter.platform !== "bytedance") {
    return scanListPage();
  }

  const originalUrl = location.href;
  const startPage = getCurrentPageNumber();
  const collected = new Map<string, JobCardRecord>();
  const warnings: string[] = [];
  cardRegistry.clear();
  resultCacheByUrl.clear();

  setState({
    pageUrl: originalUrl,
    scanScope: buildScanScope(originalUrl),
    scanId: createScanId(),
    platform: adapter.platform,
    status: "scanning",
    error: undefined,
    warnings,
    progress: { current: 0, total: 3, stage: "识别当前页", detail: `当前是第 ${startPage} 页，之后会预扫第 ${startPage + 1}、${startPage + 2} 页。` },
    results: []
  });

  const visibleCards = adapter.collectJobCards().map((card) => ({
    ...card,
    pageNumber: startPage
  }));

  for (const card of visibleCards) {
    collected.set(card.url, card);
    cardRegistry.set(card.id, card.element);
    renderScanningBadge(card.element);
  }

  if (visibleCards.length === 0) {
    setState({
      status: "failed",
      error: "当前页面没有识别到产品类岗位卡片。没有当前页结果时，不会继续后台预扫后两页。",
      progress: { current: 0, total: 3, stage: "未识别到当前页岗位" },
      results: []
    });
    return state;
  }

  const visiblePreviewResults = visibleCards.map(buildPreviewResult);
  cacheResults(visiblePreviewResults);
  setState({
    status: "scanning",
    error: undefined,
    progress: { current: 1, total: 3, stage: "当前页已识别", detail: `第 ${startPage} 页识别到 ${visibleCards.length} 个岗位。` },
    results: visiblePreviewResults
  });
  renderResults(visiblePreviewResults);

  for (const pageNumber of [startPage + 1, startPage + 2]) {
    const pageUrl = buildListPageUrl(originalUrl, pageNumber);
    setProgress(pageNumber - startPage, 3, "后台预扫后续页", `正在读取第 ${pageNumber} 页列表。`);
    let snapshots: JobCardSnapshot[] = [];
    try {
      snapshots = await extractRenderedByteDanceListCards(pageUrl, pageNumber);
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : `第 ${pageNumber} 页列表读取失败`);
      setState({ warnings: [...warnings] });
      continue;
    }
    for (const snapshotItem of snapshots) {
      if (!collected.has(snapshotItem.url)) {
        collected.set(snapshotItem.url, recordFromSnapshot(snapshotItem, document.createElement("div")));
      }
    }

    const previewResults = Array.from(collected.values()).map(buildPreviewResult);
    cacheResults(previewResults);
    setState({
      status: "scanning",
      error: undefined,
      warnings: [...warnings],
      progress: { current: pageNumber - startPage + 1, total: 3, stage: "后台预扫后续页", detail: `第 ${pageNumber} 页识别到 ${snapshots.length} 个岗位。` },
      results: previewResults
    });
    renderResults(previewResults.filter((result) => cardRegistry.has(result.id)));
  }

  const allCards = Array.from(collected.values());
  const results = await scanByteDanceWithRenderedDetails(allCards);
  cacheResults(results);
  setState({
    pageUrl: originalUrl,
    scanScope: buildScanScope(originalUrl),
    status: "done",
    error: undefined,
    warnings: [...warnings],
    progress: { current: results.length, total: results.length, stage: "扫描完成", detail: warnings.length ? "部分后续页读取失败，已保留当前已扫结果。" : undefined },
    results
  });
  renderResults(results);
  return state;
}

function buildListPageUrl(baseUrl: string, pageNumber: number): string {
  const url = new URL(baseUrl);
  url.searchParams.set("current", String(pageNumber));
  url.searchParams.set("limit", url.searchParams.get("limit") || "10");
  return url.toString();
}

function getCurrentPageNumber(): number {
  const currentFromUrl = Number(new URL(location.href).searchParams.get("current") ?? "");
  if (Number.isFinite(currentFromUrl) && currentFromUrl > 0) {
    return currentFromUrl;
  }
  return 1;
}

async function scanDetailPage(): Promise<ScanState> {
  const adapter = getAdapter();
  const jdText = adapter.extractDetailText();
  const classification = classifyJD(jdText);
  const result: JobScanResult = {
    id: "current_detail_page",
    company: document.title.split(/[-_|]/)[0]?.trim() ?? "",
    title: document.querySelector("h1")?.textContent?.trim() || document.title,
    location: "",
    url: location.href,
    previewText: "",
    jdText,
    status: classification.riskLevel === "review" ? "failed" : "done",
    scannedAt: new Date().toISOString(),
    ...classification
  };

  setState({
    pageUrl: location.href,
    scanScope: buildScanScope(location.href),
    scanId: createScanId(),
    platform: adapter.platform,
    status: "done",
    error: undefined,
    warnings: [],
    progress: { current: 1, total: 1, stage: "详情页扫描完成" },
    results: [result]
  });
  return state;
}

function applyFilter(mode: FilterMode): ScanState {
  setState({ filterMode: mode });
  renderResults(state.results);
  return state;
}

const globalFlags = globalThis as typeof globalThis & Record<string, boolean | undefined>;

if (!globalFlags[LISTENER_READY_FLAG]) {
  globalFlags[LISTENER_READY_FLAG] = true;

  chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
    if (message.type === "JDMF_SCAN_PAGE") {
      scanListPage().then(sendResponse).catch((error) => {
        setState({ status: "failed", error: error instanceof Error ? error.message : "扫描失败" });
        sendResponse(state);
      });
      return true;
    }

    if (message.type === "JDMF_SCAN_CURRENT_AND_NEXT_TWO_PAGES") {
      scanCurrentAndNextTwoPages().then(sendResponse).catch((error) => {
        setState({ status: "failed", error: error instanceof Error ? error.message : "前三页扫描失败" });
        sendResponse(state);
      });
      return true;
    }

    if (message.type === "JDMF_SCAN_DETAIL_PAGE") {
      scanDetailPage().then(sendResponse).catch((error) => {
        setState({ status: "failed", error: error instanceof Error ? error.message : "详情页扫描失败" });
        sendResponse(state);
      });
      return true;
    }

    if (message.type === "JDMF_APPLY_FILTER") {
      const mode = (message.payload as { mode?: FilterMode } | undefined)?.mode ?? "all";
      sendResponse(applyFilter(mode));
      return false;
    }

    if (message.type === "JDMF_GET_STATE") {
      sendResponse(state);
      return false;
    }

    return false;
  });
}

function scheduleHydrateFromCache(): void {
  if (hydrateTimer) {
    window.clearTimeout(hydrateTimer);
  }
  hydrateUntil = Date.now() + HYDRATE_WINDOW_MS;
  hydrateTimer = window.setTimeout(runHydrateLoop, 200);
}

function runHydrateLoop(): void {
  const hydratedCount = hydrateVisibleCardsFromCache();
  if (Date.now() >= hydrateUntil) {
    return;
  }

  if (hydratedCount === 0 || document.querySelectorAll(".jdmf-badge-wrap").length < hydratedCount) {
    hydrateTimer = window.setTimeout(runHydrateLoop, HYDRATE_RETRY_MS);
  }
}

function startDomHydrationObserver(): void {
  if (mutationObserver) {
    return;
  }

  mutationObserver = new MutationObserver(() => {
    if (resultCacheByUrl.size === 0) {
      return;
    }
    scheduleHydrateFromCache();
  });

  mutationObserver.observe(document.body, {
    childList: true,
    subtree: true
  });
}

window.addEventListener("popstate", scheduleHydrateFromCache);
window.addEventListener("hashchange", scheduleHydrateFromCache);
startDomHydrationObserver();

const originalPushState = history.pushState;
history.pushState = function pushState(...args) {
  const result = originalPushState.apply(this, args);
  scheduleHydrateFromCache();
  return result;
};

const originalReplaceState = history.replaceState;
history.replaceState = function replaceState(...args) {
  const result = originalReplaceState.apply(this, args);
  scheduleHydrateFromCache();
  return result;
};
