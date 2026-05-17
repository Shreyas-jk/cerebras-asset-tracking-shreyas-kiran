import Link from "next/link";

export type FilterName =
  | "all"
  | "needs_attention"
  | "has_drift"
  | "rma_stale"
  | "received_stale"
  | "disposed_this_month";

export const FILTER_NAMES: FilterName[] = [
  "all",
  "needs_attention",
  "has_drift",
  "rma_stale",
  "received_stale",
  "disposed_this_month",
];

const FILTER_LABELS: Record<FilterName, string> = {
  all: "All",
  needs_attention: "Needs attention",
  has_drift: "Has drift",
  rma_stale: "RMA stale",
  received_stale: "Received stale",
  disposed_this_month: "Disposed this month",
};

const FILTER_TOOLTIPS: Partial<Record<FilterName, string>> = {
  has_drift:
    "Assets in operations that have a reconciliation finding (excludes facilities and finance ghosts — see /manager/reconcile).",
  needs_attention:
    "Assets with a reconciliation finding, OR in RMA over 14 days, OR received over 7 days.",
};

export function getFilterTooltip(f: FilterName): string | undefined {
  return FILTER_TOOLTIPS[f];
}

export function isFilterName(value: string | undefined | null): value is FilterName {
  return (FILTER_NAMES as string[]).includes(value ?? "");
}

export function FilterChips({
  active,
  buildUrl,
}: {
  active: FilterName;
  buildUrl: (filter: FilterName) => string;
}): React.ReactElement {
  return (
    <div className="flex flex-wrap gap-2">
      {FILTER_NAMES.map((f) => {
        const isActive = f === active;
        const tooltip = FILTER_TOOLTIPS[f];
        return (
          <Link
            key={f}
            href={buildUrl(f)}
            title={tooltip}
            className={`text-sm px-3 py-1.5 rounded-full border ${
              isActive
                ? "bg-blue-700 text-white border-blue-700"
                : "bg-white text-gray-800 border-gray-300 hover:bg-gray-50"
            }`}
          >
            {FILTER_LABELS[f]}
          </Link>
        );
      })}
    </div>
  );
}
