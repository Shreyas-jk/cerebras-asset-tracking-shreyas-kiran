import Link from "next/link";
import { headers } from "next/headers";
import { api, ApiError } from "@/lib/api-client";
import type { Asset, Location } from "@/lib/types";
import type { ReconcileReport } from "@/lib/reconcile";
import { ReconcileBanner } from "./ReconcileBanner";
import { CrossSystemView } from "./CrossSystemView";
import { EventCard } from "./EventCard";

const STATE_BADGE: Record<Asset["state"], string> = {
  in_service: "bg-emerald-100 text-emerald-800",
  stored: "bg-blue-100 text-blue-800",
  received: "bg-amber-100 text-amber-800",
  rma_pending: "bg-orange-100 text-orange-800",
  disposed: "bg-gray-200 text-gray-700",
  unreceived: "bg-gray-100 text-gray-600",
};

function StateBadge({ state }: { state: Asset["state"] }): React.ReactElement {
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-xs ${STATE_BADGE[state]}`}
    >
      {state}
    </span>
  );
}

function locationToString(loc: Location): string {
  return (
    [loc.site, loc.room, loc.row, loc.rack, loc.ru]
      .filter((v) => v && v.length > 0)
      .join(" / ") || "—"
  );
}

function relativeTime(iso: string, nowMs: number): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const sec = Math.max(0, Math.floor((nowMs - t) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
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

export default async function AssetDetailPage({
  params,
}: {
  params: Promise<{ tag: string }>;
}): Promise<React.ReactElement> {
  const { tag } = await params;

  const [assetResult, eventsResult, reconcileResult, facilitiesResult, financeResult] =
    await Promise.allSettled([
      api.assets.get(tag),
      api.assets.history(tag),
      loadReconcile(),
      api.mock.facilities(),
      api.mock.finance(),
    ]);

  // 404 (or any other failure to load the ops record) → minimal fallback page.
  if (assetResult.status === "rejected") {
    const isUnknown =
      assetResult.reason instanceof ApiError &&
      assetResult.reason.code === "unknown_asset";
    return (
      <div className="space-y-4 max-w-2xl">
        <header>
          <h1 className="text-2xl font-bold font-mono">{tag}</h1>
        </header>
        <div className="rounded-md border bg-amber-50 border-amber-200 p-4 text-sm text-amber-900 space-y-3">
          <div className="font-medium">
            {isUnknown ? "No operations record" : "Couldn't load this asset"}
          </div>
          <p>
            {isUnknown ? (
              <>
                This tag isn&apos;t in operations. It may be a ghost in facilities
                or finance — check the reconciliation report.
              </>
            ) : assetResult.reason instanceof Error ? (
              assetResult.reason.message
            ) : (
              "Unknown error"
            )}
          </p>
          <div className="flex gap-4 pt-1">
            <Link href="/manager" className="text-blue-700 underline">
              ← Back to list
            </Link>
            <Link href="/manager/reconcile" className="text-blue-700 underline">
              Open reconcile report
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const asset = assetResult.value;
  const events =
    eventsResult.status === "fulfilled" ? eventsResult.value : [];
  const report =
    reconcileResult.status === "fulfilled" ? reconcileResult.value : null;
  const facilities =
    facilitiesResult.status === "fulfilled" ? facilitiesResult.value : [];
  const finance =
    financeResult.status === "fulfilled" ? financeResult.value : [];

  const facilitiesRow = facilities.find((f) => f.tagged_id === tag) ?? null;
  const financeRow = finance.find((f) => f.tag === tag) ?? null;
  const finding =
    report?.findings.find((f) => f.asset_tag === tag) ?? null;
  const nowMs = Date.now();

  return (
    <div className="space-y-6 max-w-3xl">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold font-mono">{asset.asset_tag}</h1>
          <p className="text-sm text-gray-700 mt-1">
            {asset.model} · {asset.manufacturer}
          </p>
        </div>
        <Link href="/manager" className="text-sm text-blue-700 hover:underline">
          ← Back to list
        </Link>
      </header>

      <ReconcileBanner finding={finding} reportAvailable={report !== null} />

      <section className="rounded-lg border bg-white p-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
        <div>
          <span className="text-xs uppercase tracking-wide text-gray-500">
            State
          </span>
          <div className="mt-1">
            <StateBadge state={asset.state} />
          </div>
        </div>
        <div>
          <span className="text-xs uppercase tracking-wide text-gray-500">
            Custodian
          </span>
          <div className="mt-1 font-mono">{asset.custodian}</div>
        </div>
        <div className="col-span-2">
          <span className="text-xs uppercase tracking-wide text-gray-500">
            Location
          </span>
          <div className="mt-1 font-mono text-xs">
            {locationToString(asset.location)}
          </div>
        </div>
        <div>
          <span className="text-xs uppercase tracking-wide text-gray-500">
            Serial
          </span>
          <div className="mt-1 font-mono text-xs">{asset.serial}</div>
        </div>
        <div>
          <span className="text-xs uppercase tracking-wide text-gray-500">
            Asset class
          </span>
          <div className="mt-1">{asset.asset_class}</div>
        </div>
        <div>
          <span className="text-xs uppercase tracking-wide text-gray-500">
            Created
          </span>
          <div className="mt-1 text-gray-700" title={asset.created_at}>
            {relativeTime(asset.created_at, nowMs)}
          </div>
        </div>
        <div>
          <span className="text-xs uppercase tracking-wide text-gray-500">
            Updated
          </span>
          <div className="mt-1 text-gray-700" title={asset.updated_at}>
            {relativeTime(asset.updated_at, nowMs)}
          </div>
        </div>
        {asset.procurement_note ? (
          <div className="col-span-2">
            <span className="text-xs uppercase tracking-wide text-gray-500">
              Procurement note
            </span>
            <div className="mt-1 text-sm text-gray-800">
              {asset.procurement_note}
            </div>
          </div>
        ) : null}
      </section>

      <CrossSystemView
        asset={asset}
        facilities={facilitiesRow}
        finance={financeRow}
      />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">
          Event history{" "}
          <span className="text-sm font-normal text-gray-500">
            ({events.length} event{events.length === 1 ? "" : "s"} · newest first)
          </span>
        </h2>
        {events.length === 0 ? (
          <p className="text-sm text-gray-500">No events recorded.</p>
        ) : (
          <ol className="space-y-3">
            {events.map((e) => (
              <li key={e.id}>
                <EventCard event={e} nowMs={nowMs} />
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
