"use client";

import { useCallback, useEffect, useState } from "react";
import { ScanInput } from "@/components/ScanInput";
import { api, ApiError } from "@/lib/api-client";
import { getCurrentUserId } from "@/lib/auth";
import type { Asset, AssetClass, Location } from "@/lib/types";

const TAG_REGEX = /^C\d{7}$/;

const ASSET_CLASSES: AssetClass[] = [
  "instrument",
  "compute",
  "network",
  "power",
  "consumable_durable",
];

const DEFAULT_RECEIVE_LOCATION: Location = {
  site: "Lab-Building-A",
  room: "Receiving",
  row: null,
  rack: "DOCK-1",
  ru: null,
};

function buildScanPayload(raw: string): string {
  return JSON.stringify({
    raw,
    ts: new Date().toISOString(),
    screen: "receive",
  });
}

function locationToString(loc: Location): string {
  return [loc.site, loc.room, loc.row, loc.rack, loc.ru]
    .filter((v) => v && v.length > 0)
    .join(" / ");
}

type Mode =
  | { kind: "tag_scan"; lastError: string | null; lookingUp: string | null }
  | { kind: "new_asset_form"; tag: string }
  | { kind: "confirm_duplicate"; asset: Asset; submitting: boolean; lastError: string | null }
  | {
      kind: "serial_mismatch";
      tag: string;
      onFile: Asset;
      providedSerial: string;
    }
  | { kind: "success_new"; asset: Asset }
  | { kind: "success_duplicate"; asset: Asset };

