import Link from "next/link";
import type { Asset } from "@/lib/types";

export type SortColumn = "tag" | "model" | "state" | "custodian" | "location" | "updated";

export const SORT_COLUMNS: SortColumn[] = [
  "tag",
  "model",
  "state",
  "custodian",
  "location",
  "updated",
];

export function isSortColumn(value: string | undefined | null): value is SortColumn {
  return (SORT_COLUMNS as string[]).includes(value ?? "");
}

const STATE_BADGE: Record<Asset["state"], string> = {
  in_service: "bg-emerald-100 text-emerald-800",
  stored: "bg-blue-100 text-blue-800",
  received: "bg-amber-100 text-amber-800",
  rma_pending: "bg-orange-100 text-orange-800",
  disposed: "bg-gray-200 text-gray-700",
  unreceived: "bg-gray-100 text-gray-600",
};

function shortLocation(loc: Asset["location"]): string {
  return [loc.site, loc.room, loc.row, loc.rack, loc.ru]
    .filter((v) => v && v.length > 0)
    .join(" / ");
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

function SortableHeader({
  column,
  label,
  currentSort,
  currentDir,
  buildSortUrl,
  className,
}: {
  column: SortColumn;
  label: string;
  currentSort: SortColumn;
  currentDir: "asc" | "desc";
  buildSortUrl: (col: SortColumn) => string;
  className?: string;
}): React.ReactElement {
  const isActive = currentSort === column;
  const arrow = isActive ? (currentDir === "asc" ? "↑" : "↓") : "";
  return (
    <th
      className={`text-left text-xs font-semibold uppercase tracking-wide text-gray-600 px-3 py-2 ${className ?? ""}`}
    >
      <Link
        href={buildSortUrl(column)}
        className={`inline-flex items-center gap-1 hover:text-gray-900 ${isActive ? "text-gray-900" : ""}`}
      >
        {label}
        {arrow ? <span aria-hidden="true">{arrow}</span> : null}
      </Link>
    </th>
  );
}

export function AssetTable({
  rows,
  totalFiltered,
  firstRowNumber,
  page,
  totalPages,
  sort,
  dir,
  buildSortUrl,
  buildPageUrl,
  buildClearUrl,
  nowMs,
}: {
  rows: Asset[];
  totalFiltered: number;
  firstRowNumber: number;
  page: number;
  totalPages: number;
  sort: SortColumn;
  dir: "asc" | "desc";
  buildSortUrl: (col: SortColumn) => string;
  buildPageUrl: (page: number) => string;
  buildClearUrl: () => string;
  nowMs: number;
}): React.ReactElement {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border bg-white p-6 text-sm text-gray-700">
        No assets match this filter.{" "}
        <Link href={buildClearUrl()} className="text-blue-700 underline">
          Show all
        </Link>
      </div>
    );
  }

  const start = firstRowNumber;
  const end = start + rows.length - 1;

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-md border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <SortableHeader
                column="tag"
                label="Tag"
                currentSort={sort}
                currentDir={dir}
                buildSortUrl={buildSortUrl}
              />
              <SortableHeader
                column="model"
                label="Model"
                currentSort={sort}
                currentDir={dir}
                buildSortUrl={buildSortUrl}
              />
              <SortableHeader
                column="state"
                label="State"
                currentSort={sort}
                currentDir={dir}
                buildSortUrl={buildSortUrl}
              />
              <SortableHeader
                column="custodian"
                label="Custodian"
                currentSort={sort}
                currentDir={dir}
                buildSortUrl={buildSortUrl}
              />
              <SortableHeader
                column="location"
                label="Location"
                currentSort={sort}
                currentDir={dir}
                buildSortUrl={buildSortUrl}
              />
              <SortableHeader
                column="updated"
                label="Updated"
                currentSort={sort}
                currentDir={dir}
                buildSortUrl={buildSortUrl}
              />
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => {
              const href = `/manager/assets/${a.asset_tag}`;
              const cellCls = "px-3 py-2 align-top";
              return (
                <tr
                  key={a.asset_tag}
                  className="border-b last:border-0 hover:bg-blue-50"
                >
                  <td className={cellCls}>
                    <Link
                      href={href}
                      className="block font-mono text-blue-700 underline underline-offset-2"
                    >
                      {a.asset_tag}
                    </Link>
                  </td>
                  <td className={cellCls}>
                    <Link href={href} className="block text-gray-900">
                      {a.model}
                      <span className="block text-xs text-gray-500">
                        {a.manufacturer}
                      </span>
                    </Link>
                  </td>
                  <td className={cellCls}>
                    <Link href={href} className="block">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs ${STATE_BADGE[a.state]}`}
                      >
                        {a.state}
                      </span>
                    </Link>
                  </td>
                  <td className={cellCls}>
                    <Link
                      href={href}
                      className="block font-mono text-xs text-gray-800"
                    >
                      {a.custodian}
                    </Link>
                  </td>
                  <td className={cellCls}>
                    <Link
                      href={href}
                      className="block text-xs text-gray-700"
                    >
                      {shortLocation(a.location) || "—"}
                    </Link>
                  </td>
                  <td className={cellCls}>
                    <Link
                      href={href}
                      className="block text-xs text-gray-600"
                      title={a.updated_at}
                    >
                      {relativeTime(a.updated_at, nowMs)}
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-gray-700">
        <div>
          Showing {start.toLocaleString("en-US")}–{end.toLocaleString("en-US")} of{" "}
          {totalFiltered.toLocaleString("en-US")} · Page {page} of {totalPages}
        </div>
        <div className="flex gap-2">
          {page > 1 ? (
            <Link
              href={buildPageUrl(page - 1)}
              className="px-3 py-1.5 rounded-md border border-gray-300 hover:bg-gray-50"
            >
              ← Prev
            </Link>
          ) : (
            <span className="px-3 py-1.5 rounded-md border border-gray-200 text-gray-400">
              ← Prev
            </span>
          )}
          {page < totalPages ? (
            <Link
              href={buildPageUrl(page + 1)}
              className="px-3 py-1.5 rounded-md border border-gray-300 hover:bg-gray-50"
            >
              Next →
            </Link>
          ) : (
            <span className="px-3 py-1.5 rounded-md border border-gray-200 text-gray-400">
              Next →
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
