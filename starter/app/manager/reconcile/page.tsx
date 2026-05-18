import Link from "next/link";
import { headers } from "next/headers";
import { RefreshButton } from "./RefreshButton";
import {
  TRIAGE_LEVEL_BY_CATEGORY,
  type CountsByCategory,
  type ReconcileFinding,
  type ReconcileReport,
  type TriageLevel,
} from "@/lib/reconcile";

// In local dev, deriving the absolute URL from request headers works cleanly.
// On Vercel, if Edge/cluster hostname issues surface, the fallback is to read
// `process.env.VERCEL_URL`. Not switching preemptively — local dev is the
// priority for now.

type LoadResult =
  | { ok: true; report: ReconcileReport }
  | { ok: false; status: number; code: string; message: string };

async function loadReport(): Promise<LoadResult> {
  const h = await headers();
  const host = h.get("host");
  if (!host) {
    return {
      ok: false,
      status: 0,
      code: "missing_host",
      message: "Could not determine origin from request headers.",
    };
  }
  const proto = h.get("x-forwarded-proto") ?? "http";
  const res = await fetch(`${proto}://${host}/api/reconcile`, {
    cache: "no-store",
  });
  if (!res.ok) {
    let code = "upstream_unreachable";
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as {
        error?: { code?: string; message?: string };
      };
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;
    } catch {
      // body wasn't JSON — keep defaults
    }
    return { ok: false, status: res.status, code, message };
  }
  const report = (await res.json()) as ReconcileReport;
  return { ok: true, report };
}

const TRIAGE_ORDER: TriageLevel[] = ["action_required", "investigate", "monitor"];

const TRIAGE_SUMMARY_LABEL: Record<TriageLevel, string> = {
  action_required: "to act on",
  investigate: "to investigate",
  monitor: "to monitor",
};

const TRIAGE_GROUP_HEADER: Record<TriageLevel, string> = {
  action_required: "Act on",
  investigate: "Investigate",
  monitor: "Monitor",
};

const TRIAGE_NUMBER_CLASS: Record<TriageLevel, string> = {
  action_required: "text-red-700",
  investigate: "text-amber-700",
  monitor: "text-gray-600",
};

const TRIAGE_BORDER_CLASS: Record<TriageLevel, string> = {
  action_required: "border-red-400",
  investigate: "border-amber-400",
  monitor: "border-gray-300",
};

const TRIAGE_EMPTY_COPY: Record<TriageLevel, string> = {
  action_required: "No action items right now.",
  investigate: "Nothing to investigate.",
  monitor: "All recently observed.",
};

const CATEGORY_LABEL: Record<ReconcileFinding["category"], string> = {
  real_drift: "Real drift",
  state_scope_drift: "State / scope drift",
  ghost_in_facilities: "Ghost in facilities",
  ghost_in_finance: "Ghost in finance",
  stale_observation: "Stale observation",
  ambiguous: "Ambiguous",
};

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function relativeTime(iso: string, nowMs: number): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "just now";
  const sec = Math.max(0, Math.floor((nowMs - t) / 1000));
  if (sec < 60) return `${sec} seconds ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const days = Math.floor(hr / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function isoDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10);
}

function groupFindings(
  findings: ReconcileFinding[],
): Record<TriageLevel, ReconcileFinding[]> {
  const result: Record<TriageLevel, ReconcileFinding[]> = {
    action_required: [],
    investigate: [],
    monitor: [],
  };
  for (const f of findings) result[f.triage_level].push(f);
  for (const level of TRIAGE_ORDER) {
    result[level].sort((a, b) => a.asset_tag.localeCompare(b.asset_tag));
  }
  return result;
}

function summaryCounts(counts: CountsByCategory): Record<TriageLevel, number> {
  const result: Record<TriageLevel, number> = {
    action_required: 0,
    investigate: 0,
    monitor: 0,
  };
  const mapping = TRIAGE_LEVEL_BY_CATEGORY;
  for (const cat of Object.keys(mapping) as (keyof typeof mapping)[]) {
    result[mapping[cat]] += counts[cat];
  }
  return result;
}

function Chip({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "warn" | "concern";
}): React.ReactElement {
  const cls =
    tone === "concern"
      ? "bg-red-100 text-red-800"
      : tone === "warn"
        ? "bg-amber-100 text-amber-800"
        : "bg-gray-100 text-gray-700";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs ${cls}`}>
      {children}
    </span>
  );
}

