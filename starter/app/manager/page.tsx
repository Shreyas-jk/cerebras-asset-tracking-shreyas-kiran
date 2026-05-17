import Link from "next/link";
import { headers } from "next/headers";
import { api } from "@/lib/api-client";
import type { Asset } from "@/lib/types";
import type { ReconcileReport } from "@/lib/reconcile";
import { TRIAGE_LEVEL_BY_CATEGORY } from "@/lib/reconcile";
import { TriageCard, type TriageCardTone } from "./TriageCard";
import { FilterChips, isFilterName, type FilterName } from "./FilterChips";
import { AssetTable, isSortColumn, type SortColumn } from "./AssetTable";

const PAGE_SIZE = 50;
const RMA_STALE_DAYS = 14;
const RECEIVED_STALE_DAYS = 7;

type RawSearchParams = Record<string, string | string[] | undefined>;

type PageState = {
  filter: FilterName;
  sort: SortColumn;
  dir: "asc" | "desc";
  page: number;
};

function readState(sp: RawSearchParams): PageState {
  const filterRaw = typeof sp.filter === "string" ? sp.filter : "";
  const sortRaw = typeof sp.sort === "string" ? sp.sort : "";
  const dirRaw = typeof sp.dir === "string" ? sp.dir : "";
  const pageRaw = typeof sp.page === "string" ? sp.page : "";
  return {
    filter: isFilterName(filterRaw) ? filterRaw : "all",
    sort: isSortColumn(sortRaw) ? sortRaw : "tag",
    dir: dirRaw === "desc" ? "desc" : "asc",
    page: Math.max(1, Number.parseInt(pageRaw, 10) || 1),
  };
}

async function loadReconcile(): Promise<ReconcileReport | null> {
  const h = await headers();
  const host = h.get("host");
  if (!host) return null;
  const proto = h.get("x-forwarded-proto") ?? "http";
  try {
    const res = await fetch(`${proto}://${host}/api/reconcile`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as ReconcileReport;
  } catch {
    return null;
  }
}

function driftToneFromCounts(report: ReconcileReport | null): TriageCardTone {
  if (!report) return "gray";
  const c = report.counts_by_category;
  let actionRequired = 0;
  let investigate = 0;
  let monitor = 0;
  const mapping = TRIAGE_LEVEL_BY_CATEGORY;
  for (const cat of Object.keys(mapping) as (keyof typeof mapping)[]) {
    const level = mapping[cat];
    if (level === "action_required") actionRequired += c[cat];
    else if (level === "investigate") investigate += c[cat];
    else if (level === "monitor") monitor += c[cat];
  }
  if (actionRequired > 0) return "red";
  if (investigate > 0 || monitor > 0) return "amber";
  return "gray";
}

function isRmaStale(a: Asset, cutoff: number): boolean {
  return a.state === "rma_pending" && Date.parse(a.updated_at) < cutoff;
}

function isReceivedStale(a: Asset, cutoff: number): boolean {
  return a.state === "received" && Date.parse(a.updated_at) < cutoff;
}

function isDisposedThisMonth(a: Asset, startOfMonthMs: number): boolean {
  return a.state === "disposed" && Date.parse(a.updated_at) >= startOfMonthMs;
}

function applyFilter(
  assets: Asset[],
  filter: FilterName,
  driftTags: Set<string>,
  nowMs: number,
  startOfMonthMs: number,
): Asset[] {
  const rmaCutoff = nowMs - RMA_STALE_DAYS * 24 * 60 * 60 * 1000;
  const recvCutoff = nowMs - RECEIVED_STALE_DAYS * 24 * 60 * 60 * 1000;
  switch (filter) {
    case "has_drift":
      return assets.filter((a) => driftTags.has(a.asset_tag));
    case "rma_stale":
      return assets.filter((a) => isRmaStale(a, rmaCutoff));
    case "received_stale":
      return assets.filter((a) => isReceivedStale(a, recvCutoff));
    case "disposed_this_month":
      return assets.filter((a) => isDisposedThisMonth(a, startOfMonthMs));
    case "needs_attention":
      return assets.filter(
        (a) =>
          driftTags.has(a.asset_tag) ||
          isRmaStale(a, rmaCutoff) ||
          isReceivedStale(a, recvCutoff),
      );
    case "all":
    default:
      return assets;
  }
}

function locationSortKey(a: Asset): string {
  const l = a.location;
  return [l.site ?? "", l.room ?? "", l.row ?? "", l.rack ?? "", l.ru ?? ""].join(
    "/",
  );
}

function applySort(
  assets: Asset[],
  sort: SortColumn,
  dir: "asc" | "desc",
): Asset[] {
  const mult = dir === "desc" ? -1 : 1;
  const sorted = [...assets];
  switch (sort) {
    case "model":
      sorted.sort((a, b) => a.model.localeCompare(b.model) * mult);
      break;
    case "state":
      sorted.sort((a, b) => a.state.localeCompare(b.state) * mult);
      break;
    case "custodian":
      sorted.sort((a, b) => a.custodian.localeCompare(b.custodian) * mult);
      break;
    case "location":
      sorted.sort(
        (a, b) => locationSortKey(a).localeCompare(locationSortKey(b)) * mult,
      );
      break;
    case "updated":
      sorted.sort((a, b) => a.updated_at.localeCompare(b.updated_at) * mult);
      break;
    case "tag":
    default:
      sorted.sort((a, b) => a.asset_tag.localeCompare(b.asset_tag) * mult);
  }
  return sorted;
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "" || v === null) continue;
    qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}

