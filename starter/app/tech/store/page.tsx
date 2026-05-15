"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ScanInput } from "@/components/ScanInput";
import { api, ApiError } from "@/lib/api-client";
import { getCurrentUserId } from "@/lib/auth";
import type { Asset, Location } from "@/lib/types";

const TAG_REGEX = /^C\d{7}$/;

function buildScanPayload(raw: string): string {
  return JSON.stringify({
    raw,
    ts: new Date().toISOString(),
    screen: "store",
  });
}

function locationToString(loc: Location): string {
  return [loc.site, loc.room, loc.row, loc.rack, loc.ru]
    .filter((v) => v && v.length > 0)
    .join(" / ");
}

function parseLocationScan(scan: string): Location | null {
  const trimmed = scan.trim();
  if (!trimmed) return null;
  const parts = trimmed.split("/").map((p) => p.trim());
  if (parts.length === 0 || !parts[0]) return null;
  return {
    site: parts[0],
    room: parts[1] && parts[1].length ? parts[1] : null,
    row: parts[2] && parts[2].length ? parts[2] : null,
    rack: parts[3] && parts[3].length ? parts[3] : null,
    ru: parts[4] && parts[4].length ? parts[4] : null,
  };
}

type StoreApiResult = {
  asset: Asset;
} & (
  | { facilities: "skipped" }
  | { facilities: "cleared" }
  | { facilities: "failed"; facilities_error: { code: string; message: string; status?: number } }
);

type Mode =
  | { kind: "tag_scan"; lastError: string | null; lookingUp: string | null }
  | { kind: "unknown_asset"; tag: string }
  | { kind: "blocked"; asset: Asset }
  | { kind: "location_scan"; asset: Asset; submitting: boolean; lastError: string | null }
  | { kind: "success"; result: StoreApiResult };

export default function TechStorePage(): React.ReactElement {
  const [mode, setMode] = useState<Mode>({
    kind: "tag_scan",
    lastError: null,
    lookingUp: null,
  });

  const reset = useCallback(() => {
    setMode({ kind: "tag_scan", lastError: null, lookingUp: null });
  }, []);

  useEffect(() => {
    if (mode.kind !== "success") return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        reset();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode.kind, reset]);

  async function handleTagScan(raw: string): Promise<void> {
    const tag = raw.trim().toUpperCase();
    if (!TAG_REGEX.test(tag)) {
      setMode({
        kind: "tag_scan",
        lastError: `Tag should look like C0000101 — letter C, then seven digits. You scanned "${raw}".`,
        lookingUp: null,
      });
      return;
    }
    setMode({ kind: "tag_scan", lastError: null, lookingUp: tag });
    try {
      const asset = await api.assets.get(tag);
      if (asset.state === "received" || asset.state === "in_service") {
        setMode({ kind: "location_scan", asset, submitting: false, lastError: null });
      } else {
        setMode({ kind: "blocked", asset });
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === "unknown_asset") {
        setMode({ kind: "unknown_asset", tag });
        return;
      }
      setMode({
        kind: "tag_scan",
        lastError:
          err instanceof ApiError
            ? `${err.code}: ${err.message}`
            : "Couldn't reach the system. Check the connection and try again.",
        lookingUp: null,
      });
    }
  }

  async function handleLocationScan(raw: string, asset: Asset): Promise<void> {
    const location = parseLocationScan(raw);
    if (!location) {
      setMode({
        kind: "location_scan",
        asset,
        submitting: false,
        lastError:
          "Location must start with a site, like Lab-Building-A or Lab-Building-A/Storage-1/SHELF-3.",
      });
      return;
    }
    setMode({ kind: "location_scan", asset, submitting: true, lastError: null });
    try {
      const res = await fetch("/api/scans/store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asset_tag: asset.asset_tag,
          location,
          user_id: getCurrentUserId(),
          scan_payload: buildScanPayload(raw),
        }),
      });
      const json: unknown = await res.json();
      if (!res.ok) {
        const errBody = json as { error?: { code?: string; message?: string } };
        const code = errBody.error?.code ?? "unknown_error";
        const message = errBody.error?.message ?? `HTTP ${res.status}`;
        setMode({
          kind: "location_scan",
          asset,
          submitting: false,
          lastError: humaniseStoreError(code, message, asset),
        });
        return;
      }
      setMode({ kind: "success", result: json as StoreApiResult });
    } catch {
      setMode({
        kind: "location_scan",
        asset,
        submitting: false,
        lastError: "Couldn't reach the system. Your scan wasn't saved. Try again.",
      });
    }
  }

  return (
    <div className="space-y-6 max-w-xl">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">Store</h1>
        {mode.kind !== "tag_scan" ? (
          <button
            type="button"
            onClick={reset}
            className="text-sm text-gray-600 hover:text-gray-900 underline underline-offset-2 min-h-[44px]"
          >
            Start over
          </button>
        ) : null}
      </header>

      {mode.kind === "tag_scan" ? (
        <TagScanStep
          lastError={mode.lastError}
          lookingUp={mode.lookingUp}
          onScan={handleTagScan}
        />
      ) : null}

      {mode.kind === "unknown_asset" ? (
        <UnknownAssetPanel tag={mode.tag} />
      ) : null}

      {mode.kind === "blocked" ? (
        <BlockedPanel asset={mode.asset} />
      ) : null}

      {mode.kind === "location_scan" ? (
        <LocationScanStep
          asset={mode.asset}
          submitting={mode.submitting}
          lastError={mode.lastError}
          onScan={(raw) => handleLocationScan(raw, mode.asset)}
        />
      ) : null}

      {mode.kind === "success" ? (
        <SuccessPanel result={mode.result} onContinue={reset} />
      ) : null}
    </div>
  );
}

