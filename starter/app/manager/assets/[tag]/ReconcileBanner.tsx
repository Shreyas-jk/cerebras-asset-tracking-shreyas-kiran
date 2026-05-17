import Link from "next/link";
import type { ReconcileFinding } from "@/lib/reconcile";

const TONE_CLASSES: Record<
  ReconcileFinding["triage_level"],
  { border: string; bg: string; text: string }
> = {
  action_required: {
    border: "border-red-400",
    bg: "bg-red-50",
    text: "text-red-900",
  },
  investigate: {
    border: "border-amber-400",
    bg: "bg-amber-50",
    text: "text-amber-900",
  },
  monitor: {
    border: "border-gray-300",
    bg: "bg-gray-50",
    text: "text-gray-900",
  },
};

const CATEGORY_LABEL: Record<ReconcileFinding["category"], string> = {
  real_drift: "Real drift",
  state_scope_drift: "State / scope drift",
  ghost_in_facilities: "Ghost in facilities",
  ghost_in_finance: "Ghost in finance",
  stale_observation: "Stale observation",
  ambiguous: "Ambiguous",
};

export function ReconcileBanner({
  finding,
  reportAvailable,
}: {
  finding: ReconcileFinding | null;
  reportAvailable: boolean;
}): React.ReactElement {
  if (!reportAvailable) {
    return (
      <p className="text-xs text-gray-500 italic">
        Reconcile status unavailable — couldn&apos;t reach the report.
      </p>
    );
  }
  if (!finding) {
    return (
      <p className="text-sm text-emerald-700">
        ✓ Reconciles cleanly. All three systems agree.
      </p>
    );
  }
  const tone = TONE_CLASSES[finding.triage_level];
  return (
    <div
      className={`rounded-md border-l-4 ${tone.border} ${tone.bg} p-3 space-y-1`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className={`font-semibold ${tone.text}`}>
          Flagged: {CATEGORY_LABEL[finding.category]}
        </div>
        <Link
          href="/manager/reconcile"
          className={`text-sm underline underline-offset-2 ${tone.text}`}
        >
          Open report →
        </Link>
      </div>
      <div className={`text-sm ${tone.text}`}>{finding.summary}</div>
    </div>
  );
}
