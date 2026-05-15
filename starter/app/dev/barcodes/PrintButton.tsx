"use client";

export function PrintButton(): React.ReactElement {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="bg-blue-700 text-white px-4 py-2 rounded-md font-medium text-sm print:hidden"
    >
      Print
    </button>
  );
}
