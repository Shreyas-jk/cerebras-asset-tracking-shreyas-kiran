"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ScanInput } from "@/components/ScanInput";
import { api, ApiError } from "@/lib/api-client";
import { getCurrentUserId } from "@/lib/auth";
import type { Asset } from "@/lib/types";

const TAG_REGEX = /^C\d{7}$/;

function buildScanPayload(raw: string): string {
  return JSON.stringify({
    raw,
    ts: new Date().toISOString(),
    screen: "transfer",
  });
}

type Mode =
  | { kind: "tag_scan"; lastError: string | null; lookingUp: string | null }
  | { kind: "unknown_asset"; tag: string }
  | { kind: "blocked"; asset: Asset }
  | { kind: "badge_scan"; asset: Asset; submitting: boolean; lastError: string | null }
  | {
      kind: "success";
      asset: Asset;
      fromCustodian: string;
      toCustodian: string;
    };

export default function TechTransferPage(): React.ReactElement {
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
      if (asset.state === "disposed" || asset.state === "unreceived") {
        setMode({ kind: "blocked", asset });
      } else {
        setMode({ kind: "badge_scan", asset, submitting: false, lastError: null });
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

  async function handleBadgeScan(raw: string, asset: Asset): Promise<void> {
    const badge = raw.trim();
    if (!badge) {
      setMode({
        kind: "badge_scan",
        asset,
        submitting: false,
        lastError: "Scan or type a badge.",
      });
      return;
    }
    if (badge === asset.custodian) {
      setMode({
        kind: "badge_scan",
        asset,
        submitting: false,
        lastError: `${badge} already holds this. Scan a different badge.`,
      });
      return;
    }
    setMode({ kind: "badge_scan", asset, submitting: true, lastError: null });
    try {
      const updated = await api.scans.transfer({
        asset_tag: asset.asset_tag,
        to_custodian: badge,
        user_id: getCurrentUserId(),
        scan_payload: buildScanPayload(raw),
      });
      setMode({
        kind: "success",
        asset: updated,
        fromCustodian: asset.custodian,
        toCustodian: updated.custodian,
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === "same_custodian") {
        setMode({
          kind: "badge_scan",
          asset,
          submitting: false,
          lastError: `${badge} already holds this. Scan a different badge.`,
        });
        return;
      }
      if (err instanceof ApiError && err.code === "invalid_transition") {
        setMode({
          kind: "badge_scan",
          asset,
          submitting: false,
          lastError: `State changed while you were scanning — ${asset.asset_tag} is no longer eligible to transfer. Start over to see the current state.`,
        });
        return;
      }
      setMode({
        kind: "badge_scan",
        asset,
        submitting: false,
        lastError:
          err instanceof ApiError
            ? `${err.code}: ${err.message}`
            : "Couldn't reach the system. Your scan wasn't saved. Try again.",
      });
    }
  }

  return (
    <div className="space-y-6 max-w-xl">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">Transfer custody</h1>
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

      {mode.kind === "badge_scan" ? (
        <BadgeScanStep
          asset={mode.asset}
          submitting={mode.submitting}
          lastError={mode.lastError}
          onScan={(raw) => handleBadgeScan(raw, mode.asset)}
        />
      ) : null}

      {mode.kind === "success" ? (
        <SuccessPanel
          asset={mode.asset}
          fromCustodian={mode.fromCustodian}
          toCustodian={mode.toCustodian}
          onContinue={reset}
        />
      ) : null}
    </div>
  );
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
            Hand off custody to another tech, a vendor, or a storage container.
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
  let title: string;
  let body: string;
  switch (asset.state) {
    case "disposed":
      title = "Disposed";
      body = `${tag} has been disposed. Custody can't be transferred.`;
      break;
    case "unreceived":
      title = "Not yet received";
      body = `${tag} exists in the system but hasn't been received yet. Receive it first.`;
      break;
    default:
      title = "Can't be transferred from this state";
      body = `${tag} is in state ${asset.state}. Transfer is rejected for disposed and unreceived assets.`;
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

function BadgeScanStep({
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
  return (
    <div className="space-y-4">
      <div className="rounded-lg border-2 border-blue-200 bg-blue-50 p-4 space-y-1">
        <div className="text-xs uppercase tracking-wide text-gray-600">Handing off</div>
        <div className="font-mono text-lg">{asset.asset_tag}</div>
        <div className="text-sm text-gray-800">
          {asset.model} · {asset.manufacturer}
        </div>
        <div className="text-sm text-gray-800">
          State: <span className="font-medium">{asset.state}</span>
        </div>
        <div className="text-sm text-gray-800">
          Currently held by <span className="font-mono">{asset.custodian}</span>
        </div>
      </div>

      <p className="text-sm text-gray-700">
        Scan the receiving party&apos;s badge.
      </p>

      <ScanInput
        label="Receiving badge"
        placeholder="Scan a badge and press Enter"
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
            State won&apos;t change — only custody.
          </span>
        )}
      </div>
    </div>
  );
}

function SuccessPanel({
  asset,
  fromCustodian,
  toCustodian,
  onContinue,
}: {
  asset: Asset;
  fromCustodian: string;
  toCustodian: string;
  onContinue: () => void;
}): React.ReactElement {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border-2 border-emerald-300 bg-emerald-50 p-4 space-y-1">
        <div className="text-xs uppercase tracking-wide text-gray-600">Handoff recorded</div>
        <div className="font-mono text-lg">{asset.asset_tag}</div>
        <div className="text-sm text-gray-800">
          {asset.model} · {asset.manufacturer}
        </div>
        <div className="text-sm text-gray-900 pt-1">
          <span className="font-mono">{fromCustodian}</span>
          <span className="mx-2 text-gray-500">→</span>
          <span className="font-mono">{toCustodian}</span>
        </div>
        <div className="text-sm text-gray-600">
          State unchanged ({asset.state}).
        </div>
      </div>

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
