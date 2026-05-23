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

const cardRegistry = new Map<string, HTMLElement>();
const resultCacheByUrl = new Map<string, JobScanResult>();
let hydrateTimer: number | undefined;
let state: ScanState = createInitialState();

injectBadgeStyles();
void chrome.storage.local.get(STORAGE_KEY).then((stored) => {
  const lastState = stored[STORAGE_KEY] as ScanState | undefined;
  if (!lastState?.results?.length) {
    return;
  }
  state = lastState;
  cacheResults(lastState.results);
  scheduleHydrateFromCache();
});

function createInitialState(): ScanState {
  return {
    pageUrl: location.href,
    platform: getAdapter().platform,
    status: "idle",
    filterMode: "hide_high_risk_and_excluded",
    summary: summarize([]),
    results: [],
    updatedAt: new Date().toISOString()
  };
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

function hydrateVisibleCardsFromCache(): void {
  const adapter = getAdapter();
  if (adapter.platform !== "bytedance") {
    return;
  }

  const cards = adapter.collectJobCards();
  const visibleResults: JobScanResult[] = [];

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
      visibleResults.push(result);
      renderBadge(card.element, result);
      applyCardVisibility(card.element, shouldHideByFilter(result, state.filterMode));
    }
  }
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
    return previewResults;
  }

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

  for (const card of cards) {
    cardRegistry.set(card.id, card.element);
    renderScanningBadge(card.element);
  }

  setState({
    pageUrl: location.href,
    platform: adapter.platform,
    status: "scanning",
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
    setState({ status: "done", error: undefined, results });
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
  setState({ status: "done", error: undefined, results });
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
  cardRegistry.clear();

  setState({
    pageUrl: originalUrl,
    platform: adapter.platform,
    status: "scanning",
    error: undefined,
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

  const visiblePreviewResults = visibleCards.map(buildPreviewResult);
  cacheResults(visiblePreviewResults);
  setState({ status: "scanning", error: undefined, results: visiblePreviewResults });
  renderResults(visiblePreviewResults);

  for (const pageNumber of [startPage + 1, startPage + 2]) {
    const pageUrl = buildListPageUrl(originalUrl, pageNumber);
    const snapshots = await extractRenderedByteDanceListCards(pageUrl, pageNumber);
    for (const snapshotItem of snapshots) {
      if (!collected.has(snapshotItem.url)) {
        collected.set(snapshotItem.url, recordFromSnapshot(snapshotItem, document.createElement("div")));
      }
    }

    const previewResults = Array.from(collected.values()).map(buildPreviewResult);
    cacheResults(previewResults);
    setState({ status: "scanning", error: undefined, results: previewResults });
    renderResults(previewResults.filter((result) => cardRegistry.has(result.id)));
  }

  const allCards = Array.from(collected.values());
  const results = await scanByteDanceWithRenderedDetails(allCards);
  cacheResults(results);
  setState({ pageUrl: originalUrl, status: "done", error: undefined, results });
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
    platform: adapter.platform,
    status: "done",
    error: undefined,
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
  hydrateTimer = window.setTimeout(hydrateVisibleCardsFromCache, 800);
}

window.addEventListener("popstate", scheduleHydrateFromCache);
window.addEventListener("hashchange", scheduleHydrateFromCache);

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
