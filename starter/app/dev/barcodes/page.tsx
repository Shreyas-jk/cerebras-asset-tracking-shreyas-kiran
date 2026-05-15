import { renderCode128SVG } from "@/lib/barcodes";
import { PrintButton } from "./PrintButton";

type BarcodeRow = {
  value: string;
  label: string;
};

const ASSETS: BarcodeRow[] = [
  { value: "C0000101", label: "Clean — in_service, all three systems agree" },
  { value: "C0000104", label: "Stored — happy-path source for deploy-from-stored" },
  { value: "C0000107", label: "Received — first-deployment demo (triggers both write-backs)" },
  { value: "C0000108", label: "rma_pending — drift: facilities still has a rack row" },
  { value: "C0000109", label: "Disposed — triple-drift (facilities + finance both stale)" },
  { value: "C0000110", label: "Real location drift (ops U18 vs. facilities U16)" },
  { value: "C0000111", label: "Stale observation — facilities last_observed in 2025-11" },
  { value: "C0000199", label: "Ghost in facilities — no ops record" },
];

const LOCATIONS: BarcodeRow[] = [
  {
    value: "Lab-Building-A/Bay-12/Aisle-3/B-04/P-02",
    label: "Full 5-segment — valid for deploy",
  },
  {
    value: "Lab-Building-B/Computing-1/Aisle-1/C-12/U18",
    label: "Drift location — matches ops side of C0000110",
  },
  {
    value: "Lab-Building-A/Storage-1//SHELF-3/",
    label: "Storage shelf — valid for store, not for deploy",
  },
  {
    value: "Lab-Building-A/Receiving//DOCK-1/",
    label: "Receiving dock — receive default",
  },
  {
    value: "Lab-Building-A/Staging-RMA//BIN-RMA-1/",
    label: "RMA bin",
  },
  {
    value: "Lab-Building-A/Disposal//PALLET-9/",
    label: "Disposal pallet",
  },
];

function BarcodeCard({ value, label }: BarcodeRow): React.ReactElement {
  const svg = renderCode128SVG(value);
  return (
    <div className="border border-gray-300 rounded-md p-3 bg-white break-inside-avoid">
      <div
        className="flex justify-center"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <div className="mt-2 font-mono text-xs text-gray-900 break-all">
        {value}
      </div>
      <div className="mt-1 text-xs text-gray-600">{label}</div>
    </div>
  );
}

export default function BarcodesDevPage(): React.ReactElement {
  return (
    <div className="space-y-6">
      <header className="flex items-baseline justify-between print:hidden">
        <div>
          <h1 className="text-2xl font-bold">Barcode sheet (dev)</h1>
          <p className="text-sm text-gray-600 mt-1 max-w-2xl">
            Reviewer aid. Not surfaced to techs at the dock. Each barcode is
            Code 128 — scannable with any USB/Bluetooth scanner or phone camera
            decoder. Print this page (or save as PDF) to scan against the
            running app.
          </p>
          <p className="text-xs text-gray-500 mt-2 max-w-2xl">
            <span className="font-medium">Omitted by design:</span> C0000113 (finance ghost)
            has no operations record, so there&apos;s nothing to physically tag. See{" "}
            <code>/manager/reconcile</code> for the orphan case.
          </p>
        </div>
        <PrintButton />
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold print:text-base">Assets</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 print:grid-cols-2 print:gap-2">
          {ASSETS.map((a) => (
            <BarcodeCard key={a.value} {...a} />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold print:text-base">Locations</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 print:grid-cols-2 print:gap-2">
          {LOCATIONS.map((l) => (
            <BarcodeCard key={l.value} {...l} />
          ))}
        </div>
      </section>
    </div>
  );
}
