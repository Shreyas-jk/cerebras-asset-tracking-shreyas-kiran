import Link from "next/link";

export type TriageCardTone = "red" | "amber" | "gray";

const TONE_CLASSES: Record<TriageCardTone, { number: string; border: string }> =
  {
    red: { number: "text-red-700", border: "border-red-400" },
    amber: { number: "text-amber-700", border: "border-amber-400" },
    gray: { number: "text-gray-600", border: "border-gray-300" },
  };

export function TriageCard({
  count,
  label,
  sublabel,
  href,
  tone,
}: {
  count: number;
  label: string;
  sublabel?: string;
  href: string;
  tone: TriageCardTone;
}): React.ReactElement {
  const cls = TONE_CLASSES[tone];
  return (
    <Link
      href={href}
      className={`block bg-white border-l-4 ${cls.border} border-y border-r border-gray-200 rounded-r-md p-4 hover:bg-gray-50`}
    >
      <div className={`text-3xl font-bold leading-none ${cls.number}`}>
        {count}
      </div>
      <div className="text-sm font-medium text-gray-900 mt-2">{label}</div>
      {sublabel ? (
        <div className="text-xs text-gray-500 mt-0.5">{sublabel}</div>
      ) : null}
    </Link>
  );
}
