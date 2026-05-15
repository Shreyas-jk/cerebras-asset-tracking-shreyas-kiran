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
    screen: "deploy",
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

function missingDeployFields(loc: Location): string[] {
  const missing: string[] = [];
  if (!loc.site) missing.push("site");
  if (!loc.room) missing.push("room");
  if (!loc.rack) missing.push("rack");
  if (!loc.ru) missing.push("RU");
  return missing;
}

type DeployApiResult = {
  asset: Asset;
  facilities: "set" | "failed";
  finance: "capitalized" | "failed";
  facilities_error?: { code: string; message: string; status?: number };
  finance_error?: { code: string; message: string; status?: number };
};

type Mode =
  | { kind: "tag_scan"; lastError: string | null; lookingUp: string | null }
  | { kind: "unknown_asset"; tag: string }
  | { kind: "blocked"; asset: Asset }
  | { kind: "location_scan"; asset: Asset; submitting: boolean; lastError: string | null }
  | { kind: "success"; result: DeployApiResult };

export default function TechDeployPage(): React.ReactElement {
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
      if (asset.state === "received" || asset.state === "stored") {
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
          "Location must start with a site, like Lab-Building-A/Bay-12/Aisle-3/B-04/P-02.",
      });
      return;
    }
    const missing = missingDeployFields(location);
    if (missing.length > 0) {
      setMode({
        kind: "location_scan",
        asset,
        submitting: false,
        lastError: `Deploy needs site, room, rack, and RU. Missing: ${missing.join(", ")}.`,
      });
      return;
    }
    setMode({ kind: "location_scan", asset, submitting: true, lastError: null });
    try {
      const res = await fetch("/api/scans/deploy", {
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
          lastError: humaniseDeployError(code, message, asset),
        });
        return;
      }
      setMode({ kind: "success", result: json as DeployApiResult });
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
        <h1 className="text-2xl font-bold">Deploy</h1>
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

      {mode.kind === "blocked" ? <BlockedPanel asset={mode.asset} /> : null}

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

function humaniseDeployError(code: string, message: string, asset: Asset): string {
  if (code === "incomplete_deploy_location") {
    return `Deploy needs site, room, rack, and RU. ${message}`;
  }
  if (code === "invalid_transition") {
    return `State changed while you were scanning — ${asset.asset_tag} is no longer eligible to deploy. Start over to see the current state.`;
  }
  if (code === "invalid_location") {
    return "Location wasn't accepted by the server.";
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
            Put an asset into service. Allowed from received or stored.
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
  let body: React.ReactNode;
  switch (asset.state) {
    case "in_service":
      title = "Already in service";
      body = (
        <>
          <p>
            {tag} is already in service at {locStr || "—"}. To move it to a different rack:
            first store it (taking it out of service), then deploy it from storage.
          </p>
        </>
      );
      break;
    case "rma_pending":
      title = "In RMA";
      body = (
        <p>
          {tag} is in RMA. It has to be returned through the RMA flow before it can be deployed.
          Talk to a manager.
        </p>
      );
      break;
    case "disposed":
      title = "Disposed";
      body = <p>{tag} has been disposed. It can&apos;t be put into service.</p>;
      break;
    default:
      title = "Can't be deployed from this state";
      body = (
        <p>
          {tag} is in state {asset.state}. The deploy flow accepts assets in &apos;received&apos; or
          &apos;stored&apos;.
        </p>
      );
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
      <div className="text-sm text-gray-900 pt-1">{body}</div>
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
  const fromReceived = asset.state === "received";
  const currentLocStr = locationToString(asset.location) || "—";
  return (
    <div className="space-y-4">
      <div
        className={`rounded-lg border-2 p-4 space-y-1 ${
          fromReceived
            ? "border-emerald-300 bg-emerald-50"
            : "border-blue-200 bg-blue-50"
        }`}
      >
        <div className="text-xs uppercase tracking-wide text-gray-600">
          {fromReceived ? "First deployment" : "From storage to service"}
        </div>
        <div className="font-mono text-lg">{asset.asset_tag}</div>
        <div className="text-sm text-gray-800">
          {asset.model} · {asset.manufacturer}
        </div>
        <div className="text-sm text-gray-800">
          Currently at <span className="font-medium">{currentLocStr}</span>
        </div>
        <div className="text-sm text-gray-800">
          Custodian: <span className="font-mono">{asset.custodian}</span>
        </div>
      </div>

      <p className="text-sm text-gray-700">
        {fromReceived
          ? `${asset.asset_tag} is being put into service for the first time. Facilities will get a rack row; finance will capitalize it.`
          : `${asset.asset_tag} will move from storage into service.`}
      </p>

      <ScanInput
        label="Rack location"
        placeholder="Scan or type Site/Room/Row/Rack/RU and press Enter"
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
            Format: <code>Site/Room/Row/Rack/RU</code>. Row may be blank; the other four are required.
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
  result: DeployApiResult;
  onContinue: () => void;
}): React.ReactElement {
  const { asset } = result;
  const locStr = locationToString(asset.location) || "—";
  const facFailed = result.facilities === "failed";
  const finFailed = result.finance === "failed";
  return (
    <div className="space-y-4">
      <div className="rounded-lg border-2 border-emerald-300 bg-emerald-50 p-4 space-y-1">
        <div className="text-xs uppercase tracking-wide text-gray-600">In service</div>
        <div className="font-mono text-lg">{asset.asset_tag}</div>
        <div className="text-sm text-gray-800">
          {asset.model} · {asset.manufacturer}
        </div>
        <div className="text-sm text-gray-800">
          Now racked at <span className="font-medium">{locStr}</span>
        </div>
      </div>

      {!facFailed && !finFailed ? (
        <p className="text-sm text-gray-700">
          Operations, facilities, and finance are in sync.
        </p>
      ) : null}

      {facFailed ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 space-y-1">
          <div className="font-medium">Facilities didn&apos;t sync.</div>
          <div>
            Operations is correct. The rack row in facilities was not updated
            {result.facilities_error ? ` (${result.facilities_error.code})` : ""}.
            The manager will see this on the reconcile report.
          </div>
        </div>
      ) : null}

      {finFailed ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 space-y-1">
          <div className="font-medium">Finance didn&apos;t sync.</div>
          <div>
            Operations is correct. Capitalization status was not updated in finance
            {result.finance_error ? ` (${result.finance_error.code})` : ""}.
            The manager will see this on the reconcile report.
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
