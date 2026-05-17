import { NextResponse } from "next/server";
import { api } from "@/lib/api-client";
import {
  STALE_DAYS,
  locationToSlashString,
  type CountsByCategory,
  type ReconcileFinding,
  type ReconcileReport,
} from "@/lib/reconcile";
import type { Asset, FacilitiesRecord, FinanceRecord } from "@/lib/types";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function daysSince(iso: string, nowMs: number): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  return Math.floor((nowMs - t) / MS_PER_DAY);
}

function emptyCounts(): CountsByCategory {
  return {
    real_drift: 0,
    state_scope_drift: 0,
    ghost_in_facilities: 0,
    ghost_in_finance: 0,
    stale_observation: 0,
    ambiguous: 0,
    expected_mismatch: 0,
  };
}

function classify(
  tag: string,
  asset: Asset | undefined,
  fac: FacilitiesRecord | undefined,
  fin: FinanceRecord | undefined,
  nowMs: number,
): ReconcileFinding | null {
  // 1. Ghost in facilities — no ops record but facilities tracks it.
  if (!asset && fac) {
    return {
      category: "ghost_in_facilities",
      triage_level: "action_required",
      asset_tag: tag,
      summary: `${tag} appears in facilities but has no operations record.`,
      details: {
        facilities_location: fac.rack_location,
        facilities_last_observed: fac.last_observed,
      },
    };
  }

  // 2. Ghost in finance — no ops record but finance tracks it.
  if (!asset && fin) {
    return {
      category: "ghost_in_finance",
      triage_level: "action_required",
      asset_tag: tag,
      summary: `${tag} appears in finance (${fin.status}) but has no operations record.`,
      details: {
        finance_status: fin.status,
        finance_site: fin.site,
        book_value_usd: fin.book_value_usd,
      },
    };
  }

  // From here on, the asset exists in ops.
  if (!asset) return null;

  // 3. State/scope drift — ops says the asset is non-active, but a downstream
  //    system still tracks it as if it were live.
  const nonActiveStates: Asset["state"][] = [
    "stored",
    "received",
    "rma_pending",
    "disposed",
  ];
  const isNonActive = nonActiveStates.includes(asset.state);
  const facilitiesShouldNotExist = isNonActive && Boolean(fac);
  const disposedStillCapitalized =
    asset.state === "disposed" && fin?.status === "capitalized";

  if (facilitiesShouldNotExist || disposedStillCapitalized) {
    return {
      category: "state_scope_drift",
      triage_level: "action_required",
      asset_tag: asset.asset_tag,
      summary: scopeSummary(asset, fac, fin),
      details: {
        ops_state: asset.state,
        facilities_present: Boolean(fac),
        finance_status: fin?.status ?? null,
      },
    };
  }

  // 4. Real drift — ops in_service, facilities has a row, locations disagree.
  if (asset.state === "in_service" && fac) {
    const opsString = locationToSlashString(asset.location);
    if (opsString !== fac.rack_location) {
      return {
        category: "real_drift",
        triage_level: "investigate",
        asset_tag: asset.asset_tag,
        summary: `${asset.asset_tag} has a location mismatch — ops says ${opsString}, facilities says ${fac.rack_location}.`,
        details: {
          ops_location: opsString,
          facilities_location: fac.rack_location,
        },
      };
    }
  }

  // 5. Ambiguous — finance status disagrees with ops state in a way the rules
  //    above didn't catch. Kept narrow on purpose: a taxonomy that maps to
  //    action beats one that classifies every difference.
  if (
    fin &&
    asset.state === "in_service" &&
    fin.status !== "capitalized" &&
    fin.status !== "pending_receipt"
  ) {
    return {
      category: "ambiguous",
      triage_level: "investigate",
      asset_tag: asset.asset_tag,
      summary: `${asset.asset_tag} is in service in operations but finance status is ${fin.status}.`,
      details: {
        ops_state: asset.state,
        finance_status: fin.status,
      },
    };
  }

  // 6. Stale observation — ops and facilities agree on location, but
  //    facilities hasn't observed this rack in a long time.
  if (asset.state === "in_service" && fac) {
    const days = daysSince(fac.last_observed, nowMs);
    if (days > STALE_DAYS) {
      return {
        category: "stale_observation",
        triage_level: "monitor",
        asset_tag: asset.asset_tag,
        summary: `${asset.asset_tag} hasn't been observed by facilities in ${days} days.`,
        details: {
          facilities_last_observed: fac.last_observed,
          days_since_observed: days,
          threshold_days: STALE_DAYS,
        },
      };
    }
  }

  return null;
}

function scopeSummary(
  asset: Asset,
  fac: FacilitiesRecord | undefined,
  fin: FinanceRecord | undefined,
): string {
  const issues: string[] = [];
  if (fac) {
    issues.push(`facilities still tracks it at ${fac.rack_location}`);
  }
  if (asset.state === "disposed" && fin?.status === "capitalized") {
    issues.push(`finance still has it as capitalized`);
  }
  const joined = issues.join("; ");
  return `${asset.asset_tag} is ${asset.state} in operations but ${joined}.`;
}

export async function GET(): Promise<NextResponse> {
  let assets: Asset[];
  let facilities: FacilitiesRecord[];
  let finance: FinanceRecord[];
  try {
    [assets, facilities, finance] = await Promise.all([
      api.assets.list(),
      api.mock.facilities(),
      api.mock.finance(),
    ]);
  } catch (err) {
    return NextResponse.json(
      {
        error: {
          code: "upstream_unreachable",
          message: err instanceof Error ? err.message : "Could not reach upstream",
        },
      },
      { status: 502 },
    );
  }

  const assetsByTag = new Map<string, Asset>();
  for (const a of assets) assetsByTag.set(a.asset_tag, a);
  const facilitiesByTag = new Map<string, FacilitiesRecord>();
  for (const f of facilities) facilitiesByTag.set(f.tagged_id, f);
  const financeByTag = new Map<string, FinanceRecord>();
  for (const f of finance) financeByTag.set(f.tag, f);

  const allTags = new Set<string>([
    ...assetsByTag.keys(),
    ...facilitiesByTag.keys(),
    ...financeByTag.keys(),
  ]);

  const counts = emptyCounts();
  const findings: ReconcileFinding[] = [];
  const nowMs = Date.now();

  for (const tag of allTags) {
    const finding = classify(
      tag,
      assetsByTag.get(tag),
      facilitiesByTag.get(tag),
      financeByTag.get(tag),
      nowMs,
    );
    if (finding) {
      counts[finding.category] += 1;
      findings.push(finding);
    } else {
      counts.expected_mismatch += 1;
    }
  }

  const report: ReconcileReport = {
    generated_at: new Date(nowMs).toISOString(),
    total_assets: assetsByTag.size,
    suppressed_count: counts.expected_mismatch,
    counts_by_category: counts,
    findings,
  };

  return NextResponse.json(report);
}