function humaniseStoreError(code: string, message: string, asset: Asset): string {
  if (code === "invalid_transition") {
    return `State changed while you were scanning — ${asset.asset_tag} is now ${(asset.state || "").replace("_", " ")} or another state. Start over to pick up the new state.`;
  }
  if (code === "invalid_location") {
    return "Location wasn't accepted. Site is required at minimum.";
  }
  return `${code}: ${message}`;
}

function TagScanStep({
  lastError,
  lookingUp,
  onScan,
}: {
  lastError: string | null;
  lookingUp: string | null;
  onScan: (value: string) => void | Promise<void>;
}): React.ReactElement {
  return (
    <div className="space-y-3">
      <ScanInput
        label="Asset tag"
        placeholder="Scan or type an asset tag and press Enter"
        onScan={onScan}
        disabled={lookingUp !== null}
      />
      <div className="min-h-[1.5rem] text-sm" aria-live="polite">
        {lookingUp ? (
          <span className="text-gray-600">Looking up {lookingUp}…</span>
        ) : null}
        {!lookingUp && lastError ? (
          <span className="text-red-700">{lastError}</span>
        ) : null}
        {!lookingUp && !lastError ? (
          <span className="text-gray-500">
            Move an asset to storage, or take one out of service.
          </span>
        ) : null}
      </div>
    </div>
  );
}

function UnknownAssetPanel({ tag }: { tag: string }): React.ReactElement {
  return (
    <div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-4 space-y-3">
      <div className="font-semibold text-amber-900">Not in the system yet</div>
      <p className="text-sm text-amber-900">
        <span className="font-mono">{tag}</span> hasn&apos;t been received. Receive it first, then come back here.
      </p>
      <Link
        href={`/tech/receive?prefill=${encodeURIComponent(tag)}`}
        className="inline-block bg-blue-700 text-white px-4 py-3 rounded-md font-medium min-h-[44px]"
      >
        Go to Receive →
      </Link>
    </div>
  );
}

function BlockedPanel({ asset }: { asset: Asset }): React.ReactElement {
  const tag = asset.asset_tag;
  const locStr = locationToString(asset.location);
  let title: string;
  let body: string;
  switch (asset.state) {
    case "stored":
      title = "Already stored";
      body = `${tag} is currently stored at ${locStr || "—"}. No change made.`;
      break;
    case "rma_pending":
      title = "In RMA";
      body = `${tag} is in RMA. Storing it would skip that step — talk to a manager.`;
      break;
    case "disposed":
      title = "Disposed";
      body = `${tag} has been disposed. It can't be stored.`;
      break;
    default:
      title = "Can't be stored from this state";
      body = `${tag} is in state ${asset.state}. The store flow accepts assets in 'received' or 'in_service'.`;
  }
  return (
    <div className="rounded-lg border-2 border-gray-300 bg-gray-50 p-4 space-y-2">
      <div className="text-xs uppercase tracking-wide text-gray-500">{title}</div>
      <div className="font-mono text-lg">{tag}</div>
      <div className="text-sm text-gray-800">
        Model: {asset.model} · {asset.manufacturer}
      </div>
      <div className="text-sm text-gray-800">
        Custodian: <span className="font-mono">{asset.custodian}</span>
      </div>
      <p className="text-sm text-gray-900 pt-1">{body}</p>
    </div>
  );
}

