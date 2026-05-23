import { normalizeText } from "../shared/text";
import { createStableId } from "../shared/text";
import type { JobCardSnapshot } from "../shared/types";

const DETAIL_TIMEOUT_MS = 25_000;
const LIST_TIMEOUT_MS = 18_000;

export async function extractRenderedDetailText(url: string): Promise<string> {
  const iframe = document.createElement("iframe");
  iframe.src = url;
  iframe.style.position = "fixed";
  iframe.style.left = "-10000px";
  iframe.style.top = "0";
  iframe.style.width = "1200px";
  iframe.style.height = "900px";
  iframe.style.opacity = "0";
  iframe.style.pointerEvents = "none";
  iframe.setAttribute("aria-hidden", "true");
  document.body.append(iframe);

  try {
    return await waitForRenderedText(iframe);
  } finally {
    iframe.remove();
  }
}

function waitForRenderedText(iframe: HTMLIFrameElement): Promise<string> {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const timer = window.setInterval(() => {
      if (Date.now() - startedAt > DETAIL_TIMEOUT_MS) {
        window.clearInterval(timer);
        reject(new Error("详情页 iframe 渲染超时"));
        return;
      }

      try {
        const text = normalizeText(iframe.contentDocument?.body?.innerText ?? "");
        if (isLikelyJobDetail(text)) {
          window.clearInterval(timer);
          resolve(extractPrimaryJobDetail(text));
        }
      } catch (error) {
        window.clearInterval(timer);
        reject(error instanceof Error ? error : new Error("无法读取详情页 iframe"));
      }
    }, 700);
  });
}

function isLikelyJobDetail(text: string): boolean {
  if (text.length < 180) {
    return false;
  }

  return /职位描述|工作职责|职位要求|任职要求|Qualifications|Responsibilities|Job Description|岗位职责/.test(text);
}

function extractPrimaryJobDetail(text: string): string {
  const startMarkers = ["职位描述", "工作职责", "岗位职责", "Responsibilities", "Job Description"];
  const endMarkers = ["投递", "相关职位", "联系我们", "官网使用体验反馈", "Related Jobs", "Contact us"];

  const startIndex = findFirstIndex(text, startMarkers);
  const endIndex = findFirstIndex(text, endMarkers, startIndex < 0 ? 0 : startIndex + 1);
  const start = startIndex < 0 ? 0 : startIndex;
  const end = endIndex < 0 ? text.length : endIndex;

  return normalizeText(text.slice(start, end));
}

function findFirstIndex(text: string, markers: string[], fromIndex = 0): number {
  const indexes = markers
    .map((marker) => text.indexOf(marker, fromIndex))
    .filter((index) => index >= 0);

  return indexes.length > 0 ? Math.min(...indexes) : -1;
}

export async function extractRenderedByteDanceListCards(url: string, pageNumber: number): Promise<JobCardSnapshot[]> {
  const iframe = document.createElement("iframe");
  iframe.src = url;
  iframe.style.position = "fixed";
  iframe.style.left = "-10000px";
  iframe.style.top = "0";
  iframe.style.width = "1200px";
  iframe.style.height = "900px";
  iframe.style.opacity = "0";
  iframe.style.pointerEvents = "none";
  iframe.setAttribute("aria-hidden", "true");
  document.body.append(iframe);

  try {
    return await waitForRenderedListCards(iframe, pageNumber);
  } finally {
    iframe.remove();
  }
}

function waitForRenderedListCards(iframe: HTMLIFrameElement, pageNumber: number): Promise<JobCardSnapshot[]> {
  const startedAt = Date.now();
  let lastSignature = "";
  let stableCount = 0;

  return new Promise((resolve, reject) => {
    const timer = window.setInterval(() => {
      if (Date.now() - startedAt > LIST_TIMEOUT_MS) {
        window.clearInterval(timer);
        reject(new Error(`第 ${pageNumber} 页列表渲染超时`));
        return;
      }

      try {
        const doc = iframe.contentDocument;
        const anchors = Array.from(doc?.querySelectorAll<HTMLAnchorElement>('a[href*="/position/"][href*="/detail"]') ?? []);
        const signature = anchors.map((anchor) => anchor.href).join("|");
        if (anchors.length > 0 && signature === lastSignature) {
          stableCount += 1;
          if (stableCount >= 2) {
            window.clearInterval(timer);
            resolve(extractByteDanceCardsFromAnchors(anchors, pageNumber));
          }
        } else {
          stableCount = 0;
          lastSignature = signature;
        }
      } catch (error) {
        window.clearInterval(timer);
        reject(error instanceof Error ? error : new Error(`无法读取第 ${pageNumber} 页列表`));
      }
    }, 700);
  });
}

function extractByteDanceCardsFromAnchors(anchors: HTMLAnchorElement[], pageNumber: number): JobCardSnapshot[] {
  const records = new Map<string, JobCardSnapshot>();

  for (const anchor of anchors) {
    const text = normalizeText(anchor.innerText || "");
    const url = anchor.href;
    const title = text.split("\n").find(Boolean)?.trim() || "未命名岗位";
    if (!url || !text) {
      continue;
    }

    const id = createStableId(`${url}|${title}|${text.slice(0, 80)}`);
    records.set(url, {
      id,
      company: "字节跳动",
      title,
      location: extractLocationFromText(text),
      url,
      previewText: text,
      pageNumber
    });
  }

  return Array.from(records.values());
}

function extractLocationFromText(text: string): string {
  const knownCities = ["北京", "上海", "广州", "深圳", "杭州", "成都", "武汉", "南京", "西安", "苏州", "长沙", "重庆", "厦门", "珠海"];
  return knownCities.filter((city) => text.includes(city)).slice(0, 3).join(" / ");
}
