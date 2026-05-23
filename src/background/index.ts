import { classifyJD } from "../shared/classifier";
import type { DetailFetchRequest, DetailFetchResponse, JobScanResult, RuntimeMessage } from "../shared/types";
import { extractDetailText } from "./extractors";

const CONCURRENCY = 3;
const REQUEST_DELAY_MS = 700;
const REQUEST_TIMEOUT_MS = 15_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      credentials: "include",
      redirect: "follow",
      signal: controller.signal
    });
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

async function fetchDetail(job: DetailFetchRequest): Promise<DetailFetchResponse> {
  try {
    const response = await fetchWithTimeout(job.url);
    const text = await response.text();
    return {
      id: job.id,
      ok: response.ok,
      url: job.url,
      finalUrl: response.url,
      html: text,
      contentType: response.headers.get("content-type") ?? "",
      error: response.ok ? undefined : `HTTP ${response.status}`
    };
  } catch (error) {
    return {
      id: job.id,
      ok: false,
      url: job.url,
      error: error instanceof Error ? error.message : "详情页请求失败"
    };
  }
}

async function runQueue<T, R>(items: T[], worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function next(): Promise<void> {
    const currentIndex = cursor;
    cursor += 1;
    if (currentIndex >= items.length) {
      return;
    }

    results[currentIndex] = await worker(items[currentIndex], currentIndex);
    await sleep(REQUEST_DELAY_MS);
    await next();
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, next));
  return results;
}

async function scanDetails(jobs: DetailFetchRequest[]): Promise<JobScanResult[]> {
  return runQueue(jobs, async (job) => {
    const fetched = await fetchDetail(job);
    const contentType =
      "contentType" in fetched && fetched.contentType
        ? fetched.contentType
        : fetched.html?.trim().startsWith("{")
          ? "application/json"
          : "text/html";
    const jdText = fetched.ok && fetched.html ? extractDetailText(fetched.html, contentType) : "";
    const classification = classifyJD(jdText || job.previewText);
    const failed = !fetched.ok || jdText.length < 20;

    if (failed) {
      return {
        id: job.id,
        company: "",
        title: "",
        location: "",
        url: fetched.finalUrl ?? job.url,
        previewText: job.previewText,
        jdText,
        status: "failed",
        scannedAt: new Date().toISOString(),
        result: "⚪ 需点开复核",
        riskLevel: "review",
        matchedKeywords: classification.matchedKeywords,
        matchedSentence: classification.matchedSentence,
        reason: fetched.error ? `详情页请求或提取失败：${fetched.error}` : "详情页文本过少，需要人工打开复核。",
        shouldHideByDefault: false,
        needsManualReview: true
      };
    }

    return {
      id: job.id,
      company: "",
      title: "",
      location: "",
      url: fetched.finalUrl ?? job.url,
      previewText: job.previewText,
      jdText,
      status: "done",
      scannedAt: new Date().toISOString(),
      ...classification
    };
  });
}

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  if (message.type !== "JDMF_FETCH_DETAILS_BATCH") {
    return false;
  }

  const jobs = (message.payload as { jobs?: DetailFetchRequest[] } | undefined)?.jobs ?? [];
  scanDetails(jobs).then(sendResponse).catch((error) => {
    sendResponse({
      error: error instanceof Error ? error.message : "批量扫描失败"
    });
  });
  return true;
});