function CategoryDetail({
  finding,
}: {
  finding: ReconcileFinding;
}): React.ReactElement {
  switch (finding.category) {
    case "real_drift":
      return (
        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs items-baseline">
          <span className="text-gray-500">ops</span>
          <span className="font-mono">{finding.details.ops_location}</span>
          <span className="text-gray-500">facilities</span>
          <span className="font-mono">{finding.details.facilities_location}</span>
        </div>
      );
    case "state_scope_drift":
      return (
        <div className="flex flex-wrap gap-2 items-center">
          <Chip>ops: {finding.details.ops_state}</Chip>
          {finding.details.facilities_present ? (
            <Chip tone="concern">facilities: tracked</Chip>
          ) : null}
          {finding.details.finance_status === "capitalized" ? (
            <Chip tone="concern">finance: capitalized</Chip>
          ) : finding.details.finance_status ? (
            <Chip>finance: {finding.details.finance_status}</Chip>
          ) : null}
        </div>
      );
    case "ghost_in_facilities":
      return (
        <div className="space-y-1 text-xs">
          <div>
            <span className="text-gray-500">facilities location: </span>
            <span className="font-mono">{finding.details.facilities_location}</span>
          </div>
          <div>
            <span className="text-gray-500">last observed: </span>
            <span>{isoDate(finding.details.facilities_last_observed)}</span>
          </div>
        </div>
      );
    case "ghost_in_finance":
      return (
        <div className="flex flex-wrap gap-2 items-center">
          <Chip>{finding.details.finance_status}</Chip>
          <Chip>site: {finding.details.finance_site || "—"}</Chip>
          <Chip>{USD.format(finding.details.book_value_usd)}</Chip>
        </div>
      );
    case "stale_observation":
      return (
        <div className="space-y-1">
          <div className="text-sm">
            <span className="font-semibold">
              {finding.details.days_since_observed} days
            </span>
            <span className="text-gray-600"> since last observation</span>
          </div>
          <div className="text-xs text-gray-500">
            facilities last seen {isoDate(finding.details.facilities_last_observed)}
          </div>
        </div>
      );
    case "ambiguous":
      return (
        <div className="flex flex-wrap gap-2 items-center">
          <Chip>ops: {finding.details.ops_state}</Chip>
          <Chip tone="warn">finance: {finding.details.finance_status}</Chip>
        </div>
      );
  }
}

function FindingCard({
  finding,
}: {
  finding: ReconcileFinding;
}): React.ReactElement {
  const borderClass = TRIAGE_BORDER_CLASS[finding.triage_level];
  return (
    <div
      className={`bg-white border-l-4 ${borderClass} border-y border-r border-gray-200 rounded-r-md p-3 print:break-inside-avoid`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <Link
          href={`/manager/assets/${finding.asset_tag}`}
          className="font-mono font-semibold text-base text-blue-700 underline underline-offset-2 hover:text-blue-900"
        >
          {finding.asset_tag}
        </Link>
        <Chip>{CATEGORY_LABEL[finding.category]}</Chip>
      </div>
      <div className="mt-2">
        <CategoryDetail finding={finding} />
      </div>
    </div>
  );
}

export default async function ManagerReconcilePage(): Promise<React.ReactElement> {
  const res = await loadReport();

  if (!res.ok) {
    return (
      <div className="space-y-4 max-w-3xl">
        <h1 className="text-2xl font-bold">Reconciliation report</h1>
        <div className="rounded-md border-2 border-red-300 bg-red-50 p-4 text-sm text-red-900 space-y-2">
          <div className="font-medium">Could not load the report.</div>
          <div className="font-mono text-xs">
            HTTP {res.status} · {res.code}
          </div>
          <div>{res.message}</div>
          <div className="pt-2">
            <RefreshButton />
          </div>
        </div>
      </div>
    );
  }

  const { report } = res;
  const groups = groupFindings(report.findings);
  const summary = summaryCounts(report.counts_by_category);
  const nowMs = Date.now();
  const generatedRelative = relativeTime(report.generated_at, nowMs);
  const suppressedFormatted = report.suppressed_count.toLocaleString("en-US");
  const findingsTotal = report.findings.length;

  return (
    <div className="space-y-6 print:bg-white">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold">Reconciliation report</h1>
          <p className="text-sm text-gray-500 mt-1">
            Generated {generatedRelative}
          </p>
        </div>
        <RefreshButton />
      </header>

      <section className="rounded-lg border bg-white p-4 print:break-inside-avoid">
        <div className="flex flex-wrap gap-x-10 gap-y-2 items-baseline">
          {TRIAGE_ORDER.map((level, i) => (
            <div key={level} className="flex items-baseline gap-2">
              <span
                className={`text-3xl font-bold ${TRIAGE_NUMBER_CLASS[level]}`}
              >
                {summary[level]}
              </span>
              <span className="text-sm text-gray-700">
                {TRIAGE_SUMMARY_LABEL[level]}
              </span>
              {i < TRIAGE_ORDER.length - 1 ? (
                <span className="text-gray-300 ml-4">·</span>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <section className="text-sm text-gray-600">
        {suppressedFormatted} expected mismatches not shown. These are assets in
        storage, RMA, or disposed — facilities and finance correctly don&apos;t
        track them in those states.
      </section>

      {findingsTotal === 0 ? (
        <section className="rounded-lg border bg-emerald-50 border-emerald-200 p-4 text-sm text-emerald-900">
          All clear. No reconciliation findings as of {generatedRelative}.
        </section>
      ) : (
        TRIAGE_ORDER.map((level) => {
          const items = groups[level];
          return (
            <section key={level} className="space-y-3">
              <h2 className="flex items-baseline gap-3">
                <span className="text-xs uppercase tracking-wide text-gray-500 font-semibold">
                  {TRIAGE_GROUP_HEADER[level]}
                </span>
                <span className={`text-xs ${TRIAGE_NUMBER_CLASS[level]}`}>
                  · {items.length}
                </span>
              </h2>
              {items.length === 0 ? (
                <p className="text-sm text-gray-500">{TRIAGE_EMPTY_COPY[level]}</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 print:grid-cols-2">
                  {items.map((f) => (
                    <FindingCard
                      key={`${f.asset_tag}-${f.category}`}
                      finding={f}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}
