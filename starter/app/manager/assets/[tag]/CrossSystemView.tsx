import type {
  Asset,
  FacilitiesRecord,
  FinanceRecord,
  Location,
} from "@/lib/types";

function locationToString(loc: Location): string {
  return (
    [loc.site, loc.room, loc.row, loc.rack, loc.ru]
      .filter((v) => v && v.length > 0)
      .join(" / ") || "—"
  );
}

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function Row({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-x-3 text-sm py-1">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-900">{value}</span>
    </div>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="rounded-md border bg-white p-3">
      <h3 className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-2">
        {title}
      </h3>
      <div className="space-y-0">{children}</div>
    </div>
  );
}

export function CrossSystemView({
  asset,
  facilities,
  finance,
}: {
  asset: Asset;
  facilities: FacilitiesRecord | null;
  finance: FinanceRecord | null;
}): React.ReactElement {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Cross-system view</h2>
      <div className="space-y-3">
        <Card title="Operations">
          <Row label="state" value={<span className="font-mono">{asset.state}</span>} />
          <Row
            label="location"
            value={
              <span className="font-mono text-xs">
                {locationToString(asset.location)}
              </span>
            }
          />
          <Row
            label="custodian"
            value={<span className="font-mono text-xs">{asset.custodian}</span>}
          />
        </Card>

        <Card title="Facilities">
          {facilities ? (
            <>
              <Row
                label="rack_location"
                value={
                  <span className="font-mono text-xs">
                    {facilities.rack_location}
                  </span>
                }
              />
              <Row
                label="last_observed"
                value={
                  <span className="text-xs">
                    {facilities.last_observed.slice(0, 10)}
                  </span>
                }
              />
            </>
          ) : (
            <p className="text-sm text-gray-500 italic">No record.</p>
          )}
        </Card>

        <Card title="Finance">
          {finance ? (
            <>
              <Row
                label="status"
                value={<span className="font-mono">{finance.status}</span>}
              />
              <Row
                label="site"
                value={<span className="text-xs">{finance.site || "—"}</span>}
              />
              <Row label="book value" value={USD.format(finance.book_value_usd)} />
              <Row
                label="capitalized_on"
                value={
                  <span className="text-xs">{finance.capitalized_on || "—"}</span>
                }
              />
            </>
          ) : (
            <p className="text-sm text-gray-500 italic">No record.</p>
          )}
        </Card>
      </div>
    </section>
  );
}