function startOfCurrentMonthMs(nowMs: number): number {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

export default async function ManagerLandingPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}): Promise<React.ReactElement> {
  const sp = await searchParams;
  const state = readState(sp);

  const [assetsResult, reconcileResult] = await Promise.allSettled([
    api.assets.list(),
    loadReconcile(),
  ]);

  if (assetsResult.status === "rejected") {
    return (
      <div className="space-y-4 max-w-3xl">
        <h1 className="text-2xl font-bold">Manager</h1>
        <div className="rounded-md border-2 border-red-300 bg-red-50 p-4 text-sm text-red-900">
          <div className="font-medium">Could not load the asset list.</div>
          <div className="mt-1">
            {assetsResult.reason instanceof Error
              ? assetsResult.reason.message
              : "Unknown error"}
          </div>
        </div>
      </div>
    );
  }

  const assets = assetsResult.value;
  const report =
    reconcileResult.status === "fulfilled" ? reconcileResult.value : null;
  const nowMs = Date.now();
  const startOfMonthMs = startOfCurrentMonthMs(nowMs);
  const rmaCutoff = nowMs - RMA_STALE_DAYS * 24 * 60 * 60 * 1000;
  const recvCutoff = nowMs - RECEIVED_STALE_DAYS * 24 * 60 * 60 * 1000;

  const driftTags = new Set(report?.findings.map((f) => f.asset_tag) ?? []);
  const driftTotal = report?.findings.length ?? 0;
  const rmaStaleCount = assets.filter((a) => isRmaStale(a, rmaCutoff)).length;
  const receivedStaleCount = assets.filter((a) =>
    isReceivedStale(a, recvCutoff),
  ).length;
  const disposedThisMonthCount = assets.filter((a) =>
    isDisposedThisMonth(a, startOfMonthMs),
  ).length;

  const filtered = applyFilter(
    assets,
    state.filter,
    driftTags,
    nowMs,
    startOfMonthMs,
  );
  const sorted = applySort(filtered, state.sort, state.dir);
  const totalFiltered = sorted.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));
  const clampedPage = Math.min(state.page, totalPages);
  const start = (clampedPage - 1) * PAGE_SIZE;
  const visibleRows = sorted.slice(start, start + PAGE_SIZE);

  const buildFilterUrl = (filter: FilterName): string =>
    `/manager${buildQuery({
      filter: filter === "all" ? undefined : filter,
      sort: state.sort === "tag" ? undefined : state.sort,
      dir: state.dir === "asc" ? undefined : state.dir,
      // page resets to 1 when filter changes
    })}`;

  const buildSortUrl = (col: SortColumn): string => {
    const isActive = state.sort === col;
    const nextDir: "asc" | "desc" = isActive
      ? state.dir === "asc"
        ? "desc"
        : "asc"
      : "asc";
    return `/manager${buildQuery({
      filter: state.filter === "all" ? undefined : state.filter,
      sort: col === "tag" ? undefined : col,
      dir: nextDir === "asc" ? undefined : nextDir,
      // page resets to 1 when sort changes
    })}`;
  };

  const buildPageUrl = (p: number): string =>
    `/manager${buildQuery({
      filter: state.filter === "all" ? undefined : state.filter,
      sort: state.sort === "tag" ? undefined : state.sort,
      dir: state.dir === "asc" ? undefined : state.dir,
      page: p === 1 ? undefined : p,
    })}`;

  const buildClearUrl = (): string => "/manager";

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Asset manager</h1>
        <p className="text-sm text-gray-500 mt-1">
          {assets.length.toLocaleString("en-US")} assets total
          {report ? (
            <>
              {" "}
              · reconcile generated{" "}
              <time dateTime={report.generated_at}>
                {new Date(report.generated_at).toLocaleString("en-US", {
                  hour: "numeric",
                  minute: "2-digit",
                  hour12: true,
                  weekday: "short",
                })}
              </time>
            </>
          ) : (
            <> · reconcile unavailable</>
          )}
        </p>
      </header>

      <section
        aria-label="Triage strip"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3"
      >
        <TriageCard
          count={driftTotal}
          label="Reconcile findings"
          sublabel="Open report →"
          href="/manager/reconcile"
          tone={driftToneFromCounts(report)}
        />
        <TriageCard
          count={rmaStaleCount}
          label="In RMA over 14 days"
          href={`/manager${buildQuery({ filter: "rma_stale" })}`}
          tone="amber"
        />
        <TriageCard
          count={receivedStaleCount}
          label="Received over 7 days"
          href={`/manager${buildQuery({ filter: "received_stale" })}`}
          tone="amber"
        />
        <TriageCard
          count={disposedThisMonthCount}
          label="Disposed this month"
          href={`/manager${buildQuery({ filter: "disposed_this_month" })}`}
          tone="gray"
        />
      </section>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <FilterChips active={state.filter} buildUrl={buildFilterUrl} />
          {state.filter !== "all" ? (
            <Link href="/manager" className="text-sm text-gray-600 hover:underline">
              Clear filters
            </Link>
          ) : null}
        </div>

        <AssetTable
          rows={visibleRows}
          totalFiltered={totalFiltered}
          firstRowNumber={totalFiltered === 0 ? 0 : start + 1}
          page={clampedPage}
          totalPages={totalPages}
          sort={state.sort}
          dir={state.dir}
          buildSortUrl={buildSortUrl}
          buildPageUrl={buildPageUrl}
          buildClearUrl={buildClearUrl}
          nowMs={nowMs}
        />
      </section>
    </div>
  );
}
