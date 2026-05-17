import Link from "next/link";

export default function HomePage() {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold">Asset tracking</h1>
        <p className="text-sm text-gray-600 mt-2">
          Use the role switcher in the header to swap between technician and manager views.
        </p>
      </header>

      <section className="grid md:grid-cols-2 gap-6">
        <article className="bg-white border rounded-lg p-6">
          <h2 className="text-xl font-semibold text-gray-900">Technician</h2>
          <p className="text-sm text-gray-700 mt-2 leading-relaxed">
            Mobile-friendly scan workflows for receiving, storing, deploying, and
            transferring custody of assets.
          </p>
          <Link
            href="/tech"
            className="inline-block mt-4 text-blue-700 hover:underline font-medium"
          >
            Open tech workflows →
          </Link>
        </article>

        <article className="bg-white border rounded-lg p-6">
          <h2 className="text-xl font-semibold text-gray-900">Manager</h2>
          <p className="text-sm text-gray-700 mt-2 leading-relaxed">
            Desktop dashboard for asset overview, reconciliation findings, and
            asset-detail forensics.
          </p>
          <Link
            href="/manager"
            className="inline-block mt-4 text-blue-700 hover:underline font-medium"
          >
            Open manager dashboard →
          </Link>
        </article>
      </section>

      <section className="border-t pt-5 space-y-3 max-w-2xl">
        <p className="text-sm text-gray-600 leading-relaxed">
          <span className="font-medium text-gray-800">About this system.</span> A
          multi-site research lab tracks instruments across three systems: operations
          (where assets are and who has them), facilities (rack positions), and
          finance (book value and capitalization status). The three systems drift
          apart over time as scans, observations, and audits happen on different
          cadences — the manager dashboard surfaces those differences and the
          actions to take.
        </p>
        <p className="text-xs text-gray-400">
          Test barcodes for review at{" "}
          <Link href="/dev/barcodes" className="underline">
            /dev/barcodes
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
