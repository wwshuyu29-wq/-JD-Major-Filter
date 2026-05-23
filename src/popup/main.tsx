import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Download, Eye, EyeOff, FileSearch, Loader2, RotateCcw, ScanLine } from "lucide-react";
import { toCsv } from "../shared/csv";
import type { FilterMode, JobScanResult, RiskLevel, RuntimeMessage, ScanState } from "../shared/types";
import "./styles.css";

const STORAGE_KEY = "JDMF_LAST_STATE";

const FILTER_OPTIONS: Array<{ mode: FilterMode; label: string; icon: React.ReactNode }> = [
  { mode: "all", label: "显示全部", icon: <Eye size={15} /> },
  { mode: "safe_only", label: "只看 ✅", icon: <Eye size={15} /> },
  { mode: "safe_and_caution", label: "只看 ✅ + 🟡", icon: <Eye size={15} /> },
  { mode: "hide_high_risk", label: "隐藏 🟠", icon: <EyeOff size={15} /> },
  { mode: "hide_high_risk_and_excluded", label: "隐藏 🟠 + ❌", icon: <EyeOff size={15} /> }
];

const EXPORT_OPTIONS: Array<{ label: string; fileName: string; risks?: RiskLevel[] }> = [
  { label: "导出可投岗位", fileName: "jd-major-filter-suitable.csv", risks: ["safe", "caution"] },
  { label: "导出高风险 / 排除", fileName: "jd-major-filter-risky.csv", risks: ["high_risk", "excluded"] },
  { label: "导出全部岗位", fileName: "jd-major-filter-all.csv" }
];

function emptyState(): ScanState {
  return {
    pageUrl: "",
    platform: "",
    status: "idle",
    filterMode: "hide_high_risk_and_excluded",
    summary: {
      total: 0,
      safe: 0,
      caution: 0,
      highRisk: 0,
      excluded: 0,
      review: 0
    },
    results: [],
    updatedAt: ""
  };
}

async function getActiveTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error("没有找到当前活动标签页。");
  }
  return tab;
}

async function ensureContentScript(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content-loader.js"]
  });
  await new Promise((resolve) => window.setTimeout(resolve, 200));
}

async function sendToActiveTab<T>(message: RuntimeMessage): Promise<T> {
  const tab = await getActiveTab();
  try {
    return await chrome.tabs.sendMessage(tab.id!, message);
  } catch (error) {
    await ensureContentScript(tab.id!);
    return chrome.tabs.sendMessage(tab.id!, message);
  }
}