export default function TechReceivePage(): React.ReactElement {
  const [mode, setMode] = useState<Mode>({
    kind: "tag_scan",
    lastError: null,
    lookingUp: null,
  });

  const reset = useCallback(() => {
    setMode({ kind: "tag_scan", lastError: null, lookingUp: null });
  }, []);

  // Enter from a success banner returns to TAG_SCAN. Hooks here, not on the
  // input, because the scan input is unmounted in the success state.
  useEffect(() => {
    if (mode.kind !== "success_new" && mode.kind !== "success_duplicate") {
      return;
    }
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
      setMode({ kind: "confirm_duplicate", asset, submitting: false, lastError: null });
    } catch (err) {
      if (err instanceof ApiError && err.code === "unknown_asset") {
        setMode({ kind: "new_asset_form", tag });
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

  return (
    <div className="space-y-6 max-w-xl">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">Receive</h1>
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

      {mode.kind === "new_asset_form" ? (
        <NewAssetForm
          tag={mode.tag}
          onCancel={reset}
          onCreated={(asset) => setMode({ kind: "success_new", asset })}
        />
      ) : null}

      {mode.kind === "confirm_duplicate" ? (
        <ConfirmDuplicate
          asset={mode.asset}
          submitting={mode.submitting}
          lastError={mode.lastError}
          onIdempotent={(asset) => setMode({ kind: "success_duplicate", asset })}
          onMismatch={(providedSerial) =>
            setMode({
              kind: "serial_mismatch",
              tag: mode.asset.asset_tag,
              onFile: mode.asset,
              providedSerial,
            })
          }
          onError={(message) =>
            setMode({
              kind: "confirm_duplicate",
              asset: mode.asset,
              submitting: false,
              lastError: message,
            })
          }
          onSubmittingChange={(submitting) =>
            setMode({
              kind: "confirm_duplicate",
              asset: mode.asset,
              submitting,
              lastError: null,
            })
          }
        />
      ) : null}

      {mode.kind === "serial_mismatch" ? (
        <SerialMismatchPanel
          tag={mode.tag}
          onFile={mode.onFile}
          providedSerial={mode.providedSerial}
          onRescanSerial={() =>
            setMode({
              kind: "confirm_duplicate",
              asset: mode.onFile,
              submitting: false,
              lastError: null,
            })
          }
          onRescanTag={reset}
        />
      ) : null}

      {mode.kind === "success_new" ? (
        <SuccessBanner
          asset={mode.asset}
          kind="new"
          onContinue={reset}
        />
      ) : null}

      {mode.kind === "success_duplicate" ? (
        <SuccessBanner
          asset={mode.asset}
          kind="duplicate"
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
            Tags look like <code className="text-gray-700">C0000101</code>.
          </span>
        ) : null}
      </div>
    </div>
  );
}

function NewAssetForm({
  tag,
  onCancel,
  onCreated,
}: {
  tag: string;
  onCancel: () => void;
  onCreated: (asset: Asset) => void;
}): React.ReactElement {
  const [serial, setSerial] = useState("");
  const [model, setModel] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [assetClass, setAssetClass] = useState<AssetClass>("instrument");
  const [location, setLocation] = useState<Location>(DEFAULT_RECEIVE_LOCATION);
  const [locationEditing, setLocationEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function validate(): Record<string, string> {
    const errs: Record<string, string> = {};
    if (!serial.trim()) errs.serial = "Serial number is required.";
    if (!model.trim()) errs.model = "Model is required.";
    if (!manufacturer.trim()) errs.manufacturer = "Manufacturer is required.";
    if (!location.site.trim()) errs.site = "Site is required.";
    return errs;
  }

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const errs = validate();
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setError(null);
    setSubmitting(true);
    try {
      const asset = await api.scans.receive({
        asset_tag: tag,
        serial: serial.trim(),
        model: model.trim(),
        manufacturer: manufacturer.trim(),
        asset_class: assetClass,
        location,
        user_id: getCurrentUserId(),
        scan_payload: buildScanPayload(tag),
      });
      onCreated(asset);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError("Couldn't reach the system. Check the connection and try again.");
      }
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="rounded-lg border bg-white p-4 space-y-1">
        <div className="text-xs uppercase tracking-wide text-gray-500">New asset</div>
        <div className="font-mono text-lg">{tag}</div>
      </div>

      <Field label="Serial number" error={fieldErrors.serial}>
        <input
          autoFocus
          type="text"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          value={serial}
          onChange={(e) => setSerial(e.target.value)}
          className="w-full text-base p-3 min-h-[44px] rounded-md border border-gray-300 focus:border-blue-600 focus:outline-none"
        />
      </Field>

      <Field label="Model" error={fieldErrors.model}>
        <input
          type="text"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="w-full text-base p-3 min-h-[44px] rounded-md border border-gray-300 focus:border-blue-600 focus:outline-none"
        />
      </Field>

      <Field label="Manufacturer" error={fieldErrors.manufacturer}>
        <input
          type="text"
          value={manufacturer}
          onChange={(e) => setManufacturer(e.target.value)}
          className="w-full text-base p-3 min-h-[44px] rounded-md border border-gray-300 focus:border-blue-600 focus:outline-none"
        />
      </Field>

      <Field label="Asset class">
        <select
          value={assetClass}
          onChange={(e) => setAssetClass(e.target.value as AssetClass)}
          className="w-full text-base p-3 min-h-[44px] rounded-md border border-gray-300 focus:border-blue-600 focus:outline-none bg-white"
        >
          {ASSET_CLASSES.map((c) => (
            <option key={c} value={c}>
              {c.replace("_", " ")}
            </option>
          ))}
        </select>
      </Field>

      <div className="text-sm">
        {locationEditing ? (
          <LocationEditor
            value={location}
            onChange={setLocation}
            onDone={() => setLocationEditing(false)}
            siteError={fieldErrors.site}
          />
        ) : (
          <div className="flex items-baseline gap-2">
            <span className="text-gray-700">
              Location: <span className="font-medium">{locationToString(location)}</span>
            </span>
            <button
              type="button"
              onClick={() => setLocationEditing(true)}
              className="text-blue-700 hover:underline"
            >
              [edit]
            </button>
          </div>
        )}
      </div>

      {error ? (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="bg-blue-700 text-white px-4 py-3 rounded-md font-medium min-h-[44px] disabled:bg-blue-400"
        >
          {submitting ? "Receiving…" : "Receive"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="px-4 py-3 rounded-md border border-gray-300 min-h-[44px] hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-gray-700 mb-1">{label}</span>
      {children}
      {error ? (
        <span className="mt-1 block text-sm text-red-700">{error}</span>
      ) : null}
    </label>
  );
}

function LocationEditor({
  value,
  onChange,
  onDone,
  siteError,
}: {
  value: Location;
  onChange: (loc: Location) => void;
  onDone: () => void;
  siteError?: string;
}): React.ReactElement {
  function setField<K extends keyof Location>(k: K, v: Location[K]): void {
    onChange({ ...value, [k]: v });
  }
  const inputClass =
    "w-full text-base p-2 min-h-[40px] rounded-md border border-gray-300 focus:border-blue-600 focus:outline-none";
  return (
    <div className="rounded-md border border-gray-300 bg-white p-3 space-y-2">
      <div className="text-xs uppercase tracking-wide text-gray-500">Location</div>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="block text-xs text-gray-600">Site</span>
          <input
            value={value.site}
            onChange={(e) => setField("site", e.target.value)}
            className={inputClass}
          />
          {siteError ? <span className="text-xs text-red-700">{siteError}</span> : null}
        </label>
        <label className="block">
          <span className="block text-xs text-gray-600">Room</span>
          <input
            value={value.room ?? ""}
            onChange={(e) => setField("room", e.target.value || null)}
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="block text-xs text-gray-600">Row</span>
          <input
            value={value.row ?? ""}
            onChange={(e) => setField("row", e.target.value || null)}
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="block text-xs text-gray-600">Rack</span>
          <input
            value={value.rack ?? ""}
            onChange={(e) => setField("rack", e.target.value || null)}
            className={inputClass}
          />
        </label>
        <label className="block col-span-2">
          <span className="block text-xs text-gray-600">RU</span>
          <input
            value={value.ru ?? ""}
            onChange={(e) => setField("ru", e.target.value || null)}
            className={inputClass}
          />
        </label>
      </div>
      <button
        type="button"
        onClick={onDone}
        className="text-blue-700 hover:underline text-sm"
      >
        Done
      </button>
    </div>
  );
}

function ConfirmDuplicate({
  asset,
  submitting,
  lastError,
  onIdempotent,
  onMismatch,
  onError,
  onSubmittingChange,
}: {
  asset: Asset;
  submitting: boolean;
  lastError: string | null;
  onIdempotent: (asset: Asset) => void;
  onMismatch: (providedSerial: string) => void;
  onError: (message: string) => void;
  onSubmittingChange: (submitting: boolean) => void;
}): React.ReactElement {
  async function handleScan(rawSerial: string): Promise<void> {
    const serial = rawSerial.trim();
    if (!serial) return;
    onSubmittingChange(true);
    try {
      const updated = await api.scans.receive({
        asset_tag: asset.asset_tag,
        serial,
        model: asset.model,
        manufacturer: asset.manufacturer,
        asset_class: asset.asset_class,
        location: asset.location,
        user_id: getCurrentUserId(),
        scan_payload: buildScanPayload(serial),
      });
      onIdempotent(updated);
    } catch (err) {
      if (err instanceof ApiError && err.code === "and_match_failed") {
        onMismatch(serial);
        return;
      }
      if (err instanceof ApiError) {
        onError(`${err.code}: ${err.message}`);
        return;
      }
      onError("Couldn't reach the system. Check the connection and try again.");
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border-2 border-blue-200 bg-blue-50 p-4 space-y-1">
        <div className="text-xs uppercase tracking-wide text-gray-600">
          Tag already on file
        </div>
        <div className="text-sm text-gray-900">
          <span className="font-mono">{asset.asset_tag}</span> — {asset.model}
        </div>
        <div className="text-sm text-gray-800">
          Manufacturer: {asset.manufacturer}
        </div>
        <div className="text-sm text-gray-800">
          Current state: <span className="font-medium">{asset.state}</span>
        </div>
        <div className="text-sm text-gray-800">
          Custodian: <span className="font-mono">{asset.custodian}</span>
        </div>
      </div>

      <p className="text-sm text-gray-700">
        Scan the serial barcode on the unit to confirm this is the same item.
      </p>

      <ScanInput
        label="Serial number"
        placeholder="Scan or type the serial on the unit and press Enter"
        onScan={handleScan}
        disabled={submitting}
      />
      <div className="min-h-[1.5rem] text-sm" aria-live="polite">
        {submitting ? (
          <span className="text-gray-600">Submitting…</span>
        ) : lastError ? (
          <span className="text-red-700">{lastError}</span>
        ) : null}
      </div>
    </div>
  );
}

function SerialMismatchPanel({
  tag,
  onFile,
  providedSerial,
  onRescanSerial,
  onRescanTag,
}: {
  tag: string;
  onFile: Asset;
  providedSerial: string;
  onRescanSerial: () => void;
  onRescanTag: () => void;
}): React.ReactElement {
  const [showEscalation, setShowEscalation] = useState(false);
  const escalation = `Asset ${tag} may be mistagged. On file: serial ${onFile.serial} (${onFile.model} / ${onFile.manufacturer}). Scanned: serial ${providedSerial}. Logged in as ${getCurrentUserId()}.`;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border-2 border-red-500 bg-red-50 p-4 space-y-3">
        <div className="font-semibold text-red-900">Tag conflict</div>
        <p className="text-sm text-red-900">
          Tag <span className="font-mono">{tag}</span> is on file with serial{" "}
          <span className="font-mono font-semibold">{onFile.serial}</span>{" "}
          ({onFile.model}).
        </p>
        <p className="text-sm text-red-900">
          You scanned: <span className="font-mono font-semibold">{providedSerial}</span>.
        </p>
        <p className="text-sm text-red-900">
          The unit, the tag, or the scan is wrong. Pick a path.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={onRescanSerial}
          className="w-full text-left bg-white border border-gray-300 hover:bg-gray-50 rounded-md p-3 min-h-[44px]"
        >
          <span className="font-medium">Wrong serial</span>
          <span className="block text-sm text-gray-600">
            Re-scan the serial on the unit.
          </span>
        </button>
        <button
          type="button"
          onClick={onRescanTag}
          className="w-full text-left bg-white border border-gray-300 hover:bg-gray-50 rounded-md p-3 min-h-[44px]"
        >
          <span className="font-medium">Wrong tag</span>
          <span className="block text-sm text-gray-600">
            Re-scan the barcode on the unit.
          </span>
        </button>
        <button
          type="button"
          onClick={() => setShowEscalation((s) => !s)}
          className="w-full text-left bg-white border border-gray-300 hover:bg-gray-50 rounded-md p-3 min-h-[44px]"
        >
          <span className="font-medium">Neither — talk to a manager</span>
          <span className="block text-sm text-gray-600">
            The physical unit may be mistagged.
          </span>
        </button>
      </div>

      {showEscalation ? (
        <div className="rounded-md border border-gray-300 bg-gray-50 p-3 space-y-2">
          <div className="text-xs uppercase tracking-wide text-gray-500">
            Copy this to your manager
          </div>
          <pre className="text-xs whitespace-pre-wrap font-mono text-gray-900">
            {escalation}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

function AssetSummary({
  asset,
  variant,
  title,
}: {
  asset: Asset;
  variant: "info" | "success";
  title: string;
}): React.ReactElement {
  const styles =
    variant === "success"
      ? "border-emerald-300 bg-emerald-50"
      : "border-blue-200 bg-blue-50";
  return (
    <div className={`rounded-lg border-2 ${styles} p-4 space-y-1`}>
      <div className="text-xs uppercase tracking-wide text-gray-600">{title}</div>
      <div className="font-mono text-lg">{asset.asset_tag}</div>
      <div className="text-sm text-gray-800">
        {asset.model} · {asset.manufacturer}
      </div>
      <div className="text-sm text-gray-700">
        Serial <span className="font-mono">{asset.serial}</span> · state{" "}
        <span className="font-medium">{asset.state}</span>
      </div>
      <div className="text-sm text-gray-700">
        At {locationToString(asset.location) || "—"}
      </div>
      <div className="text-sm text-gray-700">
        Custodian <span className="font-mono">{asset.custodian}</span>
      </div>
    </div>
  );
}

function SuccessBanner({
  asset,
  kind,
  onContinue,
}: {
  asset: Asset;
  kind: "new" | "duplicate";
  onContinue: () => void;
}): React.ReactElement {
  const headline = kind === "new" ? "Received" : "Already on file";
  const subline =
    kind === "new"
      ? "Asset created."
      : "Logged a duplicate-receive event. State unchanged.";
  return (
    <div className="space-y-4">
      <AssetSummary asset={asset} variant="success" title={headline} />
      <p className="text-sm text-gray-700">{subline}</p>
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
