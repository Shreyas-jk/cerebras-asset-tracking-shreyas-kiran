import type { Event, Location } from "@/lib/types";

const EVENT_TYPE_LABEL: Record<Event["event_type"], string> = {
  receive: "receive",
  duplicate_receive: "duplicate receive",
  store: "store",
  deploy: "deploy",
  rma_open: "rma open",
  rma_receive_back: "rma return",
  dispose: "dispose",
  transfer_custody: "transfer",
};

function locationToString(loc: Location | null): string {
  if (!loc) return "—";
  return (
    [loc.site, loc.room, loc.row, loc.rack, loc.ru]
      .filter((v) => v && v.length > 0)
      .join(" / ") || "—"
  );
}

function parseTransferDest(payload: string): string | null {
  try {
    const j = JSON.parse(payload) as { raw?: unknown };
    if (typeof j.raw === "string" && j.raw.length > 0) return j.raw;
  } catch {
    /* payload isn't JSON */
  }
  return null;
}

function prettyPayload(payload: string): string {
  try {
    return JSON.stringify(JSON.parse(payload), null, 2);
  } catch {
    return payload;
  }
}

function headlineFor(event: Event): string {
  const u = event.user_id;
  switch (event.event_type) {
    case "receive":
      return `Received by ${u}.`;
    case "duplicate_receive":
      return `Rescanned by ${u}. State unchanged.`;
    case "store":
      return `Moved to storage by ${u}.`;
    case "deploy":
      return `Deployed by ${u}.`;
    case "rma_open":
      return `RMA opened by ${u}.`;
    case "rma_receive_back":
      return `Returned from RMA by ${u}.`;
    case "dispose":
      return `Disposed by ${u}.`;
    case "transfer_custody": {
      const dest = parseTransferDest(event.scan_payload);
      return dest
        ? `Custody handed from ${u} to ${dest}.`
        : `Custody transferred by ${u} (destination not recorded in the event log).`;
    }
  }
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

export function EventCard({
  event,
  nowMs,
}: {
  event: Event;
  nowMs: number;
}): React.ReactElement {
  const stateChanged = event.from_state !== event.to_state;
  const locationChanged =
    JSON.stringify(event.from_location) !== JSON.stringify(event.to_location);
  return (
    <div className="rounded-md border border-gray-200 bg-white p-3 space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-gray-700" title={event.timestamp}>
          {relativeTime(event.timestamp, nowMs)}
        </span>
        <span className="inline-block px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-700">
          {EVENT_TYPE_LABEL[event.event_type]}
        </span>
      </div>
      <div className="text-sm text-gray-900">{headlineFor(event)}</div>
      {stateChanged ? (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-gray-500">state:</span>
          <span className="font-mono">{event.from_state ?? "—"}</span>
          <span className="text-gray-400">→</span>
          <span className="font-mono">{event.to_state}</span>
        </div>
      ) : null}
      {locationChanged ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-gray-500">location:</span>
          <span className="font-mono">{locationToString(event.from_location)}</span>
          <span className="text-gray-400">→</span>
          <span className="font-mono">{locationToString(event.to_location)}</span>
        </div>
      ) : null}
      <details className="text-xs">
        <summary className="cursor-pointer text-gray-500 hover:text-gray-700">
          Show scan payload
        </summary>
        <pre className="mt-2 p-2 bg-gray-50 rounded overflow-x-auto text-gray-800">
          {prettyPayload(event.scan_payload)}
        </pre>
      </details>
    </div>
  );
}