function LocationScanStep({
  asset,
  submitting,
  lastError,
  onScan,
}: {
  asset: Asset;
  submitting: boolean;
  lastError: string | null;
  onScan: (value: string) => void | Promise<void>;
}): React.ReactElement {
  const fromInService = asset.state === "in_service";
  const currentLocStr = locationToString(asset.location) || "—";
  return (
    <div className="space-y-4">
      <div
        className={`rounded-lg border-2 p-4 space-y-1 ${
          fromInService
            ? "border-amber-300 bg-amber-50"
            : "border-blue-200 bg-blue-50"
        }`}
      >
        <div className="text-xs uppercase tracking-wide text-gray-600">
          {fromInService ? "In service" : "Just received"}
        </div>
        <div className="font-mono text-lg">{asset.asset_tag}</div>
        <div className="text-sm text-gray-800">
          {asset.model} · {asset.manufacturer}
        </div>
        <div className="text-sm text-gray-800">
          At <span className="font-medium">{currentLocStr}</span>
        </div>
        <div className="text-sm text-gray-800">
          Custodian: <span className="font-mono">{asset.custodian}</span>
        </div>
      </div>

      <p className="text-sm text-gray-700">
        {fromInService
          ? `${asset.asset_tag} is currently in service at ${currentLocStr}. Scanning a storage location will move it to storage.`
          : `${asset.asset_tag} just arrived. Scan a storage location to put it on a shelf.`}
      </p>

      <ScanInput
        label="Storage location"
        placeholder="Scan or type Site/Room/.../Rack and press Enter"
        onScan={onScan}
        disabled={submitting}
      />
      <div className="min-h-[1.5rem] text-sm" aria-live="polite">
        {submitting ? (
          <span className="text-gray-600">Submitting…</span>
        ) : lastError ? (
          <span className="text-red-700">{lastError}</span>
        ) : (
          <span className="text-gray-500">
            Format: <code>Site/Room/Row/Rack/RU</code>. Site alone is enough; leave the rest blank for shelf storage.
          </span>
        )}
      </div>
    </div>
  );
}

function SuccessPanel({
  result,
  onContinue,
}: {
  result: StoreApiResult;
  onContinue: () => void;
}): React.ReactElement {
  const { asset } = result;
  const locStr = locationToString(asset.location) || "—";
  const partial = result.facilities === "failed";
  return (
    <div className="space-y-4">
      <div className="rounded-lg border-2 border-emerald-300 bg-emerald-50 p-4 space-y-1">
        <div className="text-xs uppercase tracking-wide text-gray-600">Stored</div>
        <div className="font-mono text-lg">{asset.asset_tag}</div>
        <div className="text-sm text-gray-800">
          {asset.model} · {asset.manufacturer}
        </div>
        <div className="text-sm text-gray-800">
          Now at <span className="font-medium">{locStr}</span>
        </div>
      </div>

      {result.facilities === "cleared" ? (
        <p className="text-sm text-gray-700">
          De-racked. Facilities updated — the rack row is removed.
        </p>
      ) : null}
      {result.facilities === "skipped" ? (
        <p className="text-sm text-gray-700">Recorded the storage scan.</p>
      ) : null}
      {partial ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 space-y-1">
          <div className="font-medium">
            Operations updated, but facilities didn&apos;t sync.
          </div>
          <div>
            The asset is correctly stored in operations. The facilities row was not
            cleared ({result.facilities_error.code}). The manager will see this on the
            reconcile report.
          </div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={onContinue}
        autoFocus
        className="w-full bg-blue-700 text-white px-4 py-3 rounded-md font-medium min-h-[44px]"
      >
        Scan next (Enter)
      </button>
    </div>
  );
}
