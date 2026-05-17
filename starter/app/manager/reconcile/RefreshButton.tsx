"use client";

import { useRouter } from "next/navigation";

export function RefreshButton(): React.ReactElement {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.refresh()}
      className="text-sm px-3 py-1.5 rounded-md border border-gray-300 hover:bg-gray-50 min-h-[44px] print:hidden"
    >
      Refresh
    </button>
  );
}