function downloadCsv(results: JobScanResult[], fileName: string, risks?: RiskLevel[]): void {
  const csv = `\uFEFF${toCsv(results, risks)}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function stripHash(url = ""): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

function App() {
  const [scanState, setScanState] = useState<ScanState>(() => emptyState());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [currentTabUrl, setCurrentTabUrl] = useState("");

  const isCurrentPageResult = hasSamePage(scanState.pageUrl, currentTabUrl);
  const hasResults = scanState.results.length > 0 && isCurrentPageResult;
  const statusText = useMemo(() => {
    if (busy || scanState.status === "scanning") {
      return "扫描中";
    }
    if (scanState.status === "done") {
      return "已完成";
    }
    if (scanState.status === "failed") {
      return "需要处理";
    }
    return "未扫描";
  }, [busy, scanState.status]);

  useEffect(() => {
    let tabUrl = "";
    getActiveTab().then((tab) => {
      tabUrl = tab.url ?? "";
      setCurrentTabUrl(tabUrl);
      return chrome.storage.local.get(STORAGE_KEY);
    }).then((stored) => {
      const lastState = stored[STORAGE_KEY] as ScanState | undefined;
      if (lastState && hasSamePage(lastState.pageUrl, tabUrl)) {
        setScanState(lastState);
      }
    }).catch(() => undefined);
  }, []);

  async function runScan(type: "JDMF_SCAN_PAGE" | "JDMF_SCAN_CURRENT_AND_NEXT_TWO_PAGES" | "JDMF_SCAN_DETAIL_PAGE"): Promise<void> {
    setBusy(true);
    setError("");
    try {
      const nextState = await sendToActiveTab<ScanState>({ type });
      setScanState(nextState);
      setCurrentTabUrl(nextState.pageUrl);
      if (nextState.error) {
        setError(nextState.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法连接到当前页面 content script。请确认页面属于已支持招聘站点，并刷新后重试。");
    } finally {
      setBusy(false);
    }
  }

  async function applyFilter(mode: FilterMode): Promise<void> {
    setError("");
    try {
      const nextState = await sendToActiveTab<ScanState>({
        type: "JDMF_APPLY_FILTER",
        payload: { mode }
      });
      setScanState(nextState);
    } catch (err) {
      setError(err instanceof Error ? err.message : "筛选失败，请刷新页面后重试。");
    }
  }

  return (
    <main className="w-[380px] bg-white text-ink">
      <header className="border-b border-slate-200 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <img className="h-10 w-10 rounded-md border border-slate-200 bg-white object-contain p-1" src="/icons/icon-48.png" alt="" />
            <div>
              <h1 className="text-lg font-semibold leading-tight">JD Major Filter</h1>
              <p className="mt-1 text-xs leading-5 text-muted">校招产品岗专业门槛识别</p>
            </div>
          </div>
          <span className="rounded-full bg-panel px-3 py-1 text-xs font-medium text-muted">{statusText}</span>
        </div>
      </header>

      <section className="space-y-3 px-4 py-4">
        <button
          className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-ink text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={() => void runScan("JDMF_SCAN_PAGE")}
          disabled={busy}
        >
          {busy ? <Loader2 className="animate-spin" size={17} /> : <ScanLine size={17} />}
          扫描当前页岗位
        </button>
        <button
          className="flex h-10 w-full items-center justify-center gap-2 rounded-md border border-slate-300 bg-white text-sm font-semibold text-ink transition hover:bg-panel disabled:cursor-not-allowed disabled:opacity-60"
          onClick={() => void runScan("JDMF_SCAN_CURRENT_AND_NEXT_TWO_PAGES")}
          disabled={busy}
        >
          {busy ? <Loader2 className="animate-spin" size={17} /> : <ScanLine size={17} />}
          扫描当前页起 3 页
        </button>
        <button
          className="flex h-10 w-full items-center justify-center gap-2 rounded-md border border-slate-200 bg-white text-sm font-semibold text-ink transition hover:bg-panel disabled:cursor-not-allowed disabled:opacity-60"
          onClick={() => void runScan("JDMF_SCAN_DETAIL_PAGE")}
          disabled={busy}
        >
          <FileSearch size={17} />
          当前详情页手动扫描
        </button>
      </section>

      <section className="border-t border-slate-100 px-4 py-4">
        <div className="grid grid-cols-5 gap-2">
          <Stat label="总数" value={scanState.summary.total} />
          <Stat label="✅" value={scanState.summary.safe} />
          <Stat label="🟡" value={scanState.summary.caution} />
          <Stat label="🟠" value={scanState.summary.highRisk} />
          <Stat label="❌" value={scanState.summary.excluded} />
        </div>
        {scanState.summary.review > 0 ? (
          <p className="mt-3 rounded-md bg-panel px-3 py-2 text-xs leading-5 text-muted">⚪ {scanState.summary.review} 个岗位需要点开人工复核。</p>
        ) : null}
      </section>

      <section className="border-t border-slate-100 px-4 py-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">页面筛选</h2>
          <button className="flex items-center gap-1 text-xs text-muted hover:text-ink" onClick={() => void applyFilter("hide_high_risk_and_excluded")}>
            <RotateCcw size={13} />
            默认
          </button>
        </div>
        <div className="grid grid-cols-1 gap-2">
          {FILTER_OPTIONS.map((option) => (
            <button
              key={option.mode}
              className={`flex h-9 items-center justify-between rounded-md border px-3 text-sm transition ${
                scanState.filterMode === option.mode ? "border-ink bg-ink text-white" : "border-slate-200 bg-white text-ink hover:bg-panel"
              }`}
              onClick={() => void applyFilter(option.mode)}
              disabled={!hasResults}
            >
              <span>{option.label}</span>
              {option.icon}
            </button>
          ))}
        </div>
      </section>

      <section className="border-t border-slate-100 px-4 py-4">
        <h2 className="mb-2 text-sm font-semibold">CSV 导出</h2>
        <div className="grid grid-cols-1 gap-2">
          {EXPORT_OPTIONS.map((option) => (
            <button
              key={option.fileName}
              className="flex h-9 items-center justify-between rounded-md border border-slate-200 px-3 text-sm text-ink transition hover:bg-panel disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!hasResults}
              onClick={() => {
                if (!hasResults) {
                  setError("当前导出结果不是这个页面的扫描结果。请先重新扫描当前页。");
                  return;
                }
                downloadCsv(scanState.results, option.fileName, option.risks);
              }}
            >
              <span>{option.label}</span>
              <Download size={15} />
            </button>
          ))}
        </div>
      </section>

      {(error || scanState.error) && (
        <section className="border-t border-red-100 bg-red-50 px-4 py-3 text-xs leading-5 text-red-700">{error || scanState.error}</section>
      )}

      <footer className="border-t border-slate-100 px-4 py-3 text-[11px] leading-5 text-muted">
        本地规则判断，不调用 LLM API。列表页无法提取完整 JD 时，请打开详情页手动扫描。
      </footer>
    </main>
  );
}

function hasSamePage(left = "", right = ""): boolean {
  if (!left || !right) {
    return false;
  }
  const normalizedLeft = stripPaging(stripHash(left));
  const normalizedRight = stripPaging(stripHash(right));
  return normalizedLeft === normalizedRight;
}

function stripPaging(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete("current");
    return parsed.toString();
  } catch {
    return url;
  }
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-panel px-2 py-2 text-center">
      <div className="text-base font-semibold leading-5">{value}</div>
      <div className="mt-1 text-[11px] text-muted">{label}</div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
